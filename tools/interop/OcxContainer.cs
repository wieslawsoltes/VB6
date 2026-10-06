// Native host-only ambient state, keyboard mnemonics and property notifications.
using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Windows.Forms;
namespace VB6Interop {
  [StructLayout(LayoutKind.Sequential)]struct OcxControlInfo {public uint Size;public IntPtr Accelerators;public ushort Count;public uint Flags;}
  [StructLayout(LayoutKind.Sequential)]struct OcxMessage {public IntPtr Window;public uint Message;public UIntPtr WParam;public IntPtr LParam;public uint Time;public int X,Y;public uint Private;}
  [ComImport,Guid("B196B288-BAB4-101A-B69C-00AA00341D07"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface OcxOleControl {
    void GetControlInfo(ref OcxControlInfo info);void OnMnemonic(ref OcxMessage message);void OnAmbientPropertyChange(int dispid);void FreezeEvents([MarshalAs(UnmanagedType.Bool)]bool frozen);
  }
  [ComVisible(true),Guid("9BFBBC02-EFF1-101A-84ED-00AA00341D07"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface OcxPropertyNotify {
    [PreserveSig]int OnChanged(int dispid);[PreserveSig]int OnRequestEdit(int dispid);
  }
  sealed class OcxComponentSite:ISite {
    readonly IComponent component;public bool IsDesignMode;
    public OcxComponentSite(IComponent value,bool design){component=value;IsDesignMode=design;}
    public IComponent Component{get{return component;}}public IContainer Container{get{return null;}}
    public bool DesignMode{get{return IsDesignMode;}}public string Name{get;set;}
    public object GetService(Type type){return type==typeof(ISite)?this:null;}
  }
  sealed class OcxPropertyConnection {public IConnectionPoint Point;public int Cookie;public object Sink;}
  public static partial class AutomationHost {
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    public sealed class PropertyNotifyBridge:OcxPropertyNotify {
      readonly string handle;
      public PropertyNotifyBridge(string id){handle=id;}
      public int OnChanged(int dispid){try{RaiseComEvent(handle,"Changed",new object[]{dispid},null,"property");return 0;}catch(Exception error){return Marshal.GetHRForException(error);}}
      public int OnRequestEdit(int dispid){try{var reply=RaiseComEvent(handle,"RequestEdit",new object[]{dispid,true},null,"property");return Convert.ToBoolean(reply[1],CultureInfo.InvariantCulture)?0:1;}catch(Exception error){return Marshal.GetHRForException(error);}}
    }
    static object ObserveProperties(string handle,Entry entry){
      if(entry.PropertyConnection!=null)return D("observing",true);
      var container=entry.Value as IConnectionPointContainer;if(container==null)throw new NotSupportedException("OCX has no connection-point container");
      IConnectionPoint point;var iid=typeof(OcxPropertyNotify).GUID;container.FindConnectionPoint(ref iid,out point);var sink=new PropertyNotifyBridge(handle);int cookie;
      try{point.Advise(sink,out cookie);}catch{Marshal.ReleaseComObject(point);throw;}
      entry.PropertyConnection=new OcxPropertyConnection{Point=point,Cookie=cookie,Sink=sink};return D("observing",true);
    }
    static void StopObserving(Entry entry){
      var connection=entry.PropertyConnection;if(connection==null)return;entry.PropertyConnection=null;
      try{connection.Point.Unadvise(connection.Cookie);}finally{Marshal.ReleaseComObject(connection.Point);connection.Sink=null;}
    }
    static int CheckedOleColor(object value){long color=Convert.ToInt64(value,CultureInfo.InvariantCulture);if(color<int.MinValue||color>uint.MaxValue)throw new ArgumentException("Invalid OLE_COLOR");return unchecked((int)color);}
    static object ExtendedControlOperation(string handle,Entry entry,Dictionary<string,object> request){
      string op=S(request,"op");
      if(op=="observeProperties")return ObserveProperties(handle,entry);
      if(op=="stopObservingProperties"){StopObserving(entry);return D("observing",false);}
      if(entry.Control==null||entry.Window==null||entry.Window.IsDisposed)throw new NotSupportedException("Object is not an active hosted OCX");
      var ole=entry.Value as OcxOleControl;
      if(op=="controlDesignMode"){
        bool design=Convert.ToBoolean(V(request,"design"));var site=entry.Control.Site as OcxComponentSite;
        if(site==null)throw new NotSupportedException("The OCX has no mutable design site");
        site.IsDesignMode=design;entry.DesignMode=design;entry.Control.HostDesignMode=design;
        if(ole!=null)ole.OnAmbientPropertyChange(-709);return D("designMode",design);
      }
      if(op=="controlFreezeEvents"){
        bool freeze=Convert.ToBoolean(V(request,"freeze"));int depth=entry.FreezeDepth+(freeze?1:-1);
        if(depth<0||depth>256)throw new ArgumentException("Unbalanced or excessive event freeze depth");
        if(ole==null)throw new NotSupportedException("The OCX has no IOleControl interface");
        if((depth==0)!=(entry.FreezeDepth==0))ole.FreezeEvents(depth>0);entry.FreezeDepth=depth;return D("depth",depth);
      }
      if(op=="controlKeyboardInfo"){
        if(ole==null)throw new NotSupportedException("The OCX has no IOleControl interface");
        var info=new OcxControlInfo{Size=(uint)Marshal.SizeOf(typeof(OcxControlInfo))};ole.GetControlInfo(ref info);
        return D("mnemonics",info.Count,"eatsReturn",(info.Flags&1)!=0,"eatsEscape",(info.Flags&2)!=0);
      }
      if(op=="controlMnemonic"){
        if(ole==null)throw new NotSupportedException("The OCX has no IOleControl interface");int key=N(request,"character");if(key<1||key>65535)throw new ArgumentException("Mnemonic must be one UTF-16 character");
        if(entry.DesignMode||!entry.Control.Enabled)return D("delivered",false);
        var message=new OcxMessage{Window=entry.Control.Handle,Message=0x106,WParam=new UIntPtr((uint)key),LParam=new IntPtr(1<<29),Time=0,X=0,Y=0,Private=0};ole.OnMnemonic(ref message);return D("delivered",true);
      }
      if(op=="controlAmbient"){
        var changes=Map(V(request,"properties"));if(changes.Count>3)throw new ArgumentException("Unsupported native ambient property set");
        var back=entry.Control.BackColor;var fore=entry.Control.ForeColor;string fontName=null;float fontSize=0;byte fontCharset=0;FontStyle fontStyle=FontStyle.Regular;
        // Validate the entire update before touching native state. Existing fonts
        // remain owned by WinForms; only fonts allocated by this host are disposed.
        foreach(var pair in changes){
          if(pair.Key=="BackColor")back=ColorTranslator.FromOle(CheckedOleColor(pair.Value));
          else if(pair.Key=="ForeColor")fore=ColorTranslator.FromOle(CheckedOleColor(pair.Value));
          else if(pair.Key=="Font"){
            var font=Map(pair.Value);if(font.Keys.Any(key=>!new[]{"Name","Size","Bold","Italic","Underline","Strikethrough","Charset","Weight"}.Contains(key)))throw new ArgumentException("Unknown ambient font member");fontCharset=checked((byte)N(font,"Charset",0));int weight=N(font,"Weight",400);if(weight<0||weight>1000)throw new ArgumentException("Invalid font weight");fontName=S(font,"Name");fontSize=Convert.ToSingle(V(font,"Size",8.25),CultureInfo.InvariantCulture);
            if(fontName.Length<1||fontName.Length>255||float.IsNaN(fontSize)||float.IsInfinity(fontSize)||fontSize<=0||fontSize>10000)throw new ArgumentException("Invalid ambient font");
            bool bold=Convert.ToBoolean(V(font,"Bold",false));if(weight!=(bold?700:400))throw new NotSupportedException("Native WinForms hosting supports only consistent normal/400 and bold/700 font weights");
            if(bold)fontStyle|=FontStyle.Bold;if(Convert.ToBoolean(V(font,"Italic",false)))fontStyle|=FontStyle.Italic;
            if(Convert.ToBoolean(V(font,"Underline",false)))fontStyle|=FontStyle.Underline;if(Convert.ToBoolean(V(font,"Strikethrough",false)))fontStyle|=FontStyle.Strikeout;
          }else throw new NotSupportedException("Native ambient update not supported: "+pair.Key);
        }
        Font replacement=fontName==null?null:new Font(fontName,fontSize,fontStyle,GraphicsUnit.Point,fontCharset);
        try{if(changes.ContainsKey("BackColor"))entry.Control.BackColor=back;if(changes.ContainsKey("ForeColor"))entry.Control.ForeColor=fore;
          if(replacement!=null){entry.Control.Font=replacement;var old=entry.OwnedFont;entry.OwnedFont=replacement;replacement=null;if(old!=null)old.Dispose();}
        }finally{if(replacement!=null)replacement.Dispose();}
        return D("updated",new List<string>(changes.Keys).ToArray());
      }
      throw new ArgumentException("Unknown extended OCX operation");
    }
  }
}
