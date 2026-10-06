param([string]$Output='reports/text-codepages/windows-script-text.json')
$ErrorActionPreference='Stop'
$expressions=New-Object 'System.Collections.Generic.List[string]'
foreach($fn in @('ChrB','ChrW','Chr')){foreach($value in @('0','65','255','256','-1','-32768','-32769','65535','65536','65.5','0.5','1e20','Null','Empty')){$expressions.Add("$fn($value)")}}
foreach($fn in @('LeftB','RightB')){foreach($value in @('"AB"','ChrB(65) & ChrB(66) & ChrB(67)','Null','Empty')){foreach($length in @('0','1','2','3','4','5','-1','2.5','Null')){$expressions.Add("$fn($value, $length)")}}}
foreach($start in @(0,1,2,3,4,5,6)){foreach($length in @(0,1,2,3,-1)){$expressions.Add("MidB(ChrB(65) & ChrB(66) & ChrB(67), $start, $length)")}}
foreach($fn in @('Len','LenB','AscB','AscW','CStr','UCase','LCase','TypeName','VarType','IsObject')){foreach($value in @('ChrB(65)','ChrB(65) & ChrB(66)','ChrB(65) & ChrB(66) & ChrB(67)','""','ChrW(0)','Null','Empty')){$expressions.Add("$fn($value)")}}
$prefix=@'
Option Explicit
Dim oldLocale
oldLocale = SetLocale(1033)
Sub Probe(id, expression)
  Dim value, errorNumber, kind, payload, i, byteValue
  On Error Resume Next
  value = Empty
  Err.Clear
  value = Eval(expression)
  errorNumber = Err.Number
  Err.Clear
  kind = VarType(value)
  payload = ""
  If errorNumber = 0 Then
    If kind = 8 Then
      For i = 1 To LenB(value)
        byteValue = Hex(AscB(MidB(value, i, 1)))
        payload = payload & Right("0" & byteValue, 2)
      Next
    ElseIf kind = 1 Then
      payload = "Null"
    Else
      payload = CStr(value)
    End If
    If Err.Number <> 0 Then WScript.Quit 2
  End If
  WScript.Echo id & "|" & errorNumber & "|" & kind & "|" & payload
End Sub
'@
$dir=Split-Path -Parent $Output
New-Item -ItemType Directory -Force $dir | Out-Null
$script=Join-Path $dir 'text-reference.vbs'
$lines=New-Object 'System.Collections.Generic.List[string]';$lines.Add($prefix)
for($i=0;$i -lt $expressions.Count;$i++){$lines.Add('Call Probe('+ $i +', "'+$expressions[$i].Replace('"','""')+'")')}
[IO.File]::WriteAllText([IO.Path]::GetFullPath($script),[string]::Join("`r`n",$lines),[Text.Encoding]::ASCII)
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName="$env:WINDIR\System32\cscript.exe";$start.Arguments='//nologo //B "'+[IO.Path]::GetFullPath($script)+'"';$start.UseShellExecute=$false;$start.CreateNoWindow=$true;$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$process=New-Object Diagnostics.Process;$process.StartInfo=$start
if(-not $process.Start()){throw 'Cannot start installed Windows Script Host'}
$stdout=$process.StandardOutput.ReadToEndAsync();$stderr=$process.StandardError.ReadToEndAsync()
if(-not $process.WaitForExit(60000)){$process.Kill();throw 'Script Host reference timed out'}
$text=$stdout.Result;$errorText=$stderr.Result
if($process.ExitCode -ne 0){throw "Script Host failed: $($process.ExitCode) $errorText $text"}
$rows=@($text -split '\r?\n' | Where-Object {$_ -ne ''})
if($rows.Count -ne $expressions.Count){throw "Incomplete Script Host records: $($rows.Count)/$($expressions.Count): $text"}
$result=New-Object 'System.Collections.Generic.List[object]'
for($i=0;$i -lt $rows.Count;$i++){$parts=$rows[$i] -split '\|',4;if($parts.Count -ne 4 -or [int]$parts[0] -ne $i){throw 'Malformed Script Host result'};$result.Add(@{expression=$expressions[$i];number=[int]$parts[1];type=[int]$parts[2];value=$parts[3]})}
@{schema=1;reference='Installed Windows Script Host, LCID 1033; not a licensed VB6 compiler';os=[Environment]::OSVersion.VersionString;records=$result.ToArray()} | ConvertTo-Json -Depth 6 | Set-Content -Encoding UTF8 $Output
