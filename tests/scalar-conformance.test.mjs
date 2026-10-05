import test from 'node:test';
import assert from 'node:assert/strict';
import {retainedCorpora,prepare,compare,equivalent,distinction} from '../tools/conformance/check-scalars.mjs';
for(const [index,fixture] of retainedCorpora().entries())test('runtime matches retained genuine Windows scalar corpus '+index,()=>{
 assert.equal(fixture.report.unexpectedErrors,0);assert.match(fixture.provenance.archiveSha256,/^[a-f0-9]{64}$/);assert.match(fixture.report.oleaut32Sha256,/^[a-fA-F0-9]{64}$/);
 const result=compare(fixture.vectors,fixture.report);
 assert.deepEqual(result.mismatches,[]);assert.equal(result.passed,[1790,362][index]);assert.equal(result.excluded.length,3);assert.equal(result.compared,result.passed);
});
test('fresh Windows input corpus is deterministic and retains every original operation',()=>{const a=prepare(),b=prepare();assert.deepEqual(a,b);assert.equal(a.operations.length,2158);assert.equal(new Set(a.operations.map(v=>v.id)).size,2158);assert.equal(a.operations.filter(distinction).length,6);});
for(const mutation of [r=>r.operations.pop(),r=>r.operations.push(r.operations[0]),r=>r.operations[0]={id:999999,result:r.operations[0].result},r=>r.operations[0].error='binding failed',r=>r.unexpectedErrors=1])test('native evidence validation refuses missing, duplicated, unexpected or failed cases: '+mutation,()=>{const f=retainedCorpora()[0];mutation(f.report);assert.throws(()=>compare(f.vectors,f.report));});
test('a changed native result is reported, not converted into an exclusion',()=>{const f=retainedCorpora()[0];f.report.operations[0].result.value='999';const r=compare(f.vectors,f.report);assert.equal(r.failed,1);assert.equal(r.excluded.length,3);assert.equal(r.mismatches[0].vector.id,0);});
test('fixed-point comparisons are exact beyond IEEE double precision',()=>{assert.equal(equivalent({type:14,value:'1.00000000000000000001',hresult:0},{type:14,value:'1.00000000000000000002',hresult:0}),false);assert.equal(equivalent({type:6,value:'922337203685477.5807',hresult:0},{type:6,value:'922337203685477.5806',hresult:0}),false);});
