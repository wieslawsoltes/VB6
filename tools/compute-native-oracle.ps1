# Native Automation numeric reference. No VB6 license, provider, network or user data.
param([string]$Out = 'reports/compute/oracle/numeric.json')
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class ComputeAutomationOracle {
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] static extern int MultiByteToWideChar(uint codePage,uint flags,byte[] input,int length,[Out] char[] output,int capacity);
  [DllImport("kernel32.dll",SetLastError=true,CharSet=CharSet.Unicode,ExactSpelling=true)] static extern int WideCharToMultiByte(uint codePage,uint flags,char[] input,int length,[Out] byte[] output,int capacity,IntPtr defaultChar,out int usedDefault);

  [DllImport("oleaut32.dll")] static extern int VarCyAdd(long a,long b,out long r);
  [DllImport("oleaut32.dll")] static extern int VarCySub(long a,long b,out long r);
  [DllImport("oleaut32.dll")] static extern int VarCyMul(long a,long b,out long r);
  [DllImport("oleaut32.dll")] static extern int VarCyNeg(long a,out long r);
  [DllImport("oleaut32.dll")] static extern int VarCyAbs(long a,out long r);
  [DllImport("oleaut32.dll")] static extern int VarCyFix(long a,out long r);
  [DllImport("oleaut32.dll")] static extern int VarCyInt(long a,out long r);
  [DllImport("oleaut32.dll")] static extern int VarR8FromCy(long a,out double r);
  [DllImport("oleaut32.dll")] static extern int VarCyFromR8(double a,out long r);
  [DllImport("oleaut32.dll")] static extern int VarI4FromCy(long a,out int r);
  [StructLayout(LayoutKind.Sequential)] public struct ST {public ushort Year,Month,DayOfWeek,Day,Hour,Minute,Second,Millisecond;}
  [StructLayout(LayoutKind.Sequential)] public struct UDATE {public ST st;public ushort DayOfYear;}
  [DllImport("oleaut32.dll")] static extern int VarUdateFromDate(double a,uint flags,out UDATE r);
  static uint[] Words(long v) {return new uint[]{unchecked((uint)v),unchecked((uint)((ulong)v>>32))};}
  static uint seed=0x6abc9d01;
  static uint Next() {seed^=seed<<13;seed^=seed>>17;seed^=seed<<5;return seed;}
  static int Error(int hr) {if(hr>=0)return 0;if(hr==unchecked((int)0x8002000A))return 6;throw new Exception("Unexpected Automation HRESULT "+hr.ToString("X8"));}
  public static object Generate() {
    var data=new List<object>();
    var edge=new long[]{0,1,-1,5,-5,4999,5000,5001,-4999,-5000,-5001,10000,-10000,15000,-15000,25000,-25000,314159265,21474836475000,-21474836485000,long.MinValue,long.MaxValue};
    var pairs=new List<(long,long)>();foreach(long a in edge)foreach(long b in edge)pairs.Add((a,b));
    for(int i=0;i<384;i++)pairs.Add((unchecked((long)(((ulong)Next()<<32)|Next())),unchecked((long)(((ulong)Next()<<32)|Next()))));
    foreach(var pair in pairs) {
      var a=pair.Item1;var b=pair.Item2;
      foreach(var op in new[]{"cy-add","cy-sub","cy-mul","cy-neg","cy-abs","cy-fix","cy-floor","cy-to-double","cy-to-long"}) {
        long r=0;int hr=0;
        switch(op) {
          case "cy-add":hr=VarCyAdd(a,b,out r);break;
          case "cy-sub":hr=VarCySub(a,b,out r);break;
          case "cy-mul":hr=VarCyMul(a,b,out r);break;
          case "cy-neg":hr=VarCyNeg(a,out r);break;
          case "cy-abs":hr=VarCyAbs(a,out r);break;
          case "cy-fix":hr=VarCyFix(a,out r);break;
          case "cy-floor":hr=VarCyInt(a,out r);break;
          case "cy-to-double":double d;hr=VarR8FromCy(a,out d);r=BitConverter.DoubleToInt64Bits(d);break;
          case "cy-to-long":int n;hr=VarI4FromCy(a,out n);r=unchecked((uint)n);break;
        }
        var error=Error(hr);data.Add(new{op,a=Words(a),b=Words(b),result=Words(error==0?r:0),error});
      }
    }
    var doubles=new List<double>{0,-0.0,0.00005,-0.00005,0.00015,-0.00015,0.00025,-0.00025,1.23455,-1.23455,1e-300,1e300,922337203685477.5,922337203685477.625,-922337203685477.5,-922337203685477.625,Math.PI};
    for(int i=0;i<384;i++) {ulong bits=((ulong)(Next()&0xffefffff)<<32)|Next();doubles.Add(BitConverter.Int64BitsToDouble(unchecked((long)bits)));}
    foreach(var d in doubles) {long r;int hr=VarCyFromR8(d,out r);var error=Error(hr);data.Add(new{op="double-to-cy",a=Words(BitConverter.DoubleToInt64Bits(d)),b=Words(0),result=Words(error==0?r:0),error});}
    var dates=new List<object>();
    var dateInputs=new List<double>{-657434,2958465,0,-0.0,0.5,-0.5,-1.75,2.25,36585,36585.5};
    foreach(double baseDay in new double[]{-657434,-109205,-1,0,1,60,36585,45351,2958465})
      foreach(double seconds in new double[]{0,1,2,5,11,41,59,60,61,3599,86399,0.25,0.5,0.75,59.4999,59.5,59.9999,86399.4999,86399.5,86399.9999})dateInputs.Add(baseDay<0?baseDay-seconds/86400:baseDay+seconds/86400);
    for(int i=0;i<384;i++){int day=unchecked((int)(Next()%3615900))-657434;double fraction=(Next()%86400)/86400.0;dateInputs.Add(day<0?day-fraction:day+fraction);}
    foreach(double d in dateInputs){UDATE fields;int hr=VarUdateFromDate(d,0,out fields);var v=fields.st;dates.Add(new{a=Words(BitConverter.DoubleToInt64Bits(d)),fields=new int[]{v.Year,v.Month,v.Day,v.DayOfWeek+1,v.Hour,v.Minute,v.Second,fields.DayOfYear},error=hr<0?5:0});}
    var codePages=new List<object>();
    foreach(uint cp in new uint[]{1250,1252})for(int b=0;b<256;b++) {
      var text=new char[2];if(MultiByteToWideChar(cp,0,new byte[]{(byte)b},1,text,2)!=1)throw new Exception("Code page decode failed");
      var bytes=new byte[2];int usedDefault;int count=WideCharToMultiByte(cp,0x400,text,1,bytes,2,IntPtr.Zero,out usedDefault);
      if(count!=1 || usedDefault!=0)throw new Exception("Code page roundtrip failed");
      codePages.Add(new {codePage=cp,input=b,unit=(int)text[0],encoded=(int)bytes[0]});
    }
    return new {source="Windows OleAut32 / NLS",codePages,architecture=RuntimeInformation.ProcessArchitecture.ToString(),os=Environment.OSVersion.VersionString,cases=data,dates};
  }
}
'@
$Parent=Split-Path -Parent $Out
if ($Parent) {New-Item -ItemType Directory -Force $Parent | Out-Null}
[ComputeAutomationOracle]::Generate() | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 $Out
$Report=Get-Content -Raw $Out | ConvertFrom-Json
Write-Host ("Native Automation reference: {0} cases ({1}, {2})" -f $Report.cases.Count,$Report.architecture,$Report.os)
