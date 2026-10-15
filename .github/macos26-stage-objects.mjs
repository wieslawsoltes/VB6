// Temporary immutable-object transport on the named branch only, not production.
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
assert.equal(process.env.GITHUB_REPOSITORY,'wieslawsoltes/VB6');
assert.equal(process.env.GITHUB_REF,'refs/heads/automation/macos26-object-staging');
const inputs=[1,2].map(n=>`.github/macos26-refinements.${n}.b64`);
const packed=inputs.map(p=>fs.readFileSync(p,'utf8').trim()).join('');
const data=brotliDecompressSync(Buffer.from(packed,'base64'),{maxOutputLength:1024*1024});
assert.equal(createHash('sha256').update(data).digest('hex'),'ac44adf597d615a8b6bb62faae06a4e6e363f13bedd6c00bfe2048cb32001a49');
const {patch,files}=JSON.parse(data);assert.equal(files.length,15);
const mode=process.argv[2];assert.ok(mode==='prepare'||mode==='publish');
const hash=data=>createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
for(const entry of files){
 assert.ok(!path.isAbsolute(entry.path)&&!entry.path.split('/').includes('..')&&!entry.path.startsWith('.git'));
 assert.equal(entry.mode,'100644');assert.equal(entry.type,'blob');assert.match(entry.sha,/^[a-f0-9]{40}$/);
}
if(mode==='prepare'){
 execFileSync('git',['apply','--check','--whitespace=error','-'],{input:patch});
 execFileSync('git',['apply','--whitespace=error','-'],{input:patch});
 console.log('Applied reviewed source patch; strict build must reproduce the committed fingerprints.');
}else{
 const blobs=files.map(entry=>{const bytes=fs.readFileSync(entry.path);assert.equal(hash(bytes),entry.sha,entry.path);return {...entry,bytes};});
 // Verify the entire production tree after removing only this transport's files.
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'macos-object-index-'));
 try{
  const env={...process.env,GIT_INDEX_FILE:path.join(temp,'index')};
  const git=(...args)=>execFileSync('git',args,{env,encoding:'utf8'}).trim();
  git('read-tree','HEAD');
  git('update-index','--force-remove',...inputs,'.github/macos26-stage-objects.mjs','.github/workflows/macos26-object-staging.yml');
  git('add','--',...files.map(e=>e.path));
  assert.equal(git('write-tree'),'55c8e0d6310cca59cb456536561c1bc949b18d4e');
 }finally{fs.rmSync(temp,{recursive:true,force:true});}
 assert.ok(process.env.GH_TOKEN);
 const report=[];
 for(const {path:filename,sha,bytes} of blobs){
  const response=await fetch('https://api.github.com/repos/wieslawsoltes/VB6/git/blobs',{method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({encoding:'base64',content:bytes.toString('base64')})});
  assert.equal(response.status,201,`${filename}: HTTP ${response.status}`);
  const result=await response.json();assert.equal(result.sha,sha,filename);
  report.push({path:filename,sha,bytes:bytes.length});console.log(filename,sha);
 }
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/macos26-reviewed-object-shas.json',JSON.stringify(report,null,2)+'\n');
}
