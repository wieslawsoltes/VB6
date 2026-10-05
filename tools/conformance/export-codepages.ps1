param([string]$Output='reports/conformance/windows-codepages.bin')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Runtime.InteropServices;
public static class CodePageTableWriter {
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int WideCharToMultiByte(uint cp,uint flags,IntPtr input,int count,IntPtr output,int bytes,IntPtr replacement,IntPtr used);
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int MultiByteToWideChar(uint cp,uint flags,IntPtr input,int count,IntPtr output,int chars);
 public static void Write(string path) {
  int[] pages={1252,1250,1251,1253,1254,1255,1256,1257,1258,874,932,936,949,950};
  IntPtr a=Marshal.AllocHGlobal(32), b=Marshal.AllocHGlobal(32), used=Marshal.AllocHGlobal(4);
  try { using(var file=File.Create(path)) using(var writer=new BinaryWriter(file)) {
   writer.Write(new byte[]{86,66,54,67,80,48,49,0});writer.Write(pages.Length);
   foreach(int page in pages) {
    writer.Write(page);long countOffset=file.Position;writer.Write(0);int count=0;
    for(int code=0;code<=65535;code++) {
     if(code>=0xd800 && code<=0xdfff)continue;
     Marshal.WriteInt16(a,(short)code);Marshal.WriteInt32(used,0);
     int length=WideCharToMultiByte((uint)page,0x400,a,1,b,32,IntPtr.Zero,used);
     if(length==0 || Marshal.ReadInt32(used)!=0)continue;
     writer.Write((ushort)code);writer.Write((byte)length);for(int i=0;i<length;i++)writer.Write(Marshal.ReadByte(b,i));count++;
    }
    long end=file.Position;file.Position=countOffset;writer.Write(count);file.Position=end;
    countOffset=file.Position;writer.Write(0);count=0;
    for(int sequence=0;sequence<=65535;sequence++) {
     bool pair=sequence>255;if(pair && page<900)continue;if(pair && page>=1250)continue;
     if(pair){Marshal.WriteByte(a,0,(byte)(sequence>>8));Marshal.WriteByte(a,1,(byte)sequence);}else Marshal.WriteByte(a,0,(byte)sequence);
     int length=MultiByteToWideChar((uint)page,8,a,pair?2:1,b,16);
     if(length!=1)continue;
     writer.Write((ushort)sequence);writer.Write((ushort)Marshal.ReadInt16(b));count++;
    }
    end=file.Position;file.Position=countOffset;writer.Write(count);file.Position=end;
    Console.WriteLine("Captured strict Windows code page "+page);
   }
  }} finally {Marshal.FreeHGlobal(a);Marshal.FreeHGlobal(b);Marshal.FreeHGlobal(used);}
 }
}
'@
$parent=Split-Path -Parent $Output
New-Item -ItemType Directory -Force $parent | Out-Null
[CodePageTableWriter]::Write([IO.Path]::GetFullPath($Output))
$report=@{schema=1;source='Windows Kernel32 WideCharToMultiByte(WC_NO_BEST_FIT_CHARS) / MultiByteToWideChar(MB_ERR_INVALID_CHARS)';os=[Environment]::OSVersion.VersionString;architecture=[IntPtr]::Size*8;kernel32Version=(Get-Item "$env:WINDIR\System32\kernel32.dll").VersionInfo.FileVersion;sha256=(Get-FileHash $Output -Algorithm SHA256).Hash}
$report | ConvertTo-Json | Set-Content -Encoding UTF8 ($Output+'.json')
