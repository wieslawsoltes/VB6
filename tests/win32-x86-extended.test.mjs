import test from 'node:test';
import assert from 'node:assert/strict';
import {X86} from '../src/native/x86.js';
import {BinarySection,PE32Image} from '../src/native/pe32.js';
import {mem16,mem32,mem64,mem80,mem128} from '../src/native/x86-operands.js';
import {X86_SIMD_INSTRUCTIONS} from '../src/native/x86-extended.js';
const fixture=()=>{const s=new BinarySection('.text',0x60000020);return {s,x:new X86(s,new PE32Image())};};
for(const [name,encode,expected]of [
 ['x87 load/store/convert',x=>x.fld(mem80({base:'eax'})).fstp(mem64({base:'ebp',displacement:-8})).fild(mem16({base:'esp'})),[0xdb,0x28,0xdd,0x5d,0xf8,0xdf,0x04,0x24]],
 ['x87 stack and rounding',x=>x.fld(2).fxch(7).fsubp(3).fdivrp(4).fnstcw(mem16({base:'edi'})).fldcw(mem16({base:'edi'})),[0xd9,0xc2,0xd9,0xcf,0xde,0xeb,0xde,0xf4,0xd9,0x3f,0xd9,0x2f]],
 ['SSE2 memory widths',x=>x.sse('movsd','xmm3',mem64({base:'ebp',displacement:-8})).sse('addsd','xmm3','xmm7').sse('movdqu',mem128({base:'eax'}),'xmm3'),[0xf2,0x0f,0x10,0x5d,0xf8,0xf2,0x0f,0x58,0xdf,0xf3,0x0f,0x7f,0x18]],
 ['SSE conversions and shifts',x=>x.sseConvert('cvtsi2sd','xmm7','eax').sseConvert('cvttsd2si','ecx','xmm7').sseShift('pslldq','xmm6',8),[0xf2,0x0f,0x2a,0xf8,0xf2,0x0f,0x2c,0xcf,0x66,0x0f,0x73,0xfe,8]],
 ['atomic shared storage',x=>x.atomic('xadd',mem32({base:'esi'}),'eax').atomic('cmpxchg',mem16({base:'edi'}),'dx').cmpxchg8b(mem64({base:'ebx'})),[0xf0,0x0f,0xc1,0x06,0xf0,0x66,0x0f,0xb1,0x17,0xf0,0x0f,0xc7,0x0b]]
])test(name,()=>{const {s,x}=fixture();encode(x);assert.deepEqual(s.bytes,expected);});
for(const invalid of [x=>x.fld(8),x=>x.fld(-1),x=>x.fld(mem16({})),x=>x.fst(mem80({})),x=>x.fist(mem64({})),x=>x.fcompare(1,{pop:1}),x=>x.fnstsw('eax'),x=>x.x87Unary('constructor'),x=>x.fldConstant('pi2'),x=>x.sse('movsd','xmm8','xmm1'),x=>x.sse('addsd',mem64({}),'xmm1'),x=>x.sse('movss','xmm1',mem64({})),x=>x.sse('movaps','eax','xmm1'),x=>x.sse('constructor','xmm1','xmm2'),x=>x.sseCompare('ss','xmm1','xmm2',8),x=>x.sseConvert('cvtsi2sd','xmm1','ax'),x=>x.sseConvert('cvttsd2si','xmm1','xmm2'),x=>x.sseShift('pslld',mem128({}),4),x=>x.sseShift('pslld','xmm1',256),x=>x.atomic('xadd','eax','edx'),x=>x.atomic('xadd',mem64({}),'edx'),x=>x.atomic('cmpxchg',mem16({}),'edx'),x=>x.cmpxchg8b(mem32({}))])test('invalid extended operands emit nothing: '+invalid.toString(),()=>{const {s,x}=fixture();assert.throws(()=>invalid(x));assert.equal(s.length,0);assert.equal(s.fixups.length,0);});
test('SSE registry is immutable and contains scalar, packed and integer forms',()=>{assert.ok(Object.isFrozen(X86_SIMD_INSTRUCTIONS));for(const name of ['addss','divsd','sqrtpd','paddq','movdqu','cvtsd2ss'])assert.ok(X86_SIMD_INSTRUCTIONS.includes(name));});
