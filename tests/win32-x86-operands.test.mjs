import test from 'node:test';
import assert from 'node:assert/strict';
import {X86} from '../src/native/x86.js';
import {BinarySection,PE32Image} from '../src/native/pe32.js';
import {mem8,mem16,mem32,mem64,mem80,mem128} from '../src/native/x86-operands.js';
const assembler=()=>{const s=new BinarySection('.text',0);return {s,x:new X86(s,new PE32Image())};};
const hex=fn=>{const {s,x}=assembler();fn(x);return Buffer.from(s.bytes).toString('hex');};
const cases=[
 ['register move',x=>x.mov('eax','ecx'),'8bc1'],
 ['word move',x=>x.mov('ax','cx'),'668bc1'],
 ['high byte register',x=>x.mov('ah','bl'),'8ae3'],
 ['ESP SIB',x=>x.mov('eax',mem32({base:'esp'})),'8b0424'],
 ['EBP zero displacement',x=>x.mov('eax',mem32({base:'ebp'})),'8b4500'],
 ['signed displacement',x=>x.mov('eax',mem32({base:'ebp',displacement:-128})),'8b4580'],
 ['large displacement',x=>x.mov('edx',mem32({base:'esi',displacement:128})),'8b9680000000'],
 ['scaled index',x=>x.mov('eax',mem32({base:'ebx',index:'esi',scale:4,displacement:8})),'8b44b308'],
 ['index without base',x=>x.mov('eax',mem32({index:'ecx',scale:8,displacement:16})),'8b04cd10000000'],
 ['absolute pointer',x=>x.mov('eax',mem32({displacement:0xffffffff})),'8b05ffffffff'],
 ['byte store',x=>x.mov(mem8({base:'edi'}),'ah'),'8827'],
 ['immediate memory',x=>x.mov(mem16({base:'ebp',displacement:-2}),0x1234),'66c745fe3412'],
 ['address',x=>x.lea('edx',mem32({base:'esp',displacement:20})),'8d542414'],
 ['zero extension',x=>x.movzx('ecx',mem8({base:'eax'})),'0fb608'],
 ['sign extension',x=>x.movsx('edx',mem16({base:'ebx'})),'0fbf13'],
 ['short immediate arithmetic',x=>x.add('eax',127),'83c07f'],
 ['wide immediate arithmetic',x=>x.sub('ecx',128),'81e980000000'],
 ['unsigned sign-extension equivalence',x=>x.and('eax',0xffffffff),'83e0ff'],
 ['carry',x=>x.adc('edx','ebx'),'13d3'],
 ['borrow',x=>x.sbb('edx',0),'83da00'],
 ['test immediate',x=>x.testOperand('eax',0xffff),'f7c0ffff0000'],
 ['multiply one operand',x=>x.imul('ecx'),'f7e9'],
 ['multiply two operands',x=>x.imul('eax','edx'),'0fafc2'],
 ['multiply immediate',x=>x.imul('eax','edx',-7),'6bc2f9'],
 ['divide',x=>x.idiv('ecx'),'f7f9'],
 ['shift one',x=>x.shift('sar','eax',1),'d1f8'],
 ['shift CL',x=>x.shift('shl','edx','cl'),'d3e2'],
 ['rotate',x=>x.shift('ror','ax',7),'66c1c807'],
 ['setcc aliases',x=>x.setcc('nz','al'),'0f95c0'],
 ['cmov',x=>x.cmovcc('le','edx','ecx'),'0f4ed1'],
 ['push immediate',x=>x.pushOperand(-1),'6aff'],
 ['push preserves EAX',x=>x.pushOperand('edi'),'57'],
 ['indirect call',x=>x.callIndirect(mem32({base:'edx',displacement:12})),'ff520c'],
 ['indirect jump',x=>x.jumpIndirect('eax'),'ffe0'],
 ['rep word copy',x=>x.cld().repMove(16),'fcf366a5'],
 ['ret cleanup',x=>x.ret(65535),'c2ffff']
];
for(const [name,encode,expected]of cases)test('checked x86 '+name,()=>assert.equal(hex(encode),expected));
test('symbolic ModR/M and SIB memory preserve absolute relocation addends',()=>{
 const {s,x}=assembler();x.mov('edx',mem32({base:'ebx',index:'esi',scale:4,label:'table',displacement:12}));
 assert.equal(Buffer.from(s.bytes).toString('hex'),'8b94b300000000');
 assert.deepEqual(s.fixups,[{offset:3,label:'table',kind:'va',addend:12}]);
});
test('invalid instruction operands fail before emitting bytes or relocations',()=>{
 const invalid=[x=>x.mov('rax',1),x=>x.mov('eax','ax'),x=>x.mov(mem32({base:'eax'}),mem32({base:'ecx'})),x=>x.mov('al',256),x=>x.movzx('eax','ebx'),x=>x.imul('al','cl'),x=>x.shift('bad','eax',1),x=>x.shift('sar','eax',-1),x=>x.setcc('toString','al'),x=>x.callIndirect('al'),x=>x.enter(-1),x=>x.enter(Infinity),x=>x.leave(65536),x=>x.ret(-1)];
 for(const fn of invalid){const {s,x}=assembler();assert.throws(()=>fn(x));assert.equal(s.length,0);assert.equal(s.fixups.length,0);}
});
test('invalid SIB/scale/displacement memory is rejected',()=>{
 for(const options of [{index:'esp'},{base:'rax'},{scale:4},{index:'eax',scale:3},{displacement:NaN},{base:'ebp',displacement:0xffffffff},{offset:3},{label:''}])assert.throws(()=>mem32(options));
 for(const [make,width]of [[mem8,8],[mem16,16],[mem32,32],[mem64,64],[mem80,80],[mem128,128]])assert.equal(make().width,width);
});
test('cdecl caller cleanup uses flag-preserving LEA and keeps stdcall API unchanged',()=>{
 const {s,x}=assembler();x.cdecl('msvcrt.dll','abs',[7]);assert.equal(Buffer.from(s.bytes).subarray(-4).toString('hex'),'8d642404');
});

test('legacy assembler validation is atomic without changing push EAX semantics',()=>{
 for(const emit of [x=>x.value(NaN),x=>x.value(null),x=>x.value({memory:'v',addend:NaN}),x=>x.local(Infinity),x=>x.compare(1.5),x=>x.call(''),x=>x.jump(null),x=>x.branch('e',''),x=>x.store('value',NaN),x=>x.api('kernel32.dll','ExitProcess',[NaN,0]),x=>x.api('invalid','ExitProcess',[1]),x=>x.enter(-1),x=>x.leave(65536)]){
  const image=new PE32Image(),s=image.section('.text',0x60000020),x=new X86(s,image);
  assert.throws(()=>emit(x));assert.equal(s.length,0);assert.equal(s.fixups.length,0);assert.equal(image.imports.size,0);
 }
});
