import test from 'node:test';import assert from 'node:assert/strict';
import {PE32Image} from '../src/native/pe32.js';import {X86} from '../src/native/x86.js';
import {NativeX86FloatingMachine,roundEven} from './support/native-x86-floating.mjs';
function machine(body){const image=new PE32Image(),code=image.section('.text',0x60000020),data=image.section('.data',0xc0000040);data.label('out').zero(16);const x=new X86(code,image);x.label('entry').enter(16);body(x);x.value(0).leave(4);x.api('kernel32.dll','ExitProcess',[0]);return new NativeX86FloatingMachine(image.finish('entry'));}
function bits(vm,n){const at=vm.memory.alloc(8,'test-double');vm.writeFP(at,n);return at;}
test('test x87 extension executes signed FILD and width-specific stores',()=>{
 const vm=machine(x=>x.emit(0xdb,0x45,8,0xdd,0x1d).addr('out'));
 for(const value of [-2147483648,-1,0,2147483647]){vm.invoke('entry',[value]);assert.equal(vm.readFP(vm.symbol('out')),value);}
});
test('test x87 extension rounds an explicit binary32 store before reloading',()=>{
 const vm=machine(x=>x.value({argument:8}).emit(0xdd,0x00,0xd9,0x5d,0xfc,0xd9,0x45,0xfc,0xdd,0x1d).addr('out'));
 for(const value of [1/3,-1/3,16777217,1e-40]){vm.invoke('entry',[bits(vm,value)]);assert.equal(vm.readFP(vm.symbol('out')),Math.fround(value));}
});
for(const [op,expected]of [[0xc1,8.5],[0xe9,4.5],[0xc9,13],[0xf9,3.25]])test('test x87 binary operand order opcode '+op.toString(16),()=>{
 const vm=machine(x=>x.value({argument:8}).emit(0xdd,0x00,0xdd,0x40,8,0xde,op,0xdd,0x1d).addr('out'));
 const at=vm.memory.alloc(16,'test-operands');vm.writeFP(at,6.5);vm.writeFP(at+8,2);vm.invoke('entry',[at]);assert.equal(vm.readFP(vm.symbol('out')),expected);
});
test('test Automation integer oracle uses ties-to-even for both signs',()=>{
 assert.deepEqual([-2.5,-1.5,-0.5,0.5,1.5,2.5,2.9].map(roundEven),[-2,-2,0,0,2,2,3]);
});
test('test x87 unknown instructions cannot silently emulate success',()=>{
 const vm=machine(x=>x.emit(0xd9,0xff));assert.throws(()=>vm.invoke('entry',[0]),/unsupported x87/);
});
