// Repository-owned COM fixture: no registered/proprietary control is required.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
namespace VB6Interop {
  public static partial class AutomationHost {
    [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
    public sealed class PropertyBrowsingFixture:OcxPerPropertyBrowsing {
      public int DisplayResult=0,PageResult=0,ListResult=0,ValueResult=0;
      public bool PublishErrorInfo=false;
      int Result(int code){return PublishErrorInfo&&code<0?Marshal.GetHRForException(new COMException("Current browsing diagnostic",code)):code;}
      public string Display="Choice\0with embedded NUL",Label="Choice";
      public int Count=2;public bool Mismatch=false,NullLabel=false,ObjectValue=false;
      public int LastDispid=0;public uint LastCookie=0;
      public object[] Values={D("t","number","vt",2,"v",7),D("t","date","v",44000.500000001)};
      public int GetDisplayString(int id,out IntPtr text){LastDispid=id;text=DisplayResult==0?Marshal.StringToBSTR(Display):IntPtr.Zero;return Result(DisplayResult);}
      public int MapPropertyToPage(int id,out Guid page){LastDispid=id;page=PageResult==0?new Guid("559A7BCE-8F46-4C42-9C1E-E19D015DA019"):Guid.Empty;return Result(PageResult);}
      public int GetPredefinedStrings(int id,out OcxCountedArray strings,out OcxCountedArray cookies){
        LastDispid=id;
        if(ListResult!=0){strings=new OcxCountedArray{Count=uint.MaxValue,Values=new IntPtr(1)};cookies=strings;return Result(ListResult);}
        strings=new OcxCountedArray{Count=(uint)Count,Values=Count==0?IntPtr.Zero:ZeroMemory(Count*IntPtr.Size)};
        cookies=new OcxCountedArray{Count=(uint)(Count+(Mismatch?1:0)),Values=Count==0?IntPtr.Zero:ZeroMemory(Count*4)};
        for(int i=0;i<Count;i++){
          Marshal.WriteIntPtr(strings.Values,i*IntPtr.Size,NullLabel&&i==Count-1?IntPtr.Zero:Marshal.StringToCoTaskMemUni(Label+i));
          Marshal.WriteInt32(cookies.Values,i*4,i==0?-1:i);
        }
        return 0;
      }
      public int GetPredefinedValue(int id,uint cookie,IntPtr value){
        LastDispid=id;LastCookie=cookie;if(ValueResult!=0)return Result(ValueResult);
        if(ObjectValue){Marshal.WriteInt16(value,13);Marshal.WriteIntPtr(value,8,Marshal.GetIUnknownForObject(new object()));}
        else ImportNative(Values[cookie==uint.MaxValue?0:(int)cookie%Values.Length],value);
        return 0;
      }
    }
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int BrowsingDisplayCall(IntPtr self,int id,out IntPtr text);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int BrowsingPageCall(IntPtr self,int id,out Guid page);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int BrowsingStringsCall(IntPtr self,int id,out OcxCountedArray strings,out OcxCountedArray cookies);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int BrowsingValueCall(IntPtr self,int id,uint cookie,IntPtr value);
    public static string RunOcxAllContainerContracts(){
      var report=Map(Json.DeserializeObject(RunOcxContainerContracts()));
      var checks=A(report["checks"]).Select(item=>(string)item).ToList();
      PropertyBrowsingContracts(checks);report["checks"]=checks.ToArray();
      return Json.Serialize(report);
    }
    static void PropertyBrowsingContracts(List<string> checks){
      Require(Marshal.SizeOf(typeof(OcxCountedArray))==(IntPtr.Size==8?16:8),"counted array ABI size");
      Require(Marshal.OffsetOf(typeof(OcxCountedArray),"Values").ToInt32()==(IntPtr.Size==8?8:4),"counted array pointer offset");
      var fake=new PropertyBrowsingFixture();var result=ReadPropertyBrowsing(fake,-501);var choices=A(result["predefined"]);
      Require((bool)result["supported"]&&(string)result["display"]==fake.Display,"BSTR embedded NUL retained");
      Require((string)result["page"]=="559a7bce-8f46-4c42-9c1e-e19d015da019"&&fake.LastDispid==-501,"property-page mapping and signed DISPID");
      Require(choices.Length==2&&Convert.ToUInt32(Map(choices[0])["cookie"])==uint.MaxValue,"unsigned native cookie");
      EqualWire(Map(choices[0])["value"],fake.Values[0],"Integer subtype choice");EqualWire(Map(choices[1])["value"],fake.Values[1],"raw DATE precision choice");
      checks.Add("per-property counted-array ABI, BSTR, signed DISPID and unsigned DWORD cookies");
      var scalarValues=new object[]{D("t","number","vt",17,"v",255),D("t","number","vt",2,"v",-12),D("t","number","vt",3,"v",100000),D("t","number","vt",4,"v",1.25),D("t","number","vt",5,"v",1.25),D("t","boolean","v",true),D("t","currency","v","123.4567"),D("t","decimal","v","12.125"),D("t","string","v","A\0B"),D("t","date","v",44000.500000001)};
      foreach(var wire in scalarValues){fake.Values=new[]{wire};fake.Count=1;EqualWire(Map(A(ReadPropertyBrowsing(fake,0)["predefined"])[0])["value"],wire,"typed property choice");}
      var array=D("t","array","elementType",17,"bounds",new object[]{new object[]{-2,-1}},"v",new object[]{D("t","number","vt",17,"v",2),D("t","number","vt",17,"v",3)});
      fake.Values=new[]{(object)array};EqualWire(Map(A(ReadPropertyBrowsing(fake,0)["predefined"])[0])["value"],array,"predefined typed SAFEARRAY");
      checks.Add("predefined values preserve ten scalar VARTYPEs and nonzero-bound typed SAFEARRAYs");
      fake=new PropertyBrowsingFixture{DisplayResult=BrowsingNotImplemented,PageResult=BrowsingNotImplemented,ListResult=BrowsingNotImplemented};
      result=ReadPropertyBrowsing(fake,0);Require(!(bool)result["displaySupported"]&&result["display"]==null&&!(bool)result["pageSupported"]&&!(bool)result["predefinedSupported"],"individual unsupported features");
      Require(!(bool)ReadPropertyBrowsing(new object(),0)["supported"],"missing browsing interface");
      fake=new PropertyBrowsingFixture{Count=0};result=ReadPropertyBrowsing(fake,0);Require((bool)result["predefinedSupported"]&&A(result["predefined"]).Length==0,"empty predefined list is supported");
      checks.Add("optional per-property support differs from a supported empty list and ignores undefined failure outputs");
      foreach(string stage in new[]{"display","page","list","value"})foreach(int error in new[]{unchecked((int)0x80004005),1}){
        fake=new PropertyBrowsingFixture();if(stage=="display")fake.DisplayResult=error;if(stage=="page")fake.PageResult=error;if(stage=="list")fake.ListResult=error;if(stage=="value")fake.ValueResult=error;
        Marshal.GetHRForException(new ArgumentException("Unrelated prior property failure"));
        bool failed=false;try{ReadPropertyBrowsing(fake,0);}catch(COMException actual){failed=true;Require(actual.ErrorCode==(error<0?error:BrowsingUnexpected),"exact browsing HRESULT");}Require(failed,"browsing failure must propagate");
      }
      checks.Add("all four per-property HRESULT failures and unexpected positive results propagate");
      foreach(string stage in new[]{"display","page","list","value"}){
        fake=new PropertyBrowsingFixture{PublishErrorInfo=true};int failure=unchecked((int)0x80004005);
        if(stage=="display")fake.DisplayResult=failure;if(stage=="page")fake.PageResult=failure;if(stage=="list")fake.ListResult=failure;if(stage=="value")fake.ValueResult=failure;
        Marshal.GetHRForException(new ArgumentException("Stale caller error"));bool failed=false;
        try{ReadPropertyBrowsing(fake,0);}catch(COMException actual){failed=true;Require(actual.ErrorCode==failure&&actual.Message=="Current browsing diagnostic","fresh provider IErrorInfo retained");}
        Require(failed,"fresh diagnostic must surface");
      }
      checks.Add("stale logical-thread IErrorInfo cannot replace current HRESULTs; fresh provider diagnostics are retained");
      ExpectFailure(()=>ReadPropertyBrowsing(new PropertyBrowsingFixture{ValueResult=BrowsingNotImplemented},0),"listed choice requires its value");
      ExpectFailure(()=>ReadPropertyBrowsing(new PropertyBrowsingFixture{Mismatch=true},0),"mismatched counted arrays");
      ExpectFailure(()=>ReadPropertyBrowsing(new PropertyBrowsingFixture{Count=257},0),"over-limit choice list");
      ExpectFailure(()=>ReadPropertyBrowsing(new PropertyBrowsingFixture{Display=new string('x',4097)},0),"over-limit BSTR");
      ExpectFailure(()=>ReadPropertyBrowsing(new PropertyBrowsingFixture{Label=new string('x',4097)},0),"over-limit Unicode label");
      ExpectFailure(()=>ReadPropertyBrowsing(new PropertyBrowsingFixture{NullLabel=true},0),"null choice label");
      checks.Add("invalid and over-limit per-property arrays, labels and unresolved values fail without partial results");
      int before=Objects.Count;ExpectFailure(()=>ReadPropertyBrowsing(new PropertyBrowsingFixture{ObjectValue=true},0),"native objects are not metadata");Require(Objects.Count==before,"no object handle adoption");
      var unauthorized=new Entry{Value=new object(),Metadata=D("members",new[]{D("name","MethodOnly","modes",new List<int>{1})})};
      foreach(string name in new[]{"MethodOnly","Missing","constructor"})ExpectFailure(()=>BrowsingPropertyId(unauthorized,name,1033),"metadata property gate");
      ExpectFailure(()=>BrowseControlProperty(unauthorized,D("op","controlBrowseProperty","member","Value")),"must be a hosted control");
      ExpectFailure(()=>BrowseControlProperty(unauthorized,D("op","controlBrowseProperty","member","Value","dispid",0)),"no raw DISPID input");
      checks.Add("per-property queries reject object adoption, hidden/method-only members and raw identifier input");
      // Exercise every slot through an actual unmanaged COM callable-wrapper vtable.
      fake=new PropertyBrowsingFixture();IntPtr pointer=Marshal.GetComInterfaceForObject(fake,typeof(OcxPerPropertyBrowsing));
      try{
        IntPtr table=Marshal.ReadIntPtr(pointer),text;Guid page;OcxCountedArray strings,cookies;
        var display=(BrowsingDisplayCall)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,3*IntPtr.Size),typeof(BrowsingDisplayCall));
        Require(display(pointer,-501,out text)==0,"display vtable");try{Require(BrowsingString(text,true)==fake.Display,"BSTR pointer ABI");}finally{Marshal.FreeBSTR(text);}
        var map=(BrowsingPageCall)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,4*IntPtr.Size),typeof(BrowsingPageCall));
        Require(map(pointer,-502,out page)==0&&page!=Guid.Empty&&fake.LastDispid==-502,"page vtable CLSID ABI");
        var list=(BrowsingStringsCall)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,5*IntPtr.Size),typeof(BrowsingStringsCall));
        Require(list(pointer,-503,out strings,out cookies)==0,"strings vtable");try{Require(strings.Count==2&&cookies.Count==2&&Marshal.ReadInt32(cookies.Values)==-1,"arrays vtable ABI");}finally{FreeBrowsingArrays(strings,cookies);}
        var get=(BrowsingValueCall)Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(table,6*IntPtr.Size),typeof(BrowsingValueCall));var variant=NewVariant();
        try{Require(get(pointer,-504,uint.MaxValue,variant)==0&&fake.LastCookie==uint.MaxValue&&fake.LastDispid==-504,"value vtable DWORD ABI");EqualWire(ExportNative(variant),fake.Values[0],"value vtable VARIANT ABI");}finally{FreeVariant(variant);}
      }finally{Marshal.Release(pointer);}
      checks.Add("real COM CCW calls validate all four IPerPropertyBrowsing slots and output ownership on x86/x64");
    }
  }
}
