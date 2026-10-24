/** Execute the native target; never replace a macOS run with a mock. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildMacOSPackage} from './build-macos-native.mjs';
import {runTool,writeBuildKit,buildNativeKit} from '../packages/macos-native/src/build-driver.mjs';
import {macOSDataSampleProject} from './macos-data-sample-fixture.mjs';
import {resourceFormProject} from '../packages/macos-native/tests/resources.mjs';
import {conformanceProject} from '../packages/macos-native/tests/conformance.mjs';
import {programLifetimeProject,formLifetimeProject,abruptLifetimeProject} from '../packages/macos-native/tests/program-lifetime.mjs';
import {richTextProject} from '../packages/macos-native/tests/richtext.mjs';
import {verifyPascalSourceKitExecution} from './test-pascal-source-kit.mjs';
const root=path.resolve(import.meta.dirname,'..');buildMacOSPackage(root);
const {compileMacOS,createMacOSBuildKit,MacOSCompilerClient,verifyMacOSAppArchive}=await import('../packages/macos-native/dist/index.js');
const sdk=path.join(root,'packages/macos-native'),native=path.join(sdk,'native');
const work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-native-test-'));
let transcript='';
const log=text=>{process.stderr.write(text);transcript+=text;if(transcript.length>16*1024*1024)transcript=transcript.slice(-16*1024*1024);};
const report={platform:process.platform,arch:process.arch,macOSExecutionVerified:false,checks:[]};
const run=async(executable,args,options={})=>{console.log('RUN',path.basename(executable),args.slice(0,4).join(' '));return runTool(executable,args,{cwd:work,timeout:180000,...options});};
const generatedPassed=output=>{
  for(const marker of ['NATIVE_RECORDSETS_OK','NATIVE_CONFORMANCE_OK','NATIVE_INTERFACES_OK','NATIVE_LIFETIMES_OK','NATIVE_ARRAYS_OK','NATIVE_SCOPES_OK','NATIVE_RESOURCES_OK'])assert.ok(output.includes(marker),'Missing native marker: '+marker);
};
// Compile SDK objects once; all sanitizer executables link the identical objects.
// Settle every in-flight compiler before propagating a failure or removing work.
async function compileRuntime(compiler,flags,sources){
  const objects=sources.map((source,index)=>path.join(work,`runtime-${index}.o`));
  let next=0;const errors=[];
  async function worker(){while(!errors.length){const index=next++;if(index>=sources.length)return;try{await run(compiler,[...flags,'-c',sources[index],'-o',objects[index]]);}catch(error){errors.push(error);}}}
  await Promise.all(Array.from({length:Math.min(3,sources.length)},worker));
  if(errors.length)throw errors[0];return objects;
}
const compiler=process.platform==='darwin'?await run('/usr/bin/xcrun',['--find','clang++']):execFileSync('/bin/sh',['-c','command -v clang++'],{encoding:'utf8'}).trim();
try {
  report.compiler=await run(compiler,['--version']);
  const platformFlags=process.platform==='darwin'?['-arch','arm64','-isysroot',await run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path'])]:[];
  const flags=[...platformFlags,'-std=c++17','-O0','-g','-Wall','-Wextra','-Werror','-fsanitize=address,undefined','-I',native];
  const runtime=(await fs.readdir(native)).filter(n=>n.endsWith('.cpp')).sort().map(n=>path.join(native,n));
  const objects=await compileRuntime(compiler,flags,[...runtime,path.join(sdk,'tests/portable-host.cpp')]);
  report.checks.push(...await verifyPascalSourceKitExecution({compileMacOS,compiler,flags,objects,work,run}));
  const records=path.join(work,'recordsets-core');
  await run(compiler,[...flags,path.join(sdk,'tests/recordsets.cpp'),...objects,'-o',records]);
  assert.match(await run(records,[]),/NATIVE_RECORDSETS_CORE_OK/);report.checks.push('sanitized-recordset-grid-core');
  const values=path.join(work,'values');
  await run(compiler,[...flags,path.join(sdk,'tests/values.cpp'),...objects,'-o',values]);
  assert.match(await run(values,[]),/native value contracts passed/);report.checks.push('sanitized-values');
  const notifications=path.join(work,'recordset-notifications');
  await run(compiler,[...flags,path.join(sdk,'tests/recordset-notifications.cpp'),...objects,'-o',notifications]);
  assert.match(await run(notifications,[]),/NATIVE_RECORDSET_NOTIFICATIONS_OK/);
  report.checks.push('sanitized-recordset-notifications');
  const ownership=path.join(work,'scope-ownership');
  await run(compiler,[...flags,path.join(sdk,'tests/scopes.cpp'),...objects,'-o',ownership]);
  assert.match(await run(ownership,[]),/NATIVE_SCOPE_OWNERSHIP_OK/);report.checks.push('sanitized-nested-scope-ownership');
  const programLife=path.join(work,'program-lifetime');
  await run(compiler,[...flags,path.join(sdk,'tests/program-lifetime.cpp'),...objects,'-o',programLife]);
  assert.match(await run(programLife,[]),/NATIVE_PROGRAM_LIFETIME_OK/);
  const rootSource=path.join(work,'root-lifetime.cpp'),rootExecutable=path.join(work,'root-lifetime');
  await fs.writeFile(rootSource,compileMacOS(programLifetimeProject()).files['main.cpp']);
  await run(compiler,[...flags,rootSource,...objects,'-o',rootExecutable]);
  const rootOutput=await run(rootExecutable,[]);
  for(const label of ['global','array','static'])assert.ok(rootOutput.includes('NATIVE_ROOT_RELEASED:'+label));
  assert.deepEqual((await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8')).trim().split(/\r?\n/).sort(),['array','global','static']);
  const abruptSource=path.join(work,'abrupt-lifetime.cpp'),abruptExecutable=path.join(work,'abrupt-lifetime');
  await fs.writeFile(abruptSource,compileMacOS(abruptLifetimeProject()).files['main.cpp']);
  await run(compiler,[...flags,abruptSource,...objects,'-o',abruptExecutable]);
  const abruptOutput=await run(abruptExecutable,[]);
  assert.ok(!abruptOutput.includes('NATIVE_PROGRAM_BODY_OK'));
  assert.ok(!abruptOutput.includes('NATIVE_ROOT_RELEASED:'));
  assert.equal(await fs.readFile(path.join(work,'native-program-lifetime.txt'),'utf8'),'');
  report.checks.push('sanitized-program-root-lifecycle','generated-normal-root-cleanup','generated-abrupt-End-skips-finalizers');
  const project=conformanceProject(),compiled=compileMacOS(project),source=path.join(work,'main.cpp');
  await fs.writeFile(source,compiled.files['main.cpp']);
  const portable=path.join(work,'portable.app/Contents/MacOS/portable');
  await fs.mkdir(path.dirname(portable),{recursive:true});await fs.mkdir(path.join(work,'portable.app/Contents/Resources'));
  const catalogPath=path.join(work,'portable.app/Contents/Resources/vb6-assets.bin');await fs.writeFile(catalogPath,compiled.files['resources/vb6-assets.bin']);
  const resourceTest=path.join(work,'resource-contracts');await run(compiler,[...flags,path.join(sdk,'tests/resources.cpp'),...objects,'-o',resourceTest]);
  assert.match(await run(resourceTest,[catalogPath]),/NATIVE_RESOURCE_PARSER_OK/);report.checks.push('sanitized-resource-parser');
  await run(compiler,[...flags,source,...objects,'-o',portable]);
  const portableOutput=await run(portable,[]);generatedPassed(portableOutput);report.checks.push('sanitized-generated-program','native-interface-dispatch','native-class-finalization');
  const lifetime=path.join(path.dirname(portable),'interface-lifetime');
  await run(compiler,[...flags,'-DVB6_NATIVE_NO_MAIN',source,...objects,path.join(sdk,'tests/interface-lifetime.cpp'),'-o',lifetime]);
  assert.match(await run(lifetime,[]),/NATIVE_INTERFACE_LIFETIME_OK/);report.checks.push('sanitized-interface-view-lifetime');
  const classes=path.join(work,'class-lifetime');
  await run(compiler,[...flags,path.join(sdk,'tests/class-lifetime.cpp'),...objects,'-o',classes]);
  assert.match(await run(classes,[]),/NATIVE_CLASS_LIFETIME_OK/);report.checks.push('sanitized-class-lifetime-boundaries');
  const kit=createMacOSBuildKit(project),kitDir=path.join(work,'kit');
  await writeBuildKit(kitDir,kit.files);report.checks.push('standalone-build-kit');
  report.sourceSha256=createHash('sha256').update(compiled.files['main.cpp']).digest('hex');
  if(process.platform==='darwin') {
    assert.equal(process.arch,'arm64','Native macOS CI must execute on Apple Silicon');
    const cache=path.join(work,'cache'),out=path.join(work,'out');
    const built=await buildNativeKit(kitDir,{out,cache,jobs:3,log});
    assert.equal(built.architecture,'arm64');assert.equal(built.signatureVerified,true);
    generatedPassed(await run(built.executable,[]));report.checks.push('signed-arm64-app-execution');
    const sdkPath=await run('/usr/bin/xcrun',['--sdk','macosx','--show-sdk-path']);
    const ui=path.join(work,'appkit-tests');
    const uiSources=(await fs.readdir(path.join(sdk,'tests'))).filter(name=>/^appkit(?:-[a-z-]+)?\.mm$/.test(name)).sort().map(name=>path.join(sdk,'tests',name));
    await run(compiler,['-std=c++17','-arch','arm64','-isysroot',sdkPath,'-mmacosx-version-min=11.0','-fobjc-arc','-I',native,...uiSources,path.join(cache,built.runtimeSha256,'libvb6-native.a'),'-framework','AppKit','-framework','Foundation','-framework','CoreGraphics','-framework','QuartzCore','-o',ui]);
    await run('/usr/bin/codesign',['--sign','-','--timestamp=none',ui]);
    const uiOutput=await run(ui,[],{timeout:30000});assert.match(uiOutput,/APPKIT_RECORDSETS_OK/);assert.match(uiOutput,/APPKIT_CONFORMANCE_OK/);assert.match(uiOutput,/APPKIT_EDIT_SELECTION_LIST_OK/);assert.match(uiOutput,/APPKIT_RICH_SELECTION_OK/);assert.match(uiOutput,/APPKIT_PICTURES_OK/);assert.match(uiOutput,/APPKIT_APPEARANCE_OK/);report.checks.push('appkit-controls-events-api','appkit-live-edit-selection-lists','appkit-rich-selection-formatting','appkit-macos26-appearance');
    const richKit=createMacOSBuildKit(richTextProject()),richDir=path.join(work,'rich-form-kit');
    await writeBuildKit(richDir,richKit.files);
    const richBuilt=await buildNativeKit(richDir,{out:path.join(work,'rich-form-out'),cache,jobs:3,log});
    assert.equal(richBuilt.architecture,'arm64');assert.equal(richBuilt.signatureVerified,true);assert.equal(richBuilt.cacheHit,true);
    assert.match(await run(richBuilt.executable,[]),/NATIVE_RICH_FORM_OK/);
    report.checks.push('signed-generated-rich-form-execution');
    const formKit=createMacOSBuildKit(formLifetimeProject()),formDir=path.join(work,'form-lifetime-kit');
    await writeBuildKit(formDir,formKit.files);
    const formBuilt=await buildNativeKit(formDir,{out:path.join(work,'form-lifetime-out'),cache,jobs:3,log});
    assert.equal(formBuilt.signatureVerified,true);assert.equal(formBuilt.cacheHit,true);
    assert.match(await run(formBuilt.executable,[]),/NATIVE_FORM_LIFETIME_OK/);
    report.checks.push('signed-default-form-lifetime-execution');

    const pictureKit=createMacOSBuildKit(resourceFormProject()),pictureDir=path.join(work,'picture-kit');
    await writeBuildKit(pictureDir,pictureKit.files);
    const pictureBuilt=await buildNativeKit(pictureDir,{out:path.join(work,'picture-out'),cache,jobs:3,log});
    assert.equal(pictureBuilt.signatureVerified,true);assert.equal(pictureBuilt.cacheHit,true);
    assert.match(await run(pictureBuilt.executable,[]),/NATIVE_RESOURCE_FORM_OK/);report.checks.push('signed-resource-form-execution');
    const dataDir=path.join(work,'original-data-kit');await writeBuildKit(dataDir,createMacOSBuildKit(macOSDataSampleProject()).files);
    const dataBuilt=await buildNativeKit(dataDir,{out:path.join(work,'original-data-out'),cache,jobs:3,log});
    assert.equal(dataBuilt.signatureVerified,true);assert.match(await run(dataBuilt.executable,[]),/NATIVE_ORIGINAL_DATA_OK/);
    report.checks.push('signed-original-data-sample');
    const reused=await buildNativeKit(kitDir,{out:path.join(work,'reused'),cache,jobs:3,log});assert.equal(reused.cacheHit,true);report.checks.push('native-cache-reuse');
    // Verify the exact signed bytes produced by ditto; do not repack the bundle.
    const archive=await verifyMacOSAppArchive(new Uint8Array(await fs.readFile(built.zip)),kit.options);
    assert.equal(archive.executableSha256,built.sha256);report.checks.push('signed-app-archive-contract');
    const {createMacOSBridge}=await import('../packages/macos-native/src/bridge.mjs');
    const origin='http://127.0.0.1:8080';let approvals=0;
    const bridge=await createMacOSBridge({port:0,origins:[origin],cache,jobs:3,
      authorize:async manifest=>{assert.equal(manifest.sourceSha256,report.sourceSha256);assert.equal(manifest.name,project.name);approvals++;return true;}});
    const client=new MacOSCompilerClient((url,options)=>fetch(url,{...options,headers:{...options.headers,Origin:origin}}));
    try {
      await client.connect(bridge.url,bridge.token);
      const response=await client.build(project);assert.equal(approvals,1);
      const downloaded=path.join(work,'downloaded.app.zip'),expanded=path.join(work,'downloaded');
      await fs.writeFile(downloaded,response.bytes);await fs.mkdir(expanded);
      await run('/usr/bin/ditto',['-x','-k',downloaded,expanded]);
      const app=path.join(expanded,kit.options.name+'.app'),executable=path.join(app,'Contents','MacOS',kit.options.name);
      assert.equal(createHash('sha256').update(await fs.readFile(executable)).digest('hex'),response.report.executableSha256);
      await run('/usr/bin/codesign',['--verify','--strict','--verbose=2',app]);
      generatedPassed(await run(executable,[]));
      report.bridge={sha256:response.report.sha256,executableSha256:response.report.executableSha256,signatureVerifiedByCodesign:true,executedOn:process.arch};
      report.checks.push('real-approved-bridge-download-signature-execution');
    } finally {client.disconnect();await bridge.close();}
    // The reusable API must not delete its default output with its temporary kit.
    const {buildMacOSProject}=await import('../packages/macos-native/src/node.mjs');
    const apiCwd=path.join(work,'api-default-output');await fs.mkdir(apiCwd);
    const previousCwd=process.cwd();let apiOutput;
    try {process.chdir(apiCwd);apiOutput=await buildMacOSProject(project,{cache,jobs:3,zip:false});}
    finally {process.chdir(previousCwd);}
    // macOS aliases /var to /private/var; the builder intentionally returns
    // canonical paths. Still require the exact surviving output directory.
    assert.equal(apiOutput.app,await fs.realpath(path.join(apiCwd,'out',kit.options.name+'.app')));
    assert.equal((await fs.stat(apiOutput.executable)).isFile(),true);
    generatedPassed(await run(apiOutput.executable,[]));
    report.checks.push('reusable-api-output-survives-source-cleanup');
    report.macOSExecutionVerified=true;report.build=built;
    const artifacts=path.join(root,'artifacts/macos-native');await fs.mkdir(artifacts,{recursive:true});
    await fs.copyFile(built.zip,path.join(artifacts,path.basename(built.zip)));
  }
} catch(error) {
  report.failure={message:error.message,tool:error.tool,output:error.output};throw error;
} finally {
  const reports=path.join(root,'reports/macos-native');await fs.mkdir(reports,{recursive:true});
  await fs.writeFile(path.join(reports,'build.log'),transcript);
  await fs.writeFile(path.join(reports,'execution.json'),JSON.stringify(report,null,2)+'\n');
  await fs.rm(work,{recursive:true,force:true});
}
console.log(JSON.stringify(report,null,2));
