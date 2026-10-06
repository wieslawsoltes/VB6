import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
export function arrayBudgetFixture(){
 const p=newProject('AotArrayBudget');p.startup='Sub Main';
 const checks=['Odd byte budget admits full Long elements only','Oversized Preserve is rejected with error 7','Failed Preserve retains descriptor and values','Double width is enforced before allocation','Failed Double resize retains previous bounds','Byte arrays use every byte of the budget'];
 p.modules=[{id:'main',name:'MainModule',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Sub Main()
 Dim values() As Long, wide() As Double, bytes() As Byte, number As Long
 ReDim values(-1 To 253)
 values(-1) = 7
 values(253) = 9
 If UBound(values) <> 253 Then ExitProcess 1
 On Error Resume Next
 ReDim Preserve values(-1 To 254)
 number = Err.Number
 Err.Clear
 On Error GoTo 0
 If number <> 7 Then ExitProcess 2
 If UBound(values) <> 253 Or values(-1) <> 7 Or values(253) <> 9 Then ExitProcess 3
 ReDim wide(126)
 On Error Resume Next
 ReDim wide(127)
 number = Err.Number
 Err.Clear
 On Error GoTo 0
 If number <> 7 Then ExitProcess 4
 If UBound(wide) <> 126 Then ExitProcess 5
 ReDim bytes(1022)
 bytes(1022) = 255
 If bytes(1022) <> 255 Then ExitProcess 6
 ExitProcess 0
End Sub`}];return {project:p,checks,options:{maxArrayBytes:1023}};
}
export function writeArrayBudgetFixture(directory='validation/array-budget'){
 const {project,checks,options}=arrayBudgetFixture(),result=compileWin32(project,options);fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'array-budget-build.json'),JSON.stringify({...result.report,checks,options,sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
 console.log(project.name,checks.length,result.bytes.length);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeArrayBudgetFixture();
