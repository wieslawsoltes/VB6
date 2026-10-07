import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {compileWin32} from '../src/native/compiler.js';
import {optimizerFixture,assemblerFixture} from '../tools/win32-optimizer-fixtures.mjs';
import {parseWin32Options} from '../tools/build-win32.mjs';
test('O0/O1/O2 compile deterministic records/error fixtures with stable source identities',()=>{
  const {project}=optimizerFixture(),results=[0,1,2].map(optimization=>compileWin32(project,{optimization}));
  for(const [i,r]of results.entries()){
    assert.equal(r.report.optimization.level,i);assert.deepEqual(r.bytes,compileWin32(project,{optimization:i}).bytes);
    const text=r.report.sections.find(s=>s.name==='.text');for(const map of r.report.sourceMap)assert.ok(map.rva>=text.rva&&map.rva<text.rva+text.size);
    assert.deepEqual(r.report.sourceMap.map(({rva,...s})=>s),results[0].report.sourceMap.map(({rva,...s})=>s));
    assert.deepEqual(r.report.imports,results[0].report.imports);
  }
  const size=r=>r.report.sections.find(s=>s.name==='.text').size;assert.ok(size(results[1])<size(results[0]));assert.ok(size(results[2])<size(results[1]));
  assert.ok(results[2].report.optimization.constantsFolded>0);assert.ok(results[2].report.optimization.immediateOperations>0);
});
test('assembler execution fixtures link in all optimization modes',()=>{for(const optimization of [0,1,2]){const r=assemblerFixture(optimization);assert.equal(r.report.optimization.level,optimization);assert.ok(r.checks.length>=20);assert.equal(r.bytes[0],0x4d);assert.equal(r.bytes[1],0x5a);}});
test('CLI accepts explicit optimization and compiler rejects invalid options before lowering',()=>{
  assert.equal(parseWin32Options(['--optimization','2']).optimization,'2');assert.throws(()=>parseWin32Options(['--optimization']),/Missing/);
  for(const optimization of [3,'fast',null,false])assert.throws(()=>compileWin32(optimizerFixture().project,{optimization}),/optimization/);
});
test('standalone browser SDK exports checked operands and compiles identical optimized PE bytes',()=>{
  const context=vm.createContext({TextEncoder,TextDecoder,Uint8Array,Uint16Array,Uint32Array,DataView,ArrayBuffer,structuredClone,console});
  vm.runInContext(fs.readFileSync(new URL('../dist/vb6-native.js',import.meta.url),'utf8'),context);
  const sdk=context.VB6Native;assert.ok(sdk);assert.equal(typeof sdk.mem64,'function');assert.equal(typeof sdk.X86.prototype.sse,'function');
  const project=optimizerFixture().project;const browser=sdk.compileWin32(project,{optimization:2}),esm=compileWin32(project,{optimization:2});assert.deepEqual(Array.from(browser.bytes),Array.from(esm.bytes));
});

test('Single literal overflow remains a diagnostic in every optimization mode',()=>{for(const optimization of [0,1,2]){const p=optimizerFixture().project;p.modules[0].code='Sub Main()\nDim x As Single\nx=1E40!\nEnd Sub';assert.throws(()=>compileWin32(p,{optimization}),/finite/);}});
