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


test('Date differential coverage retains the original boundary probes and adds negative-year and extreme offsets',async()=>{
 const {DATE_CONTRACTS}=await import('../tools/win32-date-reference.mjs');
 assert.equal(DATE_CONTRACTS[29][1],'CLng(CDbl(DateSerial(100,0,32)))');
 assert.equal(DATE_CONTRACTS[30][1],'CLng(CDbl(DateSerial(9999,13,-30)))');
 assert.equal(DATE_CONTRACTS.length,372);
 for(const expression of ['DateSerial(-32768,32767,1)','DateSerial(-1900,1,32767)','DateSerial(-99,0,-32768)','DateSerial(32767,-32768,1)'])
  assert.ok(DATE_CONTRACTS.some(([,source])=>source===`CLng(CDbl(${expression}))`));
 assert.equal(new Set(DATE_CONTRACTS.map(([name])=>name)).size,DATE_CONTRACTS.length);
});


test('every differential probe checks its actual error before comparing values',async()=>{
 const {DATE_CONTRACTS,compileReference}=await import('../tools/win32-date-reference.mjs');
 const text=DATE_CONTRACTS.map((_,i)=>`${i}|${i%2?'error':'value'}|${i%2?5:0}`).join('\n');
 const code=compileReference(text).project.modules[0].code;
 assert.equal((code.match(/actualError = Err.Number/g)||[]).length,DATE_CONTRACTS.length);
 assert.equal((code.match(/If actualError <> /g)||[]).length,DATE_CONTRACTS.length);
 assert.ok(code.indexOf('If actualError <> 0 Then ExitProcess 1') < code.indexOf('If result <> 0 Then ExitProcess 1'));
 assert.match(code,/If actualError <> 5 Then ExitProcess 2/);
});
