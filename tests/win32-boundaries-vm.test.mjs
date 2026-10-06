import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
const code=readFileSync(new URL('./fixtures/win32-boundaries.bas',import.meta.url),'utf8');
test('ordinary VB Declare XFORM/POINT marshalling, paths and curved regions execute without leaked buffers',async t=>{
 const compiled=compileProject({id:'boundaries',name:'GDI boundaries',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code}]});
 assert.deepEqual(compiled.diagnostics,[]);const output=[],vm=new VirtualMachine(compiled,{print:s=>output.push(s)});t.after(()=>vm.stop());await vm.start();assert.equal(vm.lastError,null,vm.lastError?.message);
 assert.deepEqual(output,['1 1','1 16 26','1 0','1 0','1']);assert.equal(vm.win32.api.memory.used,0);assert.equal(vm.win32.api.handles.entries.size,6);
});
