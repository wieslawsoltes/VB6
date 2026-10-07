param([string]$Directory = 'reports/native-optimizer')
$ErrorActionPreference = 'Stop'
# Only the test driver uses PowerShell. Each tested app is a freestanding PE32.
$root = (Resolve-Path $Directory).Path
$plans = Get-Content (Join-Path $root 'builds.json') -Raw | ConvertFrom-Json
$expected = @()
foreach ($family in @('AotOptimizerRecords','AotArithmetic','AotLanguage','AotContinuationLanguage','AotStringLibrary','AotWithControls','AotAssembler')) {
  foreach ($level in 0..2) {$expected += "$family-O$level"}
}
$expected += @('AotContinuationLanguage-O2-pruned','AotStringLibrary-O2-pruned')
if ($plans.Count -ne $expected.Count -or (Compare-Object ($plans.name | Sort-Object) ($expected | Sort-Object))) {throw 'Incomplete or duplicated native fixture/optimization matrix'}
if (@($plans | Where-Object {-not $_.checks -or $_.checks.Count -lt 1}).Count) {throw 'Every native fixture must have explicit assertions'}
$results = @()
foreach ($plan in $plans) {
  $report = [ordered]@{name=$plan.name;optimization=$plan.optimization;ok=$false;architecture='x86';platform=[Environment]::OSVersion.VersionString;sha256=$null;exitCode=$null;assertions=$plan.checks}
  $directory = Join-Path ([IO.Path]::GetTempPath()) ('vb6-optimizer-'+[Guid]::NewGuid().ToString('N'))
  $process = [Diagnostics.Process]::new()
  try {
    $source = Join-Path $root ($plan.name+'.exe')
    $report.sha256 = (Get-FileHash $source -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($report.sha256 -ne $plan.sha256) { throw 'Executable differs from compiled bytes' }
    [IO.Directory]::CreateDirectory($directory) | Out-Null
    $exe = Join-Path $directory ($plan.name+'.exe')
    Copy-Item $source $exe
    $process.StartInfo.FileName=$exe
    $process.StartInfo.WorkingDirectory=$directory
    $process.StartInfo.UseShellExecute=$false
    if (-not $process.Start()) { throw 'Could not start the native executable' }
    $null=$process.Handle
    if (-not $process.WaitForExit(20000)) { throw 'Native executable timed out (possible runtime error dialog)' }
    $report.exitCode=$process.ExitCode
    if ($process.ExitCode -ne 0) {
      $index=$process.ExitCode
      $reason=if ($index -gt 0 -and $index -le $plan.checks.Count) {$plan.checks[$index-1]} else {'Native failure or existing arithmetic assertion'}
      throw "Native assertion $index failed: $reason"
    }
    if (@(Get-ChildItem $directory -Force).Count -ne 1) { throw 'Executable extracted unexpected adjacent files' }
    $report.ok=$true
  } catch { $report.error=$_.Exception.Message }
  finally {
    try { if ($process.Id -and -not $process.HasExited) {$process.Kill();$process.WaitForExit(5000)|Out-Null} } catch {}
    $process.Dispose()
    Remove-Item $directory -Force -Recurse -ErrorAction SilentlyContinue
  }
  $results += $report
  $report | ConvertTo-Json -Depth 10 | Write-Host
}
$results | ConvertTo-Json -Depth 10 | Set-Content -Encoding utf8 (Join-Path $root 'execution.json')
if (@($results | Where-Object {-not $_.ok}).Count) { throw 'Native optimizer/record execution failed; see execution.json' }
