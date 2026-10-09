import {traceNativeSurfaceDeletion} from './trace-win32-surface.mjs';
/** Failure-only instrumentation of the same native fixture. The original EXE's
 * result remains authoritative; these checkpoints only localize crashes/errors. */
import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {nativeControlFixtures} from './win32-control-fixtures.mjs';
import {compileWin32} from '../src/native/compiler.js';
const api=`Private Declare Function TraceHandle Lib "kernel32" Alias "GetStdHandle" (ByVal kind As Long) As Long
Private Declare Function TraceWrite Lib "kernel32" Alias "WriteFile" (ByVal handle As Long, ByVal data As Long, ByVal bytes As Long, written As Long, ByVal overlap As Long) As Long`;
const routine=`Private Sub NativeTrace(ByVal message As String)
 Dim written As Long, result As Long
 message=message & vbCrLf
 result=TraceWrite(TraceHandle(-11),StrPtr(message),LenB(message),written,0)
End Sub`;
export function traceControlFixture(project){
  const copy=structuredClone(project),module=copy.modules[0],lines=module.code.split('\n');let inside=false;
  module.code=lines.flatMap((line,index)=>{
    if(/^Private Sub Form_Load\(\)/i.test(line)){inside=true;return [line,'NativeTrace "Form_Load"'];}
    if(/^End Sub/i.test(line))inside=false;
    if(!inside||/^\s*(Dim |End If|Else|Next\b)/i.test(line))return [line];
    const marker=`NativeTrace "line ${index+1}: ${line.trim().slice(0,150).replaceAll('"','""')}"`;
    const values=[];
    if(line.includes('GetObjectType(other)=0 And GetGuiResources'))values.push('NativeTrace "Surface destruction: result=" & CStr(n) & ", old DC type=" & CStr(GetObjectType(other)) & ", baseline=" & CStr(baseline) & ", GDI now=" & CStr(GetGuiResources(GetCurrentProcess(),0))');
    if(line.includes('Pages.Tabs.Count=3'))values.push('NativeTrace "Tabs=" & CStr(Pages.Tabs.Count) & "," & CStr(Strip.Tabs.Count)');
    if(line.includes('n=1 And treeCalls=1'))values.push('NativeTrace "Tree click: result=" & CStr(n) & ", calls=" & CStr(treeCalls) & ", text=" & treeText & ", key=" & treeKey & ", error=" & CStr(Err.Number)');
    if(line.includes('Lists(7).SelCount=0 And'))values.push('NativeTrace "Initial Lists(7): count=" & CStr(Lists(7).SelCount) & ", selected=" & CStr(Lists(7).Selected(0)) & "," & CStr(Lists(7).Selected(1)) & "," & CStr(Lists(7).Selected(2))','NativeTrace "Initial Seeded: count=" & CStr(Seeded.SelCount) & ", selected=" & CStr(Seeded.Selected(0)) & "," & CStr(Seeded.Selected(1)) & "," & CStr(Seeded.Selected(2))');
    if(line.includes('Drives.ListCount>0'))values.push('NativeTrace "Drives=" & CStr(Drives.ListCount)');
    if(line.includes('Left$(s,5)='))values.push('NativeTrace "RTF length=" & CStr(Len(s)) & ", prefix=" & Left$(s,48)', 'If Len(s)>0 Then NativeTrace "First UTF16=" & CStr(AscW(Left$(s,1)))');
    if(line.includes('Rich.Text=Plain.Text'))values.push('NativeTrace "RTF=" & s','NativeTrace "Actual=" & Rich.Text & ", expected=" & Plain.Text','NativeTrace "Lengths=" & CStr(Len(Rich.Text)) & "," & CStr(Len(Plain.Text))');
    return [marker,...values,line];
  }).join('\n').replace('Option Explicit','Option Explicit\n'+api)+'\n'+routine+'\n';
  if(project.name==='AotControlSurfaces')traceNativeSurfaceDeletion(module);
  if(project.name==='AotControlItemObjects'){
    // Preserve the authoritative input sequence. Only the failure-only copy
    // records the native coordinates and message that reached COMCTL32.
    const start=module.code.indexOf('Private Function PulseTree(');
    module.code=module.code.slice(0,start)+module.code.slice(start)
      .replace('If GetCursorPos(old)=0 Then Exit Function','NativeTrace "PulseTree item=" & CStr(item)\n If GetCursorPos(old)=0 Then Exit Function')
      .replace('packed=point.x+point.y*65536','NativeTrace "Client point=" & CStr(point.x) & "," & CStr(point.y) & ", bounds=" & CStr(bounds.left) & "," & CStr(bounds.top) & "," & CStr(bounds.right) & "," & CStr(bounds.bottom)\n packed=point.x+point.y*65536')
      .replace('If SetCursorPos(point.x,point.y)=0 Then GoTo RestoreCursor','NativeTrace "Screen point=" & CStr(point.x) & "," & CStr(point.y)\n If SetCursorPos(point.x,point.y)=0 Then GoTo RestoreCursor')
      .replace('If n<=0 Then GoTo RestoreCursor','NativeTrace "GetMessage result=" & CStr(n) & ", pt=" & CStr(message.point.x) & "," & CStr(message.point.y) & ", message=" & CStr(message.message) & ", lp=" & CStr(message.lp)\n If n<=0 Then GoTo RestoreCursor')
      .replace('RestoreCursor:\n','RestoreCursor:\n NativeTrace "Restore cursor: result=" & CStr(PulseTree) & ", calls=" & CStr(treeCalls) & ", error=" & CStr(Err.Number)\n');
  }
  // The authoritative executable has already failed. Give only the diagnostic
  // copy a normal VB error boundary around form creation so pre-Load failures
  // are reported to stdout instead of disappearing behind a modal error box.
  let name='NativeControlTraceStartup',suffix=0;
  const occupied=new Set(copy.modules.map(m=>m.name.toLowerCase()));
  while(occupied.has(name.toLowerCase()))name='NativeControlTraceStartup'+(++suffix);
  const startup=copy.startup;
  if(String(startup).toLowerCase()!=='sub main'){
    copy.modules.push({id:name,name,kind:'module',code:`Option Explicit
${api}
Private Declare Sub TraceExit Lib "kernel32" Alias "ExitProcess" (ByVal code As Long)
Private Sub Main()
 Dim code As Long, location As String, line As Long
 On Error GoTo Failed
 NativeTrace "Creating startup form"
 ${startup}.Show
 Exit Sub
Failed:
 code=Err.Number
 location=Err.Source
 line=Erl
 NativeTrace "Startup error " & CStr(code) & " in " & location & ":" & CStr(line)
 TraceExit code
End Sub
${routine}`});
    copy.startup='Sub Main';
  }
  return copy;
}
export function buildControlTrace(name,filename){
  const match=String(name).match(/^(AotControl\w+)-O([012])$/);
  const fixture=match&&nativeControlFixtures().find(f=>f.project.name===match[1]);
  if(!fixture)throw new TypeError('Unknown native control fixture: '+name);
  const project=traceControlFixture(fixture.project),result=compileWin32(project,{optimization:Number(match[2])});
  fs.writeFileSync(filename,result.bytes);return {name,bytes:result.bytes.length,checks:fixture.checks};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href)console.log(JSON.stringify(buildControlTrace(process.argv[2],process.argv[3])));
