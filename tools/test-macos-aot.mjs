/** Execute the helper-call oracle AND, on Apple Silicon, the actual exported code.
 * The portable oracle is a diagnostic, never a substitute for ARM64 execution. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {runTool} from '../packages/macos-native/src/build-driver.mjs';
import {compileMacOSAOT,emitAOTPortableTestSource} from '../packages/macos-native/src/aot-compiler.js';
import {exportMacOSAOT,verifyMacOSAOTArchive} from '../packages/macos-native/src/aot-export.js';
import {recordsetProject} from '../packages/macos-native/tests/recordsets.mjs';
import {macOSDataSampleProject} from './macos-data-sample-fixture.mjs';
import {resourceFormProject} from '../packages/macos-native/tests/resources.mjs';
import {conformanceProject} from '../packages/macos-native/tests/conformance.mjs';
import {programLifetimeProject,formLifetimeProject,abruptLifetimeProject} from '../packages/macos-native/tests/program-lifetime.mjs';
import {richTextProject} from '../packages/macos-native/tests/richtext.mjs';
import {largeAOTProject} from '../packages/macos-native/tests/aot-large.mjs';
import {buildAOTTemplate} from './build-macos-aot-template.mjs';
const root=path.resolve(import.meta.dirname,'..'),sdk=path.join(root,'packages/macos-native'),work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-direct-aot-'));
const artifacts=path.join(root,'artifacts/macos-aot'),reports=path.join(root,'reports/macos-aot');
let transcript='';const log=text=>{process.stderr.write(text);transcript+=text;if(transcript.length>16*1024*1024)transcript=transcript.slice(-16*1024*1024);};
const report={platform:process.platform,arch:process.arch,portableOracleVerified:false,arm64ExecutionVerified:false,nativeSignatureVerified:false,checks:[]};
const run=(exe,args,options={})=>runTool(exe,args,{cwd:work,timeout:180000,log,...options});
const markersForResource=output=>{for(const marker of ['NATIVE_RESOURCES_OK','NATIVE_RESOURCE_FORM_OK'])assert.ok(output.includes(marker),marker);};
const markers=output=>{for(const marker of ['NATIVE_RECORDSETS_OK','NATIVE_CONFORMANCE_OK','NATIVE_INTERFACES_OK','NATIVE_LIFETIMES_OK','NATIVE_ARRAYS_OK','NATIVE_SCOPES_OK','NATIVE_RESOURCES_OK'])assert.ok(output.includes(marker),'Missing '+marker);};
try{
  await fs.mkdir(artifacts,{recursive:true});
  const mac=process.platform==='darwin';if(mac)assert.equal(process.arch,'arm64','Native test requires actual Apple Silicon, not Rosetta');
  const compiler=mac?await run('/usr/bin/xcrun',['--find','clang++']):execFileSync('/bin/sh',['-c','command -v clang++'],{encoding:'utf8'}).trim();
  const flags=['-std=c++17','-O0','-g','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I',path.join(sdk,'native'),'-I',path.join(sdk,'aot')];
  if(mac)flags.push('-arch','arm64','-isysroot',await run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path']));
  const sources=(await fs.readdir(path.join(sdk,'native'))).filter(n=>n.endsWith('.cpp')).sort().map(n=>path.join(sdk,'native',n));
  sources.push(path.join(sdk,'tests','portable-host.cpp'),path.join(sdk,'aot','helpers.cpp'),path.join(sdk,'aot','runtime.cpp'));
  const objects=sources.map((_,i)=>path.join(work,i+'.o'));let next=0;const errors=[];
  async function worker(){while(!errors.length){const i=next++;if(i>=sources.length)return;try{await run(compiler,[...flags,'-c',sources[i],'-o',objects[i]]);}catch(error){errors.push(error);}}}
  await Promise.all(Array.from({length:3},worker));if(errors.length)throw errors[0];
  const recordIdentity=path.join(work,'aot-record-identity');
  await run(compiler,[...flags,path.join(sdk,'tests/aot-record-identity.cpp'),...objects,'-o',recordIdentity]);
  assert.match(await run(recordIdentity,[]),/NATIVE_AOT_RECORD_IDENTITY_DEFAULTS_OK/);
  report.checks.push('ASan/UBSan record identity, reflection metadata defaults and lazy dynamic record fields');
  const records=path.join(work,'recordsets-core');
  await run(compiler,[...flags,path.join(sdk,'tests/recordsets.cpp'),...objects,'-o',records]);
  assert.match(await run(records,[]),/NATIVE_RECORDSETS_CORE_OK/);report.recordsetCoreVerified=true;
  const notifications=path.join(work,'recordset-notifications');
  await run(compiler,[...flags,path.join(sdk,'tests/recordset-notifications.cpp'),...objects,'-o',notifications]);
  assert.match(await run(notifications,[]),/NATIVE_RECORDSET_NOTIFICATIONS_OK/);
  report.recordsetNotificationsVerified=true;
  const ownership=path.join(work,'scope-ownership');
  await run(compiler,[...flags,path.join(sdk,'tests/scopes.cpp'),...objects,'-o',ownership]);
  assert.ok((await run(ownership,[])).includes('NATIVE_SCOPE_OWNERSHIP_OK'));
  report.scopeOwnershipVerified=true;
  const programLife=path.join(work,'program-lifetime');
  await run(compiler,[...flags,path.join(sdk,'tests/program-lifetime.cpp'),...objects,'-o',programLife]);
  assert.match(await run(programLife,[]),/NATIVE_PROGRAM_LIFETIME_OK/);
  const rootMarkers=output=>{
    assert.ok(output.indexOf('NATIVE_PROGRAM_BODY_OK')>=0);
    for(const label of ['global','array','static']){
      const marker='NATIVE_ROOT_RELEASED:'+label;
      assert.ok(output.indexOf(marker)>output.indexOf('NATIVE_PROGRAM_BODY_OK'),'Missing post-body finalizer '+label);
      assert.equal(output.split(marker).length,2,'Finalizer must run once');
    }
  };
  const rootSource=path.join(work,'root-oracle.cpp'),rootOracle=path.join(work,'root-oracle');
  await fs.writeFile(rootSource,emitAOTPortableTestSource(compileMacOSAOT(programLifetimeProject())));
  await run(compiler,[...flags,rootSource,...objects,'-o',rootOracle]);
  rootMarkers(await run(rootOracle,[]));
  assert.deepEqual((await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8')).trim().split(/\r?\n/).sort(),['array','global','static']);
  const abruptMarkers=output=>{
    assert.ok(!output.includes('NATIVE_PROGRAM_BODY_OK'),'End must not fall through');
    assert.ok(!output.includes('NATIVE_ROOT_RELEASED:'),'End must not invoke Terminate');
  };
  const abruptSource=path.join(work,'abrupt-oracle.cpp'),abruptOracle=path.join(work,'abrupt-oracle');
  await fs.writeFile(abruptSource,emitAOTPortableTestSource(compileMacOSAOT(abruptLifetimeProject())));
  await run(compiler,[...flags,abruptSource,...objects,'-o',abruptOracle]);
  abruptMarkers(await run(abruptOracle,[]));
  assert.equal(await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8'),'');
  report.programRootOracleVerified=true;report.abruptExitOracleVerified=true;
  const project=conformanceProject(),compiled=compileMacOSAOT(project),source=path.join(work,'oracle.cpp'),oracle=path.join(work,'portable.app/Contents/MacOS/oracle');
  await fs.mkdir(path.dirname(oracle),{recursive:true});await fs.mkdir(path.join(work,'portable.app/Contents/Resources'));
  const catalog=compiled.resourceFiles['resources/vb6-assets.bin'];assert.ok(catalog?.length);
  const catalogPath=path.join(work,'portable.app/Contents/Resources/vb6-assets.bin');await fs.writeFile(catalogPath,catalog);
  const resourceTest=path.join(work,'resource-contracts');
  await run(compiler,[...flags,path.join(sdk,'tests/resources.cpp'),...objects,'-o',resourceTest]);
  assert.match(await run(resourceTest,[catalogPath]),/NATIVE_RESOURCE_PARSER_OK/);report.resourceParserVerified=true;
  await fs.writeFile(source,emitAOTPortableTestSource(compiled));await run(compiler,[...flags,source,...objects,'-o',oracle]);markers(await run(oracle,[]));
  // A faulty expected error must fail the native test, not be swallowed by
  // the VB Resume Next statement used to provoke the error under test.
  const broken=structuredClone(project),arrayModule=broken.modules.find(m=>m.name==='NativeArrayChecks');
  arrayModule.code=arrayModule.code.replace('Debug.Assert Err.Number = 10','Debug.Assert Err.Number = 999');
  const badSource=path.join(work,'negative-oracle.cpp'),badOracle=path.join(path.dirname(oracle),'negative-oracle');
  await fs.writeFile(badSource,emitAOTPortableTestSource(compileMacOSAOT(broken)));
  await run(compiler,[...flags,badSource,...objects,'-o',badOracle]);
  await assert.rejects(run(badOracle,[]),error=>/VB6 error 5: Debug.Assert failed/.test(error.output||''));
  report.portableOracleVerified=true;report.checks.push('ASan/UBSan native-helper graph, interfaces and lifetimes','Array acceptance rejects an intentionally false error assertion');
  if(mac){
    const runtime=await buildAOTTemplate({out:path.join(artifacts,'runtime'),cache:path.join(work,'cache'),log});
    report.runtime=runtime.manifest;
    // Qualify decoded pixels and real controls against the exact SDK archive
    // that supplied this template, not only generated image-property getters.
    const ui=path.join(work,'appkit-resource-controls');
    const uiSources=(await fs.readdir(path.join(sdk,'tests'))).filter(name=>/^appkit(?:-[a-z-]+)?\.mm$/.test(name)).sort().map(name=>path.join(sdk,'tests',name));
    await run(compiler,['-std=c++17','-arch','arm64','-isysroot',await run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path']),'-mmacosx-version-min=11.0','-fobjc-arc','-I',path.join(sdk,'native'),...uiSources,path.join(work,'cache',runtime.manifest.provenance.nativeRuntimeSha256,'libvb6-native.a'),'-framework','AppKit','-framework','Foundation','-framework','CoreGraphics','-framework','QuartzCore','-o',ui]);
    await run('/usr/bin/codesign',['--sign','-','--timestamp=none',ui]);
    const uiOutput=await run(ui,[]);
    for(const marker of ['APPKIT_RECORDSETS_OK','APPKIT_PICTURE_FRAMES_OK','APPKIT_PICTURES_OK','APPKIT_CONFORMANCE_OK','APPKIT_EDIT_SELECTION_LIST_OK','APPKIT_RICH_SELECTION_OK','APPKIT_APPEARANCE_OK'])assert.ok(uiOutput.includes(marker),marker);
    report.recordsetControlsVerified=true;report.pictureControlsVerified=true;report.multiResolutionPicturesVerified=true;
    report.appearanceControlsVerified=true;report.checks.push('Native macOS appearance, field-editor identity, semantic colors and material containers');
    for(const optimization of [0,1,2,3])for(const [label,p,validate]of [['recordsets',recordsetProject(),output=>assert.ok(output.includes('NATIVE_RECORDSETS_OK'))],['original-data',macOSDataSampleProject(),output=>assert.ok(output.includes('NATIVE_ORIGINAL_DATA_OK'))],['conformance',project,markers],['richtext',richTextProject(),output=>assert.ok(output.includes('NATIVE_RICH_FORM_OK'))],['large',largeAOTProject(),output=>assert.ok(output.includes('NATIVE_LARGE_AOT_OK'))],['roots',programLifetimeProject(),rootMarkers],['abrupt',abruptLifetimeProject(),abruptMarkers],['forms',formLifetimeProject(),output=>assert.ok(output.includes('NATIVE_FORM_LIFETIME_OK'))],['resources',resourceFormProject(),output=>{markersForResource(output);}]] ){
      const key=label+'-O'+optimization,options={optimization,name:p.name+(optimization===2?'':'-O'+optimization)};
      const result=await exportMacOSAOT(p,runtime,options);
      if(label==='large'){assert.ok(result.report.codeBytes>2097152,'Native large program must exceed old code cap');assert.ok(result.report.metadataBytes>2097152,'Native large program must exceed old metadata cap');}
      await verifyMacOSAOTArchive(result.bytes,result.options);
      const archive=path.join(artifacts,result.filename),expanded=path.join(work,key);await fs.writeFile(archive,result.bytes);await fs.mkdir(expanded);
      await run('/usr/bin/ditto',['-x','-k',archive,expanded]);
      const app=path.join(expanded,result.options.name+'.app'),executable=path.join(app,'Contents','MacOS',result.options.name);
      // Crucially, do NOT invoke Clang on project source or re-sign with codesign.
      await run('/usr/bin/codesign',['--verify','--strict','--verbose=2',app]);
      validate(await run(executable,[]));
      if(label==='roots')assert.deepEqual((await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8')).trim().split(/\r?\n/).sort(),['array','global','static']);
      if(label==='abrupt')assert.equal(await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8'),'');
      report.checks.push(key+': direct ARM64 code executed and app signature verified');
      report[key]={sha256:result.report.sha256,executableSha256:result.report.executableSha256,codeBytes:result.report.codeBytes,metadataBytes:result.report.metadataBytes,optimization:result.report.projectOptimization};
      if(optimization===2)report[label]=report[key];
    }
    report.recordsetsVerified=true;report.resourcesVerified=true;report.programLifetimeVerified=true;report.abruptExitVerified=true;
    report.largeCapacityVerified=true;report.optimizationLevelsVerified=[0,1,2,3];
    report.arm64ExecutionVerified=true;report.nativeSignatureVerified=true;
  }
}catch(error){report.error={message:error.message,output:error.output||''};console.error(error.stack,error.output||'');process.exitCode=1;}
finally{await fs.mkdir(reports,{recursive:true});await fs.writeFile(path.join(reports,'validation.json'),JSON.stringify(report,null,2)+'\n');await fs.writeFile(path.join(reports,'execution.log'),transcript);await fs.rm(work,{recursive:true,force:true});}
