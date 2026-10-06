param([string]$Output='reports/text-codepages/windows-text-nls.json')
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;
using System.IO;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
public static class TextNlsReference {
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int WideCharToMultiByte(uint cp,uint flags,IntPtr input,int count,IntPtr output,int bytes,IntPtr replacement,IntPtr used);
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int LCMapStringW(uint locale,uint flags,IntPtr input,int count,IntPtr output,int chars);
 [DllImport("kernel32.dll",SetLastError=true,ExactSpelling=true)] static extern int MultiByteToWideChar(uint cp,uint flags,IntPtr input,int count,IntPtr output,int chars);
 static string Map(uint locale,uint flags,string text,IntPtr a,IntPtr b) {
  for(int i=0;i<text.Length;i++)Marshal.WriteInt16(a,i*2,(short)text[i]);
  int n=LCMapStringW(locale,flags,a,text.Length,b,32);
  if(n==0)throw new Exception("LCMapStringW failed: "+Marshal.GetLastWin32Error());
  return Marshal.PtrToStringUni(b,n);
 }
 public static void Write(string path) {
  int[] pages={1252,1250,1251,1253,1254,1255,1256,1257,1258,874,932,936,949,950};
  int[] locales={1033,1045,1049,1032,1055,1037,1025,1061,1062,1063,1066,1054,1041,2052,1042,1028};
  var enc=new Dictionary<string,object>();var maps=new Dictionary<string,object>();var decodings=new Dictionary<string,object>();var probes=new List<object>();
  IntPtr a=Marshal.AllocHGlobal(1024),b=Marshal.AllocHGlobal(1024),used=Marshal.AllocHGlobal(4);
  try {
   foreach(int cp in pages) {
    var rows=new List<object>();
    for(int c=0;c<=65535;c++) {
     if(c>=0xd800&&c<=0xdfff)continue;
     Marshal.WriteInt16(a,(short)c);Marshal.WriteInt32(used,0);
     int n=WideCharToMultiByte((uint)cp,0,a,1,b,32,IntPtr.Zero,used);
     if(n==0)throw new Exception("WideCharToMultiByte failed");
     if(Marshal.ReadInt32(used)!=0)continue;
     if(n>2)throw new Exception("Unexpected encoding width");
     int v=n==1?Marshal.ReadByte(b):Marshal.ReadByte(b)*256+Marshal.ReadByte(b,1);
     rows.Add(new object[]{c,v});
    }
    enc[cp.ToString()]=rows;
    var decoded=new List<object>();
    for(int first=0;first<256;first++) {
     Marshal.WriteByte(a,(byte)first);
     int one=MultiByteToWideChar((uint)cp,0,a,1,b,32);
     if(one!=1)throw new Exception("Unexpected default single-byte decoding");
     decoded.Add(new object[]{first,(int)(ushort)Marshal.ReadInt16(b)});
     bool lead=cp==932?((first>=0x81&&first<=0x9f)||(first>=0xe0&&first<=0xfc)):(cp==936||cp==949||cp==950)&&first>=0x81&&first<=0xfe;
     if(!lead)continue;
     for(int second=1;second<256;second++) {
      Marshal.WriteByte(a,1,(byte)second);int n=MultiByteToWideChar((uint)cp,0,a,2,b,32);
      if(n!=1)throw new Exception("Unexpected default DBCS decoding");
      decoded.Add(new object[]{first*256+second,(int)(ushort)Marshal.ReadInt16(b)});
     }
    }
    decodings[cp.ToString()]=decoded;
   }
   foreach(int locale in locales) {
    bool east=locale==1041||locale==2052||locale==1042||locale==1028;
    var kinds=new Dictionary<string,uint>{{"upper",0x200},{"lower",0x100}};
    if(east){kinds["wide"]=0x800000;kinds["narrow"]=0x400000;}
    if(locale==1041){kinds["katakana"]=0x200000;kinds["hiragana"]=0x100000;}
    var lm=new Dictionary<string,object>();
    foreach(var kind in kinds) {
     var rows=new List<object>();
     for(int c=0;c<=65535;c++) {
      if(c>=0xd800&&c<=0xdfff)continue;
      string s=((char)c).ToString(),v=Map((uint)locale,kind.Value,s,a,b);
      if(v!=s)rows.Add(new object[]{s,v});
     }
     // Include supplementary-plane casing rather than treating surrogate pairs as two letters.
     if(kind.Key=="upper"||kind.Key=="lower")for(int c=0x10000;c<=0x10ffff;c++) {
      string s=char.ConvertFromUtf32(c),v=Map((uint)locale,kind.Value,s,a,b);
      if(v!=s)rows.Add(new object[]{s,v});
     }
     // Width conversion combines half-width voiced/semi-voiced kana pairs.
     if(kind.Key=="wide")for(int c=0xff61;c<=0xff9d;c++)for(int mark=0xff9e;mark<=0xff9f;mark++) {
      string s=((char)c).ToString()+((char)mark).ToString();
      string v=Map((uint)locale,kind.Value,s,a,b);
      string parts=Map((uint)locale,kind.Value,s.Substring(0,1),a,b)+Map((uint)locale,kind.Value,s.Substring(1,1),a,b);
      if(v!=parts)rows.Add(new object[]{s,v});
     }
     lm[kind.Key]=rows;
     foreach(string s in new[]{"aBc I i \u0130 \u0131 \u00df \u03a3\u039f\u03a3","hello-world o'NEIL 123WORD\tNEXT","\uff76\uff9e\uff8a\uff9f \u30ac\u30d1 \u304c\u3071","ABC 123 \uff21\uff22\uff23","\u3000\u3099\u309a\u309b\u309c","Za\u017c\u00f3\u0142\u0107 \u65e5\u672c\u8a9e"})
      probes.Add(new{locale,kind=kind.Key,input=s,output=Map((uint)locale,kind.Value,s,a,b)});
    }
    maps[locale.ToString()]=lm;
   }
   var json=new JavaScriptSerializer{MaxJsonLength=64*1024*1024};
   File.WriteAllText(path,json.Serialize(new{schema=2,source="Windows Kernel32: flags=0 code-page encoding; LCMapStringW explicit locale",encodings=enc,decodings,maps,probes}),new UTF8Encoding(false));
  } finally {Marshal.FreeHGlobal(a);Marshal.FreeHGlobal(b);Marshal.FreeHGlobal(used);}
 }
}
'@ -ReferencedAssemblies 'System.Web.Extensions'
$parent=Split-Path -Parent $Output
New-Item -ItemType Directory -Force $parent | Out-Null
[TextNlsReference]::Write([IO.Path]::GetFullPath($Output))
@{schema=1;os=[Environment]::OSVersion.VersionString;kernel32Version=(Get-Item "$env:WINDIR\System32\kernel32.dll").VersionInfo.FileVersion;sha256=(Get-FileHash $Output -Algorithm SHA256).Hash} | ConvertTo-Json | Set-Content -Encoding UTF8 ($Output+'.provenance.json')
