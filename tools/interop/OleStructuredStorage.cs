// Data-only compound-file reader/writer backed by the installed Windows IStorage.
// No file paths, server activation, OleLoad, or executable moniker parsing occurs.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using STATSTG = System.Runtime.InteropServices.ComTypes.STATSTG;
namespace VB6Interop {
  public static partial class AutomationHost {
    sealed class StorageBudget {public int Entries,Bytes;}
    static void StorageName(string name){if(string.IsNullOrEmpty(name)||name.Length>31||name.IndexOfAny(new[]{'\0','/','\\',':','!'})>=0)throw new COMException("Invalid compound-file element name",unchecked((int)0x800300FC));}
    static void AddStorageBudget(StorageBudget budget,int bytes){if(++budget.Entries>256||bytes<0||bytes>PersistenceLimit-budget.Bytes)throw new NotSupportedException("Structured storage exceeds its data-only limits");budget.Bytes+=bytes;}
    static byte[] ReadStorageStream(IStream stream){
      STATSTG stat;stream.Stat(out stat,1);if(stat.cbSize<0||stat.cbSize>PersistenceLimit)throw new NotSupportedException("Structured stream exceeds 512 KiB");
      var data=new byte[(int)stat.cbSize];IntPtr count=Marshal.AllocCoTaskMem(4);try{stream.Read(data,data.Length,count);if(Marshal.ReadInt32(count)!=data.Length)throw new COMException("Truncated compound-file stream",unchecked((int)0x8003001E));return data;}finally{Marshal.FreeCoTaskMem(count);}
    }
    static void WriteStorageTree(OcxStorage storage,Dictionary<string,object> tree,int depth,StorageBudget budget){
      if(depth>8)throw new NotSupportedException("Structured storage nesting limit");
      if(tree.Keys.Any(k=>!new[]{"classId","entries"}.Contains(k)))throw new ArgumentException("Unknown structured-storage field");
      if(V(tree,"classId")!=null){var clsid=ComGuid(S(tree,"classId"));storage.SetClass(ref clsid);}
      var entries=A(V(tree,"entries",new object[0]));var names=new HashSet<string>(StringComparer.OrdinalIgnoreCase);
      foreach(var raw in entries){var item=Map(raw);string name=S(item,"name"),kind=S(item,"type");StorageName(name);if(!names.Add(name))throw new COMException("Duplicate structured-storage name",unchecked((int)0x80030050));
        if(kind=="stream"){
          if(item.Keys.Any(k=>!new[]{"name","type","data"}.Contains(k)))throw new ArgumentException("Unknown structured-stream field");var bytes=NativeDataBytes(item);AddStorageBudget(budget,bytes.Length);IStream stream=null;IntPtr count=Marshal.AllocCoTaskMem(4);
          try{storage.CreateStream(name,0x12,0,0,out stream);stream.Write(bytes,bytes.Length,count);if(Marshal.ReadInt32(count)!=bytes.Length)throw new COMException("Short compound-file stream write",unchecked((int)0x80030070));stream.Commit(0);}finally{Marshal.FreeCoTaskMem(count);if(stream!=null)Marshal.ReleaseComObject(stream);}
        }else if(kind=="storage"){
          if(item.Keys.Any(k=>!new[]{"name","type","classId","entries"}.Contains(k)))throw new ArgumentException("Unknown nested-storage field");AddStorageBudget(budget,0);OcxStorage child=null;
          try{storage.CreateStorage(name,0x12,0,0,out child);var nested=D("entries",V(item,"entries",new object[0]));if(V(item,"classId")!=null)nested.Add("classId",S(item,"classId"));WriteStorageTree(child,nested,depth+1,budget);child.Commit(0);}finally{if(child!=null)Marshal.ReleaseComObject(child);}
        }else throw new ArgumentException("Only stream and storage elements are supported");
      }
    }
    static object ReadStorageTree(OcxStorage storage,int depth,StorageBudget budget){
      if(depth>8)throw new NotSupportedException("Structured storage nesting limit");STATSTG root;storage.Stat(out root,1);var entries=new List<object>();IEnumSTATSTG enumerator=null;IntPtr buffer=Marshal.AllocCoTaskMem(Marshal.SizeOf(typeof(STATSTG)));
      try{storage.EnumElements(0,IntPtr.Zero,0,out enumerator);
        while(true){Marshal.Copy(new byte[Marshal.SizeOf(typeof(STATSTG))],0,buffer,Marshal.SizeOf(typeof(STATSTG)));uint fetched;int hr=enumerator.Next(1,buffer,out fetched);
          try{Marshal.ThrowExceptionForHR(hr);if(fetched==0)break;if(fetched!=1)throw new COMException("Invalid storage enumeration",unchecked((int)0x80004005));var stat=(STATSTG)Marshal.PtrToStructure(buffer,typeof(STATSTG));StorageName(stat.pwcsName);
            if(stat.type==2){IStream stream=null;try{storage.OpenStream(stat.pwcsName,IntPtr.Zero,0x10,0,out stream);var data=ReadStorageStream(stream);AddStorageBudget(budget,data.Length);entries.Add(D("name",stat.pwcsName,"type","stream","data",Convert.ToBase64String(data)));}finally{if(stream!=null)Marshal.ReleaseComObject(stream);}}
            else if(stat.type==1){AddStorageBudget(budget,0);OcxStorage child=null;try{storage.OpenStorage(stat.pwcsName,null,0x10,IntPtr.Zero,0,out child);var nested=Map(ReadStorageTree(child,depth+1,budget));nested.Add("name",stat.pwcsName);nested.Add("type","storage");entries.Add(nested);}finally{if(child!=null)Marshal.ReleaseComObject(child);}}
            else throw new NotSupportedException("Unknown structured-storage element type");
          }finally{IntPtr name=Marshal.ReadIntPtr(buffer);if(name!=IntPtr.Zero)Marshal.FreeCoTaskMem(name);}
        }
        return D("classId",root.clsid.ToString("D"),"entries",entries);
      }finally{Marshal.FreeCoTaskMem(buffer);if(enumerator!=null)Marshal.ReleaseComObject(enumerator);}
    }
    static object NativeStorageOperation(Dictionary<string,object> request){
      string op=S(request,"op");if(op!="ole.storageWrite"&&op!="ole.storageRead")throw new ArgumentException("Unknown structured-storage operation");
      OcxLockBytes bytes=null;OcxStorage storage=null;
      try{Marshal.ThrowExceptionForHR(CreateILockBytesOnHGlobal(IntPtr.Zero,true,out bytes));
        if(op=="ole.storageWrite"){
          Marshal.ThrowExceptionForHR(StgCreateDocfileOnILockBytes(bytes,0x1012,0,out storage));WriteStorageTree(storage,Map(V(request,"tree")),0,new StorageBudget());storage.Commit(0);
          STATSTG stat;bytes.Stat(out stat,1);if(stat.cbSize<0||stat.cbSize>PersistenceLimit)throw new NotSupportedException("Compound file including directory/FAT exceeds 512 KiB");var data=new byte[(int)stat.cbSize];int read;bytes.ReadAt(0,data,data.Length,out read);if(read!=data.Length)throw new COMException("Truncated compound-file image",unchecked((int)0x8003001E));return D("data",Convert.ToBase64String(data),"bytes",data.Length);
        }
        var input=NativeDataBytes(request);int written;bytes.WriteAt(0,input,input.Length,out written);if(written!=input.Length)throw new COMException("Truncated compound-file input",unchecked((int)0x80030070));Marshal.ThrowExceptionForHR(StgOpenStorageOnILockBytes(bytes,null,0x10,IntPtr.Zero,0,out storage));return ReadStorageTree(storage,0,new StorageBudget());
      }finally{if(storage!=null)Marshal.ReleaseComObject(storage);if(bytes!=null)Marshal.ReleaseComObject(bytes);}
    }
  }
}
