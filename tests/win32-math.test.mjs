import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
const project=source=>({...newProject('Math'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:source}]});
const compile=body=>compileWin32(project('Sub Main()\n'+body+'\nEnd Sub'));
for(const optimization of [0,1,2])test(`native numerical fixture is deterministic at O${optimization}`,()=>{
 const {project:p,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlMath'),before=JSON.stringify(p);
 const a=compileWin32(p,{optimization}),b=compileWin32(p,{optimization});
 assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(p),before);assert.equal(checks.length,45);
 assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);assert.ok(a.bytes.length<100000);
 for(const name of ['sin','cos','tan','atan','exp','log'])assert.ok(a.report.imports.some(i=>i.dll==='ucrtbase.dll'&&i.symbol===name),name);
});
for(const name of ['Sin','Cos','Tan','Atn','Exp','Log'])test(name+' validates argument names and arity',()=>{
 assert.ok(compile('Dim d As Double\nd='+name+'(number:=0.5)').bytes.length);
 for(const args of ['', '1,2','typo:=1','number:=1,number:=2'])assert.throws(()=>compile('Dim d As Double\nd='+name+'('+args+')'),/Missing|Too many|Unknown|Duplicate/);
});
for(const body of ['Randomize 1,2','Randomize seed:=1','Dim n As Long\nn=RGB(1,2)','Dim n As Long\nn=RGB(1,2,3,4)','Dim n As Long\nn=QBColor()','Dim n As Long\nn=QBColor(1,2)','Dim d As Single\nd=Rnd(1,2)'])test('invalid native numeric signature: '+body,()=>assert.throws(()=>compile(body)));
for(const name of ['Sin','RGB','Rnd'])test('authored '+name+' procedure shadows the intrinsic',()=>{
 const p=project('Private Function '+name+'() As Long\n'+name+'=42\nEnd Function\nSub Main()\nDim n As Long\nn='+name+'()\nEnd Sub');
 const a=compileWin32(p);assert.ok(!a.report.imports.some(i=>i.dll==='ucrtbase.dll'));
});
test('unused transcendental families do not add installed CRT imports',()=>{
 const a=compile('Dim n As Long\nn=RGB(1,2,3)+QBColor(7)');assert.ok(!a.report.imports.some(i=>i.dll==='ucrtbase.dll'));
 const b=compile('Dim d As Double\nd=Sin(1)');assert.deepEqual(b.report.imports.filter(i=>i.dll==='ucrtbase.dll').map(i=>i.symbol),['sin']);
});


test('native color oracles are positive COLORREF values, not signed Integer hex literals',()=>{
 const {project:p,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlMath');
 const code=p.modules[0].code;
 assert.ok(code.includes('RGB(0,255,0)=65280'));
 // These are the three palette entries whose unsuffixed hexadecimal spelling
 // would denote a negative 16-bit Integer in the language under test.
 for(const [index,value] of [[2,32768],[10,65280],[14,65535]])
  assert.ok(code.includes(`QBColor(${index})=${value}`));
 assert.equal(checks.filter(s=>s.startsWith('QBColor ')).length,16);
 assert.ok(code.includes('VarType(RGB(1,2,3))=vbLong'));
});
