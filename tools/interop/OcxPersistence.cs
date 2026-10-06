// Additional native OCX persistence contracts. No filenames, network access,
// component installation or executable object references are accepted as state.
// https://learn.microsoft.com/windows/win32/com/persistence-interfaces
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using System.Text;
using EXCEPINFO = System.Runtime.InteropServices.ComTypes.EXCEPINFO;
using STATSTG = System.Runtime.InteropServices.ComTypes.STATSTG;
namespace VB6Interop {
  [ComVisible(true),Guid("3127CA40-446E-11CE-8135-00AA004BB851"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface OcxErrorLog { [PreserveSig]int AddError([MarshalAs(UnmanagedType.LPWStr)]string name,ref EXCEPINFO detail); }
  [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
  public sealed class OcxPersistenceErrorLog:OcxErrorLog {
    public readonly List<object> Errors=new List<object>();
    static string Limit(string text){return text==null?null:text.Substring(0,Math.Min(text.Length,2048));}
    public int AddError(string name,ref EXCEPINFO detail){
      if(Errors.Count>=256)return unchecked((int)0x8007000E);
      Errors.Add(new Dictionary<string,object>{{"name",Limit(name)},{"hresult",detail.scode},{"code",detail.wCode},{"source",Limit(detail.bstrSource)},{"description",Limit(detail.bstrDescription)},{"helpFile",Limit(detail.bstrHelpFile)},{"helpContext",detail.dwHelpContext}});return 0;
    }
  }
  [ComVisible(true),Guid("55272A00-42CB-11CE-8135-00AA004BB851"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface OcxPropertyBagNative {
    [PreserveSig] int Read([MarshalAs(UnmanagedType.LPWStr)]string name,IntPtr value,IntPtr errorLog);
    [PreserveSig] int Write([MarshalAs(UnmanagedType.LPWStr)]string name,IntPtr value);
  }
  [StructLayout(LayoutKind.Sequential)]
  public struct OcxPropertyInfo {public uint Type;public ushort VariantType,ClipboardType;public uint Hint;public IntPtr Name;public Guid ClassId;}
  [ComVisible(true),Guid("22F55882-280B-11D0-A8A9-00A0C90C2004"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface OcxPropertyBag2Native {
    [PreserveSig] int Read(uint count,IntPtr properties,IntPtr errorLog,IntPtr values,IntPtr errors);
    [PreserveSig] int Write(uint count,IntPtr properties,IntPtr values);
    [PreserveSig] int CountProperties(out uint count);
    [PreserveSig] int GetPropertyInfo(uint start,uint count,IntPtr properties,out uint returned);
    [PreserveSig] int LoadObject([MarshalAs(UnmanagedType.LPWStr)]string name,uint hint,[MarshalAs(UnmanagedType.IUnknown)]object value,IntPtr errorLog);
  }
  [ComImport,Guid("37D84F60-42CB-11CE-8135-00AA004BB851"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface OcxPersistPropertyBag {
    void GetClassID(out Guid id);void InitNew();
    void Load(OcxPropertyBagNative bag,IntPtr errorLog);
    void Save(OcxPropertyBagNative bag,[MarshalAs(UnmanagedType.Bool)]bool clearDirty,[MarshalAs(UnmanagedType.Bool)]bool saveAll);
  }
  [ComImport,Guid("22F55881-280B-11D0-A8A9-00A0C90C2004"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface OcxPersistPropertyBag2 {
    void GetClassID(out Guid id);void InitNew();void Load(OcxPropertyBag2Native bag,IntPtr errorLog);
    void Save(OcxPropertyBag2Native bag,[MarshalAs(UnmanagedType.Bool)]bool clearDirty,[MarshalAs(UnmanagedType.Bool)]bool saveAll);
    [PreserveSig]int IsDirty();
  }
  [ComImport,Guid("0000010A-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface OcxPersistStorage {
    void GetClassID(out Guid id);[PreserveSig]int IsDirty();void InitNew(OcxStorage storage);void Load(OcxStorage storage);
    void Save(OcxStorage storage,[MarshalAs(UnmanagedType.Bool)]bool sameAsLoad);void SaveCompleted(OcxStorage storage);void HandsOffStorage();
  }
  [ComImport,Guid("0000000A-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface OcxLockBytes {
    void ReadAt(long offset,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]byte[] data,int count,out int read);
    void WriteAt(long offset,[In,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=2)]byte[] data,int count,out int written);
    void Flush();void SetSize(long size);void LockRegion(long offset,long count,int type);void UnlockRegion(long offset,long count,int type);void Stat(out STATSTG stat,int flags);
  }
  [ComImport,Guid("0000000B-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface OcxStorage {
    void CreateStream([MarshalAs(UnmanagedType.LPWStr)]string name,uint mode,uint reserved1,uint reserved2,out IStream stream);
    void OpenStream([MarshalAs(UnmanagedType.LPWStr)]string name,IntPtr reserved1,uint mode,uint reserved2,out IStream stream);
    void CreateStorage([MarshalAs(UnmanagedType.LPWStr)]string name,uint mode,uint reserved1,uint reserved2,out OcxStorage storage);
    void OpenStorage([MarshalAs(UnmanagedType.LPWStr)]string name,OcxStorage priority,uint mode,IntPtr exclude,uint reserved,out OcxStorage storage);
    void CopyTo(uint count,IntPtr excludeInterfaces,IntPtr excludeNames,OcxStorage target);
    void MoveElementTo([MarshalAs(UnmanagedType.LPWStr)]string name,OcxStorage target,[MarshalAs(UnmanagedType.LPWStr)]string newName,uint flags);
    void Commit(uint flags);void Revert();void EnumElements(uint reserved1,IntPtr reserved2,uint reserved3,out IEnumSTATSTG enumerator);
    void DestroyElement([MarshalAs(UnmanagedType.LPWStr)]string name);
    void RenameElement([MarshalAs(UnmanagedType.LPWStr)]string oldName,[MarshalAs(UnmanagedType.LPWStr)]string newName);
    void SetElementTimes([MarshalAs(UnmanagedType.LPWStr)]string name,IntPtr created,IntPtr accessed,IntPtr modified);
    void SetClass(ref Guid id);void SetStateBits(uint state,uint mask);void Stat(out STATSTG stat,uint flags);
  }
  // ComTypes does not expose IEnumSTATSTG on every supported .NET Framework.
  [ComImport,Guid("0000000D-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface IEnumSTATSTG { [PreserveSig]int Next(uint count,IntPtr values,out uint fetched);void Skip(uint count);void Reset();void Clone(out IEnumSTATSTG value); }
  public static partial class AutomationHost {
    const int PersistenceLimit=512*1024;
    [DllImport("ole32.dll")]static extern int CreateILockBytesOnHGlobal(IntPtr memory,[MarshalAs(UnmanagedType.Bool)]bool delete,out OcxLockBytes bytes);
    [DllImport("ole32.dll")]static extern int StgCreateDocfileOnILockBytes(OcxLockBytes bytes,uint mode,uint reserved,out OcxStorage storage);
    [DllImport("ole32.dll")]static extern int StgOpenStorageOnILockBytes(OcxLockBytes bytes,OcxStorage priority,uint mode,IntPtr exclude,uint reserved,out OcxStorage storage);
    static string PersistenceFormat(Entry entry,Dictionary<string,object> request){
      string format=V(request,"format","auto") as string;
      if(format=="auto")format=entry.Value is PersistStreamInit||entry.Value is PersistStream?"stream":entry.Value is OcxPersistPropertyBag2?"propertyBag2":entry.Value is OcxPersistPropertyBag?"propertyBag":entry.Value is OcxPersistStorage?"storage":"none";
      if(!new[]{"stream","propertyBag","propertyBag2","storage"}.Contains(format))throw new NotSupportedException("Unsupported OCX persistence format: "+format);return format;
    }
    static object PersistenceCapabilities(object value){return D("stream",value is PersistStream||value is PersistStreamInit,"streamInit",value is PersistStreamInit,"propertyBag",value is OcxPersistPropertyBag,"propertyBag2",value is OcxPersistPropertyBag2,"storage",value is OcxPersistStorage,"maxBytes",PersistenceLimit,"maxProperties",256);}
    static byte[] PersistenceBytes(Dictionary<string,object> request){
      string encoded=S(request,"data");if(encoded.Length>699052)throw new ArgumentException("Persistence input exceeds 512 KiB");var bytes=Convert.FromBase64String(encoded);if(bytes.Length>PersistenceLimit)throw new ArgumentException("Persistence input exceeds 512 KiB");if(Convert.ToBase64String(bytes)!=encoded)throw new ArgumentException("Persistence input must be canonical base64");return bytes;
    }
    static object PersistOcx(Entry entry,Dictionary<string,object> request){
      string op=S(request,"op");if(op=="persistenceInfo")return PersistenceCapabilities(entry.Value);
      string format=PersistenceFormat(entry,request);
      // Do not retry a component failure with a different format: a rejected Load
      // may already have mutated component state, and a retry is not transactional.
      if(format=="stream")return Persistence(entry,request);
      if(format=="storage")return StoragePersistence(entry,request);
      var bag2=entry.Value as OcxPersistPropertyBag2;var bag1=entry.Value as OcxPersistPropertyBag;
      if(format=="propertyBag2"&&bag2==null||format=="propertyBag"&&bag1==null)throw new NotSupportedException("The OCX does not implement "+format);
      bool load=op=="loadState";var bag=new PropertyBagBridge(load?V(request,"properties"):null,N(request,"lcid",1033));
      if(load){
        var log=new OcxPersistenceErrorLog();IntPtr pointer=Marshal.GetComInterfaceForObject(log,typeof(OcxErrorLog));
        try{if(format=="propertyBag2")bag2.Load(bag,pointer);else bag1.Load(bag,pointer);}finally{Marshal.Release(pointer);}
        return D("format",format,"loadedProperties",bag.Count,"errors",bag.Errors.ToArray(),"componentErrors",log.Errors.ToArray());
      }
      // Keep the OCX dirty until the caller has committed its project. Saving into
      // a transport buffer is not durable storage and must not clear native state.
      bool all=Convert.ToBoolean(V(request,"saveAll",true),CultureInfo.InvariantCulture);
      if(format=="propertyBag2")bag2.Save(bag,false,all);else bag1.Save(bag,false,all);
      if(bag.Errors.Any(item=>S(Map(item),"operation")=="write"))throw new COMException("The OCX property bag rejected one or more writes",unchecked((int)0x80004005));
      return D("format",format,"properties",bag.Snapshot(),"errors",bag.Errors.ToArray());
    }
    static object StoragePersistence(Entry entry,Dictionary<string,object> request){
      var persist=entry.Value as OcxPersistStorage;if(persist==null)throw new NotSupportedException("The OCX has no IPersistStorage interface");
      OcxLockBytes bytes=null;OcxStorage storage=null;bool retained=false;
      Marshal.ThrowExceptionForHR(CreateILockBytesOnHGlobal(IntPtr.Zero,true,out bytes));
      try{
        if(S(request,"op")=="loadState"){
          var data=PersistenceBytes(request);int written;bytes.WriteAt(0,data,data.Length,out written);if(written!=data.Length)throw new System.IO.IOException("Truncated storage input");
          Marshal.ThrowExceptionForHR(StgOpenStorageOnILockBytes(bytes,null,0x12,IntPtr.Zero,0,out storage));
          if(entry.PersistenceResources.Count>=16)throw new InvalidOperationException("OCX storage reload limit reached; recreate the control");
          persist.Load(storage);
          // IPersistStorage can retain the backing store for its entire lifetime.
          // Keep our references too; replacing state never frees a live backing file.
          entry.PersistenceResources.Add(storage);entry.PersistenceResources.Add(bytes);retained=true;return D("format","storage","loadedBytes",data.Length);
        }
        Marshal.ThrowExceptionForHR(StgCreateDocfileOnILockBytes(bytes,0x1012,0,out storage));
        Guid id;persist.GetClassID(out id);storage.SetClass(ref id);persist.Save(storage,false);
        try{storage.Commit(0);}finally{persist.SaveCompleted(null);}
        STATSTG stat;bytes.Stat(out stat,1);if(stat.cbSize<0||stat.cbSize>PersistenceLimit)throw new NotSupportedException("OCX storage output exceeds 512 KiB");
        var output=new byte[(int)stat.cbSize];int read;bytes.ReadAt(0,output,output.Length,out read);if(read!=output.Length)throw new System.IO.IOException("Truncated storage output");
        return D("format","storage","data",Convert.ToBase64String(output));
      }finally{if(!retained){if(storage!=null)Marshal.ReleaseComObject(storage);if(bytes!=null)Marshal.ReleaseComObject(bytes);}}
    }
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    public sealed class PropertyBagBridge:OcxPropertyBagNative,OcxPropertyBag2Native {
      readonly Dictionary<string,Dictionary<string,object>> values=new Dictionary<string,Dictionary<string,object>>(StringComparer.OrdinalIgnoreCase);
      readonly Dictionary<string,uint> hints=new Dictionary<string,uint>(StringComparer.OrdinalIgnoreCase);
      readonly Dictionary<uint,string> hintNames=new Dictionary<uint,string>();
      uint nextHint=0;
      readonly int locale;
      public readonly List<object> Errors=new List<object>();
      public int Count{get{return values.Count;}}
      static string PropertyName(string name){if(name==null||name.Length==0||name.Length>1024||name.IndexOf('\0')>=0)throw new ArgumentException("Invalid persistent property name");return name;}
      static object CheckedWire(object wire,int depth=0){
        if(depth>16)throw new ArgumentException("Property value nesting limit");var value=Map(wire);string type=S(value,"t");
        if(type=="object")throw new UnauthorizedAccessException("Live COM objects cannot be embedded in persistent property data");
        if(type=="array")foreach(var child in A(V(value,"v")))CheckedWire(child,depth+1);
        var pointer=NewVariant();try{ImportNative(wire,pointer);}finally{FreeVariant(pointer);}return wire;
      }
      public PropertyBagBridge(object input,int lcid=1033){
        if(lcid<0||lcid>0xfffff)throw new ArgumentException("Invalid persistence locale");locale=lcid;
        if(input==null)return;var entries=A(input);if(entries.Length>256)throw new ArgumentException("Property bag exceeds 256 entries");
        foreach(var item in entries){var data=Map(item);string name=PropertyName(S(data,"name"));if(values.ContainsKey(name))throw new ArgumentException("Duplicate persistent property");values.Add(name,D("name",name,"value",CheckedWire(V(data,"value"))));RememberHint(name);}CheckSize(values.Values.ToArray());
      }
      void RememberHint(string name){if(!hints.ContainsKey(name)){uint hint=++nextHint;hints.Add(name,hint);hintNames.Add(hint,name);}}
      string ResolveName(OcxPropertyInfo info){
        if(info.Name!=IntPtr.Zero)return Marshal.PtrToStringUni(info.Name);
        string name;if(info.Hint!=0&&hintNames.TryGetValue(info.Hint,out name))return name;
        return null;
      }
      static void CheckSize(object value){if(Encoding.UTF8.GetByteCount(Json.Serialize(value))>PersistenceLimit)throw new ArgumentException("Property bag exceeds 512 KiB");}
      public object[] Snapshot(){return values.Values.Cast<object>().ToArray();}
      int ReadError(string name,int hr,IntPtr pointer){
        if(hr>=0)return hr;if(Errors.Count<256)Errors.Add(D("name",name,"hresult",hr,"operation","read"));
        if(pointer!=IntPtr.Zero){object unknown=null;try{
          unknown=Marshal.GetObjectForIUnknown(pointer);var log=unknown as OcxErrorLog;
          if(log!=null){var detail=new EXCEPINFO{scode=hr,bstrSource="VB6.OCX.PropertyBag",bstrDescription="Unable to read persistent property: "+(name??"(null)")};log.AddError(name,ref detail);}
        }catch{/* The original read HRESULT must not be replaced by a logging error. */}finally{if(unknown!=null&&Marshal.IsComObject(unknown))Marshal.ReleaseComObject(unknown);}}
        return hr;
      }
      public int Read(string name,IntPtr value,IntPtr errorLog){
        try{PropertyName(name);if(value==IntPtr.Zero)throw new ArgumentNullException("value");Dictionary<string,object> entry;if(!values.TryGetValue(name,out entry))return ReadError(name,unchecked((int)0x80070057),errorLog);
          var temporary=NewVariant();try{ImportNative(entry["value"],temporary);ushort requested=(ushort)Marshal.ReadInt16(value);int hr=requested==0||requested==12?VariantCopy(value,temporary):VariantChangeTypeEx(value,temporary,(uint)locale,0,requested);return ReadError(name,hr,errorLog);}finally{FreeVariant(temporary);}
        }catch(Exception error){return ReadError(name,Marshal.GetHRForException(error),errorLog);}
      }
      public int Write(string name,IntPtr value){
        try{PropertyName(name);if(value==IntPtr.Zero)throw new ArgumentNullException("value");if(values.Count>=256&&!values.ContainsKey(name))throw new ArgumentException("Property bag exceeds 256 entries");
          // Inspect the native VARIANT before exporting; ExportNative otherwise
          // registers COM object handles, which are invalid persistent data.
          var encoded=ExportNative(value,0,true);CheckedWire(encoded);var next=new Dictionary<string,Dictionary<string,object>>(values,StringComparer.OrdinalIgnoreCase);next[name]=D("name",name,"value",encoded);CheckSize(next.Values.ToArray());values[name]=next[name];RememberHint(name);return 0;
        }catch(Exception error){int hr=Marshal.GetHRForException(error);if(Errors.Count<256)Errors.Add(D("name",name,"hresult",hr,"operation","write"));return hr;}
      }
      public int Read(uint count,IntPtr properties,IntPtr errorLog,IntPtr output,IntPtr errors){
        if(count>256||count>0&&(properties==IntPtr.Zero||output==IntPtr.Zero||errors==IntPtr.Zero))return unchecked((int)0x80070057);
        int size=Marshal.SizeOf(typeof(OcxPropertyInfo));bool failed=false;
        for(int i=0;i<(int)count;i++){var info=(OcxPropertyInfo)Marshal.PtrToStructure(IntPtr.Add(properties,i*size),typeof(OcxPropertyInfo));var slot=IntPtr.Add(output,i*VariantSize);Marshal.Copy(new byte[VariantSize],0,slot,VariantSize);Marshal.WriteInt16(slot,(short)info.VariantType);int hr=Read(ResolveName(info),slot,errorLog);Marshal.WriteInt32(errors,i*4,hr);failed|=hr<0;}
        return failed?1:0;
      }
      public int Write(uint count,IntPtr properties,IntPtr input){
        if(count>256||count>0&&(properties==IntPtr.Zero||input==IntPtr.Zero))return unchecked((int)0x80070057);
        int size=Marshal.SizeOf(typeof(OcxPropertyInfo));var before=new Dictionary<string,Dictionary<string,object>>(values,StringComparer.OrdinalIgnoreCase);uint beforeHint=nextHint;
        for(int i=0;i<(int)count;i++){var info=(OcxPropertyInfo)Marshal.PtrToStructure(IntPtr.Add(properties,i*size),typeof(OcxPropertyInfo));int hr=Write(ResolveName(info),IntPtr.Add(input,i*VariantSize));if(hr<0){values.Clear();foreach(var item in before)values.Add(item.Key,item.Value);foreach(var hint in hintNames.Keys.Where(key=>key>beforeHint).ToArray()){hints.Remove(hintNames[hint]);hintNames.Remove(hint);}nextHint=beforeHint;return hr;}}return 0;
      }
      public int CountProperties(out uint count){count=(uint)values.Count;return 0;}
      public int GetPropertyInfo(uint start,uint count,IntPtr properties,out uint returned){
        returned=0;if(start>values.Count||count>256||count>0&&properties==IntPtr.Zero)return unchecked((int)0x80070057);
        var data=values.Values.Skip((int)start).Take((int)count).ToArray();int size=Marshal.SizeOf(typeof(OcxPropertyInfo));var allocated=new List<IntPtr>();
        try{for(int i=0;i<data.Length;i++){var temporary=NewVariant();try{ImportNative(data[i]["value"],temporary);var name=Marshal.StringToCoTaskMemUni((string)data[i]["name"]);allocated.Add(name);var info=new OcxPropertyInfo{Type=1,VariantType=(ushort)Marshal.ReadInt16(temporary),Hint=hints[(string)data[i]["name"]],Name=name,ClassId=Guid.Empty};Marshal.StructureToPtr(info,IntPtr.Add(properties,i*size),false);}finally{FreeVariant(temporary);}}returned=(uint)data.Length;return 0;}
        catch(Exception error){foreach(var pointer in allocated)Marshal.FreeCoTaskMem(pointer);for(int i=0;i<allocated.Count;i++)Marshal.StructureToPtr(new OcxPropertyInfo(),IntPtr.Add(properties,i*size),false);return Marshal.GetHRForException(error);}
      }
      // Object-valued persistence is an explicit authority boundary, not a missing
      // virtual method. Only data-only scalar/SAFEARRAY properties are admitted.
      public int LoadObject(string name,uint hint,object value,IntPtr errorLog){return ReadError(name,unchecked((int)0x80070005),errorLog);}
    }
  }
}
