# Trusted gateway adapter: commands are passed as ADO data, never evaluated as PowerShell.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$connection = $null
function Release-Com($value) { if ($null -ne $value -and [Runtime.InteropServices.Marshal]::IsComObject($value)) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) } }
function Close-Connection {
    if ($null -ne $script:connection) { try { if ($script:connection.State) { [void]$script:connection.Close() } } finally { Release-Com $script:connection; $script:connection=$null } }
}
function Encode-Cell($value) {
    if ($null -eq $value -or $value -is [DBNull]) { return $null }
    if ($value -is [byte[]]) { return @{ '$vb6'='binary'; value=[Convert]::ToBase64String($value) } }
    if ($value -is [DateTime]) { return @{ '$vb6'='date'; value=$value.ToUniversalTime().ToString('o') } }
    if ($value -is [Int64] -or $value -is [Decimal]) { return $value.ToString([Globalization.CultureInfo]::InvariantCulture) }
    return $value
}
function Read-Result($recordset, $affected) {
    $columns=[Collections.Generic.List[object]]::new(); $rows=[Collections.Generic.List[object]]::new(); $fields=$null
    try {
        if ($null -ne $recordset -and $recordset.State -ne 0) {
            $fields=$recordset.Fields
            if ($fields.Count -gt 1024) { throw 'Column limit' }
            for ($i=0; $i -lt $fields.Count; $i++) {
                $field=$fields.Item($i)
                try {
                    $type=[int]$field.Type
                    if ($type -notin @(2,3,4,5,6,7,11,14,16,17,18,19,20,21,72,128,129,130,131,133,134,135,200,201,202,203,204,205)) { $type=12 }
                    $columns.Add(@{Name=[string]$field.Name;Type=$type;DefinedSize=[int]$field.DefinedSize})
                } finally { Release-Com $field }
            }
            while (-not $recordset.EOF) {
                if ($rows.Count -ge 100000 -or (($rows.Count+1)*$columns.Count) -gt 1000000) { throw 'Row limit' }
                $row=[Collections.Generic.List[object]]::new()
                for ($i=0; $i -lt $fields.Count; $i++) {
                    $field=$fields.Item($i)
                    try { $row.Add((Encode-Cell $field.Value)) } finally { Release-Com $field }
                }
                $rows.Add($row.ToArray()); [void]$recordset.MoveNext()
            }
        }
        return @{columns=$columns.ToArray();values=$rows.ToArray();rowsAffected=[Math]::Max(0,[long]$affected)}
    } finally {
        Release-Com $fields
        if ($null -ne $recordset) { try { if ($recordset.State) { [void]$recordset.Close() } } finally { Release-Com $recordset } }
    }
}
try {
    while ($null -ne ($line=[Console]::ReadLine())) {
        try {
            $request=$line | ConvertFrom-Json; $result=@{}
            switch ($request.operation) {
                'open' {
                    if ($null -ne $connection) { throw 'Connection already open' }
                    try {
                        $connection=New-Object -ComObject ADODB.Connection
                        $connection.ConnectionTimeout=15; $connection.CommandTimeout=[int]$request.timeout
                        [void]$connection.Open([string]$request.connectionString)
                        $result=@{provider=[string]$connection.Provider;adoVersion=[string]$connection.Version;bits=([IntPtr]::Size*8)}
                    } catch { Close-Connection; throw }
                }
                'execute' {
                    $command=$null; $parameters=$null
                    try {
                        $command=New-Object -ComObject ADODB.Command; $command.ActiveConnection=$connection; $command.CommandType=1
                        $command.CommandText=[string]$request.text; $command.CommandTimeout=$connection.CommandTimeout
                        $parameters=$command.Parameters; $i=0
                        foreach ($value in $request.parameters) {
                            $type=202; $size=1; $data=$value
                            if ($null -eq $value) { $data=[DBNull]::Value }
                            elseif ($value -is [bool]) { $type=11 }
                            elseif ($value -is [int]) { $type=3 }
                            elseif ($value -is [long]) { $type=20 }
                            elseif ($value -is [double]) { $type=5 }
                            elseif ($value.'$vb6' -eq 'binary') { $type=204; $data=[Convert]::FromBase64String($value.value); $size=[Math]::Max(1,$data.Length) }
                            elseif ($value.'$vb6' -eq 'integer') { $type=20; $data=[long]::Parse($value.value,[Globalization.CultureInfo]::InvariantCulture) }
                            elseif ($value.'$vb6' -eq 'date') { $type=7; $data=[DateTime]::Parse($value.value,[Globalization.CultureInfo]::InvariantCulture) }
                            else { $data=[string]$value; $size=[Math]::Max(1,$data.Length) }
                            $parameter=$command.CreateParameter(('p'+$i),$type,1,$size,$data)
                            try { [void]$parameters.Append($parameter) } finally { Release-Com $parameter }; $i++
                        }
                        $affected=0; $result=Read-Result ($command.Execute([ref]$affected)) $affected
                    } finally { Release-Com $parameters; Release-Com $command }
                }
                'schema' { $result=Read-Result ($connection.OpenSchema([int]$request.kind)) 0 }
                'begin' { $result=@{level=$connection.BeginTrans()} }
                'commit' { [void]$connection.CommitTrans() }
                'rollback' { [void]$connection.RollbackTrans() }
                'close' { Close-Connection }
                default { throw 'Unknown operation' }
            }
            [Console]::WriteLine(($result | ConvertTo-Json -Depth 32 -Compress))
        } catch {
            # Do not expose DSNs, connection strings, SQL or native exception messages to clients.
            [Console]::WriteLine((@{error='Provider operation failed';number=$_.Exception.HResult} | ConvertTo-Json -Compress))
        }
    }
} finally { Close-Connection }
