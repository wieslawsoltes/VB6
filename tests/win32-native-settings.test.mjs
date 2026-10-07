import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import {parseWin32Options,buildWin32} from '../tools/build-win32.mjs';
import {compileWin32} from '../src/native/compiler.js';
import {nativeLanguageFixture} from './fixtures/native-language.mjs';

test('GoSub CLI budgets are validated before any file build',()=>{
  for(const n of [1,8,1024,65536])assert.equal(parseWin32Options(['--max-gosub-depth',String(n)]).maxGoSubDepth,n);
  for(const n of ['0','-1','1.5','65537','NaN','Infinity','9007199254740993','1e2','0x10'])assert.throws(()=>parseWin32Options(['--max-gosub-depth',n]),/GoSubDepth|gosub-depth/);
  assert.throws(()=>parseWin32Options(['--max-gosub-depth']),/Missing/);
  for(const key of ['constructor','toString','__proto__'])assert.throws(()=>parseWin32Options([key,'ignored']),/Unknown/);
});

test('file builds retain the requested optimization and GoSub resource budget',async t=>{
  const root=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-native-settings-'));
  t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const project=nativeLanguageFixture().project;project.modules[0].code='Sub Main()\nGoSub Work\nExit Sub\nWork:\nReturn\nEnd Sub';
  const input=path.join(root,'project.vb6web');await fs.writeFile(input,JSON.stringify(project));
  const options=parseWin32Options(['--project',input,'--out',path.join(root,'out'),'--optimization','2','--max-gosub-depth','8']);
  const result=await buildWin32(options);
  assert.equal(result.optimization.level,2);assert.equal(result.controlFlow.maxGoSubDepth,8);
  const report=JSON.parse(await fs.readFile(path.join(root,'out',project.name+'.build.json'),'utf8'));
  assert.equal(report.controlFlow.maxGoSubDepth,8);assert.equal(report.sha256,result.sha256);
  assert.deepEqual(Array.from(await fs.readFile(result.filename)),Array.from(compileWin32(project,{optimization:2,maxGoSubDepth:8}).bytes));
});

test('standalone browser SDK compiles expanded native semantics byte-identically at all levels',async()=>{
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,DataView,ArrayBuffer,structuredClone,console});
  vm.runInContext(await fs.readFile(new URL('../dist/vb6-native.js',import.meta.url),'utf8'),context);
  const project=nativeLanguageFixture().project;
  for(const optimization of [0,1,2]){
    const browser=context.VB6Native.compileWin32(project,{optimization}),esm=compileWin32(project,{optimization});
    assert.deepEqual(Array.from(browser.bytes),Array.from(esm.bytes));
    assert.equal(browser.report.controlFlow.maxGoSubDepth,1024);
    assert.deepEqual(JSON.parse(JSON.stringify(browser.report.optimization)),esm.report.optimization);
  }
});
