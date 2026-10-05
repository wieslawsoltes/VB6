from pathlib import Path
import hashlib
root=Path('.')
expected={
 'tools/win32-date-interval-reference.mjs':('0e421c25182f7eace513f42d4f8fcf4c33a6a567e28efe2deaf6b8cfd963359a','9bd9b694401c301681e16dce9f35a2b68a82e5564ed35a4ddc1976f94564466e'),
 'tools/test-win32-dates.ps1':('0600e8d872caa0b3f7dbf45f282bfa0cbce06b07210cf8f6d6f9831c84123011','3e102b2728e617c7430a7c6d76b70eb7898ef54fed9401723013a95d1e8274e8'),
 'tools/test-win32-date-intervals.ps1':('3ddec249775dc2cf3715537f99a451da1212f833b1690b90c2f7feb7c554e4fe','902cb9259f2fc825538aa51ff162a19751c78a143ae4188dbe804b2ad410b3de'),
 'tests/win32-date-intervals.test.mjs':('7a7d3d131c4cdfc8bff16b23a3b1737650a96fc06fb47deffcb3ce4af991f8b4','ba8a07d0634d8298fd3b1420a7c77863589a0e67d3baba7c0423a9b78400f86e')
}
for name,(before,after) in expected.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==before,'Unexpected preimage: '+name
p=root/'tools/win32-date-interval-reference.mjs'
s=p.read_text()
s=s.replace("lines.push('Err.Clear','result = '+expression,'savedError = Err.Number'", "// The native destination is typed Long. VBScript can return a wider Double\n  // for DateDiff; apply the same destination coercion, retaining overflow cases.\n  const assigned=kind==='long'?`CLng(${expression})`:expression;\n  lines.push('Err.Clear','result = '+assigned,'savedError = Err.Number'")
s=s.replace("throw Error('Out-of-range reference');", "throw Error('Out-of-range reference at '+i+': '+line);")
start=s.index('export function intervalProject(')
end=s.index('\nexport function writeIntervalFixtures',start)
s=s[:start]+r'''export function intervalProject(records,name='AotDateIntervals') {
 const code=['Dim numberResult As Long, dateResult As Date, textResult As String, actualError As Long, firstFailure As Long'];
 // Test-only result file: every expression is measured, even when an earlier one
 // fails. This prevents one failing case from hiding the rest of a batch.
 code.push('output = CreateFileW(StrPtr("interval-actual.txt"), &H40000000&, 0, 0, 2, 128, 0)',
  'If output = -1 Then ExitProcess 250');
 const variable={long:'numberResult',date:'dateResult',string:'textResult'};
 records.forEach((r,i)=>{
  const v=variable[r.kind],id=r.index??i;
  code.push('On Error Resume Next','Err.Clear',v+' = '+r.expression,'actualError = Err.Number','Err.Clear','On Error GoTo 0',
   'If actualError <> 0 Then',` Record "${id}|error|" & CStr(actualError)`, 'Else',
   ` Record "${id}|${r.kind}|" & ${r.kind==='date'?`CStr(CDbl(${v}))`:r.kind==='string'?`Encode(${v})`:`CStr(${v})`}`, 'End If',
   `If actualError <> ${r.outcome==='error'?r.value:0} Then`, ` If firstFailure = 0 Then firstFailure = ${i+1}`,'Else');
  if(r.outcome!=='error'){
   const comparison=r.kind==='date'?`Abs(CDbl(${v}) - (${r.value})) > 0.000000001`:
    r.kind==='long'?`${v} <> ${r.value}`:`${v} <> "${r.value.replaceAll('"','""')}"`;
   code.push(` If ${comparison} Then`, `  If firstFailure = 0 Then firstFailure = ${i+1}`, ' End If');
  }
  code.push('End If');
 });
 code.push('If CloseHandle(output) = 0 Then ExitProcess 252','ExitProcess firstFailure');
 const prelude=`Option Explicit
Private output As Long
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Function CreateFileW Lib "kernel32" (ByVal filename As Long, ByVal access As Long, ByVal sharing As Long, ByVal security As Long, ByVal creation As Long, ByVal flags As Long, ByVal template As Long) As Long
Private Declare Function WriteFile Lib "kernel32" (ByVal handle As Long, ByVal buffer As Long, ByVal count As Long, ByRef written As Long, ByVal overlapped As Long) As Long
Private Declare Function CloseHandle Lib "kernel32" (ByVal handle As Long) As Long
Private Sub Record(ByVal text As String)
 Dim written As Long
 text = text & ChrW(13) & ChrW(10)
 If WriteFile(output, StrPtr(text), Len(text) * 2, written, 0) = 0 Then ExitProcess 251
 If written <> Len(text) * 2 Then ExitProcess 251
End Sub
Private Function Encode(ByVal text As String) As String
 Dim i As Long, value As Long, result As String, digits As String, part As Long, j As Long
 For i = 1 To Len(text)
  value = AscW(Mid$(text, i, 1))
  If value < 0 Then value = value + 65536
  digits = ""
  For j = 1 To 4
   part = value Mod 16
   digits = Mid$("0123456789ABCDEF", part + 1, 1) & digits
   value = value \\ 16
  Next
  result = result & digits
 Next
 Encode = result
End Function
`;
 const p=newProject(name);p.startup='Sub Main';p.modules=[{id:'main',name:'Main',kind:'module',code:prelude+'Sub Main()\n'+code.join('\n')+'\nEnd Sub'}];
 return p;
}''' + s[end:]
p.write_text(s)
p=root/'tools/test-win32-dates.ps1';s=p.read_text().replace("[string]$Dependency = '', [ValidateRange", "[string]$Dependency = '', [string]$ResultFile = '', [ValidateRange")
s=s.replace('@($Program,$Manifest,$ReportName,$Dependency)', '@($Program,$Manifest,$ReportName,$Dependency,$ResultFile)')
s=s.replace(" if($process.ExitCode -ne 0){", " if($ResultFile){\n  if(-not (Test-Path -LiteralPath (Join-Path $clean $ResultFile) -PathType Leaf)){throw 'Missing native result file'}\n  $expectedFiles++\n }\n if($process.ExitCode -ne 0){")
s=s.replace(" $process.Dispose()\n $report", " $process.Dispose()\n if($ResultFile -and (Test-Path -LiteralPath (Join-Path $clean $ResultFile) -PathType Leaf)){\n  Copy-Item -LiteralPath (Join-Path $clean $ResultFile) -Destination (Join-Path $path ($Program+'.actual.txt'))\n }\n $report")
s=s.replace(" else{$report.checks += 'No adjacent runtime, DLL or extracted application file required'}", " elseif($ResultFile){$report.checks += 'Only the EXE and its explicitly requested result file; no extracted runtime'}\n else{$report.checks += 'No adjacent runtime, DLL or extracted application file required'}")
p.write_text(s)
p=root/'tools/test-win32-date-intervals.ps1';s=p.read_text().replace('-LifetimeCycles 0', "-ResultFile 'interval-actual.txt' -LifetimeCycles 0")
p.write_text(s)
p=root/'tests/win32-date-intervals.test.mjs';s=p.read_text()+r'''
test('independent reference applies the same Long destination conversion without dropping wide DateDiff cases',async()=>{
 const fs=await import('node:fs');const os=await import('node:os');const path=await import('node:path');
 const {writeIntervalReference}=await import('../tools/win32-date-interval-reference.mjs');
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'native-interval-reference-'));
 try {
  writeIntervalReference(dir);const source=fs.readFileSync(path.join(dir,'interval-reference.vbs'),'utf8');
  const diff='DateDiff("s", DateSerial(100,1,1), DateSerial(9999,12,31))';
  assert.ok(DATE_INTERVAL_CONTRACTS.some(c=>c.expression===diff));
  assert.ok(source.includes('result = CLng('+diff+')\r\nsavedError = Err.Number'));
  assert.ok(source.includes('result = DateAdd("yyyy", -2.5, DateSerial(100,1,1))'));
  assert.equal((source.match(/savedError = Err.Number/g)||[]).length,DATE_INTERVAL_CONTRACTS.length);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
test('malformed out-of-range records remain errors and name the failed reference index',()=>{
 const records=DATE_INTERVAL_CONTRACTS.map((c,i)=>`${i}|${c.kind}|${c.kind==='string'?'':c.kind==='date'?'1.25':'1'}`);
 const index=DATE_INTERVAL_CONTRACTS.findIndex(c=>c.kind==='long');records[index]=`${index}|long|3913228800`;
 assert.throws(()=>readIntervalRecords(records.join('\n')),new RegExp('Out-of-range reference at '+index));
});
test('native differential batches record every actual result, not only the first failed expression',()=>{
 const records=DATE_INTERVAL_CONTRACTS.slice(0,3).map((r,index)=>({...r,index:100+index,outcome:'date',value:1}));
 const p=intervalProject(records),source=p.modules[0].code;
 assert.equal((source.match(/actualError = Err.Number/g)||[]).length,3);
 assert.ok(source.includes('Record "100|error|"'));assert.ok(source.includes('Record "102|date|"'));
 assert.ok(source.includes('ExitProcess firstFailure'));assert.ok(!source.includes('Then ExitProcess 1'));
 assert.ok(compileWin32(p).report.imports.some(i=>i.symbol==='WriteFile'));
});
''';p.write_text(s)
for name,(before,after) in expected.items():
 assert hashlib.sha256((root/name).read_bytes()).hexdigest()==after,'Unexpected result: '+name
print('All reviewed source preimages and results verified')
