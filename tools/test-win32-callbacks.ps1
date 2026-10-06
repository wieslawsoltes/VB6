param([string]$Directory = 'validation/callbacks')
$ErrorActionPreference = 'Stop'
$root=Split-Path -Parent $PSScriptRoot
$out=[IO.Path]::GetFullPath($Directory)
New-Item -ItemType Directory -Force $out | Out-Null
$vswhere=Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
$vs=& $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) {throw 'Independent callback ABI tests require installed MSVC x86 tools'}
$vcvars=Join-Path $vs 'VC/Auxiliary/Build/vcvars32.bat'
$source=Join-Path $root 'tests/fixtures/native/callback-abi.c'
$exports=Join-Path $root 'tests/fixtures/native/callback-abi.def'
$command=Join-Path $out 'build-callback-probe.cmd'
@"
@echo off
call "$vcvars"
if errorlevel 1 exit /b %errorlevel%
cl /nologo /O2 /GS- /LD "$source" /link /NOENTRY /NODEFAULTLIB /MACHINE:X86 /DEF:"$exports" /OUT:vb6-callback-probe.dll kernel32.lib
exit /b %errorlevel%
"@ | Set-Content -Encoding ascii $command
Push-Location $out
try {
 & $env:ComSpec /d /c $command 2>&1 | Tee-Object -FilePath 'callback-compiler.log'
 if($LASTEXITCODE -ne 0){throw 'Independent C callback oracle compilation failed'}
} finally {Pop-Location}
$results=@()
foreach($program in @('AotCallbacks','AotCallbackThreadGuard')) {
 $plan=Get-Content (Join-Path $out ($program+'.build.json')) -Raw | ConvertFrom-Json
 $report=[ordered]@{ok=$false;program=$program;expectedExit=$plan.expectedExit;assertions=$plan.checks;platform=[Environment]::OSVersion.VersionString;hostArchitecture=$env:PROCESSOR_ARCHITECTURE;executableArchitecture='x86'}
 $clean=Join-Path ([IO.Path]::GetTempPath()) ('vb6-callback-'+[Guid]::NewGuid().ToString('N'))
 $process=[Diagnostics.Process]::new()
 try {
  New-Item -ItemType Directory $clean | Out-Null
  $exe=Join-Path $out ($program+'.exe');$dll=Join-Path $out 'vb6-callback-probe.dll'
  $report.sha256=(Get-FileHash $exe -Algorithm SHA256).Hash.ToLowerInvariant()
  $report.dependency=@{name='vb6-callback-probe.dll';sha256=(Get-FileHash $dll -Algorithm SHA256).Hash.ToLowerInvariant()}
  if($report.sha256 -ne $plan.sha256){throw 'EXE differs from its manifest'}
  Copy-Item $exe,$dll $clean
  $process.StartInfo.FileName=Join-Path $clean ($program+'.exe');$process.StartInfo.WorkingDirectory=$clean
  $process.StartInfo.UseShellExecute=$false;$process.EnableRaisingEvents=$true
  if(-not $process.Start()){throw 'Callback executable launch failed'}
  $null=$process.Handle
  if(-not $process.WaitForExit(30000)){throw 'Callback execution timed out'}
  $report.exitCode=$process.ExitCode
  if($report.exitCode -ne $plan.expectedExit){
   $detail=if($report.exitCode -gt 0 -and $report.exitCode -le $plan.checks.Count){$plan.checks[$report.exitCode-1]}else{'Unexpected native callback failure'}
   throw "Callback exit $($report.exitCode), expected $($plan.expectedExit): $detail"
  }
  if(@(Get-ChildItem $clean -Force).Count -ne 2){throw 'Unexpected extracted files beside EXE and declared test DLL'}
  $report.ok=$true
 }catch{$report.error=$_.Exception.Message}
 finally {
  try{if($process.Id -and -not $process.HasExited){$process.Kill();$process.WaitForExit(5000)|Out-Null}}catch{}
  $process.Dispose();Remove-Item $clean -Recurse -Force -ErrorAction SilentlyContinue
  $report | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out ($program+'.execution.json'))
  $results+=$report
 }
}
$results | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $out 'callbacks-execution.json')
$results | ConvertTo-Json -Depth 8 | Write-Host
if(@($results | Where-Object {-not $_.ok}).Count){throw 'Callback validation failed; see each execution report'}
