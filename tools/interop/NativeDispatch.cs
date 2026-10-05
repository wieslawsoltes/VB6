// Native VARIANT access is necessary: CLR object conversion alone loses VT_CY
// versus VT_DECIMAL and numeric subtype information inside SAFEARRAY(VARIANT).
// References: Microsoft IDispatch::Invoke, VariantCopyInd, SafeArrayGetElement.
using System;
using System.Collections;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using TYPEDESC = System.Runtime.InteropServices.ComTypes.TYPEDESC;
using DISPPARAMS = System.Runtime.InteropServices.ComTypes.DISPPARAMS;
using EXCEPINFO = System.Runtime.InteropServices.ComTypes.EXCEPINFO;
namespace VB6Interop {
  [ComImport, Guid("00020400-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface DispatchInvoke {
    [PreserveSig] int GetTypeInfoCount(out uint count);
    [PreserveSig] int GetTypeInfo(uint index,uint lcid,out ITypeInfo info);
    [PreserveSig] int GetIDsOfNames(ref Guid iid,[MarshalAs(UnmanagedType.LPArray,ArraySubType=UnmanagedType.LPWStr)] string[] names,uint count,uint lcid,[Out] int[] ids);
    [PreserveSig] int Invoke(int id,ref Guid iid,uint lcid,ushort flags,ref DISPPARAMS args,IntPtr result,ref EXCEPINFO error,out uint argumentError);
  }
  sealed class NativeDispatchException : COMException {
    public readonly string NativeHelpFile; public readonly uint NativeHelpContext; public readonly uint ArgumentIndex;
    public NativeDispatchException(string message,int hr,EXCEPINFO info,uint argument):base(message,hr){Source=info.bstrSource;NativeHelpFile=info.bstrHelpFile;NativeHelpContext=(uint)info.dwHelpContext;ArgumentIndex=argument;}
  }
  public static partial class AutomationHost {
    [UnmanagedFunctionPointer(CallingConvention.StdCall)] delegate int FillException(ref EXCEPINFO info);
    static readonly int VariantSize=IntPtr.Size==8?24:16;
    [DllImport("oleaut32.dll")] static extern int VariantClear(IntPtr value);
    [DllImport("oleaut32.dll")] static extern int VariantCopy(IntPtr dest,IntPtr source);
    [DllImport("oleaut32.dll")] static extern int VariantCopyInd(IntPtr dest,IntPtr source);
    [DllImport("oleaut32.dll")] static extern int VariantChangeTypeEx(IntPtr dest,IntPtr source,uint lcid,ushort flags,ushort type);
    [DllImport("oleaut32.dll")] static extern uint SafeArrayGetDim(IntPtr array);
    [DllImport("oleaut32.dll")] static extern int SafeArrayGetLBound(IntPtr array,uint dimension,out int bound);
    [DllImport("oleaut32.dll")] static extern int SafeArrayGetUBound(IntPtr array,uint dimension,out int bound);
    [DllImport("oleaut32.dll")] static extern int SafeArrayGetElement(IntPtr array,[In] int[] indices,IntPtr value);
    [StructLayout(LayoutKind.Sequential)] struct ArrayBound {public uint count; public int lower;}
    [DllImport("oleaut32.dll")] static extern IntPtr SafeArrayCreate(ushort type,uint dimensions,[In] ArrayBound[] bounds);
    [DllImport("oleaut32.dll")] static extern int SafeArrayPutElement(IntPtr array,[In] int[] indices,IntPtr value);
    [DllImport("oleaut32.dll")] static extern int SafeArrayDestroy(IntPtr array);
    static IntPtr ZeroMemory(int size){var p=Marshal.AllocCoTaskMem(size);Marshal.Copy(new byte[size],0,p,size);return p;}
    static IntPtr NewVariant(){return ZeroMemory(VariantSize);}
    static void FreeVariant(IntPtr value){if(value!=IntPtr.Zero){VariantClear(value);Marshal.FreeCoTaskMem(value);}}
    static ushort ParameterType(TYPEDESC desc,int depth=0){
      if(depth>4)return 12;var type=(ushort)desc.vt;
      if(type==26&&desc.lpValue!=IntPtr.Zero)return ParameterType((TYPEDESC)Marshal.PtrToStructure(desc.lpValue,typeof(TYPEDESC)),depth+1);
      if(type==27&&desc.lpValue!=IntPtr.Zero)return (ushort)(8192|ParameterType((TYPEDESC)Marshal.PtrToStructure(desc.lpValue,typeof(TYPEDESC)),depth+1));
      return new ushort[]{2,3,4,5,6,7,8,9,10,11,12,14,17}.Contains(type)?type:(ushort)12;
    }
    static object ExportNative(IntPtr value,int depth=0){
      if(depth>16)throw new NotSupportedException("Automation result nesting limit exceeded");
      ushort vt=(ushort)Marshal.ReadInt16(value);
      if((vt&0x4000)!=0){var copy=NewVariant();try{Marshal.ThrowExceptionForHR(VariantCopyInd(copy,value));return ExportNative(copy,depth+1);}finally{FreeVariant(copy);}}
      var data=IntPtr.Add(value,8);
      if((vt&8192)!=0)return ExportNativeArray(Marshal.ReadIntPtr(data),(ushort)(vt&4095),depth+1);
      switch(vt){
        case 0:return D("t","empty");case 1:return D("t","null");
        case 2:return D("t","number","vt",2,"v",Marshal.ReadInt16(data));
        case 3:return D("t","number","vt",3,"v",Marshal.ReadInt32(data));
        case 4:return D("t","number","vt",4,"v",(double)(float)Marshal.PtrToStructure(data,typeof(float)));
        case 5:return D("t","number","vt",5,"v",(double)Marshal.PtrToStructure(data,typeof(double)));
        case 6:return D("t","currency","v",(Marshal.ReadInt64(data)/10000m).ToString(CultureInfo.InvariantCulture));
        case 7:return D("t","date","v",(double)Marshal.PtrToStructure(data,typeof(double)));
        case 8:{var p=Marshal.ReadIntPtr(data);var text=p==IntPtr.Zero?"":Marshal.PtrToStringBSTR(p);if(text.Length>500000)throw new NotSupportedException("Automation string exceeds limit");return D("t","string","v",text);}
        case 9:case 13:if(Marshal.ReadIntPtr(data)==IntPtr.Zero)return D("t","nothing");return Export(Marshal.GetObjectForNativeVariant(value),depth+1);
        case 10:{int code=Marshal.ReadInt32(data);return code==unchecked((int)0x80020004)?D("t","missing"):D("t","error","v",code);}
        case 11:return D("t","boolean","v",Marshal.ReadInt16(data)!=0);
        case 14:return D("t","decimal","v",((decimal)Marshal.GetObjectForNativeVariant(value)).ToString(CultureInfo.InvariantCulture));
        case 17:return D("t","number","vt",17,"v",Marshal.ReadByte(data));
        default:throw new NotSupportedException("Unsupported native result VARTYPE: "+vt);
      }
    }
    static object ExportNativeArray(IntPtr array,ushort elementType,int depth){
      if(depth>16||array==IntPtr.Zero)throw new NotSupportedException("Invalid native SAFEARRAY");
      uint rank=SafeArrayGetDim(array);if(rank<1||rank>8)throw new NotSupportedException("Invalid native SAFEARRAY rank");
      if(!new ushort[]{2,3,4,5,6,7,8,9,10,11,12,14,17}.Contains(elementType))throw new NotSupportedException("Unsupported SAFEARRAY element VARTYPE");
      var bounds=new int[rank][];var indices=new int[rank];long count=1;
      for(uint i=0;i<rank;i++){
        int lower,upper;Marshal.ThrowExceptionForHR(SafeArrayGetLBound(array,i+1,out lower));Marshal.ThrowExceptionForHR(SafeArrayGetUBound(array,i+1,out upper));
        long length=(long)upper-lower+1;if(length<0||length>10000)throw new NotSupportedException("Invalid native SAFEARRAY bound");
        bounds[i]=new[]{lower,upper};indices[i]=lower;count*=length;if(count>10000)throw new NotSupportedException("Native SAFEARRAY exceeds 10,000 elements");
      }
      var values=new List<object>();
      for(int n=0;n<count;n++){
        var item=NewVariant();
        try{
          if(elementType!=12)Marshal.WriteInt16(item,(short)elementType);
          // DECIMAL overlays the complete VARIANT, unlike other typed payloads.
          Marshal.ThrowExceptionForHR(SafeArrayGetElement(array,indices,elementType==12||elementType==14?item:IntPtr.Add(item,8)));
          if(elementType==14)Marshal.WriteInt16(item,14);
          values.Add(ExportNative(item,depth+1));
        }finally{FreeVariant(item);}
        // Explicit coordinate enumeration; never assume native storage order.
        for(int i=indices.Length-1;i>=0;i--){if(indices[i]<bounds[i][1]){indices[i]++;break;}indices[i]=bounds[i][0];}
      }
      return D("t","array","elementType",elementType==9||elementType==10?12:elementType,"bounds",bounds,"v",values);
    }
    // Write explicit wire descriptors directly. Passing object[] to the CLR
    // marshaler would collapse Currency to Decimal and Nothing to Empty.
    static void ImportNative(object encoded,IntPtr output,int depth=0){
      if(depth>16)throw new ArgumentException("Automation argument nesting exceeds limit");
      var wire=Map(encoded);string kind=S(wire,"t");
      if(kind=="nothing"){Marshal.WriteInt16(output,9);Marshal.WriteIntPtr(output,8,IntPtr.Zero);return;}
      if(kind!="array"){Marshal.GetNativeVariantForObject(Import(encoded,depth),output);return;}
      var bounds=A(V(wire,"bounds"));var data=A(V(wire,"v"));
      if(bounds.Length<1||bounds.Length>8)throw new ArgumentException("Invalid SAFEARRAY rank");
      int type=N(wire,"elementType",12);if(!new[]{2,3,4,5,6,7,8,11,12,14,17}.Contains(type))throw new ArgumentException("Unsupported SAFEARRAY element type");
      var nativeBounds=new ArrayBound[bounds.Length];var coordinates=new int[bounds.Length];long count=1;
      for(int i=0;i<bounds.Length;i++){
        var pair=A(bounds[i]);if(pair.Length!=2)throw new ArgumentException("Invalid SAFEARRAY bounds");
        int lower=Convert.ToInt32(pair[0]);long length=(long)Convert.ToInt32(pair[1])-lower+1;
        if(length<0||length>10000)throw new ArgumentException("Invalid SAFEARRAY length");
        nativeBounds[i]=new ArrayBound {count=(uint)length,lower=lower};coordinates[i]=lower;
        count*=length;if(count>10000)throw new ArgumentException("SAFEARRAY exceeds limit");
      }
      if(count!=data.Length)throw new ArgumentException("SAFEARRAY data mismatch");
      var array=SafeArrayCreate((ushort)type,(uint)bounds.Length,nativeBounds);
      if(array==IntPtr.Zero)throw new OutOfMemoryException("SAFEARRAY allocation failed");
      try{
        for(int i=0;i<bounds.Length;i++){int lower;Marshal.ThrowExceptionForHR(SafeArrayGetLBound(array,(uint)i+1,out lower));if(lower!=nativeBounds[i].lower)throw new InvalidOperationException("SAFEARRAY dimension mapping mismatch");}
        foreach(var value in data){
          var item=NewVariant();
          try{
            ImportNative(value,item,depth+1);
            ushort actual=(ushort)Marshal.ReadInt16(item);
            if(type!=12&&actual!=type)throw new ArgumentException("SAFEARRAY value subtype does not match its descriptor");
            // BSTR is passed directly; other scalar payloads are passed by address.
            var pointer=type==12||type==14?item:type==8?Marshal.ReadIntPtr(item,8):IntPtr.Add(item,8);
            Marshal.ThrowExceptionForHR(SafeArrayPutElement(array,coordinates,pointer));
          }finally{FreeVariant(item);}
          for(int i=coordinates.Length-1;i>=0;i--){if((long)coordinates[i]+1<(long)nativeBounds[i].lower+nativeBounds[i].count){coordinates[i]++;break;}coordinates[i]=nativeBounds[i].lower;}
        }
        Marshal.WriteInt16(output,(short)(8192|type));Marshal.WriteIntPtr(output,8,array);array=IntPtr.Zero;
      }finally{if(array!=IntPtr.Zero)SafeArrayDestroy(array);}
    }
    static object InvokeDirect(Entry target,string member,int mode,int lcid,object[] encoded,object[] byref,Dictionary<string,object> schema){
      var dispatch=(DispatchInvoke)target.Value;var iid=Guid.Empty;var ids=new int[1];
      Marshal.ThrowExceptionForHR(dispatch.GetIDsOfNames(ref iid,new[]{member},1,(uint)lcid,ids));
      var references=new HashSet<int>();
      foreach(var v in byref){int index=Convert.ToInt32(v);if(index<0||index>=encoded.Length||!references.Add(index))throw new ArgumentException("Invalid ByRef index");}
      var args=ZeroMemory(Math.Max(VariantSize,VariantSize*encoded.Length));var result=NewVariant();var named=IntPtr.Zero;var storage=new IntPtr[encoded.Length];
      try{
        var parameters=(List<object>)schema["params"];
        for(int i=0;i<encoded.Length;i++){
          storage[i]=NewVariant();ImportNative(encoded[i],storage[i]);
          var slot=IntPtr.Add(args,(encoded.Length-i-1)*VariantSize);
          if(references.Contains(i)){
            ushort type=i<parameters.Count?(ushort)N(Map(parameters[i]),"vartype",12):(ushort)12;
            if(type!=12){
              if(((ushort)Marshal.ReadInt16(storage[i]))!=type)Marshal.ThrowExceptionForHR(VariantChangeTypeEx(storage[i],storage[i],(uint)lcid,0,type));
              Marshal.WriteInt16(slot,(short)(type|0x4000));Marshal.WriteIntPtr(slot,8,type==14?storage[i]:IntPtr.Add(storage[i],8));
            }else{Marshal.WriteInt16(slot,0x400c);Marshal.WriteIntPtr(slot,8,storage[i]);}
          }else Marshal.ThrowExceptionForHR(VariantCopy(slot,storage[i]));
        }
        var parametersNative=new DISPPARAMS {rgvarg=args,cArgs=encoded.Length};
        if(mode==4||mode==8){named=ZeroMemory(4);Marshal.WriteInt32(named,-3);parametersNative.rgdispidNamedArgs=named;parametersNative.cNamedArgs=1;}
        var error=new EXCEPINFO();uint argumentError;
        int hr=dispatch.Invoke(ids[0],ref iid,(uint)lcid,(ushort)mode,ref parametersNative,result,ref error,out argumentError);
        if(hr<0){
          if(hr==unchecked((int)0x80020009)){if(error.pfnDeferredFillIn!=IntPtr.Zero){var fill=(FillException)Marshal.GetDelegateForFunctionPointer(error.pfnDeferredFillIn,typeof(FillException));Marshal.ThrowExceptionForHR(fill(ref error));}if(error.scode!=0)hr=error.scode;else if(error.wCode!=0)hr=unchecked((int)0x800A0000)|(ushort)error.wCode;}
          throw new NativeDispatchException(error.bstrDescription??("Automation invocation failed: "+member+" (argument "+argumentError+")"),hr,error,argumentError);
        }
        var copyback=new object[encoded.Length];
        for(int i=0;i<copyback.Length;i++)copyback[i]=references.Contains(i)?ExportNative(storage[i]):encoded[i];
        return D("value",ExportNative(result),"args",copyback);
      }finally{
        FreeVariant(result);
        for(int i=0;i<encoded.Length;i++)VariantClear(IntPtr.Add(args,i*VariantSize));
        Marshal.FreeCoTaskMem(args);
        foreach(var p in storage)FreeVariant(p);
        if(named!=IntPtr.Zero)Marshal.FreeCoTaskMem(named);
      }
    }
  }
}
