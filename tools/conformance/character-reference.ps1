param([string]$Output='reports/characters')
$ErrorActionPreference='Stop'
New-Item -ItemType Directory -Force $Output | Out-Null
$Output=[IO.Path]::GetFullPath($Output)
Add-Type -TypeDefinition 'using System.Runtime.InteropServices; public static class CharacterACP { [DllImport("kernel32.dll")] public static extern uint GetACP(); }'
$acp=[CharacterACP]::GetACP()
if($acp -ne 1252){throw "This reference requires ACP 1252, found $acp; no comparisons were certified"}
$expressions=New-Object 'System.Collections.Generic.List[string]'
foreach($name in @('Chr','ChrW')){
  foreach($value in @('-2147483649','-32769','-32768','-1.5','-1','-0.5','0','0.5','1.5','65.5','127.5','128','255','255.5','256','32767','32768','65535','65535.5','65536','2147483648','Empty','Null','True','False','"65"','""','"x"')){$expressions.Add("$name($value)")}
}
foreach($count in @('-1','-0.5','0','0.5','1.5','2','Empty','Null')){
 foreach($value in @('65','128','255','256','257','-1','-256','-257','32768','65535','65536','1.5','True','False','Empty','Null','""','"65"','"ABC"','ChrW(8364)','ChrW(256)','CCur(65)','CDbl(65)')){$expressions.Add("String($count,$value)")}
}
foreach($name in @('Asc','AscW')){foreach($value in @('""','Empty','Null','12','True','False','ChrW(8364)','ChrW(256)','ChrW(32768)','ChrW(65535)','ChrW(55357) & ChrW(56832)')){$expressions.Add("$name($value)")}}
$script=@'
Option Explicit
Dim i, n, e
SetLocale 1033
For i = 0 To 65535
 On Error Resume Next
 Err.Clear
 n = Asc(ChrW(i))
 e = Err.Number
 On Error GoTo 0
 If e <> 0 Then WScript.Quit 2
 WScript.Echo "M|" & i & "|" & n
Next
For i = 0 To 255
 n = AscW(Chr(i))
 If n < 0 Then n = n + 65536
 WScript.Echo "C|" & i & "|" & n
Next
Sub Probe(id, expression)
 Dim value, number, text, j, code, kind
 On Error Resume Next
 Err.Clear
 value = Empty
 value = Eval(expression)
 number = Err.Number
 On Error GoTo 0
 If number <> 0 Then
  WScript.Echo "P|" & id & "|E|" & number
  Exit Sub
 End If
 kind = VarType(value)
 text = ""
 If kind = 8 Then
  For j = 1 To Len(value)
   code = AscW(Mid(value,j,1))
   If code < 0 Then code = code + 65536
   text = text & Right("0000" & Hex(code),4)
  Next
 ElseIf kind <> 0 And kind <> 1 Then
  text = CStr(value)
 End If
 WScript.Echo "P|" & id & "|" & kind & "|" & text
End Sub
'@
for($i=0;$i -lt $expressions.Count;$i++){$script+="`r`nProbe $i, `""+$expressions[$i].Replace('"','""')+'"'}
$scriptPath=Join-Path $Output 'character-reference.vbs'
$script=($script -replace "`r?`n","`r`n")+"`r`n"
[IO.File]::WriteAllText($scriptPath,$script,[Text.Encoding]::ASCII)
$cscript=Join-Path $env:WINDIR 'SysWOW64\cscript.exe'
if(!(Test-Path $cscript)){throw 'The independent 32-bit Windows Script Host is required'}
# Explicit engine and absolute paths avoid default-host/file-association state.
# Read both pipes asynchronously, so the complete 65K table cannot fill a pipe.
$start=New-Object Diagnostics.ProcessStartInfo
$start.FileName=$cscript
$start.Arguments='//nologo //E:VBScript //T:90 "'+$scriptPath+'"'
$start.UseShellExecute=$false;$start.CreateNoWindow=$true
$start.RedirectStandardOutput=$true;$start.RedirectStandardError=$true
$process=New-Object Diagnostics.Process;$process.StartInfo=$start
if(!$process.Start()){throw 'Could not start Windows Script Host'}
$outTask=$process.StandardOutput.ReadToEndAsync();$errTask=$process.StandardError.ReadToEndAsync()
if(!$process.WaitForExit(120000)){$process.Kill();throw 'Windows Script Host exceeded 120 seconds'}
$exit=$process.ExitCode;$stdout=Join-Path $Output 'native-output.txt';$stderr=Join-Path $Output 'native-stderr.txt'
[IO.File]::WriteAllText($stdout,$outTask.Result,[Text.Encoding]::UTF8)
[IO.File]::WriteAllText($stderr,$errTask.Result,[Text.Encoding]::UTF8)
$process.Dispose()
Write-Host "Host exit $exit; stdout $((Get-Item $stdout).Length) bytes; stderr $((Get-Item $stderr).Length) bytes"
if($exit -ne 0 -or $errTask.Result.Trim().Length -gt 0){throw "Windows Script Host failed: $($errTask.Result)"}
$map=New-Object byte[] 65536;$characters=New-Object int[] 256;$cases=@();$m=0;$c=0;$p=0
foreach($line in [IO.File]::ReadAllLines($stdout)){
 $fields=$line.Split('|')
 switch($fields[0]){
  'M' {if($fields.Length -ne 3 -or [int]$fields[1] -ne $m -or $m -ge 65536){throw 'Invalid Asc table sequence'};$map[$m]=[byte]$fields[2];$m++}
  'C' {if($fields.Length -ne 3 -or [int]$fields[1] -ne $c -or $c -ge 256){throw 'Invalid Chr table sequence'};$characters[$c]=[int]$fields[2];$c++}
  'P' {if($fields.Length -ne 4 -or [int]$fields[1] -ne $p -or $p -ge $expressions.Count){throw 'Invalid probe sequence'};$cases+=@{id=$p;expression=$expressions[$p];type=$fields[2];value=$fields[3]};$p++}
  default {throw "Unexpected reference output: $line"}
 }
}
if($m -ne 65536 -or $c -ne 256 -or $p -ne $expressions.Count){throw "Incomplete native reference output: M=$m C=$c P=$p expected $($expressions.Count)"}
$dll=Join-Path $env:WINDIR 'SysWOW64\vbscript.dll'
$report=@{schema=1;oracle='Installed x86 Windows Script Host, not licensed VB6';acp=$acp;lcid=1033;os=[Environment]::OSVersion.VersionString;dllVersion=(Get-Item $dll).VersionInfo.FileVersion;dllSha256=(Get-FileHash $dll -Algorithm SHA256).Hash;scriptSha256=(Get-FileHash $scriptPath -Algorithm SHA256).Hash;ascBase64=[Convert]::ToBase64String($map);chr=$characters;cases=$cases;ascCases=$m;chrCases=$c;edgeCases=$p}
$report | ConvertTo-Json -Depth 8 | Set-Content -Encoding UTF8 (Join-Path $Output 'reference.json')
Write-Host "Captured $m Asc mappings, $c Chr mappings and $p edge cases through actual Windows Script Host"
