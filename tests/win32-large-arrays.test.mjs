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
