import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileWin32} from '../src/native/compiler.js';
import {compileProject} from '../src/language/compiler.js';
import {NativeRecordLayouts} from '../src/native/records.js';
import {newProject} from '../src/project/model.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
const mixed='Private Type Mixed\n tag As Byte\n code As Integer\n text As String * 5\n tail As Long\nEnd Type\n';
const project=source=>({...newProject('FixedRecords'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:source}]});
const compile=source=>compileWin32(project(source));
const empty='Sub Main()\nEnd Sub';
test('Unicode storage and ANSI Declare layouts align each field independently',()=>{
 const p=compileProject(project(mixed+'Dim x As Mixed\n'+empty)),m=p.modules.get('m');
 const r=new NativeRecordLayouts(p).resolve('Mixed',m);
 assert.equal(r.size,20);assert.equal(r.ansiSize,16);assert.equal(r.fileSize,12);
 assert.deepEqual([...r.fields.values()].map(f=>[f.name,f.recordOffset,f.ansiOffset,f.nativeElementBytes,f.ansiElementBytes]),[
  ['tag',0,0,1,1],['code',2,2,2,2],['text',4,4,10,5],['tail',16,12,4,4]]);
});
test('nested fixed String arrays retain separate element strides and file lengths',()=>{
 const p=compileProject(project(mixed+'Private Type Box\n left As Mixed\n right As Mixed\n names(-1 To 0) As String * 3\n suffix As Byte\nEnd Type\n'+empty)),m=p.modules.get('m');
 const r=new NativeRecordLayouts(p).resolve('Box',m);
 assert.equal(r.size,56);assert.equal(r.ansiSize,40);assert.equal(r.fileSize,31);
 const names=r.fields.get('names');assert.equal(names.recordOffset,40);assert.equal(names.ansiOffset,32);assert.equal(names.nativeElementBytes,6);assert.equal(names.ansiElementBytes,3);
});
test('the real WIN32_FIND_DATAA sample exports unchanged at every optimization level',()=>{
 const p=JSON.parse(fs.readFileSync(new URL('../examples/win32-files.vb6web',import.meta.url))),before=JSON.stringify(p);
 for(const optimization of [0,1,2]){const a=compileWin32(p,{optimization});assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);assert.ok(a.report.imports.some(i=>i.symbol==='FindFirstFileA'));}
 assert.equal(JSON.stringify(p),before);
});
for(const optimization of [0,1,2])test(`fixed record fixture emits deterministic PE32 at O${optimization}`,()=>{
 const f=nativeControlFixtures().find(f=>f.project.name==='AotControlFixedRecords'),before=JSON.stringify(f.project);
 const a=compileWin32(f.project,{optimization}),b=compileWin32(f.project,{optimization});
 assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(f.project),before);assert.equal(f.checks.length,19);
 for(const api of ['ReadFile','WriteFile','FindFirstFileA','WideCharToMultiByte','MultiByteToWideChar','CharUpperBuffA'])assert.ok(a.report.imports.some(i=>i.symbol===api),api);
});
test('inline fixed String fields passed as typed String use a BSTR snapshot, not their first character as a pointer',()=>{
 const a=compile(mixed+'Private Declare Function Upper Lib "user32" Alias "CharUpperBuffA" (ByVal s As String,ByVal n As Long) As Long\nSub Main()\nDim x As Mixed,n As Long\nx.text="abc"\nn=Upper(x.text,5)\nEnd Sub');
 assert.ok(a.report.imports.some(i=>i.symbol==='SysAllocStringLen'));
});
for(const field of ['String','Object','Variant','AsNew'])test('managed fields never acquire byte-copy ownership: '+field,()=>{
 const declaration=field==='AsNew'?'x As New Missing':'x As '+field;
 assert.throws(()=>compile('Private Type T\n'+declaration+'\nEnd Type\nDim x As T\n'+empty));
});

for(const code of ['x.names="bad"','Dim s As String\ns=x.names','Dim n As Long\nn=StrPtr(x.names)'])test('whole inline fixed String arrays require indexing: '+code,()=>{
 assert.throws(()=>compile('Private Type T\n names(0 To 1) As String * 3\nEnd Type\nSub Main()\nDim x As T\n'+code+'\nEnd Sub'),/indices|indexed/);
});
