$ErrorActionPreference = 'Stop'
node tools/win32-date-interval-reference.mjs --prepare
if ($LASTEXITCODE -ne 0) { throw 'Interval reference preparation failed' }
$cscript=Join-Path $env:SystemRoot 'SysWOW64/cscript.exe'
if (-not (Test-Path $cscript)) { throw 'Installed x86 Windows Script Host is required, not skipped' }
$directory=(Resolve-Path 'validation/date-intervals').Path
foreach($name in @('interval-raw-reference','interval-reference')) {
 $process=[Diagnostics.Process]::new()
 $process.StartInfo.FileName=$cscript
 $process.StartInfo.UseShellExecute=$false
 $process.StartInfo.CreateNoWindow=$true
 $process.StartInfo.RedirectStandardOutput=$true
 $process.StartInfo.RedirectStandardError=$true
 foreach ($argument in @('//nologo','//T:60','//E:VBScript',(Join-Path $directory ($name+'.vbs')))) { $process.StartInfo.ArgumentList.Add($argument) }
 try {
  if(-not $process.Start()){throw 'Could not start the independent interval reference'}
  $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
  if(-not $process.WaitForExit(65000)){$process.Kill($true);$process.WaitForExit();throw 'Interval reference timed out'}
  $text=$stdout.GetAwaiter().GetResult();$errors=$stderr.GetAwaiter().GetResult()
  [IO.File]::WriteAllText((Join-Path $directory ($name+'.txt')),$text)
  [IO.File]::WriteAllText((Join-Path $directory ($name+'.stderr.log')),$errors)
  if($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($text) -or $errors){throw "Interval reference failed: $errors"}
 } finally {$process.Dispose()}
}
# Independent TEST oracle for the documented Windows formatting API. VBScript
# rejects some valid year-100 dates; do not copy that engine's restricted range.
# This probe is not included in generated applications or the JavaScript SDK.
if(-not ('IntervalFormatOracle' -as [type])) {
 Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class IntervalFormatOracle {
 [StructLayout(LayoutKind.Explicit, Size=24)]
 struct DateVariant { [FieldOffset(0)] public ushort vt; [FieldOffset(8)] public double value; }
 [DllImport("oleaut32.dll")] static extern int VarFormatDateTime(ref DateVariant value, int format, uint flags, out IntPtr text);
 [DllImport("oleaut32.dll")] static extern void SysFreeString(IntPtr text);
 public static string Format(double value, int format) {
  var variant = new DateVariant { vt=7, value=value }; IntPtr text=IntPtr.Zero;
  try { int hr=VarFormatDateTime(ref variant,format,0,out text);if(hr!=0)Marshal.ThrowExceptionForHR(hr);return Marshal.PtrToStringBSTR(text); }
  finally { if(text!=IntPtr.Zero)SysFreeString(text); }
 }
}
'@
}
$requests=Get-Content (Join-Path $directory 'format-oracle-requests.json') -Raw | ConvertFrom-Json
$formatted=@(foreach($item in $requests) {
 @{index=$item.index;serial=$item.serial;format=$item.format;hresult=0;text=[IntervalFormatOracle]::Format($item.serial,$item.format)}
})
ConvertTo-Json -InputObject $formatted -Depth 6 | Set-Content -Encoding utf8 (Join-Path $directory 'format-oracle-results.json')
node tools/win32-date-interval-reference.mjs --compile
if($LASTEXITCODE -ne 0){throw 'Interval reference validation/compilation failed'}
$plan=Get-Content (Join-Path $directory 'interval-programs.json') -Raw | ConvertFrom-Json
$failures=@()
foreach($program in $plan.programs){
 try {
  ./tools/test-win32-dates.ps1 -Directory $directory -Program $program -Manifest ($program+'.json') -ReportName ($program+'-execution.json') -ResultFile 'interval-actual.txt' -LifetimeCycles 0
 } catch {$failures+=($_.Exception.Message);Write-Host $_.Exception.Message}
}
@{ok=($failures.Count -eq 0);count=$plan.count;failures=$failures;programs=$plan.programs;reference=$plan.reference;dateToleranceDays=$plan.dateToleranceDays} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $directory 'interval-validation.json')
if($failures.Count){throw ('Interval execution failed: '+($failures -join '; '))}
