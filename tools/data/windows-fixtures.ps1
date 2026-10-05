param([Parameter(Mandatory=$true)][string]$Directory,[Parameter(Mandatory=$true)][string]$Output)
$ErrorActionPreference='Stop'
$records=[Collections.Generic.List[object]]::new()
$bits=[IntPtr]::Size*8
foreach ($provider in @('Microsoft.Jet.OLEDB.4.0','Microsoft.ACE.OLEDB.12.0','Microsoft.ACE.OLEDB.16.0')) {
    $ext=if($provider -like '*Jet*'){'mdb'}else{'accdb'}
    $file=Join-Path $Directory (($provider -replace '[^a-zA-Z0-9]','_')+"-$bits.$ext")
    $catalog=$null; $connection=$null
    try {
        if(Test-Path -LiteralPath $file){throw 'Refusing to replace an existing fixture'}
        $catalog=New-Object -ComObject ADOX.Catalog
        [void]$catalog.Create("Provider=$provider;Data Source=$file;")
        $connection=$catalog.ActiveConnection
        $records.Add(@{provider=$provider;bits=$bits;available=$true;filename=$file;adoVersion=[string]$connection.Version})
    } catch {
        $records.Add(@{provider=$provider;bits=$bits;available=$false;hresult=$_.Exception.HResult})
    } finally {
        if($null -ne $connection){try{[void]$connection.Close()}catch{};[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($connection)}
        if($null -ne $catalog){[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($catalog)}
    }
}
[IO.File]::WriteAllText($Output,(ConvertTo-Json -InputObject $records.ToArray() -Depth 8),[Text.UTF8Encoding]::new($false))
