// Native COM service boundary. All registrations and clipboard permissions are
// supplied by trusted embedding code, never inferred from project/reference data.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Windows.Forms;
using NativeDataInterface=VB6Interop.OleDataInterface;
namespace VB6Interop {
  public static partial class AutomationHost {
    static readonly HashSet<string> ActiveObjectGrants=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    static readonly HashSet<string> ActivePublicationGrants=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
    sealed class ActivePublication { public uint Cookie;public string Handle; }
    static readonly Dictionary<string,ActivePublication> ActivePublications=new Dictionary<string,ActivePublication>();
    static int ActivePublicationSequence;
    static bool OleInitialized,ClipboardReadGranted,ClipboardWriteGranted;
    static IntPtr OwnedClipboard=IntPtr.Zero;
    [DllImport("ole32.dll",EntryPoint="OleInitialize")]static extern int NativeOleInitialize(IntPtr reserved);
    [DllImport("ole32.dll",EntryPoint="OleUninitialize")]static extern void NativeOleUninitialize();
    [DllImport("oleaut32.dll",EntryPoint="GetActiveObject")]static extern int NativeGetActiveObject(ref Guid clsid,IntPtr reserved,out IntPtr value);
    [DllImport("oleaut32.dll",EntryPoint="RegisterActiveObject")]static extern int NativeRegisterActiveObject(IntPtr value,ref Guid clsid,uint flags,out uint cookie);
    [DllImport("oleaut32.dll",EntryPoint="RevokeActiveObject")]static extern int NativeRevokeActiveObject(uint cookie,IntPtr reserved);
    [DllImport("ole32.dll",EntryPoint="OleSetClipboard")]static extern int NativeOleSetClipboard(IntPtr value);
    [DllImport("ole32.dll",EntryPoint="OleGetClipboard")]static extern int NativeOleGetClipboard(out IntPtr value);
    [DllImport("ole32.dll",EntryPoint="OleIsCurrentClipboard")]static extern int NativeOleIsCurrentClipboard(IntPtr value);
    [DllImport("ole32.dll",EntryPoint="OleFlushClipboard")]static extern int NativeOleFlushClipboard();
    static bool ComBoolean(Dictionary<string,object> request,string name,bool fallback=false){object value=V(request,name,fallback);if(!(value is bool))throw new ArgumentException("Expected Boolean: "+name);return (bool)value;}
    static int ComInteger(Dictionary<string,object> request,string name,int fallback,int min,int max){object value=V(request,name,fallback);if(!(value is int)&&!(value is long))throw new ArgumentException("Expected integer: "+name);long n=Convert.ToInt64(value);if(n<min||n>max)throw new ArgumentException("Integer outside bounds: "+name);return (int)n;}
    static Guid ComGuid(string value){Guid result;if(!(Guid.TryParseExact(value,"D",out result)||Guid.TryParseExact(value,"B",out result)))throw new ArgumentException("Expected a canonical GUID");return result;}
    static void InitializeComOle(Dictionary<string,object> request,HashSet<string> allowed){
      var options=Map(V(request,"comOle",new Dictionary<string,object>()));
      if(options.Keys.Any(k=>!new[]{"activeObjects","publishActiveObjects","clipboardRead","clipboardWrite"}.Contains(k)))throw new ArgumentException("Unknown COM/OLE grant");
      var active=new HashSet<string>(StringComparer.OrdinalIgnoreCase);var publish=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      foreach(var pair in new[]{new KeyValuePair<string,HashSet<string>>("activeObjects",active),new KeyValuePair<string,HashSet<string>>("publishActiveObjects",publish)}){
        var grants=A(V(options,pair.Key,new object[0]));if(grants.Length>64)throw new ArgumentException("COM grant limit");
        foreach(var item in grants){var name=item as string;if(name==null||!allowed.Contains(name)||!pair.Value.Add(name))throw new UnauthorizedAccessException("Active object grants must be distinct allowed ProgIDs");}
      }
      bool read=ComBoolean(options,"clipboardRead"),write=ComBoolean(options,"clipboardWrite");
      Marshal.ThrowExceptionForHR(NativeOleInitialize(IntPtr.Zero));OleInitialized=true;
      ActiveObjectGrants.UnionWith(active);ActivePublicationGrants.UnionWith(publish);ClipboardReadGranted=read;ClipboardWriteGranted=write;
    }
    // Consume no references here. The caller releases the acquired native pointer.
    // Canonical identity is checked BEFORE creating another RCW, avoiding identity-cache leaks.
    static object ExportComPointer(IntPtr pointer,bool requireDispatch){
      if(pointer==IntPtr.Zero)throw new COMException("Component returned a null interface",unchecked((int)0x80004003));
      IntPtr unknown=IntPtr.Zero;var iid=new Guid("00000000-0000-0000-C000-000000000046");
      Marshal.ThrowExceptionForHR(Marshal.QueryInterface(pointer,ref iid,out unknown));
      try{string id;if(Identities.TryGetValue(unknown.ToInt64(),out id))return D("t","object","id",id,"metadata",Objects[id].Metadata);
        object value=Marshal.GetObjectForIUnknown(pointer);bool adopted=false;
        try{object result=requireDispatch?Export(value):ExportNativeData(value);adopted=true;return result;}
        finally{if(!adopted&&Marshal.IsComObject(value))Marshal.ReleaseComObject(value);}
      }finally{Marshal.Release(unknown);}
    }
    static object ExportNativeData(object value){
      if(!(value is NativeDataInterface))throw new COMException("Object does not implement IDataObject",unchecked((int)0x80004002));
      IntPtr unknown=Marshal.GetIUnknownForObject(value);
      try{string id;Entry entry;if(Identities.TryGetValue(unknown.ToInt64(),out id))entry=Objects[id];else{
        if(Objects.Count>=MaxObjects)throw new NotSupportedException("Native object limit exceeded");
        id="o"+(++Sequence);entry=new Entry {Value=value,Identity=unknown.ToInt64(),Metadata=D("members",new Dictionary<string,object>[0],"events",new object[0],"eventInterfaces",new object[0],"defaultMember",null,"dataObject",true)};Objects.Add(id,entry);Identities.Add(entry.Identity,id);
      }return D("t","object","id",id,"metadata",entry.Metadata);}finally{Marshal.Release(unknown);}
    }
    static object NativeInterfaceInfo(Entry entry,Dictionary<string,object> request){
      var names=A(V(request,"iids"));if(names.Length>64)throw new ArgumentException("Interface query limit");var ids=names.Select(x=>ComGuid(x as string)).ToArray();
      var results=new List<object>();IntPtr unknown=Marshal.GetIUnknownForObject(entry.Value);
      try{foreach(var input in ids){var iid=input;IntPtr view=IntPtr.Zero,identity=IntPtr.Zero;int hr=Marshal.QueryInterface(unknown,ref iid,out view);bool same=false;
        try{if(hr>=0&&view!=IntPtr.Zero){var canonical=new Guid("00000000-0000-0000-C000-000000000046");Marshal.ThrowExceptionForHR(Marshal.QueryInterface(view,ref canonical,out identity));same=identity==unknown;}
          results.Add(D("iid",iid.ToString("D"),"hresult",unchecked((uint)hr),"supported",hr>=0&&view!=IntPtr.Zero,"sameIdentity",same));
        }finally{if(identity!=IntPtr.Zero)Marshal.Release(identity);if(view!=IntPtr.Zero)Marshal.Release(view);}
      }return results;}finally{Marshal.Release(unknown);}
    }
    static void RevokePublication(string token){ActivePublication entry;if(!ActivePublications.TryGetValue(token,out entry))throw new ArgumentException("Unknown active-object registration");Marshal.ThrowExceptionForHR(NativeRevokeActiveObject(entry.Cookie,IntPtr.Zero));ActivePublications.Remove(token);}
    static void ReleaseComOleResources(string handle){
      var errors=new List<Exception>();foreach(var item in ActivePublications.Where(x=>x.Value.Handle==handle).ToArray())try{RevokePublication(item.Key);}catch(Exception error){errors.Add(error);}
      try{ReleaseNativeDataConnections(handle);}catch(Exception error){errors.Add(error);}try{ReleaseNativeOleConnections(handle);}catch(Exception error){errors.Add(error);}if(errors.Count>0)throw new AggregateException("COM/OLE resource cleanup failed",errors);
    }
    static void CloseComOle(){
      try{if(OwnedClipboard!=IntPtr.Zero){try{if(NativeOleIsCurrentClipboard(OwnedClipboard)==0)Marshal.ThrowExceptionForHR(NativeOleFlushClipboard());}finally{Marshal.Release(OwnedClipboard);OwnedClipboard=IntPtr.Zero;}}}
      finally{if(OleInitialized){NativeOleUninitialize();OleInitialized=false;}}
    }
    static bool TryComOle(Dictionary<string,object> request,out object result){
      // Error information belongs to a logical COM thread. An earlier request
      // must not replace the HRESULT/diagnostic returned by the next provider.
      BeginBrowsingCall();
      string op=S(request,"op");result=null;
      if(op=="com.getActive"){
        string name=S(request,"progId");if(!ActiveObjectGrants.Contains(name))throw new UnauthorizedAccessException("Existing-object access was not granted");
        var type=Type.GetTypeFromProgID(name,true);var clsid=type.GUID;CheckKillbit(clsid);IntPtr pointer=IntPtr.Zero;
        try{Marshal.ThrowExceptionForHR(NativeGetActiveObject(ref clsid,IntPtr.Zero,out pointer));result=ExportComPointer(pointer,true);return true;}finally{if(pointer!=IntPtr.Zero)Marshal.Release(pointer);}
      }
      if(op=="com.publishActive"){
        string name=S(request,"progId"),handle=S(request,"handle");if(!ActivePublicationGrants.Contains(name))throw new UnauthorizedAccessException("Active-object publication was not granted");
        var target=ObjectAt(handle);var clsid=Type.GetTypeFromProgID(name,true).GUID;CheckKillbit(clsid);
        if(target.ActivationClassId!=clsid)throw new UnauthorizedAccessException("Only this session's explicitly created class can be published");
        if(ActivePublications.Count>=64)throw new NotSupportedException("Active registration limit");IntPtr existing=IntPtr.Zero;int status=NativeGetActiveObject(ref clsid,IntPtr.Zero,out existing);
        if(existing!=IntPtr.Zero)Marshal.Release(existing);if(status>=0)throw new InvalidOperationException("An active object already exists for this class; it will not be replaced");
        if(status!=unchecked((int)0x800401E3))Marshal.ThrowExceptionForHR(status);
        IntPtr pointer=Marshal.GetIUnknownForObject(target.Value);try{uint cookie;Marshal.ThrowExceptionForHR(NativeRegisterActiveObject(pointer,ref clsid,ComBoolean(request,"weak")?1u:0u,out cookie));string token="a"+(++ActivePublicationSequence);ActivePublications.Add(token,new ActivePublication{Cookie=cookie,Handle=handle});result=D("registration",token);return true;}finally{Marshal.Release(pointer);}
      }
      if(op=="com.revokeActive"){RevokePublication(S(request,"registration"));result=D("revoked",true);return true;}
      if(op=="com.interfaces"){result=NativeInterfaceInfo(ObjectAt(S(request,"handle")),request);return true;}
      if(op=="ole.clipboardGet"){
        if(!ClipboardReadGranted)throw new UnauthorizedAccessException("System clipboard read was not granted");IntPtr pointer=IntPtr.Zero;
        try{Marshal.ThrowExceptionForHR(NativeOleGetClipboard(out pointer));result=ExportComPointer(pointer,false);return true;}finally{if(pointer!=IntPtr.Zero)Marshal.Release(pointer);}
      }
      if(op=="ole.clipboardSet"){
        if(!ClipboardWriteGranted)throw new UnauthorizedAccessException("System clipboard write was not granted");IntPtr next=IntPtr.Zero;
        if(V(request,"handle")!=null){var target=ObjectAt(S(request,"handle"));next=Marshal.GetComInterfaceForObject(target.Value,typeof(NativeDataInterface));}
        try{Marshal.ThrowExceptionForHR(NativeOleSetClipboard(next));if(OwnedClipboard!=IntPtr.Zero)Marshal.Release(OwnedClipboard);OwnedClipboard=next;next=IntPtr.Zero;result=D("set",true);return true;}finally{if(next!=IntPtr.Zero)Marshal.Release(next);}
      }
      if(op=="ole.clipboardFlush"){
        if(!ClipboardWriteGranted)throw new UnauthorizedAccessException("System clipboard write was not granted");if(OwnedClipboard==IntPtr.Zero||NativeOleIsCurrentClipboard(OwnedClipboard)!=0)throw new InvalidOperationException("Only this session's current clipboard object can be flushed");
        Marshal.ThrowExceptionForHR(NativeOleFlushClipboard());Marshal.Release(OwnedClipboard);OwnedClipboard=IntPtr.Zero;result=D("flushed",true);return true;
      }
      if(op=="ole.clipboardCurrent"){
        if(!ClipboardWriteGranted)throw new UnauthorizedAccessException("System clipboard ownership checks require write permission");result=D("current",OwnedClipboard!=IntPtr.Zero&&NativeOleIsCurrentClipboard(OwnedClipboard)==0);return true;
      }
      if(op.StartsWith("ole.data",StringComparison.Ordinal)){result=NativeDataOperation(request);return true;}
      if(op.StartsWith("ole.object",StringComparison.Ordinal)){result=NativeOleObjectOperation(request);return true;}
      if(op.StartsWith("ole.storage",StringComparison.Ordinal)){result=NativeStorageOperation(request);return true;}
      return false;
    }
  }
}
