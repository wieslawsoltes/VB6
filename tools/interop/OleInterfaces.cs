// Explicit Windows SDK contracts. .NET Framework's ComTypes.IEnumSTATDATA
// declares IID 00000103 (IEnumFORMATETC); the SDK requires 00000105.
// Keep IDataObject's EnumDAdvise return type correct across the complete ABI.
// SDK: microsoft/win32metadata generation/WinSDK/RecompiledIdlHeaders/um/ObjIdl.Idl
// Framework: microsoft/referencesource System/compmod/system/Runtime/InteropServices/ComTypes/IEnumSTATDATA.cs
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
namespace VB6Interop {
  [ComVisible(true),ComImport,Guid("00000105-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface OleEnumStatData {
    [PreserveSig]int Next(int count,[Out,MarshalAs(UnmanagedType.LPArray,SizeParamIndex=0)]STATDATA[] values,[Out,MarshalAs(UnmanagedType.LPArray,SizeConst=1)]int[] fetched);
    [PreserveSig]int Skip(int count);
    [PreserveSig]int Reset();
    void Clone(out OleEnumStatData value);
  }
  [ComVisible(true),ComImport,Guid("0000010E-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  public interface OleDataInterface {
    void GetData(ref FORMATETC format,out STGMEDIUM medium);
    void GetDataHere(ref FORMATETC format,ref STGMEDIUM medium);
    [PreserveSig]int QueryGetData(ref FORMATETC format);
    [PreserveSig]int GetCanonicalFormatEtc(ref FORMATETC input,out FORMATETC output);
    void SetData(ref FORMATETC format,ref STGMEDIUM medium,[MarshalAs(UnmanagedType.Bool)]bool release);
    [return:MarshalAs(UnmanagedType.Interface)]IEnumFORMATETC EnumFormatEtc(DATADIR direction);
    [PreserveSig]int DAdvise(ref FORMATETC format,ADVF flags,IAdviseSink sink,out int connection);
    void DUnadvise(int connection);
    [PreserveSig]int EnumDAdvise(out OleEnumStatData enumerator);
  }
}
