// Temporary branch-only object transport, not production code or a validation bypass.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
assert.equal(process.env.GITHUB_REPOSITORY,'wieslawsoltes/VB6');
assert.equal(process.env.GITHUB_REF,'refs/heads/automation/macos26-object-staging');
const encoded=[1,2].map(n=>fs.readFileSync(`.github/macos26-delta.${n}.b64`,'utf8').trim()).join('');
const decoded=brotliDecompressSync(Buffer.from(encoded,'base64'));
assert.equal(createHash('sha256').update(decoded).digest('hex'),'44b8cf1c5b9794d1b2885a4cc8949c28d3751ed2326be73273680e6abaebdcc7');
const entries=JSON.parse(decoded),mode=process.argv[2];
const refinements=JSON.parse(fs.readFileSync('.github/macos26-final-edits.json','utf8'));
const finalHashes=new Map(refinements.map(e=>[e.path,e.sha]));
assert.ok(mode==='prepare'||mode==='publish');assert.equal(entries.length,29);
const gitHash=data=>createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
function apply(original,entry){
 assert.equal(gitHash(original),entry.base??gitHash(Buffer.alloc(0)),entry.path+' base');
 let position=0;const pieces=[];
 for(const [start,end,text] of entry.edits){
  assert.ok(Number.isInteger(start)&&Number.isInteger(end)&&start>=position&&end>=start&&end<=original.length);
  pieces.push(original.subarray(position,start),Buffer.from(text,'utf8'));position=end;
 }
 pieces.push(original.subarray(position));const result=Buffer.concat(pieces);
 assert.equal(gitHash(result),entry.sha,entry.path+' reconstructed');return result;
}
const output=new Map();
for(const entry of entries){
 assert.ok(!path.isAbsolute(entry.path)&&!entry.path.split('/').includes('..')&&!entry.path.startsWith('.git/'));
 assert.equal(entry.mode,'100644');assert.equal(entry.type,'blob');
 if(mode==='prepare'&&entry.edits){
  const exists=fs.existsSync(entry.path),original=exists?fs.readFileSync(entry.path):Buffer.alloc(0);
  assert.equal(exists?gitHash(original):null,entry.base,entry.path+' base');
  output.set(entry.path,{...entry,data:apply(original,entry)});
 }else if(mode==='publish'){
  const data=fs.readFileSync(entry.path),sha=finalHashes.get(entry.path)??entry.sha;
  assert.equal(gitHash(data),sha,entry.path+' reviewed');output.set(entry.path,{...entry,sha,data});
 }
}
if(mode==='prepare'){
 for(const refinement of refinements){
  const prior=output.get(refinement.path);assert.ok(prior);
  output.set(refinement.path,{...prior,sha:refinement.sha,data:apply(prior.data,refinement)});
 }
 // Complete reconstruction and SHA preflight before any file write.
 for(const {path:filename,data} of output.values()){fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,data);}
 console.log('Reconstructed',output.size,'reviewed source files; generated palettes follow from the strict build.');
}else{
 // All 29 hashes passed above, before any network operation.
 assert.ok(process.env.GH_TOKEN);const report=[];
 for(const {path:filename,data,sha} of output.values()){
  const response=await fetch('https://api.github.com/repos/wieslawsoltes/VB6/git/blobs',{method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({encoding:'base64',content:data.toString('base64')})});
  assert.equal(response.status,201,`${filename}: HTTP ${response.status}`);
  const result=await response.json();assert.equal(result.sha,sha,filename);
  report.push({path:filename,sha,bytes:data.length});console.log(filename,sha);
 }
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/macos26-reviewed-object-shas.json',JSON.stringify(report,null,2)+'\n');
}
