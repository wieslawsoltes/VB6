import test from 'node:test';
import assert from 'node:assert/strict';
import {BinarySection,PE32Image} from '../src/native/pe32.js';
import {X86} from '../src/native/x86.js';
import {mem8,mem16,mem32,mem64,mem128} from '../src/native/x86-operands.js';
const make=()=>{const s=new BinarySection('.text',0x60000020);return {s,x:new X86(s,new PE32Image())};};
for(const [name,fn,want]of [
 ['inc byte',x=>x.inc(mem8({base:'eax'})),'fe00'],['dec word',x=>x.dec('ax'),'66ffc8'],
 ['bswap',x=>x.bswap('edi'),'0fcf'],['bsf',x=>x.bsf('dx',mem16({base:'ebx'})),'660fbc13'],
 ['bit immediate',x=>x.bit('btc','eax',31),'0fbaf81f'],['bit register',x=>x.bit('bts',mem32({base:'eax'}),'ecx'),'0fab08'],
 ['shld',x=>x.doubleShift('shld','eax','edx',3),'0fa4d003'],['shrd',x=>x.doubleShift('shrd','ax','dx','cl'),'660fadd0'],
 ['movd',x=>x.movd('xmm3','edx'),'660f6eda'],['movd store',x=>x.movd('edx','xmm3'),'660f7eda'],
 ['movq',x=>x.movq('xmm1','xmm7'),'f30f7ecf'],['movq store',x=>x.movq(mem64({base:'eax'}),'xmm1'),'660fd608'],
 ['ldmxcsr',x=>x.ldmxcsr(mem32({base:'eax'})),'0fae10'],['stmxcsr',x=>x.stmxcsr(mem32({base:'eax'})),'0fae18'],
 ['unaligned packed add',x=>x.sseUnaligned('paddd','xmm4',mem128({base:'edi'}),'xmm5'),'f30f6f2f660ffee5']
])test(name,()=>{const {s,x}=make();fn(x);assert.equal(Buffer.from(s.bytes).toString('hex'),want);});
test('additional instructions validate all operands before emission',()=>{
 for(const fn of [x=>x.bswap('ax'),x=>x.inc(mem64()),x=>x.bsr('eax','ax'),x=>x.bit('constructor','eax',0),x=>x.bit('bt','eax',256),x=>x.doubleShift('shld','ax','edx',1),x=>x.doubleShift('shrd','eax','edx',-1),x=>x.movd('xmm8','eax'),x=>x.movq('xmm1',mem32()),x=>x.ldmxcsr(mem64()),x=>x.sseUnaligned('paddd','xmm1',mem128({label:'data'}),'xmm1'),x=>x.sseUnaligned('movdqu','xmm1',mem128(),'xmm2'),x=>x.sseUnaligned('addsd','xmm1',mem64(),'xmm2'),x=>x.sseUnaligned('paddd','xmm1',mem128(),'xmm9')]){
  const {s,x}=make();assert.throws(()=>fn(x));assert.equal(s.length,0);assert.equal(s.fixups.length,0);
 }
});
test('unaligned helper retains symbolic memory relocation in its load only',()=>{
 const {s,x}=make();x.sseUnaligned('paddd','xmm4',mem128({label:'packed',displacement:12}),'xmm5');
 assert.deepEqual(s.fixups,[{offset:4,label:'packed',kind:'va',addend:12}]);
});
