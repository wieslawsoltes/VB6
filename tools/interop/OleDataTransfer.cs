// Bounded native IDataObject/FORMATETC/STGMEDIUM services. Borrowed callback media
// are copied during the callback, without retaining or releasing the source medium.
using System;
using System.Collections.Generic;
using System.Linq;
using System.Windows.Forms;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
using IEnumSTATDATA=VB6Interop.OleEnumStatData;
using STATSTG = System.Runtime.InteropServices.ComTypes.STATSTG;
using NativeDataInterface=VB6Interop.OleDataInterface;
namespace VB6Interop {
  [ComImport,Guid("00000110-0000-0000-C000-000000000046"),InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  interface NativeDataAdviseHolder {
    [PreserveSig]int Advise(NativeDataInterface source,ref FORMATETC format,ADVF flags,IAdviseSink sink,out int cookie);
    [PreserveSig]int Unadvise(int cookie);
    [PreserveSig]int EnumAdvise(out IEnumSTATDATA enumerator);
    [PreserveSig]int SendOnDataChange(NativeDataInterface source,int reserved,ADVF flags);
  }
  static class NativeOleMedium {
    public const int Limit=512*1024;
    public const int FormatError=unchecked((int)0x80040064),AspectError=unchecked((int)0x8004006B),IndexError=unchecked((int)0x80040068),MediumError=unchecked((int)0x80040069);
    [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr GlobalAlloc(uint flags,UIntPtr bytes);
    [DllImport("kernel32.dll",SetLastError=true)]static extern IntPtr GlobalLock(IntPtr memory);
    [DllImport("kernel32.dll",SetLastError=true)][return:MarshalAs(UnmanagedType.Bool)]static extern bool GlobalUnlock(IntPtr memory);
    [DllImport("kernel32.dll",SetLastError=true)]static extern UIntPtr GlobalSize(IntPtr memory);
    [DllImport("kernel32.dll")]static extern IntPtr GlobalFree(IntPtr memory);
    [DllImport("ole32.dll")]static extern int CreateStreamOnHGlobal(IntPtr memory,[MarshalAs(UnmanagedType.Bool)]bool delete,out IStream stream);
    [DllImport("ole32.dll",EntryPoint="ReleaseStgMedium")]public static extern void Release(ref STGMEDIUM medium);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int StreamSeek(IntPtr self,long offset,int origin,out long position);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int StreamRead(IntPtr self,IntPtr buffer,int count,out int read);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int StreamWrite(IntPtr self,IntPtr buffer,int count,out int written);
    [UnmanagedFunctionPointer(CallingConvention.StdCall)]delegate int StreamStat(IntPtr self,out STATSTG stat,int flags);
    static T Method<T>(IntPtr self,int slot)where T:class{if(self==IntPtr.Zero)throw new COMException("Null stream",unchecked((int)0x80004003));return Marshal.GetDelegateForFunctionPointer(Marshal.ReadIntPtr(Marshal.ReadIntPtr(self),slot*IntPtr.Size),typeof(T)) as T;}
    public static void CheckFormat(FORMATETC format,bool single=false,bool wildcard=false){
      if(wildcard&&format.cfFormat==0&&(int)format.dwAspect==-1&&format.lindex==-1&&(int)format.tymed==-1&&format.ptd==IntPtr.Zero)return;
      if(format.ptd!=IntPtr.Zero||(ushort)format.cfFormat==0)throw new COMException("Target-device descriptors are not transported",FormatError);
      if(!new[]{1,2,4,8}.Contains((int)format.dwAspect))throw new COMException("Unsupported aspect",AspectError);
      if(format.lindex< -1)throw new COMException("Invalid format index",IndexError);
      int kind=(int)format.tymed;if(kind==0||(kind&~5)!=0||single&&!new[]{1,4}.Contains(kind))throw new COMException("Only HGLOBAL and IStream media are transported",MediumError);
    }
    public static byte[] Read(ref STGMEDIUM medium){
      if(medium.tymed==TYMED.TYMED_HGLOBAL){
        if(medium.unionmember==IntPtr.Zero)throw new COMException("Null HGLOBAL",unchecked((int)0x80004003));
        ulong size=GlobalSize(medium.unionmember).ToUInt64();if(size>Limit)throw new COMException("OLE medium exceeds 512 KiB",unchecked((int)0x80030070));
        var result=new byte[(int)size];if(size==0)return result;IntPtr source=GlobalLock(medium.unionmember);if(source==IntPtr.Zero)throw new COMException("Cannot lock OLE medium",unchecked((int)0x80070006));
        try{Marshal.Copy(source,result,0,result.Length);return result;}finally{GlobalUnlock(medium.unionmember);}
      }
      if(medium.tymed!=TYMED.TYMED_ISTREAM)throw new COMException("Unsupported OLE medium",MediumError);
      IntPtr stream=medium.unionmember;STATSTG stat;Marshal.ThrowExceptionForHR(Method<StreamStat>(stream,12)(stream,out stat,1));
      if(stat.cbSize<0||stat.cbSize>Limit)throw new COMException("OLE stream exceeds 512 KiB",unchecked((int)0x80030070));
      var bytes=new byte[(int)stat.cbSize];var seek=Method<StreamSeek>(stream,5);long original,position;Marshal.ThrowExceptionForHR(seek(stream,0,1,out original));IntPtr buffer=IntPtr.Zero;
      try{Marshal.ThrowExceptionForHR(seek(stream,0,0,out position));if(bytes.Length==0)return bytes;buffer=Marshal.AllocCoTaskMem(bytes.Length);var read=Method<StreamRead>(stream,3);int offset=0;
        while(offset<bytes.Length){int count;Marshal.ThrowExceptionForHR(read(stream,IntPtr.Add(buffer,offset),bytes.Length-offset,out count));if(count<=0||count>bytes.Length-offset)throw new COMException("Truncated or invalid OLE stream read",unchecked((int)0x8003001E));offset+=count;}
        Marshal.Copy(buffer,bytes,0,bytes.Length);return bytes;
      }finally{try{Marshal.ThrowExceptionForHR(seek(stream,original,0,out position));}finally{if(buffer!=IntPtr.Zero)Marshal.FreeCoTaskMem(buffer);}}
    }
    public static STGMEDIUM Create(TYMED kind,byte[] bytes){
      if(bytes==null||bytes.Length>Limit)throw new ArgumentException("OLE medium limit");
      if(kind==TYMED.TYMED_HGLOBAL){IntPtr memory=GlobalAlloc(0x42,new UIntPtr((uint)bytes.Length));if(memory==IntPtr.Zero)throw new OutOfMemoryException();
        try{if(bytes.Length>0){IntPtr target=GlobalLock(memory);if(target==IntPtr.Zero)throw new OutOfMemoryException();try{Marshal.Copy(bytes,0,target,bytes.Length);}finally{GlobalUnlock(memory);}}return new STGMEDIUM{tymed=kind,unionmember=memory,pUnkForRelease=null};}catch{GlobalFree(memory);throw;}
      }
      if(kind!=TYMED.TYMED_ISTREAM)throw new COMException("Unsupported OLE medium",MediumError);
      IStream stream=null;IntPtr count=Marshal.AllocCoTaskMem(4);
      try{Marshal.ThrowExceptionForHR(CreateStreamOnHGlobal(IntPtr.Zero,true,out stream));stream.Write(bytes,bytes.Length,count);if(Marshal.ReadInt32(count)!=bytes.Length)throw new COMException("Short OLE stream write",unchecked((int)0x80030070));stream.Seek(0,0,IntPtr.Zero);return new STGMEDIUM{tymed=kind,unionmember=Marshal.GetComInterfaceForObject(stream,typeof(IStream)),pUnkForRelease=null};}
      finally{Marshal.FreeCoTaskMem(count);if(stream!=null)Marshal.ReleaseComObject(stream);}
    }
    public static void WriteHere(ref STGMEDIUM medium,byte[] bytes){
      if(medium.pUnkForRelease!=null)throw new ArgumentException("GetDataHere requires caller-owned storage");
      if(medium.tymed==TYMED.TYMED_HGLOBAL){if(medium.unionmember==IntPtr.Zero||GlobalSize(medium.unionmember).ToUInt64()<(ulong)bytes.Length)throw new COMException("GetDataHere buffer is too small",unchecked((int)0x80030070));if(bytes.Length==0)return;
        IntPtr target=GlobalLock(medium.unionmember);if(target==IntPtr.Zero)throw new COMException("Cannot lock GetDataHere buffer",unchecked((int)0x80070006));try{Marshal.Copy(bytes,0,target,bytes.Length);}finally{GlobalUnlock(medium.unionmember);}return;
      }
      if(medium.tymed!=TYMED.TYMED_ISTREAM)throw new COMException("Unsupported GetDataHere medium",MediumError);
      IntPtr buffer=Marshal.AllocCoTaskMem(Math.Max(1,bytes.Length));try{if(bytes.Length>0)Marshal.Copy(bytes,0,buffer,bytes.Length);int written;Marshal.ThrowExceptionForHR(Method<StreamWrite>(medium.unionmember,4)(medium.unionmember,buffer,bytes.Length,out written));if(written!=bytes.Length)throw new COMException("Short GetDataHere stream write",unchecked((int)0x80030070));}finally{Marshal.FreeCoTaskMem(buffer);}
    }
  }
  [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
  public sealed class NativeFormatEnumerator:IEnumFORMATETC {
    readonly FORMATETC[] formats;int position;
    public NativeFormatEnumerator(FORMATETC[] source,int start=0){formats=(FORMATETC[])source.Clone();position=start;}
    public int Next(int count,FORMATETC[] output,int[] fetched){if(count<0||count>256||output==null||output.Length<count||fetched!=null&&fetched.Length<1||count!=1&&fetched==null)return unchecked((int)0x80070057);int n=Math.Min(count,formats.Length-position);Array.Copy(formats,position,output,0,n);position+=n;if(fetched!=null)fetched[0]=n;return n==count?0:1;}
    public int Skip(int count){if(count<0)return unchecked((int)0x80070057);int n=Math.Min(count,formats.Length-position);position+=n;return n==count?0:1;}
    public int Reset(){position=0;return 0;}
    public void Clone(out IEnumFORMATETC value){value=new NativeFormatEnumerator(formats,position);}
  }
  [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
  public sealed class NativeOleDataObject:NativeDataInterface {
    sealed class Item {public FORMATETC Format;public byte[] Data;}
    readonly List<Item> items=new List<Item>();NativeDataAdviseHolder holder;bool stopped;
    [DllImport("ole32.dll")]static extern int CreateDataAdviseHolder(out NativeDataAdviseHolder value);
    Item Find(FORMATETC format){
      NativeOleMedium.CheckFormat(format);var found=items.Where(x=>x.Format.cfFormat==format.cfFormat).ToArray();if(found.Length==0)throw new COMException("Clipboard format unavailable",NativeOleMedium.FormatError);
      found=found.Where(x=>x.Format.dwAspect==format.dwAspect).ToArray();if(found.Length==0)throw new COMException("Aspect unavailable",NativeOleMedium.AspectError);
      found=found.Where(x=>x.Format.lindex==format.lindex).ToArray();if(found.Length==0)throw new COMException("Format index unavailable",NativeOleMedium.IndexError);
      var result=found.FirstOrDefault(x=>(x.Format.tymed&format.tymed)!=0);if(result==null)throw new COMException("Medium unavailable",NativeOleMedium.MediumError);return result;
    }
    public void GetData(ref FORMATETC format,out STGMEDIUM medium){var item=Find(format);medium=NativeOleMedium.Create(item.Format.tymed,item.Data);}
    public void GetDataHere(ref FORMATETC format,ref STGMEDIUM medium){var item=Find(format);if((format.tymed&medium.tymed)==0)throw new COMException("GetDataHere medium mismatch",NativeOleMedium.MediumError);NativeOleMedium.WriteHere(ref medium,item.Data);}
    public int QueryGetData(ref FORMATETC format){try{Find(format);return 0;}catch(Exception error){return error.HResult;}}
    public int GetCanonicalFormatEtc(ref FORMATETC input,out FORMATETC output){output=input;output.ptd=IntPtr.Zero;return 0x40130;}
    public void SetData(ref FORMATETC format,ref STGMEDIUM medium,bool release){
      NativeOleMedium.CheckFormat(format,true);if(stopped)throw new InvalidOperationException("OLE data object was stopped");if(format.tymed!=medium.tymed)throw new COMException("SetData medium mismatch",NativeOleMedium.MediumError);
      var data=NativeOleMedium.Read(ref medium);FORMATETC copy=format;var previous=items.FirstOrDefault(x=>x.Format.cfFormat==copy.cfFormat&&x.Format.dwAspect==copy.dwAspect&&x.Format.lindex==copy.lindex&&x.Format.tymed==copy.tymed);
      if(previous==null&&items.Count>=256||items.Where(x=>x!=previous).Sum(x=>x.Data.Length)+data.Length>NativeOleMedium.Limit)throw new COMException("OLE data object capacity exceeded",unchecked((int)0x80030070));
      if(previous!=null)items.Remove(previous);items.Add(new Item{Format=copy,Data=data});if(release){NativeOleMedium.Release(ref medium);medium=new STGMEDIUM();}
      if(holder!=null)holder.SendOnDataChange(this,0,0);
    }
    public IEnumFORMATETC EnumFormatEtc(DATADIR direction){if(direction!=DATADIR.DATADIR_GET&&direction!=DATADIR.DATADIR_SET)throw new ArgumentException("Invalid data direction");return new NativeFormatEnumerator(items.Select(x=>x.Format).ToArray());}
    int AdviceCount(){if(holder==null)return 0;IEnumSTATDATA enumerator=null;int count=0;try{Marshal.ThrowExceptionForHR(holder.EnumAdvise(out enumerator));var rows=new STATDATA[1];var fetched=new int[1];while(true){fetched[0]=0;int hr=enumerator.Next(1,rows,fetched);Marshal.ThrowExceptionForHR(hr);if(fetched[0]==0)break;try{if(++count>=256)break;}finally{if(rows[0].formatetc.ptd!=IntPtr.Zero)Marshal.FreeCoTaskMem(rows[0].formatetc.ptd);if(rows[0].advSink!=null&&Marshal.IsComObject(rows[0].advSink))Marshal.ReleaseComObject(rows[0].advSink);}}return count;}finally{if(enumerator!=null&&Marshal.IsComObject(enumerator))Marshal.ReleaseComObject(enumerator);}}
    public int DAdvise(ref FORMATETC format,ADVF flags,IAdviseSink sink,out int connection){connection=0;try{
      if(stopped)throw new InvalidOperationException("OLE data object was stopped");if(((int)flags&~71)!=0)throw new COMException("Advisory flags unsupported",unchecked((int)0x80040003));NativeOleMedium.CheckFormat(format,false,((int)flags&1)!=0);
      // IDataObject permits treating DATAONSTOP as NODATA when specified alone.
      // Match the portable implementation rather than the holder's ignore policy.
      if(((int)flags&64)!=0)flags|=(ADVF)1;
      if(sink==null)throw new ArgumentNullException("sink");if(AdviceCount()>=256)throw new COMException("OLE advisory limit",unchecked((int)0x80040201));if(holder==null)Marshal.ThrowExceptionForHR(CreateDataAdviseHolder(out holder));return holder.Advise(this,ref format,flags,sink,out connection);
    }catch(Exception error){return error.HResult;}}
    public void DUnadvise(int connection){if(holder==null)throw new COMException("No advisory connection",unchecked((int)0x80040004));Marshal.ThrowExceptionForHR(holder.Unadvise(connection),new IntPtr(-1));}
    public int EnumDAdvise(out IEnumSTATDATA enumerator){if(holder==null)Marshal.ThrowExceptionForHR(CreateDataAdviseHolder(out holder));return holder.EnumAdvise(out enumerator);}
    public void Stop(){if(stopped)return;stopped=true;if(holder!=null)holder.SendOnDataChange(this,0,(ADVF)64);}
  }
  [ComVisible(true),ClassInterface(ClassInterfaceType.None)]
  public sealed class NativeDataChangeSink:IAdviseSink {
    readonly Action<FORMATETC,STGMEDIUM> changed;public int Deliveries;
    public NativeDataChangeSink(Action<FORMATETC,STGMEDIUM> callback){changed=callback;}
    public void OnDataChange(ref FORMATETC format,ref STGMEDIUM medium){Deliveries++;changed(format,medium);}
    public void OnViewChange(int aspect,int index){}public void OnRename(IMoniker moniker){}public void OnSave(){}public void OnClose(){}
  }
  public static partial class AutomationHost {
    sealed class NativeDataConnection {public string Handle;public int Cookie;public NativeDataChangeSink Sink;public bool Once;}
    static readonly Dictionary<string,NativeDataConnection> NativeDataConnections=new Dictionary<string,NativeDataConnection>();
    static readonly Queue<Dictionary<string,object>> NativeDataChanges=new Queue<Dictionary<string,object>>();
    static int NativeDataSequence,NativeDataChangeBytes,NativeDataDropped;
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern uint RegisterClipboardFormat(string name);
    [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)]static extern int GetClipboardFormatName(uint format,System.Text.StringBuilder name,int capacity);
    static FORMATETC NativeFormat(Dictionary<string,object> wire,bool single=false,bool wildcard=false){
      if(wire.Keys.Any(k=>!new[]{"cfFormat","dwAspect","lindex","tymed"}.Contains(k)))throw new ArgumentException("Unknown FORMATETC field");
      var result=new FORMATETC{cfFormat=unchecked((short)ComInteger(wire,"cfFormat",0,0,65535)),dwAspect=(DVASPECT)ComInteger(wire,"dwAspect",1,-1,8),lindex=ComInteger(wire,"lindex",-1,-1,int.MaxValue),tymed=(TYMED)ComInteger(wire,"tymed",1,-1,127),ptd=IntPtr.Zero};NativeOleMedium.CheckFormat(result,single,wildcard);return result;
    }
    static object FormatWire(FORMATETC format){return D("cfFormat",(ushort)format.cfFormat,"dwAspect",(int)format.dwAspect,"lindex",format.lindex,"tymed",(int)format.tymed,"targetDevice",format.ptd!=IntPtr.Zero);}
    static byte[] NativeDataBytes(Dictionary<string,object> request,string key="data"){
      string text=S(request,key);if(text.Length>699052)throw new ArgumentException("OLE data exceeds 512 KiB");byte[] bytes=Convert.FromBase64String(text);if(bytes.Length>NativeOleMedium.Limit||Convert.ToBase64String(bytes)!=text)throw new ArgumentException("OLE data must be canonical bounded base64");return bytes;
    }
    static void RecordNativeDataChange(string token,FORMATETC format,STGMEDIUM medium){
      var row=D("connection",token,"kind","data","format",FormatWire(format),"tymed",(int)medium.tymed);
      try{if(medium.tymed!=0)row.Add("data",Convert.ToBase64String(NativeOleMedium.Read(ref medium)));}
      catch(Exception error){row.Add("snapshotError",error.Message);row.Add("hresult",unchecked((uint)error.HResult));}
      QueueComNotification(row);
    }
    static void QueueComNotification(Dictionary<string,object> row){
      int size=Json.Serialize(row).Length;while(NativeDataChanges.Count>0&&(NativeDataChanges.Count>=64||NativeDataChangeBytes+size>Limit)){NativeDataChangeBytes-=Json.Serialize(NativeDataChanges.Dequeue()).Length;NativeDataDropped++;}
      if(size>Limit){NativeDataDropped++;return;}NativeDataChanges.Enqueue(row);NativeDataChangeBytes+=size;
    }
    static void DisconnectNativeData(string token){NativeDataConnection connection;if(!NativeDataConnections.TryGetValue(token,out connection))throw new ArgumentException("Unknown data advisory connection");
      NativeDataConnections.Remove(token);try{((NativeDataInterface)ObjectAt(connection.Handle).Value).DUnadvise(connection.Cookie);}catch(COMException error){if(!(connection.Once&&connection.Sink.Deliveries>0&&error.ErrorCode==unchecked((int)0x80040004)))throw;}
    }
    static void ReleaseNativeDataConnections(string handle){
      var errors=new List<Exception>();var data=ObjectAt(handle).Value as NativeOleDataObject;if(data!=null)data.Stop();
      foreach(var pair in NativeDataConnections.Where(x=>x.Value.Handle==handle).ToArray())try{DisconnectNativeData(pair.Key);}catch(Exception error){errors.Add(error);}
      if(errors.Count>0)throw new AggregateException("OLE advisory cleanup failed",errors);
    }
    static object NativeDataOperation(Dictionary<string,object> request){
      string op=S(request,"op");
      if(op=="ole.dataCreate")return ExportNativeData(new NativeOleDataObject());
      if(op=="ole.dataRegisterFormat"){string name=S(request,"name");if(name.Length==0||name.Length>255||name.IndexOf('\0')>=0)throw new ArgumentException("Invalid format name");uint id=RegisterClipboardFormat(name);if(id==0)throw new System.ComponentModel.Win32Exception();return D("cfFormat",id);}
      if(op=="ole.dataFormatName"){uint id=(uint)ComInteger(request,"cfFormat",0,0xC000,0xFFFF);var name=new System.Text.StringBuilder(256);int count=GetClipboardFormatName(id,name,name.Capacity);return D("name",count>0?name.ToString():null);}
      if(op=="ole.dataChanges"){Application.DoEvents();var rows=NativeDataChanges.ToArray();int dropped=NativeDataDropped;NativeDataChanges.Clear();NativeDataChangeBytes=0;NativeDataDropped=0;return D("notifications",rows,"dropped",dropped);}
      if(op=="ole.dataUnadvise"){DisconnectNativeData(S(request,"connection"));return D("unadvised",true);}
      string handle=S(request,"handle");var data=ObjectAt(handle).Value as NativeDataInterface;if(data==null)throw new COMException("Object does not implement IDataObject",unchecked((int)0x80004002));
      if(op=="ole.dataFormats"){
        IEnumFORMATETC enumerator=null;var rows=new List<object>();
        try{enumerator=data.EnumFormatEtc((DATADIR)ComInteger(request,"direction",1,1,2));var output=new FORMATETC[1];var fetched=new int[1];
          while(true){fetched[0]=0;int hr=enumerator.Next(1,output,fetched);Marshal.ThrowExceptionForHR(hr);if(fetched[0]==0)break;try{if(rows.Count>=256)throw new NotSupportedException("Native format enumeration limit");rows.Add(FormatWire(output[0]));}finally{if(output[0].ptd!=IntPtr.Zero)Marshal.FreeCoTaskMem(output[0].ptd);}}return rows;
        }finally{if(enumerator!=null&&Marshal.IsComObject(enumerator))Marshal.ReleaseComObject(enumerator);}
      }
      if(op=="ole.dataAdvise"){
        if(NativeDataConnections.Count>=256)throw new NotSupportedException("Native advisory connection limit");int flags=ComInteger(request,"flags",0,0,71);if((flags&~71)!=0)throw new ArgumentException("Unknown advisory flags");var format=NativeFormat(Map(V(request,"format")),false,(flags&1)!=0);
        string token="d"+(++NativeDataSequence);var sink=new NativeDataChangeSink((f,m)=>RecordNativeDataChange(token,f,m));int cookie;Marshal.ThrowExceptionForHR(data.DAdvise(ref format,(ADVF)flags,sink,out cookie));NativeDataConnections.Add(token,new NativeDataConnection{Handle=handle,Cookie=cookie,Sink=sink,Once=(flags&4)!=0});return D("connection",token);
      }
      var requested=NativeFormat(Map(V(request,"format")),op=="ole.dataSet"||op=="ole.dataGetHere");
      if(op=="ole.dataQuery")return D("hresult",unchecked((uint)data.QueryGetData(ref requested)));
      if(op=="ole.dataCanonical"){FORMATETC result;int hr=data.GetCanonicalFormatEtc(ref requested,out result);try{Marshal.ThrowExceptionForHR(hr);return D("hresult",unchecked((uint)hr),"format",FormatWire(result));}finally{if(result.ptd!=IntPtr.Zero)Marshal.FreeCoTaskMem(result.ptd);}}
      if(op=="ole.dataGet"){STGMEDIUM medium=new STGMEDIUM();try{data.GetData(ref requested,out medium);var bytes=NativeOleMedium.Read(ref medium);return D("tymed",(int)medium.tymed,"data",Convert.ToBase64String(bytes),"bytes",bytes.Length);}finally{if(medium.tymed!=0)NativeOleMedium.Release(ref medium);}}
      if(op=="ole.dataSet"){var bytes=NativeDataBytes(request);var medium=NativeOleMedium.Create(requested.tymed,bytes);try{data.SetData(ref requested,ref medium,false);return D("set",true);}finally{NativeOleMedium.Release(ref medium);}}
      if(op=="ole.dataGetHere"){var medium=NativeOleMedium.Create(requested.tymed,NativeDataBytes(request));try{data.GetDataHere(ref requested,ref medium);var bytes=NativeOleMedium.Read(ref medium);return D("tymed",(int)medium.tymed,"data",Convert.ToBase64String(bytes),"bytes",bytes.Length);}finally{NativeOleMedium.Release(ref medium);}}
      throw new ArgumentException("Unknown native OLE data operation");
    }
  }
}
