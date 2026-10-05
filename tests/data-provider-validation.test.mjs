import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {runProviderChecks} from '../tools/data/provider-validation.mjs';
test('a failing native check does not suppress later installed-provider checks',async()=>{
 const visited=[],cases=['Jet','ACE12','ACE16','MSDASQL'].map(label=>({label,profile:{driver:'fixture'}}));
 const result=await runProviderChecks(cases,async(label,profile)=>{visited.push(label);assert.equal(profile.driver,'fixture');if(label==='Jet')throw Error('schema regression');});
 assert.deepEqual(visited,cases.map(c=>c.label));assert.deepEqual(result.map(r=>r.passed),[false,true,true,true]);assert.equal(result[0].error.message,'schema regression');
});
test('synchronous failures and cleanup failures remain explicit, in order',async()=>{
 const result=await runProviderChecks([{label:'first'},{label:'second'}],label=>{if(label==='first')throw new TypeError('binding failure');return Promise.reject(new Error('cleanup failure'));});
 assert.equal(result.length,2);assert(result.every(r=>!r.passed));assert.equal(result[0].error.name,'TypeError');assert.equal(result[1].error.message,'cleanup failure');
});
test('an empty provider inventory does not fabricate a successful check',async()=>{
 assert.deepEqual(await runProviderChecks([],()=>{throw Error('not called');}),[]);
 await assert.rejects(()=>runProviderChecks(null,()=>{}),TypeError);
});
test('Windows PowerShell provider sources remain ASCII-safe without a BOM',async()=>{
 for(const filename of ['oledb-worker.ps1','windows-fixtures.ps1']){
  const content=await fs.readFile(new URL('../tools/data/'+filename,import.meta.url),'utf8');
  assert.doesNotMatch(content,/[^\x00-\x7f]/,filename+' needs explicit Unicode source encoding');
 }
});
