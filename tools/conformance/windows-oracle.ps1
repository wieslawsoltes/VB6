param([Parameter(Mandatory=$true)][string]$Vectors,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
Write-Host 'Compiling Windows reference bindings'
Add-Type -Path (Join-Path $PSScriptRoot 'windows-oracle.cs')
$inputData=Get-Content -Raw -Encoding UTF8 $Vectors | ConvertFrom-Json
$results=@()
$unexpected=0
foreach($v in $inputData.operations){
  if(($v.id % 100) -eq 0){Write-Host "Oracle vector $($v.id)"}
  try { $result=[WindowsVariantOracle]::Run($v.op,[int]$v.a.type,[string]$v.a.value,[int]$v.b.type,[string]$v.b.value,[int]$v.lcid);$results+=@{id=$v.id;result=$result} }
  catch {$unexpected++;$results+=@{id=$v.id;error=$_.Exception.ToString()}}
}
$encodings=@()
foreach($v in $inputData.encodings){
  Write-Host "Code page $($v.page)"
  try{$hex=[WindowsVariantOracle]::Encode([int]$v.page,[string]$v.text);$text=[WindowsVariantOracle]::Decode([int]$v.page,$hex);$encodings+=@{page=$v.page;text=$v.text;hex=$hex;decoded=$text}}
  catch{
    $rejected=$_.Exception.ToString().Contains('Unmappable string:')
    if(-not $rejected){$unexpected++}
    $encodings+=@{page=$v.page;text=$v.text;rejected=$rejected;error=$_.Exception.ToString()}
  }
}
$dll=Join-Path $env:WINDIR 'System32\oleaut32.dll'
$report=@{schema=1;unexpectedErrors=$unexpected;oracle='Windows OleAut32 and Kernel32 (NOT VB6 Put certification)';architecture=[IntPtr]::Size*8;os=[Environment]::OSVersion.VersionString;runtimeVersion=[Environment]::Version.ToString();oleaut32Version=(Get-Item $dll).VersionInfo.FileVersion;oleaut32Sha256=(Get-FileHash $dll -Algorithm SHA256).Hash;operations=$results;encodings=$encodings}
$report | ConvertTo-Json -Depth 12 | Set-Content -Encoding UTF8 $Output
Write-Host "Recorded $($results.Count) native operations"
if($unexpected -ne 0){throw "Oracle has $unexpected unexpected binding failures"}
