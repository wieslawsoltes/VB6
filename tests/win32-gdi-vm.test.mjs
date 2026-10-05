import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
const fixture=readFileSync(new URL('./fixtures/win32-gdi.bas',import.meta.url),'utf8');
const project=code=>({id:'gdi-bitmap',name:'GDI Bitmap',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code}]});
async function execute(t,code){const compiled=compileProject(project(code));assert.deepEqual(compiled.diagnostics,[]);const out=[],vm=new VirtualMachine(compiled,{print:s=>out.push(s)});t.after(()=>vm.stop());await vm.start();assert.equal(vm.lastError,null,vm.lastError?.message);return {vm,out};}
test('VB6 DIB UDT, raw pointer and array marshaling run ordinary bitmap and blit declarations',async t=>{
  const {vm,out}=await execute(t,fixture);
  assert.deepEqual(out,['255 65280 16711680 16777215','1','16711680 16711680 255 255','-1','0 50']);
  assert.equal(vm.win32.api.memory.used,0);assert.equal(vm.win32.api.handles.entries.size,6);
});
test('VB6 packed BLENDFUNCTION reaches msimg32 without ByVal structure emulation',async t=>{
  const code=fixture.replace('    Debug.Print GetPixel(dc, -1, 0)',`    pixels(0) = &H80800000
    pixels(1) = &HFF000000
    CopyMemory ByVal bits, pixels(0), 8
    Debug.Print AlphaBlend(dc, 1, 0, 1, 1, dc, 0, 0, 1, 1, &H1FF0000)
    Debug.Print GetPixel(dc, 1, 0)
    Debug.Print GetPixel(dc, -1, 0)`);
  const {vm,out}=await execute(t,code);assert.deepEqual(out.slice(3,6),['1','128','-1']);assert.equal(vm.win32.api.memory.used,0);
});
test('VB6 sees read-only hDC as a public control member but not private backing data',async t=>{
  const {vm}=await execute(t,fixture),control={__control:true};Object.defineProperty(control,'hDC',{get:()=>123});Object.defineProperty(control,'_gdiDC',{value:456});
  assert.equal(await vm.getMember(control,'Hdc'),123);assert.throws(()=>vm.nativeKey(control,'_gdiDC'),e=>e.number===438);assert.equal(Reflect.set(control,'hDC',55),false);
});
