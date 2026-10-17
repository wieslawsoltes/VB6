/** LF-normalized source provenance for the independently built Linux runtime. */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {AOT_ABI} from '../packages/macos-native/src/aot-abi.js';
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
export function checkLinuxAOTRuntimeProvenance(sourceRoot=root) {
  const source=normalized(path.join(sourceRoot,'packages/linux-native/src/aot-runtime-payload.js'));
  const match=/^export const LINUX_AOT_RUNTIME_MANIFEST=(.+);$/m.exec(source);
  if(!match)throw new Error('Missing Linux AOT runtime manifest; build, validate and embed the runtime.');
  const manifest=JSON.parse(match[1]);
  const verification=manifest?.verification;
  if(!manifest||manifest.abi!==AOT_ABI||manifest.architecture!=='x86_64'||verification?.platform!=='linux'||verification?.architecture!=='x86_64'||
      !['x64ExecutionVerified','gtkExecutionVerified','gtkNativeSignalsVerified','conformanceVerified','resourcesVerified','lifetimeVerified','codeMetadataGrowthVerified'].every(name=>verification?.[name]===true)||
      JSON.stringify(verification?.optimizationLevelsVerified)!=='[0,1,2,3]')
    throw new Error('Linux AOT runtime lacks native execution provenance.');
  for(const [name,value]of Object.entries(readLinuxAOTSourceProvenance(sourceRoot)))
    if(manifest.provenance?.[name]!==value)throw new Error('Linux AOT runtime is stale: '+name+'. Rebuild, validate and embed the runtime.');
  return manifest;
}
