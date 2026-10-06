$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class GeometryOracle {
 [StructLayout(LayoutKind.Sequential)] public struct Point { public int X,Y; public Point(int x,int y){X=x;Y=y;} }
 [DllImport("gdi32.dll")] static extern IntPtr CreateEllipticRgn(int l,int t,int r,int b);
 [DllImport("gdi32.dll")] static extern IntPtr CreateRoundRectRgn(int l,int t,int r,int b,int w,int h);
 [DllImport("gdi32.dll")] static extern IntPtr CreatePolygonRgn(Point[] p,int n,int mode);
 [DllImport("gdi32.dll")] static extern uint GetRegionData(IntPtr r,uint count,IntPtr data);
 [DllImport("gdi32.dll")] static extern int DeleteObject(IntPtr r);
 static int[][] Rectangles(IntPtr region){
  if(region==IntPtr.Zero)throw new Exception("Native region creation failed");
  uint size=GetRegionData(region,0,IntPtr.Zero);var p=Marshal.AllocHGlobal((int)size);
  try {if(GetRegionData(region,size,p)!=size)throw new Exception("Native region read failed");int count=Marshal.ReadInt32(p,8);var result=new int[count][];for(int i=0;i<count;i++){result[i]=new int[4];for(int j=0;j<4;j++)result[i][j]=Marshal.ReadInt32(p,32+i*16+j*4);}return result;}
  finally{Marshal.FreeHGlobal(p);DeleteObject(region);}
 }
 public static object Run(){
  var output=new List<object>();
  foreach(var size in new int[][]{new[]{0,0},new[]{1,1},new[]{2,2},new[]{3,3},new[]{4,4},new[]{5,5},new[]{8,8},new[]{9,6},new[]{12,7},new[]{7,12},new[]{23,17}}){
   int w=size[0],h=size[1];output.Add(new {name="ellipse",args=new[]{0,0,w,h},rectangles=Rectangles(CreateEllipticRgn(0,0,w,h))});
   output.Add(new {name="rounded",args=new[]{0,0,w,h,4,4},rectangles=Rectangles(CreateRoundRectRgn(0,0,w,h,4,4))});
  }
  var shapes=new int[][][]{new[]{new[]{0,0},new[]{8,0},new[]{0,8}},new[]{new[]{0,0},new[]{8,3},new[]{3,8}},new[]{new[]{0,0},new[]{8,8},new[]{8,0},new[]{0,8}},new[]{new[]{-8,-8},new[]{-1,-6},new[]{-3,2}},new[]{new[]{0,0},new[]{6,0},new[]{6,6},new[]{0,6},new[]{0,0},new[]{6,0},new[]{6,6},new[]{0,6}}};
  foreach(var shape in shapes)foreach(int mode in new[]{1,2}){var p=new Point[shape.Length];for(int i=0;i<p.Length;i++)p[i]=new Point(shape[i][0],shape[i][1]);output.Add(new {name="polygon",points=shape,mode,rectangles=Rectangles(CreatePolygonRgn(p,p.Length,mode))});}
  return output;
 }
}
'@
New-Item -Force -ItemType Directory reports/win32-geometry | Out-Null
[GeometryOracle]::Run() | ConvertTo-Json -Depth 20 | Set-Content -Encoding utf8 reports/win32-geometry/native.json
