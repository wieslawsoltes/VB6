import test from 'node:test';import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
const module=(name,code,kind='class')=>({id:name,name,code,kind});
function build(listener,event='Public Event Tick(Cancel As Boolean,ByVal amount As Long)',body='RaiseEvent Tick(cancel,1)'){
 const project={...newProject('Events'),startup:'Sub Main',modules:[module('M','Private Sub Main()\nDim p As New Publisher,s As New Sink\ns.Connect p\np.Fire\nEnd Sub','module'),
 module('Publisher',event+'\nPublic Sub Fire()\nDim cancel As Boolean\n'+body+'\nEnd Sub'),module('Sink','Private WithEvents source As Publisher\nPublic Sub Connect(ByVal p As Publisher)\nSet source=p\nEnd Sub\n'+listener)]};
 return compileWin32(project);
}
for(const handler of [
 'Private Sub source_Tick(ByVal Cancel As Boolean,ByVal amount As Long)\nEnd Sub',
 'Private Sub source_Tick(Cancel As Integer,ByVal amount As Long)\nEnd Sub',
 'Private Sub source_Tick(Cancel As Boolean)\nEnd Sub',
 'Private Function source_Tick(Cancel As Boolean,ByVal amount As Long) As Long\nEnd Function'
])test('incompatible event sink signatures remain explicit native diagnostics: '+handler,()=>assert.throws(()=>build(handler),e=>e.name==='NativeCompileError'&&/signature/.test(e.message)));
test('undeclared source events do not produce a compiled no-op',()=>assert.throws(()=>build('','','RaiseEvent Missing'),error=>{assert.deepEqual(error.diagnostics.map(({code,source,line})=>({code,source,line})),[{code:'VB_EVENT_NAME',source:'Publisher',line:4}]);assert.match(error.message,/Event not declared: Missing/);return true;}));
test('raw ByRef writes cannot silently bypass a WithEvents cell setter',()=>assert.throws(()=>build('Private Sub Replace(ByRef p As Publisher)\nSet p=Nothing\nEnd Sub\nPrivate Sub Invoke()\nReplace source\nEnd Sub'),/ByRef subscription/));
for(const name of ['AotControlSourceEvents','AotControlEventReentrancy'])test(name+' compiles deterministically and retains native execution budgets',()=>{
 const f=nativeControlFixtures().find(f=>f.project.name===name),before=JSON.stringify(f.project);
 assert.equal(f.checks.length,name==='AotControlSourceEvents'?13:7);
 for(const optimization of[0,1,2]){const a=compileWin32(f.project,{optimization});assert.ok(a.bytes.length<100*1024);assert.deepEqual(a.bytes,compileWin32(f.project,{optimization}).bytes);assert.equal(a.report.extraction,false);}
 assert.equal(JSON.stringify(f.project),before);
});
