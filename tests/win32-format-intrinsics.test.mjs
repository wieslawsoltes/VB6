import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newProject} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeFormatType} from '../src/native/format-intrinsics.js';
import {parseExpression} from '../src/language/expression.js';
import {nativeStringLibraryFixture} from '../tools/win32-string-library-fixtures.mjs';
const project=code=>({...newProject('Format'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code}]});
for(const optimization of [0,1,2])test(`Format, ANSI Chr and shared constant fixtures compile as deterministic PE32 O${optimization}`,()=>{
  const {project:p,checks}=nativeStringLibraryFixture(),before=JSON.stringify(p),a=compileWin32(p,{optimization});
  assert.ok(checks.some(c=>c.includes('Sunday-based')));assert.ok(checks.some(c=>c.includes('null BSTR sentinel')));
  assert.deepEqual(a.bytes,compileWin32(p,{optimization}).bytes);assert.equal(JSON.stringify(p),before);
  for(const symbol of ['VarFormat','VariantCopyInd','VariantClear','MultiByteToWideChar','GetCPInfo','SysAllocStringLen'])assert.ok(a.report.imports.some(i=>i.symbol===symbol),symbol);
});
test('Format/Format$ have distinct ABI result types; project functions shadow intrinsics',()=>{
  for(const [call,type] of [['Format(1,"0")','variant'],['Format$(1,"0")','string'],['Chr$(65)','string'],['Chr(65)','string']]) {
    assert.equal(nativeFormatType({resolveProcedure:()=>null},parseExpression(call)),type);
    assert.equal(nativeFormatType({resolveProcedure:()=>({})},parseExpression(call)),null);
  }
  const result=compileWin32(project('Private Function Format(ByVal n As Long) As Long\nFormat=n+1\nEnd Function\nPrivate Function vbBlue() As Long\nvbBlue=5\nEnd Function\nSub Main()\nDim n As Long\nn=Format(vbBlue)\nEnd Sub'));
  assert.ok(!result.report.imports.some(i=>i.symbol==='VarFormat'));
});
for(const call of ['Format$()','Format$(expression:=1,typo:=2)','Format$(1,expression:=2)','Format$(1,"0",1,1,1)','Chr$()','Chr$(65,66)','Chr$(code:=65)'])test('invalid formatting signature is rejected: '+call,()=>{
  assert.throws(()=>compileWin32(project('Sub Main()\nDim s As String\ns='+call+'\nEnd Sub')));
});
for(const id of ['clock','richtext','win32-registry','win32-settings'])test(`${id} sample exports without editing its VB source or control metadata`,()=>{
  const p=JSON.parse(fs.readFileSync(new URL('../examples/'+id+'.vb6web',import.meta.url),'utf8')),before=JSON.stringify(p);
  for(const optimization of [0,1,2]){
    const {bytes,report}=compileWin32(p,{optimization});assert.equal(bytes[0],0x4d);assert.equal(bytes[1],0x5a);
    assert.equal(report.target,'win32-aot');assert.equal(report.extraction,false);
  }
  assert.equal(JSON.stringify(p),before);
});
test('shared builtins do not override a local constant or variable',()=>{
  const p=project('Private Const vbRed As Long=123\nSub Main()\nDim vbBlue As Long,n As Long\nvbBlue=7\nn=vbRed+vbBlue\nEnd Sub');
  assert.ok(compileWin32(p).bytes.length);
});
