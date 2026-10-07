// Native OLE object lifecycle and in-place operations use the existing owned
// AxHost client site/window. Callers cannot supply arbitrary HWNDs or pointers.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using IEnumSTATDATA=VB6Interop.OleEnumStatData;
namespace VB6Interop {
  [StructLayout(LayoutKind.Sequential)]public struct NativeOleSize {public int Width,Height;}
  [StructLayout(LayoutKind.Sequential)]public struct NativeOleRect {public int Left,Top,Right,Bottom;}
  [StructLayout(LayoutKind.Sequential,CharSet=CharSet.Unicode)]public struct NativeOleVerb {public int Id;[MarshalAs(UnmanagedType.LPWStr)]public string Name;public uint Flags,Attributes;}
  [ComImport,Guid("00000104-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface NativeEnumOleVerb {
    [PreserveSig]int Next(uint count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=0)]NativeOleVerb[] values,out uint fetched);
    [PreserveSig]int Skip(uint count);[PreserveSig]int Reset();void Clone(out NativeEnumOleVerb value);
  }
  [ComImport,Guid("00000112-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface NativeOleObject {
    [PreserveSig]int SetClientSite(IntPtr site);[PreserveSig]int GetClientSite(out IntPtr site);
    [PreserveSig]int SetHostNames([MarshalAs(UnmanagedType.LPWStr)]string application,[MarshalAs(UnmanagedType.LPWStr)]string document);
    [PreserveSig]int Close(uint options);[PreserveSig]int SetMoniker(uint which,IMoniker moniker);[PreserveSig]int GetMoniker(uint assign,uint which,out IMoniker moniker);
    [PreserveSig]int InitFromData(OleDataInterface data,[MarshalAs(UnmanagedType.Bool)]bool creation,uint reserved);
    [PreserveSig]int GetClipboardData(uint reserved,out IntPtr data);
    [PreserveSig]int DoVerb(int verb,IntPtr message,IntPtr site,int index,IntPtr parent,ref NativeOleRect bounds);
    [PreserveSig]int EnumVerbs(out NativeEnumOleVerb enumerator);[PreserveSig]int Update();[PreserveSig]int IsUpToDate();
    [PreserveSig]int GetUserClassID(out Guid id);[PreserveSig]int GetUserType(uint kind,out IntPtr name);
    [PreserveSig]int SetExtent(uint aspect,ref NativeOleSize size);[PreserveSig]int GetExtent(uint aspect,out NativeOleSize size);
    [PreserveSig]int Advise(IAdviseSink sink,out uint cookie);[PreserveSig]int Unadvise(uint cookie);[PreserveSig]int EnumAdvise(out IEnumSTATDATA enumerator);
    [PreserveSig]int GetMiscStatus(uint aspect,out uint status);[PreserveSig]int SetColorScheme(IntPtr palette);
  }
  [ComImport,Guid("00000113-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface NativeOleInPlaceObject {
    [PreserveSig]int GetWindow(out IntPtr window);[PreserveSig]int ContextSensitiveHelp([MarshalAs(UnmanagedType.Bool)]bool enter);
    [PreserveSig]int InPlaceDeactivate();[PreserveSig]int UIDeactivate();[PreserveSig]int SetObjectRects(ref NativeOleRect position,ref NativeOleRect clip);[PreserveSig]int ReactivateAndUndo();
  }
  [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
  public sealed class NativeOleObjectSink:IAdviseSink {
    readonly Action<string,int,int> callback;public NativeOleObjectSink(Action<string,int,int> handler){callback=handler;}
    public void OnDataChange(ref FORMATETC format,ref STGMEDIUM medium){callback("data",0,0);}
    public void OnViewChange(int aspect,int index){callback("view",aspect,index);}public void OnRename(IMoniker moniker){callback("rename",0,0);}
    public void OnSave(){callback("save",0,0);}public void OnClose(){callback("close",0,0);}
  }
  public static partial class AutomationHost {
    sealed class NativeOleConnection {public string Handle;public uint Cookie;public NativeOleObjectSink Sink;}
    static readonly Dictionary<string,NativeOleConnection> NativeOleConnections=new Dictionary<string,NativeOleConnection>();static int NativeOleSequence;
    static void DisconnectNativeOle(string token){NativeOleConnection connection;if(!NativeOleConnections.TryGetValue(token,out connection))throw new ArgumentException("Unknown OLE object advisory connection");NativeOleConnections.Remove(token);Marshal.ThrowExceptionForHR(((NativeOleObject)ObjectAt(connection.Handle).Value).Unadvise(connection.Cookie));}
    static void ReleaseNativeOleConnections(string handle){var errors=new List<Exception>();foreach(var pair in NativeOleConnections.Where(x=>x.Value.Handle==handle).ToArray())try{DisconnectNativeOle(pair.Key);}catch(Exception error){errors.Add(error);}if(errors.Count>0)throw new AggregateException("OLE object advisory cleanup failed",errors);}
    static void RequireOleWindow(Entry entry){if(entry.Window==null||entry.Window.IsDisposed||entry.Control==null)throw new UnauthorizedAccessException("In-place OLE operations require this session's explicitly granted preview window");}
    static string OleLabel(Dictionary<string,object> request,string key){string value=S(request,key);if(value.Length>1024||value.IndexOf('\0')>=0)throw new ArgumentException("Invalid OLE host label");return value;}
    static object NativeOleObjectOperation(Dictionary<string,object> request){
      string op=S(request,"op");if(op=="ole.objectUnadvise"){DisconnectNativeOle(S(request,"connection"));return D("unadvised",true);}
      string handle=S(request,"handle");var entry=ObjectAt(handle);var value=entry.Value as NativeOleObject;if(value==null)throw new COMException("Object does not implement IOleObject",unchecked((int)0x80004002));
      if(op=="ole.objectInfo"){
        Guid clsid;int classHr=value.GetUserClassID(out clsid);uint misc;int miscHr=value.GetMiscStatus(1,out misc);NativeOleSize extent;int sizeHr=value.GetExtent(1,out extent);IntPtr type=IntPtr.Zero;int typeHr=value.GetUserType(1,out type);string userType=null;
        try{if(typeHr>=0&&type!=IntPtr.Zero){userType=Marshal.PtrToStringUni(type);if(userType.Length>2048)userType=userType.Substring(0,2048);}}finally{if(type!=IntPtr.Zero)Marshal.FreeCoTaskMem(type);}
        return D("classId",classHr>=0?clsid.ToString("D"):null,"classHresult",unchecked((uint)classHr),"userType",userType,"typeHresult",unchecked((uint)typeHr),"miscStatus",misc,"miscHresult",unchecked((uint)miscHr),"extent",D("width",extent.Width,"height",extent.Height,"units","HIMETRIC"),"extentHresult",unchecked((uint)sizeHr),"inPlace",entry.Value is NativeOleInPlaceObject,"ownedWindow",entry.Window!=null&&!entry.Window.IsDisposed);
      }
      if(op=="ole.objectVerbs"){
        NativeEnumOleVerb enumerator=null;var verbs=new List<object>();int status=value.EnumVerbs(out enumerator);
        try{if(status>=0&&enumerator!=null){var row=new NativeOleVerb[1];while(true){uint fetched;Marshal.ThrowExceptionForHR(enumerator.Next(1,row,out fetched));if(fetched==0)break;if(fetched!=1||verbs.Count>=256)throw new NotSupportedException("OLE verb enumeration limit");verbs.Add(D("id",row[0].Id,"name",row[0].Name==null?null:row[0].Name.Substring(0,Math.Min(2048,row[0].Name.Length)),"flags",row[0].Flags,"attributes",row[0].Attributes));}}return D("hresult",unchecked((uint)status),"verbs",verbs);}
        finally{if(enumerator!=null&&Marshal.IsComObject(enumerator))Marshal.ReleaseComObject(enumerator);}
      }
      if(op=="ole.objectAdvise"){
        if(NativeOleConnections.Count>=256)throw new NotSupportedException("OLE advisory connection limit");string token="v"+(++NativeOleSequence);var sink=new NativeOleObjectSink((kind,aspect,index)=>QueueComNotification(D("connection",token,"handle",handle,"kind",kind,"aspect",aspect,"index",index)));uint cookie;Marshal.ThrowExceptionForHR(value.Advise(sink,out cookie));NativeOleConnections.Add(token,new NativeOleConnection{Handle=handle,Cookie=cookie,Sink=sink});return D("connection",token);
      }
      if(op=="ole.objectGetData"){IntPtr pointer=IntPtr.Zero;try{Marshal.ThrowExceptionForHR(value.GetClipboardData(0,out pointer));return ExportComPointer(pointer,false);}finally{if(pointer!=IntPtr.Zero)Marshal.Release(pointer);}}
      if(entry.ActiveOperation)throw new InvalidOperationException("Reentrant OLE activation operation");entry.ActiveOperation=true;
      try{
        int hr;
        if(op=="ole.objectDoVerb"){
          RequireOleWindow(entry);int verb=ComInteger(request,"verb",0,int.MinValue,int.MaxValue);IntPtr site=IntPtr.Zero;
          try{Marshal.ThrowExceptionForHR(value.GetClientSite(out site));if(site==IntPtr.Zero)throw new InvalidOperationException("OLE object has no active client site");var bounds=entry.Control.Bounds;var rect=new NativeOleRect{Left=bounds.Left,Top=bounds.Top,Right=bounds.Right,Bottom=bounds.Bottom};hr=value.DoVerb(verb,IntPtr.Zero,site,0,entry.Control.Parent.Handle,ref rect);}finally{if(site!=IntPtr.Zero)Marshal.Release(site);}
        }else if(op=="ole.objectDeactivate"){
          RequireOleWindow(entry);var active=entry.Value as NativeOleInPlaceObject;if(active==null)throw new COMException("No in-place OLE interface",unchecked((int)0x80004002));hr=ComBoolean(request,"uiOnly")?active.UIDeactivate():active.InPlaceDeactivate();
        }else if(op=="ole.objectExtent"){
          uint aspect=(uint)ComInteger(request,"aspect",1,1,8);if(!new uint[]{1,2,4,8}.Contains(aspect))throw new ArgumentException("Invalid OLE aspect");var size=new NativeOleSize{Width=ComInteger(request,"width",0,0,int.MaxValue),Height=ComInteger(request,"height",0,0,int.MaxValue)};hr=value.SetExtent(aspect,ref size);
        }else if(op=="ole.objectNames")hr=value.SetHostNames(OleLabel(request,"application"),OleLabel(request,"document"));
        else if(op=="ole.objectUpdate")hr=value.Update();
        else if(op=="ole.objectIsUpToDate")return D("hresult",unchecked((uint)value.IsUpToDate()));
        else if(op=="ole.objectClose")hr=value.Close((uint)ComInteger(request,"save",1,0,2));
        else if(op=="ole.objectInitFromData"){
          var source=ObjectAt(S(request,"dataHandle")).Value as OleDataInterface;if(source==null)throw new COMException("Source lacks IDataObject",unchecked((int)0x80004002));hr=value.InitFromData(source,ComBoolean(request,"creation"),0);
        }else throw new ArgumentException("Unknown OLE object operation");
        Marshal.ThrowExceptionForHR(hr);System.Windows.Forms.Application.DoEvents();return D("hresult",unchecked((uint)hr));
      }finally{entry.ActiveOperation=false;}
    }
  }
}
