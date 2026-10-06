import test from 'node:test';
import assert from 'node:assert/strict';
import {parseRegisters} from '../packages/native-debugger/src/protocol.mjs';

test('CDB x86 register rows preserve segments and flags',()=>{
  assert.deepEqual(parseRegisters('eax=00000006 ebx=00726000\r\neip=00fe71c4 esp=008ff83c ebp=008ff840 iopl=0 nv up ei pl nz na po nc\r\ncs=0023 ss=002b ds=002b es=002b fs=0053 gs=002b efl=00000202'),{
    eax:'0x6',ebx:'0x726000',eip:'0xfe71c4',esp:'0x8ff83c',ebp:'0x8ff840',iopl:'0x0',cs:'0x23',ss:'0x2b',ds:'0x2b',es:'0x2b',fs:'0x53',gs:'0x2b',efl:'0x202'
  });
});

test('CDB x64 register rows accept case, tabs and split hexadecimal words',()=>{
  assert.deepEqual(parseRegisters('RAX=FFFFFFFF`FFFFFFFF\tRIP=00007FF7`5FA37250\r\n r8=000000ba`a04ff0b8 r9=00000000`00000000 r10=0 r15=00000001 efl=00000244'),{
    rax:'0xffffffffffffffff',rip:'0x7ff75fa37250',r8:'0xbaa04ff0b8',r9:'0x0',r10:'0x0',r15:'0x1',efl:'0x244'
  });
});

test('CDB disassembly memory operands are not phantom register names',()=>{
  // Reduced from the real x64 Windows artifact: the low word begins with a
  // letter, and the former word-boundary parser treated it as a register.
  const text='rax=0000000000000008 rip=00007ff7`5fa37250\nDebugTarget!DebugTick:\n00007ff7`5fa37250 48894c2408 mov qword ptr [rsp+8],rcx ss:002b:000000ba`a04ff1c0=0000000000000000\n'+
    '00007ff7`5fa37260 90 nop ds:002b:deadbeef=00000000';
  assert.deepEqual(parseRegisters(text),{rax:'0x8',rip:'0x7ff75fa37250'});
});

test('CDB register parsing rejects unknown labels and malformed values',()=>{
  assert.deepEqual(parseRegisters('constructor=deadbeef fake=abcd xmm0=00112233445566778899aabbccddeeff\nrax=1g rbx=1`2`3 rcx=00000000000000001 rdx=1;g\nrip=00007ff6`12345678'),{rip:'0x7ff612345678'});
});
