// Compiled with the real host sources only by the Windows contract test runner.
// No registry writes, external network requests or third-party OCX installation.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
namespace VB6Interop {
  public static partial class AutomationHost {
    static void Require(bool condition,string name){if(!condition)throw new Exception("OCX contract failed: "+name);}
    static void ExpectFailure(Action action,string name){bool failed=false;try{action();}catch{failed=true;}Require(failed,name);}
    static object AtProperty(PropertyBagBridge bag,string name){return Map(bag.Snapshot().First(item=>S(Map(item),"name")==name))["value"];}
    static void EqualWire(object actual,object expected,string name){Require(Json.Serialize(actual)==Json.Serialize(expected),name);}
    static void ReleaseStorageResources(Entry entry){var persist=entry.Value as OcxPersistStorage;if(persist!=null)persist.HandsOffStorage();foreach(var resource in entry.PersistenceResources)if(Marshal.IsComObject(resource))Marshal.ReleaseComObject(resource);entry.PersistenceResources.Clear();}
    sealed class StorageContract:OcxPersistStorage {
      public int Value=17,SaveCount=0,CompleteCount=0;public bool Saving=false;OcxStorage backing;
      public void GetClassID(out Guid id){id=new Guid("559A7BCE-8F46-4C42-9C1E-E19D015DA019");}
      public int IsDirty(){return 0;}
      public void InitNew(OcxStorage storage){backing=storage;Value=0;}
      public void Load(OcxStorage storage){IStream stream;storage.OpenStream("Value",IntPtr.Zero,0x10,0,out stream);var value=new byte[4];IntPtr read=Marshal.AllocCoTaskMem(4);try{stream.Read(value,4,read);Require(Marshal.ReadInt32(read)==4,"storage read size");Value=BitConverter.ToInt32(value,0);backing=storage;}finally{Marshal.FreeCoTaskMem(read);Marshal.ReleaseComObject(stream);}}
      public void Save(OcxStorage storage,bool same){Require(!same,"Save A Copy must not replace current storage");SaveCount++;IStream stream;storage.CreateStream("Value",0x1012,0,0,out stream);try{stream.Write(BitConverter.GetBytes(Value),4,IntPtr.Zero);stream.Commit(0);}finally{Marshal.ReleaseComObject(stream);}Saving=true;}
      public void SaveCompleted(OcxStorage replacement){Require(replacement==null,"Save Copy completion keeps existing backing");Require(Saving,"SaveCompleted must follow Save");CompleteCount++;Saving=false;}
      public void HandsOffStorage(){backing=null;}
      public bool HasBacking{get{return backing!=null;}}
    }
    sealed class BagContract:OcxPersistPropertyBag,OcxPersistPropertyBag2 {
      public int Value=23,SaveCount=0,LoadCount=0;public bool Fail=false,All=true;
      public void GetClassID(out Guid id){id=new Guid("559A7BCE-8F46-4C42-9C1E-E19D015DA020");}public void InitNew(){Value=0;}public int IsDirty(){return 0;}
      public void Load(OcxPropertyBagNative bag,IntPtr log){var value=NewVariant();try{Marshal.ThrowExceptionForHR(bag.Read("Gauge.Value",value,log));Value=Convert.ToInt32(Marshal.GetObjectForNativeVariant(value));LoadCount++;}finally{FreeVariant(value);}}
      public void Save(OcxPropertyBagNative bag,bool clearDirty,bool all){Require(!clearDirty,"transport save does not acknowledge durable storage");if(Fail)throw new COMException("fixture rejection",unchecked((int)0x80004005));All=all;var value=NewVariant();try{ImportNative(D("t","number","vt",3,"v",Value),value);Marshal.ThrowExceptionForHR(bag.Write("Gauge.Value",value));SaveCount++;}finally{FreeVariant(value);}}
      public void Load(OcxPropertyBag2Native bag,IntPtr log){var value=NewVariant();IntPtr info=Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(OcxPropertyInfo))),errors=Marshal.AllocCoTaskMem(4),name=Marshal.StringToCoTaskMemUni("Gauge.Value");try{Marshal.StructureToPtr(new OcxPropertyInfo{Name=name,VariantType=3},info,false);Marshal.ThrowExceptionForHR(bag.Read(1,info,log,value,errors));Marshal.ThrowExceptionForHR(Marshal.ReadInt32(errors));Value=Convert.ToInt32(Marshal.GetObjectForNativeVariant(value));LoadCount++;}finally{FreeVariant(value);Marshal.FreeCoTaskMem(info);Marshal.FreeCoTaskMem(errors);Marshal.FreeCoTaskMem(name);}}
      public void Save(OcxPropertyBag2Native bag,bool clearDirty,bool all){Require(!clearDirty,"bag2 save does not clear native dirty flag");if(Fail)throw new COMException("fixture rejection",unchecked((int)0x80004005));All=all;var value=NewVariant();IntPtr info=Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(OcxPropertyInfo))),name=Marshal.StringToCoTaskMemUni("Gauge.Value");try{ImportNative(D("t","number","vt",3,"v",Value),value);Marshal.StructureToPtr(new OcxPropertyInfo{Name=name,VariantType=3},info,false);Marshal.ThrowExceptionForHR(bag.Write(1,info,value));SaveCount++;}finally{FreeVariant(value);Marshal.FreeCoTaskMem(info);Marshal.FreeCoTaskMem(name);}}
    }
    public static string RunOcxContainerContracts(){
      var checks=new List<string>();
      Require(Marshal.SizeOf(typeof(OcxMessage))==(IntPtr.Size==8?48:32),"MSG layout");Require(Marshal.SizeOf(typeof(OcxControlInfo))==(IntPtr.Size==8?24:16),"CONTROLINFO layout");Require(Marshal.SizeOf(typeof(OcxPropertyInfo))==(IntPtr.Size==8?40:32),"PROPBAG2 layout");Require(Marshal.OffsetOf(typeof(OcxPropertyInfo),"Name").ToInt32()==(IntPtr.Size==8?16:12),"PROPBAG2 name offset");checks.Add("x86/x64 native MSG, CONTROLINFO and PROPBAG2 layouts");
      var examples=new object[]{D("t","number","vt",17,"v",255),D("t","number","vt",2,"v",-32768),D("t","number","vt",3,"v",2147483647),D("t","number","vt",4,"v",1.5),D("t","number","vt",5,"v",1.5),D("t","boolean","v",true),D("t","currency","v","123.4567"),D("t","decimal","v","12.125"),D("t","string","v","test"),D("t","date","v",44000.5)};
      var bag=new PropertyBagBridge(null);var source=NewVariant();var destination=NewVariant();
      try{
        for(int i=0;i<examples.Length;i++){VariantClear(source);VariantClear(destination);ImportNative(examples[i],source);Marshal.ThrowExceptionForHR(bag.Write("P"+i,source));Marshal.ThrowExceptionForHR(bag.Read("P"+i,destination,IntPtr.Zero));EqualWire(ExportNative(destination),examples[i],"typed scalar "+i);}
        checks.Add("native VARIANT round trips preserve ten supported scalar types");
        var array=D("t","array","elementType",17,"bounds",new object[]{new object[]{-2,-1},new object[]{3,4}},"v",new object[]{D("t","number","vt",17,"v",1),D("t","number","vt",17,"v",2),D("t","number","vt",17,"v",3),D("t","number","vt",17,"v",4)});
        VariantClear(source);VariantClear(destination);ImportNative(array,source);Marshal.ThrowExceptionForHR(bag.Write("Items",source));Marshal.ThrowExceptionForHR(bag.Read("Items",destination,IntPtr.Zero));EqualWire(ExportNative(destination),array,"multidimensional typed SAFEARRAY");checks.Add("typed SAFEARRAY storage retains nonzero multidimensional bounds");
        VariantClear(destination);Marshal.Copy(new byte[VariantSize],0,destination,VariantSize);Marshal.WriteInt16(destination,8);Marshal.ThrowExceptionForHR(bag.Read("P0",destination,IntPtr.Zero));Require((string)Marshal.GetObjectForNativeVariant(destination)=="255","requested type conversion");checks.Add("IPropertyBag Read honors requested VARTYPE");
        var localeBag=new PropertyBagBridge(new object[]{D("name","Localized","value",D("t","string","v","1,5"))},1045);VariantClear(destination);Marshal.Copy(new byte[VariantSize],0,destination,VariantSize);Marshal.WriteInt16(destination,5);Marshal.ThrowExceptionForHR(localeBag.Read("Localized",destination,IntPtr.Zero));Require((double)Marshal.GetObjectForNativeVariant(destination)==1.5,"Polish LCID conversion");checks.Add("property coercion uses per-client LCID");
        var log=new OcxPersistenceErrorLog();IntPtr errorLog=Marshal.GetComInterfaceForObject(log,typeof(OcxErrorLog));try{Require(bag.Read("Missing",destination,errorLog)<0,"missing property error");Require(log.Errors.Count==1,"IErrorLog callback");}finally{Marshal.Release(errorLog);}checks.Add("missing property HRESULT and IErrorLog reporting");
        int before=Objects.Count;VariantClear(source);Marshal.WriteInt16(source,13);Marshal.WriteIntPtr(source,8,Marshal.GetIUnknownForObject(new object()));Require(bag.Write("Object",source)<0,"persistent object denied");Require(Objects.Count==before,"persistent object must not be adopted as a handle");checks.Add("object-valued state rejected before handle adoption");
      }finally{FreeVariant(source);FreeVariant(destination);}
      int descriptorSize=Marshal.SizeOf(typeof(OcxPropertyInfo));IntPtr descriptors=Marshal.AllocCoTaskMem(descriptorSize*2),values=ZeroMemory(VariantSize*2),errorsOut=Marshal.AllocCoTaskMem(8);var names=new[]{Marshal.StringToCoTaskMemUni("Value"),Marshal.StringToCoTaskMemUni("")};
      try{
        var batch=new PropertyBagBridge(new object[]{D("name","Value","value",D("t","number","vt",3,"v",3))});
        for(int i=0;i<2;i++){Marshal.StructureToPtr(new OcxPropertyInfo{Name=names[i],VariantType=3},IntPtr.Add(descriptors,i*descriptorSize),false);ImportNative(D("t","number","vt",3,"v",10+i),IntPtr.Add(values,i*VariantSize));}
        Require(batch.Write(2,descriptors,values)<0,"batch failure must surface");EqualWire(AtProperty(batch,"Value"),D("t","number","vt",3,"v",3),"batch write rollback");checks.Add("IPropertyBag2 batch writes roll back earlier entries on failure");
        VariantClear(values);VariantClear(IntPtr.Add(values,VariantSize));Require(batch.Read(2,descriptors,IntPtr.Zero,values,errorsOut)==1,"partial bag2 read result");Require(Marshal.ReadInt32(errorsOut)==0&&Marshal.ReadInt32(errorsOut,4)<0,"per-property read HRESULTs");checks.Add("IPropertyBag2 partial reads return individual HRESULTs");
        uint returned;Marshal.ThrowExceptionForHR(batch.GetPropertyInfo(0,2,descriptors,out returned));Require(returned==1,"property enumeration count");var info=(OcxPropertyInfo)Marshal.PtrToStructure(descriptors,typeof(OcxPropertyInfo));try{
          Require(Marshal.PtrToStringUni(info.Name)=="Value"&&info.VariantType==3&&info.Hint!=0,"property enumeration metadata");
          Marshal.StructureToPtr(new OcxPropertyInfo{Hint=info.Hint,VariantType=3},descriptors,false);VariantClear(values);
          Marshal.ThrowExceptionForHR(batch.Read(1,descriptors,IntPtr.Zero,values,errorsOut));Require(Marshal.ReadInt32(errorsOut)==0,"hint-only read status");EqualWire(ExportNative(values),D("t","number","vt",3,"v",3),"hint-only value");
          VariantClear(values);ImportNative(D("t","number","vt",3,"v",7),values);Marshal.ThrowExceptionForHR(batch.Write(1,descriptors,values));EqualWire(AtProperty(batch,"Value"),D("t","number","vt",3,"v",7),"hint-only write");
        }finally{Marshal.FreeCoTaskMem(info.Name);}checks.Add("IPropertyBag2 GetPropertyInfo returns allocated names and native types and stable read/write hints");
        Require(batch.LoadObject("Anything",0,new object(),IntPtr.Zero)==unchecked((int)0x80070005),"object load authority boundary");checks.Add("LoadObject explicitly denies object activation rather than returning E_NOTIMPL");
      }finally{for(int i=0;i<2;i++)VariantClear(IntPtr.Add(values,i*VariantSize));Marshal.FreeCoTaskMem(values);Marshal.FreeCoTaskMem(errorsOut);Marshal.FreeCoTaskMem(descriptors);foreach(var name in names)Marshal.FreeCoTaskMem(name);}
      foreach(var format in new[]{"propertyBag","propertyBag2"}){
        var fixture=new BagContract();var entry=new Entry{Value=fixture};var saved=Map(PersistOcx(entry,D("op","saveState","format",format,"saveAll",false,"lcid",1045)));Require(!fixture.All&&fixture.SaveCount==1,"saveAll and save count");fixture.Value=999;var loaded=Map(PersistOcx(entry,D("op","loadState","format",format,"properties",saved["properties"],"lcid",1045)));Require(fixture.Value==23&&fixture.LoadCount==1&&N(loaded,"loadedProperties")==1,"bag load round trip");checks.Add(format+" host save/load and dirty-state contract");
        fixture.Fail=true;ExpectFailure(()=>PersistOcx(entry,D("op","saveState","format","auto")),"native rejection is propagated without retry");Require(fixture.SaveCount==1,"failed save must not retry another interface");
      }
      var store=new StorageContract();var storeEntry=new Entry{Value=store};try{
        var saved=Map(PersistOcx(storeEntry,D("op","saveState","format","storage")));var data=Convert.FromBase64String(S(saved,"data"));Require(data.Length>8&&data[0]==0xd0&&data[1]==0xcf,"compound storage signature");Require(store.SaveCount==1&&store.CompleteCount==1&&!store.Saving,"SaveCompleted releases NoScribble");store.Value=999;
        PersistOcx(storeEntry,D("op","loadState","format","storage","data",saved["data"]));Require(store.Value==17&&store.HasBacking&&storeEntry.PersistenceResources.Count==2,"loaded backing lifetime");checks.Add("real Windows structured-storage round trip with retained backing and SaveCompleted");
        var capabilities=Map(PersistenceCapabilities(store));Require((bool)capabilities["storage"]&&!(bool)capabilities["stream"],"capability-specific persistence selection");checks.Add("persistence capabilities distinguish storage and streams");
      }finally{ReleaseStorageResources(storeEntry);}
      ExpectFailure(()=>PersistenceBytes(D("data","ab==")),"noncanonical base64");ExpectFailure(()=>PersistenceBytes(D("data",new string('A',699056))),"oversized persistence");ExpectFailure(()=>CheckedOleColor((long)uint.MaxValue+1),"OLE_COLOR range");Require(CheckedOleColor(0x8000000fL)==unchecked((int)0x8000000f),"OLE system color");checks.Add("native input size, canonical binary encoding and OLE_COLOR bounds");
      return Json.Serialize(D("status","passed","architecture",IntPtr.Size==8?"x64":"x86","checks",checks.ToArray(),"registeredThirdPartyControls",false));
    }
  }
}
