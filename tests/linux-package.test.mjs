import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {loadLinuxAOTRuntime,linuxAOTRuntimeInfo,exportLinuxApplication,verifyLinuxAOTArchive} from '../packages/linux-native/dist/index.js';
import {readLinuxProject,exportLinuxProject,exportLinuxExecutable} from '../packages/linux-native/src/node.mjs';
import {checkLinuxAOTRuntimeProvenance,readLinuxAOTSourceProvenance} from '../tools/linux-aot-provenance.mjs';
import {compressedLinuxRuntimeArchive,encodeLinuxAOTRuntimePayload} from '../tools/embed-linux-aot-runtime.mjs';
import {readZip} from '../src/project/zip.js';
const project={schema:1,name:'LinuxPackage',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:'Public Sub Main()\nDebug.Print "LINUX_PACKAGE_NATIVE"\nEnd Sub'}]};

for(const architecture of ['x64','arm64'])for(const toolkit of ['gtk3','gtk4'])test('Linux '+architecture+' '+toolkit+' payload matches native source and actual execution provenance',()=>{
  const manifest=linuxAOTRuntimeInfo({architecture,toolkit});
  assert.equal(checkLinuxAOTRuntimeProvenance(undefined,{architecture,toolkit}).sha256,manifest.sha256);
  assert.equal(manifest.toolkit,toolkit);assert.equal(manifest.verification.toolkit,toolkit);
  for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance()))assert.equal(manifest.provenance[name],value);
  assert.equal(manifest.verification[architecture+'ExecutionVerified'],true);
  assert.equal(manifest.verification.gtkExecutionVerified,true);
  assert.equal(manifest.verification.gtkNativeSignalsVerified,true);
  assert.match(manifest.verification.nativeFixtureSha256.displayBackends,/^[a-f0-9]{64}$/);
  for(const feature of ['richTextVerified','printerServicesVerified','previousInstanceVerified'])assert.equal(manifest.verification[feature],true,feature);
  assert.deepEqual(manifest.verification.optimizationLevelsVerified,[0,1,2,3]);
});
test('Linux Node APIs export exclusive archives and application directories',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-node-export-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const before=JSON.stringify(project),result=await exportLinuxApplication(project);
  const archive=await exportLinuxProject(project,{out:directory});
  assert.equal(archive.compiled,true);assert.equal(archive.codegen,'x86_64-aot');
  assert.deepEqual(new Uint8Array(await fs.readFile(archive.archive)),result.bytes);
  await assert.rejects(exportLinuxProject(project,{out:directory}),error=>error.code==='EEXIST');
  const extracted=await exportLinuxExecutable(project,{out:directory});
  assert.deepEqual(new Uint8Array(await fs.readFile(extracted.executable)),result.executable);
  if(process.platform!=='win32')assert.equal((await fs.stat(extracted.executable)).mode&0o777,0o755);
  await assert.rejects(exportLinuxExecutable(project,{out:directory}),error=>error.code==='EEXIST');
  assert.equal(JSON.stringify(project),before);
  assert.equal((await verifyLinuxAOTArchive(result.bytes,result.options)).runtimeProvenanceVerified,true);
});
test('Linux import and export reject symlinks and pre-cancelled operations',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-node-input-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const source=path.join(directory,'project.vb6web');await fs.writeFile(source,JSON.stringify(project));
  assert.deepEqual(await readLinuxProject(source),project);
  const native=path.join(directory,'native-source');await fs.mkdir(native);
  await fs.writeFile(path.join(native,'NativeRead.vbp'),'Type=Exe\nModule=MainModule; Main.bas\nStartup="Sub Main"\nName="NativeRead"\n');
  await fs.writeFile(path.join(native,'Main.bas'),'Attribute VB_Name = "MainModule"\n'+project.modules[0].code+'\n');
  for(const input of [native,path.join(native,'NativeRead.vbp')]) {
    const imported=await readLinuxProject(input);assert.equal(imported.name,'NativeRead');
    assert.ok(imported.modules.some(module=>module.name==='MainModule'&&module.code.includes('LINUX_PACKAGE_NATIVE')));
  }
  const controller=new AbortController();controller.abort();
  await assert.rejects(exportLinuxProject(project,{out:path.join(directory,'cancelled'),signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(fs.stat(path.join(directory,'cancelled')),error=>error.code==='ENOENT');
  if(process.platform!=='win32') {
    const linked=path.join(directory,'linked.vb6web');await fs.symlink(source,linked);
    await assert.rejects(readLinuxProject(linked),/symbolic link/);
    const output=path.join(directory,'linked-output');await fs.symlink(directory,output);
    await assert.rejects(exportLinuxProject(project,{out:output}),/regular directory/);
  }
});
test('Linux CLI defaults to a native ELF ZIP and extracts a complete application',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-cli-export-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const source=path.join(directory,'project.vb6web');await fs.writeFile(source,JSON.stringify(project));
  const cli=path.resolve('packages/linux-native/bin/vb6-linux.mjs');
  const archive=JSON.parse(execFileSync(process.execPath,[cli,source,'--out',path.join(directory,'archives')],{encoding:'utf8'}));
  assert.equal(archive.compiled,true);assert.match(archive.archive,/-linux-x64\.zip$/);
  const extracted=JSON.parse(execFileSync(process.execPath,[cli,source,'--out',path.join(directory,'applications'),'--extract','--optimization','3'],{encoding:'utf8'}));
  assert.equal(extracted.optimization,3);assert.ok((await fs.stat(extracted.executable)).size>4096);
  assert.throws(()=>execFileSync(process.execPath,[cli,source,'--out',directory,'--optimization','4'],{encoding:'utf8',stdio:'pipe'}),/optimization must/);
});
for(const architecture of ['x64','arm64'])for(const toolkit of ['gtk3','gtk4'])test('Linux CLI '+architecture+' '+toolkit+' exports every offline package format with explicit metadata',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-cli-formats-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const source=path.join(directory,'project.vb6web');await fs.writeFile(source,JSON.stringify(project));
  const cli=path.resolve('packages/linux-native/bin/vb6-linux.mjs');
  for(const format of ['zip','tar.gz','deb','rpm']){
    const result=JSON.parse(execFileSync(process.execPath,[cli,source,'--out',directory,'--architecture',architecture,'--toolkit',toolkit,'--format',format,'--package-name','linux-sdk-fixture','--version','2.4.0','--maintainer','SDK Fixture <sdk@example.invalid>','--license','MIT'],{encoding:'utf8'}));
    assert.equal(result.toolkit,toolkit);
    assert.equal(result.architecture,architecture==='arm64'?'arm64':'x86_64');assert.equal(result.codegen,architecture==='arm64'?'arm64-aot':'x86_64-aot');
    assert.equal(result.distribution.format,format);assert.equal(result.distribution.version,'2.4.0');assert.ok((await fs.stat(result.archive)).size>4096);
  }
  assert.throws(()=>execFileSync(process.execPath,[cli,source,'--out',directory,'--architecture','ia64'],{encoding:'utf8',stdio:'pipe'}),/architecture must/);
  assert.throws(()=>execFileSync(process.execPath,[cli,source,'--out',directory,'--extract','--format','rpm'],{encoding:'utf8',stdio:'pipe'}),/cannot be combined/);
  assert.throws(()=>execFileSync(process.execPath,[cli,source,'--out',directory,'--format','deb','--version','1\nBad: yes'],{encoding:'utf8',stdio:'pipe'}),/Invalid Linux package version/);
});
test('independently packed Linux SDK imports and exports without network access',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-isolated-sdk-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const packed=JSON.parse(execFileSync('npm',['pack','--offline','--ignore-scripts','--json','--cache',path.join(directory,'cache'),'--pack-destination',directory],{cwd:path.resolve('packages/linux-native'),encoding:'utf8'}));
  execFileSync('tar',['-xzf',path.join(directory,packed[0].filename),'-C',directory]);
  const api=await import(pathToFileURL(path.join(directory,'package/dist/index.js')).href);
  const node=await import(pathToFileURL(path.join(directory,'package/src/node.mjs')).href);
  assert.ok((await fs.stat(path.join(directory,'package/dist/sdk/aot/template-main.cpp'))).isFile());
  const previous=globalThis.fetch;globalThis.fetch=()=>{throw new Error('No network in isolated Linux SDK.');};
  try {
    for(const architecture of ['x64','arm64'])for(const toolkit of ['gtk3','gtk4']){
      const compiler={architecture,toolkit},result=await api.exportLinuxApplication(project,compiler);
      const output=await node.exportLinuxExecutable(project,{compiler,out:path.join(directory,'applications',architecture,toolkit)});
      assert.equal(result.report.compiled,true);assert.equal(result.report.format,'ELF64');assert.equal(result.report.toolkit,toolkit);
      assert.deepEqual(new Uint8Array(await fs.readFile(output.executable)),result.executable);
      const packaged=await api.exportLinuxDistribution(project,compiler,{format:'deb',packageName:'isolated-sdk'});
      assert.equal(packaged.report.codegen,architecture==='arm64'?'arm64-aot':'x86_64-aot');
      assert.equal(packaged.report.toolkit,toolkit);assert.equal(packaged.report.runtimeProvenanceVerified,true);
    }
  }finally {globalThis.fetch=previous;}
});
test('Linux runtime compression is lossless and embedding requires exact native evidence',async()=>{
  for(const bytes of [new Uint8Array(),new Uint8Array(65536).fill(42),crypto.getRandomValues(new Uint8Array(65536))])
    assert.deepEqual((await readZip(compressedLinuxRuntimeArchive(bytes))).get('runtime-x86_64'),bytes);
  const runtime=await loadLinuxAOTRuntime();
  for(const proof of [undefined,{platform:'linux',arch:'x64',runtime:{sha256:'wrong'},x64ExecutionVerified:true}, {platform:'darwin',arch:'arm64'}])
    await assert.rejects(encodeLinuxAOTRuntimePayload(runtime,{proof}),/Embedding requires/);
});
