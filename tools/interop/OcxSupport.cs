// ActiveX containment and outgoing dispatch events for the explicitly granted local host.
// Contracts: Microsoft ActiveX Controls, IClassFactory2, IProvideClassInfo and
// System.Runtime.InteropServices.ComEventsHelper. See docs/OCX-SUPPORT.md.
using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Linq.Expressions;
using System.Reflection;
using System.Reflection.Emit;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Windows.Forms;
using TYPEATTR = System.Runtime.InteropServices.ComTypes.TYPEATTR;
using FUNCDESC = System.Runtime.InteropServices.ComTypes.FUNCDESC;
using ELEMDESC = System.Runtime.InteropServices.ComTypes.ELEMDESC;
using TYPEKIND = System.Runtime.InteropServices.ComTypes.TYPEKIND;
using IMPLTYPEFLAGS = System.Runtime.InteropServices.ComTypes.IMPLTYPEFLAGS;
using PARAMFLAG = System.Runtime.InteropServices.ComTypes.PARAMFLAG;

namespace VB6Interop {
  [ComImport, Guid("B196B283-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface ProvideClassInfo { void GetClassInfo(out ITypeInfo info); }
  [StructLayout(LayoutKind.Sequential)]
  struct LicenseInfo { public int Size; [MarshalAs(UnmanagedType.Bool)] public bool RuntimeKeyAvailable; [MarshalAs(UnmanagedType.Bool)] public bool LicenseVerified; }
  [ComImport, Guid("B196B28F-BAB4-101A-B69C-00AA00341D07"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface LicensedFactory {
    void CreateInstance([MarshalAs(UnmanagedType.IUnknown)] object outer, ref Guid iid, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
    void LockServer([MarshalAs(UnmanagedType.Bool)] bool locked);
    void GetLicInfo(ref LicenseInfo info);
    void RequestLicKey(int reserved, [MarshalAs(UnmanagedType.BStr)] out string key);
    void CreateInstanceLic([MarshalAs(UnmanagedType.IUnknown)] object outer, [MarshalAs(UnmanagedType.IUnknown)] object reserved, ref Guid iid, [MarshalAs(UnmanagedType.BStr)] string key, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
  }
  sealed class EventConnection { public Guid Iid; public int Dispid; public Delegate Handler; }
  sealed class EventReply { public object[] Arguments; public string Error; public bool Complete; }
  public static partial class AutomationHost {
    static readonly BlockingCollection<string> Requests=new BlockingCollection<string>(16);
    static readonly Dictionary<string,EventReply> EventReplies=new Dictionary<string,EventReply>();
    static readonly Stack<string> EventTokens=new Stack<string>();
    static readonly Dictionary<string,Type> EventDelegates=new Dictionary<string,Type>();
    static readonly ModuleBuilder EventModule=AppDomain.CurrentDomain.DefineDynamicAssembly(new AssemblyName("VB6OcxEventDelegates"),AssemblyBuilderAccess.Run).DefineDynamicModule("Events");
    static int EventSequence=0,RequestDepth=0;
    [DllImport("ole32.dll",PreserveSig=true)]
    static extern int CoGetClassObject(ref Guid clsid,uint context,IntPtr server,ref Guid iid,[MarshalAs(UnmanagedType.Interface)] out LicensedFactory factory);
    static LicensedFactory GetLicensedFactory(Guid clsid){
      CheckKillbit(clsid);var iid=typeof(LicensedFactory).GUID;LicensedFactory factory;
      Marshal.ThrowExceptionForHR(CoGetClassObject(ref clsid,5,IntPtr.Zero,ref iid,out factory));return factory;
    }
    internal static object CreateLicensed(Guid clsid,string key){
      if(key==null||key.Length==0||key.Length>16384)throw new ArgumentException("A bounded developer-supplied runtime license key is required");
      var factory=GetLicensedFactory(clsid);try{var iid=new Guid("00000000-0000-0000-C000-000000000046");object instance;factory.CreateInstanceLic(null,null,ref iid,key,out instance);return instance;}finally{Marshal.ReleaseComObject(factory);}
    }
    static object Licensing(string progId){
      if(!Allowed.Contains(progId))throw new UnauthorizedAccessException("ProgID is not allowed");
      var type=Type.GetTypeFromProgID(progId,true);LicensedFactory factory=null;
      try{factory=GetLicensedFactory(type.GUID);var info=new LicenseInfo {Size=Marshal.SizeOf(typeof(LicenseInfo))};factory.GetLicInfo(ref info);return D("supported",true,"runtimeKeyAvailable",info.RuntimeKeyAvailable,"licenseVerified",info.LicenseVerified);}
      catch(COMException error){if(error.ErrorCode==unchecked((int)0x80004002)||error.ErrorCode==unchecked((int)0x80040111))return D("supported",false,"hresult",error.ErrorCode);throw;}
      finally{if(factory!=null)Marshal.ReleaseComObject(factory);}
    }
    static Dictionary<string,object>[] DescribeEvents(object value){
      ITypeInfo coclass=null,source=null;IntPtr attr=IntPtr.Zero;
      try{
        var provider=value as ProvideClassInfo;if(provider==null)return new Dictionary<string,object>[0];
        provider.GetClassInfo(out coclass);coclass.GetTypeAttr(out attr);var type=(TYPEATTR)Marshal.PtrToStructure(attr,typeof(TYPEATTR));coclass.ReleaseTypeAttr(attr);attr=IntPtr.Zero;
        if(type.cImplTypes>256)throw new NotSupportedException("Too many component interfaces");
        for(int i=0;i<type.cImplTypes;i++){
          IMPLTYPEFLAGS flags;coclass.GetImplTypeFlags(i,out flags);
          if((flags&(IMPLTYPEFLAGS.IMPLTYPEFLAG_FSOURCE|IMPLTYPEFLAGS.IMPLTYPEFLAG_FDEFAULT))!=(IMPLTYPEFLAGS.IMPLTYPEFLAG_FSOURCE|IMPLTYPEFLAGS.IMPLTYPEFLAG_FDEFAULT))continue;
          int reference;coclass.GetRefTypeOfImplType(i,out reference);coclass.GetRefTypeInfo(reference,out source);break;
        }
        if(source==null)return new Dictionary<string,object>[0];
        source.GetTypeAttr(out attr);type=(TYPEATTR)Marshal.PtrToStructure(attr,typeof(TYPEATTR));
        if(type.typekind!=TYPEKIND.TKIND_DISPATCH||type.cFuncs>256)return new Dictionary<string,object>[0];
        var result=new List<Dictionary<string,object>>();var namesSeen=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        for(int i=0;i<type.cFuncs;i++){
          IntPtr ptr=IntPtr.Zero;try{
            source.GetFuncDesc(i,out ptr);var fn=(FUNCDESC)Marshal.PtrToStructure(ptr,typeof(FUNCDESC));
            if((fn.wFuncFlags&1)!=0||fn.cParams>64)continue;
            var names=new string[fn.cParams+1];int count;source.GetNames(fn.memid,names,names.Length,out count);
            if(names[0]==null||!Name(names[0])||!namesSeen.Add(names[0]))continue;
            var parameters=new List<object>();int size=Marshal.SizeOf(typeof(ELEMDESC));bool supported=true;
            for(int p=0;p<fn.cParams;p++){
              var e=(ELEMDESC)Marshal.PtrToStructure(IntPtr.Add(fn.lprgelemdescParam,p*size),typeof(ELEMDESC));var flags=e.desc.paramdesc.wParamFlags;
              if((flags&PARAMFLAG.PARAMFLAG_FRETVAL)!=0){supported=false;break;}
              string name=p+1<count?names[p+1]:null;if(name==null||!Name(name))name="arg"+p;
              bool byref=e.tdesc.vt==(short)VarEnum.VT_PTR||(e.tdesc.vt&(short)VarEnum.VT_BYREF)!=0||(flags&PARAMFLAG.PARAMFLAG_FOUT)!=0;
              parameters.Add(D("name",name,"byRef",byref,"optional",false));
            }
            if(supported)result.Add(D("name",names[0],"iid",type.guid.ToString(),"dispid",fn.memid,"params",parameters.ToArray()));
          }finally{if(ptr!=IntPtr.Zero)source.ReleaseFuncDesc(ptr);}
        }
        return result.ToArray();
      }catch(InvalidCastException){return new Dictionary<string,object>[0];}
      finally{if(attr!=IntPtr.Zero&&source!=null)source.ReleaseTypeAttr(attr);if(source!=null)Marshal.ReleaseComObject(source);if(coclass!=null)Marshal.ReleaseComObject(coclass);}
    }
    static Type EventDelegate(bool[] byref){
      string signature=string.Join("",byref.Select(b=>b?"R":"V"));Type type;if(EventDelegates.TryGetValue(signature,out type))return type;
      var builder=EventModule.DefineType("Event"+EventDelegates.Count,TypeAttributes.Public|TypeAttributes.Sealed,typeof(MulticastDelegate));
      builder.DefineConstructor(MethodAttributes.Public|MethodAttributes.HideBySig|MethodAttributes.RTSpecialName,CallingConventions.Standard,new[]{typeof(object),typeof(IntPtr)}).SetImplementationFlags(MethodImplAttributes.Runtime|MethodImplAttributes.Managed);
      builder.DefineMethod("Invoke",MethodAttributes.Public|MethodAttributes.HideBySig|MethodAttributes.NewSlot|MethodAttributes.Virtual,typeof(void),byref.Select(b=>b?typeof(object).MakeByRefType():typeof(object)).ToArray()).SetImplementationFlags(MethodImplAttributes.Runtime|MethodImplAttributes.Managed);
      type=builder.CreateType();EventDelegates.Add(signature,type);return type;
    }
    static Delegate MakeEventDelegate(string id,Dictionary<string,object> schema){
      var parameters=(object[])schema["params"];var byref=parameters.Select(p=>Convert.ToBoolean(Map(p)["byRef"])).ToArray();
      var inputs=byref.Select((b,i)=>Expression.Parameter(b?typeof(object).MakeByRefType():typeof(object),"arg"+i)).ToArray();
      var array=Expression.Variable(typeof(object[]),"values");var statements=new List<Expression>();
      statements.Add(Expression.Assign(array,Expression.NewArrayInit(typeof(object),inputs.Select(p=>Expression.Convert(p,typeof(object))))));
      statements.Add(Expression.Assign(array,Expression.Call(typeof(AutomationHost).GetMethod("RaiseComEvent",BindingFlags.Static|BindingFlags.NonPublic),Expression.Constant(id),Expression.Constant(S(schema,"name")),array)));
      for(int i=0;i<inputs.Length;i++)if(byref[i])statements.Add(Expression.Assign(inputs[i],Expression.ArrayIndex(array,Expression.Constant(i))));
      statements.Add(Expression.Empty());return Expression.Lambda(EventDelegate(byref),Expression.Block(new[]{array},statements),inputs).Compile();
    }
    static object Advise(string id,Entry target){
      if(target.Events.Count>0)return D("events",target.Events.Count);
      try{foreach(var schema in (Dictionary<string,object>[])target.Metadata["events"]){
        var connection=new EventConnection {Iid=new Guid(S(schema,"iid")),Dispid=N(schema,"dispid"),Handler=MakeEventDelegate(id,schema)};
        ComEventsHelper.Combine(target.Value,connection.Iid,connection.Dispid,connection.Handler);target.Events.Add(connection);
      }return D("events",target.Events.Count);}catch{Unadvise(target);throw;}
    }
    static void Unadvise(Entry target){
      foreach(var connection in target.Events.ToArray())try{ComEventsHelper.Remove(target.Value,connection.Iid,connection.Dispid,connection.Handler);}catch{}target.Events.Clear();
    }
    static object[] RaiseComEvent(string handle,string name,object[] args){
      if(Quitting)return args;if(EventTokens.Count>=16)throw new InvalidOperationException("Native event nesting exceeds 16");
      var target=ObjectAt(handle);string token="e"+(++EventSequence);var reply=new EventReply();EventReplies.Add(token,reply);EventTokens.Push(token);target.EventDepth++;
      try{
        WriteResponse(D("event",D("token",token,"handle",handle,"name",name,"args",args.Select(v=>Export(v)).ToArray(),"reentrant",RequestDepth>0)));
        var clock=Stopwatch.StartNew();
        while(!reply.Complete&&!Quitting){
          if(clock.ElapsedMilliseconds>120000)throw new TimeoutException("Native event handler did not complete");
          string line;if(Requests.TryTake(out line,10))ProcessRequest(line);else {if(Requests.IsCompleted)throw new EndOfStreamException("Native event client disconnected");Application.DoEvents();}
        }
        if(Quitting)return args;if(reply.Error!=null)throw new COMException(reply.Error,unchecked((int)0x800A01B8));
        if(reply.Arguments==null||reply.Arguments.Length!=args.Length)throw new ArgumentException("Invalid native event copyback count");
        return reply.Arguments;
      }finally{target.EventDepth--;EventTokens.Pop();EventReplies.Remove(token);}
    }
    static object EventReturn(Dictionary<string,object> request){
      string token=S(request,"eventToken");EventReply reply;
      if(EventTokens.Count==0||EventTokens.Peek()!=token||!EventReplies.TryGetValue(token,out reply)||reply.Complete)throw new UnauthorizedAccessException("Stale or mismatched native event response");
      var encoded=A(V(request,"args"));if(encoded.Length>64)throw new ArgumentException("Too many event arguments");
      reply.Arguments=encoded.Select(v=>Import(v)).ToArray();reply.Error=V(request,"error") as string;if(reply.Error!=null&&reply.Error.Length>2048)reply.Error=reply.Error.Substring(0,2048);reply.Complete=true;return D("accepted",true);
    }
    static object ControlOperation(Entry entry,Dictionary<string,object> request){
      if(entry.Control==null||entry.Window==null||entry.Window.IsDisposed)throw new NotSupportedException("Object is not an active hosted OCX control");
      var control=entry.Control;var window=entry.Window;string op=S(request,"op");
      if(op=="controlInfo")return D("propertyPages",control.HasPropertyPages(),"visible",window.Visible,"enabled",control.Enabled,"width",window.ClientSize.Width,"height",window.ClientSize.Height,"designMode",entry.DesignMode,"events",entry.Events.Count);
      if(op=="showPropertyPages"){if(!control.HasPropertyPages())throw new NotSupportedException("The component exposes no property pages");control.ShowPropertyPages();return D("shown",true);}
      if(op=="setControlBounds"){
        int width=N(request,"width"),height=N(request,"height");if(width<1||width>16384||height<1||height>16384)throw new ArgumentException("Control size must be 1..16384 pixels");
        window.ClientSize=new System.Drawing.Size(width,height);return D("width",window.ClientSize.Width,"height",window.ClientSize.Height);
      }
      if(op=="controlVisible"){window.Visible=Convert.ToBoolean(V(request,"visible"));return D("visible",window.Visible);}
      if(op=="controlEnabled"){control.Enabled=Convert.ToBoolean(V(request,"enabled"));return D("enabled",control.Enabled);}
      if(op=="controlFocus"){window.Activate();control.Focus();return D("focused",control.ContainsFocus);}
      throw new ArgumentException("Unknown OCX operation");
    }
    static void WriteResponse(object response){
      string json=Json.Serialize(response);if(json.Length>Limit)throw new InvalidOperationException("Automation response exceeds 1 MiB");Console.WriteLine(json);Console.Out.Flush();
    }
    static void ProcessRequest(string line){
      int id=0;object response;
      try{
        if(line.Length>Limit)throw new ArgumentException("Request too large");var request=Map(Json.DeserializeObject(line));id=N(request,"id");if(id<=0)throw new ArgumentException("Invalid request id");
        string op=S(request,"op");
        if(EventTokens.Count>0&&op!="close"&&S(request,"eventToken")!=EventTokens.Peek())throw new UnauthorizedAccessException("Nested requests require the current native event token");
        RequestDepth++;try{response=D("id",id,"result",Handle(request));}finally{RequestDepth--;}
      }catch(Exception error){while(error is TargetInvocationException&&error.InnerException!=null)error=error.InnerException;int hr=Marshal.GetHRForException(error);int number=(hr&unchecked((int)0xFFFF0000))==unchecked((int)0x800A0000)?hr&65535:hr==unchecked((int)0x80020003)?438:hr==unchecked((int)0x80020005)?13:440;response=D("id",id,"error",D("message",error.Message,"hresult",hr,"number",number));}
      try{WriteResponse(response);}catch{WriteResponse(D("id",id,"error",D("message","Automation response exceeds 1 MiB","number",7)));}
    }
  }
}
