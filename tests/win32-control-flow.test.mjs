import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {nativeGoSubLimit} from '../src/native/control-flow.js';
import {nativeLanguageFixture} from './fixtures/native-language.mjs';
import {newProject} from '../src/project/model.js';
const project=code=>{const p=newProject('Flow');p.startup='Sub Main';p.modules=[{id:'m',name:'Module1',kind:'module',code}];return p;};
for(const level of [0,1,2])test(`native language/flow fixture deterministically links at O${level}`,()=>{
  const {project,checks}=nativeLanguageFixture(),before=JSON.stringify(project),result=compileWin32(project,{optimization:level});
  assert.deepEqual(result.bytes,compileWin32(project,{optimization:level}).bytes);assert.equal(JSON.stringify(project),before);
  assert.ok(checks.length>=30);assert.equal(result.report.controlFlow.maxGoSubDepth,1024);
  for(const symbol of ['LCMapStringW','CompareStringW','SysFreeString'])assert.ok(result.report.imports.some(i=>i.symbol===symbol));
  assert.equal(result.report.optimization.jumpTables>0,level===2);
  assert.equal(result.report.optimization.constantsPropagated>0,level===2);
  assert.equal(result.report.optimization.directBranches>0,level===2);
});
test('native control-flow source identities survive O2 lowering',()=>{
  const p=nativeLanguageFixture().project;
  const map=level=>compileWin32(p,{optimization:level}).report.sourceMap.map(({rva,...entry})=>entry);
  assert.deepEqual(map(2),map(0));
});
for(const value of [0,-1,65537,1.5,NaN,null,'8',true])test('native GoSub depth rejects '+value,()=>{
  assert.throws(()=>nativeGoSubLimit(value),/maxGoSubDepth/);
  assert.throws(()=>compileWin32(project('Sub Main()\nEnd Sub'),{maxGoSubDepth:value}),/maxGoSubDepth/);
});
test('native GoSub budget is configurable per compiler instance',()=>{
  const code='Sub Main()\nGoSub Work\nExit Sub\nWork:\nReturn\nEnd Sub';
  assert.equal(compileWin32(project(code),{maxGoSubDepth:8}).report.controlFlow.maxGoSubDepth,8);
  assert.equal(compileWin32(project(code)).report.controlFlow.maxGoSubDepth,1024);
});
for(const [body,pattern]of [
  ['With 1\nEnd With',/POD record/],
  ['Dim x As Long\nWith x\n.x=1\nEnd With',/POD record/]
])test('unsupported With receivers stay diagnosed: '+body,()=>assert.throws(()=>compileWin32(project('Sub Main()\n'+body+'\nEnd Sub')),pattern));
for(const call of ['Trim$()','LTrim$(1,2)','RTrim$()','StrReverse(1,2)','LCase$()','UCase$()','StrComp("x")'])test('native String arity: '+call,()=>assert.throws(()=>compileWin32(project('Sub Main()\n'+call+'\nEnd Sub')),/expects/));
