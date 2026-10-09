/** Typed DLL calls must see ANSI records; raw pointers see inline UTF-16 values.
 * All behavior is checked by independently declared Win32 APIs, not JS or the VM. */
export function nativeRecordStringFixture(fixture){
  const {add,check,finish}=fixture('AotControlFixedRecords');
  add('Dim x As MIXED, y As MIXED, box As BOX, find As FIND_DATA, n As Long, h As Long, count As Long, bytes(0 To 31) As Byte, s As String');
  check('x.text=Space$(5) And saved.text=Space$(5) And box.names(-1)=Space$(3) And box.right.text=Space$(5)','local, form-global and nested fixed fields initialize to spaces');
  check('Len(x)=12 And LenB(x)=20 And Len(box)=31 And LenB(box)=56','Len uses unpadded file widths while LenB uses aligned Unicode storage');
  add('x.tag=7\nx.code=513\nx.text="AB"\nx.tail=&H1020304');
  check('x.text="AB   " And Len(x.text)=5 And LenB(x.text)=10','inline String assignment pads the remaining UTF-16 units');
  add('x.text="123456789"');check('x.text="12345" And x.tail=&H1020304 And x.code=513','truncating a fixed String never overwrites adjacent scalar fields');
  add('x.text="A" & ChrW$(0) & ChrW$(937) & "Z"');
  check('Len(x.text)=5 And AscW(Mid$(x.text,2,1))=0 And AscW(Mid$(x.text,3,1))=937','inline strings preserve embedded NUL and non-ANSI UTF-16 code units');
  add('CopyRaw ByVal VarPtr(bytes(0)), ByVal StrPtr(x.text), 10');
  check('bytes(0)=65 And bytes(1)=0 And bytes(2)=0 And bytes(3)=0 And bytes(4)=169 And bytes(5)=3','StrPtr exposes inline UTF-16 data and explicit pointers bypass ANSI record conversion');
  add('y=x\nx.text="other"');check('Left$(y.text,1)="A" And AscW(Mid$(y.text,3,1))=937 And y.tail=&H1020304','whole-record assignment copies inline values rather than sharing string ownership');
  add('With box.right\n .text="right"\n .tail=19\nEnd With\nbox.names(-1)="one"\nbox.names(0)="two"\nBump box.right.tail');
  check('box.right.text="right" And box.right.tail=20 And box.names(-1)="one" And box.names(0)="two"','nested With, negative array bounds and scalar ByRef fields retain correct addresses');
  check('StaticText()="x    " And StaticText()="xy   "','static fixed record fields initialize once rather than resetting on every activation');
  add('x.text="lower"\nn=Upper(x.text,5)');check('n=5 And x.text="LOWER" And x.tail=&H1020304','typed String Declare parameters marshal an inline field and copy the native mutation back');
  add('Open "record-ansi.bin" For Output As #1\nClose #1\nh=CreateFileW(StrPtr("record-ansi.bin"),&H40000000,0,0,2,0,0)\nn=WriteTyped(h,x,16,count,0)\nn=CloseHandle(h)');
  add('h=CreateFileW(StrPtr("record-ansi.bin"),&H80000000,3,0,3,0,0)\nn=ReadRaw(h,VarPtr(bytes(0)),16,count,0)\nn=CloseHandle(h)');
  check('n<>0 And count=16 And bytes(0)=7 And bytes(2)=1 And bytes(3)=2 And bytes(4)=76 And bytes(8)=82 And bytes(12)=4 And bytes(13)=3 And bytes(14)=2 And bytes(15)=1','typed record Declare writes the independently checked sixteen-byte ANSI layout, including relocated tail');
  add('bytes(0)=17\nbytes(2)=34\nbytes(3)=0\nbytes(4)=100\nbytes(5)=97\nbytes(6)=116\nbytes(7)=97\nbytes(8)=33\nbytes(12)=29\nbytes(13)=0\nbytes(14)=0\nbytes(15)=0\nh=CreateFileW(StrPtr("record-ansi.bin"),&H40000000,0,0,2,0,0)\nn=WriteRaw(h,VarPtr(bytes(0)),16,count,0)\nn=CloseHandle(h)');
  add('h=CreateFileW(StrPtr("record-ansi.bin"),&H80000000,3,0,3,0,0)\nn=ReadTyped(h,y,16,count,0)\nn=CloseHandle(h)');
  check('count=16 And y.tag=17 And y.code=34 And y.text="data!" And y.tail=29','foreign ANSI bytes copy back into the aligned Unicode record without a BSTR header read');
  add('y.text="saved"\nh=CreateFileW(StrPtr("record-ansi.bin"),&H80000000,3,0,3,0,0)\nn=ReadTyped(h,(y),16,count,0)\nn=CloseHandle(h)');
  check('count=16 And y.text="saved"','parenthesized typed record arguments marshal an isolated value without copyback');
  add('h=CreateFileW(StrPtr("record-ansi.bin"),&H80000000,3,0,3,0,0)\nn=ReadAny(h,y,16,count,0)\nn=CloseHandle(h)');
  check('count=16 And y.text="data!" And y.tail=29','As Any retains known UDT ANSI conversion while explicit ByVal pointers stay raw');
  add('h=FindFirstFileA("record-ansi.bin",find)');
  check('h<>-1 And Left$(find.name,16)="record-ansi.bin" & ChrW$(0) And find.sizeLow=16 And Len(find.name)=260','real WIN32_FIND_DATAA writes fixed filename arrays without corrupting Unicode record storage');
  add('n=FindClose(h)\nn=DeleteFileW(StrPtr("record-ansi.bin"))');
  check('n<>0','record calls preserve native handles and release file and enumeration resources');
  add('saved=y\nFor n=1 To 2000\n box.left=saved\n box.right=box.left\n s=box.right.text & box.names(0)\nNext');
  check('s="data!two" And box.right.tail=29','repeated inline record copies and String reads preserve counted ownership');
  add('On Error Resume Next\nErr.Clear\nbox.names(1)="bad"');
  check('Err.Number=9 And box.names(0)="two"','out-of-range fixed String array writes fail before touching adjacent storage');
  add('Err.Clear\nOn Error GoTo 0');
  // Structurally different Unicode and ANSI lengths are asserted against SDK
  // constants, not the compiler report that is under test.
  check('Len(find)=318 And LenB(find)=592','WIN32_FIND_DATA logical file width and in-memory Unicode size are distinct');
  return finish(`Private Type MIXED
 tag As Byte
 code As Integer
 text As String * 5
 tail As Long
End Type
Private Type BOX
 left As MIXED
 right As MIXED
 names(-1 To 0) As String * 3
 suffix As Byte
End Type
Private Type FIND_DATA
 attributes As Long
 created(0 To 1) As Long
 accessed(0 To 1) As Long
 written(0 To 1) As Long
 sizeHigh As Long
 sizeLow As Long
 reserved(0 To 1) As Long
 name As String * 260
 alternate As String * 14
End Type
Private saved As MIXED
Private Declare Function Upper Lib "user32" Alias "CharUpperBuffA" (ByVal text As String,ByVal count As Long) As Long
Private Declare Sub CopyRaw Lib "kernel32" Alias "RtlMoveMemory" (dst As Any,src As Any,ByVal size As Long)
Private Declare Function CreateFileW Lib "kernel32" (ByVal name As Long,ByVal access As Long,ByVal share As Long,ByVal security As Long,ByVal creation As Long,ByVal flags As Long,ByVal template As Long) As Long
Private Declare Function ReadTyped Lib "kernel32" Alias "ReadFile" (ByVal file As Long,buffer As MIXED,ByVal size As Long,count As Long,ByVal overlap As Long) As Long
Private Declare Function ReadAny Lib "kernel32" Alias "ReadFile" (ByVal file As Long,buffer As Any,ByVal size As Long,count As Long,ByVal overlap As Long) As Long
Private Declare Function WriteTyped Lib "kernel32" Alias "WriteFile" (ByVal file As Long,buffer As MIXED,ByVal size As Long,count As Long,ByVal overlap As Long) As Long
Private Declare Function ReadRaw Lib "kernel32" Alias "ReadFile" (ByVal file As Long,ByVal buffer As Long,ByVal size As Long,count As Long,ByVal overlap As Long) As Long
Private Declare Function WriteRaw Lib "kernel32" Alias "WriteFile" (ByVal file As Long,ByVal buffer As Long,ByVal size As Long,count As Long,ByVal overlap As Long) As Long
Private Declare Function CloseHandle Lib "kernel32" (ByVal handle As Long) As Long
Private Declare Function DeleteFileW Lib "kernel32" (ByVal name As Long) As Long
Private Declare Function FindFirstFileA Lib "kernel32" (ByVal name As String,data As FIND_DATA) As Long
Private Declare Function FindClose Lib "kernel32" (ByVal handle As Long) As Long`,
`Private Sub Bump(n As Long)
 n=n+1
End Sub
Private Function StaticText() As String
 Static value As MIXED
 If value.tail=0 Then
  value.text="x"
 Else
  value.text="xy"
 End If
 value.tail=value.tail+1
 StaticText=value.text
End Function`);
}
