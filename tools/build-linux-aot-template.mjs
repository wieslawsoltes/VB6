/** Maintainer-only native SDK compilation; projects themselves compile in JS. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runTool} from '../packages/macos-native/src/build-driver.mjs';
import {readLinuxAOTSources} from './linux-aot-provenance.mjs';
import {createLinuxAOTRuntimeManifest,verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
const root=path.resolve(import.meta.dirname,'..');
const hash=value=>createHash('sha256').update(value).digest('hex');
export async function linuxNativeTool(name) {
  if(path.isAbsolute(name)){await fs.access(name,1);return name;}
  for(const directory of (process.env.PATH||'').split(path.delimiter).filter(Boolean)) {
    const candidate=path.resolve(directory,name);
    try {await fs.access(candidate,1);if((await fs.stat(candidate)).isFile())return candidate;}catch {}
  }
  throw new Error('Required native build tool is unavailable: '+name);
}
export function parsePkgConfigFlags(value) {
  const result=[];let word='',quoted='',escaped=false,started=false;
  for(const character of value) {
    if(escaped){word+=character;escaped=false;started=true;continue;}
    if(character==='\\'&&quoted!=="'"){escaped=true;started=true;continue;}
    if(quoted){if(character===quoted)quoted='';else word+=character;started=true;continue;}
    if(character==='"'||character==="'"){quoted=character;started=true;continue;}
    if(/\s/.test(character)){if(started){result.push(word);word='';started=false;}continue;}
    word+=character;started=true;
  }
  if(escaped||quoted)throw new Error('Malformed pkg-config quoting');
  if(started)result.push(word);
  if(result.some(value=>value.includes('\0')))throw new Error('Invalid pkg-config output');
  return result;
}
export async function buildLinuxAOTTemplate({out=path.join(root,'artifacts/linux-aot/runtime'),cache=path.join(root,'.native-build/linux-aot'),jobs=3,compiler='clang++',log=()=>{},signal}={}) {
  if(process.platform!=='linux'||process.arch!=='x64')throw new Error('The Linux SDK runtime must be built on native Linux x86_64.');
  if(!Number.isInteger(jobs)||jobs<1||jobs>16)throw new Error('jobs must be 1..16');
  const snapshot=readLinuxAOTSources(root),work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-linux-runtime-'));
  try {
    const invoke=(executable,args)=>runTool(executable,args,{cwd:work,timeout:600000,log,signal});
    const cxx=await linuxNativeTool(compiler),pkg=await linuxNativeTool('pkg-config');
    const compilerVersion=await invoke(cxx,['--version']),gtkVersion=await invoke(pkg,['--modversion','gtk+-3.0']);
    await invoke(pkg,['--atleast-version=3.24','gtk+-3.0']);
    const cflags=parsePkgConfigFlags(await invoke(pkg,['--cflags','gtk+-3.0'])),libraries=parsePkgConfigFlags(await invoke(pkg,['--libs','gtk+-3.0']));
    for(const [name,content]of Object.entries(snapshot.files)){const destination=path.join(work,name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,content,{flag:'wx'});}
    await fs.mkdir(cache,{recursive:true});const cacheInfo=await fs.lstat(cache);if(!cacheInfo.isDirectory()||cacheInfo.isSymbolicLink())throw new Error('Runtime cache must be a regular directory.');
    const compileOptions=['-std=c++17','-O2','-fPIE','-fexceptions','-fstack-protector-strong','-D_FORTIFY_SOURCE=2','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-deprecated-declarations'];
    const flags=[...compileOptions,'-I',path.join(work,'native'),'-I',path.join(work,'shared-aot'),'-I',path.join(work,'gtk'),...cflags];
    const group=name=>name.startsWith('native/')?0:name.startsWith('shared-aot/')?1:name.startsWith('gtk/')?2:3;
    const sources=Object.keys(snapshot.files).filter(name=>name.endsWith('.cpp')).sort((a,b)=>group(a)-group(b)||a.localeCompare(b)),objects=new Array(sources.length);
    const portableHeaders=Object.entries(snapshot.files).filter(([name])=>name.endsWith('.hpp')&&!name.startsWith('gtk/')).sort().map(([name,value])=>name+'\0'+value).join('\0');
    const gtkHeaders=Object.entries(snapshot.files).filter(([name])=>name.startsWith('gtk/')&&name.endsWith('.hpp')).sort().map(([name,value])=>name+'\0'+value).join('\0');
    let next=0;const errors=[];
    async function worker() {
      while(!errors.length){const index=next++;if(index>=sources.length)return;
        const name=sources[index],key=hash(compilerVersion+'\0'+gtkVersion+'\0'+JSON.stringify([...compileOptions,...cflags])+'\0'+portableHeaders+'\0'+(name.startsWith('gtk/')?gtkHeaders:'')+'\0'+name+'\0'+snapshot.files[name]);
        const cached=path.join(cache,key+'.o');objects[index]=cached;
        try {
          signal?.throwIfAborted();let reusable=false;
          try {const entry=await fs.lstat(cached);reusable=entry.isFile()&&!entry.isSymbolicLink()&&entry.size>0;}catch(error){if(error.code!=='ENOENT')throw error;}
          if(!reusable){const object=path.join(work,index+'.o');await invoke(cxx,[...flags,'-c',path.join(work,name),'-o',object]);const temporary=cached+'.'+randomUUID();await fs.copyFile(object,temporary);await fs.rename(temporary,cached);}
        }catch(error){errors.push(error);}
      }
    }
    await Promise.all(Array.from({length:Math.min(jobs,sources.length)},worker));if(errors.length)throw errors[0];
    const executable=path.join(work,'runtime-x86_64');
    await invoke(cxx,['-pie','-Wl,-z,relro,-z,now,-z,noexecstack','-Wl,--build-id=none',...objects,...libraries,'-ldl','-pthread','-o',executable]);
    await invoke(await linuxNativeTool('strip'),['--strip-debug',executable]);
    const bytes=new Uint8Array(await fs.readFile(executable));
    const readelf=await linuxNativeTool('readelf');
    const versionInfo=await invoke(readelf,['--version-info',executable]);
    const versions=prefix=>[...new Set([...versionInfo.matchAll(new RegExp('\\b'+prefix+'_[0-9.]+','g'))].map(match=>match[0]))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const provenance={...snapshot.provenance,compilerVersion,gtkVersion,buildPlatform:'linux',buildArchitecture:'x86_64',runtimeOptimization:2,glibcVersions:versions('GLIBC'),glibcxxVersions:versions('GLIBCXX')};
    const manifest=await createLinuxAOTRuntimeManifest(bytes,provenance);await verifyLinuxAOTRuntime(bytes,manifest);
    await fs.mkdir(out,{recursive:true});const info=await fs.lstat(out);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Runtime output must be a regular directory.');
    await fs.writeFile(path.join(out,'runtime-x86_64'),bytes,{flag:'wx',mode:0o644});
    await fs.writeFile(path.join(out,'runtime.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o644});
    return {bytes,manifest,build:{compiler:cxx,cflags,libraries,objects:sources.map((source,index)=>({source,object:objects[index]}))}};
  }finally {await fs.rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2),options={log:value=>process.stderr.write(value)};
    for(let index=0;index<args.length;index+=2){const name=args[index],value=args[index+1];if(!value||!['--out','--cache','--jobs','--compiler'].includes(name))throw new Error('Usage: node tools/build-linux-aot-template.mjs [--out DIRECTORY] [--cache DIRECTORY] [--jobs 1..16] [--compiler PATH]');options[name.slice(2)]=name==='--jobs'?Number(value):value;}
    console.log(JSON.stringify((await buildLinuxAOTTemplate(options)).manifest,null,2));
  }catch(error){console.error(error.message,error.output||'');process.exitCode=1;}
}
