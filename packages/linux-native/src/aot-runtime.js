/** Offline SDK runtime; callers receive defensive copies of verified bytes. */
import {readZip} from '../../../src/project/zip.js';
import {verifyLinuxAOTRuntime} from './elf.js';
import {LINUX_AOT_RUNTIME_MANIFEST,LINUX_AOT_RUNTIME_ZIP_BASE64} from './aot-runtime-payload.js';
let loading;
export function linuxAOTRuntimeInfo(){return LINUX_AOT_RUNTIME_MANIFEST?structuredClone(LINUX_AOT_RUNTIME_MANIFEST):null;}
async function decode(){
  if(!LINUX_AOT_RUNTIME_MANIFEST||!LINUX_AOT_RUNTIME_ZIP_BASE64)throw new Error('This development build has no verified Linux GTK runtime. Rebuild the Linux SDK runtime; no source export was substituted.');
  if(LINUX_AOT_RUNTIME_ZIP_BASE64.length>96*1024*1024)throw new Error('Embedded Linux AOT archive exceeds limits');
  const text=atob(LINUX_AOT_RUNTIME_ZIP_BASE64),archive=Uint8Array.from(text,c=>c.charCodeAt(0)),files=await readZip(archive,{maxExpandedBytes:64*1024*1024,maxFiles:1,filenameEncoding:'utf-8'});
  if(files.size!==1||!files.has('runtime-x86_64'))throw new Error('Invalid embedded Linux AOT runtime archive');
  const bytes=files.get('runtime-x86_64'),manifest=structuredClone(LINUX_AOT_RUNTIME_MANIFEST);await verifyLinuxAOTRuntime(bytes,manifest);return {bytes,manifest};
}
export async function loadLinuxAOTRuntime({signal}={}){
  signal?.throwIfAborted();loading??=decode().catch(error=>{loading=null;throw error;});const result=await loading;signal?.throwIfAborted();
  return {bytes:result.bytes.slice(),manifest:structuredClone(result.manifest)};
}
