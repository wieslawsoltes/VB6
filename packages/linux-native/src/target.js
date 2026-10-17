/** Linux LP64 host, preserving the VB6 16/32-bit language value contract. */
export const LINUX_TARGET=Object.freeze({
  id:'linux-x86_64',architecture:'x86_64',triple:'x86_64-linux-gnu',format:'ELF64',
  executableExtension:'',pointerBytes:8,integerBytes:2,longBytes:4,booleanBytes:2,
  currencyBytes:8,stringEncoding:'UTF-16',codegen:'x86_64-aot',controls:'GTK3',
  runtime:'vb6-native',minimumGTK:'3.24',minimumGlibc:'2.39'
});
export const LINUX_LIMITS=Object.freeze({runtimeBytes:64*1024*1024,codeBytes:64*1024*1024,
  metadataBytes:8*1024*1024,imageBytes:160*1024*1024,archiveBytes:256*1024*1024,
  expandedBytes:256*1024*1024,resourceBytes:20*1024*1024,totalResourceBytes:50*1024*1024,files:4096});
export class LinuxCompileError extends Error {
  constructor(message,source='',line=0,code='LIN001'){
    super(`${source?source+':'+line+': ':''}${message}`);this.name='LinuxCompileError';
    this.diagnostics=[{severity:'error',source,line,code,message}];
  }
}
export function linuxOptions(options={}){
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Linux options must be an object');
  const arch=options.arch??'x86_64',toolkit=options.toolkit??'gtk3',optimization=Number(options.optimization??2);
  if(!['x86_64','x64'].includes(arch))throw new LinuxCompileError('Linux executable export currently requires x86_64');
  if(toolkit!=='gtk3')throw new LinuxCompileError('Linux executable export currently requires GTK3');
  if(!Number.isInteger(optimization)||optimization<0||optimization>3)throw new LinuxCompileError('optimization must be 0, 1, 2 or 3');
  const name=options.name??'Application';
  if(typeof name!=='string'||!name.length||name.length>100||name==='.'||name==='..'||/[\x00-\x1f\x7f/\\:]/.test(name)||name.startsWith('-'))throw new LinuxCompileError('Invalid Linux application name');
  const maxArrayElements=options.maxArrayElements??16777216,maxCallDepth=options.maxCallDepth??512;
  if(!Number.isSafeInteger(maxArrayElements)||maxArrayElements<1||maxArrayElements>67108864)throw new LinuxCompileError('maxArrayElements must be between 1 and 67108864');
  if(!Number.isSafeInteger(maxCallDepth)||maxCallDepth<1||maxCallDepth>4096)throw new LinuxCompileError('maxCallDepth must be between 1 and 4096');
  return Object.freeze({arch:'x86_64',toolkit,optimization,name,maxArrayElements,maxCallDepth});
}
