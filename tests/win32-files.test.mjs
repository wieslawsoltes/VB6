import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
import {nativeFileMachine} from './support/native-file-machine.mjs';
const project=source=>({...newProject('Files'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:source}]});
const compile=body=>compileWin32(project('Sub Main\n'+body+'\nEnd Sub'));
for(const optimization of [0,1,2])test(`sequential file fixture is deterministic native PE32 at O${optimization}`,()=>{
  const {project:p,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlSequentialFiles');
  const before=JSON.stringify(p),a=compileWin32(p,{optimization});assert.deepEqual(a.bytes,compileWin32(p,{optimization}).bytes);assert.equal(JSON.stringify(p),before);
  assert.equal(checks.length,34);assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
  for(const symbol of ['CreateFileW','WriteFile','CloseHandle','SetEndOfFile','GetFileInformationByHandle','ReadFile','WideCharToMultiByte','OutputDebugStringW'])assert.ok(a.report.imports.some(i=>i.symbol===symbol),symbol);
});
test('original Order Entry sample compiles unchanged at every optimization level',()=>{
  const p=JSON.parse(fs.readFileSync(new URL('../examples/orders.vb6web',import.meta.url),'utf8')),before=JSON.stringify(p);
  for(const optimization of [0,1,2])assert.equal(compileWin32(p,{optimization}).report.target,'win32-aot');
  assert.equal(JSON.stringify(p),before);
});
for(const mode of ['Binary','Random'])for(const optimization of [0,1,2])test(`authored ${mode} Open/Put/Get/Seek/Close execute through emitted IA-32 at O${optimization}`,t=>{
  const length=mode==='Random'?' Len = 8':'';
  const code=`Public Actual As Long, Reopened As Long, NextPosition As Long
Sub Main
  Dim Value As Long
  Value = &H44332211
  Open "x" For ${mode} Access Read Write Shared As #1${length}
  Put #1, 2, Value
  Seek #1, 2
  Get #1, , Actual
  NextPosition = Seek(1)
  Close #1
  Open "x" For ${mode} Access Read As #1${length}
  Get #1, 2, Reopened
  Close #1
End Sub`;
  const f=nativeFileMachine(t,{code,optimization});f.add('x',[0xaa,0xbb,0xcc,0xdd,0xee,0xff]);
  f.vm.invoke('proc:M:Main');
  const global=name=>f.m.read(f.vm.symbol('global:M:'+name));
  assert.equal(global('Actual'),0x44332211);assert.equal(global('Reopened'),0x44332211);
  assert.equal(global('NextPosition'),mode==='Binary'?6:3);
  assert.deepEqual([...f.files.get('x').bytes],mode==='Binary'?[0xaa,0x11,0x22,0x33,0x44,0xff]:[0xaa,0xbb,0xcc,0xdd,0xee,0xff,0,0,0x11,0x22,0x33,0x44,0,0,0,0]);
  const opened=f.vm.calls.filter(call=>call.name==='iat:kernel32.dll!CreateFileW');
  assert.deepEqual(opened.map(call=>[call.args[1],call.args[2],call.args[4]]),[[0xc0000000,3,4],[0x80000000,0,3]],'read/write opens without truncation; read-only requires an existing file');
  assert.equal(f.vm.calls.filter(call=>call.name==='iat:kernel32.dll!CloseHandle').length,2);
  assert.equal(f.handles.size,0);assert.ok(!f.vm.calls.some(call=>call.name==='iat:kernel32.dll!SetEndOfFile'),'Binary/Random Open must preserve existing bytes');
});
for(const body of ['Dim n As Long\nn=FreeFile(0,1)','Dim n As Long\nn=FreeFile(unknown:=0)','Open "test" For Output Access Read As #1','Open "test" For Append Access Read Write As #1'])test('invalid or unlowered native I/O is rejected: '+body,()=>assert.throws(()=>compile(body)));
test('user FreeFile function shadows the intrinsic and does not allocate a native file table',()=>{
  const a=compileWin32(project('Function FreeFile() As Long\nFreeFile=123\nEnd Function\nSub Main\nDim n As Long\nn=FreeFile()\nEnd Sub'));
  assert.ok(!a.report.imports.some(i=>i.symbol==='GetFileInformationByHandle'));
});
test('Debug.Print without files emits native debugger output without a fabricated file API',()=>{
  const a=compile('Debug.Print "A"; Tab(4) "B"; 7');
  assert.ok(a.report.imports.some(i=>i.symbol==='OutputDebugStringW'));assert.ok(!a.report.imports.some(i=>i.symbol==='GetFileInformationByHandle'));
});
