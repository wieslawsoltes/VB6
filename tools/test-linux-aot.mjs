/** Execute the exact exported ELF bytes; never substitute a C++ source oracle. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runTool} from '../packages/macos-native/src/build-driver.mjs';
import {conformanceProject} from '../packages/macos-native/tests/conformance.mjs';
import {programLifetimeProject,formLifetimeProject,abruptLifetimeProject} from '../packages/macos-native/tests/program-lifetime.mjs';
import {largeAOTProject} from '../packages/macos-native/tests/aot-large.mjs';
import {linuxBrowserProject} from '../tests/linux-browser-fixture.mjs';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';
import {linkLinuxAOT,unpackLinuxAOTArchive} from '../packages/linux-native/src/aot-export.js';
import {inspectLinuxELF,verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {buildLinuxAOTTemplate,linuxNativeTool,verifyLinuxAOTExecutionSysroot} from './build-linux-aot-template.mjs';
import {checkLinuxAOTRuntimeProvenance,readLinuxAOTSourceProvenance} from './linux-aot-provenance.mjs';
import {linuxTarget} from '../packages/linux-native/src/target.js';
import {qualifyLinuxPrinters} from '../packages/linux-native/tests/printer-contracts.mjs';
import {qualifyLinuxDisplays} from '../packages/linux-native/tests/display-contracts.mjs';
import {qualifyLinuxInstances} from '../packages/linux-native/tests/instance-contracts.mjs';
import {qualifyLinuxCompiledServices} from '../packages/linux-native/tests/compiled-service-contracts.mjs';
import {linuxRichTextProject} from '../packages/linux-native/tests/richtext.mjs';
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
export async function testLinuxAOT({architecture='x64',toolkit='gtk3',rebuild=false,runtimeDirectory,reportDirectory,sysroot,compiler,qemu,jobs=3}={}) {
  const target=linuxTarget(architecture,toolkit);architecture=target.option;
  reportDirectory??=path.join(root,'reports','linux-aot'+(toolkit==='gtk4'?'-gtk4':'')+(architecture==='arm64'?'-arm64':''));
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-linux-aot-tests-'));
  const artifacts=path.join(root,'artifacts/linux-aot');
  let transcript='';
  const report={platform:process.platform,toolkit,arch:architecture,architecture:target.architecture,hostArchitecture:process.arch,rebuild,
    executionMode:process.arch===architecture?'native':'qemu-user',[architecture+'ExecutionVerified']:false,machineCodeExecutionVerified:false,gtkExecutionVerified:false,
    richTextVerified:false,printerServicesVerified:false,previousInstanceVerified:false,checks:[]};
  const log=value=>{transcript+=value;if(transcript.length>16*1024*1024)transcript=transcript.slice(-16*1024*1024);};
  const run=(executable,args=[],options={})=>runTool(executable,args,{cwd:work,timeout:60000,log,...options});
  // Isolated Xvfb has neither a GPU nor an accessibility daemon. GTK4's Cairo
  // renderer and test accessibility backend let stderr remain a strict gate.
  // These variables apply only to fixture children, never to exported apps.
  let emulator,executionPrefix=toolkit==='gtk4'?[await linuxNativeTool('env'),'GDK_DEBUG=gl-disable:vulkan-disable','GSK_RENDERER=cairo','GTK_A11Y=test']:[await linuxNativeTool('env'),'NO_AT_BRIDGE=1'];
  const execute=async(executable,args=[],{gtk=false,argv0,pageBytes,timeout=60000}={})=>{
    let command=executable,arguments_=args;
    if(pageBytes&&!emulator)throw new Error('Page-size overrides require QEMU execution.');
    if(executionPrefix.length){command=executionPrefix[0];arguments_=[...executionPrefix.slice(1),...(pageBytes?['-p',String(pageBytes)]:[]),...(argv0?['-0',argv0]:[]),executable,...args];}
    if(gtk)return run(await linuxNativeTool('xvfb-run'),['-a','--server-args=-screen 0 1280x900x24',command,...arguments_],{timeout});
    return run(command,arguments_,{timeout});
  };
  try {
    assert.equal(process.platform,'linux','Linux AOT acceptance requires actual Linux execution.');
    assert.ok(['x64','arm64'].includes(process.arch),'Linux AOT acceptance requires a supported Linux host.');
    if(sysroot)sysroot=await fs.realpath(path.resolve(sysroot));
    if(process.arch!==architecture){
      if(!sysroot)throw new Error('Cross-architecture execution requires an explicit target sysroot.');
      report.sysrootEnvironment=await verifyLinuxAOTExecutionSysroot(sysroot,{architecture,toolkit});
      emulator=await linuxNativeTool(qemu||(architecture==='arm64'?'qemu-aarch64':'qemu-x86_64'));
      report.emulatorVersion=(await run(emulator,['--version'])).trim();
      // QEMU -L redirects dlopen, but GTK's faccessat-based module discovery
      // can still miss guest paths. Give this child process an explicit SDK
      // module path; neither the host environment nor shipped app is changed.
      executionPrefix=[...executionPrefix,await linuxNativeTool('env'),'GTK_PATH='+report.sysrootEnvironment.gtkModulePath,emulator,'-L',sysroot];
    }else if(qemu)throw new Error('Use native execution when the host already matches the requested architecture.');
    if(rebuild&&runtimeDirectory)throw new Error('--rebuild and --runtime are mutually exclusive.');
    await fs.mkdir(artifacts,{recursive:true});
    let runtime;
    if(rebuild) {
      console.log('Building the native Linux '+target.architecture+' GTK runtime...');
      runtime=await buildLinuxAOTTemplate({architecture,toolkit,out:path.join(work,'runtime'),sysroot,compiler,jobs,log});
      const destination=path.join(artifacts,'runtime'+(toolkit==='gtk4'?'-gtk4':'')+(architecture==='arm64'?'-arm64':''));await fs.mkdir(destination,{recursive:true});
      await fs.writeFile(path.join(destination,'runtime-'+target.architecture),runtime.bytes,{mode:0o644});
      await fs.writeFile(path.join(destination,'runtime.json'),JSON.stringify(runtime.manifest,null,2)+'\n');
    }else if(runtimeDirectory) {
      runtime={bytes:new Uint8Array(await fs.readFile(path.join(runtimeDirectory,'runtime-'+target.architecture))),
        manifest:JSON.parse(await fs.readFile(path.join(runtimeDirectory,'runtime.json'),'utf8'))};
    }else {
      checkLinuxAOTRuntimeProvenance(root,{architecture,toolkit});
      const {loadLinuxAOTRuntime}=await import('../packages/linux-native/src/aot-runtime.js');
      runtime=await loadLinuxAOTRuntime({architecture,toolkit});
    }
    await verifyLinuxAOTRuntime(runtime.bytes,runtime.manifest);
    assert.equal(runtime.manifest.architecture,target.architecture,'Runtime proof must execute the requested machine architecture.');
    assert.equal(runtime.manifest.toolkit??'gtk3',toolkit,'Runtime proof must execute the requested toolkit.');
    report.runtime=runtime.manifest;
    for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance(root)))
      assert.equal(runtime.manifest.provenance?.[name],value,'Native runtime source provenance: '+name);
    if(rebuild) {
      const includes=['-I',path.join(root,'packages/macos-native/native'),'-I',path.join(root,'packages/macos-native/aot'),'-I',path.join(root,'packages/linux-native/native')];
      const objects=runtime.build.objects.filter(entry=>entry.source!=='aot/template-main.cpp').map(entry=>entry.object);
      report.nativeFixtures={};
      const nativeFixture=async(name,filename,qualify)=>{
        console.log('Qualifying native '+name+' ('+target.architecture+')...');
        const source=path.join(root,'packages/linux-native/tests',filename),executable=path.join(work,'native-'+name);
        await run(runtime.build.compiler,[...runtime.build.compilerFlags,'-std=c++17','-O2','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-deprecated-declarations',...includes,...runtime.build.cflags,source,...runtime.build.linkOptions,...objects,...runtime.build.libraries,'-ldl','-pthread','-o',executable],{timeout:600000});
        const bytes=await fs.readFile(executable),image=inspectLinuxELF(bytes,{architecture});
        assert.equal(image.image.machine,target.machine);
        const qualification=await qualify(executable);
        report.nativeFixtures[name]={passed:true,runtimeSha256:runtime.manifest.sha256,executableSha256:createHash('sha256').update(bytes).digest('hex'),
          architecture:target.architecture,machine:target.machine,callingConvention:target.callingConvention,...(qualification?{qualification}:{})};
        console.log('Native '+name+' qualification passed.');
        return {executable,evidence:report.nativeFixtures[name]};
      };
      await nativeFixture('gtkSignals','gtk-contracts.cpp',async executable=>{
        // QEMU's GTK initialization alone can take over twenty seconds. Keep
        // the real 1,025-level model and signal stress checks within a bounded
        // emulation budget; native hardware retains the ordinary timeout.
        assert.match(await execute(executable,[],{gtk:true,timeout:emulator?180000:60000}),/LINUX_GTK_NATIVE_SIGNALS_OK/);
      });
      report.gtkNativeSignalsVerified=true;
      report.checks.push('Native GTK signals and admitted widget types executed against the exact rebuilt SDK objects');
      await nativeFixture('richText','gtk-richtext-contracts.cpp',async executable=>{
        const output=await execute(executable,[],{gtk:true});
        assert.match(output,/LINUX_RTF_PARSER_OK/);assert.match(output,/LINUX_GTK_RICHTEXT_OK/);
      });
      const prefix=[...executionPrefix];
      await nativeFixture('displayBackends','gtk-display-contracts.cpp',async executable=>qualifyLinuxDisplays(executable,{prefix,emulated:!!emulator}));
      report.checks.push('Native GTK forms, rich documents and timer lifetime passed actual X11/Openbox and Wayland/Weston display boundaries');
      const services=await nativeFixture('printers','gtk-services-contracts.cpp',async executable=>qualifyLinuxPrinters(executable,{prefix,printPrefix:[await linuxNativeTool('xvfb-run'),'-a'],emulated:!!emulator}));
      const instances=await qualifyLinuxInstances(services.executable,{prefix});
      report.nativeFixtures.previousInstance={...services.evidence,qualification:instances};
      report.checks.push('Native rich text, CUPS printing and concurrent application instances executed against the exact rebuilt SDK objects');
    }
    const template=path.join(work,'unpopulated-runtime');await fs.writeFile(template,runtime.bytes,{mode:0o755});
    await assert.rejects(execute(template),error=>(error.exitCode??error.code)===2&&/unpopulated VB6 AOT runtime template/.test(error.output||''));
    report.checks.push('Unpopulated native template refuses execution');

    const nativeCase=async(label,project,optimization,validate,{gtk=false}={})=>{
      console.log('Executing '+label+' O'+optimization+(gtk?' with GTK':'')+'...');
      const compiled=compileLinuxAOT(project,{architecture,toolkit,name:project.name+'-O'+optimization,optimization});
      const result=await linkLinuxAOT(compiled,runtime),directory=path.join(work,label+'-O'+optimization),executable=await writeApplication(result,directory);
      const image=inspectLinuxELF(result.executable,{requireProject:true,architecture});
      assert.equal(image.image.machine,target.machine);assert.equal(image.image.callingConvention,target.callingConvention);
      assert.equal(image.code.alignment,target.pageBytes);assert.equal(image.metadata.alignment,target.pageBytes);
      assert.equal(image.code.flags&7,5);assert.equal(image.metadata.flags&7,4);assert.ok(image.image.nonExecutableStack&&image.image.relro&&image.image.bindNow);
      const output=await execute(executable,[],{gtk});
      if(validate)validate(output);
      const evidence={executableSha256:result.report.executableSha256,runtimeSha256:result.report.runtimeSha256,architecture:target.architecture,machine:target.machine,callingConvention:target.callingConvention,codeBytes:result.report.codeBytes,metadataBytes:result.report.metadataBytes,gtk,optimization};
      report.checks.push(label+' O'+optimization+': exact archived ELF executed');
      report[label+'-O'+optimization]=evidence;
      return {result,executable,compiled};
    };

    for(const optimization of [0,1,2,3]) {
      await nativeCase('language',conformanceProject(),optimization,validateConformance);
      await nativeCase('abi-platform',linuxBrowserProject(architecture,toolkit),optimization,output=>assert.match(output,/LINUX_BROWSER_AOT_OK/));
    }
    report.optimizationLevelsVerified=[0,1,2,3];report.conformanceVerified=true;report.resourcesVerified=true;
    const resourceCase=await nativeCase('resource-path',conformanceProject(),2,validateConformance);
    const env=await linuxNativeTool('env');
    if(emulator)validateConformance(await execute(resourceCase.executable,[],{argv0:path.basename(resourceCase.executable)}));
    else validateConformance(await run(env,['PATH='+path.dirname(resourceCase.executable)+path.delimiter+(process.env.PATH||''),path.basename(resourceCase.executable)]));
    report.checks.push('PATH-style argv[0] resolves executable-relative resources from another working directory');
    if(emulator&&architecture==='arm64'){
      report.emulatedPageSizesVerified=[];report.emulatedPageCases={};
      for(const pageBytes of [4096,16384,65536]){
        validateConformance(await execute(resourceCase.executable,[],{pageBytes}));
        report.emulatedPageSizesVerified.push(pageBytes);
        report.emulatedPageCases[pageBytes]={...report['resource-path-O2'],pageBytes};
      }
      report.checks.push('The same ARM64 archived conformance ELF executed with QEMU 4/16/64 KiB page settings');
    }
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
    await nativeCase('richtext',linuxRichTextProject(),2,output=>assert.match(output,/LINUX_RICH_PERSISTENCE_OK/),{gtk:true});
    const serviceProof=await qualifyLinuxCompiledServices(runtime,{architecture,toolkit,prefix:[...executionPrefix]});
    assert.equal(serviceProof.passed,true);report.compiledServices=serviceProof;
    report['compiled-printers-O3']=serviceProof.artifacts.printer;
    report['compiled-instance-O3']=serviceProof.artifacts.instance;
    report.richTextVerified=true;report.printerServicesVerified=true;report.previousInstanceVerified=true;
    report.checks.push('Archived AOT executables passed RTF persistence, printer collection/selection and headless previous-instance contracts');

    const image=inspectLinuxELF(resourceCase.result.executable,{requireProject:true}),broken=resourceCase.result.executable.slice();
    new DataView(broken.buffer).setUint32(image.metadataOffset+8,0xffffffff,true);
    const corrupted=path.join(work,'corrupted-loader');await fs.writeFile(corrupted,broken,{mode:0o755});
    await assert.rejects(execute(corrupted),error=>(error.exitCode??error.code)===2&&/Invalid AOT project payload sizes/.test(error.output||''));
    report.checks.push('Native loader rejects malformed project metadata before executing project code');
    for(const offset of [Math.ceil(image.codeSize/16)*16,4294967296]) {
      const badEntries=structuredClone(image.metadataJSON);badEntries.entries[0]=offset;
      const altered=new TextEncoder().encode(JSON.stringify(badEntries)),entryBytes=resourceCase.result.executable.slice();
      assert.ok(altered.length<=image.metadata.fileSize-(image.metadataOffset-image.metadata.offset)-16);
      new DataView(entryBytes.buffer).setUint32(image.metadataOffset+8,altered.length,true);entryBytes.set(altered,image.metadataOffset+16);
      const invalidEntry=path.join(work,'invalid-procedure-entry-'+offset);await fs.writeFile(invalidEntry,entryBytes,{mode:0o755});
      await assert.rejects(execute(invalidEntry),error=>(error.exitCode??error.code)===2&&/Invalid AOT (procedure address|integer metadata)/.test(error.output||''));
    }
    report.checks.push('Native loader rejects out-of-code and overflowing procedure offsets');

    for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance(root)))
      assert.equal(runtime.manifest.provenance?.[name],value,'Source changed during native acceptance: '+name);
    report[architecture+'ExecutionVerified']=true;report.machineCodeExecutionVerified=true;
    console.log('Linux native AOT acceptance passed.');
  }catch(error) {
    report.error={message:error.message,output:error.output||'',stack:error.stack||'',tool:error.tool,code:error.code,timeout:error.timeout,exitCode:error.exitCode};
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
    for(let index=0;index<args.length;++index){
      const key=args[index];
      if(key==='--rebuild')options.rebuild=true;
      else if(['--runtime','--architecture','--toolkit','--sysroot','--qemu','--compiler','--report','--jobs'].includes(key)&&args[index+1]){
        const value=args[++index];options[{'--runtime':'runtimeDirectory','--report':'reportDirectory'}[key]||key.slice(2)]=key==='--jobs'?Number(value):value;
      }else throw new Error('Usage: node tools/test-linux-aot.mjs [--architecture x64|arm64] [--toolkit gtk3|gtk4] [--rebuild | --runtime DIRECTORY] [--sysroot DIRECTORY] [--qemu PATH] [--compiler PATH] [--report DIRECTORY] [--jobs N]');
    }
    await testLinuxAOT(options);
  }catch(error){console.error(error.stack||error.message,error.output||'');process.exitCode=1;}
}
