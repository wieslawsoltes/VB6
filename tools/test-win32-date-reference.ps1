$ErrorActionPreference = 'Stop'
node tools/win32-date-reference.mjs --prepare
if ($LASTEXITCODE -ne 0) { throw 'Date reference generation failed' }
$cscript = Join-Path $env:SystemRoot 'SysWOW64/cscript.exe'
if (-not (Test-Path $cscript)) { throw 'The independent Date reference requires the installed x86 Windows Script Host' }
$script = (Resolve-Path 'validation/dates/date-reference.vbs').Path
$directory = Split-Path -Parent $script
# Always preserve stdout/stderr, including an empty response. Batch mode can hide
# script-host diagnostics; an absolute path avoids forward-slash option parsing.
$process = [Diagnostics.Process]::new()
$process.StartInfo.FileName = $cscript
$process.StartInfo.UseShellExecute = $false
$process.StartInfo.CreateNoWindow = $true
$process.StartInfo.RedirectStandardOutput = $true
$process.StartInfo.RedirectStandardError = $true
foreach ($argument in @('//nologo', '//T:30', '//E:VBScript', $script)) { $process.StartInfo.ArgumentList.Add($argument) }
$report = [ordered]@{ executable=$cscript; script=$script; ok=$false }
try {
  if (-not $process.Start()) { throw 'Could not start the installed Date reference host' }
  $stdout = $process.StandardOutput.ReadToEndAsync()
  $stderr = $process.StandardError.ReadToEndAsync()
  if (-not $process.WaitForExit(35000)) { $process.Kill($true); $process.WaitForExit(); throw 'Windows Script Host reference timed out' }
  $text = $stdout.GetAwaiter().GetResult()
  $errors = $stderr.GetAwaiter().GetResult()
  [IO.File]::WriteAllText((Join-Path $directory 'date-reference.txt'), $text)
  [IO.File]::WriteAllText((Join-Path $directory 'date-reference.stderr.log'), $errors)
  $report.exitCode=$process.ExitCode; $report.stdout=$text; $report.stderr=$errors
  Write-Host $text
  if ($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($text) -or -not [string]::IsNullOrWhiteSpace($errors)) {
    throw "The installed Windows Script Host Date reference failed (exit $($process.ExitCode)): $errors $text"
  }
  node tools/win32-date-reference.mjs --compile
  if ($LASTEXITCODE -ne 0) { throw 'Date reference output verification failed' }
  $report.ok=$true
} catch { $report.error=$_.Exception.Message; throw }
finally {
  $process.Dispose()
  $report | ConvertTo-Json -Depth 5 | Set-Content -Encoding utf8 (Join-Path $directory 'date-reference-host.json')
}
./tools/test-win32-dates.ps1 -Program AotDateReference -Manifest date-reference-build.json -ReportName date-reference-execution.json
