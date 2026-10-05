# Trusted gateway adapter. JSON requests are data; never Invoke-Expression or interpolate SQL.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$connection = $null
function Encode-Cell($value) {
    if ($null -eq $value -or $value -is [DBNull]) { return $null }
    if ($value -is [byte[]]) { return @{ '$vb6'='binary'; value=[Convert]::ToBase64String($value) } }
    if ($value -is [DateTime]) { return @{ '$vb6'='date'; value=$value.ToUniversalTime().ToString('o') } }
    if ($value -is [Int64] -or $value -is [Decimal]) { return $value.ToString([Globalization.CultureInfo]::InvariantCulture) }
    return $value
}
function Read-Result($recordset, $affected) {
    $columns = [Collections.Generic.List[object]]::new()
    $rows = [Collections.Generic.List[object]]::new()
    if ($null -ne $recordset -and $recordset.State -ne 0) {
        for ($i=0; $i -lt $recordset.Fields.Count; $i++) {
            $field=$recordset.Fields.Item($i); $type=[int]$field.Type
            if ($type -notin @(2,3,4,5,6,7,11,17,128,129,130,200,201,202,203,204,205)) { $type=12 }
            $columns.Add(@{Name=$field.Name;Type=$type;DefinedSize=0})
        }
        while (-not $recordset.EOF) {
            if ($rows.Count -ge 100000 -or (($rows.Count+1)*$columns.Count) -gt 1000000) { throw 'Row limit' }
            $row=[Collections.Generic.List[object]]::new()
            for ($i=0; $i -lt $recordset.Fields.Count; $i++) { $row.Add((Encode-Cell $recordset.Fields.Item($i).Value)) }
            $rows.Add($row.ToArray()); [void]$recordset.MoveNext()
        }
        [void]$recordset.Close()
    }
    return @{columns=$columns.ToArray();values=$rows.ToArray();rowsAffected=[Math]::Max(0,[int]$affected)}
}
while ($null -ne ($line=[Console]::ReadLine())) {
    try {
        $request=$line | ConvertFrom-Json
        $result=@{}
        switch ($request.operation) {
            'open' { $connection=New-Object -ComObject ADODB.Connection; $connection.ConnectionTimeout=15; $connection.CommandTimeout=[int]$request.timeout; [void]$connection.Open([string]$request.connectionString) }
            'execute' {
                $command=New-Object -ComObject ADODB.Command; $command.ActiveConnection=$connection; $command.CommandType=1; $command.CommandText=[string]$request.text; $command.CommandTimeout=$connection.CommandTimeout
                $i=0
                foreach ($value in $request.parameters) {
                    $type=202; $size=1; $data=$value
                    if ($null -eq $value) { $data=[DBNull]::Value }
                    elseif ($value -is [bool]) { $type=11 }
                    elseif ($value -is [int]) { $type=3 }
                    elseif ($value -is [double] -or $value -is [long]) { $type=5 }
                    elseif ($value.'$vb6' -eq 'binary') { $type=204; $data=[Convert]::FromBase64String($value.value); $size=[Math]::Max(1,$data.Length) }
                    elseif ($value.'$vb6' -eq 'integer') { $type=202; $data=[string]$value.value; $size=[Math]::Max(1,$data.Length) }
                    elseif ($value.'$vb6' -eq 'date') { $type=7; $data=[DateTime]::Parse($value.value,[Globalization.CultureInfo]::InvariantCulture) }
                    else { $data=[string]$value; $size=[Math]::Max(1,$data.Length) }
                    [void]$command.Parameters.Append($command.CreateParameter(('p'+$i),$type,1,$size,$data)); $i++
                }
                $affected=0; $recordset=$command.Execute([ref]$affected); $result=Read-Result $recordset $affected
                [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($command)
            }
            'schema' { $result=Read-Result ($connection.OpenSchema([int]$request.kind)) 0 }
            'begin' { $result=@{level=$connection.BeginTrans()} }
            'commit' { [void]$connection.CommitTrans() }
            'rollback' { [void]$connection.RollbackTrans() }
            'close' { if ($connection.State) { [void]$connection.Close() }; [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($connection); $connection=$null }
            default { throw 'Unknown operation' }
        }
        [Console]::WriteLine(($result | ConvertTo-Json -Depth 32 -Compress))
    } catch {
        [Console]::WriteLine((@{error='Provider operation failed';number=$_.Exception.HResult} | ConvertTo-Json -Compress))
    }
}
if ($null -ne $connection) { try { [void]$connection.Close() } catch {} }
