param([string]$Output='reports/text-codepages/windows-text-search.json')
$ErrorActionPreference='Stop'
$base=Join-Path (Split-Path -Parent $Output) 'text-reference.vbs'
if(-not (Test-Path $base)){throw 'Run script-text-reference.ps1 first'}
$prefix=[IO.File]::ReadAllText([IO.Path]::GetFullPath($base)).Split(@('Call Probe(0,'),[StringSplitOptions]::None)[0]
$records=New-Object 'System.Collections.Generic.List[object]'
foreach($start in @(0,1,2,3,4,5,6,7)){foreach($s in @('"aBc"','"A" & ChrB(66)','Null','""')){foreach($needle in @('"B"','ChrB(66)','ChrB(0)','""')){foreach($mode in @(0,1)){$records.Add(@{expression="InStrB($start, $s, $needle, $mode)";lcid=1033})}}}}
foreach($locale in @(1033,1045,1055,1041)){foreach($fn in @('UCase','LCase')){$records.Add(@{expression="$fn(ChrW(105) & ChrW(32) & ChrW(73) & ChrW(32) & ChrW(304) & ChrW(32) & ChrW(305))";lcid=$locale})}}
$lines=New-Object 'System.Collections.Generic.List[string]';$lines.Add($prefix)
for($i=0;$i -lt $records.Count;$i++){$lines.Add('oldLocale = SetLocale('+ $records[$i].lcid +')');$lines.Add('Call Probe('+ $i +', "'+$records[$i].expression.Replace('"','""')+'")')}
$script=Join-Path (Split-Path -Parent $Output) 'text-search.vbs'
[IO.File]::WriteAllText([IO.Path]::GetFullPath($script),[string]::Join("`r`n",$lines),[Text.Encoding]::ASCII)
$process=New-Object Diagnostics.Process;$process.StartInfo.FileName="$env:WINDIR\SysWOW64\cscript.exe";$process.StartInfo.Arguments='//nologo //T:30 //E:VBScript "'+[IO.Path]::GetFullPath($script)+'"';$process.StartInfo.UseShellExecute=$false;$process.StartInfo.CreateNoWindow=$true;$process.StartInfo.RedirectStandardOutput=$true;$process.StartInfo.RedirectStandardError=$true
try{
 if(-not $process.Start()){throw 'Could not start x86 Script Host'}
 $out=$process.StandardOutput.ReadToEndAsync();$err=$process.StandardError.ReadToEndAsync()
 if(-not $process.WaitForExit(35000)){$process.Kill();$process.WaitForExit();throw 'Script Host timeout'}
 $text=$out.GetAwaiter().GetResult();$errors=$err.GetAwaiter().GetResult()
 [IO.File]::WriteAllText([IO.Path]::GetFullPath($script+'.stdout.log'),$text);[IO.File]::WriteAllText([IO.Path]::GetFullPath($script+'.stderr.log'),$errors)
 if($process.ExitCode -ne 0 -or -not [string]::IsNullOrWhiteSpace($errors)){throw "Script Host failed: $errors $text"}
 $rows=@($text -split '\r?\n' | Where-Object {$_ -ne ''})
 if($rows.Count -ne $records.Count){throw 'Incomplete Script Host comparison'}
 for($i=0;$i -lt $rows.Count;$i++){$a=$rows[$i] -split '\|',4;if($a.Count -ne 4 -or [int]$a[0] -ne $i){throw 'Malformed record'};$records[$i].number=[int]$a[1];$records[$i].type=[int]$a[2];$records[$i].value=$a[3]}
 @{schema=1;reference='Installed x86 Windows Script Host, per-record LCID; not a licensed VB6 compiler';os=[Environment]::OSVersion.VersionString;records=$records.ToArray()} | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $Output
}finally{$process.Dispose()}
