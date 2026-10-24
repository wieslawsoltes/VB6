/** Maintainer-only native SDK compilation; projects themselves compile in JS. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {runTool} from '../packages/macos-native/src/build-driver.mjs';
import {readLinuxAOTSources} from './linux-aot-provenance.mjs';
import {createLinuxAOTRuntimeManifest,verifyLinuxAOTRuntime} from '../packages/linux-native/src/elf.js';
import {linuxTarget,linuxToolkit} from '../packages/linux-native/src/target.js';
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
/** Extracted .deb sysroots need the same caches that package postinst creates. */
export async function verifyLinuxAOTExecutionSysroot(sysroot,{architecture='arm64',toolkit='gtk3'}={}) {
  const target=linuxTarget(architecture,toolkit),directory=await fs.realpath(path.resolve(sysroot));
  const prefix='usr/lib/'+target.triple+'/gdk-pixbuf-2.0',cachePath=prefix+'/2.10.0/loaders.cache';
  const prerequisites='Initialize target GTK image loaders before cross execution: install target libgdk-pixbuf-2.0-0 and librsvg2-common, run the target '+prefix+'/gdk-pixbuf-query-loaders under QEMU with -L SYSROOT and redirect its output to SYSROOT/'+cachePath+', then run update-mime-database SYSROOT/usr/share/mime. Native package installation normally creates these caches.';
  let cache,mime;
  try{cache=await fs.readFile(path.join(directory,cachePath));mime=await fs.readFile(path.join(directory,'usr/share/mime/mime.cache'));}
  catch(error){if(error.code==='ENOENT')throw new Error('Missing cross-sysroot GdkPixbuf or MIME cache. '+prerequisites);throw error;}
  if(!cache.length||!mime.length)throw new Error('Empty cross-sysroot GdkPixbuf or MIME cache. '+prerequisites);
  for(const format of ['ico','svg']){
    const name=new RegExp('^"([^"\\n]*libpixbufloader-'+format+'\\.so)"\\s*$','m').exec(cache.toString('utf8'))?.[1];
    if(!name||!path.isAbsolute(name))throw new Error('Cross-sysroot image-loader cache lacks '+format.toUpperCase()+'. '+prerequisites);
    const filename=name.startsWith(directory+path.sep)?path.resolve(name):path.resolve(directory,'.'+name);
    if(!filename.startsWith(directory+path.sep))throw new Error('Cross-sysroot image-loader path escapes its root. '+prerequisites);
    let bytes;try{bytes=await fs.readFile(filename);}catch(error){if(error.code==='ENOENT')throw new Error('Cross-sysroot image-loader cache names a missing '+format.toUpperCase()+' module. '+prerequisites);throw error;}
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
    if(bytes.length<20||view.getUint32(0,true)!==0x464c457f||bytes[4]!==2||bytes[5]!==1||view.getUint16(18,true)!==target.machine)
      throw new Error('Cross-sysroot '+format.toUpperCase()+' image loader has the wrong ELF architecture. '+prerequisites);
  }
  const gtkModulePath=path.join(directory,'usr/lib',target.triple,toolkit==='gtk4'?'gtk-4.0':'gtk-3.0');
  let backend;
  try{backend=await fs.readFile(path.join(gtkModulePath,toolkit==='gtk4'?'4.0.0/printbackends/libprintbackend-cups.so':'3.0.0/printbackends/libprintbackend-cups.so'));}
  catch(error){if(error.code==='ENOENT')throw new Error('Missing cross-sysroot GTK CUPS print backend. Install the selected target GTK CUPS print backend and its native dependencies before qualification.');throw error;}
  const backendView=new DataView(backend.buffer,backend.byteOffset,backend.byteLength);
  if(backend.length<20||backendView.getUint32(0,true)!==0x464c457f||backend[4]!==2||backend[5]!==1||backendView.getUint16(18,true)!==target.machine)
    throw new Error('Cross-sysroot GTK CUPS print backend has the wrong ELF architecture.');
  return {imageLoaders:['ico','svg'],gdkPixbufCacheSha256:hash(cache),mimeCacheSha256:hash(mime),gtkModulePath,gtkPrintBackendSha256:hash(backend)};
}
export async function buildLinuxAOTTemplate({architecture='x64',toolkit='gtk3',out,cache=path.join(root,'.native-build/linux-aot'),jobs=3,compiler,sysroot,log=()=>{},signal}={}) {
  const target=linuxTarget(architecture,toolkit),gtk=linuxToolkit(toolkit),cross=process.arch!==target.option;
  if(process.platform!=='linux'||!['x64','arm64'].includes(process.arch))throw new Error('The Linux SDK runtime must be built on Linux x64 or ARM64.');
  if(cross&&!sysroot)throw new Error('Cross compilation requires an explicit target GTK/CUPS sysroot.');
  if(sysroot){sysroot=await fs.realpath(path.resolve(sysroot));if(!(await fs.stat(sysroot)).isDirectory())throw new Error('The Linux cross sysroot must be a directory.');}
  compiler??=cross?target.triple+'-g++':'clang++';
  out??=path.join(root,'artifacts/linux-aot','runtime'+(toolkit==='gtk4'?'-gtk4':'')+(target.option==='arm64'?'-arm64':''));
  if(!Number.isInteger(jobs)||jobs<1||jobs>16)throw new Error('jobs must be 1..16');
  const snapshot=readLinuxAOTSources(root),work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-linux-runtime-'));
  try {
    const invoke=(executable,args)=>runTool(executable,args,{cwd:work,timeout:600000,log,signal});
    const cxx=await linuxNativeTool(compiler),pkg=await linuxNativeTool('pkg-config'),env=await linuxNativeTool('env');
    const pkgConfig=args=>sysroot?invoke(env,['PKG_CONFIG_PATH=','PKG_CONFIG_SYSROOT_DIR='+sysroot,'PKG_CONFIG_LIBDIR='+[path.join(sysroot,'usr/lib',target.triple,'pkgconfig'),path.join(sysroot,'usr/lib/pkgconfig'),path.join(sysroot,'usr/share/pkgconfig')].join(path.delimiter),pkg,...args]):invoke(pkg,args);
    const compilerVersion=await invoke(cxx,['--version']),compilerTriple=(await invoke(cxx,['-dumpmachine'])).trim(),gtkVersion=await pkgConfig(['--modversion',gtk.pkgConfig]);
    if(!(target.option==='arm64'?/^aarch64.*linux/:/^x86_64.*linux/).test(compilerTriple))throw new Error('Native C++ compiler does not target '+target.architecture+': '+compilerTriple);
    await pkgConfig(['--atleast-version='+gtk.minimumGTK,gtk.pkgConfig]);
    // GtkPrintUnixDialog is in libgtk-3; only its public header directory is
    // additional. Keep portable object flags stable to reuse the shared SDK.
    const portableCflags=parsePkgConfigFlags(await pkgConfig(['--cflags',gtk.pkgConfig]));
    const cflags=parsePkgConfigFlags(await pkgConfig(['--cflags',gtk.printPkgConfig,...(toolkit==='gtk4'?['x11']:[])])),libraries=[...parsePkgConfigFlags(await pkgConfig(['--libs',gtk.printPkgConfig,...(toolkit==='gtk4'?['x11']:[])])),'-lcups'];
    const targetFlags=[...(sysroot?['--sysroot='+sysroot]:[]),...(target.option==='arm64'?['-march=armv8-a']:[])];
    let sysrootPackagesSha256;
    if(sysroot){try{sysrootPackagesSha256=hash(await fs.readFile(path.join(sysroot,'.vb6-sysroot-packages.txt')));}catch(error){if(error.code!=='ENOENT')throw error;}}
    for(const [name,content]of Object.entries(snapshot.files)){const destination=path.join(work,name);await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,content,{flag:'wx'});}
    await fs.mkdir(cache,{recursive:true});const cacheInfo=await fs.lstat(cache);if(!cacheInfo.isDirectory()||cacheInfo.isSymbolicLink())throw new Error('Runtime cache must be a regular directory.');
    const compileOptions=[...targetFlags,'-std=c++17','-O2','-fPIE','-fexceptions','-fstack-protector-strong','-D_FORTIFY_SOURCE=2','-Wall','-Wextra','-Werror','-Wno-misleading-indentation','-Wno-deprecated-declarations'];
    const flags=[...compileOptions,'-I',path.join(work,'native'),'-I',path.join(work,'shared-aot'),'-I',path.join(work,'gtk')];
    const group=name=>name.startsWith('native/')?0:name.startsWith('shared-aot/')?1:name.startsWith('gtk/')?2:3;
    const sources=Object.keys(snapshot.files).filter(name=>name.endsWith('.cpp')).sort((a,b)=>group(a)-group(b)||a.localeCompare(b)),objects=new Array(sources.length);
    const portableHeaders=Object.entries(snapshot.files).filter(([name])=>name.endsWith('.hpp')&&!name.startsWith('gtk/')).sort().map(([name,value])=>name+'\0'+value).join('\0');
    const gtkHeaders=Object.entries(snapshot.files).filter(([name])=>name.startsWith('gtk/')&&name.endsWith('.hpp')).sort().map(([name,value])=>name+'\0'+value).join('\0');
    let next=0;const errors=[];
    async function worker() {
      while(!errors.length){const index=next++;if(index>=sources.length)return;
        const name=sources[index],sourceCflags=name.startsWith('gtk/')?cflags:portableCflags,key=hash(compilerTriple+'\0'+compilerVersion+'\0'+gtkVersion+'\0'+(sysrootPackagesSha256||'')+'\0'+JSON.stringify([...compileOptions,...sourceCflags])+'\0'+portableHeaders+'\0'+(name.startsWith('gtk/')?gtkHeaders:'')+'\0'+name+'\0'+snapshot.files[name]);
        const cached=path.join(cache,key+'.o');objects[index]=cached;
        try {
          signal?.throwIfAborted();let reusable=false;
          try {const entry=await fs.lstat(cached);reusable=entry.isFile()&&!entry.isSymbolicLink()&&entry.size>0;}catch(error){if(error.code!=='ENOENT')throw error;}
          if(!reusable){const object=path.join(work,index+'.o');await invoke(cxx,[...flags,...sourceCflags,'-c',path.join(work,name),'-o',object]);const temporary=cached+'.'+randomUUID();await fs.copyFile(object,temporary);await fs.rename(temporary,cached);}
        }catch(error){errors.push(error);}
      }
    }
    await Promise.all(Array.from({length:Math.min(jobs,sources.length)},worker));if(errors.length)throw errors[0];
    const filename='runtime-'+target.architecture,executable=path.join(work,filename);
    const linkOptions=[...targetFlags,'-pie','-Wl,--as-needed','-Wl,-z,relro,-z,now,-z,noexecstack','-Wl,--build-id=none','-Wl,-z,max-page-size='+target.pageBytes+',-z,common-page-size='+target.pageBytes];
    await invoke(cxx,[...linkOptions,...objects,...libraries,'-ldl','-pthread','-o',executable]);
    await invoke(await linuxNativeTool(cross?target.triple+'-strip':'strip'),['--strip-debug',executable]);
    const bytes=new Uint8Array(await fs.readFile(executable));
    const readelf=await linuxNativeTool('readelf');
    const versionInfo=await invoke(readelf,['--version-info',executable]);
    const versions=prefix=>[...new Set([...versionInfo.matchAll(new RegExp('\\b'+prefix+'_[0-9.]+','g'))].map(match=>match[0]))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
    const provenance={...snapshot.provenance,compilerVersion,compilerTriple,gtkVersion,toolkit,buildPlatform:'linux',buildArchitecture:linuxTarget(process.arch).architecture,targetArchitecture:target.architecture,crossCompiled:cross,...(sysrootPackagesSha256?{sysrootPackagesSha256}:{}),runtimeOptimization:2,glibcVersions:versions('GLIBC'),glibcxxVersions:versions('GLIBCXX')};
    const manifest=await createLinuxAOTRuntimeManifest(bytes,provenance);await verifyLinuxAOTRuntime(bytes,manifest);
    if(manifest.architecture!==target.architecture)throw new Error('Compiled runtime ELF machine does not match the requested architecture.');
    await fs.mkdir(out,{recursive:true});const info=await fs.lstat(out);if(!info.isDirectory()||info.isSymbolicLink())throw new Error('Runtime output must be a regular directory.');
    await fs.writeFile(path.join(out,filename),bytes,{flag:'wx',mode:0o644});
    await fs.writeFile(path.join(out,'runtime.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx',mode:0o644});
    return {bytes,manifest,build:{compiler:cxx,compilerFlags:targetFlags,linkOptions,cflags,libraries,objects:sources.map((source,index)=>({source,object:objects[index]}))}};
  }finally {await fs.rm(work,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const args=process.argv.slice(2),options={log:value=>process.stderr.write(value)};
    for(let index=0;index<args.length;index+=2){const name=args[index],value=args[index+1];if(!value||!['--architecture','--toolkit','--out','--cache','--jobs','--compiler','--sysroot'].includes(name))throw new Error('Usage: node tools/build-linux-aot-template.mjs [--architecture x64|arm64] [--toolkit gtk3|gtk4] [--out DIRECTORY] [--cache DIRECTORY] [--jobs 1..16] [--compiler PATH] [--sysroot DIRECTORY]');options[name.slice(2)]=name==='--jobs'?Number(value):value;}
    console.log(JSON.stringify((await buildLinuxAOTTemplate(options)).manifest,null,2));
  }catch(error){console.error(error.message,error.output||'');process.exitCode=1;}
}
