import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {readZip} from '../src/project/zip.js';
import {compressedLinuxRuntimeArchive} from '../tools/embed-linux-aot-runtime.mjs';
import {linuxAOTExecutionVerification,linuxAOTRuntimePayloadFile} from '../tools/linux-aot-provenance.mjs';
import {linuxTarget} from '../packages/linux-native/src/target.js';
import {verifyLinuxAOTExecutionSysroot} from '../tools/build-linux-aot-template.mjs';
import {validateLinuxRuntimeRefreshProof} from '../tools/verify-linux-runtime-refresh.mjs';
import {pascalNativeExpectedResult} from './pascal-integration-fixtures.mjs';
const cases=['language-O0','language-O1','language-O2','language-O3','abi-platform-O0','abi-platform-O1','abi-platform-O2','abi-platform-O3','resource-path-O2','program-roots-O2','abrupt-End-O2','form-lifetime-O2','large-O2','gtk-controls-O2','richtext-O2','compiled-printers-O3','compiled-instance-O3'];
function fixture(architecture,executionMode){
  const target=linuxTarget(architecture),manifest={architecture:target.architecture,sha256:'a'.repeat(64)};
  const proof={platform:'linux',arch:target.option,architecture:target.architecture,hostArchitecture:executionMode==='native'?target.option:'x64',executionMode,emulatorVersion:'qemu-aarch64 version 8.2',runtime:{sha256:manifest.sha256},optimizationLevelsVerified:[0,1,2,3]};
  for(const name of ['machineCodeExecutionVerified',target.option+'ExecutionVerified','gtkExecutionVerified','gtkNativeSignalsVerified','conformanceVerified','resourcesVerified','lifetimeVerified','codeMetadataGrowthVerified','richTextVerified','printerServicesVerified','previousInstanceVerified'])proof[name]=true;
  for(const name of cases)proof[name]={runtimeSha256:manifest.sha256,architecture:target.architecture,machine:target.machine,callingConvention:target.callingConvention,executableSha256:'b'.repeat(64)};
  proof.nativeFixtures=Object.fromEntries(['gtkSignals','richText','displayBackends','printers','previousInstance'].map(name=>[name,{passed:true,...proof['language-O0']}]));
  proof.compiledServices={passed:true};
  if(architecture==='arm64'&&executionMode==='qemu-user'){
    proof.emulatedPageSizesVerified=[4096,16384,65536];
    proof.emulatedPageCases=Object.fromEntries(proof.emulatedPageSizesVerified.map(pageBytes=>[pageBytes,{...proof['resource-path-O2'],pageBytes}]));
  }
  return {proof,manifest};
}
test('Compressed runtime archives retain the exact architecture-specific filename',async()=>{
  const bytes=Uint8Array.of(0x7f,0x45,0x4c,0x46,0,1,2);
  for(const architecture of ['x64','arm64']){
    const files=await readZip(compressedLinuxRuntimeArchive(bytes,architecture));assert.equal(files.size,1);assert.deepEqual(files.get('runtime-'+linuxTarget(architecture).architecture),bytes);
  }
  assert.equal(linuxAOTRuntimePayloadFile(),'aot-runtime-payload.js');assert.equal(linuxAOTRuntimePayloadFile('arm64'),'aot-runtime-arm64-payload.js');
});
test('Execution proof preserves native x64 versus emulated ARM64 provenance',()=>{
  for(const [architecture,mode]of [['x64','native'],['arm64','native'],['arm64','qemu-user']]){
    const {proof,manifest}=fixture(architecture,mode),verification=linuxAOTExecutionVerification(proof,manifest);
    assert.equal(verification.architecture,linuxTarget(architecture).architecture);assert.equal(verification.executionMode,mode);assert.equal(verification[architecture+'ExecutionVerified'],true);
    assert.equal(verification.emulatorVersion,mode==='qemu-user'?proof.emulatorVersion:undefined);
    assert.deepEqual(verification.emulatedPageSizesVerified,mode==='qemu-user'?[4096,16384,65536]:undefined);
  }
});
test('Embedding proof rejects wrong architecture, partial execution, missing cases and inconsistent hosts',()=>{
  for(const change of [p=>p.arch='x64',p=>p.architecture='x86_64',p=>p.runtime.sha256='c'.repeat(64),p=>p.optimizationLevelsVerified.pop(),p=>p.arm64ExecutionVerified=false,p=>p.machineCodeExecutionVerified=false,p=>p.gtkNativeSignalsVerified=false,p=>p.executionMode='native',p=>p.emulatorVersion='',p=>delete p['language-O3'],p=>p['gtk-controls-O2'].machine=62,p=>p['large-O2'].runtimeSha256='c'.repeat(64),p=>p.richTextVerified=false,p=>p.printerServicesVerified=false,p=>p.previousInstanceVerified=false,p=>delete p.nativeFixtures.richText,p=>p.nativeFixtures.printers.runtimeSha256='c'.repeat(64),p=>p.nativeFixtures.previousInstance.passed=false,p=>p.compiledServices.passed=false,p=>delete p['compiled-printers-O3'],p=>p.emulatedPageSizesVerified.pop(),p=>delete p.emulatedPageCases[16384],p=>p.emulatedPageCases[65536].executableSha256='c'.repeat(64),p=>p.error={message:'failed'}]){
    const {proof,manifest}=fixture('arm64','qemu-user');change(proof);assert.throws(()=>linuxAOTExecutionVerification(proof,manifest),/Embedding requires/);
  }
});
test('Embedding requires display qualification against the exact runtime objects',()=>{
  for(const change of [p=>delete p.nativeFixtures.displayBackends,p=>p.nativeFixtures.displayBackends.runtimeSha256='c'.repeat(64),p=>p.nativeFixtures.displayBackends.passed=false]){
    const {proof,manifest}=fixture('x64','native');change(proof);
    assert.throws(()=>linuxAOTExecutionVerification(proof,manifest),/X11 and Wayland display backends/);
  }
});
test('Cross GTK qualification requires initialized target image-loader and MIME caches',async()=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-sysroot-prerequisites-'));
  try{
    await assert.rejects(()=>verifyLinuxAOTExecutionSysroot(directory),/gdk-pixbuf-query-loaders.*update-mime-database/);
    const prefix='usr/lib/aarch64-linux-gnu/gdk-pixbuf-2.0/2.10.0',loaders=path.join(directory,prefix,'loaders');
    await fs.mkdir(loaders,{recursive:true});await fs.mkdir(path.join(directory,'usr/share/mime'),{recursive:true});
    const module=new Uint8Array(24),view=new DataView(module.buffer);view.setUint32(0,0x464c457f,true);module[4]=2;module[5]=1;view.setUint16(18,183,true);
    for(const format of ['ico','svg'])await fs.writeFile(path.join(loaders,'libpixbufloader-'+format+'.so'),module);
    await fs.writeFile(path.join(directory,prefix,'loaders.cache'),['ico','svg'].map(format=>'"/'+prefix+'/loaders/libpixbufloader-'+format+'.so"').join('\n')+'\n');
    await fs.writeFile(path.join(directory,'usr/share/mime/mime.cache'),Uint8Array.of(1));
    await assert.rejects(()=>verifyLinuxAOTExecutionSysroot(directory),/Missing cross-sysroot GTK CUPS print backend/);
    const gtkModulePath=path.join(directory,'usr/lib/aarch64-linux-gnu/gtk-3.0'),backend=path.join(gtkModulePath,'3.0.0/printbackends/libprintbackend-cups.so');
    await fs.mkdir(path.dirname(backend),{recursive:true});await fs.writeFile(backend,module);
    const verified=await verifyLinuxAOTExecutionSysroot(directory);assert.deepEqual(verified.imageLoaders,['ico','svg']);assert.match(verified.gdkPixbufCacheSha256,/^[a-f0-9]{64}$/);
    assert.equal(verified.gtkModulePath,path.join(await fs.realpath(directory),'usr/lib/aarch64-linux-gnu/gtk-3.0'));assert.match(verified.gtkPrintBackendSha256,/^[a-f0-9]{64}$/);
    view.setUint16(18,62,true);await fs.writeFile(backend,module);
    await assert.rejects(()=>verifyLinuxAOTExecutionSysroot(directory),/GTK CUPS print backend has the wrong ELF architecture/);
    view.setUint16(18,183,true);await fs.writeFile(backend,module);
    view.setUint16(18,62,true);await fs.writeFile(path.join(loaders,'libpixbufloader-svg.so'),module);
    await assert.rejects(()=>verifyLinuxAOTExecutionSysroot(directory),/SVG image loader has the wrong ELF architecture/);
  }finally{await fs.rm(directory,{recursive:true,force:true});}
});

function refreshFixture(architecture='x64') {
  const target=linuxTarget(architecture),{proof,manifest}=fixture(architecture,'native');
  manifest.provenance={buildPlatform:'linux',buildArchitecture:target.architecture,targetArchitecture:target.architecture,crossCompiled:false};
  const checks=[0,2].map(optimization=>({optimization,executableSHA256:'b'.repeat(64),bytes:4096,result:pascalNativeExpectedResult,executed:true}));
  for(const name of ['uninitialized-virtual-receiver','incompatible-virtual-tag','vb-records-remain-nominal',
    'invalid-ancestor-prefix','invalid-ancestor-identity','invalid-dispatch-tag','vb-module-cannot-authorize-pascal-views'])
    checks.push({name,optimization:2,executableSHA256:'c'.repeat(64),bytes:4096,executed:true,rejected:true});
  const pascal={valid:true,platform:'linux',architecture:target.option,hostArchitecture:target.option,executionMode:'native',runtimeSHA256:manifest.sha256,checks};
  return {proof,manifest,pascal};
}
test('Runtime refresh requires successful native execution of both Linux architectures and every Pascal case',()=>{
  for(const architecture of ['x64','arm64']) {
    const {proof,manifest,pascal}=refreshFixture(architecture),verified=validateLinuxRuntimeRefreshProof(proof,pascal,manifest);
    assert.deepEqual(verified,{architecture:linuxTarget(architecture).architecture,executionMode:'native',runtimeSHA256:manifest.sha256,pascalChecks:9});
  }
});
test('Runtime refresh rejects emulation, cross compilation and incomplete native SDK proof',()=>{
  for(const mutate of [
    x=>{x.proof.executionMode='qemu-user';x.proof.hostArchitecture='x64';},
    x=>{x.proof.hostArchitecture='x64';},
    x=>{x.manifest.provenance.crossCompiled=true;},
    x=>{x.manifest.provenance.buildArchitecture='x86_64';},
    x=>{x.manifest.provenance.targetArchitecture='x86_64';},
    x=>{x.manifest.provenance.buildPlatform='darwin';},
    x=>{x.proof.gtkNativeSignalsVerified=false;},
    x=>{delete x.proof['language-O3'];},
    x=>{x.proof.runtime.sha256='d'.repeat(64);}
  ]) {
    const input=refreshFixture('arm64');mutate(input);
    assert.throws(()=>validateLinuxRuntimeRefreshProof(input.proof,input.pascal,input.manifest),/native build and execution|Embedding requires/);
  }
});
test('Runtime refresh rejects partial, duplicated and incorrect Pascal execution proof',()=>{
  for(const mutate of [
    x=>{x.valid=false;},x=>{x.error='failure';},x=>{x.platform='darwin';},
    x=>{x.architecture='arm64';},x=>{x.hostArchitecture='arm64';},x=>{x.executionMode='qemu-user';},
    x=>{x.runtimeSHA256='d'.repeat(64);},x=>{x.checks.pop();},x=>{x.checks.push({...x.checks[2]});},
    x=>{x.checks[0].executed=false;},x=>{x.checks[0].executableSHA256='missing';},
    x=>{x.checks[0].result='wrong output';},x=>{x.checks[1].optimization=0;},
    x=>{x.checks[0].bytes=0;},x=>{x.checks[2].rejected=false;},x=>{x.checks[2].optimization=0;},
    x=>{x.checks[2]={...x.checks[3]};}
  ]) {
    const {proof,manifest,pascal}=refreshFixture();mutate(pascal);
    assert.throws(()=>validateLinuxRuntimeRefreshProof(proof,pascal,manifest),/Pascal proof|Pascal O|Pascal guard/);
  }
});
