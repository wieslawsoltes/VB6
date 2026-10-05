param([string]$Directory = 'validation/currency', [string]$Program = 'AotCurrency',
 [string]$Manifest = 'currency-build.json', [string]$ReportName = 'currency-execution.json',
 [string]$Dependency = '')
$ErrorActionPreference = 'Stop'
# Test-only Windows interop. The generated PE contains no CLR or script host.
Add-Type @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
public static class CurrencyWindowsProbe {
 public delegate bool EnumProc(IntPtr window, IntPtr context);
 [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc callback,IntPtr context);
 [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent,EnumProc callback,IntPtr context);
 [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint id);
 [DllImport("user32.dll",EntryPoint="SendMessageTimeoutW",CharSet=CharSet.Unicode)] static extern IntPtr TextMessage(IntPtr h,uint m,IntPtr w,StringBuilder text,uint flags,uint timeout,out UIntPtr result);
 static string Text(IntPtr h) {var text=new StringBuilder(2048);UIntPtr result;TextMessage(h,13,(IntPtr)text.Capacity,text,2,200,out result);return text.ToString();}
 public static string Diagnostics(int process) {var values=new List<string>();EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==process){values.Add(Text(h));EnumChildWindows(h,(c,q)=>{values.Add(Text(c));return true;},IntPtr.Zero);}return true;},IntPtr.Zero);return string.Join(" | ",values);}
}
'@
$report = [ordered]@{ ok=$false; platform=[Environment]::OSVersion.VersionString; hostArchitecture=$env:PROCESSOR_ARCHITECTURE; culture=[Globalization.CultureInfo]::CurrentCulture.Name; executableArchitecture='x86'; checks=@() }
foreach ($name in @($Program,$Manifest,$ReportName,$Dependency)) {
 if ($name -and $name -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Invalid test artifact name' }
}
$path = (Resolve-Path $Directory).Path
$plan = Get-Content (Join-Path $path $Manifest) -Raw | ConvertFrom-Json
$source = Join-Path $path ($Program+'.exe')
$report.sha256 = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
$clean = Join-Path ([IO.Path]::GetTempPath()) ('vb6-currency-'+[Guid]::NewGuid().ToString('N'))
$process = [Diagnostics.Process]::new()
try {
 if($report.sha256 -ne $plan.sha256){throw 'Generated executable digest does not match its build manifest'}
 [IO.Directory]::CreateDirectory($clean) | Out-Null
 $exe=Join-Path $clean ($Program+'.exe');Copy-Item $source $exe
 if(@(Get-ChildItem $clean).Count -ne 1){throw 'Isolated execution directory was not single-file'}
 $expectedFiles=1
 if($Dependency){
  $dll=Join-Path $path $Dependency
  $report.dependency=@{name=$Dependency;sha256=(Get-FileHash $dll -Algorithm SHA256).Hash.ToLowerInvariant()}
  Copy-Item $dll (Join-Path $clean $Dependency)
  $expectedFiles=2
  $report.checks += 'Copied only the EXE and explicitly supplied independent test DLL'
 }else{$report.checks += 'Copied only the EXE into an empty directory'}
 $process.StartInfo.FileName=$exe;$process.StartInfo.WorkingDirectory=$clean;$process.StartInfo.UseShellExecute=$false
 $process.EnableRaisingEvents=$true
 if(-not $process.Start()){throw 'Could not start the Currency executable'}
 $null=$process.Handle
 if(-not $process.WaitForExit(30000)){throw ('Currency execution timed out: '+[CurrencyWindowsProbe]::Diagnostics($process.Id))}
 $report.exitCode=$process.ExitCode
 if($process.ExitCode -ne 0){
  $index=$process.ExitCode
  $meaning=if($index -gt 0 -and $index -le $plan.checks.Count){$plan.checks[$index-1]}elseif($index -eq 240){'Expected array lock error 10 in nested ByRef call'}else{'Native failure or unhandled runtime error'}
  throw "Currency assertion $index failed: $meaning"
 }
 $report.embeddedAssertions=$plan.checks
 $report.checks += "$($plan.checks.Count) numbered native Currency assertions returned success"
 $report.checks += '2,000 numeric lifetime or ABI cycles completed'
 if(@(Get-ChildItem $clean -Force).Count -ne $expectedFiles){throw 'Execution extracted unexpected files beside the EXE'}
 if($Dependency){$report.checks += 'No extracted files or undeclared adjacent dependencies'}
 else{$report.checks += 'No adjacent runtime, DLL or extracted application file required'}
 $report.ok=$true
} catch {
 $report.error=$_.Exception.Message
 throw
} finally {
 try {if($process.Id -and -not $process.HasExited){$process.Kill();$process.WaitForExit(5000)|Out-Null}}catch{}
 $process.Dispose()
 $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $path $ReportName)
 Remove-Item -Path $clean -Recurse -Force -ErrorAction SilentlyContinue
 $report | ConvertTo-Json -Depth 8 | Write-Host
}
