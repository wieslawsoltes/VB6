# Real installed Windows GDI region contracts; no proprietary compiler is needed.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class RegionContractProbe {
 [StructLayout(LayoutKind.Sequential)] public struct Info { public uint Size;public int Width,Height;public ushort Planes,Bits;public uint Compression,SizeImage;public int X,Y;public uint Used,Important; }
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; public Rect(int l,int t,int r,int b){Left=l;Top=t;Right=r;Bottom=b;} }
 [DllImport("gdi32.dll")] static extern IntPtr CreateRectRgn(int l,int t,int r,int b);
 [DllImport("gdi32.dll")] static extern int SetRectRgn(IntPtr r,int l,int t,int right,int b);
 [DllImport("gdi32.dll")] static extern int CombineRgn(IntPtr d,IntPtr a,IntPtr b,int mode);
 [DllImport("gdi32.dll")] static extern int EqualRgn(IntPtr a,IntPtr b);
 [DllImport("gdi32.dll")] static extern uint GetRegionData(IntPtr r,uint count,IntPtr data);
 [DllImport("gdi32.dll")] static extern int GetRgnBox(IntPtr r,out Rect rect);
 [DllImport("gdi32.dll")] static extern int PtInRegion(IntPtr r,int x,int y);
 [DllImport("gdi32.dll")] static extern int RectInRegion(IntPtr r,ref Rect rect);
 [DllImport("gdi32.dll")] static extern IntPtr ExtCreateRegion(IntPtr x,uint n,IntPtr p);
 [DllImport("gdi32.dll")] static extern IntPtr CreateCompatibleDC(IntPtr dc);
 [DllImport("gdi32.dll")] static extern IntPtr CreateDIBSection(IntPtr dc,ref Info info,uint usage,out IntPtr bits,IntPtr section,uint offset);
 [DllImport("gdi32.dll")] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
 [DllImport("gdi32.dll")] static extern int DeleteObject(IntPtr obj);
 [DllImport("gdi32.dll")] static extern int DeleteDC(IntPtr dc);
 [DllImport("gdi32.dll")] static extern int SelectClipRgn(IntPtr dc,IntPtr r);
 [DllImport("gdi32.dll")] static extern int ExtSelectClipRgn(IntPtr dc,IntPtr r,int mode);
 [DllImport("gdi32.dll")] static extern int GetClipRgn(IntPtr dc,IntPtr r);
 [DllImport("gdi32.dll")] static extern int GetClipBox(IntPtr dc,out Rect r);
 [DllImport("gdi32.dll")] static extern int SaveDC(IntPtr dc);
 [DllImport("gdi32.dll")] static extern int RestoreDC(IntPtr dc,int n);
 [DllImport("gdi32.dll")] static extern int OffsetClipRgn(IntPtr dc,int x,int y);
 [DllImport("gdi32.dll")] static extern int IntersectClipRect(IntPtr dc,int l,int t,int r,int b);
 [DllImport("gdi32.dll")] static extern int ExcludeClipRect(IntPtr dc,int l,int t,int r,int b);
 [DllImport("gdi32.dll")] static extern int SetViewportOrgEx(IntPtr dc,int x,int y,IntPtr old);
 [DllImport("gdi32.dll")] static extern int PtVisible(IntPtr dc,int x,int y);
 [DllImport("gdi32.dll")] static extern IntPtr CreateSolidBrush(uint color);
 [DllImport("gdi32.dll")] static extern int FillRgn(IntPtr dc,IntPtr r,IntPtr brush);
 [DllImport("gdi32.dll")] static extern int PaintRgn(IntPtr dc,IntPtr r);
 [DllImport("gdi32.dll")] static extern int InvertRgn(IntPtr dc,IntPtr r);
 [DllImport("gdi32.dll")] static extern int PatBlt(IntPtr dc,int x,int y,int w,int h,uint rop);
 [DllImport("gdi32.dll")] static extern int GdiFlush();
 static readonly List<IntPtr> objects=new List<IntPtr>(),buffers=new List<IntPtr>();
 static IntPtr Track(IntPtr p){if(p==IntPtr.Zero)throw new Exception("Native GDI allocation failed");objects.Add(p);return p;}
 static IntPtr Region(int l,int t,int r,int b){return Track(CreateRectRgn(l,t,r,b));}
 static IntPtr Buffer(int n){var p=Marshal.AllocHGlobal(n);Marshal.Copy(new byte[n],0,p,n);buffers.Add(p);return p;}
 static int[] Data(IntPtr h){uint n=GetRegionData(h,0,IntPtr.Zero);if(n<32||n>1024)throw new Exception("Native region data invalid");var p=Buffer((int)n);if(GetRegionData(h,n,p)!=n)throw new Exception("Native region read failed");var a=new int[n/4];Marshal.Copy(p,a,0,a.Length);return a;}
 static int[] Box(IntPtr dc){Rect r;int type=GetClipBox(dc,out r);return new int[]{type,r.Left,r.Top,r.Right,r.Bottom};}
 static int[] Pixels(IntPtr p){GdiFlush();var b=new byte[256];Marshal.Copy(p,b,0,256);var a=new int[64];for(int i=0;i<64;i++)a[i]=b[i*4]<<16|b[i*4+1]<<8|b[i*4+2];return a;}
 public static Dictionary<string,object> Run(){var r=new Dictionary<string,object>();IntPtr dc=IntPtr.Zero;try{
  var a=Region(0,0,8,8);var b=Region(2,2,6,6);var dest=Region(0,0,0,0);var reversed=Region(8,8,0,0);r["reversed"]=Data(reversed);r["empty"]=Data(dest);
  var modes=new List<object>();for(int mode=1;mode<=5;mode++){int type=CombineRgn(dest,a,mode==5?IntPtr.Zero:b,mode);modes.Add(new Dictionary<string,object>{{"type",type},{"data",Data(dest)}});}r["modes"]=modes;
  CombineRgn(dest,a,b,4);var members=new List<int>();foreach(var p in new int[][]{new[]{0,0},new[]{7,7},new[]{8,0},new[]{0,8},new[]{2,2},new[]{5,5},new[]{6,6}})members.Add(PtInRegion(dest,p[0],p[1])!=0?1:0);r["membership"]=members;
  var rectangles=new List<int>();foreach(var p in new int[][]{new[]{2,2,6,6},new[]{1,1,3,3},new[]{8,0,9,8},new[]{0,0,0,1}}){var rect=new Rect(p[0],p[1],p[2],p[3]);rectangles.Add(RectInRegion(dest,ref rect)!=0?1:0);}r["rectangles"]=rectangles;
  var encoded=Data(dest);var buf=Buffer(encoded.Length*4);Marshal.Copy(encoded,0,buf,encoded.Length);var copy=Track(ExtCreateRegion(IntPtr.Zero,(uint)encoded.Length*4,buf));r["roundtrip"]=EqualRgn(copy,dest)!=0?1:0;
  var transform=Buffer(24);Marshal.Copy(new float[]{1,0,0,1,3,-2},0,transform,6);r["translated"]=Data(Track(ExtCreateRegion(transform,(uint)encoded.Length*4,buf)));
  dc=CreateCompatibleDC(IntPtr.Zero);var info=new Info{Size=40,Width=8,Height=-8,Planes=1,Bits=32};IntPtr bits;var bitmap=Track(CreateDIBSection(IntPtr.Zero,ref info,0,out bits,IntPtr.Zero,0));SelectObject(dc,bitmap);
  r["noClip"]=GetClipRgn(dc,copy);r["select"]=SelectClipRgn(dc,dest);r["clipBox"]=Box(dc);r["copyClip"]=GetClipRgn(dc,copy);r["copied"]=Data(copy);
  r["saved"]=SaveDC(dc);SelectClipRgn(dc,IntPtr.Zero);SetRectRgn(dest,0,0,1,1);DeleteObject(dest);objects.Remove(dest);r["restored"]=RestoreDC(dc,-1)!=0?1:0;r["restoredVisibility"]=new[]{PtVisible(dc,3,3)!=0?1:0,PtVisible(dc,7,7)!=0?1:0};
  r["offsetClip"]=OffsetClipRgn(dc,20,20);r["offscreenBox"]=Box(dc);GetClipRgn(dc,copy);r["offscreenData"]=Data(copy);
  SelectClipRgn(dc,IntPtr.Zero);r["intersectOutside"]=IntersectClipRect(dc,20,20,30,30);GetClipRgn(dc,copy);r["intersectOutsideData"]=Data(copy);
  SelectClipRgn(dc,IntPtr.Zero);r["exclude"]=ExcludeClipRect(dc,2,2,6,6);r["excludedBox"]=Box(dc);
  SelectClipRgn(dc,a);SetViewportOrgEx(dc,2,2,IntPtr.Zero);r["logicalExclude"]=ExcludeClipRect(dc,1,1,3,3);r["logicalBox"]=Box(dc);r["logicalVisibility"]=new[]{PtVisible(dc,1,1)!=0?1:0,PtVisible(dc,0,0)!=0?1:0};SetViewportOrgEx(dc,0,0,IntPtr.Zero);
  var ext=new List<object>();for(int mode=1;mode<=5;mode++){SelectClipRgn(dc,a);ext.Add(ExtSelectClipRgn(dc,b,mode));GetClipRgn(dc,copy);ext.Add(Data(copy));}r["extSelect"]=ext;
  CombineRgn(copy,a,b,4);SelectClipRgn(dc,copy);r["regionSelect"]=(int)SelectObject(dc,copy);
  var brush=Track(CreateSolidBrush(0x563412));var painted=new List<object>();foreach(var name in new[]{"FillRgn","PaintRgn","InvertRgn"}){GdiFlush();Marshal.Copy(new byte[256],0,bits,256);SelectObject(dc,brush);painted.Add((name=="FillRgn"?FillRgn(dc,a,brush):name=="PaintRgn"?PaintRgn(dc,a):InvertRgn(dc,a))!=0?1:0);painted.Add(Pixels(bits));}r["painted"]=painted;
  r["patBlt"]=PatBlt(dc,0,0,8,8,0xf00021)!=0?1:0;r["patPixels"]=Pixels(bits);
  SelectClipRgn(dc,IntPtr.Zero);SetViewportOrgEx(dc,1,1,IntPtr.Zero);GdiFlush();Marshal.Copy(new byte[256],0,bits,256);r["fillTranslated"]=FillRgn(dc,b,brush)!=0?1:0;r["fillTranslatedPixels"]=Pixels(bits);
  return r;
 }finally{if(dc!=IntPtr.Zero)DeleteDC(dc);foreach(var p in objects)DeleteObject(p);foreach(var p in buffers)Marshal.FreeHGlobal(p);objects.Clear();buffers.Clear();}}
}
'@
[RegionContractProbe]::Run() | ConvertTo-Json -Depth 12
