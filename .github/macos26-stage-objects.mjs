// Temporary branch-only immutable object transport. Never merge into main.
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import assert from 'node:assert/strict';
assert.equal(process.env.GITHUB_REPOSITORY,'wieslawsoltes/VB6');
assert.equal(process.env.GITHUB_REF,'refs/heads/automation/macos26-object-staging');
const decoded=brotliDecompressSync(Buffer.from(fs.readFileSync('.github/macos26-integration.b64','utf8').trim(),'base64'));
assert.equal(createHash('sha256').update(decoded).digest('hex'),'70ceba11c9baf199fe09e950275aa5c04498240a8719591deab34002150b5907');
const entries=JSON.parse(decoded),mode=process.argv[2];assert.equal(entries.length,23);
assert.ok(mode==='prepare'||mode==='publish');
const gitHash=data=>createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
const output=[];
for(const entry of entries){
 assert.ok(!path.isAbsolute(entry.path)&&!entry.path.split('/').includes('..')&&!entry.path.startsWith('.git/'));
 assert.equal(entry.mode,'100644');assert.equal(entry.type,'blob');
 if(mode==='prepare'&&entry.edits){
  const exists=fs.existsSync(entry.path),original=exists?fs.readFileSync(entry.path):Buffer.alloc(0);
  assert.equal(exists?gitHash(original):null,entry.base,entry.path+' base');
  let position=0;const pieces=[];
  for(const [start,end,text] of entry.edits){
   assert.ok(Number.isInteger(start)&&Number.isInteger(end)&&start>=position&&end>=start&&end<=original.length);
   pieces.push(original.subarray(position,start),Buffer.from(text,'utf8'));position=end;
  }
  pieces.push(original.subarray(position));const data=Buffer.concat(pieces);
  assert.equal(gitHash(data),entry.sha,entry.path+' reconstructed');output.push({...entry,data});
 }else if(mode==='publish'){
  const data=fs.readFileSync(entry.path);assert.equal(gitHash(data),entry.sha,entry.path+' reviewed');output.push({...entry,data});
 }
}
if(mode==='prepare'){
 for(const {path:filename,data} of output){fs.mkdirSync(path.dirname(filename),{recursive:true});fs.writeFileSync(filename,data);}
 console.log('Reconstructed',output.length,'reviewed source files; generated palettes follow from the strict build.');
}else{
 assert.ok(process.env.GH_TOKEN);const report=[];
 for(const {path:filename,data,sha} of output){
  const response=await fetch('https://api.github.com/repos/wieslawsoltes/VB6/git/blobs',{method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({encoding:'base64',content:data.toString('base64')})});
  assert.equal(response.status,201,`${filename}: HTTP ${response.status}`);
  const result=await response.json();assert.equal(result.sha,sha,filename);
  report.push({path:filename,sha,bytes:data.length});console.log(filename,sha);
 }
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/macos26-reviewed-object-shas.json',JSON.stringify(report,null,2)+'\n');
}
