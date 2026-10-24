/** Browser/Node direct ELF executable linking and reproducible portable ZIPs. */
import {readZip,writeZip} from '../../../src/project/zip.js';
import {sha256Bytes} from '../../macos-native/src/archive.js';
import {MACOS_RESOURCE_FILE} from '../../macos-native/src/resources.js';
import {compileLinuxAOT} from './compiler.js';
import {loadLinuxAOTRuntime} from './aot-runtime.js';
import {inspectLinuxELF,linkLinuxELF,verifyLinuxAOTRuntime} from './elf.js';
import {linuxOptions,linuxTarget,linuxArtifactFilename,LINUX_LIMITS} from './target.js';
import {LINUX_RUNTIME_LICENSE} from './runtime-license.js';
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true}),safePath=name=>typeof name==='string'&&encoder.encode(name).length<=4096&&!/[\\\x00-\x1f\x7f:]/.test(name)&&!name.split('/').some(p=>!p||p==='.'||p==='..'||encoder.encode(p).length>255);
const json=value=>encoder.encode(JSON.stringify(value,null,2)+'\n');
function archiveModes(bytes){
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let end=-1;
  for(let i=bytes.length-22;i>=Math.max(0,bytes.length-65557);i--)if(v.getUint32(i,true)===0x06054b50&&i+22+v.getUint16(i+20,true)===bytes.length){end=i;break;}
  if(end<0)throw new Error('Missing Linux ZIP directory');
  const count=v.getUint16(end+10,true),modes=new Map();let at=v.getUint32(end+16,true);
  for(let i=0;i<count;i++){
    if(at+46>end||v.getUint32(at,true)!==0x02014b50)throw new Error('Invalid Linux ZIP directory');
    const length=v.getUint16(at+28,true),extra=v.getUint16(at+30,true),comment=v.getUint16(at+32,true);if(at+46+length+extra+comment>end)throw new Error('Truncated Linux ZIP directory');
    const name=decoder.decode(bytes.subarray(at+46,at+46+length)),mode=v.getUint32(at+38,true)>>>16;
    if(!safePath(name)||modes.has(name)||(mode&0o170000)!==0o100000||(mode&0o7000))throw new Error('Linux ZIP requires unique regular files without special permission bits');
    modes.set(name,mode);at+=46+length+extra+comment;
  }
  if(at!==end)throw new Error('Invalid Linux ZIP directory length');return modes;
}
export function writeLinuxAppZip(files,executable){
  if(!files||!Object.hasOwn(files,executable))throw new Error('Missing Linux application executable');
  for(const name of Object.keys(files))if(!safePath(name))throw new Error('Invalid Linux archive path');
  const bytes=writeZip(files),v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),end=bytes.length-22;let at=v.getUint32(end+16,true);
  for(let i=0;i<v.getUint16(end+10,true);i++){
    const length=v.getUint16(at+28,true),name=decoder.decode(bytes.subarray(at+46,at+46+length)),local=v.getUint32(at+42,true);
    v.setUint16(at+4,0x0314,true);v.setUint32(at+38,((name===executable?0o100755:0o100644)*65536)>>>0,true);
    v.setUint16(at+12,0,true);v.setUint16(at+14,33,true);v.setUint16(local+10,0,true);v.setUint16(local+12,33,true);
    at+=46+length+v.getUint16(at+30,true)+v.getUint16(at+32,true);
  }
  return bytes;
}
export async function linkLinuxAOT(compiled,runtime,{resources={}}={}){
  if(!compiled?.section||!['x86_64-aot','arm64-aot'].includes(compiled.report?.codegen))throw new TypeError('Expected Linux x86_64 or ARM64 AOT object code');
  const target=linuxTarget(compiled.options.architecture??compiled.options.arch,compiled.options.toolkit);
  const templateLayout=await verifyLinuxAOTRuntime(runtime?.bytes,runtime?.manifest),linked=linkLinuxELF(compiled,runtime.bytes,templateLayout),o=compiled.options,root=o.name+'/',entry=root+'bin/'+o.name;
  const executable=linked.bytes,executableSha256=await sha256Bytes(executable),buildReport={...compiled.report,artifact:'native-executable',compiled:true,name:o.name,
    optimization:o.optimization,projectOptimization:compiled.report.optimization,runtimeOptimization:2,codeCapacity:linked.codeCapacity,metadataCapacity:linked.metadataCapacity,
    executableBytes:executable.length,executableSha256,runtimeSha256:runtime.manifest.sha256,runtimeBytes:runtime.bytes.length,
    minimumGTK:target.minimumGTK,minimumGlibc:target.minimumGlibc,dependencies:linked.layout.dependencies,
    provenance:structuredClone(runtime.manifest.provenance||{}),pie:true,nonExecutableStack:true,relro:true,bindNow:true,integrity:'sha256-manifest',signed:false};
  const files=Object.create(null);files[entry]=executable;let total=0;
  const reserved=new Set(['Resources/vb6-build.json','Resources/vb6-source-map.json','Resources/vb6-runtime-license.txt','Resources/'+MACOS_RESOURCE_FILE]);
  for(const [name,value]of Object.entries(resources)){
    if(!safePath(name)||!name.startsWith('Resources/')||reserved.has(name))throw new Error('Invalid or reserved Linux resource path');
    const bytes=typeof value==='string'?encoder.encode(value):value instanceof Uint8Array?value.slice():null;
    if(!bytes||bytes.length>LINUX_LIMITS.resourceBytes||(total+=bytes.length)>LINUX_LIMITS.totalResourceBytes)throw new Error('Linux resource exceeds bounded resource limits');files[root+name]=bytes;
  }
  for(const [name,bytes]of Object.entries(compiled.resourceFiles||{})){
    if(name!=='resources/'+MACOS_RESOURCE_FILE||!(bytes instanceof Uint8Array)||bytes.length>LINUX_LIMITS.resourceBytes||(total+=bytes.length)>LINUX_LIMITS.totalResourceBytes)throw new Error('Invalid Linux resource catalog');files[root+'Resources/'+MACOS_RESOURCE_FILE]=bytes.slice();
  }
  files[root+'Resources/vb6-build.json']=json(buildReport);files[root+'Resources/vb6-source-map.json']=json(compiled.sourceMap);
  files[root+'Resources/vb6-runtime-license.txt']=encoder.encode(LINUX_RUNTIME_LICENSE);
  files[root+'README.txt']=encoder.encode(`${o.name}\n\nNative Linux ${target.architecture} executable with GTK ${target.minimumGTK} UI.\nRequires glibc ${target.minimumGlibc} or newer and GTK ${target.minimumGTK} system libraries (Ubuntu 24.04 or compatible).\nExtract the complete archive, then run the executable in bin/. Keep Resources/ beside bin/.\nThe ZIP preserves executable permissions. No JavaScript engine, VB interpreter, Node.js,\nnetwork service or per-application C/C++ compiler is required to run this application.\n\nThe manifest detects damaged or modified files. It is an integrity record, not a publisher signature.\n`);
  const hashes=Object.create(null);for(const name of Object.keys(files).sort())hashes[name.slice(root.length)]=await sha256Bytes(files[name]);
  files[root+'manifest.json']=json({version:1,target:target.id,abi:compiled.metadata.abi,name:o.name,executable:'bin/'+o.name,
    runtime:{sha256:runtime.manifest.sha256,bytes:runtime.bytes.length,header:linked.templateHeader},files:hashes});
  if(Object.keys(files).length>LINUX_LIMITS.files)throw new Error('Too many Linux archive resources');
  const bytes=writeLinuxAppZip(files,entry),verification=await verifyLinuxAOTArchive(bytes,o);
  return {bytes,executable,files,filename:linuxArtifactFilename(o.name,target.option,'.zip',o.toolkit),options:o,report:{...buildReport,...verification}};
}
export async function exportLinuxAOT(project,runtime,options={},packaging={}){return linkLinuxAOT(compileLinuxAOT(project,options),runtime,packaging);}
export async function exportLinuxApplication(project,options={},packaging={}){
  packaging.signal?.throwIfAborted();const compiled=compileLinuxAOT(project,options),runtime=await loadLinuxAOTRuntime({architecture:compiled.options.architecture,toolkit:compiled.options.toolkit,signal:packaging.signal});packaging.signal?.throwIfAborted();
  const result=await linkLinuxAOT(compiled,runtime,packaging);packaging.signal?.throwIfAborted();return result;
}
function readJSON(bytes,limit){if(!bytes||bytes.length>limit)throw new Error('Missing or excessive Linux archive metadata');return JSON.parse(decoder.decode(bytes));}
export async function verifyLinuxAOTArchive(input,options={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length<22||bytes.length>LINUX_LIMITS.archiveBytes)throw new Error('Invalid or excessive Linux application archive');
  const o=linuxOptions(options),target=linuxTarget(o.architecture,o.toolkit),root=o.name+'/',entry=root+'bin/'+o.name,manifestPath=root+'manifest.json',files=await readZip(bytes,{maxExpandedBytes:LINUX_LIMITS.expandedBytes,maxFiles:LINUX_LIMITS.files,filenameEncoding:'utf-8'}),modes=archiveModes(bytes);
  const manifest=readJSON(files.get(manifestPath),2*1024*1024);
  if(manifest.version!==1||manifest.target!==target.id||manifest.name!==o.name||manifest.executable!=='bin/'+o.name||!manifest.files||typeof manifest.files!=='object'||Array.isArray(manifest.files))throw new Error('Invalid Linux archive manifest');
  const names=Object.keys(manifest.files);
  if(names.length!==files.size-1||!['bin/'+o.name,'Resources/vb6-build.json','Resources/vb6-source-map.json','README.txt'].every(name=>Object.hasOwn(manifest.files,name)))throw new Error('Linux archive resource seal does not match file set');
  for(const [path,value]of files){
    if(path===manifestPath)continue;
    if(!path.startsWith(root))throw new Error('Linux archive member escapes application root');
    const name=path.slice(root.length);
    if(!safePath(name)||name!=='bin/'+o.name&&name!=='README.txt'&&!name.startsWith('Resources/')||!Object.hasOwn(manifest.files,name)||manifest.files[name]!==await sha256Bytes(value))throw new Error('Linux archive file integrity mismatch: '+name);
    if(modes.get(path)!==(path===entry?0o100755:0o100644))throw new Error('Linux archive does not preserve expected executable/file permissions');
  }
  if(modes.get(manifestPath)!==0o100644)throw new Error('Invalid Linux manifest permissions');
  const executable=files.get(entry),layout=inspectLinuxELF(executable,{requireProject:true,architecture:o.architecture,toolkit:o.toolkit}),build=readJSON(files.get(root+'Resources/vb6-build.json'),2*1024*1024),executableSha256=await sha256Bytes(executable);
  if(build.toolkit!==layout.toolkit)throw new Error('Linux archive report toolkit disagrees with executable bytes');
  if(build.compiled!==true||build.codegen!==target.codegen||build.target!==target.id||build.architecture!==target.architecture||['machine','callingConvention'].some(key=>build[key]!==undefined&&build[key]!==target[key])||build.name!==o.name||layout.metadataJSON.name!==o.name||build.abi!==layout.metadataJSON.abi||manifest.abi!==layout.metadataJSON.abi||build.codeBytes!==layout.codeSize||build.metadataBytes!==layout.metadataSize||build.executableBytes!==executable.length||build.executableSha256!==executableSha256||JSON.stringify(build.dependencies)!==JSON.stringify(layout.dependencies))throw new Error('Linux archive report disagrees with executable bytes');
  // Recover the immutable prelinked template by restoring only its original ELF
  // header. This independently verifies provenance instead of trusting the label.
  const original=manifest.runtime;
  if(!original||!Number.isSafeInteger(original.bytes)||original.bytes<64||original.bytes>LINUX_LIMITS.runtimeBytes||original.bytes>layout.code.offset||!Array.isArray(original.header)||original.header.length!==64||original.header.some(n=>!Number.isInteger(n)||n<0||n>255)||!/^[0-9a-f]{64}$/.test(original.sha256||''))throw new Error('Invalid Linux runtime provenance');
  const template=executable.slice(0,original.bytes);template.set(original.header);
  if(await sha256Bytes(template)!==original.sha256||build.runtimeSha256!==original.sha256||build.runtimeBytes!==original.bytes)throw new Error('Linux runtime provenance hash mismatch');
  const templateLayout=inspectLinuxELF(template,{architecture:o.architecture,toolkit:o.toolkit});if(templateLayout.code)throw new Error('Invalid Linux runtime provenance image');
  for(const [name,address]of templateLayout.symbols)if(layout.symbols.get(name)!==address)throw new Error('Linux runtime helper layout changed after linking');
  return {artifact:'native-executable',compiled:true,target:target.id,name:o.name,architecture:target.architecture,machine:target.machine,callingConvention:target.callingConvention,format:'ELF64',toolkit:o.toolkit,codegen:target.codegen,
    bytes:bytes.length,sha256:await sha256Bytes(bytes),executableBytes:executable.length,executableSha256,image:layout.image,integrityVerified:true,runtimeProvenanceVerified:true,signed:false};
}
export async function unpackLinuxAOTArchive(input,options={}){
  const bytes=Uint8Array.from(input),normalized=linuxOptions(options);await verifyLinuxAOTArchive(bytes,normalized);
  return {options:normalized,files:await readZip(bytes,{maxExpandedBytes:LINUX_LIMITS.expandedBytes,maxFiles:LINUX_LIMITS.files,filenameEncoding:'utf-8'})};
}
