import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeGoSubLimit} from '../src/native/control-flow.js';
import {nativeLanguageFixture} from '../tools/win32-language-fixtures.mjs';
const project=code=>({...newProject('Flow'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code}]});
for(const optimization of [0,1,2])test(`native GoSub, With and typed arithmetic fixture links deterministically at O${optimization}`,()=>{
 const {project,checks}=nativeLanguageFixture(),snapshot=JSON.stringify(project),a=compileWin32(project,{optimization});
 assert.deepEqual(a.bytes,compileWin32(project,{optimization}).bytes);assert.equal(JSON.stringify(project),snapshot);assert.ok(checks.length>=20);
 const text=a.report.sections.find(s=>s.name==='.text');for(const s of a.report.sourceMap)assert.ok(s.rva>=text.rva&&s.rva<text.rva+text.size);
 assert.equal(a.report.controlFlow.maxGoSubDepth,1024);
});
test('GoSub depth is explicit, bounded and does not burden procedures without GoSub',()=>{
 for(const n of [1,4,1024,65536])assert.equal(nativeGoSubLimit(n),n);
 for(const n of [0,-1,65537,1.5,false,null,'4'])assert.throws(()=>nativeGoSubLimit(n));
 const p=project('Sub Main()\nGoSub L\nExit Sub\nL:\nReturn\nEnd Sub');
 assert.equal(compileWin32(p,{maxGoSubDepth:4}).report.controlFlow.maxGoSubDepth,4);
 assert.throws(()=>compileWin32(p,{maxGoSubDepth:0}),/maxGoSubDepth/);
});
test('With supports scalar and indexed intrinsic controls, without changing their authored geometry',()=>{
 const p=newProject('ControlWith');const form=p.modules[0];
 form.form.controls=[createControl('CommandButton','Button'),createControl('CommandButton','Item')];form.form.controls[1].properties.Index=2;
 form.code='Private Sub Form_Load()\nWith Button\n .Caption="updated"\nEnd With\nWith Item(2)\n .Caption=CStr(.Index)\nEnd With\nEnd Sub';
 const before=JSON.stringify(p);assert.ok(compileWin32(p).bytes.length);assert.equal(JSON.stringify(p),before);
});
test('unsupported With values are not treated as pointers',()=>{
 assert.throws(()=>compileWin32(project('Sub Main()\nWith 123\nEnd With\nEnd Sub')),/With/);
});
