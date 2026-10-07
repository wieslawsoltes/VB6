import test from 'node:test';
import assert from 'node:assert/strict';
import {PE32Image,BinarySection,PE32_BASE} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {foldNativeInteger,optimizeNativeSections,nativeOptimizationLevel} from '../src/native/optimizer.js';
const literal=value=>({kind:'literal',value});
const binary=(op,a,b)=>({kind:'binary',op,left:literal(a),right:literal(b)});
const fixture=()=>{const image=new PE32Image(),s=image.section('.text',0x60000020),x=new X86(s,image);image.import('kernel32.dll','ExitProcess');return {image,s,x};};
const offset=(result,rva)=>{const s=result.sections.find(s=>rva>=s.rva&&rva<s.rva+s.size);assert.ok(s);return s.offset+rva-s.rva;};
for(const [v,expected]of [[undefined,1],[0,0],['O1',1],['2',2],['o0',0]])test('native optimization level '+v,()=>assert.equal(nativeOptimizationLevel(v),expected));
for(const v of [null,false,true,-1,3,'fast',NaN,1.5])test('invalid optimization level '+v,()=>assert.throws(()=>nativeOptimizationLevel(v)));
for(const [op,a,b,expected]of [['+',1,2,3],['*',-99,17,-1683],['\\',-7,2,-3],['mod',-7,2,-1],['=',2,2,-1],['<>',2,2,0],['and',3,5,1],['eqv',3,5,-7],['imp',3,5,-3]])test('integer fold '+[op,a,b],()=>assert.equal(foldNativeInteger(binary(op,a,b)).value,expected));
for(const node of [binary('+',2147483647,1),binary('*',2147483647,2),binary('\\',-2147483648,-1),binary('mod',7,0),binary('/',1,2),binary('+',1.5,2),binary('+','2',1),{kind:'binary',op:'*',left:{kind:'call',callee:{kind:'id',name:'SideEffect'},args:[]},right:literal(0)}])test('unsafe fold keeps original expression '+JSON.stringify(node),()=>assert.equal(foldNativeInteger(node),null));
test('folding rejects overflowing subexpressions even if a later operation would cancel',()=>assert.equal(foldNativeInteger({kind:'binary',op:'-',left:binary('+',2147483647,1),right:literal(1)}),null));
test('forward and backward conditional/unconditional branches link to exact labels',()=>{
 const {image,s,x}=fixture();x.label('entry').jump('next').nop(3).label('next').branch('ne','entry').ret();
 const result=image.finish('entry',{optimization:1}),v=new DataView(result.bytes.buffer),at=offset(result,result.symbols.entry);
 assert.equal(s.bytes[0],0xeb);assert.equal(v.getInt8(at+1),3);assert.equal(s.bytes[5],0x75);assert.equal(v.getInt8(at+6),-7);
 assert.equal(result.optimization.branchesShortened,2);assert.equal(result.optimization.bytesSaved,7);
});
for(const [distance,short]of [[127,true],[128,false]])test('forward signed-byte branch boundary '+distance,()=>{
 const {image,s,x}=fixture();x.label('entry').jump('end').nop(distance).label('end').ret();image.finish('entry',{optimization:1});assert.equal(s.bytes[0],short?0xeb:0xe9);
});
for(const [distance,short]of [[126,true],[127,false]])test('backward signed-byte branch boundary '+distance,()=>{
 const {image,s,x}=fixture();x.label('entry').nop(distance).jump('entry');image.finish('entry',{optimization:1});assert.equal(s.bytes[distance],short?0xeb:0xe9);
});
test('relaxation iterates to a fixed point when a preceding shrink enables another branch',()=>{
 const {image,s,x}=fixture();x.label('entry').jump('end').jump('end').nop(123).label('end').ret();
 const r=image.finish('entry',{optimization:1});assert.equal(r.optimization.branchesShortened,2);assert.equal(r.optimization.passes,2);assert.equal(s.length,128);
});
test('O2 removes fall-through branches but preserves both labels and their relocations',()=>{
 const {image,s,x}=fixture(),data=image.section('.data',0xc0000040);
 x.label('entry').branch('o','next').label('next').value('next').ret();data.label('address').reference('next');
 const r=image.finish('entry',{optimization:2});assert.equal(r.symbols.entry,r.symbols.next);assert.equal(s.bytes[0],0xb8);
 assert.equal(new DataView(r.bytes.buffer).getUint32(offset(r,r.symbols.address),true),PE32_BASE+r.symbols.next);
 assert.equal(r.optimization.fallthroughBranchesRemoved,1);
});
test('nonzero code-address addends are rebased, including pointers in other sections',()=>{
 const {image,x}=fixture(),data=image.section('.data',0xc0000040);
 x.label('entry').jump('end').nop(2).label('end').ret();data.label('pointer').reference('entry','va',7);
 const r=image.finish('entry',{optimization:1});assert.equal(new DataView(r.bytes.buffer).getUint32(offset(r,r.symbols.pointer),true),PE32_BASE+r.symbols.end);
});
test('an address into an instruction inhibits shortening',()=>{
 const {image,s,x}=fixture(),data=image.section('.data',0xc0000040);x.label('entry').jump('end').nop(2).label('end').ret();data.reference('entry','va',2);
 assert.equal(image.finish('entry',{optimization:2}).optimization.bytesSaved,0);assert.equal(s.bytes[0],0xe9);
});
test('raw untagged code and cross-section branches are left alone',()=>{
 const {image,s,x}=fixture(),other=image.section('.other',0x60000020);x.label('entry').emit(0xe9);s.reference('raw','rel');x.label('raw').jump('foreign');other.label('foreign').emit(0xc3);
 assert.equal(image.finish('entry',{optimization:2}).optimization.bytesSaved,0);
});
test('O0 preserves exact code bytes and original relative fixup widths',()=>{
 const {s,x}=fixture();x.label('entry').jump('end').label('end').ret();const bytes=[...s.bytes],fixups=structuredClone(s.fixups);
 assert.equal(optimizeNativeSections([s],0).bytesSaved,0);assert.deepEqual(s.bytes,bytes);assert.deepEqual(s.fixups,fixups);
});
test('short relocation range and malformed branch metadata fail explicitly',()=>{
 const {image,s,x}=fixture();x.label('entry').emit(0xeb);s.reference('end','rel8');x.nop(128).label('end').ret();assert.throws(()=>image.finish('entry'),/short branch/);
 const section=new BinarySection('.text',0x60000020);section.emit(0).reference('x','rel');section.fixups[0].branch=0xeb;assert.throws(()=>optimizeNativeSections([section]),/metadata/);
});

test('typed floating literals never enter integral constant folding',()=>{for(const valueType of ['single','double','currency','date','string'])assert.equal(foldNativeInteger({kind:'literal',value:1,valueType}),null);assert.equal(foldNativeInteger({kind:'unary',op:'-',expr:{kind:'literal',value:2147483648,valueType:'double'}}),null);});
