import test from 'node:test';
import assert from 'node:assert/strict';
import {DATE_INTERVAL_CONTRACTS,readIntervalRecords,INTERVAL_REFERENCE_POLICY} from '../tools/win32-date-interval-reference.mjs';
import {intervalContractFixture} from '../tools/win32-interval-contract-fixture.mjs';
import {compileWin32} from '../src/native/compiler.js';
test('two-component reference preserves sub-ULP printed precision without relaxing date comparisons',()=>{
 const text=DATE_INTERVAL_CONTRACTS.map((c,i)=>`${i}|${c.kind}|${c.kind==='string'?'':c.kind==='date'?'2958464.91666667;-3.25962901115417E-09':'1'}`).join('\n');
 assert.equal(readIntervalRecords(text)[0].value,2958464.9166666665);
 assert.throws(()=>readIntervalRecords(text.replace('2958464.91666667;-3.25962901115417E-09','1;2;3')),/numeric/);
});
test('host reference substeps counts without duplicating calendar arithmetic',()=>{
 assert.match(INTERVAL_REFERENCE_POLICY,/Do While number > 1000000000/);
 assert.match(INTERVAL_REFERENCE_POLICY,/value = DateAdd\(interval, -1000000000, value\)/);
});
test('hand-authored interval invariant executable is immutable and deterministic',()=>{
 const {project,checks}=intervalContractFixture(),before=JSON.stringify(project);
 const result=compileWin32(project);
 assert.equal(checks.length,22);assert.equal(JSON.stringify(project),before);
 assert.deepEqual(result.bytes,compileWin32(project).bytes);
});
