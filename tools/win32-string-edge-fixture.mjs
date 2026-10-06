import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';

/** Independent same-variable output and failure-lifetime tests. */
export function stringOwnershipFixture(){
 const p=newProject('AotStringOwnership');p.startup='Sub Main';
 const checks=[],lines=['Dim s As String, t As String, n As Long, e As Long, i As Long'];
 const check=(expr,label)=>{checks.push(label);lines.push(`If Not (${expr}) Then ExitProcess ${checks.length}`);};
 lines.push('s = "original"','n = AliasBuffers(s,s)');
 check('n = 1 And s = "Briginal"','Repeated ByVal aliases use distinct buffers; written-order final copy-back wins');
 lines.push('s = "original"','n = AliasBuffers(second:=s,first:=s)');
 check('n = 1 And s = "Ariginal"','Reordered named aliases copy back in written order, not formal order');
 lines.push('s = "original"','AliasOwners s,s');
 check('s = "second" And Err.LastDLLError = 17800','Repeated ByRef aliases own distinct byte-BSTR slots');
 lines.push('s = "original"','AliasOwners second:=s,first:=s');
 check('s = "first" And Err.LastDLLError = 17800','Named ByRef output order preserves independent ownership');
 lines.push('s = "original"','AliasOwners (s),s');
 check('s = "second"','Grouped first alias does not write back');
 lines.push('s = "original"','AliasOwners s,(s)');
 check('s = "first"','Grouped second alias does not erase first copy-back');
 lines.push('s = "left"','t = "right"','On Error Resume Next','PartialOutputs s,t','e = Err.Number','Err.Clear','On Error GoTo 0');
 check('e = 7 And s = "committed" And t = "right"','Later oversized output preserves its destination without undoing prior output');
 check('Err.LastDLLError = 17801','Return error snapshot survives failing output decode and Err.Clear');
 lines.push('s = ReturnString(0) & ReturnString(0)');
 check('s = "r" & ChrW(0) & "xr" & ChrW(0) & "x"','Two String returns keep independent full-length owners');
 lines.push('Call SetLastError(17802)','n = Err.LastDLLError');
 check('n = 17802 And Err.LastDLLError = 17802','Captured error from a void Declare survives statement cleanup');
 check('ShadowConstant()','StrPtr on an authored vbNullString constant is not incorrectly forced to zero');
 lines.push('s = "NULL destination"','ClearString s');
 check('s = "" And StrPtr(s) = 0','Post-failure ownership remains usable for null copy-back');
 lines.push('For i = 1 To 2000','s = "start"','AliasOwners s,s','On Error Resume Next','PartialOutputs s,t','Err.Clear','On Error GoTo 0','Next');
 check('s = "committed" And t = "right"','2000 aliased/replaced/failed-output cycles preserve owner lifetimes');
 lines.push('ExitProcess 0');
 p.modules=[{id:'main',name:'MainModule',kind:'module',code:`Option Explicit
Private Declare Sub ExitProcess Lib "kernel32" (ByVal code As Long)
Private Declare Sub SetLastError Lib "kernel32" (ByVal number As Long)
Private Declare Function AliasBuffers Lib "vb6-string-probe" (ByVal first As String, ByVal second As String) As Long
Private Declare Sub AliasOwners Lib "vb6-string-probe" (ByRef first As String, ByRef second As String)
Private Declare Sub PartialOutputs Lib "vb6-string-probe" (ByRef first As String, ByRef second As String)
Private Declare Function ReturnString Lib "vb6-string-probe" (ByVal kind As Long) As String
Private Declare Sub ClearString Lib "vb6-string-probe" (ByRef value As String)
Private Declare Function EmptyKind Lib "vb6-string-probe" (ByVal value As String) As Long
Private Function ShadowConstant() As Boolean
 Const vbNullString As String = "authored"
 ShadowConstant = StrPtr(vbNullString) <> 0 And EmptyKind(vbNullString) = 0
End Function
Sub Main()
${lines.join('\n')}
End Sub`}];
 return {project:p,checks};
}
export function writeStringOwnershipFixture(directory='validation/string-interop'){
 const {project,checks}=stringOwnershipFixture(),result=compileWin32(project);
 fs.mkdirSync(directory,{recursive:true});
 fs.writeFileSync(path.join(directory,project.name+'.exe'),result.bytes);
 fs.writeFileSync(path.join(directory,project.name+'.vb6web'),JSON.stringify(project,null,2)+'\n');
 fs.writeFileSync(path.join(directory,'string-ownership-build.json'),JSON.stringify({...result.report,checks,dependencies:['vb6-string-probe.dll'],sha256:createHash('sha256').update(result.bytes).digest('hex')},null,2)+'\n');
 console.log(project.name,checks.length,result.bytes.length);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)writeStringOwnershipFixture();
