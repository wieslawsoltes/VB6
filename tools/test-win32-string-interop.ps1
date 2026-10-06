param([string]$Directory = 'validation/string-interop')
$ErrorActionPreference = 'Stop'
$root=Split-Path -Parent $PSScriptRoot
$out=[IO.Path]::GetFullPath($Directory)
New-Item -ItemType Directory -Force $out | Out-Null
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) {throw 'Independent String ABI tests require installed MSVC x86 tools'}
$vcvars=Join-Path $vs 'VC/Auxiliary/Build/vcvars32.bat'
$source=Join-Path $root 'tests/fixtures/native/string-abi.c'
$exports=Join-Path $root 'tests/fixtures/native/string-abi.def'
$command=Join-Path $out 'build-string-probe.cmd'
@"
@echo off
call "$vcvars"
if errorlevel 1 exit /b %errorlevel%
cl /nologo /Od /GS- /LD "$source" /link /NOENTRY /NODEFAULTLIB /MACHINE:X86 /DEF:"$exports" /OUT:vb6-string-probe.dll kernel32.lib oleaut32.lib psapi.lib
exit /b %errorlevel%
"@ | Set-Content -Encoding ascii $command
Push-Location $out
try {
 & $env:ComSpec /d /c $command 2>&1 | Tee-Object -FilePath 'string-compiler.log'
 if($LASTEXITCODE -ne 0){throw 'Independent C String oracle compilation failed'}
} finally {Pop-Location}
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class StringOracleEnvironment {
 [DllImport("kernel32.dll")] public static extern uint GetACP();
}
'@
$results=@()
foreach($entry in @(@('AotStringInterop','string-interop-build.json'),@('AotWin32Strings','system-strings-build.json'))) {
 $program=$entry[0]
 $plan=Get-Content (Join-Path $out $entry[1]) -Raw | ConvertFrom-Json
 $report=[ordered]@{ok=$false;program=$program;expectedExit=0;assertions=$plan.checks;platform=[Environment]::OSVersion.VersionString;hostArchitecture=$env:PROCESSOR_ARCHITECTURE;executableArchitecture='x86';ansiCodePage=[StringOracleEnvironment]::GetACP();dependencies=@()}
 $clean=Join-Path ([IO.Path]::GetTempPath()) ('vb6-strings-'+[Guid]::NewGuid().ToString('N'))
 $process=[Diagnostics.Process]::new()
 try {
  New-Item -ItemType Directory $clean | Out-Null
  $exe=Join-Path $out ($program+'.exe')
  $report.sha256=(Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  if($report.sha256 -ne $plan.sha256){throw 'EXE differs from its manifest'}
  Copy-Item $exe $clean
  foreach($name in $plan.dependencies){
   if($name -ne 'vb6-string-probe.dll'){throw 'Unexpected test dependency'}
   $dll=Join-Path $out $name
   $report.dependencies+=@{name=$name;sha256=(Get-FileHash $dll -Algorithm SHA256).Hash.ToLowerInvariant()}
   Copy-Item $dll $clean
  }
  $process.StartInfo.FileName=Join-Path $clean ($program+'.exe');$process.StartInfo.WorkingDirectory=$clean
  $process.StartInfo.UseShellExecute=$false;$process.EnableRaisingEvents=$true
  if(-not $process.Start()){throw 'String executable launch failed'}
  $null=$process.Handle
  if(-not $process.WaitForExit(60000)){throw 'String execution timed out'}
  $report.exitCode=$process.ExitCode
  if($report.exitCode -ne 0){
   $detail=if($report.exitCode -gt 0 -and $report.exitCode -le $plan.checks.Count){$plan.checks[$report.exitCode-1]}else{'Unexpected native String failure'}
   throw "String exit $($report.exitCode): $detail"
  }
  if(@(Get-ChildItem $clean -Force).Count -ne (1+$plan.dependencies.Count)){throw 'Unexpected extracted files beside EXE and declared test dependencies'}
  $report.ok=$true
 }catch{$report.error=$_.Exception.Message}
 finally {
  try{if($process.Id -and -not $process.HasExited){$process.Kill();$process.WaitForExit(5000)|Out-Null}}catch{}
  $process.Dispose();Remove-Item $clean -Recurse -Force -ErrorAction SilentlyContinue
  $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out ($program+'.execution.json'))
  $results+=$report
 }
}
$results | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out 'string-interop-execution.json')
$results | ConvertTo-Json -Depth 8 | Write-Host
if(@($results | Where-Object {-not $_.ok}).Count){throw 'Native String validation failed; see each execution report'}
