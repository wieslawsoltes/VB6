import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {win32Example} from '../src/project/win32-example.js';
const fixture=readFileSync(new URL('./fixtures/win32-regions.bas',import.meta.url),'utf8');
async function execute(t,code){const compiled=compileProject({name:'Regions',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code}]});assert.deepEqual(compiled.diagnostics,[]);const output=[],vm=new VirtualMachine(compiled,{print:s=>output.push(s)});t.after(()=>vm.stop());await vm.start();assert.equal(vm.lastError,null,vm.lastError?.message);return {vm,output};}
test('VB6 region Declare calls roundtrip RGNDATA byte arrays and RECT UDT output',async t=>{
 const {vm,output}=await execute(t,fixture);assert.deepEqual(output,['3','0 1','96 96','1','3','3 -10 20 -2 28']);assert.equal(vm.win32.api.memory.used,0);assert.equal([...vm.win32.api.handles.entries.values()].filter(e=>e.type==='region').length,0);
});
test('VB6 region errors expose LastDLLError and preserve the destination',async t=>{
 const code=fixture.replace('    DeleteObject a','    Debug.Print CombineRgn(a, a, b, 9); Err.LastDLLError\n    Debug.Print PtInRegion(a, 7, 7)\n    DeleteObject a');const {vm,output}=await execute(t,code);assert.deepEqual(output.slice(-2),['0 87','1']);assert.equal(vm.win32.api.memory.used,0);
});
test('classic Win32 example compiles the copied complex clipping workflow',()=>{
 const p=win32Example(),compiled=compileProject(p);assert.deepEqual(compiled.diagnostics,[]);assert.ok(p.modules[0].form.controls.some(c=>c.name==='cmdRegions'));assert.match(p.modules[0].code,/SelectClipRgn\(target, outer\)/);assert.match(p.modules[0].code,/DeleteObject outer/);
});
