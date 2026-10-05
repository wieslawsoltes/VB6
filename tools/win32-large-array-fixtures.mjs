/** Small real allocations exercise the former quota without asking a CI runner
 * to commit gigabytes. Oversized requests must fail before OS allocation. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
export function largeArrayFixture() {
 const checks=[],lines=[];
 const check=(condition,name)=>{checks.push(name);lines.push(`If Not (${condition}) Then ExitProcess ${checks.length}`);};
 const failure=(statement,error,name)=>{lines.push('On Error Resume Next','Err.Clear',statement,'actualError = Err.Number','Err.Clear','On Error GoTo 0');check(`actualError = ${error}`,name);};
 lines.push('Dim bytes() As Byte, longs() As Long, dates() As Date, money() As Currency, text() As String, copy() As String',
  'Dim fixed(0 To 1048576) As Byte, actualError As Long, i As Long',
  `Dim many(${Array(60).fill('-1 To -1').join(',')}) As Long`,
  'ReDim bytes(0 To 2097151)','bytes(0) = 17','bytes(2097151) = 29');
 check('LBound(bytes) = 0 And UBound(bytes) = 2097151 And bytes(0) = 17 And bytes(2097151) = 29','Two-MiB Byte storage and final index');
 lines.push('ReDim Preserve bytes(0 To 2097167)');
 check('bytes(0) = 17 And bytes(2097151) = 29 And bytes(2097167) = 0','Preserve beyond the former quota and initialize tail');
 lines.push('fixed(1048576) = 41');check('fixed(1048576) = 41 And UBound(fixed) = 1048576','Fixed backing exceeding one MiB');
 lines.push('ReDim longs(-2 To 524285)','longs(-2) = 19','longs(524285) = 37');
 check('longs(-2) = 19 And longs(524285) = 37','Two-MiB Long storage preserves negative bounds');
 lines.push('ReDim dates(0 To 262143)','dates(262143) = #2024-02-29 06:00:00#');
 check('dates(262143) = #2024-02-29 06:00:00#','Two-MiB Date backing retains all eight bytes');
 lines.push('ReDim money(0 To 262143)','money(262143) = 900719925474.0993@');
 check('money(262143) = 900719925474.0993@','Two-MiB Currency backing retains exact low bits');
 lines.push('ReDim text(0 To 262144)','text(0) = "first"','text(262144) = "last" & ChrW(0) & "tail"','copy = text','text(262144) = "changed"');
 check('copy(0) = "first" And copy(262144) = "last" & ChrW(0) & "tail"','Large BSTR array copy has independent ownership including NUL');
 const sub=Array(60).fill('-1').join(',');lines.push(`many(${sub}) = 71`);
 check(`many(${sub}) = 71 And LBound(many,60) = -1 And UBound(many,60) = -1`,'Sixty dimensions retain last-dimension bounds and index layout');
 const bounds=Array.from({length:60},(_,i)=>`${i-30} To ${i-30+(i===59?1:0)}`);
 const point=Array.from({length:60},(_,i)=>String(i-30)),next=[...point];next[59]='30';
 lines.push('Dim ranked() As Long',`ReDim ranked(${bounds.join(',')})`,`ranked(${point.join(',')}) = 71`,`ranked(${next.join(',')}) = 83`);
 check(`ranked(${point.join(',')}) = 71 And ranked(${next.join(',')}) = 83 And LBound(ranked,17) = -14 And UBound(ranked,60) = 30`,'Distinct sixty-dimensional metadata and adjacent last-axis elements');
 bounds[59]='29 To 31';lines.push(`ReDim Preserve ranked(${bounds.join(',')})`);
 const tail=[...point];tail[59]='31';
 check(`ranked(${point.join(',')}) = 71 And ranked(${next.join(',')}) = 83 And ranked(${tail.join(',')}) = 0`,'Sixty-dimensional Preserve keeps values and initializes new last-axis tail');
 lines.push('Erase ranked');
 failure('ReDim longs(0 To 536870911)',7,'Long byte-size overflow rejected before allocation');
 check('longs(-2) = 19 And longs(524285) = 37 And UBound(longs) = 524285','Failed overflow leaves Long descriptor and values intact');
 failure('ReDim dates(0 To 268435455)',7,'Date byte-size overflow rejected before allocation');
 check('dates(262143) = #2024-02-29 06:00:00#','Failed Date resize preserves existing backing');
 failure('ReDim bytes(0 To 2147483647)',7,'Dimension count overflow is checked before allocation');
 check('UBound(bytes) = 2097167 And bytes(0) = 17','Failed Byte resize preserves existing backing');
 failure('ReDim longs(0 To 65535,0 To 65535)',7,'Multidimensional product overflow is checked');
 check('LBound(longs) = -2 And longs(-2) = 19','Failed rank-changing resize is atomic');
 failure('Hold longs(-2), Grow(longs)',10,'Large array actual reference pins block mutation during subsequent argument evaluation');
 check('longs(-2) = 19 And UBound(longs) = 524285','Pinned array remains unmodified on rejected mutation');
 // A successful resize after failure proves the reference pin was released.
 lines.push('ReDim Preserve longs(-2 To 524286)');
 check('longs(-2) = 19 And longs(524286) = 0','Error recovery releases large-array pins');
 lines.push('Erase text','Erase copy','Erase bytes','Erase longs','Erase dates','Erase money','Erase fixed','Erase many');
 check(`fixed(1048576) = 0 And many(${sub}) = 0`,'Erase reinitializes fixed arrays including sixty-dimensional storage');
 lines.push('For i = 1 To 64',' ReDim dates(0 To 131072)',' dates(131072) = CDate(i)',' Erase dates','Next');
 check('i = 65','Repeated greater-than-one-MiB allocations and destruction');
 lines.push('ExitProcess 0');
 const p=newProject('AotLargeArrays');p.startup='Sub Main';p.modules=[{id:'main',name:'Main',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Function Grow(ByRef values() As Long) As Long
 ReDim values(0 To 524288)
 Grow = 0
End Function
Private Sub Hold(ByRef value As Long, ByVal other As Long)
 ExitProcess 250
End Sub
Public Sub Main()
${lines.join('\n')}
End Sub`}];
 return {project:p,checks};
}
export function writeLargeArrayFixture(directory='validation/large-arrays') {
 const {project,checks}=largeArrayFixture(),result=compileWin32(project);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
 fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'large-array-build.json'),JSON.stringify({...result.report,checks,allocationCycles:64,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
 console.log(`${project.name}: ${checks.length} checks; ${result.bytes.length} bytes`);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeLargeArrayFixture();
