# Runs actual installed Windows GDI. No Microsoft VB6 compiler or proprietary assets.
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class GdiContractProbe {
  [StructLayout(LayoutKind.Sequential)] public struct Info {
    public uint Size; public int Width, Height; public ushort Planes, Bits;
    public uint Compression, SizeImage; public int X,Y; public uint Used,Important;
  }
  [StructLayout(LayoutKind.Sequential)] public struct Bitmap {
    public int Type,Width,Height,Stride; public ushort Planes,Bits; public IntPtr Data;
  }
  [DllImport("gdi32.dll",SetLastError=true)] static extern IntPtr CreateCompatibleDC(IntPtr dc);
  [DllImport("gdi32.dll",SetLastError=true)] static extern IntPtr CreateDIBSection(IntPtr dc,ref Info info,uint usage,out IntPtr bits,IntPtr section,uint offset);
  [DllImport("gdi32.dll",SetLastError=true)] static extern IntPtr SelectObject(IntPtr dc,IntPtr obj);
  [DllImport("gdi32.dll")] static extern bool DeleteDC(IntPtr dc);
  [DllImport("gdi32.dll")] static extern bool DeleteObject(IntPtr obj);
  [DllImport("gdi32.dll")] static extern uint GetPixel(IntPtr dc,int x,int y);
  [DllImport("gdi32.dll")] static extern uint SetPixel(IntPtr dc,int x,int y,uint color);
  [DllImport("gdi32.dll",EntryPoint="GetObjectW")] static extern int GetObject(IntPtr obj,int count,out Bitmap bitmap);
  [DllImport("gdi32.dll")] static extern int GetBitmapBits(IntPtr bitmap,int count,IntPtr output);
  [DllImport("gdi32.dll")] static extern IntPtr CreateBitmap(int w,int h,uint planes,uint bits,IntPtr data);
  [DllImport("gdi32.dll")] static extern int GetDIBits(IntPtr dc,IntPtr bitmap,uint start,uint count,IntPtr output,ref Info info,uint usage);
  [DllImport("gdi32.dll")] static extern bool BitBlt(IntPtr dc,int x,int y,int width,int height,IntPtr source,int sx,int sy,uint rop);
  [DllImport("gdi32.dll")] static extern IntPtr CreateSolidBrush(uint color);
  [DllImport("gdi32.dll")] static extern bool GdiFlush();
  [DllImport("gdi32.dll")] static extern IntPtr GetCurrentObject(IntPtr dc,uint type);
  [DllImport("msimg32.dll")] static extern bool AlphaBlend(IntPtr dc,int x,int y,int width,int height,IntPtr source,int sx,int sy,int sw,int sh,uint blend);
  sealed class Dib {public Info Info;public IntPtr Object,Bits,DC,Old;}
  static readonly List<Dib> dibs=new List<Dib>();
  static readonly List<IntPtr> buffers=new List<IntPtr>();
  static readonly List<IntPtr> objects=new List<IntPtr>();
  static IntPtr Buffer(int n){var p=Marshal.AllocHGlobal(n);Marshal.Copy(new byte[n],0,p,n);buffers.Add(p);return p;}
  static Info Header(int w,int h,ushort bpp){return new Info{Size=40,Width=w,Height=h,Planes=1,Bits=bpp};}
  static Dib Make(int w,int h,ushort bpp=32){var d=new Dib{Info=Header(w,h,bpp)};d.Object=CreateDIBSection(IntPtr.Zero,ref d.Info,0,out d.Bits,IntPtr.Zero,0);d.DC=CreateCompatibleDC(IntPtr.Zero);d.Old=SelectObject(d.DC,d.Object);if(d.Object==IntPtr.Zero||d.DC==IntPtr.Zero||d.Old==IntPtr.Zero)throw new Exception("Native DIB/DC allocation failed");dibs.Add(d);return d;}
  static int[] Bytes(IntPtr p,int n){if(n<0||n>1024)throw new Exception("Native output count out of bounds");var b=new byte[n];Marshal.Copy(p,b,0,n);return Array.ConvertAll(b,x=>(int)x);}
  static int[] WithoutPadding(IntPtr p){var b=Bytes(p,24);var a=new List<int>();for(int i=0;i<24;i++)if(i%12<9)a.Add(b[i]);return a.ToArray();}
  public static Dictionary<string,object> Run(){
    var r=new Dictionary<string,object>();try{
      var s=Make(3,2,24);Bitmap obj;GetObject(s.Object,Marshal.SizeOf(typeof(Bitmap)),out obj);var output=Buffer(64);
      r["dibStride"]=obj.Stride;r["dibBitmapBitsSize"]=GetBitmapBits(s.Object,0,IntPtr.Zero);
      Marshal.Copy(new byte[]{1,2,3,4,5,6,7,8,9,0,0,0,11,12,13,14,15,16,17,18,19,0,0,0},0,s.Bits,24);
      r["dibPixels"]=new uint[]{GetPixel(s.DC,0,0),GetPixel(s.DC,0,1)};
      int n=GetBitmapBits(s.Object,64,output);r["dibBitmapBitsCount"]=n;r["dibBitmapBits"]=Bytes(output,n);
      SelectObject(s.DC,s.Old);var top=Header(3,-2,24);var bottom=Header(3,2,24);
      r["topDIBCount"]=GetDIBits(s.DC,s.Object,0,2,output,ref top,0);r["topDIB"]=WithoutPadding(output);
      Marshal.Copy(new byte[64],0,output,64);r["bottomDIBCount"]=GetDIBits(s.DC,s.Object,0,2,output,ref bottom,0);r["bottomDIB"]=WithoutPadding(output);
      Marshal.Copy(new byte[64],0,output,64);r["partialDIBCount"]=GetDIBits(s.DC,s.Object,1,1,output,ref bottom,0);r["partialDIB"]=Bytes(output,9);
      var raw=Buffer(20);var bytes=new byte[20];for(int i=0;i<20;i++)bytes[i]=(byte)(i+1);Marshal.Copy(bytes,0,raw,20);var ddb=CreateBitmap(3,2,1,24,raw);objects.Add(ddb);
      GetObject(ddb,Marshal.SizeOf(typeof(Bitmap)),out obj);r["ddbStride"]=obj.Stride;n=GetBitmapBits(ddb,64,output);r["ddbBits"]=Bytes(output,n);
      var a=Make(1,-1);var b=Make(1,-1);var brush=CreateSolidBrush(0x3cb17e);objects.Add(brush);SelectObject(b.DC,brush);
      uint[] rops={0xcc0020,0xee0086,0x8800c6,0x660046,0x440328,0x330008,0x1100a6,0xc000ca,0xbb0226,0xf00021,0xfb0a09,0x5a0049,0x550009,0x42,0xff0062};var values=new List<uint>();
      foreach(var rop in rops){SetPixel(a.DC,0,0,0xa6c319);SetPixel(b.DC,0,0,0x69e052);if(!BitBlt(b.DC,0,0,1,1,a.DC,0,0,rop))throw new Exception("Native BitBlt failed");values.Add(GetPixel(b.DC,0,0));}r["rops"]=values.ToArray();
      GdiFlush();Marshal.Copy(new byte[]{0,0,128,128},0,a.Bits,4);Marshal.Copy(new byte[]{200,0,0,255},0,b.Bits,4);
      r["alphaResult"]=AlphaBlend(b.DC,0,0,1,1,a.DC,0,0,1,1,0x01ff0000)?1:0;GdiFlush();r["alphaBytes"]=Bytes(b.Bits,4);
      GetObject(GetCurrentObject(s.DC,7),Marshal.SizeOf(typeof(Bitmap)),out obj);r["defaultDepth"]=obj.Bits;return r;
    }finally{foreach(var d in dibs){SelectObject(d.DC,d.Old);DeleteDC(d.DC);DeleteObject(d.Object);}foreach(var o in objects)DeleteObject(o);foreach(var p in buffers)Marshal.FreeHGlobal(p);dibs.Clear();objects.Clear();buffers.Clear();}
  }
}
'@
[GdiContractProbe]::Run() | ConvertTo-Json -Depth 8
