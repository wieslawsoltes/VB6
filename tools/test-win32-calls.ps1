param([string]$Directory = 'validation/calls')
$ErrorActionPreference = 'Stop'
# This is a Windows TEST harness. The generated apps contain no PowerShell/CLR.
if (-not ('NativeCallWindowsProbe' -as [type])) {
 Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class NativeCallWindowsProbe {
 public delegate bool EnumProc(IntPtr window, IntPtr context);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr context);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr context);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint id);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode)] static extern IntPtr TextMessage(IntPtr h,uint m,IntPtr w,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
 static string Text(IntPtr h) {var text=new StringBuilder(2048);UIntPtr result;TextMessage(h,13,(IntPtr)text.Capacity,text,2,200,out result);return text.ToString();}
 public static string Diagnostics(int process) {var values=new List<string>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==process){values.Add(Text(h));EnumChildWindows(h,(c,q)=>{values.Add(Text(c));return true;},IntPtr.Zero);}return true;},IntPtr.Zero);return string.Join(" | ",values);}
}
'@
}
$path = (Resolve-Path $Directory).Path
$reports = @()
foreach ($program in @('AotCalls','AotCallProperties')) {
 $report = [ordered]@{ok=$false;program=$program;platform=[Environment]::OSVersion.VersionString;hostArchitecture=$env:PROCESSOR_ARCHITECTURE;executableArchitecture='x86';checks=@()}
 $clean = Join-Path ([IO.Path]::GetTempPath()) ('vb6-calls-'+[Guid]::NewGuid().ToString('N'))
 $process = [Diagnostics.Process]::new()
 try {
  $plan = Get-Content (Join-Path $path ($program+'.build.json')) -Raw | ConvertFrom-Json
  $source = Join-Path $path ($program+'.exe')
  $report.sha256 = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
  if ($report.sha256 -ne $plan.sha256) {throw 'Executable differs from its build manifest'}
  [IO.Directory]::CreateDirectory($clean) | Out-Null
  $exe=Join-Path $clean ($program+'.exe');Copy-Item $source $exe
  if (@(Get-ChildItem $clean -Force).Count -ne 1) {throw 'Execution directory was not single-file'}
  $process.StartInfo.FileName=$exe;$process.StartInfo.WorkingDirectory=$clean;$process.StartInfo.UseShellExecute=$false
  $process.EnableRaisingEvents=$true
  if (-not $process.Start()) {throw 'Could not start native call test'}
  $null=$process.Handle
  if (-not $process.WaitForExit(30000)) {throw ('Native call test timed out: '+[NativeCallWindowsProbe]::Diagnostics($process.Id))}
  $report.exitCode=$process.ExitCode
  if ($process.ExitCode -ne 0) {
   $index=$process.ExitCode
   $meaning=if($index -gt 0 -and $index -le $plan.checks.Count){$plan.checks[$index-1]}else{'Native error or a callee was entered despite failed argument validation'}
   throw "Native assertion $index failed: $meaning"
  }
  $report.embeddedAssertions=$plan.checks
  $report.checks += "$($plan.checks.Count) numbered native call assertions returned success"
  if (@(Get-ChildItem $clean -Force).Count -ne 1) {throw 'Execution extracted unexpected files beside the EXE'}
  $report.checks += 'Only the EXE was supplied; no adjacent runtime or extracted files'
  $report.ok=$true
 } catch {
  $report.error=$_.Exception.Message
 } finally {
  try {if($process.Id -and -not $process.HasExited){$process.Kill();$process.WaitForExit(5000)|Out-Null}}catch{}
  $process.Dispose()
  Remove-Item -Path $clean -Recurse -Force -ErrorAction SilentlyContinue
  $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $path ($program+'.execution.json'))
  $report | ConvertTo-Json -Depth 8 | Write-Host
  $reports += $report
 }
}
$reports | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $path 'calls-execution.json')
if (@($reports | Where-Object {-not $_.ok}).Count) {throw 'One or more native call executables failed; see execution reports'}
