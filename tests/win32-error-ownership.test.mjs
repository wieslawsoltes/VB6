/** Instruction-level ownership checks, not a substitute for Windows execution.
 * The machine enforces freed-memory, readonly and callee-save contracts. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {PE32Image} from '../src/native/pe32.js';
import {NativeX86Machine} from './support/native-x86-machine.mjs';
function machine(t,source,optimization=0){
 let linked;const finish=PE32Image.prototype.finish;
 t.mock.method(PE32Image.prototype,'finish',function(...args){linked=finish.apply(this,args);return linked;});
 const result=compileWin32({...newProject('ErrorOwners'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:source}]},{optimization});
 const cpu=new NativeX86Machine(linked);
 // Exercise the emitted error-frame dispatch rather than the machine's usual
 // fail-fast error hook. Every foreign BSTR operation remains independently mocked.
 cpu.hooks.delete(cpu.symbol('native:error:raise'));
 const pointer=name=>cpu.memory.read(cpu.symbol('native:error:'+name));
 return {cpu,result,number:()=>pointer('number')|0,helpcontext:()=>pointer('helpcontext')|0,text:name=>cpu.memory.bstr(pointer(name)),live:()=>cpu.memory.regions.filter(r=>r.label==='BSTR').length};
}
for(const optimization of [0,1,2])test('error text escapes statement cleanup only through independent owners O'+optimization,t=>{
 const h=machine(t,'Sub Main()\nOn Error Resume Next\nErr.Raise 513,"source","detail","help.chm",72\nEnd Sub',optimization);
 h.cpu.invoke('proc:M:Main');assert.equal(h.number(),513);assert.equal(h.text('source'),'source');assert.equal(h.text('description'),'detail');assert.equal(h.text('helpfile'),'help.chm');assert.equal(h.helpcontext(),72);assert.equal(h.live(),3);
 h.cpu.invoke('native:error:clear');assert.equal(h.number(),0);assert.equal(h.helpcontext(),0);assert.equal(h.live(),0);
 for(const name of ['source','description','helpfile'])assert.equal(h.text(name),'');
});
test('clear and repeated replacement free exactly the old owners, never readonly literals',t=>{
 const h=machine(t,'Sub Main()\nOn Error Resume Next\nErr.Raise 513,"source","detail","help.chm",72\nErr.Raise 514\nEnd Sub');
 for(let i=0;i<40;i++){h.cpu.invoke('proc:M:Main');assert.equal(h.number(),514);assert.equal(h.live(),3);assert.equal(h.text('description'),'detail');}
 h.cpu.invoke('native:error:clear');assert.equal(h.live(),0);
});
test('typed Raise with String metadata needs no VARIANT creation or cleanup imports',t=>{
 const h=machine(t,'Sub Main()\nOn Error Resume Next\nErr.Raise 513,"source","detail"\nEnd Sub');
 for(const symbol of ['VariantClear','VariantCopyInd','VariantChangeTypeEx'])assert.ok(!h.result.report.imports.some(i=>i.symbol===symbol),symbol);
});
for(const failure of [1,2,3])test('failed allocation '+failure+' during staged metadata leaves no orphaned BSTR',t=>{
 const h=machine(t,'Sub Main()\nOn Error Resume Next\nErr.Raise 513,"source","detail","help.chm",72\nEnd Sub'),m=h.cpu.memory;let allocations=0;
 h.cpu.hook('oleaut32.dll','SysAllocStringLen',2,([source,count])=>{
  if(++allocations===failure)return 0;
  let text='';for(let i=0;i<count;i++)text+=String.fromCharCode(m.read(source+2*i,16));return m.string(text);
 });
 h.cpu.invoke('proc:M:Main');assert.equal(h.number(),7);assert.equal(h.text('description'),'Out of memory');assert.equal(h.live(),0);
 h.cpu.invoke('native:error:clear');assert.equal(h.live(),0);
});
test('ordinary error replaces rich owners and does not overwrite the caller return value',t=>{
 const h=machine(t,'Function Main() As Long\nOn Error Resume Next\nErr.Raise 513,"source","detail","help.chm",72\nErr.Raise 0\nMain=91\nEnd Function');
 assert.equal(h.cpu.invoke('proc:M:Main'),91);assert.equal(h.number(),5);assert.equal(h.text('description'),'Invalid procedure call or argument');assert.equal(h.text('helpfile'),'');assert.equal(h.helpcontext(),0);assert.equal(h.live(),0);
});
