/** Offline, architecture-checked upstream AppImage execution header. */
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {APPIMAGE_RUNTIME_RELEASE,APPIMAGE_RUNTIME_SOURCE,APPIMAGE_RUNTIME_LICENSE as APPIMAGE_CORE_LICENSE,APPIMAGE_RUNTIME_PAYLOADS} from './appimage-runtime-payload.mjs';
import {APPIMAGE_THIRD_PARTY_NOTICES,APPIMAGE_RUNTIME_LICENSE_SOURCES} from './appimage-runtime-notices.mjs';
import {readPackageFile} from './native-distribution-tools.mjs';
export {APPIMAGE_RUNTIME_RELEASE,APPIMAGE_RUNTIME_SOURCE};
export const APPIMAGE_RUNTIME_LICENSE=APPIMAGE_CORE_LICENSE+'\n\n'+APPIMAGE_THIRD_PARTY_NOTICES;

export function inspectAppImageRuntime(bytes,architecture) {
  if(bytes instanceof Uint8Array&&!Buffer.isBuffer(bytes))bytes=Buffer.from(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const machine=architecture==='x64'?62:architecture==='arm64'?183:0;
  if(!machine||bytes.length<64||bytes.length>8*1024*1024||bytes[0]!==127||bytes.subarray(1,4).toString()!=='ELF'||bytes[4]!==2||bytes[5]!==1||bytes.readUInt16LE(18)!==machine||bytes[8]!==65||bytes[9]!==73||bytes[10]!==2)throw new Error('AppImage runtime must be a type-2 ELF64 for the selected architecture');
  const shoff=Number(bytes.readBigUInt64LE(40)),shsize=bytes.readUInt16LE(58),shnum=bytes.readUInt16LE(60),phoff=Number(bytes.readBigUInt64LE(32)),phsize=bytes.readUInt16LE(54),phnum=bytes.readUInt16LE(56);
  if(!Number.isSafeInteger(shoff)||shsize!==64||shnum<1||shoff+shsize*shnum>bytes.length||!Number.isSafeInteger(phoff)||phsize!==56||phoff+phsize*phnum>bytes.length)throw new Error('Invalid AppImage runtime ELF tables');
  for(let n=0;n<phnum;n++)if(bytes.readUInt32LE(phoff+n*phsize)===3)throw new Error('AppImage runtime must be statically linked');
  // type2-runtime computes the image offset from the final section and SHT.
  const last=shoff+shsize*(shnum-1),end=Number(bytes.readBigUInt64LE(last+24)+bytes.readBigUInt64LE(last+32));
  if(!Number.isSafeInteger(end)||Math.max(shoff+shsize*shnum,end)!==bytes.length)throw new Error('AppImage runtime has an ambiguous filesystem offset');
  return {architecture,machine,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex'),type:2,staticallyLinked:true};
}
export async function loadAppImageRuntime(architecture,{runtimePath,runtimeSha256}={}) {
  let bytes,release,source;
  if(runtimePath!==undefined){
    if(typeof runtimeSha256!=='string'||!/^[0-9a-f]{64}$/.test(runtimeSha256))throw new Error('A custom AppImage runtime requires appimageRuntimeSha256');
    bytes=await readPackageFile(runtimePath,8*1024*1024);release='custom';source='caller-supplied';
  }else {
    if(runtimeSha256!==undefined)throw new Error('appimageRuntimeSha256 requires appimageRuntime');
    const payload=APPIMAGE_RUNTIME_PAYLOADS[architecture];if(!payload)throw new Error('Unsupported AppImage architecture');
    bytes=gunzipSync(Buffer.from(payload.gzipBase64,'base64'),{maxOutputLength:8*1024*1024});
    runtimeSha256=payload.sha256;if(bytes.length!==payload.bytes)throw new Error('Pinned AppImage runtime length mismatch');
    release=APPIMAGE_RUNTIME_RELEASE;source=APPIMAGE_RUNTIME_SOURCE;
  }
  const manifest=inspectAppImageRuntime(bytes,architecture);
  if(manifest.sha256!==runtimeSha256)throw new Error('AppImage runtime SHA256 mismatch');
  return {bytes,manifest:{...manifest,release,source,license:release==='custom'?'caller-supplied':'MIT; LGPL-2.1-or-later; BSD-2-Clause; Zlib',...(release==='custom'?{}:{licenseSources:APPIMAGE_RUNTIME_LICENSE_SOURCES})}};
}
