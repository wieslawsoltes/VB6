/** Real sequential files. The oracle reads bytes through independent Win32 APIs,
 * never the compiler's file table, formatter or browser virtual filesystem. */
export function nativeFileControlFixture(fixture,writeOnly=false){
  const {add,check,finish}=fixture(writeOnly?'AotControlWriteFiles':'AotControlSequentialFiles');
  add('Dim f As Integer, n As Long, before As Long, after As Long, s As String, value As String, emptyValue As Variant');
  if(!writeOnly){
  add('MkDir "Orders"');
  check('(GetFileAttributesW(StrPtr("Orders")) And 16)=16','MkDir creates a real native order directory in a fresh working folder');
  add('On Error Resume Next\nErr.Clear\nMkDir "Orders"');
  check('Err.Number=58','creating an existing directory reports the portable file-already-exists error');
  add('Err.Clear\nMkDir "missing-parent/child"');
  check('Err.Number=76','MkDir preserves missing-parent errors without inventing intermediate directories');
  add('Err.Clear\nOn Error GoTo 0\nOpen "Orders/Order-1001.txt" For Output As #1\nPrint #1, "NORTHWIND TRADERS"\nClose #1');
  check('FileEquals("Orders/Order-1001.txt","NORTHWIND TRADERS" & vbCrLf)','native order output is readable through independent Win32 file APIs');
  add('n=DeleteFileW(StrPtr("Orders/Order-1001.txt"))');
  check('n<>0 And RemoveDirectoryW(StrPtr("Orders"))<>0','order file and directory release their operating-system resources');
  check('FreeFile=1 And FreeFile(0)=1 And FreeFile(rangenumber:=1)=256 And VarType(FreeFile)=vbInteger','FreeFile scans separate low/high ranges without reserving a number');
  add('f=FreeFile\nOpen "text.txt" For Output As #f Len=512\nPrint #f, "alpha";\nPrint #f, " beta"\nClose #f');
  check('FileEquals("text.txt","alpha beta" & vbCrLf)','Output writes real ANSI file bytes and trailing semicolon preserves the current line');
  add('Open "text.txt" For Append Access Write Shared As #256\nPrint #256, "tail"\nClose #256');
  check('FileEquals("text.txt","alpha beta" & vbCrLf & "tail" & vbCrLf)','Append preserves existing bytes and writes at the real file end');
  add('Open "text.txt" For Output As #511\nClose #511');
  check('FileEquals("text.txt","")','Output truncates an existing file and supports the highest valid file number');
  add('Open "text.txt" For Output As #1\nPrint #1, "A", "B"\nPrint #1, , "C"\nClose #1');
  check('FileEquals("text.txt","A" & Space$(13) & "B" & vbCrLf & Space$(14) & "C" & vbCrLf)','Print commas and leading empty fields advance to fourteen-column print zones');
  add('Open "text.txt" For Output As #1\nPrint #1, "AB"; Tab(5); "C"; Spc(2) "D";\nPrint #1, Tab(2); "E"\nPrint #1,\nClose #1');
  check('FileEquals("text.txt","AB  C  D" & vbCrLf & " E" & vbCrLf & vbCrLf)','Tab, Spc, backward absolute tabs and empty Print preserve cross-statement column state');
  add('Open "text.txt" For Output As #1\nPrint #1, Tab(0); "A"; Tab(-1); "B"\nClose #1');
  check('FileEquals("text.txt","A" & vbCrLf & "B" & vbCrLf)','Tab values below one clamp to the first column on the current or next line');
  add('Open "text.txt" For Output As #1\nPrint #1, "semicolon; comma,"; Replace("a,b",",",";")\nClose #1');
  check('FileEquals("text.txt","semicolon; comma,a;b" & vbCrLf)','Print parsing retains literal punctuation and commas inside nested function arguments');
  add('Open "text.txt" For Output As #1\nPrint #1, 7; -8; CByte(9); CCur(10); CDec(11); True; False; emptyValue; Null; CVErr(23)\nClose #1');
  check('FileEquals("text.txt"," 7 -8  9  10  11 TrueFalseNullError 23" & vbCrLf)','Print retains numeric sign spacing, Boolean, Empty, Null and Error subtype display');
  add('Open "text.txt" For Output As #1\nPrint #1, 1.25; DateSerial(2024,2,29)\nClose #1');
  check('FileEquals("text.txt"," " & CStr(1.25) & " " & CStr(DateSerial(2024,2,29)) & vbCrLf)','numeric and date display follows the same Windows user locale as explicit conversions');
  add('s="before" & ChrW$(0) & "after " & ChrW$(937) & ChrW$(20013) & String$(8192,"z")\nOpen "text.txt" For Output As #1\nPrint #1, s;\nClose #1');
  check('FileEquals("text.txt",s)','Print writes counted ANSI bytes including embedded NUL and long Unicode source strings');
  add('s="file-" & ChrW$(937) & ".txt"\nOpen s For Output As #1\nPrint #1, "unicode path"\nClose #1');
  check('FileEquals(s,"unicode path" & vbCrLf) And DeleteFileW(StrPtr(s))<>0','Open uses a Unicode filename independently of the file content code page');
  add('sequence=0\nOpen MarkPath() For Output As #MarkNumber() Len=MarkLength()\nPrint #1, MarkText("a"); MarkText("b")\nClose #1');
  check('sequence=12344 And FileEquals("order.txt","ab" & vbCrLf)','Open operands and Print expressions execute once in lexical source order');
  add('value="original"\nOpen "order.txt" For Output As #1\nPrint #1, value; Mutate(value)\nClose #1');
  check('value="changed" And FileEquals("order.txt","originaltail" & vbCrLf)','Print snapshots an earlier String before a later ByRef expression replaces its BSTR');
  add('Open "text.txt" For Output Shared As #1\nPrint #1, "keep";\nOn Error Resume Next\nErr.Clear\nOpen ".\\text.txt" For Output Shared As #2');
  check('Err.Number=55 And FreeFile=2','same-file identity rejects a different spelling before publishing a second file number');
  add('Err.Clear\nClose #1\nOn Error GoTo 0');
  check('FileEquals("text.txt","keep")','rejected duplicate Output does not truncate the existing file');
  add('Open "text.txt" For Append Shared As #1\nOn Error Resume Next\nErr.Clear\nOpen "should-not-exist.txt" For Output As #1');
  check('Err.Number=55 And GetFileAttributesW(StrPtr("should-not-exist.txt"))=-1','an already-open file number fails before creating or truncating another path');
  add('Err.Clear\nClose #1\nOn Error GoTo 0\nOpen "text.txt" For Output As #1\nOpen "high.txt" For Output As #256\nOpen "last.txt" For Output As #511');
  check('FreeFile=2 And FreeFile(1)=257','low and high FreeFile ranges account for live handles');
  add('Print #1, "low"\nPrint #256, "high"\nPrint #511, "last"\nClose');
  check('FreeFile=1 And FreeFile(1)=256 And FileEquals("high.txt","high" & vbCrLf) And FileEquals("last.txt","last" & vbCrLf)','Close without arguments releases all low and high file slots');
  add('On Error Resume Next\nErr.Clear\nn=FreeFile(2)');check('Err.Number=5','FreeFile rejects an invalid range selector');
  add('Err.Clear\nOpen "should-not-exist.txt" For Output As #0');check('Err.Number=52','Open rejects file number zero before creating a file');
  add('Err.Clear\nOpen "should-not-exist.txt" For Output As #512');check('Err.Number=52','Open rejects file numbers above 511');
  add('Err.Clear\nOpen "" For Output As #1');check('Err.Number=52','Open rejects an empty filename');
  add('Err.Clear\ns="text.txt" & ChrW$(0) & "ignored"\nOpen s For Output As #1');check('Err.Number=52','Open rejects embedded NUL rather than truncating a different Windows path');
  add('Err.Clear\nOpen "missing-parent\\child.txt" For Output As #1');check('Err.Number=76','missing parent directory maps to VB path-not-found without creating directories');
  add('Err.Clear\nOpen "should-not-exist.txt" For Output As #1 Len=0');check('Err.Number=5','nonpositive sequential buffer length is rejected');
  add('Err.Clear\nOpen "should-not-exist.txt" For Output As #1 Len=32768');check('Err.Number=5','sequential buffer length above 32767 is rejected');
  add('Err.Clear\nsequence=0\nPrint #1, MarkText("unused")');check('Err.Number=52 And sequence=0','Print rejects a closed file before evaluating output expressions');
  add('Err.Clear\nOn Error GoTo 0\nOpen "order.txt" For Output As #1\nOn Error Resume Next\nErr.Clear\nPrint #1, "not written"; Spc(-1)');
  check('Err.Number=5','invalid output positioning raises a VB error');
  add('Err.Clear\nClose #1\nOn Error GoTo 0');check('FileEquals("order.txt","")','format allocation or positioning failure cannot publish an incomplete display image');
  add('Open "order.txt" For Output As #1\nOn Error Resume Next\nErr.Clear\nPrint #1, ReopenTarget()');check('Err.Number=52','Print rejects a file number closed and reused during output-expression evaluation');
  add('Err.Clear\nClose #1\nOn Error GoTo 0');check('FileEquals("replacement.txt","")','a reused file slot does not receive bytes intended for the previous handle');
  add('n=GetProcessHandleCount(GetCurrentProcess(),before)\nFor n=1 To 40\n Open "text.txt" For Output Shared As #1\n On Error Resume Next\n Err.Clear\n Open ".\\text.txt" For Output Shared As #2\n Err.Clear\n On Error GoTo 0\n Close #1\nNext\nn=GetProcessHandleCount(GetCurrentProcess(),after)');
  check('after=before','successful close and duplicate-file error paths do not leak kernel handles');
  add('Open "text.txt" For Output As #1\nFor n=1 To 1000\n Print #1, "x";\nNext\nClose #1');check('FileEquals("text.txt",String$(1000,"x"))','repeated allocating Print statements retain bounded statement-owned strings');
  }else{
  add('Open "text.txt" For Output As #1\nWrite #1, "alpha", 7, -8, 1.25, True, False, emptyValue, Null, CVErr(23)\nClose #1');
  check('FileEquals("text.txt",Chr$(34) & "alpha" & Chr$(34) & ",7,-8,1.25,#TRUE#,#FALSE#,,#NULL#,#ERROR 23#" & vbCrLf)','Write uses quoted text, invariant numbers and VB interchange Variant markers');
  add('Open "text.txt" For Output As #1\nWrite #1, CByte(255), CInt(-32768), CLng(2147483647), CSng(1.5), CDbl(-1.5), CCur(12.3456), CDec("1234567890123456789012345678")\nClose #1');
  check('FileEquals("text.txt","255,-32768,2147483647,1.5,-1.5,12.3456,1234567890123456789012345678" & vbCrLf)','Write retains all numeric Variant subtypes including exact Currency and 28-digit Decimal');
  add('Open "text.txt" For Output As #1\nWrite #1, DateSerial(2024,2,29), TimeSerial(8,9,10), DateSerial(2024,2,29)+TimeSerial(8,9,10), CDate(0)\nClose #1');
  check('FileEquals("text.txt","#2024-02-29#,#08:09:10#,#2024-02-29 08:09:10#,#00:00:00#" & vbCrLf)','Write emits universal date and time fields rather than the current Windows date format');
  add('s="a," & Chr$(34) & "b" & ChrW$(0) & "c" & vbCrLf & "d"\nOpen "text.txt" For Output As #1\nWrite #1, s, ""\nWrite #1,\nClose #1');
  check('FileEquals("text.txt",Chr$(34) & s & Chr$(34) & "," & Chr$(34) & Chr$(34) & vbCrLf & vbCrLf)','Write preserves embedded quotes and counted NUL/CRLF without inventing RFC 4180 escaping');
  add('Open "text.txt" For Output As #1\nPrint #1, "prefix";\nWrite #1, "next"\nPrint #1, Tab(3); "end"\nClose #1');
  check('FileEquals("text.txt","prefix" & Chr$(34) & "next" & Chr$(34) & vbCrLf & "  end" & vbCrLf)','Write appends at the current stream position and resets the next Print column');
  add('sequence=0\nvalue="original"\nOpen "order.txt" For Output As #1\nWrite #1, value, Mutate(value), MarkText("a"), MarkText("b")\nClose #1');
  check('sequence=44 And value="changed" And FileEquals("order.txt",Chr$(34) & "original" & Chr$(34) & "," & Chr$(34) & "tail" & Chr$(34) & "," & Chr$(34) & "a" & Chr$(34) & "," & Chr$(34) & "b" & Chr$(34) & vbCrLf)','Write evaluates each expression once in source order and snapshots earlier ByRef values');
  add('On Error Resume Next\nErr.Clear\nsequence=0\nWrite #1, MarkText("unused")');
  check('Err.Number=52 And sequence=0','Write validates the file number before evaluating field expressions');
  add('Err.Clear\nOn Error GoTo 0\nOpen "order.txt" For Output As #1\nOn Error Resume Next\nErr.Clear\nWrite #1, "partial", 1/0');
  check('Err.Number=11','Write propagates expression errors through the normal native On Error path');
  add('Err.Clear\nClose #1\nOn Error GoTo 0');check('FileEquals("order.txt","")','Write does not publish a partially formatted record after an expression failure');
  add('Open "order.txt" For Output As #1\nOn Error Resume Next\nErr.Clear\nWrite #1, ReopenTarget()');
  check('Err.Number=52','Write detects a file slot closed and reused by a field expression');
  add('Err.Clear\nClose #1\nOn Error GoTo 0');check('FileEquals("replacement.txt","")','Write cannot redirect a staged record to a replacement handle');
  }
  add('Debug.Print "native debug output"; 7; Tab; "end"\nn=DeleteFileW(StrPtr("text.txt"))\nn=DeleteFileW(StrPtr("order.txt"))\nn=DeleteFileW(StrPtr("high.txt"))\nn=DeleteFileW(StrPtr("last.txt"))\nn=DeleteFileW(StrPtr("replacement.txt"))');
  return finish(`Private sequence As Long
Private Declare Function CreateFileW Lib "kernel32" (ByVal name As Long, ByVal access As Long, ByVal share As Long, ByVal security As Long, ByVal creation As Long, ByVal flags As Long, ByVal template As Long) As Long
Private Declare Function GetFileSize Lib "kernel32" (ByVal file As Long, ByVal high As Long) As Long
Private Declare Function ReadFile Lib "kernel32" (ByVal file As Long, ByVal bytes As Long, ByVal count As Long, actual As Long, ByVal overlap As Long) As Long
Private Declare Function CloseHandle Lib "kernel32" (ByVal handle As Long) As Long
Private Declare Function DeleteFileW Lib "kernel32" (ByVal name As Long) As Long
Private Declare Function RemoveDirectoryW Lib "kernel32" (ByVal name As Long) As Long
Private Declare Function GetFileAttributesW Lib "kernel32" (ByVal name As Long) As Long
Private Declare Function WideCharToMultiByte Lib "kernel32" (ByVal cp As Long, ByVal flags As Long, ByVal chars As Long, ByVal count As Long, ByVal bytes As Long, ByVal capacity As Long, ByVal replacement As Long, ByVal used As Long) As Long
Private Declare Function GetProcessHandleCount Lib "kernel32" (ByVal process As Long, count As Long) As Long
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long`,
`Private Function FileEquals(ByVal path As String, ByVal expected As String) As Boolean
 Dim file As Long, size As Long, count As Long, length As Long, i As Long, n As Long
 Dim actual() As Byte, wanted() As Byte
 file=CreateFileW(StrPtr(path),&H80000000,3,0,3,0,0)
 If file=-1 Then Exit Function
 On Error GoTo Done
 size=GetFileSize(file,0)
 If Len(expected)>0 Then length=WideCharToMultiByte(0,0,StrPtr(expected),Len(expected),0,0,0,0)
 If size<>length Then GoTo Done
 If size>0 Then
  ReDim actual(0 To size-1)
  ReDim wanted(0 To size-1)
  n=ReadFile(file,VarPtr(actual(0)),size,count,0)
  If n=0 Or count<>size Then GoTo Done
  n=WideCharToMultiByte(0,0,StrPtr(expected),Len(expected),VarPtr(wanted(0)),size,0,0)
  If n<>size Then GoTo Done
  For i=0 To size-1
   If actual(i)<>wanted(i) Then GoTo Done
  Next
 End If
 FileEquals=True
Done:
 n=CloseHandle(file)
End Function
Private Function MarkPath() As String
 sequence=sequence*10+1
 MarkPath="order.txt"
End Function
Private Function MarkNumber() As Integer
 sequence=sequence*10+2
 MarkNumber=1
End Function
Private Function MarkLength() As Long
 sequence=sequence*10+3
 MarkLength=512
End Function
Private Function MarkText(ByVal s As String) As String
 sequence=sequence*10+4
 MarkText=s
End Function
Private Function Mutate(ByRef s As String) As String
 s="changed"
 Mutate="tail"
End Function
Private Function ReopenTarget() As String
 Close #1
 Open "replacement.txt" For Output As #1
 ReopenTarget="wrong receiver"
End Function`);
}

export const nativeWriteFileFixture=fixture=>nativeFileControlFixture(fixture,true);
