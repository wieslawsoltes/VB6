param([string]$Output='reports/win32-system/native.json')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class Win32SystemProbe {
 [StructLayout(LayoutKind.Sequential)] public struct ST { public ushort Year,Month,DayOfWeek,Day,Hour,Minute,Second,Milliseconds; }
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool SystemTimeToFileTime(ref ST t,out ulong f);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool FileTimeToSystemTime(ref ulong f,out ST t);
 [DllImport("kernel32.dll",SetLastError=true)] static extern int CompareFileTime(ref ulong a,ref ulong b);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool FileTimeToDosDateTime(ref ulong f,out ushort d,out ushort t);
 [DllImport("kernel32.dll",SetLastError=true)] static extern bool DosDateTimeToFileTime(ushort d,ushort t,out ulong f);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern int GetDateFormatW(uint locale,uint flags,ref ST t,string format,IntPtr output,int capacity);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern int GetTimeFormatW(uint locale,uint flags,ref ST t,string format,IntPtr output,int capacity);
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode,SetLastError=true)] static extern int FormatMessageW(uint flags,IntPtr source,uint id,uint language,IntPtr output,uint capacity,IntPtr args);
 [DllImport("kernel32.dll",SetLastError=true)] static extern IntPtr LocalFree(IntPtr p);
 static int[] Fields(ST t) { return new int[]{t.Year,t.Month,t.DayOfWeek,t.Day,t.Hour,t.Minute,t.Second,t.Milliseconds}; }
 public static object Run() {
  var results=new Dictionary<string,object>();
  var calendar=new List<object>();
  foreach(var f in new ulong[]{0,1,9999,10000,19999,116444736000000000,133537719091230000,9223372036854775807}) {
   var n=f; ST t;bool ok=FileTimeToSystemTime(ref n,out t);
   calendar.Add(new {ticks=f.ToString(),ok=ok?1:0,fields=ok?Fields(t):new int[0]});
  }
  results["calendar"]=calendar;
  var invalid=new List<object>();
  foreach(var year in new ushort[]{1601,1900,2000,2023,2024,2100,2400,30827}) {
   ST t=new ST{Year=year,Month=2,Day=29,Hour=13,Minute=5,Second=9,Milliseconds=123,DayOfWeek=99};ulong f;
   bool ok=SystemTimeToFileTime(ref t,out f);invalid.Add(new {year=(int)year,ok=ok?1:0,ticks=ok?f.ToString():""});
  }
  results["leap"]=invalid;
  ulong aa=9223372036854775808,bb=18446744073709551615;
  results["unsignedCompare"]=CompareFileTime(ref aa,ref bb);
  var dos=new List<object>();ulong start=(ulong)new DateTime(2024,2,29,23,59,58,DateTimeKind.Utc).ToFileTimeUtc();
  foreach(var delta in new ulong[]{0,1,9999,10000,10000000,19999999,20000000}) {
   ulong n=start+delta;ushort d,t;bool ok=FileTimeToDosDateTime(ref n,out d,out t);ulong roundtrip=0;
   if(ok)DosDateTimeToFileTime(d,t,out roundtrip);
   dos.Add(new {ticks=n.ToString(),ok=ok?1:0,date=(int)d,time=(int)t,roundtrip=roundtrip.ToString()});
  }
  results["dos"]=dos;
  IntPtr buffer=Marshal.AllocHGlobal(512),format=IntPtr.Zero,args=IntPtr.Zero,name=IntPtr.Zero,ptr=Marshal.AllocHGlobal(IntPtr.Size);
  try {
   ST value=new ST{Year=2024,Month=2,Day=29,DayOfWeek=0,Hour=13,Minute=5,Second=9,Milliseconds=123};
   int n=GetDateFormatW(0x409,0,ref value,"dddd, dd MMMM yyyy 'at'",buffer,256);
   results["date"]=new {count=n,text=Marshal.PtrToStringUni(buffer)};
   n=GetTimeFormatW(0x409,0,ref value,"hh':'mm':'ss tt",buffer,256);
   results["time"]=new {count=n,text=Marshal.PtrToStringUni(buffer)};
   format=Marshal.StringToHGlobalUni("File %1: %2!04X!%n%% %! %.%0ignored");name=Marshal.StringToHGlobalUni("sample");args=Marshal.AllocHGlobal(IntPtr.Size*2);Marshal.WriteIntPtr(args,0,name);Marshal.WriteIntPtr(args,IntPtr.Size,new IntPtr(42));
   n=FormatMessageW(0x2400,format,0,0,buffer,256,args);results["insert"]=new {count=n,text=Marshal.PtrToStringUni(buffer)};
   Marshal.WriteIntPtr(ptr,IntPtr.Zero);n=FormatMessageW(0x1300,IntPtr.Zero,5,0x409,ptr,0,IntPtr.Zero);var allocated=Marshal.ReadIntPtr(ptr);
   try {results["allocated"]=new {count=n,text=Marshal.PtrToStringUni(allocated)};}finally {if(allocated!=IntPtr.Zero)LocalFree(allocated);}
  } finally {Marshal.FreeHGlobal(buffer);Marshal.FreeHGlobal(ptr);if(format!=IntPtr.Zero)Marshal.FreeHGlobal(format);if(name!=IntPtr.Zero)Marshal.FreeHGlobal(name);if(args!=IntPtr.Zero)Marshal.FreeHGlobal(args);}
  return results;
 }
}
'@
$parent=Split-Path -Parent $Output
if($parent){New-Item -Force -ItemType Directory $parent | Out-Null}
[Win32SystemProbe]::Run() | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 $Output
