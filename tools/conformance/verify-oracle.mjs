/** Validate evidence completeness, not equivalence between this browser runtime and VB6. */
import fs from 'node:fs';
import assert from 'node:assert/strict';
const read=file=>JSON.parse(fs.readFileSync(file,'utf8').replace(/^\uFEFF/,''));
const [vectorsPath,reportPath]=process.argv.slice(2);
if(!vectorsPath||!reportPath)throw new Error('Usage: node verify-oracle.mjs vectors.json windows-oracle.json');
const vectors=read(vectorsPath),report=read(reportPath);
assert.equal(report.unexpectedErrors,0,'native binding failures');
assert.equal(report.operations.length,vectors.operations.length,'all operation vectors returned');
assert.equal(report.encodings.length,vectors.encodings.length,'all encoding vectors returned');
const results=new Map(report.operations.map(v=>[v.id,v]));
assert.equal(results.size,vectors.operations.length,'unique vector IDs');
for(const v of vectors.operations){const row=results.get(v.id);assert.ok(row&&!row.error,'binding vector '+v.id);assert.ok(Number.isInteger(row.result.hresult));}
for(const row of report.encodings){if(row.error)assert.equal(row.rejected,true,'unexpected codec failure');else assert.equal(row.decoded,row.text,'codepage roundtrip '+row.page);}
// Independent known results catch empty/fabricated reports or a broken native binding.
for(const [op,left,right,type,value]of [['+','3','3',2,'6'],['*','4','4',3,'16'],['&','2','2',8,'22']]){
  const v=vectors.operations.find(v=>v.op===op&&v.a.value===left&&v.b.value===right&&v.a.type===(op==='&'?8:type)&&v.b.type===(op==='&'?8:type));
  assert.ok(v);const result=results.get(v.id).result;assert.equal(result.hresult,0);assert.equal(result.type,type);assert.equal(result.value,value);
}
assert.match(report.oleaut32Sha256,/^[a-f0-9]{64}$/i);assert.ok(report.oleaut32Version);
console.log(JSON.stringify({ok:true,operations:report.operations.length,encodings:report.encodings.length,note:'Windows API oracle only; not VB6/runtime equivalence certification'}));
