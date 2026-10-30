import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {pascalNativeVerificationProject,pascalNativeExpectedResult} from './pascal-integration-fixtures.mjs';

function machine(project=pascalNativeVerificationProject()) {
  const program=compileProject(project);assert.deepEqual(program.diagnostics,[]);
  return new VirtualMachine(program,{});
}

test('required native fixture executes typed VB classes, properties, records and held ByRef borrows before success',async()=>{
  const vm=machine();await vm.start();
  assert.equal(vm.fs.read('/pascal-native-result.txt').trim(),pascalNativeExpectedResult);
  assert.equal(vm.fs.read('/pascal-native.txt'),'  42\r\n');
  assert.deepEqual([...vm.fs.readBytes('/pascal-native.dat')],[255,255,129,0,0,0,0,64]);
});

for(const [name,module,from,to]of [
  ['class method','NativeBridgeCounter','Value = Value + Amount','Value = Value - Amount'],
  ['held borrow','NativeBridge','ReadBorrow = Status * 1000 + UBound(Values) * 100 + Value','ReadBorrow = 0']
])test('required native fixture refuses success after an incorrect '+name+' result',async()=>{
  const project=pascalNativeVerificationProject(),input=project.modules.find(value=>value.name===module);
  assert.ok(input.code.includes(from));input.code=input.code.replace(from,to);
  const vm=machine(project);
  await assert.rejects(()=>vm.start(),error=>error.number===5&&/Typed Visual Basic interop failed/.test(error.message));
  assert.equal(vm.fs.exists('/pascal-native-result.txt'),false);
});
