/** Execute the exact exported ELF bytes; never substitute a C++ source oracle. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {runTool} from '../packages/macos-native/src/build-driver.mjs';
import {conformanceProject} from '../packages/macos-native/tests/conformance.mjs';
import {programLifetimeProject,formLifetimeProject,abruptLifetimeProject} from '../packages/macos-native/tests/program-lifetime.mjs';
import {largeAOTProject} from '../packages/macos-native/tests/aot-large.mjs';
import {linuxBrowserProject} from '../tests/linux-browser-fixture.mjs';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';
import {linkLinuxAOT,unpackLinuxAOTArchive} from '../packages/linux-native/src/aot-export.js';
import {inspectLinuxELF,verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {buildLinuxAOTTemplate,linuxNativeTool} from './build-linux-aot-template.mjs';
import {checkLinuxAOTRuntimeProvenance,readLinuxAOTSourceProvenance} from './linux-aot-provenance.mjs';
const root=path.resolve(import.meta.dirname,'..');

function validateConformance(output) {
  for(const marker of ['NATIVE_RECORDSETS_OK','NATIVE_CONFORMANCE_OK','NATIVE_INTERFACES_OK','NATIVE_LIFETIMES_OK','NATIVE_ARRAYS_OK','NATIVE_SCOPES_OK','NATIVE_RESOURCES_OK'])
    assert.ok(output.includes(marker),'Missing native marker: '+marker);
}
function validateRoots(output) {
  const body=output.indexOf('NATIVE_PROGRAM_BODY_OK');assert.ok(body>=0,'Program body must finish.');
  for(const label of ['global','array','static']) {
    const marker='NATIVE_ROOT_RELEASED:'+label;
    assert.ok(output.indexOf(marker)>body,'Missing finalizer after program body: '+label);
    assert.equal(output.split(marker).length,2,'Finalizer must run once: '+label);
  }
}
async function writeApplication(result,directory) {
  const unpacked=await unpackLinuxAOTArchive(result.bytes,result.options),entry=result.options.name+'/bin/'+result.options.name;
  for(const [name,bytes]of unpacked.files) {
    const destination=path.join(directory,...name.split('/'));
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,bytes,{flag:'wx',mode:name===entry?0o755:0o644});
  }
  const executable=path.join(directory,...entry.split('/'));
  assert.equal((await fs.stat(executable)).mode&0o777,0o755);
  assert.deepEqual(new Uint8Array(await fs.readFile(executable)),result.executable);
  return executable;
}
export async function testLinuxAOT({rebuild=false,runtimeDirectory,reportDirectory=path.join(root,'reports/linux-aot')}={}) {
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-linux-aot-tests-'));
  const artifacts=path.join(root,'artifacts/linux-aot');
  let transcript='';
  const report={platform:process.platform,arch:process.arch,rebuild,x64ExecutionVerified:false,gtkExecutionVerified:false,checks:[]};
  const log=value=>{transcript+=value;if(transcript.length>16*1024*1024)transcript=transcript.slice(-16*1024*1024);};
  const run=(executable,args=[],options={})=>runTool(executable,args,{cwd:work,timeout:60000,log,...options});
  try {
    assert.equal(process.platform,'linux','Linux AOT acceptance requires actual Linux execution.');
    assert.equal(process.arch,'x64','Linux AOT acceptance requires native x86_64 execution.');
    if(rebuild&&runtimeDirectory)throw new Error('--rebuild and --runtime are mutually exclusive.');
    await fs.mkdir(artifacts,{recursive:true});
    let runtime;
    if(rebuild) {
      console.log('Building the native Linux GTK runtime...');
      runtime=await buildLinuxAOTTemplate({out:path.join(work,'runtime'),log});
      const destination=path.join(artifacts,'runtime');await fs.mkdir(destination,{recursive:true});
      await fs.writeFile(path.join(destination,'runtime-x86_64'),runtime.bytes,{mode:0o644});
      await fs.writeFile(path.join(destination,'runtime.json'),JSON.stringify(runtime.manifest,null,2)+'\n');
    }else if(runtimeDirectory) {
      runtime={bytes:new Uint8Array(await fs.readFile(path.join(runtimeDirectory,'runtime-x86_64'))),
        manifest:JSON.parse(await fs.readFile(path.join(runtimeDirectory,'runtime.json'),'utf8'))};
    }else {
      checkLinuxAOTRuntimeProvenance(root);
      const {loadLinuxAOTRuntime}=await import('../packages/linux-native/src/aot-runtime.js');
      runtime=await loadLinuxAOTRuntime();
    }
    await verifyLinuxAOTRuntime(runtime.bytes,runtime.manifest);
    report.runtime=runtime.manifest;
    for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance(root)))
      assert.equal(runtime.manifest.provenance?.[name],value,'Native runtime source provenance: '+name);
    if(rebuild) {
      const source=path.join(root,'packages/linux-native/tests/gtk-contracts.cpp'),executable=path.join(work,'gtk-native-contracts');
      const includes=['-I',path.join(root,'packages/macos-native/native'),'-I',path.join(root,'packages/macos-native/aot'),'-I',path.join(root,'packages/linux-native/native')];
      const objects=runtime.build.objects.filter(entry=>entry.source!=='aot/template-main.cpp').map(entry=>entry.object);
      await run(runtime.build.compiler,['-std=c++17','-O2','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-deprecated-declarations',...includes,...runtime.build.cflags,source,...objects,...runtime.build.libraries,'-ldl','-pthread','-o',executable]);
      assert.match(await run(await linuxNativeTool('xvfb-run'),['-a',executable]),/LINUX_GTK_NATIVE_SIGNALS_OK/);
      report.gtkNativeSignalsVerified=true;
      report.checks.push('Native GTK signals and admitted widget types executed against the exact rebuilt SDK objects');
    }
    const template=path.join(work,'unpopulated-runtime');await fs.writeFile(template,runtime.bytes,{mode:0o755});
    await assert.rejects(run(template),error=>(error.exitCode??error.code)===2&&/unpopulated VB6 AOT runtime template/.test(error.output||''));
    report.checks.push('Unpopulated native template refuses execution');

    const nativeCase=async(label,project,optimization,validate,{gtk=false}={})=>{
      console.log('Executing '+label+' O'+optimization+(gtk?' with GTK':'')+'...');
      const compiled=compileLinuxAOT(project,{name:project.name+'-O'+optimization,optimization});
      const result=await linkLinuxAOT(compiled,runtime),directory=path.join(work,label+'-O'+optimization),executable=await writeApplication(result,directory);
      const image=inspectLinuxELF(result.executable,{requireProject:true});
      assert.equal(image.code.flags&7,5);assert.equal(image.metadata.flags&7,4);assert.ok(image.image.nonExecutableStack&&image.image.relro&&image.image.bindNow);
      const output=gtk?await run(await linuxNativeTool('xvfb-run'),['-a','--server-args=-screen 0 1280x900x24',executable]):await run(executable);
      if(validate)validate(output);
      const evidence={executableSha256:result.report.executableSha256,runtimeSha256:result.report.runtimeSha256,codeBytes:result.report.codeBytes,metadataBytes:result.report.metadataBytes,gtk,optimization};
      report.checks.push(label+' O'+optimization+': exact archived ELF executed');
      report[label+'-O'+optimization]=evidence;
      return {result,executable,compiled};
    };

    for(const optimization of [0,1,2,3]) {
      await nativeCase('language',conformanceProject(),optimization,validateConformance);
      await nativeCase('abi-platform',linuxBrowserProject(),optimization,output=>assert.match(output,/LINUX_BROWSER_AOT_OK/));
    }
    report.optimizationLevelsVerified=[0,1,2,3];report.conformanceVerified=true;report.resourcesVerified=true;
    const resourceCase=await nativeCase('resource-path',conformanceProject(),2,validateConformance);
    const env=await linuxNativeTool('env');
    validateConformance(await run(env,['PATH='+path.dirname(resourceCase.executable)+path.delimiter+(process.env.PATH||''),path.basename(resourceCase.executable)]));
    report.checks.push('PATH launch resolves executable-relative resources from another working directory');
    await nativeCase('program-roots',programLifetimeProject(),2,validateRoots);
    assert.deepEqual((await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8')).trim().split(/\r?\n/).sort(),['array','global','static']);
    await nativeCase('abrupt-End',abruptLifetimeProject(),2,output=>{
      assert.ok(!output.includes('NATIVE_PROGRAM_BODY_OK'));assert.ok(!output.includes('NATIVE_ROOT_RELEASED:'));
    });
    assert.equal(await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8'),'');
    await nativeCase('form-lifetime',formLifetimeProject(),2,output=>assert.match(output,/NATIVE_FORM_LIFETIME_OK/),{gtk:true});
    report.lifetimeVerified=true;

    const negative=conformanceProject(),arrayModule=negative.modules.find(module=>module.name==='NativeArrayChecks');
    arrayModule.code=arrayModule.code.replace('Debug.Assert Err.Number = 10','Debug.Assert Err.Number = 999');
    await assert.rejects(nativeCase('negative-assert',negative,2),error=>/Debug.Assert failed/.test(error.output||''));
    report.checks.push('An intentionally false native assertion fails acceptance');

    const large=await nativeCase('large',largeAOTProject(),2,output=>assert.match(output,/NATIVE_LARGE_AOT_OK/));
    assert.ok(large.result.report.codeBytes>2*1024*1024,'Growth acceptance needs more than 2 MiB of actual machine code.');
    assert.ok(large.result.report.metadataBytes>2*1024*1024,'Growth acceptance needs more than 2 MiB of actual project metadata.');
    report.codeMetadataGrowthVerified=true;

    // The GTK fixture exercises actual signals and disposes its own windows.
    const {linuxGtkProject}=await import('../packages/linux-native/tests/gtk-fixture.mjs');
    await nativeCase('gtk-controls',linuxGtkProject(),2,output=>assert.match(output,/LINUX_GTK_CONTROLS_OK/),{gtk:true});
    report.gtkExecutionVerified=true;

    const image=inspectLinuxELF(resourceCase.result.executable,{requireProject:true}),broken=resourceCase.result.executable.slice();
    new DataView(broken.buffer).setUint32(image.metadataOffset+8,0xffffffff,true);
    const corrupted=path.join(work,'corrupted-loader');await fs.writeFile(corrupted,broken,{mode:0o755});
    await assert.rejects(run(corrupted),error=>(error.exitCode??error.code)===2&&/Invalid AOT project payload sizes/.test(error.output||''));
    report.checks.push('Native loader rejects malformed project metadata before executing project code');
    for(const offset of [Math.ceil(image.codeSize/16)*16,4294967296]) {
      const badEntries=structuredClone(image.metadataJSON);badEntries.entries[0]=offset;
      const altered=new TextEncoder().encode(JSON.stringify(badEntries)),entryBytes=resourceCase.result.executable.slice();
      assert.ok(altered.length<=image.metadata.fileSize-(image.metadataOffset-image.metadata.offset)-16);
      new DataView(entryBytes.buffer).setUint32(image.metadataOffset+8,altered.length,true);entryBytes.set(altered,image.metadataOffset+16);
      const invalidEntry=path.join(work,'invalid-procedure-entry-'+offset);await fs.writeFile(invalidEntry,entryBytes,{mode:0o755});
      await assert.rejects(run(invalidEntry),error=>(error.exitCode??error.code)===2&&/Invalid AOT (procedure address|integer metadata)/.test(error.output||''));
    }
    report.checks.push('Native loader rejects out-of-code and overflowing procedure offsets');

    for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance(root)))
      assert.equal(runtime.manifest.provenance?.[name],value,'Source changed during native acceptance: '+name);
    report.x64ExecutionVerified=true;
    console.log('Linux native AOT acceptance passed.');
  }catch(error) {
    report.error={message:error.message,output:error.output||'',stack:error.stack||''};
    throw error;
  }finally {
    await fs.mkdir(reportDirectory,{recursive:true});
    await fs.writeFile(path.join(reportDirectory,'validation.json'),JSON.stringify(report,null,2)+'\n');
    await fs.writeFile(path.join(reportDirectory,'execution.log'),transcript);
    await fs.rm(work,{recursive:true,force:true});
  }
  return report;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options={},args=process.argv.slice(2);
    for(let index=0;index<args.length;++index){if(args[index]==='--rebuild')options.rebuild=true;else if(args[index]==='--runtime'&&args[index+1])options.runtimeDirectory=path.resolve(args[++index]);else throw new Error('Usage: node tools/test-linux-aot.mjs [--rebuild | --runtime DIRECTORY]');}
    await testLinuxAOT(options);
  }catch(error){console.error(error.stack||error.message,error.output||'');process.exitCode=1;}
}
