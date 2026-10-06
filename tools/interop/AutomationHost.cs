// Local, opt-in Automation/ActiveX bridge. No HTTP listener, registration or arbitrary
// script evaluation. An allowed COM object has the full authority of the logged-in user.
using System;
using System.Collections;
using System.Collections.Concurrent;
using System.Threading;
using System.Collections.Generic;
using System.Globalization;
using System.IO;
using System.Linq;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;
using Microsoft.Win32;
using TYPEATTR = System.Runtime.InteropServices.ComTypes.TYPEATTR;
using FUNCDESC = System.Runtime.InteropServices.ComTypes.FUNCDESC;
using ELEMDESC = System.Runtime.InteropServices.ComTypes.ELEMDESC;
using PARAMFLAG = System.Runtime.InteropServices.ComTypes.PARAMFLAG;

namespace VB6Interop {
  [ComImport, Guid("00020400-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface DispatchInfo {
    [PreserveSig] int GetTypeInfoCount(out uint count);
    [PreserveSig] int GetTypeInfo(uint index, uint lcid, out ITypeInfo info);
  }
  [ComImport, Guid("00000109-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface PersistStream {
    void GetClassID(out Guid clsid); [PreserveSig] int IsDirty();
    void Load(IStream stream); void Save(IStream stream, [MarshalAs(UnmanagedType.Bool)] bool clearDirty); void GetSizeMax(out long size);
  }
  [ComImport, Guid("7FD52380-4E07-101B-AE2D-08002B2EC713"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface PersistStreamInit {
    void GetClassID(out Guid clsid); [PreserveSig] int IsDirty();
    void Load(IStream stream); void Save(IStream stream, [MarshalAs(UnmanagedType.Bool)] bool clearDirty); void GetSizeMax(out long size); void InitNew();
  }
  sealed class ControlHost : AxHost {
    readonly string licenseKey;
    public ControlHost(Guid clsid,string key=null) : base(clsid.ToString(), 2) { licenseKey=key; }
    protected override object CreateInstanceCore(Guid clsid) { return licenseKey==null?base.CreateInstanceCore(clsid):AutomationHost.CreateLicensed(clsid,licenseKey); }
    public object Instance { get { return GetOcx(); } }
  }
  sealed class Entry {
    public object Value; public long Identity; public Form Window; public ControlHost Control;
    public Dictionary<string,object> Metadata;
    public readonly List<EventConnection> Events=new List<EventConnection>(); public int EventDepth; public bool DesignMode=false;
  }
  public static partial class AutomationHost {
    const int Limit=1024*1024, MaxObjects=128;
    static readonly JavaScriptSerializer Json=new JavaScriptSerializer { MaxJsonLength=Limit, RecursionLimit=32 };
    static readonly Dictionary<string,Entry> Objects=new Dictionary<string,Entry>();
    static readonly Dictionary<long,string> Identities=new Dictionary<long,string>();
    static readonly HashSet<string> Allowed=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    static readonly HashSet<string> Controls=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    static bool Initialized=false; static volatile bool Quitting=false;
    static int Sequence=0;
    [DllImport("ole32.dll")] static extern int CreateStreamOnHGlobal(IntPtr memory,[MarshalAs(UnmanagedType.Bool)] bool deleteOnRelease,out IStream stream);
    static Dictionary<string,object> D(params object[] pairs) { var d=new Dictionary<string,object>();for(int i=0;i<pairs.Length;i+=2)d.Add((string)pairs[i],pairs[i+1]);return d; }
    static Dictionary<string,object> Map(object v) { var d=v as Dictionary<string,object>;if(d==null)throw new ArgumentException("Expected an object");return d; }
    static string S(Dictionary<string,object> d,string k) { object v;if(!d.TryGetValue(k,out v)||!(v is string))throw new ArgumentException("Expected string: "+k);return (string)v; }
    static object V(Dictionary<string,object> d,string k,object fallback=null) { object v;return d.TryGetValue(k,out v)?v:fallback; }
    static int N(Dictionary<string,object> d,string k,int fallback=0) { return Convert.ToInt32(V(d,k,fallback),CultureInfo.InvariantCulture); }
    static object[] A(object v) { var a=v as object[];if(a==null||a.Length>10000)throw new ArgumentException("Expected a bounded array");return a; }
    static bool Name(string name) { return name.Length<=255&&Regex.IsMatch(name,"^[A-Za-z][A-Za-z0-9_.]*$")&&!new[]{"constructor","prototype","caller","callee","arguments"}.Contains(name.ToLowerInvariant()); }
    static Entry ObjectAt(string id) { Entry e;if(!Objects.TryGetValue(id,out e))throw new COMException("Automation object was released",unchecked((int)0x800A005B));return e; }
    static void CheckKillbit(Guid clsid) {
      foreach(var root in new[]{Registry.LocalMachine,Registry.CurrentUser})using(var key=root.OpenSubKey(@"Software\Microsoft\Internet Explorer\ActiveX Compatibility\"+clsid.ToString("B"))) {
        if(key!=null&&(Convert.ToInt32(key.GetValue("Compatibility Flags",0),CultureInfo.InvariantCulture)&0x400)!=0)throw new UnauthorizedAccessException("Component is blocked by the ActiveX killbit");
      }
    }
    static Dictionary<string,object> Describe(object value) {
      ITypeInfo info=null;IntPtr attr=IntPtr.Zero;
      try {
        var dispatch=(DispatchInfo)value;uint count;Marshal.ThrowExceptionForHR(dispatch.GetTypeInfoCount(out count));if(count==0)throw new NotSupportedException("Component has no Automation type information");
        Marshal.ThrowExceptionForHR(dispatch.GetTypeInfo(0,0,out info));info.GetTypeAttr(out attr);var type=(TYPEATTR)Marshal.PtrToStructure(attr,typeof(TYPEATTR));
        if(type.cFuncs>1024)throw new NotSupportedException("Type information exceeds member limit");
        var members=new Dictionary<string,Dictionary<string,object>>(StringComparer.OrdinalIgnoreCase);string defaultMember=null;
        for(int i=0;i<type.cFuncs;i++) {
          IntPtr ptr=IntPtr.Zero;
          try {
            info.GetFuncDesc(i,out ptr);var fn=(FUNCDESC)Marshal.PtrToStructure(ptr,typeof(FUNCDESC));int mode=(int)fn.invkind;
            if((fn.wFuncFlags&1)!=0||fn.cParams>64||!new[]{1,2,4,8}.Contains(mode))continue;
            var names=new string[fn.cParams+1];int namesCount;info.GetNames(fn.memid,names,names.Length,out namesCount);
            string name=names[0];if(name==null||!Name(name))continue;
            var parameters=new List<object>();int size=Marshal.SizeOf(typeof(ELEMDESC));
            for(int p=0;p<fn.cParams;p++) {
              var element=(ELEMDESC)Marshal.PtrToStructure(IntPtr.Add(fn.lprgelemdescParam,p*size),typeof(ELEMDESC));var flags=element.desc.paramdesc.wParamFlags;
              if((flags&PARAMFLAG.PARAMFLAG_FRETVAL)!=0)continue;
              string pname=p+1<namesCount?names[p+1]:null;if(pname==null||!Name(pname))pname="arg"+p;
              parameters.Add(D("name",pname,"byRef",(flags&PARAMFLAG.PARAMFLAG_FOUT)!=0||element.tdesc.vt==26,"vartype",ParameterType(element.tdesc),"optional",(flags&PARAMFLAG.PARAMFLAG_FOPT)!=0));
            }
            // Property put signatures have a final value parameter; VM metadata describes indexes.
            if((mode==4||mode==8)&&parameters.Count>0)parameters.RemoveAt(parameters.Count-1);
            Dictionary<string,object> member;
            if(!members.TryGetValue(name,out member)){member=D("name",name,"modes",new List<int>(),"params",parameters);members.Add(name,member);}
            ((List<int>)member["modes"]).Add(mode);if(mode==1||mode==2)member["params"]=parameters;
            if(fn.memid==0)defaultMember=name;
          } finally { if(ptr!=IntPtr.Zero)info.ReleaseFuncDesc(ptr); }
        }
        return D("members",members.Values.ToArray(),"defaultMember",defaultMember,"guid",type.guid.ToString(),"enumerable",value is IEnumerable,"persistStream",value is PersistStream,"persistStreamInit",value is PersistStreamInit,"events",DescribeEvents(value));
      } finally { if(attr!=IntPtr.Zero&&info!=null)info.ReleaseTypeAttr(attr);if(info!=null&&Marshal.IsComObject(info))Marshal.ReleaseComObject(info); }
    }
    static object Export(object value,int depth=0) {
      if(depth>16)throw new NotSupportedException("Automation result nesting limit exceeded");
      if(value==null)return D("t","empty");if(value==DBNull.Value)return D("t","null");if(value==Type.Missing)return D("t","missing");
      if(Marshal.IsComObject(value)) {
        IntPtr unknown=Marshal.GetIUnknownForObject(value);long identity;try{identity=unknown.ToInt64();}finally{Marshal.Release(unknown);}
        string id;Entry entry;
        if(Identities.TryGetValue(identity,out id))entry=Objects[id];else{
          if(Objects.Count>=MaxObjects)throw new NotSupportedException("Native object limit exceeded");
          var metadata=Describe(value);id="o"+(++Sequence);entry=new Entry {Value=value,Identity=identity,Metadata=metadata};Objects.Add(id,entry);Identities.Add(identity,id);
        }
        return D("t","object","id",id,"metadata",entry.Metadata);
      }
      var array=value as Array;if(array!=null){if(array.Rank>8||array.Length>10000)throw new NotSupportedException("Automation array exceeds bounds");var values=new List<object>();foreach(var item in array)values.Add(Export(item,depth+1));return D("t","array","bounds",Enumerable.Range(0,array.Rank).Select(i=>new[]{array.GetLowerBound(i),array.GetUpperBound(i)}).ToArray(),"v",values);}
      if(value is string)return D("t","string","v",value);if(value is bool)return D("t","boolean","v",value);
      if(value is DateTime)return D("t","date","v",((DateTime)value).ToOADate());
      if(value is decimal)return D("t","decimal","v",((decimal)value).ToString(CultureInfo.InvariantCulture));
      if(value is CurrencyWrapper)return D("t","currency","v",((CurrencyWrapper)value).WrappedObject.ToString(CultureInfo.InvariantCulture));
      if(value is ErrorWrapper)return D("t","error","v",((ErrorWrapper)value).ErrorCode);
      if(value is byte||value is short||value is int||value is ushort||value is uint||value is float||value is double){double n=Convert.ToDouble(value,CultureInfo.InvariantCulture);if(double.IsNaN(n)||double.IsInfinity(n))throw new NotSupportedException("Nonfinite Automation number");return D("t","number","vt",value is byte?17:value is short?2:value is int?3:value is float?4:5,"v",value);}
      throw new NotSupportedException("Unsupported native Automation result: "+value.GetType().FullName);
    }
    static object Import(object wire,int depth=0) {
      if(depth>16)throw new ArgumentException("Automation argument nesting limit exceeded");var d=Map(wire);string t=S(d,"t");var v=V(d,"v");
      switch(t){
        case "empty":return null;case "null":return DBNull.Value;case "missing":return Type.Missing;case "nothing":return new DispatchWrapper(null);
        case "string":return S(d,"v");case "boolean":return Convert.ToBoolean(v,CultureInfo.InvariantCulture);
        case "number":{
          double n=Convert.ToDouble(v,CultureInfo.InvariantCulture);if(double.IsNaN(n)||double.IsInfinity(n))throw new ArgumentException("Invalid numeric payload");
          switch(N(d,"vt",5)){
            case 17:if(n!=Math.Truncate(n)||n<0||n>255)throw new ArgumentException("Invalid Byte payload");return (byte)n;
            case 2:if(n!=Math.Truncate(n)||n<short.MinValue||n>short.MaxValue)throw new ArgumentException("Invalid Integer payload");return (short)n;
            case 3:if(n!=Math.Truncate(n)||n<int.MinValue||n>int.MaxValue)throw new ArgumentException("Invalid Long payload");return (int)n;
            case 4:if(float.IsInfinity((float)n)||(double)(float)n!=n)throw new ArgumentException("Invalid Single payload");return (float)n;
            case 5:return n;default:throw new ArgumentException("Unsupported numeric VARTYPE");
          }
        }
        case "date":return DateTime.FromOADate(Convert.ToDouble(v,CultureInfo.InvariantCulture));
        case "decimal":return decimal.Parse(S(d,"v"),CultureInfo.InvariantCulture);case "currency":return new CurrencyWrapper(decimal.Parse(S(d,"v"),CultureInfo.InvariantCulture));
        case "error":return new ErrorWrapper(Convert.ToInt32(v,CultureInfo.InvariantCulture));case "object":return ObjectAt(S(d,"id")).Value;
        case "array":{
          var bounds=A(V(d,"bounds"));if(bounds.Length==0||bounds.Length>8)throw new ArgumentException("Invalid Automation array rank");var lengths=new int[bounds.Length];var lower=new int[bounds.Length];long total=1;
          for(int i=0;i<bounds.Length;i++){var pair=A(bounds[i]);if(pair.Length!=2)throw new ArgumentException("Invalid Automation array bound");lower[i]=Convert.ToInt32(pair[0]);long length=(long)Convert.ToInt32(pair[1])-lower[i]+1;if(length<0||length>10000)throw new ArgumentException("Invalid Automation array length");lengths[i]=(int)length;total*=length;if(total>10000)throw new ArgumentException("Automation array too large");}
          var source=A(v);if(source.Length!=total)throw new ArgumentException("Automation array data mismatch");int et=N(d,"elementType",12);Type element=et==17?typeof(byte):et==2?typeof(short):et==3?typeof(int):et==4?typeof(float):et==5?typeof(double):et==7?typeof(DateTime):et==8?typeof(string):et==11?typeof(bool):et==14?typeof(decimal):typeof(object);
          if(!new[]{2,3,4,5,6,7,8,11,12,14,17}.Contains(et))throw new ArgumentException("Unsupported array element VARTYPE");
          var target=Array.CreateInstance(element,lengths,lower);var index=(int[])lower.Clone();
          foreach(var item in source){target.SetValue(Import(item,depth+1),index);for(int i=index.Length-1;i>=0;i--){index[i]++;if((long)index[i]<(long)lower[i]+lengths[i])break;index[i]=lower[i];}}return target;
        }
        default:throw new NotSupportedException("Unsupported Automation wire type: "+t);
      }
    }
    static void Release(string id) {
      var e=ObjectAt(id);if(e.EventDepth>0)throw new InvalidOperationException("Cannot release the source of an active native event");Unadvise(e);Objects.Remove(id);Identities.Remove(e.Identity);
      try {if(e.Window!=null)e.Window.Dispose();else if(Marshal.IsComObject(e.Value))Marshal.FinalReleaseComObject(e.Value);}finally{e.Value=null;}
    }
    static object Persistence(Entry entry,Dictionary<string,object> request) {
      var streamInit=entry.Value as PersistStreamInit;var stream=entry.Value as PersistStream;if(streamInit==null&&stream==null)throw new NotSupportedException("Component has no supported stream-persistence interface");
      IStream memory=null;Marshal.ThrowExceptionForHR(CreateStreamOnHGlobal(IntPtr.Zero,true,out memory));
      try {
        if(S(request,"op")=="loadState") {var data=Convert.FromBase64String(S(request,"data"));if(data.Length>512*1024)throw new ArgumentException("Persistence input exceeds 512 KiB");memory.Write(data,data.Length,IntPtr.Zero);memory.Seek(0,0,IntPtr.Zero);if(streamInit!=null)streamInit.Load(memory);else stream.Load(memory);return D("loadedBytes",data.Length);}
        if(streamInit!=null)streamInit.Save(memory,false);else stream.Save(memory,false);
        System.Runtime.InteropServices.ComTypes.STATSTG stat;memory.Stat(out stat,1);if(stat.cbSize<0||stat.cbSize>512*1024)throw new NotSupportedException("Persistence output exceeds 512 KiB");var output=new byte[(int)stat.cbSize];memory.Seek(0,0,IntPtr.Zero);memory.Read(output,output.Length,IntPtr.Zero);return D("data",Convert.ToBase64String(output));
      } finally { if(memory!=null)Marshal.ReleaseComObject(memory); }
    }
    static object Handle(Dictionary<string,object> request) {
      string op=S(request,"op");
      if(op=="init") {
        if(Initialized)throw new InvalidOperationException("Session already initialized");var allowed=A(V(request,"allowed"));var controls=A(V(request,"controls",new object[0]));if(allowed.Length==0||allowed.Length>64)throw new ArgumentException("Provide 1..64 explicit ProgIDs");
        foreach(var item in allowed){var p=item as string;if(p==null||!Name(p))throw new ArgumentException("Invalid ProgID");Allowed.Add(p);}foreach(var item in controls){var p=item as string;if(p==null||!Allowed.Contains(p))throw new ArgumentException("Control activation requires an explicit grant");Controls.Add(p);}Initialized=true;return D("version",1,"bitness",IntPtr.Size*8,"apartment",System.Threading.Thread.CurrentThread.GetApartmentState().ToString());
      }
      if(!Initialized)throw new UnauthorizedAccessException("Initialize an explicitly granted session first");
      if(op=="info"){Application.DoEvents();return D("objects",Objects.Count,"windows",Objects.Values.Count(e=>e.Window!=null&&!e.Window.IsDisposed));}
      if(op=="close"){Quitting=true;return D("closed",true);}
      if(op=="eventReturn")return EventReturn(request);
      if(op=="licenseInfo")return Licensing(S(request,"progId"));
      if(op=="create"){
        string progId=S(request,"progId");if(!Allowed.Contains(progId))throw new UnauthorizedAccessException("ProgID is not allowed: "+progId);bool preview=Convert.ToBoolean(V(request,"preview",false));if(preview&&!Controls.Contains(progId))throw new UnauthorizedAccessException("Native control preview was not granted");
        var type=Type.GetTypeFromProgID(progId,true);CheckKillbit(type.GUID);object value=null;Form window=null;ControlHost control=null;
        try {
          if(preview){window=new Form {Text="VB6 native component — "+progId,Width=640,Height=480};control=new ControlHost(type.GUID,V(request,"licenseKey") as string) {Dock=DockStyle.Fill};((System.ComponentModel.ISupportInitialize)control).BeginInit();window.Controls.Add(control);((System.ComponentModel.ISupportInitialize)control).EndInit();window.Show();Application.DoEvents();value=control.Instance;}
          else value=V(request,"licenseKey")==null?Activator.CreateInstance(type):CreateLicensed(type.GUID,S(request,"licenseKey"));
          var result=Map(Export(value));var entry=ObjectAt(S(result,"id"));entry.Window=window;entry.Control=control;return result;
        }catch{if(window!=null)window.Dispose();else if(value!=null&&Marshal.IsComObject(value))Marshal.FinalReleaseComObject(value);throw;}
      }
      var target=ObjectAt(S(request,"handle"));
      if(op=="release"){Release(S(request,"handle"));return D("released",true);}
      if(op=="advise")return Advise(S(request,"handle"),target);
      if(op=="unadvise"){Unadvise(target);return D("events",0);}
      if(new[]{"controlInfo","showPropertyPages","setControlBounds","controlVisible","controlEnabled","controlFocus"}.Contains(op))return ControlOperation(target,request);
      if(op=="loadState"||op=="saveState")return Persistence(target,request);
      if(op=="enumerate")return EnumerateNative(target,N(request,"lcid",1033));
      if(op!="call")throw new ArgumentException("Unknown Automation operation");
      string member=S(request,"member");int mode=N(request,"mode"),lcid=N(request,"lcid",1033);if(!Name(member)||!new[]{1,2,4,8}.Contains(mode))throw new ArgumentException("Invalid Automation invocation");
      var schema=((Dictionary<string,object>[])target.Metadata["members"]).FirstOrDefault(m=>string.Equals((string)m["name"],member,StringComparison.OrdinalIgnoreCase));
      if(schema==null||!((List<int>)schema["modes"]).Contains(mode))throw new UnauthorizedAccessException("Member/mode not present in exposed Automation metadata");
      var encoded=A(V(request,"args",new object[0]));if(encoded.Length>65)throw new ArgumentException("Too many Automation arguments");
      var byref=A(V(request,"byRef",new object[0]));
      if(lcid<0||lcid>0xfffff)throw new ArgumentException("Invalid LCID");
      var invocationResult=InvokeDirect(target,member,mode,lcid,encoded,byref,schema);
      Application.DoEvents();return invocationResult;
    }
    public static void Run() {
      if(System.Threading.Thread.CurrentThread.GetApartmentState()!=System.Threading.ApartmentState.STA)throw new InvalidOperationException("Automation host requires STA");
      Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);Application.EnableVisualStyles();
      try {
        // Blocking stdin must not freeze ActiveX windows while the client is idle.
        // Bound the reader before allocating an arbitrarily large request string.
        var requests=Requests;
        var reader=new Thread(()=>{try{var buffer=new StringBuilder();int c;while((c=Console.Read())!=-1){if(c=='\n'){requests.Add(buffer.ToString());buffer.Clear();}else if(c!='\r'){if(buffer.Length>=Limit)throw new InvalidDataException("Request too large");buffer.Append((char)c);}}if(buffer.Length>0)requests.Add(buffer.ToString());}catch{Quitting=true;}finally{requests.CompleteAdding();}});
        reader.IsBackground=true;reader.Start();
        while(!Quitting){string line;if(!requests.TryTake(out line,25)){Application.DoEvents();if(requests.IsCompleted)break;continue;}ProcessRequest(line);}

      } finally {foreach(var id in Objects.Keys.ToArray())try{Release(id);}catch{} }
    }
  }
}
