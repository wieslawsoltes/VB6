$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class TextOracle {
 [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr p);
 [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr p);
 [DllImport("gdi32.dll")] static extern int SetTextCharacterExtra(IntPtr dc,int extra);
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern int GetTextFaceW(IntPtr dc,int size,IntPtr p);
 [DllImport("gdi32.dll",CharSet=CharSet.Unicode)] static extern bool GetTextExtentPoint32W(IntPtr dc,string text,int count,[Out]int[] size);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] static extern int DrawTextW(IntPtr dc,string text,int count,[In,Out]int[] rect,uint flags);
 public static object Run(){
  var output=new List<object>();var dc=CreateCompatibleDC(IntPtr.Zero);if(dc==IntPtr.Zero)throw new Exception("No DC");
  try {
   foreach(int n in new[]{0,1,2,128}){var p=Marshal.AllocHGlobal(256);try{for(int i=0;i<128;i++)Marshal.WriteInt16(p,i*2,0);int result=GetTextFaceW(dc,n,p);output.Add(new {name="face",n,result,text=Marshal.PtrToStringUni(p),required=GetTextFaceW(dc,0,IntPtr.Zero)});}finally{Marshal.FreeHGlobal(p);}}
   foreach(string text in new[]{"","A","AB","ABC"}){var a=new int[2];var b=new int[2];SetTextCharacterExtra(dc,0);if(!GetTextExtentPoint32W(dc,text,text.Length,a))throw new Exception("Extent");SetTextCharacterExtra(dc,3);if(!GetTextExtentPoint32W(dc,text,text.Length,b))throw new Exception("Extent");output.Add(new{name="spacing",text,normal=a,extra=b,delta=b[0]-a[0]});}SetTextCharacterExtra(dc,0);
   foreach(string text in new[]{"","A"})foreach(uint flags in new uint[]{32,36,40,1024,1056}){int[] r={10,20,210,220};int result=DrawTextW(dc,text,-1,r,flags);output.Add(new{name="draw",text,flags,result,rect=r});}
   return output;
  }finally{DeleteDC(dc);}
 }
}
'@
New-Item -Force -ItemType Directory reports/win32-geometry | Out-Null
[TextOracle]::Run() | ConvertTo-Json -Depth 12 | Set-Content -Encoding utf8 reports/win32-geometry/text-native.json
