import test from 'node:test';
import assert from 'node:assert/strict';
import {validatePascalNativeExecutionProof,pascalNativeNegativeCases} from '../tools/pascal-native-proof.mjs';
import {pascalNativeExpectedResult} from './pascal-integration-fixtures.mjs';
import {nativeRecordIdentityCases} from './native-record-identity-fixtures.mjs';

function fixture(platform='darwin',architecture='arm64',toolkit) {
  const manifest={abi:5,sha256:'a'.repeat(64)},target={platform,architecture,...(toolkit?{toolkit}:{})};
  const proof={...target,hostArchitecture:architecture,executionMode:'native',runtimeSHA256:manifest.sha256,valid:true,
    checks:[...[0,2].map(optimization=>({optimization,executed:true,executableSHA256:'b'.repeat(64),bytes:4096,result:pascalNativeExpectedResult})),
      ...pascalNativeNegativeCases.map(name=>({name,optimization:2,executed:true,rejected:true,executableSHA256:'c'.repeat(64),bytes:4096}))],
    recordIdentityChecks:nativeRecordIdentityCases().flatMap(fixture=>[0,2].map(optimization=>({
      name:fixture.name,optimization,executed:true,result:'passed',executableSHA256:'d'.repeat(64),bytes:4096,output:fixture.expectedOutput.slice()
    })))};
  return {proof,manifest,target};
}
test('refresh proof accepts complete Apple Silicon and all native Linux variants',()=>{
  for(const target of [['darwin','arm64'],...['x64','arm64'].flatMap(arch=>['gtk3','gtk4'].map(toolkit=>['linux',arch,toolkit]))]) {
    const {proof,manifest,target:expected}=fixture(...target);
    const verified=validatePascalNativeExecutionProof(proof,manifest,expected);
    assert.equal(verified.pascalChecks,9);assert.equal(verified.recordIdentityChecks,12);
  }
});
test('ABI 5 refresh requires every record identity case at both optimization levels',()=>{
  for(const mutate of [
    p=>delete p.recordIdentityChecks,p=>p.recordIdentityChecks.pop(),p=>p.recordIdentityChecks.push({...p.recordIdentityChecks[0]}),
    p=>p.recordIdentityChecks[0].name='unknown',p=>p.recordIdentityChecks[0].optimization=2,
    p=>p.recordIdentityChecks[0].executed=false,p=>p.recordIdentityChecks[0].result='failed',
    p=>p.recordIdentityChecks[0].executableSHA256='invalid',p=>p.recordIdentityChecks[0].bytes=0,
    p=>p.recordIdentityChecks[0].output=[],p=>p.recordIdentityChecks[0].output[0]='wrong identity',
    p=>p.recordIdentityChecks[0].output='wrong shape'
  ]) {
    const {proof,manifest,target}=fixture();mutate(proof);
    assert.throws(()=>validatePascalNativeExecutionProof(proof,manifest,target),/record identity/);
  }
});
test('prior ABI proof retains its original Pascal execution contract',()=>{
  const {proof,manifest,target}=fixture();manifest.abi=4;delete proof.recordIdentityChecks;
  const verified=validatePascalNativeExecutionProof(proof,manifest,target);
  assert.equal(verified.pascalChecks,9);assert.equal(verified.recordIdentityChecks,undefined);
});
test('refresh proof binds native execution to the exact runtime and target',()=>{
  for(const mutate of [
    p=>p.runtimeSHA256='d'.repeat(64),p=>p.hostArchitecture='x64',p=>p.executionMode='qemu-user',
    p=>p.platform='linux',p=>p.architecture='x64',p=>p.toolkit='gtk4',p=>p.valid=false,p=>p.error='failed'
  ]) {
    const {proof,manifest,target}=fixture();mutate(proof);
    assert.throws(()=>validatePascalNativeExecutionProof(proof,manifest,target),/complete native Pascal proof/);
  }
});
test('refresh proof requires both positive executions and every negative guard exactly once',()=>{
  for(const mutate of [
    p=>p.checks.pop(),p=>p.checks.push({...p.checks[0]}),p=>p.checks[0].result='wrong',
    p=>p.checks[0].optimization=2,p=>p.checks[0].bytes=0,p=>p.checks[0].rejected=true,
    p=>p.checks[2].executed=false,p=>p.checks[2].rejected=false,
    p=>p.checks[2].name=p.checks[3].name,p=>p.checks[2].optimization=0,p=>p.checks[2].executableSHA256='invalid'
  ]) {
    const {proof,manifest,target}=fixture();mutate(proof);
    assert.throws(()=>validatePascalNativeExecutionProof(proof,manifest,target),/Pascal proof|Pascal O|Pascal guard/);
  }
});
