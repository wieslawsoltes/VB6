/** Offline SDK runtimes; callers receive defensive copies of verified bytes. */
import {readZip} from '../../../src/project/zip.js';
import {verifyLinuxAOTRuntime} from './elf.js';
import {linuxTarget,linuxToolkit} from './target.js';
import {LINUX_AOT_RUNTIME_MANIFEST as X64_MANIFEST,LINUX_AOT_RUNTIME_ZIP_BASE64 as X64_ZIP_BASE64} from './aot-runtime-payload.js';
import {LINUX_AOT_RUNTIME_MANIFEST as ARM64_MANIFEST,LINUX_AOT_RUNTIME_ZIP_BASE64 as ARM64_ZIP_BASE64} from './aot-runtime-arm64-payload.js';
import {LINUX_AOT_RUNTIME_MANIFEST as GTK4_X64_MANIFEST,LINUX_AOT_RUNTIME_ZIP_BASE64 as GTK4_X64_ZIP_BASE64} from './aot-runtime-gtk4-payload.js';
import {LINUX_AOT_RUNTIME_MANIFEST as GTK4_ARM64_MANIFEST,LINUX_AOT_RUNTIME_ZIP_BASE64 as GTK4_ARM64_ZIP_BASE64} from './aot-runtime-gtk4-arm64-payload.js';

const runtimes=Object.freeze({
  'gtk3:x64':Object.freeze({manifest:X64_MANIFEST,archive:X64_ZIP_BASE64}),
  'gtk3:arm64':Object.freeze({manifest:ARM64_MANIFEST,archive:ARM64_ZIP_BASE64}),
  'gtk4:x64':Object.freeze({manifest:GTK4_X64_MANIFEST,archive:GTK4_X64_ZIP_BASE64}),
  'gtk4:arm64':Object.freeze({manifest:GTK4_ARM64_MANIFEST,archive:GTK4_ARM64_ZIP_BASE64})
});
const loading=new Map();

export function linuxAOTRuntimeInfo({architecture='x64',toolkit='gtk3'}={}) {
  const {manifest}=runtimes[linuxToolkit(toolkit).id+':'+linuxTarget(architecture).option];
  return manifest?structuredClone(manifest):null;
}

async function decode(target,toolkit) {
  const definition=runtimes[toolkit+':'+target.option];
  if(!definition.manifest||!definition.archive)throw new Error('This development build has no verified Linux '+target.architecture+' '+toolkit+' runtime. Rebuild the Linux SDK runtime; no source export was substituted.');
  if(definition.manifest.architecture!==target.architecture)throw new Error('Embedded Linux AOT runtime architecture mismatch');
  if((definition.manifest.toolkit??'gtk3')!==toolkit)throw new Error('Embedded Linux AOT runtime toolkit mismatch');
  if(definition.archive.length>96*1024*1024)throw new Error('Embedded Linux AOT archive exceeds limits');
  const text=atob(definition.archive),archive=Uint8Array.from(text,c=>c.charCodeAt(0));
  const files=await readZip(archive,{maxExpandedBytes:64*1024*1024,maxFiles:1,filenameEncoding:'utf-8'});
  const member='runtime-'+target.architecture;
  if(files.size!==1||!files.has(member))throw new Error('Invalid embedded Linux AOT runtime archive');
  const bytes=files.get(member),manifest=structuredClone(definition.manifest);
  await verifyLinuxAOTRuntime(bytes,manifest);
  return {bytes,manifest};
}

export async function loadLinuxAOTRuntime({architecture='x64',toolkit='gtk3',signal}={}) {
  signal?.throwIfAborted();
  const target=linuxTarget(architecture,toolkit),key=toolkit+':'+target.option;
  if(!loading.has(key))loading.set(key,decode(target,toolkit).catch(error=>{loading.delete(key);throw error;}));
  const result=await loading.get(key);
  signal?.throwIfAborted();
  return {bytes:result.bytes.slice(),manifest:structuredClone(result.manifest)};
}
