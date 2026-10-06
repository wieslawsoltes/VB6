# Original reference probe: actual installed Windows API entry points, never the JS implementation.
$ErrorActionPreference = 'Stop'
New-Item -ItemType Directory -Force reports/win32-services-native | Out-Null
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ServiceOracle {
 [DllImport("kernel32.dll",SetLastError=true)] static extern int MultiByteToWideChar(uint cp,uint flags,byte[] input,int count,IntPtr output,int capacity);
 [DllImport("kernel32.dll",SetLastError=true)] static extern int WideCharToMultiByte(uint cp,uint flags,[MarshalAs(UnmanagedType.LPWStr)]string input,int count,IntPtr output,int capacity,IntPtr def,IntPtr used);
 [DllImport("crypt32.dll",EntryPoint="CryptBinaryToStringA",SetLastError=true)] static extern int EncodeA(byte[] input,uint count,uint flags,IntPtr output,ref uint size);
 [DllImport("crypt32.dll",EntryPoint="CryptBinaryToStringW",SetLastError=true)] static extern int EncodeW(byte[] input,uint count,uint flags,IntPtr output,ref uint size);
 [DllImport("crypt32.dll",EntryPoint="CryptStringToBinaryA",SetLastError=true)] static extern int DecodeA([MarshalAs(UnmanagedType.LPStr)]string input,uint count,uint flags,IntPtr output,ref uint size,out uint skip,out uint actual);
 [DllImport("crypt32.dll",EntryPoint="CryptStringToBinaryW",SetLastError=true)] static extern int DecodeW([MarshalAs(UnmanagedType.LPWStr)]string input,uint count,uint flags,IntPtr output,ref uint size,out uint skip,out uint actual);
 [DllImport("shlwapi.dll",EntryPoint="PathCombineA")] static extern IntPtr CombineA(IntPtr output,[MarshalAs(UnmanagedType.LPStr)]string dir,[MarshalAs(UnmanagedType.LPStr)]string file);
 [DllImport("shlwapi.dll",EntryPoint="PathCombineW")] static extern IntPtr CombineW(IntPtr output,[MarshalAs(UnmanagedType.LPWStr)]string dir,[MarshalAs(UnmanagedType.LPWStr)]string file);
 [DllImport("shlwapi.dll",EntryPoint="PathCanonicalizeA")] static extern int CanonicalA(IntPtr output,[MarshalAs(UnmanagedType.LPStr)]string path);
 [DllImport("shlwapi.dll",EntryPoint="PathCanonicalizeW")] static extern int CanonicalW(IntPtr output,[MarshalAs(UnmanagedType.LPWStr)]string path);
 [DllImport("shlwapi.dll",EntryPoint="PathRemoveBackslashA")] static extern IntPtr RemoveA(IntPtr path);
 [DllImport("shlwapi.dll",EntryPoint="PathRemoveBackslashW")] static extern IntPtr RemoveW(IntPtr path);
 [DllImport("shlwapi.dll",EntryPoint="PathIsRelativeA")] static extern int RelativeA([MarshalAs(UnmanagedType.LPStr)]string path);
 [DllImport("shlwapi.dll",EntryPoint="PathIsRelativeW")] static extern int RelativeW([MarshalAs(UnmanagedType.LPWStr)]string path);
 [DllImport("ole32.dll")] static extern int CLSIDFromString([MarshalAs(UnmanagedType.LPWStr)]string text,IntPtr guid);
 [DllImport("ole32.dll")] static extern int StringFromGUID2(IntPtr guid,IntPtr output,int size);
 [DllImport("kernel32.dll",EntryPoint="CreateEventA",SetLastError=true)] static extern IntPtr Event(IntPtr sa,int manual,int initial,IntPtr name);
 [DllImport("kernel32.dll",EntryPoint="CreateSemaphoreA",SetLastError=true)] static extern IntPtr Semaphore(IntPtr sa,int initial,int maximum,IntPtr name);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForSingleObject(IntPtr h,uint timeout);
 [DllImport("kernel32.dll",SetLastError=true)] static extern uint WaitForMultipleObjects(uint count,IntPtr[] handles,int all,uint timeout);
 [DllImport("kernel32.dll",SetLastError=true)] static extern int ReleaseSemaphore(IntPtr h,int count,IntPtr previous);
 [DllImport("kernel32.dll")] static extern int SetEvent(IntPtr h);
 [DllImport("kernel32.dll")] static extern int ResetEvent(IntPtr h);
 [DllImport("kernel32.dll")] static extern int CloseHandle(IntPtr h);
 [DllImport("kernel32.dll",CharSet=CharSet.Ansi)] static extern ushort GlobalAddAtomA(string name);
 [DllImport("kernel32.dll",CharSet=CharSet.Ansi)] static extern ushort GlobalFindAtomA(string name);
 [DllImport("kernel32.dll")] static extern uint GlobalGetAtomNameA(ushort atom,IntPtr output,int size);
 [DllImport("kernel32.dll")] static extern ushort GlobalDeleteAtom(ushort atom);
 [DllImport("user32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateWindowExW(uint ex,string cls,string text,uint style,int x,int y,int width,int height,IntPtr parent,IntPtr menu,IntPtr instance,IntPtr param);
 [DllImport("user32.dll")] static extern int DestroyWindow(IntPtr window);
 [DllImport("user32.dll",CharSet=CharSet.Ansi)] static extern int SetPropA(IntPtr window,string name,IntPtr value);
 [DllImport("user32.dll",CharSet=CharSet.Ansi)] static extern IntPtr GetPropA(IntPtr window,string name);
 [DllImport("user32.dll",CharSet=CharSet.Ansi)] static extern IntPtr RemovePropA(IntPtr window,string name);
 [UnmanagedFunctionPointer(CallingConvention.Winapi)] delegate int PropertyCallback(IntPtr window,IntPtr name,IntPtr value,IntPtr context);
 [DllImport("user32.dll")] static extern int EnumPropsExA(IntPtr window,PropertyCallback callback,IntPtr context);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegCreateKeyExW(IntPtr root,string name,uint reserved,IntPtr cls,uint options,uint access,IntPtr security,out IntPtr key,IntPtr disposition);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegSetValueExW(IntPtr key,string name,uint reserved,uint type,byte[] data,uint size);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegQueryInfoKeyW(IntPtr key,IntPtr cls,IntPtr clsSize,IntPtr reserved,out uint subkeys,out uint maxSubkey,IntPtr maxClass,out uint values,out uint maxName,out uint maxData,IntPtr security,IntPtr time);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegEnumValueW(IntPtr key,uint index,IntPtr name,ref uint nameSize,IntPtr reserved,out uint type,IntPtr data,ref uint dataSize);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegEnumKeyW(IntPtr key,uint index,IntPtr name,uint size);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegDeleteKeyW(IntPtr key,string name);
 [DllImport("advapi32.dll",CharSet=CharSet.Unicode)] static extern int RegDeleteValueW(IntPtr key,string name);
 [DllImport("advapi32.dll")] static extern int RegCloseKey(IntPtr key);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr FindFirstFileW(string pattern,IntPtr data);
 [DllImport("kernel32.dll",SetLastError=true)] static extern int FindNextFileW(IntPtr h,IntPtr data);
 [DllImport("kernel32.dll")] static extern int FindClose(IntPtr h);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern IntPtr CreateFileW(string path,uint access,uint share,IntPtr sa,uint disposition,uint flags,IntPtr template);
 [DllImport("kernel32.dll",SetLastError=true)] static extern int GetFileSizeEx(IntPtr h,out long size);
 [DllImport("kernel32.dll",SetLastError=true)] static extern int FlushFileBuffers(IntPtr h);
 static readonly Dictionary<string,object> result=new Dictionary<string,object>();
 static string Hex(IntPtr p,int count){byte[] b=new byte[count];Marshal.Copy(p,b,0,count);return BitConverter.ToString(b).Replace("-","");}
 static string Text(IntPtr p,bool wide){return wide?Marshal.PtrToStringUni(p):Marshal.PtrToStringAnsi(p);}
 static void Multi(string key,uint cp,uint flags,byte[] bytes,int count){IntPtr output=Marshal.AllocHGlobal(128);try{int q=MultiByteToWideChar(cp,flags,bytes,count,IntPtr.Zero,0),n=MultiByteToWideChar(cp,flags,bytes,count,output,64),error=n==0?Marshal.GetLastWin32Error():0;result[key]=new object[]{q,n,error,Hex(output,n*2)};}finally{Marshal.FreeHGlobal(output);}}
 static void Wide(string key,uint cp,uint flags,string text,int count){IntPtr output=Marshal.AllocHGlobal(128),used=Marshal.AllocHGlobal(4);Marshal.WriteInt32(used,0);try{IntPtr usedParam=cp==1252?used:IntPtr.Zero;int q=WideCharToMultiByte(cp,flags,text,count,IntPtr.Zero,0,IntPtr.Zero,usedParam),n=WideCharToMultiByte(cp,flags,text,count,output,128,IntPtr.Zero,usedParam),error=n==0?Marshal.GetLastWin32Error():0;result[key]=new object[]{q,n,error,Hex(output,n),cp==1252?Marshal.ReadInt32(used):0};}finally{Marshal.FreeHGlobal(output);Marshal.FreeHGlobal(used);}}
 public static object Run(){
  result.Clear();
  Multi("utf8-terminated",65001,8,new byte[]{65,195,169,226,130,172,0},-1);
  Multi("utf8-astral",65001,8,new byte[]{65,240,159,152,128},5);
  Multi("utf8-bom",65001,8,new byte[]{239,187,191,65},4);
  Multi("utf8-invalid",65001,8,new byte[]{195,40},2);
  Multi("ansi-composite",1252,2,new byte[]{233},1);
  Wide("wide-utf8",65001,128,"Aé€",-1);Wide("wide-invalid",65001,128,"\ud800",1);Wide("ansi-replacement",1252,1024,"A界B",3);Wide("ansi-astral",1252,1024,"😀",2);
  Wide("ansi-astral-tail",1252,1024,"A😀é",4);Wide("ansi-unpaired",1252,1024,"\ud800A\udc00",3);Wide("ansi-astral-terminated",1252,1024,"😀",-1);
  foreach(bool wide in new[]{false,true}){string suffix=wide?"W":"A";IntPtr output=Marshal.AllocHGlobal(520);try{
   byte[] longData=new byte[51];for(int i=0;i<51;i++)longData[i]=(byte)i;
   string[] labels={"crlf","lf","nowrap","empty","wrap"};byte[][] data={new byte[]{0,255,1,254,2},new byte[]{77},new byte[]{77},new byte[0],longData};uint[] flags={1,0x80000001,0x40000001,1,1};
   // A managed zero-length array marshals as NULL. Use an allocated one-byte
   // array with a zero count to match the JS probe's non-NULL empty buffer.
   for(int i=0;i<labels.Length;i++){byte[] binary=data[i].Length==0?new byte[1]:data[i];uint n=0;int query=wide?EncodeW(binary,(uint)data[i].Length,flags[i],IntPtr.Zero,ref n):EncodeA(binary,(uint)data[i].Length,flags[i],IntPtr.Zero,ref n);if(query==0)throw new InvalidOperationException("Base64 query failed: "+suffix+"/"+labels[i]+" error "+Marshal.GetLastWin32Error());uint q=n;n=256;Marshal.WriteInt32(output,0);int ok=wide?EncodeW(binary,(uint)data[i].Length,flags[i],output,ref n):EncodeA(binary,(uint)data[i].Length,flags[i],output,ref n);if(ok==0)throw new InvalidOperationException("Base64 conversion failed: "+suffix+"/"+labels[i]+" error "+Marshal.GetLastWin32Error());result["base64-"+suffix+"-"+labels[i]]=new object[]{q,ok,n,Text(output,wide)};}
   {uint n=77;int query=wide?EncodeW(null,0,1,IntPtr.Zero,ref n):EncodeA(null,0,1,IntPtr.Zero,ref n);int queryError=query==0?Marshal.GetLastWin32Error():0;uint q=n;n=256;Marshal.WriteInt32(output,0);int ok=wide?EncodeW(null,0,1,output,ref n):EncodeA(null,0,1,output,ref n);int error=ok==0?Marshal.GetLastWin32Error():0;result["base64-"+suffix+"-null"]=new object[]{query,queryError,q,ok,error,n,Text(output,wide)};}
   uint size=0,skip=9,actual=9;if(wide)DecodeW(" QcOp\r\n4oKs ",0,1,IntPtr.Zero,ref size,out skip,out actual);else DecodeA(" QcOp\r\n4oKs ",0,1,IntPtr.Zero,ref size,out skip,out actual);uint needed=size;size=32;int decoded=wide?DecodeW(" QcOp\r\n4oKs ",0,1,output,ref size,out skip,out actual):DecodeA(" QcOp\r\n4oKs ",0,1,output,ref size,out skip,out actual);result["decode-"+suffix]=new object[]{needed,decoded,size,Hex(output,(int)size),skip,actual};
   if(wide)CombineW(output,"C:\\one\\two","..\\file.txt");else CombineA(output,"C:\\one\\two","..\\file.txt");string combined=Text(output,wide);
   if(wide)CanonicalW(output,"C:\\one\\.\\two\\..\\x");else CanonicalA(output,"C:\\one\\.\\two\\..\\x");string canonical=Text(output,wide);
   byte[] raw=wide?System.Text.Encoding.Unicode.GetBytes("C:\\a\\\0"):System.Text.Encoding.ASCII.GetBytes("C:\\a\\\0");Marshal.Copy(raw,0,output,raw.Length);long removed=((wide?RemoveW(output):RemoveA(output)).ToInt64()-output.ToInt64())/(wide?2:1),again=((wide?RemoveW(output):RemoveA(output)).ToInt64()-output.ToInt64())/(wide?2:1);
   result["paths-"+suffix]=new object[]{combined,canonical,removed,again,wide?RelativeW("item"):RelativeA("item"),wide?RelativeW("C:\\a"):RelativeA("C:\\a")};
  }finally{Marshal.FreeHGlobal(output);}}
  IntPtr guid=Marshal.AllocHGlobal(16),textOut=Marshal.AllocHGlobal(80);try{int parsed=CLSIDFromString("{00112233-4455-6677-8899-aabbccddeeff}",guid),n=StringFromGUID2(guid,textOut,39);string bytes=Hex(guid,16),text=Text(textOut,true);result["guid"]=new object[]{parsed,bytes,n,text,unchecked((uint)CLSIDFromString("invalid",guid))};}finally{Marshal.FreeHGlobal(guid);Marshal.FreeHGlobal(textOut);}
  IntPtr e=Event(IntPtr.Zero,0,1,IntPtr.Zero);try{result["auto-event"]=new object[]{WaitForSingleObject(e,0),WaitForSingleObject(e,0)};}finally{CloseHandle(e);}
  e=Event(IntPtr.Zero,1,1,IntPtr.Zero);try{result["manual-event"]=new object[]{WaitForSingleObject(e,0),WaitForSingleObject(e,0),ResetEvent(e),WaitForSingleObject(e,0)};}finally{CloseHandle(e);}
  e=Event(IntPtr.Zero,0,1,IntPtr.Zero);IntPtr sem=Semaphore(IntPtr.Zero,0,2,IntPtr.Zero),previous=Marshal.AllocHGlobal(4);try{IntPtr[] handles={e,sem};uint blocked=WaitForMultipleObjects(2,handles,1,0);int released=ReleaseSemaphore(sem,1,previous);uint ready=WaitForMultipleObjects(2,handles,1,0);result["wait-all"]=new object[]{blocked,released,Marshal.ReadInt32(previous),ready,WaitForSingleObject(e,0),WaitForSingleObject(sem,0)};SetEvent(e);ReleaseSemaphore(sem,1,IntPtr.Zero);result["wait-any"]=new object[]{WaitForMultipleObjects(2,handles,0,0),WaitForMultipleObjects(2,handles,0,0),WaitForMultipleObjects(2,handles,0,0)};int overflow=ReleaseSemaphore(sem,3,previous);result["semaphore-overflow"]=new object[]{overflow,Marshal.GetLastWin32Error()};}finally{CloseHandle(e);CloseHandle(sem);Marshal.FreeHGlobal(previous);}
  ushort atom=GlobalAddAtomA("VB6.Services.Contract.20261006"),same=GlobalAddAtomA("vb6.services.contract.20261006");IntPtr atomName=Marshal.AllocHGlobal(128);try{uint length=GlobalGetAtomNameA(atom,atomName,128);string name=Text(atomName,false);ushort removed=GlobalDeleteAtom(atom);result["atoms"]=new object[]{atom==same,length,name,removed,GlobalFindAtomA("VB6.Services.Contract.20261006")==same};}finally{GlobalDeleteAtom(same);Marshal.FreeHGlobal(atomName);}
  IntPtr window=CreateWindowExW(0,"STATIC","",0,0,0,0,0,new IntPtr(-3),IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);if(window==IntPtr.Zero)throw new Exception("CreateWindowEx failed: "+Marshal.GetLastWin32Error());
  try{PropertyCallback cb=(h,name,value,context)=>{result["property-callback"]=new object[]{Marshal.PtrToStringAnsi(name),value.ToInt64(),context.ToInt64()};return 321;};result["properties"]=new object[]{SetPropA(window,"VB6.Contract",new IntPtr(42)),GetPropA(window,"VB6.Contract").ToInt64(),EnumPropsExA(window,cb,new IntPtr(99)),RemovePropA(window,"VB6.Contract").ToInt64(),GetPropA(window,"VB6.Contract").ToInt64()};GC.KeepAlive(cb);}finally{RemovePropA(window,"VB6.Contract");DestroyWindow(window);}
  string regName="Software\\VB6ServicesContract-"+Guid.NewGuid().ToString("N");IntPtr root=new IntPtr(unchecked((int)0x80000001)),key,child,regOut=Marshal.AllocHGlobal(128);
  int created=RegCreateKeyExW(root,regName,0,IntPtr.Zero,0,0xf003f,IntPtr.Zero,out key,IntPtr.Zero);if(created!=0)throw new Exception("RegCreateKeyEx: "+created);
  try{if(RegCreateKeyExW(key,"Child",0,IntPtr.Zero,0,0xf003f,IntPtr.Zero,out child,IntPtr.Zero)!=0)throw new Exception("RegCreate child failed");RegCloseKey(child);byte[] value=System.Text.Encoding.Unicode.GetBytes("café\0");if(RegSetValueExW(key,"Caption",0,1,value,10)!=0)throw new Exception("RegSetValue failed");uint subs,maxSub,count,maxName,maxData,n=64,dataSize=0,type;int info=RegQueryInfoKeyW(key,IntPtr.Zero,IntPtr.Zero,IntPtr.Zero,out subs,out maxSub,IntPtr.Zero,out count,out maxName,out maxData,IntPtr.Zero,IntPtr.Zero),enumerated=RegEnumValueW(key,0,regOut,ref n,IntPtr.Zero,out type,IntPtr.Zero,ref dataSize);result["registry"]=new object[]{info,subs,maxSub,count,maxName,maxData,enumerated,Text(regOut,true),n,type,dataSize};if(RegEnumKeyW(key,0,regOut,64)!=0)throw new Exception("RegEnumKey failed");result["registry-child"]=Text(regOut,true);}finally{RegDeleteKeyW(key,"Child");RegDeleteValueW(key,"Caption");RegCloseKey(key);RegDeleteKeyW(root,regName);Marshal.FreeHGlobal(regOut);}
  string dir=System.IO.Path.Combine(System.IO.Path.GetTempPath(),"VB6Services-"+Guid.NewGuid().ToString("N"));System.IO.Directory.CreateDirectory(dir);string fileName=System.IO.Path.Combine(dir,"sample.dat");IntPtr findData=Marshal.AllocHGlobal(592);try{System.IO.File.WriteAllBytes(fileName,new byte[]{65,66,67});IntPtr find=FindFirstFileW(System.IO.Path.Combine(dir,"*.dat"),findData);if(find==new IntPtr(-1))throw new Exception("FindFirstFile failed");try{string name=Marshal.PtrToStringUni(IntPtr.Add(findData,44));int high=Marshal.ReadInt32(findData,28),low=Marshal.ReadInt32(findData,32),next=FindNextFileW(find,findData),error=Marshal.GetLastWin32Error();result["files"]=new object[]{name,high,low,next,error};}finally{FindClose(find);}IntPtr file=CreateFileW(fileName,0xc0000000,0,IntPtr.Zero,3,0,IntPtr.Zero);if(file==new IntPtr(-1))throw new Exception("CreateFile failed");try{long size;int ok=GetFileSizeEx(file,out size);result["file-size-flush"]=new object[]{ok,size,FlushFileBuffers(file)};}finally{CloseHandle(file);}}finally{Marshal.FreeHGlobal(findData);System.IO.Directory.Delete(dir,true);}
  return result;
 }
}
'@
[ServiceOracle]::Run() | ConvertTo-Json -Depth 16 | Set-Content -Encoding utf8 reports/win32-services-native/windows.json
