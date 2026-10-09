import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
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
for(const mode of ['Input','Binary','Random'])test('unlowered Open mode remains an explicit compiler diagnostic: '+mode,()=>{
  assert.throws(()=>compile('Open "test" For '+mode+' As #1'),/Native sequential Open currently lowers/);
});
for(const body of ['Dim n As Long\nn=FreeFile(0,1)','Dim n As Long\nn=FreeFile(unknown:=0)','Write #1, "csv"','Open "test" For Output Access Read As #1','Open "test" For Append Access Read Write As #1'])test('invalid or unlowered native I/O is rejected: '+body,()=>assert.throws(()=>compile(body)));
test('user FreeFile function shadows the intrinsic and does not allocate a native file table',()=>{
  const a=compileWin32(project('Function FreeFile() As Long\nFreeFile=123\nEnd Function\nSub Main\nDim n As Long\nn=FreeFile()\nEnd Sub'));
  assert.ok(!a.report.imports.some(i=>i.symbol==='GetFileInformationByHandle'));
});
test('Debug.Print without files emits native debugger output without a fabricated file API',()=>{
  const a=compile('Debug.Print "A"; Tab(4) "B"; 7');
  assert.ok(a.report.imports.some(i=>i.symbol==='OutputDebugStringW'));assert.ok(!a.report.imports.some(i=>i.symbol==='GetFileInformationByHandle'));
});
