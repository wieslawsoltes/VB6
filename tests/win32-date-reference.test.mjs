import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
test('Date reference records are complete ordered integer data, not executable source',async()=>{
 const {DATE_CONTRACTS,compileReference}=await import('../tools/win32-date-reference.mjs');
 const good=DATE_CONTRACTS.map((_,i)=>`${i}|value|0`).join('\n');
 const result=compileReference(good);
 assert.equal(result.records.length,DATE_CONTRACTS.length);
 assert.ok(compileWin32(result.project).bytes.length>0);
 for(const bad of ['',good+'\nextra',good.replace('0|value|0','1|value|0'),good.replace('0|value|0','0|value|2147483648'),good.replace('0|value|0','0|value|1:End')])assert.throws(()=>compileReference(bad));
});
