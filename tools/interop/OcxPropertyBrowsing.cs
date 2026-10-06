// Native per-property editor metadata. Windows SDK IPerPropertyBrowsing (ocidl.h).
// https://learn.microsoft.com/windows/win32/api/ocidl/nn-ocidl-iperpropertybrowsing
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
namespace VB6Interop {
  [StructLayout(LayoutKind.Sequential)]
  public struct OcxCountedArray { public uint Count; public IntPtr Values; }
  [ComVisible(true),ComImport,Guid("376BD3AA-3845-101B-84ED-08002B2EC713"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface OcxPerPropertyBrowsing {
    [PreserveSig] int GetDisplayString(int dispid,out IntPtr text);
    [PreserveSig] int MapPropertyToPage(int dispid,out Guid page);
    [PreserveSig] int GetPredefinedStrings(int dispid,out OcxCountedArray strings,out OcxCountedArray cookies);
    [PreserveSig] int GetPredefinedValue(int dispid,uint cookie,IntPtr value);
  }
  public static partial class AutomationHost {
    const int BrowsingNotImplemented=unchecked((int)0x80004001);
    const int BrowsingUnexpected=unchecked((int)0x8000FFFF);
    [DllImport("oleaut32.dll",EntryPoint="SetErrorInfo")]
    static extern int SetBrowsingErrorInfo(uint reserved,IntPtr errorInfo);
    static void BeginBrowsingCall() {
      // IErrorInfo belongs to a logical thread, not to a particular COM object.
      // Clear an unconsumed previous failure before calling the next provider,
      // then retain any fresh diagnostic produced by that provider.
      Marshal.ThrowExceptionForHR(SetBrowsingErrorInfo(0,IntPtr.Zero),new IntPtr(-1));
    }
    static bool BrowsingSucceeded(int hr) {
      if(hr==BrowsingNotImplemented){BeginBrowsingCall();return false;}
      if(hr<0)Marshal.ThrowExceptionForHR(hr);
      if(hr!=0)throw new COMException("Unexpected IPerPropertyBrowsing success code",BrowsingUnexpected);
      return true;
    }
    static string BrowsingString(IntPtr pointer,bool bstr) {
      if(pointer==IntPtr.Zero){if(bstr)return "";throw new COMException("Null predefined property label",BrowsingUnexpected);}
      if(bstr){
        int bytes=Marshal.ReadInt32(pointer,-4);
        if(bytes<0||(bytes&1)!=0||bytes>8192)throw new NotSupportedException("OCX display label exceeds 4096 UTF-16 units");
        return Marshal.PtrToStringBSTR(pointer);
      }
      for(int i=0;i<=4096;i++)if(Marshal.ReadInt16(pointer,i*2)==0)return Marshal.PtrToStringUni(pointer,i);
      throw new NotSupportedException("OCX predefined label exceeds 4096 UTF-16 units");
    }
    static void FreeBrowsingArrays(OcxCountedArray strings,OcxCountedArray cookies) {
      // Successful native calls transfer *all* allocations. Processing limits do
      // not excuse leaving the remaining strings allocated when rejecting a list.
      try {
        if(strings.Values!=IntPtr.Zero)for(uint i=0;i<strings.Count;i++) {
          IntPtr slot=new IntPtr(checked(strings.Values.ToInt64()+(long)i*IntPtr.Size));
          Marshal.FreeCoTaskMem(Marshal.ReadIntPtr(slot));
        }
      } finally { Marshal.FreeCoTaskMem(strings.Values);Marshal.FreeCoTaskMem(cookies.Values); }
    }
    static Dictionary<string,object> ReadPropertyBrowsing(object value,int dispid) {
      var browser=value as OcxPerPropertyBrowsing;
      if(browser==null)return D("supported",false);
      string display=null;IntPtr text;BeginBrowsingCall();int hr=browser.GetDisplayString(dispid,out text);
      bool hasDisplay=BrowsingSucceeded(hr);
      if(hasDisplay)try{display=BrowsingString(text,true);}finally{Marshal.FreeBSTR(text);}
      Guid page;BeginBrowsingCall();bool hasPage=BrowsingSucceeded(browser.MapPropertyToPage(dispid,out page));
      OcxCountedArray strings,cookies;
      // On failure the SDK explicitly leaves counted-array outputs undefined.
      // Never inspect/free those undefined pointers after E_NOTIMPL or failure.
      BeginBrowsingCall();bool hasChoices=BrowsingSucceeded(browser.GetPredefinedStrings(dispid,out strings,out cookies));
      var choices=new List<object>();
      if(hasChoices)try {
        if(strings.Count!=cookies.Count)throw new COMException("Mismatched OCX labels and cookies",BrowsingUnexpected);
        if(strings.Count>256)throw new NotSupportedException("OCX predefined list exceeds 256 entries");
        if(strings.Count!=0&&(strings.Values==IntPtr.Zero||cookies.Values==IntPtr.Zero))throw new COMException("Missing OCX predefined array",BrowsingUnexpected);
        int bytes=0;
        for(int i=0;i<(int)strings.Count;i++) {
          string label=BrowsingString(Marshal.ReadIntPtr(strings.Values,i*IntPtr.Size),false);
          uint cookie=unchecked((uint)Marshal.ReadInt32(cookies.Values,i*4));
          var variant=NewVariant();
          try {
            // A list with an unresolvable choice is not a complete editor model.
            BeginBrowsingCall();if(!BrowsingSucceeded(browser.GetPredefinedValue(dispid,cookie,variant)))throw new NotSupportedException("OCX advertises a predefined choice without its value");
            // Never adopt new native object handles through a metadata query.
            object wire=ExportNative(variant,0,true);
            var choice=D("label",label,"cookie",cookie,"value",wire);
            bytes+=System.Text.Encoding.UTF8.GetByteCount(Json.Serialize(choice));
            if(bytes>256*1024)throw new NotSupportedException("OCX predefined values exceed 256 KiB");
            choices.Add(choice);
          } finally { FreeVariant(variant); }
        }
      } finally { FreeBrowsingArrays(strings,cookies); }
      return D("supported",true,"displaySupported",hasDisplay,"display",display,
        "pageSupported",hasPage,"page",hasPage&&page!=Guid.Empty?page.ToString():null,
        "predefinedSupported",hasChoices,"predefined",choices.ToArray());
    }
    static int BrowsingPropertyId(Entry entry,string name,int lcid) {
      if(!Name(name))throw new ArgumentException("Invalid OCX property name");
      var member=((Dictionary<string,object>[])entry.Metadata["members"]).FirstOrDefault(m=>string.Equals((string)m["name"],name,StringComparison.OrdinalIgnoreCase));
      if(member==null||!((List<int>)member["modes"]).Any(mode=>mode==2||mode==4||mode==8))throw new UnauthorizedAccessException("Property is not present in exposed Automation metadata");
      var ids=new int[1];var empty=Guid.Empty;
      BeginBrowsingCall();Marshal.ThrowExceptionForHR(((DispatchInvoke)entry.Value).GetIDsOfNames(ref empty,new[]{name},1,(uint)lcid,ids));
      return ids[0];
    }
    static object BrowseControlProperty(Entry entry,Dictionary<string,object> request) {
      if(request.Keys.Any(key=>!new[]{"op","id","handle","eventToken","member","lcid"}.Contains(key)))throw new ArgumentException("Unexpected OCX property query field");
      if(entry.Control==null||entry.Window==null||entry.Window.IsDisposed)throw new NotSupportedException("Object is not an active hosted OCX");
      if(entry.ActiveOperation)throw new InvalidOperationException("An OCX control operation is already in progress");
      int lcid=ActiveInteger(request,"lcid",0,0xfffff,1033);string name=S(request,"member");
      entry.ActiveOperation=true;
      try {return ReadPropertyBrowsing(entry.Value,BrowsingPropertyId(entry,name,lcid));}
      finally {entry.ActiveOperation=false;}
    }
  }
}
