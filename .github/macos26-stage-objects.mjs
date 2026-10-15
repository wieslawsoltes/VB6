// Temporary immutable-object transport. Not part of the production PR.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {brotliDecompressSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.GITHUB_REPOSITORY,'wieslawsoltes/VB6');
assert.equal(process.env.GITHUB_REF,'refs/heads/automation/macos26-object-staging');
const expected={
 'docs/MACOS-THEME-FIDELITY.md':'c2ee6b06b76f10f8ad99deccbd877a7916349caf',
 'src/controls/controls.css':'c8467c942137fc77df6345bd51ac5eb6706b4ca2',
 'src/controls/controls.js':'5a5698024a55865cc09767ce605a377fa924cb3c',
 'src/controls/range-orientation.js':'24e82cf859263b7d95a5577ba3f3dc3f660c0275',
 'tests/range-orientation.test.mjs':'eb11426b2a197590a43c04f0145a0ab27229cc62',
 'tools/browser-application-theme-tests.py':'6299db89587e150e1eee04a856daf1ee1a2bdba8',
 'tools/ide-artifacts.json':'8d49402c2f664da7ae26760b943aeb545eedb079'
};
const mode=process.argv[2];assert.ok(mode==='prepare'||mode==='publish');
if(mode==='prepare'){
 const data=brotliDecompressSync(Buffer.from(fs.readFileSync('.github/macos26-range.b64','utf8').trim(),'base64'));
 assert.equal(createHash('sha256').update(data).digest('hex'),'1bbdf70db1a607e0913d95e0ccfc3f3bcce489ceee38fdd09a0e514705c98f67');
 execFileSync('git',['apply','--check','-'],{input:data});
 execFileSync('git',['apply','-'],{input:data});
}
const entries=Object.entries(expected).map(([path,sha])=>{
 const data=fs.readFileSync(path);
 assert.equal(createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'),sha,path);
 return {path,sha,data};
});
if(mode==='publish'){
 assert.ok(process.env.GH_TOKEN);const report=[];
 for(const {path,sha,data} of entries){
  const response=await fetch('https://api.github.com/repos/wieslawsoltes/VB6/git/blobs',{method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},body:JSON.stringify({encoding:'base64',content:data.toString('base64')})});
  assert.equal(response.status,201,`${path}: ${response.status}`);
  assert.equal((await response.json()).sha,sha,path);report.push({path,sha,bytes:data.length});
 }
 fs.mkdirSync('reports',{recursive:true});fs.writeFileSync('reports/macos26-reviewed-object-shas.json',JSON.stringify(report,null,2)+'\n');
}
