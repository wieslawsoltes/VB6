// Repository-owned fixtures exercise real COM vtable layouts and Windows helpers.
// They are linked only into the test runner, not into the production companion.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using IEnumSTATDATA=VB6Interop.OleEnumStatData;
namespace VB6Interop {
  public static partial class AutomationHost {
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    public sealed class OleVerbFixture:NativeEnumOleVerb {
      uint position;public int Next(uint count,NativeOleVerb[] values,out uint fetched){fetched=0;if(count!=1||values==null||values.Length<1)return unchecked((int)0x80070057);if(position++>0)return 1;values[0]=new NativeOleVerb{Id=-1,Name="Open Żółć",Flags=2,Attributes=3};fetched=1;return 0;}
      public int Skip(uint count){position+=count;return 1;}public int Reset(){position=0;return 0;}public void Clone(out NativeEnumOleVerb value){var clone=new OleVerbFixture();clone.position=position;value=clone;}
    }
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    public sealed class OleObjectFixture:NativeOleObject,NativeOleInPlaceObject {
      public NativeOleSize Size=new NativeOleSize{Width=2540,Height=1270};public int Verb,CloseCount,Updates;public string Application,Document;public IAdviseSink Sink;public readonly NativeOleDataObject Data=new NativeOleDataObject();
      public int SetClientSite(IntPtr site){return unchecked((int)0x80004001);}public int GetClientSite(out IntPtr site){site=IntPtr.Zero;return 0;}
      public int SetHostNames(string application,string document){Application=application;Document=document;return 0;}
      public int Close(uint options){CloseCount++;if(Sink!=null)Sink.OnClose();return 0;}
      public int SetMoniker(uint which,IMoniker moniker){return unchecked((int)0x80004001);}public int GetMoniker(uint assign,uint which,out IMoniker moniker){moniker=null;return unchecked((int)0x80004001);}
      public int InitFromData(OleDataInterface data,bool creation,uint reserved){return data==null?unchecked((int)0x80004003):0;}
      public int GetClipboardData(uint reserved,out IntPtr data){data=Marshal.GetComInterfaceForObject(Data,typeof(OleDataInterface));return 0;}
      public int DoVerb(int verb,IntPtr message,IntPtr site,int index,IntPtr parent,ref NativeOleRect bounds){Verb=verb;return 0;}
      public int EnumVerbs(out NativeEnumOleVerb enumerator){enumerator=new OleVerbFixture();return 0;}
      public int Update(){Updates++;if(Sink!=null)Sink.OnSave();return 0;}public int IsUpToDate(){return 1;}
      public int GetUserClassID(out Guid id){id=new Guid("12345678-1234-1234-1234-123456789abc");return 0;}
      public int GetUserType(uint kind,out IntPtr name){name=Marshal.StringToCoTaskMemUni("OLE contract fixture");return 0;}
      public int SetExtent(uint aspect,ref NativeOleSize size){Size=size;if(Sink!=null)Sink.OnViewChange((int)aspect,-1);return 0;}public int GetExtent(uint aspect,out NativeOleSize size){size=Size;return 0;}
      public int Advise(IAdviseSink sink,out uint cookie){Sink=sink;cookie=7;return 0;}public int Unadvise(uint cookie){if(cookie!=7)return unchecked((int)0x80040004);Sink=null;return 0;}
      public int EnumAdvise(out IEnumSTATDATA enumerator){enumerator=null;return unchecked((int)0x80004001);}public int GetMiscStatus(uint aspect,out uint status){status=129;return 0;}public int SetColorScheme(IntPtr palette){return unchecked((int)0x80004001);}
      public int GetWindow(out IntPtr window){window=IntPtr.Zero;return 0;}public int ContextSensitiveHelp(bool enter){return 0;}public int InPlaceDeactivate(){return 0;}public int UIDeactivate(){return 0;}public int SetObjectRects(ref NativeOleRect position,ref NativeOleRect clip){return 0;}public int ReactivateAndUndo(){return unchecked((int)0x80004001);}
    }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int OleClassCall(IntPtr self,out Guid id);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int OleExtentCall(IntPtr self,uint aspect,out NativeOleSize size);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int OleDataCall(IntPtr self,uint reserved,out IntPtr data);
    static T OleTestMethod<T>(IntPtr self,int slot)where T:class{return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(self),slot*IntPtr.Size),typeof(T)) as T;}
    public static string RunComOleContainerContracts(){
      var report=Map(Json.DeserializeObject(RunOcxAllContainerContracts()));var checks=A(report["checks"]).Select(item=>(string)item).ToList();ComOleContracts(checks);report["checks"]=checks.ToArray();return Json.Serialize(report);
    }
    static void ComOleContracts(List<string> checks){
      Marshal.ThrowExceptionForHR(NativeOleInitialize(IntPtr.Zero));
      try{
        var fixture=new OleObjectFixture();IntPtr pointer=Marshal.GetComInterfaceForObject(fixture,typeof(NativeOleObject));
        try{Guid clsid;Marshal.ThrowExceptionForHR(OleTestMethod<OleClassCall>(pointer,15)(pointer,out clsid));Require(clsid.ToString()=="12345678-1234-1234-1234-123456789abc","IOleObject GetUserClassID vtable");NativeOleSize size;Marshal.ThrowExceptionForHR(OleTestMethod<OleExtentCall>(pointer,18)(pointer,1,out size));Require(size.Width==2540&&size.Height==1270,"IOleObject extent vtable");IntPtr data;Marshal.ThrowExceptionForHR(OleTestMethod<OleDataCall>(pointer,10)(pointer,0,out data));try{Require(data!=IntPtr.Zero,"owned native IDataObject from IOleObject");}finally{Marshal.Release(data);}}finally{Marshal.Release(pointer);}
        checks.Add("IOleObject real x86/x64 vtable class ID, HIMETRIC extent and owned IDataObject");
        string handle="o"+(++Sequence);IntPtr identity=Marshal.GetIUnknownForObject(fixture);try{Objects.Add(handle,new Entry{Value=fixture,Identity=identity.ToInt64(),Metadata=D("members",new Dictionary<string,object>[0])});Identities.Add(identity.ToInt64(),handle);}finally{Marshal.Release(identity);}
        try{
          var info=Map(NativeOleObjectOperation(D("op","ole.objectInfo","handle",handle)));Require((string)info["userType"]=="OLE contract fixture"&&(bool)info["inPlace"]&&!(bool)info["ownedWindow"],"OLE object metadata");
          var verbs=Map(NativeOleObjectOperation(D("op","ole.objectVerbs","handle",handle)));var verb=((List<object>)verbs["verbs"])[0];Require(N(Map(verb),"id")==-1&&(string)Map(verb)["name"]=="Open Żółć","native verb schema");
          ExpectFailure(()=>NativeOleObjectOperation(D("op","ole.objectDoVerb","handle",handle,"verb",-1)),"DoVerb without owned preview must fail");ExpectFailure(()=>NativeOleObjectOperation(D("op","ole.objectDeactivate","handle",handle)),"deactivation without owned preview must fail");Require(fixture.Verb==0,"ungranted activation never calls object");
          var connection=Map(NativeOleObjectOperation(D("op","ole.objectAdvise","handle",handle)));NativeOleObjectOperation(D("op","ole.objectExtent","handle",handle,"width",100,"height",200));NativeOleObjectOperation(D("op","ole.objectNames","handle",handle,"application","VB6","document","Doc"));NativeOleObjectOperation(D("op","ole.objectUpdate","handle",handle));NativeOleObjectOperation(D("op","ole.objectClose","handle",handle,"save",1));
          Require(fixture.Size.Width==100&&fixture.Size.Height==200&&fixture.Application=="VB6"&&fixture.Document=="Doc"&&fixture.Updates==1&&fixture.CloseCount==1,"native lifecycle methods");
          var notifications=Map(NativeDataOperation(D("op","ole.dataChanges")));Require(((Dictionary<string,object>[])notifications["notifications"]).Select(x=>S(x,"kind")).SequenceEqual(new[]{"view","save","close"}),"native IOleObject advise notifications");NativeOleObjectOperation(D("op","ole.objectUnadvise","connection",connection["connection"]));Require(fixture.Sink==null,"native OLE unadvise");
          var exported=Map(NativeOleObjectOperation(D("op","ole.objectGetData","handle",handle)));Require(S(exported,"id")==S(Map(NativeOleObjectOperation(D("op","ole.objectGetData","handle",handle))),"id"),"native data identity reuse");Release(S(exported,"id"));
          checks.Add("OLE lifecycle, verb metadata, advisory order and native activation permission boundary");
        }finally{Release(handle);}
        var streamMedium=NativeOleMedium.Create(TYMED.TYMED_ISTREAM,new byte[]{1,2,3});
        try{var snapshot=NativeOleMedium.Read(ref streamMedium);Require(snapshot.SequenceEqual(new byte[]{1,2,3}),"borrowed native stream snapshot");var again=NativeOleMedium.Read(ref streamMedium);Require(again.SequenceEqual(snapshot),"borrowed stream remains valid and seek is restored");}finally{NativeOleMedium.Release(ref streamMedium);}
        checks.Add("borrowed native IStream snapshots preserve seek and source lifetime");
      }finally{NativeOleUninitialize();}
    }
  }
}
