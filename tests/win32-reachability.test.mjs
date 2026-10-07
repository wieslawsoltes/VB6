import test from 'node:test';
import assert from 'node:assert/strict';
import {pruneNativeProcedures} from '../src/native/reachability.js';
import {PE32Image,PE32_BASE} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {parseWin32Options} from '../tools/build-win32.mjs';
const fixture=()=>{const image=new PE32Image(),text=image.section('.text',0x60000020),x=new X86(text,image);image.import('kernel32.dll','ExitProcess');const unit=(name,body)=>{const start=text.length;x.label(name);body(x);x.ret();(text.codeUnits||=[]).push({name,start,end:text.length,closed:true});};return{image,text,x,unit};};
const mapped=(result,rva)=>{const s=result.sections.find(s=>rva>=s.rva&&rva<s.rva+s.size);assert.ok(s);return s.offset+rva-s.rva;};
test('reachability removes unused cycles but retains the entry call closure and checked branches',()=>{
 const {image,text,x,unit}=fixture();x.label('entry').call('main').ret();
 unit('deadA',x=>x.call('deadB'));unit('deadB',x=>x.call('deadA'));unit('main',x=>x.call('leaf'));unit('leaf',x=>x.value(42));
 const result=image.finish('entry',{optimization:2,pruneUnusedProcedures:true});
 assert.deepEqual(result.optimization.removedProcedures,['deadA','deadB']);assert.equal(result.optimization.procedureBytesSaved,12);
 for(const name of ['entry','main','leaf'])assert.ok(result.symbols[name]);for(const name of ['deadA','deadB'])assert.equal(result.symbols[name],undefined);
 const view=new DataView(result.bytes.buffer),call=mapped(result,result.symbols.entry);assert.equal(view.getInt32(call+1,true)+result.symbols.entry+5,result.symbols.main);
 assert.equal(text.codeUnits.length,2);assert.equal(pruneNativeProcedures(image.sections,['entry']).proceduresRemoved,0);
});
test('address-taken callbacks and their callees remain reachable through data relocations',()=>{
 const {image,x,unit}=fixture(),data=image.section('.data',0xc0000040);x.label('entry').ret();unit('dead',x=>x.nop(20));unit('callback',x=>x.call('leaf'));unit('leaf',x=>x.value(1));data.label('callbackPointer').reference('callback');
 const r=image.finish('entry',{optimization:2,pruneUnusedProcedures:true}),v=new DataView(r.bytes.buffer);
 assert.deepEqual(r.optimization.removedProcedures,['dead']);assert.equal(v.getUint32(mapped(r,r.symbols.callbackPointer),true),PE32_BASE+r.symbols.callback);
});
test('nonzero code address addends retain both bases and targets and rebase after removed gaps',()=>{
 const {image,text,x,unit}=fixture(),data=image.section('.data',0xc0000040);x.label('entry').ret();
 unit('base',x=>x.nop(2));unit('gap',x=>x.nop(50));unit('target',x=>x.nop(2));
 data.label('ptr').reference('base','va',text.labels.get('target')-text.labels.get('base')+1);
 const r=image.finish('entry',{optimization:2,pruneUnusedProcedures:true});assert.deepEqual(r.optimization.removedProcedures,['gap']);
 assert.equal(new DataView(r.bytes.buffer).getUint32(mapped(r,r.symbols.ptr),true),PE32_BASE+r.symbols.target+1);
});
test('unprovable out-of-section arithmetic inhibits pruning without mutation',()=>{
 const {image,text,x,unit}=fixture(),data=image.section('.data',0xc0000040);x.label('entry').ret();unit('dead',x=>x.nop());data.reference('entry','va',10000);const before=[...text.bytes];
 assert.equal(pruneNativeProcedures(image.sections,['entry']).pruningBlocked,true);assert.deepEqual(text.bytes,before);
});
test('malformed unit metadata, roots or split relocation fields are atomic failures',()=>{
 for(const alter of [t=>t.codeUnits[0].closed=false,t=>t.codeUnits[0].end+=1,t=>t.codeUnits[0].start=-1,t=>t.codeUnits.push({...t.codeUnits[0]}),t=>t.fixups.push({offset:0,label:'one',kind:'va',addend:0})]){
  const {image,text,x,unit}=fixture();x.label('entry').ret();unit('one',x=>x.nop(5));alter(text);const bytes=[...text.bytes];assert.throws(()=>pruneNativeProcedures(image.sections,['entry']));assert.deepEqual(text.bytes,bytes);
 }
 const {image,x}=fixture();x.label('entry').ret();assert.throws(()=>pruneNativeProcedures(image.sections,['missing']),/root/);
});
function project(code){const p=newProject('Reachability');p.startup='Sub Main';p.modules=[{id:'m',kind:'module',name:'Entry',code}];return p;}
test('compiler pruning is opt-in, reports optimized-out source locations and preserves diagnostics',()=>{
 const p=project('Sub Main()\nDim n As Long\nn=Used()\nEnd Sub\nPrivate Function Used() As Long\nUsed=1\nEnd Function\nPrivate Sub Unused()\nEnd Sub');
 const a=compileWin32(p,{optimization:2}),b=compileWin32(p,{optimization:2,pruneUnusedProcedures:true});
 assert.equal(a.report.optimization.proceduresRemoved,undefined);assert.equal(b.report.optimization.proceduresRemoved,1);
 assert.ok(b.report.sourceMap.filter(s=>s.procedure==='Unused').every(s=>s.optimizedOut&&s.rva===null));
 assert.ok(b.report.sourceMap.filter(s=>s.procedure!=='Unused').every(s=>!s.optimizedOut&&s.rva>0));
 assert.deepEqual(a.report.sourceMap.map(({rva,optimizedOut,...s})=>s),b.report.sourceMap.map(({rva,optimizedOut,...s})=>s));
 assert.deepEqual(b.bytes,compileWin32(p,{optimization:2,pruneUnusedProcedures:true}).bytes);
 assert.ok(b.report.sections.find(s=>s.name==='.text').size<a.report.sections.find(s=>s.name==='.text').size);
 assert.throws(()=>compileWin32(project('Sub Main()\nEnd Sub\nPrivate Sub Dead()\nDim x As Object\nEnd Sub'),{optimization:2,pruneUnusedProcedures:true}),/storage/);
 for(const options of [{optimization:0,pruneUnusedProcedures:true},{optimization:1,pruneUnusedProcedures:true},{optimization:2,pruneUnusedProcedures:'yes'}])assert.throws(()=>compileWin32(p,options),/pruneUnused/);
 assert.equal(parseWin32Options(['--optimization','2','--prune-unused-procedures']).pruneUnusedProcedures,true);
});
test('AddressOf callback thunks retain native target procedures while unrelated procedures disappear',()=>{
 const p=project('Private Declare Function EnumWindows Lib "user32" (ByVal callback As Long, ByVal p As Long) As Long\nSub Main()\nDim n As Long\nn=EnumWindows(AddressOf Callback,0)\nEnd Sub\nPublic Function Callback(ByVal h As Long,ByVal p As Long) As Long\nCallback=1\nEnd Function\nPrivate Sub Dead()\nEnd Sub');
 const r=compileWin32(p,{optimization:2,pruneUnusedProcedures:true}).report;
 assert.deepEqual(r.optimization.removedProcedures,['proc:Entry:Dead']);assert.equal(r.callbacks.length,1);assert.ok(r.callbacks[0].rva>0);
 assert.ok(r.sourceMap.filter(s=>s.procedure==='Callback').every(s=>s.rva>0&&!s.optimizedOut));
});
