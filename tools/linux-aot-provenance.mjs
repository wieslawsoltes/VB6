/** LF-normalized source provenance for the independently built Linux runtime. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AOT_ABI} from '../packages/macos-native/src/aot-abi.js';
import {linuxTarget} from '../packages/linux-native/src/target.js';
const root=path.resolve(import.meta.dirname,'..');
const normalized=filename=>fs.readFileSync(filename,'utf8').replace(/\r\n/g,'\n');
const digest=files=>{const hash=createHash('sha256');for(const name of Object.keys(files).sort())hash.update(name).update('\0').update(files[name]).update('\0');return hash.digest('hex');};
export function readLinuxAOTSources(sourceRoot=root) {
  const shared=path.join(sourceRoot,'packages/macos-native'),linux=path.join(sourceRoot,'packages/linux-native');
  const files={},groups={native:{},sharedAOT:{},gtk:{},loader:{}};
  for(const name of fs.readdirSync(path.join(shared,'native')).sort()) {
    if(!/^[a-z0-9-]+\.(cpp|hpp)$/.test(name)||name.startsWith('appkit'))continue;
    groups.native[name]=normalized(path.join(shared,'native',name));files['native/'+name]=groups.native[name];
  }
  for(const name of ['helpers.cpp','helpers.hpp','runtime.cpp','runtime.hpp','json.hpp']) {
    groups.sharedAOT[name]=normalized(path.join(shared,'aot',name));files['shared-aot/'+name]=groups.sharedAOT[name];
  }
  for(const name of fs.readdirSync(path.join(linux,'native')).sort()) {
    if(!/^[a-z0-9-]+\.(cpp|hpp)$/.test(name))continue;
    groups.gtk[name]=normalized(path.join(linux,'native',name));files['gtk/'+name]=groups.gtk[name];
  }
  for(const name of fs.readdirSync(path.join(linux,'aot')).sort()) {
    if(!/^[a-z0-9-]+\.(cpp|hpp)$/.test(name))continue;
    groups.loader[name]=normalized(path.join(linux,'aot',name));files['aot/'+name]=groups.loader[name];
  }
  const provenance={nativeSourceSha256:digest(groups.native),aotSourceSha256:digest(groups.sharedAOT),gtkSourceSha256:digest(groups.gtk),loaderSourceSha256:digest(groups.loader),abiSourceSha256:digest({'aot-abi.js':normalized(path.join(shared,'src/aot-abi.js'))})};
  return {files,groups,provenance};
}
export function readLinuxAOTSourceProvenance(sourceRoot=root) {return readLinuxAOTSources(sourceRoot).provenance;}
export function linuxAOTRuntimePayloadFile(architecture='x64') {return linuxTarget(architecture).option==='x64'?'aot-runtime-payload.js':'aot-runtime-arm64-payload.js';}
export function linuxAOTExecutionVerification(proof,manifest) {
  const target=linuxTarget(manifest.architecture),native=proof?.executionMode==='native',emulated=proof?.executionMode==='qemu-user';
  const features=['machineCodeExecutionVerified',target.option+'ExecutionVerified','gtkExecutionVerified','gtkNativeSignalsVerified','conformanceVerified','resourcesVerified','lifetimeVerified','codeMetadataGrowthVerified','richTextVerified','printerServicesVerified','previousInstanceVerified'];
  const evidence=['language-O0','language-O1','language-O2','language-O3','abi-platform-O0','abi-platform-O1','abi-platform-O2','abi-platform-O3','resource-path-O2','program-roots-O2','abrupt-End-O2','form-lifetime-O2','large-O2','gtk-controls-O2','richtext-O2','compiled-printers-O3','compiled-instance-O3'];
  const nativeFixtures=['gtkSignals','richText','printers','previousInstance'];
  const validEvidence=value=>value?.runtimeSha256===manifest.sha256&&value.architecture===target.architecture&&value.machine===target.machine&&value.callingConvention===target.callingConvention&&/^[a-f0-9]{64}$/.test(value.executableSha256||'');
  if(proof?.error||proof?.platform!=='linux'||proof?.arch!==target.option||proof?.architecture!==target.architecture||proof?.runtime?.sha256!==manifest.sha256||
      !features.every(name=>proof?.[name]===true)||JSON.stringify(proof?.optimizationLevelsVerified)!=='[0,1,2,3]'||
      !(native&&proof.hostArchitecture===target.option||emulated&&['x64','arm64'].includes(proof.hostArchitecture)&&proof.hostArchitecture!==target.option&&/qemu/i.test(proof.emulatorVersion||''))||
      !evidence.every(name=>validEvidence(proof?.[name]))||!nativeFixtures.every(name=>proof?.nativeFixtures?.[name]?.passed===true&&validEvidence(proof.nativeFixtures[name]))||proof?.compiledServices?.passed!==true||
      emulated&&target.option==='arm64'&&(JSON.stringify(proof.emulatedPageSizesVerified)!=='[4096,16384,65536]'||![4096,16384,65536].every(size=>proof.emulatedPageCases?.[size]?.pageBytes===size&&validEvidence(proof.emulatedPageCases[size])&&proof.emulatedPageCases[size].executableSha256===proof['resource-path-O2'].executableSha256)))
    throw new Error('Embedding requires exact-runtime Linux '+target.option+' machine-code execution, GTK, rich text, printer services, previous-instance, conformance, resource, lifetime, large-project and O0..O3 proof.');
  return {platform:'linux',architecture:target.architecture,executionMode:proof.executionMode,hostArchitecture:proof.hostArchitecture,
    ...(emulated?{emulatorVersion:proof.emulatorVersion,...(target.option==='arm64'?{emulatedPageSizesVerified:[4096,16384,65536]}:{})}:{}),...Object.fromEntries(features.map(name=>[name,true])),optimizationLevelsVerified:[0,1,2,3],
    nativeFixtureSha256:Object.fromEntries(nativeFixtures.map(name=>[name,proof.nativeFixtures[name].executableSha256])),
    projectExecutableSha256:Object.fromEntries(evidence.map(name=>[name,proof[name].executableSha256]))};
}
export function checkLinuxAOTRuntimeProvenance(sourceRoot=root,{architecture='x64'}={}) {
  const target=linuxTarget(architecture),source=normalized(path.join(sourceRoot,'packages/linux-native/src',linuxAOTRuntimePayloadFile(architecture)));
  const match=/^export const LINUX_AOT_RUNTIME_MANIFEST=(.+);$/m.exec(source);
  if(!match)throw new Error('Missing Linux AOT runtime manifest; build, validate and embed the runtime.');
  const manifest=JSON.parse(match[1]);
  const verification=manifest?.verification;
  if(!manifest||manifest.abi!==AOT_ABI||manifest.architecture!==target.architecture||manifest.machine!==target.machine||manifest.callingConvention!==target.callingConvention||manifest.pageBytes!==target.pageBytes||verification?.platform!=='linux'||verification?.architecture!==target.architecture||
      !(verification.executionMode==='native'&&verification.hostArchitecture===target.option||verification.executionMode==='qemu-user'&&['x64','arm64'].includes(verification.hostArchitecture)&&verification.hostArchitecture!==target.option&&/qemu/i.test(verification.emulatorVersion||''))||
      verification.executionMode==='qemu-user'&&target.option==='arm64'&&JSON.stringify(verification.emulatedPageSizesVerified)!=='[4096,16384,65536]'||
      !['machineCodeExecutionVerified',target.option+'ExecutionVerified','gtkExecutionVerified','gtkNativeSignalsVerified','conformanceVerified','resourcesVerified','lifetimeVerified','codeMetadataGrowthVerified','richTextVerified','printerServicesVerified','previousInstanceVerified'].every(name=>verification?.[name]===true)||
      JSON.stringify(verification?.optimizationLevelsVerified)!=='[0,1,2,3]')
    throw new Error('Linux AOT runtime lacks native execution provenance.');
  for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance(sourceRoot)))
    if(manifest.provenance?.[name]!==value)throw new Error('Linux AOT runtime is stale: '+name+'. Rebuild, validate and embed the runtime.');
  return manifest;
}
