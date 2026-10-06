param([string]$Output='reports/text-codepages/windows-text-edges.json')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
public static class TextEdges {
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int WideCharToMultiByte(uint cp,uint flags,IntPtr src,int count,IntPtr dst,int bytes,IntPtr replacement,IntPtr used);
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int MultiByteToWideChar(uint cp,uint flags,IntPtr src,int count,IntPtr dst,int chars);
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int LCMapStringW(uint locale,uint flags,IntPtr src,int count,IntPtr dst,int chars);
 [DllImport("oleaut32.dll")] static extern IntPtr SysAllocStringByteLen(IntPtr src,uint length);
 [DllImport("oleaut32.dll")] static extern uint SysStringLen(IntPtr text);
 [DllImport("oleaut32.dll")] static extern uint SysStringByteLen(IntPtr text);
 [DllImport("oleaut32.dll")] static extern void SysFreeString(IntPtr text);
 static int[] Codes(string s){return s.Select(c=>(int)c).ToArray();}
 static int[] Bytes(IntPtr p,int n){return Enumerable.Range(0,n).Select(i=>(int)Marshal.ReadByte(p,i)).ToArray();}
 public static void Write(string path){
  var enc=new List<object>();var dec=new List<object>();var maps=new List<object>();var bstrs=new List<object>();
  int[] pages={1252,1250,1251,1253,1254,1255,1256,1257,1258,874,932,936,949,950};
  string[] texts={"A\0B","\ud83d\ude00","\ud800","\udc00","\ud800A\udc00","e\u0301","\u1eaf\u0150\u20ac\u00a5\\","\u65e5\u672c\u8a9e","\uff76\uff9e"};
  byte[][] sequences={new byte[0],new byte[]{0},new byte[]{0,65},new byte[]{128},new byte[]{129},new byte[]{129,48},new byte[]{129,0},new byte[]{129,255},new byte[]{129,129},new byte[]{129,129,129},new byte[]{147,250},new byte[]{255},new byte[]{161},new byte[]{129,64,0}};
  IntPtr a=Marshal.AllocHGlobal(4096),b=Marshal.AllocHGlobal(4096),used=Marshal.AllocHGlobal(4);
  try{
   foreach(int cp in pages){
    foreach(string text in texts)foreach(uint flags in new uint[]{0,1024}){
     for(int i=0;i<text.Length;i++)Marshal.WriteInt16(a,2*i,(short)text[i]);Marshal.WriteInt32(used,0);
     int n=WideCharToMultiByte((uint)cp,flags,a,text.Length,b,4096,IntPtr.Zero,used),error=n==0?Marshal.GetLastWin32Error():0;
     enc.Add(new{cp,flags,input=Codes(text),bytes=Bytes(b,n),usedDefault=Marshal.ReadInt32(used)!=0,error});
    }
    foreach(byte[] bytes in sequences)foreach(uint flags in new uint[]{0,8}){
     Marshal.Copy(bytes,0,a,bytes.Length);
     int n=bytes.Length==0?0:MultiByteToWideChar((uint)cp,flags,a,bytes.Length,b,2048),error=n==0&&bytes.Length>0?Marshal.GetLastWin32Error():0;
     dec.Add(new{cp,flags,bytes=bytes.Select(x=>(int)x).ToArray(),output=Codes(Marshal.PtrToStringUni(b,n)),error});
    }
   }
   foreach(int locale in new[]{1041,2052,1042,1028,1033,1055})foreach(int mode in new[]{1,2,4,8,16,32,5,6,9,10,17,18,20,21,22,24,25,26,33,34,36,37,38,40,41,42})foreach(string text in new[]{"\uff76\uff9e\uff8a\uff9f \u304c\u3071\u30ac\u30d1","aBc \uff21\uff22\uff23\u3000I i \u0130 \u0131","\u3099\u309a\u309b\u309c\uff9e\uff9f"}){
    uint flags=(uint)(((mode&1)!=0?0x200:0)|((mode&2)!=0?0x100:0)|((mode&4)!=0?0x800000:0)|((mode&8)!=0?0x400000:0)|((mode&16)!=0?0x200000:0)|((mode&32)!=0?0x100000:0));
    for(int i=0;i<text.Length;i++)Marshal.WriteInt16(a,2*i,(short)text[i]);
    int n=LCMapStringW((uint)locale,flags,a,text.Length,b,2048),error=n==0?Marshal.GetLastWin32Error():0;
    maps.Add(new{locale,mode,input=Codes(text),output=Codes(Marshal.PtrToStringUni(b,n)),error});
   }
   foreach(byte[] bytes in new[]{new byte[0],new byte[]{65},new byte[]{65,66,67},new byte[]{0},new byte[]{0,0,0},new byte[]{255,0,128}}){
    Marshal.Copy(bytes,0,a,bytes.Length);IntPtr p=SysAllocStringByteLen(a,(uint)bytes.Length);if(p==IntPtr.Zero)throw new OutOfMemoryException();
    try{bstrs.Add(new{bytes=bytes.Select(x=>(int)x).ToArray(),length=SysStringLen(p),byteLength=SysStringByteLen(p),copied=Bytes(p,bytes.Length)});}finally{SysFreeString(p);}
   }
   var json=new JavaScriptSerializer{MaxJsonLength=16*1024*1024};
   File.WriteAllText(path,json.Serialize(new{schema=1,encodings=enc,decodings=dec,mappings=maps,bstrs}),new System.Text.UTF8Encoding(false));
  }finally{Marshal.FreeHGlobal(a);Marshal.FreeHGlobal(b);Marshal.FreeHGlobal(used);}
 }
}
'@ -ReferencedAssemblies 'System.Web.Extensions','System.Core'
New-Item -ItemType Directory -Force (Split-Path -Parent $Output) | Out-Null
[TextEdges]::Write([IO.Path]::GetFullPath($Output))
@{schema=1;os=[Environment]::OSVersion.VersionString;sha256=(Get-FileHash $Output -Algorithm SHA256).Hash} | ConvertTo-Json | Set-Content -Encoding UTF8 ($Output+'.provenance.json')
