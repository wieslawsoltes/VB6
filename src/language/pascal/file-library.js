/** Turbo Pascal files expressed as shared VB source, including byte-oriented
 * Text I/O. Native exports and the browser VM execute the same procedures.
 *
 * A file variable is an opaque String descriptor. File values cannot be copied
 * by Pascal assignment, but the String ABI permits var parameters across units
 * without managed fields in a native record or a JavaScript-only handle table.
 * One program-wide IOStatus is supplied explicitly by the lowering frontend.
 *
 * Borland Turbo Pascal 7.0 Language Guide, chapter 6; Programmer's Reference,
 * System file routines and I/O checking.
 * https://turbopascal.nl/docs/Turbo_Pascal_Version_7.0_Language_Guide_1992.pdf
 */

export const PASCAL_FILE_LAYOUT = Object.freeze({storage: 'String', headerLength: 9,
  signature: 'P', kinds: Object.freeze({text: 0, typed: 1, untyped: 2}),
  defaultRecordSize: 128, maximumRecordSize: 65535, inputMode: 1, outputMode: 2});

const helpers = new Map(), aliases = new Map();
function define(id, suffix, source, dependencies = []) {
  const helper = Object.freeze({id, name: '__Pascal' + suffix, source: source.trim(), dependencies: Object.freeze([...dependencies])});
  helpers.set(id.toLowerCase(), helper); aliases.set(helper.name.toLowerCase(), id.toLowerCase());
  return helper;
}

function guarded(id, suffix, parameters, result, body, dependencies = []) {
  const kind = result ? 'Function' : 'Sub', signature = result ? ' As ' + result : '';
  return define(id, suffix, `Private ${kind} __Pascal${suffix}(${parameters}, ByVal checked As Boolean, ByRef status As Long)${signature}
  If status <> 0 Then Exit ${kind}
  On Error GoTo __PascalFileFailed
${body}
  Exit ${kind}
__PascalFileFailed:
  Call __PascalFileCapture(Err.Number, Err.Source, checked, status)
End ${kind}`, ['fileCapture', ...dependencies]);
}

define('fileCapture', 'FileCapture', `
Private Sub __PascalFileCapture(ByVal number As Long, ByVal source As String, ByVal checked As Boolean, ByRef status As Long)
  If source <> "Turbo Pascal file I/O" Then
    Select Case number
      Case 53: number = 2
      Case 76: number = 3
      Case 67: number = 4
      Case 70, 75, 58: number = 5
      Case 52, 55: number = 6
      Case 62: number = 100
      Case 61: number = 101
      Case 54: number = 103
      Case 7: number = 203
      Case 5, 6: number = 106
    End Select
  End If
  status = number
  Err.Clear
  If checked Then Err.Raise number, "Turbo Pascal file I/O", "Pascal file operation failed"
End Sub`);

define('fileIOResult', 'FileIOResult', `
Private Function __PascalFileIOResult(ByRef status As Long) As Long
  __PascalFileIOResult = status
  status = 0
End Function`);

define('fileAssign', 'FileAssign', `
Private Sub __PascalFileAssign(ByRef file As String, ByVal path As String, ByVal kind As Long, ByVal recordSize As Long)
  If kind < 0 Or kind > 2 Then Err.Raise 102, "Turbo Pascal file I/O", "Invalid file kind"
  If kind = 0 Then recordSize = 1
  If kind = 2 And recordSize = 0 Then recordSize = 128
  If recordSize < 1 Or recordSize > 65535 Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid record size"
  file = "P" & ChrW(kind) & ChrW(0) & ChrW(0) & ChrW(0) & ChrW(recordSize Mod 256) & ChrW(recordSize \\ 256) & ChrW(0) & ChrW(0) & path
End Sub`);

define('fileHandle', 'FileHandle', `
Private Function __PascalFileHandle(ByVal file As String, Optional ByVal access As Long = 0) As Long
  Dim mode As Long
  If Len(file) < 9 Then Err.Raise 102, "Turbo Pascal file I/O", "File not assigned"
  If Left$(file, 1) <> "P" Then Err.Raise 102, "Turbo Pascal file I/O", "File not assigned"
  mode = AscW(Mid$(file, 3, 1))
  If mode = 0 Then Err.Raise 103, "Turbo Pascal file I/O", "File not open"
  If (mode And access) <> access Then
    If access = 1 Then Err.Raise 104, "Turbo Pascal file I/O", "File not open for input"
    Err.Raise 105, "Turbo Pascal file I/O", "File not open for output"
  End If
  __PascalFileHandle = AscW(Mid$(file, 4, 1)) + AscW(Mid$(file, 5, 1)) * 256
End Function`);

guarded('fileOpen', 'FileOpen', 'ByRef file As String, ByVal action As Long, ByVal recordSize As Long, ByVal fileMode As Long', '', `
  Dim handle As Long, oldHandle As Long, kind As Long, access As Long, path As String, size As Long
  If Len(file) < 9 Then Err.Raise 102, "Turbo Pascal file I/O", "File not assigned"
  If Left$(file, 1) <> "P" Then Err.Raise 102, "Turbo Pascal file I/O", "File not assigned"
  kind = AscW(Mid$(file, 2, 1))
  path = Mid$(file, 10)
  If Len(path) = 0 Then Err.Raise 5, "Turbo Pascal file I/O", "The console requires an input or output adapter"
  If action < 0 Or action > 2 Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid file operation"
  If action = 2 And kind <> 0 Then Err.Raise 106, "Turbo Pascal file I/O", "Append requires Text"
  If recordSize = 0 Then recordSize = AscW(Mid$(file, 6, 1)) + AscW(Mid$(file, 7, 1)) * 256
  If kind = 0 Then recordSize = 1
  If recordSize < 1 Or recordSize > 65535 Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid record size"
  If AscW(Mid$(file, 3, 1)) <> 0 Then
    oldHandle = __PascalFileHandle(file)
    Close #oldHandle
    Mid$(file, 3, 3) = ChrW(0) & ChrW(0) & ChrW(0)
  End If
  handle = FreeFile
  If action = 1 Then
    Open path For Output As #handle
    Close #handle
  Else
    size = FileLen(path)
  End If
  access = 3
  If kind = 0 Then
    If action = 0 Then access = 1 Else access = 2
  ElseIf action = 0 Then
    Select Case fileMode
      Case 0: access = 1
      Case 1: access = 2
      Case 2: access = 3
      Case Else: Err.Raise 106, "Turbo Pascal file I/O", "Invalid FileMode"
    End Select
  End If
  Select Case access
    Case 1: Open path For Binary Access Read As #handle
    Case 2: Open path For Binary Access Write As #handle
    Case 3: Open path For Binary Access Read Write As #handle
  End Select
  Mid$(file, 3, 7) = ChrW(access) & ChrW(handle Mod 256) & ChrW(handle \\ 256) & ChrW(recordSize Mod 256) & ChrW(recordSize \\ 256) & ChrW(0) & ChrW(0)
  If action = 2 Then Seek #handle, LOF(handle) + 1
`, ['fileHandle']);

guarded('fileClose', 'FileClose', 'ByRef file As String', '', `
  Dim handle As Long
  handle = __PascalFileHandle(file)
  Close #handle
  Mid$(file, 3, 3) = ChrW(0) & ChrW(0) & ChrW(0)
  Mid$(file, 8, 2) = ChrW(0) & ChrW(0)
`, ['fileHandle']);

define('filePeek', 'FilePeek', `
Private Function __PascalFilePeek(ByRef file As String) As Long
  Dim handle As Long, value As Byte
  handle = __PascalFileHandle(file, 1)
  If AscW(Mid$(file, 8, 1)) <> 0 Then
    __PascalFilePeek = AscW(Mid$(file, 9, 1))
    Exit Function
  End If
  If EOF(handle) Then
    __PascalFilePeek = -1
    Exit Function
  End If
  Get #handle, , value
  Mid$(file, 8, 2) = ChrW(1) & ChrW(value)
  __PascalFilePeek = value
End Function`, ['fileHandle']);

define('fileTake', 'FileTake', `
Private Function __PascalFileTake(ByRef file As String) As Long
  __PascalFileTake = __PascalFilePeek(file)
  Mid$(file, 8, 1) = ChrW(0)
End Function`, ['filePeek']);

guarded('fileEOF', 'FileEOF', 'ByRef file As String', 'Boolean', `
  Dim handle As Long, value As Long
  handle = __PascalFileHandle(file)
  If AscW(Mid$(file, 2, 1)) = 0 Then
    value = __PascalFilePeek(file)
    __PascalFileEOF = value = -1 Or value = 26
  Else
    __PascalFileEOF = Seek(handle) > LOF(handle)
  End If
`, ['fileHandle', 'filePeek']);

guarded('fileEOLN', 'FileEOLN', 'ByRef file As String', 'Boolean', `
  Dim value As Long
  value = __PascalFilePeek(file)
  __PascalFileEOLN = value = -1 Or value = 26 Or value = 13 Or value = 10
`, ['filePeek']);

guarded('fileReadChar', 'FileReadChar', 'ByRef file As String', 'String', `
  Dim value As Long, ignored As Long
  value = __PascalFilePeek(file)
  If value = -1 Or value = 26 Then
    __PascalFileReadChar = ChrW(26)
    Exit Function
  End If
  ignored = __PascalFileTake(file)
  If value = 13 Then
    If __PascalFilePeek(file) = 10 Then ignored = __PascalFileTake(file)
  End If
  If value = 10 Then value = 13
  __PascalFileReadChar = ChrW(value)
`, ['filePeek', 'fileTake']);

guarded('fileReadText', 'FileReadText', 'ByRef file As String, ByVal capacity As Long', 'String', `
  Dim value As Long, ignored As Long, result As String
  If capacity < 0 Or capacity > 255 Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid string capacity"
  Do While Len(result) < capacity
    value = __PascalFilePeek(file)
    If value = -1 Or value = 26 Or value = 13 Or value = 10 Then Exit Do
    ignored = __PascalFileTake(file)
    result = result & ChrW(value)
  Loop
  __PascalFileReadText = result
`, ['filePeek', 'fileTake']);

guarded('fileReadToken', 'FileReadToken', 'ByRef file As String', 'String', `
  Dim value As Long, ignored As Long, result As String
  Do
    value = __PascalFilePeek(file)
    If value = -1 Or value = 26 Then Err.Raise 106, "Turbo Pascal file I/O", "Numeric input expected"
    If value > 32 Then Exit Do
    ignored = __PascalFileTake(file)
  Loop
  Do
    value = __PascalFilePeek(file)
    If value < 33 Or value = 26 Then Exit Do
    ignored = __PascalFileTake(file)
    If Len(result) >= 255 Then Err.Raise 106, "Turbo Pascal file I/O", "Numeric input too long"
    result = result & ChrW(value)
  Loop
  __PascalFileReadToken = result
`, ['filePeek', 'fileTake']);

guarded('fileReadLn', 'FileReadLn', 'ByRef file As String', '', `
  Dim value As Long, ignored As Long
  Do
    value = __PascalFilePeek(file)
    If value = -1 Or value = 26 Then Exit Sub
    ignored = __PascalFileTake(file)
    If value = 10 Then Exit Sub
    If value = 13 Then
      If __PascalFilePeek(file) = 10 Then ignored = __PascalFileTake(file)
      Exit Sub
    End If
  Loop
`, ['filePeek', 'fileTake']);

guarded('fileReadBytes', 'FileReadBytes', 'ByRef file As String, ByVal count As Long', 'String', `
  Dim handle As Long, value As Byte, index As Long, result As String
  handle = __PascalFileHandle(file, 1)
  If count < 0 Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid read size"
  If count > 1048576 Then Err.Raise 203, "Turbo Pascal file I/O", "Read buffer exceeds runtime string limit"
  If count > LOF(handle) - Seek(handle) + 1 Then Err.Raise 100, "Turbo Pascal file I/O", "Disk read error"
  result = String$(count, ChrW(0))
  For index = 1 To count
    Get #handle, , value
    Mid$(result, index, 1) = ChrW(value)
  Next index
  __PascalFileReadBytes = result
`, ['fileHandle']);

guarded('fileWriteBytes', 'FileWriteBytes', 'ByRef file As String, ByVal bytes As String', '', `
  Dim handle As Long, value As Byte, index As Long, ordinal As Long
  handle = __PascalFileHandle(file, 2)
  For index = 1 To Len(bytes)
    ordinal = AscW(Mid$(bytes, index, 1))
    If ordinal < 0 Or ordinal > 255 Then Err.Raise 106, "Turbo Pascal file I/O", "File data requires byte-valued characters"
  Next index
  For index = 1 To Len(bytes)
    value = AscW(Mid$(bytes, index, 1))
    Put #handle, , value
  Next index
`, ['fileHandle']);

guarded('fileWriteText', 'FileWriteText', 'ByRef file As String, ByVal text As String, ByVal newline As Boolean', '', `
  If newline Then text = text & vbCrLf
  Call __PascalFileWriteBytes(file, text, checked, status)
`, ['fileWriteBytes']);

guarded('fileSeek', 'FileSeek', 'ByRef file As String, ByVal record As Long', '', `
  Dim handle As Long, size As Long, offset As Double
  handle = __PascalFileHandle(file)
  If AscW(Mid$(file, 2, 1)) = 0 Then Err.Raise 106, "Turbo Pascal file I/O", "Seek requires a typed or untyped file"
  size = AscW(Mid$(file, 6, 1)) + AscW(Mid$(file, 7, 1)) * 256
  offset = CDbl(record) * size + 1
  If record < 0 Or offset > 2147483647# Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid file position"
  Seek #handle, CLng(offset)
  Mid$(file, 8, 2) = ChrW(0) & ChrW(0)
`, ['fileHandle']);

for (const [id, suffix, expression] of [['filePos', 'FilePos', '(Seek(handle) - 1)'], ['fileSize', 'FileSize', 'LOF(handle)']]) {
  guarded(id, suffix, 'ByRef file As String', 'Long', `
  Dim handle As Long, size As Long
  handle = __PascalFileHandle(file)
  If AscW(Mid$(file, 2, 1)) = 0 Then Err.Raise 106, "Turbo Pascal file I/O", "Record query requires a typed or untyped file"
  size = AscW(Mid$(file, 6, 1)) + AscW(Mid$(file, 7, 1)) * 256
  __Pascal${suffix} = ${expression} \\ size
`, ['fileHandle']);
}

guarded('fileErase', 'FileErase', 'ByRef file As String', '', `
  If Len(file) < 9 Then Err.Raise 102, "Turbo Pascal file I/O", "File not assigned"
  If AscW(Mid$(file, 3, 1)) <> 0 Then Err.Raise 5, "Turbo Pascal file I/O", "Erase requires a closed file"
  Kill Mid$(file, 10)
`);

guarded('fileRename', 'FileRename', 'ByRef file As String, ByVal path As String', '', `
  If Len(file) < 9 Then Err.Raise 102, "Turbo Pascal file I/O", "File not assigned"
  If AscW(Mid$(file, 3, 1)) <> 0 Then Err.Raise 5, "Turbo Pascal file I/O", "Rename requires a closed file"
  Name Mid$(file, 10) As path
  file = Left$(file, 9) & path
`);

define('fileEncodeInteger', 'FileEncodeInteger', `
Private Function __PascalFileEncodeInteger(ByVal value As Double, ByVal size As Long) As String
  Dim index As Long, byte As Long, result As String, modulus As Double
  If size < 1 Or size > 4 Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid ordinal file size"
  modulus = 256 ^ size
  value = Fix(value)
  value = value - Int(value / modulus) * modulus
  For index = 1 To size
    byte = CLng(value - Int(value / 256) * 256)
    result = result & ChrW(byte)
    value = Int(value / 256)
  Next index
  __PascalFileEncodeInteger = result
End Function`);

define('fileDecodeInteger', 'FileDecodeInteger', `
Private Function __PascalFileDecodeInteger(ByVal bytes As String, ByVal isSigned As Boolean) As Double
  Dim index As Long, value As Double, modulus As Double
  If Len(bytes) < 1 Or Len(bytes) > 4 Then Err.Raise 106, "Turbo Pascal file I/O", "Invalid ordinal file size"
  For index = Len(bytes) To 1 Step -1
    value = value * 256 + AscW(Mid$(bytes, index, 1))
  Next index
  modulus = 256 ^ Len(bytes)
  If isSigned And value >= modulus / 2 Then value = value - modulus
  __PascalFileDecodeInteger = value
End Function`);

define('fileEncodeReal48', 'FileEncodeReal48', `
Private Function __PascalFileEncodeReal48(ByVal value As Double) As String
  Dim magnitude As Double, exponent As Long, fraction As Double, byte As Long, index As Long, result As String
  magnitude = Abs(value)
  If magnitude < 2 ^ (-128) Then
    __PascalFileEncodeReal48 = String$(6, ChrW(0))
    Exit Function
  End If
  If magnitude >= 2 ^ 127 Or value <> value Then Err.Raise 205, "Turbo Pascal", "Real48 overflow"
  exponent = CLng(Int(Log(magnitude) / Log(2)))
  magnitude = magnitude / 2 ^ exponent
  If magnitude < 1 Then
    magnitude = magnitude * 2
    exponent = exponent - 1
  ElseIf magnitude >= 2 Then
    magnitude = magnitude / 2
    exponent = exponent + 1
  End If
  fraction = Int((magnitude - 1) * 549755813888# + 0.5)
  If fraction >= 549755813888# Then
    fraction = 0
    exponent = exponent + 1
  End If
  If exponent > 126 Then Err.Raise 205, "Turbo Pascal", "Real48 overflow"
  result = ChrW(exponent + 129)
  For index = 1 To 5
    byte = CLng(fraction - Int(fraction / 256) * 256)
    fraction = Int(fraction / 256)
    If index = 5 And value < 0 Then byte = byte + 128
    result = result & ChrW(byte)
  Next index
  __PascalFileEncodeReal48 = result
End Function`);

define('fileDecodeReal48', 'FileDecodeReal48', `
Private Function __PascalFileDecodeReal48(ByVal bytes As String) As Double
  Dim exponent As Long, fraction As Double, high As Long, index As Long
  If Len(bytes) <> 6 Then Err.Raise 106, "Turbo Pascal file I/O", "Real48 requires six bytes"
  exponent = AscW(Left$(bytes, 1))
  If exponent = 0 Then Exit Function
  high = AscW(Right$(bytes, 1))
  fraction = high And 127
  For index = 5 To 2 Step -1
    fraction = fraction * 256 + AscW(Mid$(bytes, index, 1))
  Next index
  __PascalFileDecodeReal48 = (1 + fraction / 549755813888#) * 2 ^ (exponent - 129)
  If high >= 128 Then __PascalFileDecodeReal48 = -__PascalFileDecodeReal48
End Function`);

export function getPascalFileHelper(name) {
  const lookup = String(name).toLowerCase();
  const helper = helpers.get(aliases.get(lookup) || lookup);
  if (!helper) throw new RangeError(`Unknown Turbo Pascal file helper '${name}'`);
  return helper;
}

export function getPascalFileRuntimeHelpers(names) {
  const result = [], seen = new Set();
  const visit = name => {
    const helper = getPascalFileHelper(name);
    if (seen.has(helper.id)) return;
    seen.add(helper.id); helper.dependencies.forEach(visit); result.push(helper);
  };
  for (const name of typeof names === 'string' ? [names] : names) visit(name);
  return result;
}

export function getPascalFileRuntimeSource(names) {return getPascalFileRuntimeHelpers(names).map(helper => helper.source).join('\n\n');}
export const PASCAL_FILE_HELPERS = Object.freeze([...helpers.values()]);
