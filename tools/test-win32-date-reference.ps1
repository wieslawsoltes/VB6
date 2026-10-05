$ErrorActionPreference = 'Stop'
node tools/win32-date-reference.mjs --prepare
if ($LASTEXITCODE -ne 0) { throw 'Date reference generation failed' }
$cscript = Join-Path $env:SystemRoot 'SysWOW64/cscript.exe'
if (-not (Test-Path $cscript)) { throw 'The independent Date reference requires the installed x86 Windows Script Host' }
& $cscript //nologo //B //T:30 validation/dates/date-reference.vbs | Set-Content -Encoding utf8 validation/dates/date-reference.txt
if ($LASTEXITCODE -ne 0) { throw 'The installed Windows Script Host Date reference failed; do not treat this as a passed oracle' }
node tools/win32-date-reference.mjs --compile
if ($LASTEXITCODE -ne 0) { throw 'Date reference output verification failed' }
./tools/test-win32-dates.ps1 -Program AotDateReference -Manifest date-reference-build.json -ReportName date-reference-execution.json
