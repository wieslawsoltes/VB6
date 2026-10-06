import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {storageLayout} from '../src/native/storage.js';
import {NATIVE_ARRAY_MAX_BYTES,NATIVE_ARRAY_MAX_RANK} from '../src/native/arrays.js';
import {largeArrayFixture} from '../tools/win32-large-array-fixtures.mjs';
const literal=value=>({kind:'literal',value});
const fail=message=>{throw Error(message);};
const layout=(type,count)=>storageLayout({fail},{name:'values',type,bounds:[[literal(-1),literal(count-2)]]},{optionBase:0});
for(const [type,width] of [['Byte',1],['Integer',2],['Boolean',2],['Long',4],['Single',4],['String',4],['Double',8],['Currency',8],['Date',8]]) {
 test(`${type}: former quota removed without losing width checks`,()=>{
  const count=Math.floor(1048576/width)+1,decl=layout(type,count);
  assert.equal(decl.nativeDataBytes,count*width);assert.equal(decl.nativeBytes,4);
  const maximum=Math.floor(NATIVE_ARRAY_MAX_BYTES/width);
  assert.equal(layout(type,maximum).nativeDataBytes,maximum*width);
  assert.throws(()=>layout(type,maximum+1),/x86/);
 });
}
test('Native array budget is a signed-address arithmetic ceiling, not a one-MiB quota',()=>{
 assert.equal(NATIVE_ARRAY_MAX_BYTES,0x7ffffff8);assert.equal(NATIVE_ARRAY_MAX_RANK,60);
});
test('rank sixty is supported and rank sixty-one is diagnosed before emission',()=>{
 const d={name:'a',type:'Long',bounds:Array.from({length:60},()=>[literal(0),literal(0)])};
 assert.equal(storageLayout({fail},d,{optionBase:0}).nativeDataBytes,4);
 assert.throws(()=>storageLayout({fail},{...d,bounds:[...d.bounds,[literal(0),literal(0)]]},{optionBase:0}),/60/);
});
test('multidimensional backing product remains checked with a wider quota',()=>{
 assert.throws(()=>storageLayout({fail},{name:'a',type:'Byte',bounds:Array.from({length:4},()=>[literal(0),literal(65535)])},{optionBase:0}),/x86/);
});
test('large backing is not emitted into PE sections and fixture source remains intact',()=>{
 const {project,checks}=largeArrayFixture(),before=JSON.stringify(project),result=compileWin32(project);
 assert.equal(JSON.stringify(project),before);assert.ok(checks.length>=20);
 assert.ok(result.bytes.length<100*1024);assert.deepEqual(result.bytes,compileWin32(project).bytes);
 for(const name of ['SafeArrayCreate','SafeArrayRedim','SafeArrayDestroy','SafeArrayLock','SafeArrayUnlock','SafeArrayCopy'])assert.ok(result.report.imports.some(i=>i.symbol===name),name);
});

test('optional array budget is validated before native source generation',()=>{
 const {project}=largeArrayFixture();
 for(const maxArrayBytes of [null,0,-1,0.5,NaN,Infinity,'1024',0x80000000])
  assert.throws(()=>compileWin32(project,{maxArrayBytes}),/maxArrayBytes/);
 assert.throws(()=>compileWin32(project,{maxArrayBytes:1024}),/configured budget/);
});
test('smaller budgets change emitted dynamic-size guards without allocating host backing',()=>{
 const {project}=largeArrayFixture();project.modules[0].code='Sub Main()\nDim a() As Long\nReDim a(1)\nEnd Sub';
 const limited=compileWin32(project,{maxArrayBytes:1023}),normal=compileWin32(project);
 assert.equal(limited.report.arrayLimits.maxBytes,1023);assert.equal(limited.report.arrayLimits.maxRank,60);
 assert.notDeepEqual(limited.bytes,normal.bytes);
 assert.deepEqual(normal.bytes,compileWin32(project,{maxArrayBytes:NATIVE_ARRAY_MAX_BYTES}).bytes);
});
test('native CLI parses a strict decimal byte budget without lossy unit suffixes',async()=>{
 const {parseWin32Options}=await import('../tools/build-win32.mjs');
 assert.equal(parseWin32Options(['--max-array-bytes','1048576']).maxArrayBytes,1048576);
 for(const value of ['1.5','1e6','1MiB','Infinity'])assert.throws(()=>parseWin32Options(['--max-array-bytes',value]),/integer/);
});

test('numeric execution fixture covers both removed quota and atomic x86-width rejection', async()=>{
 const {numericFixture}=await import('../tools/win32-numeric-fixtures.mjs');
 const project=numericFixture(), code=project.modules[0].code;
 assert.match(code,/ReDim values\(200000\)\s+If Err\.Number <> 0 Or UBound\(values\) <> 200000 Then ExitProcess 63/);
 assert.match(code,/ReDim Preserve values\(268435455\)\s+If Err\.Number <> 7 Then ExitProcess 60/);
 assert.match(code,/If UBound\(values\) <> 200000 Or values\(200000\) <> 1\.25 Then ExitProcess 64/);
 assert.ok(compileWin32(project).bytes.length);
});
