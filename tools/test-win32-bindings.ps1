param([string]$Directory = 'validation/currency')
$ErrorActionPreference = 'Stop'
# Independent TEST oracle only. The JavaScript AOT compiler does not invoke CL.
$root = Split-Path -Parent $PSScriptRoot
$out = [IO.Path]::GetFullPath($Directory)
New-Item -ItemType Directory -Force $out | Out-Null
$vswhere = Join-Path ${env:ProgramFiles(x86)} 'Microsoft Visual Studio/Installer/vswhere.exe'
if (-not (Test-Path $vswhere)) { throw 'MSVC x86 test oracle requires installed Visual Studio C++ tools' }
$vs = & $vswhere -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
if (-not $vs) { throw 'No installed MSVC x86 tools found for the independent ABI test' }
$vcvars = Join-Path $vs 'VC/Auxiliary/Build/vcvars32.bat'
$source = Join-Path $root 'tests/fixtures/native/currency-abi.c'
$exports = Join-Path $root 'tests/fixtures/native/currency-abi.def'
$command = Join-Path $out 'build-abi-probe.cmd'
@"
@echo off
call "$vcvars"
if errorlevel 1 exit /b %errorlevel%
cl /nologo /O2 /GS- /LD "$source" /link /NOENTRY /NODEFAULTLIB /MACHINE:X86 /DEF:"$exports" /OUT:vb6-abi-probe.dll
exit /b %errorlevel%
"@ | Set-Content -Encoding ascii $command
Push-Location $out
try {
  & $env:ComSpec /d /c $command 2>&1 | Tee-Object -FilePath 'abi-compiler.log'
  if ($LASTEXITCODE -ne 0) { throw "Independent C ABI oracle compilation failed: $LASTEXITCODE" }
} finally { Pop-Location }
& (Join-Path $PSScriptRoot 'test-win32-currency.ps1') -Directory $out -Program 'AotCurrencyBindings' -Manifest 'currency-bindings-build.json' -ReportName 'currency-bindings-execution.json' -Dependency 'vb6-abi-probe.dll'
