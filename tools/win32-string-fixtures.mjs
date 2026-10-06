import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';

export function stringInteropFixture() {
 const checks=[],lines=['Dim s As String, t As String, result As String, fixed As String * 7','Dim n As Long, e As Long, before As Long, after As Long, i As Long','Dim money As Currency, number As Double'];
 const check=(condition,label)=>{checks.push(label);lines.push(`If Not (${condition}) Then ExitProcess ${checks.length}`);};
 check('Err.LastDLLError = 0','LastDLLError begins at zero and is numeric');
 check('EmptyKind(vbNullString) = 1','vbNullString passes a genuine NULL pointer');
 check('EmptyKind("") = 2','Empty literal passes a non-NULL zero-length byte-BSTR');
 check('EmptyKind(s) = 1','Uninitialized String storage preserves NULL');
 lines.push('s = vbNullString','t = s');
 check('StrPtr(s) = 0 And StrPtr(t) = 0','Null String assignments preserve pointer identity');
 lines.push('s = ""');
 check('StrPtr(s) <> 0 And EmptyKind(s) = 2','Empty and null String are distinct');
 check('Embedded("a" & ChrW(0) & "b") = 1','Embedded NULs retain full byte-BSTR length');
 lines.push('s = Space$(8)','n = WriteBuffer(s)','e = Err.LastDLLError');
 check('n = 123 And e = 17767','DLL integer result and LastDLLError survive marshalling cleanup');
 check('Len(s) = 8 And Left$(s,3) = "XY" & ChrW(0) And Right$(s,5) = Space$(5)','ByVal buffer writes copy back without trimming at NUL');
 lines.push('s = Space$(8)','n = WriteBuffer((s))');
 check('s = Space$(8)','Parenthesized ByVal String protects its source');
 check('WriteBuffer("read-only literal") = 123','Literal uses writable temporary instead of writing executable read-only data');
 lines.push('s = Space$(8)','n = WriteOverride(ByVal s)');
 check('Left$(s,2) = "XY" And n = 123','Call-site ByVal overrides an external ByRef String to a byte pointer');
 lines.push('s = "small"','ResizeString s','e = Err.LastDLLError');
 check('Len(s) = 10 And s = "grown" & ChrW(0) & "tail" And e = 17768','ByRef String replacement transfers ANSI byte-BSTR ownership and length');
 lines.push('s = "small"','ResizeString (s)');
 check('s = "small"','Parenthesized ByRef String replacement does not mutate source');
 lines.push('ResizeString "literal"');
 check('Len(s) = 5','ByRef literal replacement is released without a source destination');
 lines.push('fixed = "small"','ResizeString fixed');
 check('Len(fixed) = 7 And fixed = "grown" & ChrW(0) & "t"','Fixed String copy-back truncates to authored width');
 lines.push('ClearString fixed');
 check('fixed = Space$(7)','Fixed String null replacement pads the original width');
 lines.push('ClearString s','e = Err.LastDLLError');
 check('Len(s) = 0 And StrPtr(s) = 0 And e = 17769','ByRef replacement with NULL preserves NULL and frees original ownership');
 lines.push('result = ReturnString(0)','e = Err.LastDLLError');
 check('Len(result) = 3 And result = "r" & ChrW(0) & "x" And e = 17770','String result is decoded using byte-BSTR length and retains embedded NUL');
 lines.push('result = ReturnString(1)');
 check('StrPtr(result) = 0','NULL native String result remains NULL');
 lines.push('result = ReturnString(2)');
 check('Len(result) = 0 And StrPtr(result) <> 0','Allocated empty native String result stays distinct from NULL');
 lines.push('s = Space$(8)','number = ReturnDouble(s,1.25)','e = Err.LastDLLError');
 check('number = 1.375 And Left$(s,1) = "D" And e = 17771','Double ST0 result survives error capture and copy-back');
 lines.push('number = ReturnSingle(s,CSng(1.25))','e = Err.LastDLLError');
 check('number = 2.5 And Left$(s,1) = "S" And e = 17772','Single ST0 result survives error capture and copy-back');
 lines.push('money = ReturnCurrency(s,900719925474.0993@)','e = Err.LastDLLError');
 check('money = 900719925474.0994@ And Left$(s,1) = "M" And e = 17773','Currency EDX:EAX retains low bits across marshalling');
 lines.push('n = ReturnInteger(s)','e = Err.LastDLLError');
 check('n = -32768 And Left$(s,1) = "I" And e = 17774','Integer result sign-extends after marshalling');
 lines.push('n = ReturnByte(s)','e = Err.LastDLLError');
 check('n = 255 And Left$(s,1) = "B" And e = 17775','Byte result zero-extends after marshalling');
 lines.push('n = ReturnBoolean(s)','e = Err.LastDLLError');
 check('n = -1 And Left$(s,1) = "T" And e = 17776','Boolean result remains a signed 16-bit ABI value');
 lines.push('trace = 0','n = Order(last:=TextValue(3,"Z"), n:=NumberValue(2), first:=TextValue(1,"A"))');
 check('n = 902 And trace = 321','Named arguments marshal once in source order, not formal order');
 lines.push('s = Space$(8)','before = CallCount()','On Error Resume Next','n = Order(42,s,FailText())','e = Err.Number','Err.Clear','On Error GoTo 0','after = CallCount()');
 check('e = 13 And before = after And s = Space$(8)','Later-argument error releases conversion and skips the DLL without copy-back');
 lines.push('ReDim items(2)','items(1) = "initial"','indexCount = 0','n = Reenter(items(NextIndex()),AddressOf PinnedCallback)');
 check('n = 901 And items(1) = "Rnitial" And UBound(items) = 2 And indexCount = 1','String element destination is evaluated once and remains pinned during callback');
 lines.push('shared = "initial"','On Error Resume Next','Err.Raise 13','n = Reenter(shared,AddressOf NestedCallback)','e = Err.LastDLLError');
 check('n = 901 And shared = "Rnitial" And Err.Number = 13 And e = 17777','Nested String DLL calls and source replacement preserve suspended Err and ANSI snapshot');
 lines.push('Err.Clear','On Error GoTo 0');
 for (const text of ['café','Łódź','日本語','a\u0000z','𝄞','e\u0301']) {
   // Use ChrW to keep test C/PowerShell inputs independent of file code pages.
   const expr=Array.from({length:text.length},(_,i)=>`ChrW(${text.charCodeAt(i)})`).join(' & ');
   lines.push(`s = ${expr}`,'t = s','n = CheckEncoding(s,StrPtr(t),Len(t))','e = Err.LastDLLError');
   check('n = 903 And e = 17778',`ANSI bytes agree with independent CP_ACP conversion: ${JSON.stringify(text)}`);
 }
 lines.push('n = SetEnvironmentVariableA("VB6_NATIVE_STRING_PROBE", "native value")');
 check('n <> 0','Real kernel32 accepts ANSI String inputs');
 lines.push('s = Space$(256)','n = GetEnvironmentVariableA("VB6_NATIVE_STRING_PROBE",s,Len(s))');
 check('n = 12 And Left$(s,n) = "native value" And Len(s) = 256','Real kernel32 writes an ANSI output buffer');
 lines.push('n = SetEnvironmentVariableA("VB6_NATIVE_STRING_PROBE",vbNullString)','s = Space$(256)','n = GetEnvironmentVariableA("VB6_NATIVE_STRING_PROBE",s,Len(s))','e = Err.LastDLLError');
 check('n = 0 And e = 203 And Err.Number = 0','Real missing-environment error is captured without raising a VB error');
 lines.push('s = Space$(260)','n = GetModuleFileNameA(0,s,Len(s))');
 check('n > 0 And n < 260 And Right$(Left$(s,n),4) = ".exe"','Real module-file-name API writes into preallocated String');
 lines.push('s = "unchanged"','On Error Resume Next','s = ReturnString(3)','e = Err.Number','Err.Clear','On Error GoTo 0');
 check('e = 7 And s = "unchanged"','Oversized transferred String result is rejected before assigning destination');
 check('Len(Space$(0)) = 0 And Space$(3) = "   "','Space buffer construction supports zero and positive lengths');
 lines.push('On Error Resume Next','s = Space$(-1)','e = Err.Number','Err.Clear','On Error GoTo 0');
 check('e = 5','Negative Space size raises error 5');
 lines.push('s = Space$(32768)','before = PrivateBytes()','For i = 1 To 5000','Stress s','Next','after = PrivateBytes()');
 check('before > 0 And after > 0 And after - before < 16777216','5000 normal/error marshalling cycles retain bounded private memory');
 lines.push('ExitProcess 0');
 const p = newProject('AotStringInterop');p.startup='Sub Main';
 p.modules=[{id:'main',name:'MainModule',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function SetEnvironmentVariableA Lib "kernel32" (ByVal name As String, ByVal value As String) As Long
Private Declare Function GetEnvironmentVariableA Lib "kernel32" _
 (ByVal name As String, ByVal buffer As String, ByVal capacity As Long) As Long
Private Declare Function GetModuleFileNameA Lib "kernel32" (ByVal module As Long, ByVal buffer As String, ByVal capacity As Long) As Long
Private Declare Function EmptyKind Lib "vb6-string-probe" (ByVal value As String) As Long
Private Declare Function Embedded Lib "vb6-string-probe" (ByVal value As String) As Long
Private Declare Function WriteBuffer Lib "vb6-string-probe" (ByVal value As String) As Long
Private Declare Function WriteOverride Lib "vb6-string-probe" Alias "WriteBuffer" (ByRef value As String) As Long
Private Declare Sub ResizeString Lib "vb6-string-probe" (ByRef value As String)
Private Declare Sub ClearString Lib "vb6-string-probe" (ByRef value As String)
Private Declare Function ReturnString Lib "vb6-string-probe" (ByVal kind As Long) As String
Private Declare Function ReturnDouble Lib "vb6-string-probe" (ByVal value As String, ByVal number As Double) As Double
Private Declare Function ReturnSingle Lib "vb6-string-probe" (ByVal value As String, ByVal number As Single) As Single
Private Declare Function ReturnCurrency Lib "vb6-string-probe" (ByVal value As String, ByVal number As Currency) As Currency
Private Declare Function ReturnInteger Lib "vb6-string-probe" (ByVal value As String) As Integer
Private Declare Function ReturnByte Lib "vb6-string-probe" (ByVal value As String) As Byte
Private Declare Function ReturnBoolean Lib "vb6-string-probe" (ByVal value As String) As Boolean
Private Declare Function Reenter Lib "vb6-string-probe" (ByVal value As String, ByVal cb As Long) As Long
Private Declare Function CallCount Lib "vb6-string-probe" () As Long
Private Declare Function Order Lib "vb6-string-probe" (ByVal n As Long, ByVal first As String, ByVal last As String) As Long
Private Declare Function CheckEncoding Lib "vb6-string-probe" (ByVal ansi As String, ByVal wide As Long, ByVal length As Long) As Long
Private Declare Function PrivateBytes Lib "vb6-string-probe" () As Long
Private trace As Long
Private indexCount As Long
Private items() As String
Private shared As String
Private Function TextValue(ByVal index As Long, ByVal text As String) As String
 trace = trace * 10 + index
 TextValue = text
End Function
Private Function NumberValue(ByVal index As Long) As Long
 trace = trace * 10 + index
 NumberValue = 42
End Function
Private Function FailText() As String
 Err.Raise 13
End Function
Private Function NextIndex() As Long
 indexCount = indexCount + 1
 NextIndex = 1
End Function
Private Function PinnedCallback(ByVal value As Long) As Long
 On Error Resume Next
 ReDim items(7)
 If Err.Number <> 10 Then ExitProcess 234
 Err.Clear
 PinnedCallback = value * 2
End Function
Private Function NestedCallback(ByVal value As Long) As Long
 Dim s As String, e As Long
 If Err.Number <> 0 Then ExitProcess 235
 shared = "callback replaced original"
 s = ReturnString(0)
 If s <> "r" & ChrW(0) & "x" Then ExitProcess 236
 NestedCallback = value * 2
End Function
Private Sub Stress(ByVal text As String)
 Dim n As Long, s As String
 n = WriteBuffer(text)
 ResizeString text
 s = ReturnString(0)
 On Error Resume Next
 n = Order(42,Space$(32768),FailText())
 If Err.Number <> 13 Then ExitProcess 237
 Err.Clear
End Sub
Sub Main()
${lines.join('\n')}
End Sub`}];
 return {project:p,checks};
}

/** System-DLL-only smoke: no companion DLL, extraction, VB runtime or console. */
export function systemStringFixture() {
 const p=newProject('AotWin32Strings');p.startup='Sub Main';
 const checks=['ANSI API takes input Strings', 'ANSI output retains authored buffer length',
   'NULL deletes a process-local environment value', 'LastDLLError captures the real missing-variable error',
   'UTF-16 pointer calls are explicit, not inferred from an export suffix', 'Raw Unicode output retains non-ANSI characters',
   'Module file name returns through an ANSI buffer', 'Continuation preserves declaration and error source lines'];
 p.modules=[{id:'main',name:'MainModule',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function SetEnvironmentVariableA Lib "kernel32" (ByVal name As String, ByVal value As String) As Long
Private Declare Function GetEnvironmentVariableA Lib "kernel32" _
 (ByVal name As String, ByVal buffer As String, ByVal capacity As Long) As Long
Private Declare Function GetModuleFileNameA Lib "kernel32" (ByVal module As Long, ByVal buffer As String, ByVal capacity As Long) As Long
Private Declare Function SetEnvironmentVariableW Lib "kernel32" (ByVal name As Long, ByVal value As Long) As Long
Private Declare Function GetEnvironmentVariableW Lib "kernel32" (ByVal name As Long, ByVal buffer As Long, ByVal capacity As Long) As Long
Sub Main()
 Dim name As String, value As String, buffer As String, count As Long, result As Long
 name = "VB6_NATIVE_SYSTEM_STRING_TEST"
 result = SetEnvironmentVariableA(name,"native")
 If result = 0 Then ExitProcess 1
 buffer = Space$(64)
 count = GetEnvironmentVariableA(name,buffer,Len(buffer))
 If count <> 6 Or Left$(buffer,count) <> "native" Or Len(buffer) <> 64 Then ExitProcess 2
 result = SetEnvironmentVariableA(name,vbNullString)
 If result = 0 Then ExitProcess 3
 count = GetEnvironmentVariableA(name,buffer,Len(buffer))
 If count <> 0 Or Err.LastDLLError <> 203 Then ExitProcess 4
 value = ChrW(26085) & ChrW(26412) & ChrW(35486)
 result = SetEnvironmentVariableW(StrPtr(name),StrPtr(value))
 If result = 0 Then ExitProcess 5
 buffer = Space$(64)
 count = GetEnvironmentVariableW(StrPtr(name),StrPtr(buffer),Len(buffer))
 If count <> Len(value) Or Left$(buffer,count) <> value Then ExitProcess 6
 result = SetEnvironmentVariableW(StrPtr(name),0)
 buffer = Space$(260)
 count = GetModuleFileNameA(0,buffer,Len(buffer))
 If count = 0 Or count >= 260 Or Right$(Left$(buffer,count),4) <> ".exe" Then ExitProcess 7
 On Error Resume Next
 buffer = Space$(-1)
 count = Err.Number
 Err.Clear
 On Error GoTo 0
 If count <> 5 Then ExitProcess 8
 ExitProcess 0
End Sub`}];
 return {project:p,checks};
}
export function writeStringInteropFixture(directory='validation/string-interop') {
 fs.mkdirSync(directory,{recursive:true});
 for(const [make,manifest,dependencies] of [
   [stringInteropFixture,'string-interop-build.json',['vb6-string-probe.dll']],
   [systemStringFixture,'system-strings-build.json',[]]
 ]) {
   const {project,checks}=make(),result=compileWin32(project);
   fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
   fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
   fs.writeFileSync(path.join(directory,manifest),JSON.stringify({...result.report,checks,dependencies,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
   console.log(project.name,checks.length,result.bytes.length);
 }
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeStringInteropFixture();
