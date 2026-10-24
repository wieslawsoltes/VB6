/** Linux LP64 host, preserving the VB6 16/32-bit language value contract. */
export const LINUX_TARGET=Object.freeze({
  id:'linux-x86_64',architecture:'x86_64',triple:'x86_64-linux-gnu',format:'ELF64',
  executableExtension:'',pointerBytes:8,integerBytes:2,longBytes:4,booleanBytes:2,
  currencyBytes:8,stringEncoding:'UTF-16',codegen:'x86_64-aot',controls:'GTK3',
  runtime:'vb6-native',minimumGTK:'3.24',minimumGlibc:'2.39',
  option:'x64',machine:62,callingConvention:'sysv-amd64',pageBytes:4096,
  interpreters:Object.freeze(['/lib64/ld-linux-x86-64.so.2','/lib/x86_64-linux-gnu/ld-linux-x86-64.so.2'])
});
export const LINUX_TARGETS=Object.freeze({x64:LINUX_TARGET,arm64:Object.freeze({
  ...LINUX_TARGET,id:'linux-arm64',architecture:'arm64',triple:'aarch64-linux-gnu',codegen:'arm64-aot',
  option:'arm64',machine:183,callingConvention:'aapcs64',pageBytes:65536,
  interpreters:Object.freeze(['/lib/ld-linux-aarch64.so.1','/lib/aarch64-linux-gnu/ld-linux-aarch64.so.1'])
})});
export const LINUX_LIMITS=Object.freeze({runtimeBytes:64*1024*1024,codeBytes:64*1024*1024,
  metadataBytes:8*1024*1024,imageBytes:160*1024*1024,archiveBytes:256*1024*1024,
  expandedBytes:256*1024*1024,resourceBytes:20*1024*1024,totalResourceBytes:50*1024*1024,files:4096});
export class LinuxCompileError extends Error {
  constructor(message,source='',line=0,code='LIN001'){
    super(`${source?source+':'+line+': ':''}${message}`);this.name='LinuxCompileError';
    this.diagnostics=[{severity:'error',source,line,code,message}];
  }
}
export function linuxTarget(architecture='x64'){
  const key=architecture==='x86_64'?'x64':architecture;
  if(typeof key!=='string'||!Object.hasOwn(LINUX_TARGETS,key))throw new LinuxCompileError('Linux executable architecture must be x64 or arm64');
  return LINUX_TARGETS[key];
}
/** Download stems may be shortened without changing the executable/app name. */
export function linuxArtifactFilename(name,architecture='x64',extension='.zip'){
  const options=linuxOptions({name,architecture}),encoder=new TextEncoder();
  if(typeof extension!=='string'||extension.length>32||!/^\.[a-z0-9]+(?:\.[a-z0-9]+)*$/.test(extension))throw new LinuxCompileError('Invalid Linux artifact extension');
  const suffix='-linux-'+options.architecture+extension,budget=255-encoder.encode(suffix).length;let stem='',size=0;
  for(const character of options.name){const bytes=encoder.encode(character).length;if(size+bytes>budget)break;stem+=character;size+=bytes;}
  return stem+suffix;
}
export function linuxOptions(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Linux options must be an object');
  const target=linuxTarget(options.architecture??options.arch??'x64'),toolkit=options.toolkit??'gtk3',optimization=Number(options.optimization??2);
  if(options.arch!==undefined&&linuxTarget(options.arch)!==target)throw new LinuxCompileError('Conflicting Linux architecture and arch options');
  if(toolkit!=='gtk3')throw new LinuxCompileError('Linux executable export currently requires GTK3');
  if(!Number.isInteger(optimization)||optimization<0||optimization>3)throw new LinuxCompileError('optimization must be 0, 1, 2 or 3');
  const name=options.name??'Application';
  if(typeof name!=='string'||!name.length||name.length>100||new TextEncoder().encode(name).length>255||new TextDecoder().decode(new TextEncoder().encode(name))!==name||name==='.'||name==='..'||/[\x00-\x1f\x7f/\\:]/.test(name)||name.startsWith('-'))throw new LinuxCompileError('Invalid Linux application name');
  const maxArrayElements=options.maxArrayElements??16777216,maxCallDepth=options.maxCallDepth??512;
  if(!Number.isSafeInteger(maxArrayElements)||maxArrayElements<1||maxArrayElements>67108864)throw new LinuxCompileError('maxArrayElements must be between 1 and 67108864');
  if(!Number.isSafeInteger(maxCallDepth)||maxCallDepth<1||maxCallDepth>4096)throw new LinuxCompileError('maxCallDepth must be between 1 and 4096');
  return Object.freeze({architecture:target.option,arch:target.architecture,toolkit,optimization,name,maxArrayElements,maxCallDepth});
}
