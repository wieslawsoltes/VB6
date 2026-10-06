import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {IDE_ARTIFACTS,WIN32_ARTIFACTS,GENERATED_ARTIFACTS,verifyIdeArtifacts} from '../tools/ide-artifacts.mjs';

function fixture(t) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'vb6-ide-artifacts-'));
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  fs.mkdirSync(path.join(root,'dist'));fs.mkdirSync(path.join(root,'tools'));
  const files={};
  for(const name of GENERATED_ARTIFACTS){
    fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});
    const data=Buffer.from(name+' Aé€\n');fs.writeFileSync(path.join(root,name),data);
    files[name]={bytes:data.length,sha256:createHash('sha256').update(data).digest('hex')};
  }
  const manifest={version:2,files},file=path.join(root,'tools/ide-artifacts.json');
  const save=()=>fs.writeFileSync(file,JSON.stringify(manifest));save();
  return {root,manifest,file,save};
}

test('IDE fingerprints cover both exact outputs including UTF-8 bytes',t=>{
  const f=fixture(t),before=fs.readFileSync(f.file);
  assert.deepEqual(verifyIdeArtifacts(f.root),f.manifest.files);
  assert.deepEqual(fs.readFileSync(f.file),before,'Verification must not bless its own outputs');
});
for(const name of GENERATED_ARTIFACTS){
  test(`missing IDE output fails: ${name}`,t=>{const f=fixture(t);fs.rmSync(path.join(f.root,name));assert.throws(()=>verifyIdeArtifacts(f.root));});
  test(`same-length IDE mutation fails: ${name}`,t=>{const f=fixture(t),p=path.join(f.root,name),data=fs.readFileSync(p);data[0]^=1;fs.writeFileSync(p,data);assert.throws(()=>verifyIdeArtifacts(f.root),/mismatch/);});
  test(`truncated IDE output fails: ${name}`,t=>{const f=fixture(t);fs.writeFileSync(path.join(f.root,name),'');assert.throws(()=>verifyIdeArtifacts(f.root),/mismatch/);});
  test(`non-file IDE output fails: ${name}`,t=>{const f=fixture(t),p=path.join(f.root,name);fs.rmSync(p);fs.mkdirSync(p);assert.throws(()=>verifyIdeArtifacts(f.root),/regular file/);});
}
for(const [name,change] of [
  ['missing output entry',m=>delete m.files[IDE_ARTIFACTS[0]]],
  ['extra output entry',m=>m.files['dist/other.js']=m.files[IDE_ARTIFACTS[0]]],
  ['unsupported version',m=>m.version=3],
  ['extra top-level key',m=>m.skip=true],
  ['invalid hash',m=>m.files[IDE_ARTIFACTS[0]].sha256='x'.repeat(64)],
  ['unsafe length',m=>m.files[IDE_ARTIFACTS[0]].bytes=Number.MAX_SAFE_INTEGER+1],
  ['zero length',m=>m.files[IDE_ARTIFACTS[0]].bytes=0],
  ['extra fingerprint key',m=>m.files[IDE_ARTIFACTS[0]].skip=true],
  ['array inventory',m=>m.files=[]]
])test(`IDE manifest rejects ${name}`,t=>{const f=fixture(t);change(f.manifest);f.save();assert.throws(()=>verifyIdeArtifacts(f.root),/Invalid IDE artifact/);});
test('IDE manifest absence and corrupt JSON fail closed',t=>{
  const f=fixture(t);fs.writeFileSync(f.file,'{');assert.throws(()=>verifyIdeArtifacts(f.root));
  fs.rmSync(f.file);assert.throws(()=>verifyIdeArtifacts(f.root));
});
test('explicit authoring command is blocked in CI without touching expectations',t=>{
  const f=fixture(t),before=fs.readFileSync(f.file);
  const module=new URL('../tools/ide-artifacts.mjs',import.meta.url).href;
  const code=`import {recordIdeArtifacts} from ${JSON.stringify(module)};recordIdeArtifacts(${JSON.stringify(f.root)});`;
  const p=spawnSync(process.execPath,['--input-type=module','-e',code],{env:{...process.env,CI:'true'},encoding:'utf8',timeout:10000});
  assert.equal(p.status,1);assert.match(p.stderr,/not permitted in CI/);assert.deepEqual(fs.readFileSync(f.file),before);
});
test('explicit authoring records deterministic fingerprints and leaves no temporary file',t=>{
  const f=fixture(t);fs.writeFileSync(path.join(f.root,IDE_ARTIFACTS[0]),'reviewed change');
  const module=new URL('../tools/ide-artifacts.mjs',import.meta.url).href,env={...process.env};delete env.CI;
  const code=`import {recordIdeArtifacts} from ${JSON.stringify(module)};recordIdeArtifacts(${JSON.stringify(f.root)});`;
  const p=spawnSync(process.execPath,['--input-type=module','-e',code],{env,encoding:'utf8',timeout:10000});assert.equal(p.status,0,p.stderr);
  assert.equal(verifyIdeArtifacts(f.root)[IDE_ARTIFACTS[0]].bytes,15);
  assert.deepEqual(fs.readdirSync(path.join(f.root,'tools')),['ide-artifacts.json']);
});
test('built repository outputs match the committed IDE fingerprints',()=>{assert.equal(Object.keys(verifyIdeArtifacts()).length,GENERATED_ARTIFACTS.length);});

test('fresh-checkout npm entry points build and verify before tests or serving',()=>{
  const scripts=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url),'utf8')).scripts;
  for(const name of ['pretest','pretest:agents','pretest:chatgpt','preserve'])assert.equal(scripts[name],'npm run build');
  assert.equal(scripts.build,'node tools/build.mjs');
  assert.equal(scripts['verify:ide-artifacts'],'node tools/ide-artifacts.mjs');
});

test('fingerprints include every authored sample and runtime exporter payload',async()=>{
  const {EXAMPLES}=await import('../src/project/examples.js');
  assert.deepEqual(GENERATED_ARTIFACTS,[...IDE_ARTIFACTS,...WIN32_ARTIFACTS,'dist/vb6-runtime.js','src/exporter/runtime-payload.js','dist/OCX-Source-Control-Lab.html',...EXAMPLES.map(e=>`dist/examples/${e.id}.html`)]);
  assert.equal(new Set(GENERATED_ARTIFACTS).size,GENERATED_ARTIFACTS.length);
});
