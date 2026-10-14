// One-use transport on automation/macos26-object-staging only. Never merge this
// workflow into main. Writes immutable blobs only, not branches or commits.
import fs from 'node:fs';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {execFileSync} from 'node:child_process';
import assert from 'node:assert/strict';
assert.equal(process.env.GITHUB_REPOSITORY,'wieslawsoltes/VB6');
assert.equal(process.env.GITHUB_REF,'refs/heads/automation/macos26-object-staging');
// Correct the single transcription duplication before CRC and exact blob checks.
const encoded=fs.readFileSync('.github/macos26-browser-patch.b64','utf8').trim().replace('ktYOZZti','ktYOZti');
const patch=gunzipSync(Buffer.from(encoded,'base64'));
execFileSync('git',['apply','--check','-'],{input:patch});
execFileSync('git',['apply','-'],{input:patch});
const expected={
 'src/theme/application-palettes.css':'6ad69a6a9554bc1615e980279da03c57733151a0',
 'src/theme/ide-palettes.css':'19ad0150dcee9d8d5a9c969d51b174d7204fd907',
 'src/theme/palette.css':'4a3d2e2bc0ac7c9fdd66c8091ea6aaf3f60767e4',
 'tools/browser-application-theme-tests.py':'fb770bdc0a23a8be16278243b6022ae3e97d328f'
};
const blobs=Object.entries(expected).map(([path,sha])=>{
 const data=fs.readFileSync(path);
 assert.equal(createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex'),sha,path);
 return {path,sha,data};
});
const report=[];
for(const {path,sha,data} of blobs){
 const response=await fetch('https://api.github.com/repos/wieslawsoltes/VB6/git/blobs',{
  method:'POST',headers:{Authorization:`Bearer ${process.env.GH_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json','X-GitHub-Api-Version':'2022-11-28'},
  body:JSON.stringify({encoding:'base64',content:data.toString('base64')})
 });
 assert.equal(response.status,201,`${path}: HTTP ${response.status}`);
 const result=await response.json();assert.equal(result.sha,sha,path);
 report.push({path,sha,bytes:data.length});console.log(path,sha);
}
fs.mkdirSync('reports',{recursive:true});
fs.writeFileSync('reports/macos26-reviewed-object-shas.json',JSON.stringify(report,null,2)+'\n');
