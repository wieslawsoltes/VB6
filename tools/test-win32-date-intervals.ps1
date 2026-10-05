$ErrorActionPreference = 'Stop'
node tools/win32-date-interval-reference.mjs --prepare
if ($LASTEXITCODE -ne 0) { throw 'Interval reference preparation failed' }
$cscript=Join-Path $env:SystemRoot 'SysWOW64/cscript.exe'
if (-not (Test-Path $cscript)) { throw 'Installed x86 Windows Script Host is required, not skipped' }
$directory=(Resolve-Path 'validation/date-intervals').Path
$process=[Diagnostics.Process]::new()
$process.StartInfo.FileName=$cscript
$process.StartInfo.UseShellExecute=$false
$process.StartInfo.CreateNoWindow=$true
$process.StartInfo.RedirectStandardOutput=$true
$process.StartInfo.RedirectStandardError=$true
foreach ($argument in @('//nologo','//T:60','//E:VBScript',(Join-Path $directory 'interval-reference.vbs'))) { $process.StartInfo.ArgumentList.Add($argument) }
try {
 if(-not $process.Start()){throw 'Could not start the independent interval reference'}
 $stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
 if(-not $process.WaitForExit(65000)){$process.Kill($true);$process.WaitForExit();throw 'Interval reference timed out'}
 $text=$stdout.GetAwaiter().GetResult();$errors=$stderr.GetAwaiter().GetResult()
 [IO.File]::WriteAllText((Join-Path $directory 'interval-reference.txt'),$text)
 [IO.File]::WriteAllText((Join-Path $directory 'interval-reference.stderr.log'),$errors)
 if($process.ExitCode -ne 0 -or [string]::IsNullOrWhiteSpace($text) -or $errors){throw "Interval reference failed: $errors"}
} finally {$process.Dispose()}
node tools/win32-date-interval-reference.mjs --compile
if($LASTEXITCODE -ne 0){throw 'Interval reference validation/compilation failed'}
$plan=Get-Content (Join-Path $directory 'interval-programs.json') -Raw | ConvertFrom-Json
$failures=@()
foreach($program in $plan.programs){
 try {
  ./tools/test-win32-dates.ps1 -Directory $directory -Program $program -Manifest ($program+'.json') -ReportName ($program+'-execution.json') -LifetimeCycles 0
 } catch {$failures+=($_.Exception.Message);Write-Host $_.Exception.Message}
}
@{ok=($failures.Count -eq 0);count=$plan.count;failures=$failures;programs=$plan.programs;reference=$plan.reference;dateToleranceDays=$plan.dateToleranceDays} | ConvertTo-Json -Depth 8 | Set-Content -Encoding utf8 (Join-Path $directory 'interval-validation.json')
if($failures.Count){throw ('Interval execution failed: '+($failures -join '; '))}
