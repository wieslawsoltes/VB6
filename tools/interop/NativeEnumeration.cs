// Preserve the native VARIANT of each enumerated value instead of allowing the
// CLR enumerator to erase VT_CY, VT_DATE, VT_EMPTY or VT_DISPATCH(NULL).
// https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nf-oaidl-ienumvariant-next
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using DISPPARAMS = System.Runtime.InteropServices.ComTypes.DISPPARAMS;
using EXCEPINFO = System.Runtime.InteropServices.ComTypes.EXCEPINFO;
namespace VB6Interop {
  [ComImport, Guid("00020404-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface NativeEnumVariant {
    [PreserveSig] int Next(uint count, IntPtr values, out uint fetched);
    [PreserveSig] int Skip(uint count);
    [PreserveSig] int Reset();
    [PreserveSig] int Clone(out NativeEnumVariant copy);
  }
  public static partial class AutomationHost {
    static object EnumerateNative(Entry target, int lcid) {
      if(lcid<0||lcid>0xfffff)throw new ArgumentException("Invalid LCID");
      if(!Convert.ToBoolean(target.Metadata["enumerable"]))throw new NotSupportedException("Component is not enumerable");
      var iid=Guid.Empty;var args=new DISPPARAMS();var error=new EXCEPINFO();uint argumentError;
      var result=NewVariant();object iterator=null;
      try {
        // DISPID_NEWENUM is the Automation enumeration contract; it does not
        // expose arbitrary member IDs or permit ungranted object activation.
        // Type libraries expose _NewEnum as either FUNC or PROPERTYGET.
        // Invoke both read contexts once; never replay a failed enumeration.
        int hr=((DispatchInvoke)target.Value).Invoke(-4,ref iid,(uint)lcid,3,ref args,result,ref error,out argumentError);
        if(hr<0)throw new NativeDispatchException(error.bstrDescription??"Cannot obtain Automation enumerator",hr,error,argumentError);
        ushort vt=(ushort)Marshal.ReadInt16(result);
        if(vt!=9&&vt!=13)throw new NotSupportedException("Invalid Automation enumerator result");
        var pointer=Marshal.ReadIntPtr(result,8);
        if(pointer==IntPtr.Zero)throw new NotSupportedException("Null Automation enumerator");
        iterator=Marshal.GetObjectForIUnknown(pointer);
        var enumerator=(NativeEnumVariant)iterator;
        var values=new List<object>();
        while(true) {
          var value=NewVariant();
          try {
            uint fetched;hr=enumerator.Next(1,value,out fetched);
            Marshal.ThrowExceptionForHR(hr);
            if(fetched>1||hr>1||(hr==0&&fetched!=1)||(hr==1&&fetched!=0))throw new InvalidOperationException("Invalid IEnumVARIANT response");
            if(fetched==0)break;
            if(values.Count>=10000)throw new NotSupportedException("Enumeration exceeds 10,000 entries");
            values.Add(ExportNative(value));
          } finally { FreeVariant(value); }
        }
        return values;
      } finally {
        // Balance only this RCW acquisition; never FinalRelease a possibly
        // shared identity. Each native result owns its own VARIANT reference.
        if(iterator!=null&&Marshal.IsComObject(iterator))Marshal.ReleaseComObject(iterator);
        FreeVariant(result);
      }
    }
  }
}
