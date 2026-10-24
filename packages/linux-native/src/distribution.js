/** Offline installable packages built from the same sealed Linux ELF application. */
import {exportLinuxApplication,unpackLinuxAOTArchive} from './aot-export.js';
import {linuxOptions,linuxArtifactFilename,LINUX_LIMITS} from './target.js';
import {sha256Bytes} from '../../macos-native/src/archive.js';
import {arArchive,gzipStore,md5Bytes,rpmArchive,tarArchive,utf8} from './distribution-archive.js';
import {LINUX_RUNTIME_LICENSE} from './runtime-license.js';

export const LINUX_DISTRIBUTION_FORMATS=Object.freeze({
  zip:Object.freeze({label:'Portable ZIP',extension:'.zip',mimeType:'application/zip'}),
  'tar.gz':Object.freeze({label:'Portable tar.gz',extension:'.tar.gz',mimeType:'application/gzip'}),
  deb:Object.freeze({label:'Debian package',extension:'.deb',mimeType:'application/vnd.debian.binary-package'}),
  rpm:Object.freeze({label:'RPM package',extension:'.rpm',mimeType:'application/x-rpm'})
});
const singleLine=(value,key,max=256)=>{
  if(typeof value!=='string'||!value.trim()||value.length>max||/[\x00-\x1f\x7f\u2028\u2029]/.test(value))throw new Error('Invalid Linux package '+key);
  return value;
};
export function linuxDistributionOptions(options={},applicationName='Application') {
  if(!options||typeof options!=='object'||Array.isArray(options))throw new TypeError('Linux distribution options must be an object');
  const format=options.format??'zip';
  if(typeof format!=='string'||!Object.hasOwn(LINUX_DISTRIBUTION_FORMATS,format))throw new Error('Linux package format must be zip, tar.gz, deb or rpm');
  const slug=String(applicationName).normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64);
  const packageName=options.packageName??(slug.length>=2?slug:'vb6-application'),version=options.version??'1.0.0',release=options.release??'1';
  // A common Debian/RPM subset also makes the launcher and desktop Exec safe.
  if(typeof packageName!=='string'||!/^[a-z0-9][a-z0-9+.-]{1,63}$/.test(packageName))throw new Error('packageName must contain 2–64 lowercase ASCII letters, digits, +, . or -');
  if(typeof version!=='string'||!/^[0-9][a-zA-Z0-9.+~]{0,63}$/.test(version))throw new Error('Invalid Linux package version');
  if(typeof release!=='string'||!/^[1-9][0-9]{0,8}$/.test(release))throw new Error('Linux package release must be a positive integer string');
  const maintainer=singleLine(options.maintainer??'Unspecified publisher','maintainer');
  const summary=singleLine(options.summary??applicationName,'summary');
  const description=options.description??summary;
  if(typeof description!=='string'||!description.trim()||description.length>16384||/[\x00-\x08\x0b-\x1f\x7f\u2028\u2029]/.test(description))throw new Error('Invalid Linux package description');
  const license=singleLine(options.license??'Unspecified','license',128),homepage=options.homepage??'';
  if(typeof homepage!=='string')throw new Error('Invalid Linux package homepage');
  if(homepage){singleLine(homepage,'homepage',2048);let url;try{url=new URL(homepage);}catch{throw new Error('Invalid Linux package homepage');}
    if(!['https:','http:'].includes(url.protocol)||url.username||url.password)throw new Error('Package homepage must be an HTTP(S) URL without credentials');}
  const categories=options.categories??['Utility'];
  if(!Array.isArray(categories)||!categories.length||categories.length>16||new Set(categories).size!==categories.length||categories.some(value=>typeof value!=='string'||!/^[A-Za-z][A-Za-z0-9-]{0,63}$/.test(value)))throw new Error('Invalid Linux desktop categories');
  return Object.freeze({format,packageName,version,release,maintainer,summary,description,license,homepage,categories:Object.freeze([...categories])});
}
const desktopValue=value=>value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/\t/g,'\\t').replace(/^ | $/g,'\\s');
function completeEntries(files) {
  const entries=new Map();
  for(const entry of files){
    if(typeof entry.path!=='string'||utf8(entry.path).length>4096||/[\\\x00-\x1f\x7f:]/.test(entry.path)||entry.path.split('/').some(part=>!part||part==='.'||part==='..')||entries.has(entry.path)&&entries.get(entry.path).type!=='directory')throw new Error('Invalid or duplicate Linux package path');
    const parts=entry.path.split('/');parts.pop();let parent='';
    for(const part of parts){parent+=(parent?'/':'')+part;if(entries.has(parent)&&entries.get(parent).type!=='directory')throw new Error('Linux package path crosses a file');entries.set(parent,{path:parent,type:'directory',mode:0o755});}
    if(entries.has(entry.path)&&entry.type!=='directory')throw new Error('Linux package file shadows a directory');entries.set(entry.path,entry);
  }
  if(entries.size>LINUX_LIMITS.files*4)throw new Error('Too many Linux package entries');
  return [...entries.values()].sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
}
function installedEntries(files,application,metadata) {
  const root=application.name+'/',prefix='usr/lib/'+metadata.packageName+'/',entries=[];
  for(const [path,bytes]of files)entries.push({path:prefix+path.slice(root.length),bytes,mode:path===root+'bin/'+application.name?0o755:0o644});
  entries.push({path:'usr/bin/'+metadata.packageName,type:'symlink',mode:0o777,link:'../lib/'+metadata.packageName+'/bin/'+application.name});
  const desktop='[Desktop Entry]\nType=Application\nVersion=1.0\nName='+desktopValue(application.name)+'\nComment='+desktopValue(metadata.summary)+'\nExec=/usr/bin/'+metadata.packageName+'\nTryExec=/usr/bin/'+metadata.packageName+'\nTerminal=false\nCategories='+metadata.categories.join(';')+';\n';
  entries.push({path:'usr/share/applications/'+metadata.packageName+'.desktop',bytes:utf8(desktop),mode:0o644});
  const notice='Application: '+application.name+'\nApplication license: '+metadata.license+'\nPublisher: '+metadata.maintainer+'\n\nThe following license applies to the included VB6 Studio native runtime.\n\n'+LINUX_RUNTIME_LICENSE;
  entries.push({path:'usr/share/doc/'+metadata.packageName+'/copyright',bytes:utf8(notice),mode:0o644});
  return completeEntries(entries);
}
function debianArchive(entries,metadata,architecture) {
  const size=entries.reduce((sum,entry)=>sum+(entry.bytes?.length||0),0);
  const fields=['Package: '+metadata.packageName,'Version: '+metadata.version+'-'+metadata.release,'Section: utils','Priority: optional','Architecture: '+(architecture==='arm64'?'arm64':'amd64'),
    'Maintainer: '+metadata.maintainer,'Installed-Size: '+Math.ceil(size/1024),
    'Depends: libc6 (>= 2.39), libstdc++6 (>= 13.2), libgcc-s1, libgtk-3-0t64 (>= 3.24), libcups2t64',
    ...(metadata.homepage?['Homepage: '+metadata.homepage]:[]),'Description: '+metadata.summary,
    ...metadata.description.split('\n').map(line=>' '+(line.trim()?line:'.'))];
  const sums=entries.filter(entry=>!entry.type).map(entry=>md5Bytes(entry.bytes)+'  '+entry.path).join('\n')+'\n';
  const controls=tarArchive([{path:'control',bytes:utf8(fields.join('\n')+'\n'),mode:0o644},{path:'md5sums',bytes:utf8(sums),mode:0o644}]);
  return arArchive([{name:'debian-binary',bytes:utf8('2.0\n')},{name:'control.tar.gz',bytes:gzipStore(controls)},{name:'data.tar.gz',bytes:gzipStore(tarArchive(entries))}]);
}
/** Revalidates input bytes. Caller-supplied files/reports never replace the seal. */
export async function packageLinuxApplication(application,options={}, {signal}={}) {
  signal?.throwIfAborted();
  if(!(application?.bytes instanceof Uint8Array)||!application.options)throw new TypeError('Expected an exported Linux application');
  const compiler=linuxOptions(application.options),metadata=linuxDistributionOptions(options,compiler.name);
  const bytes=application.bytes.slice(),unpacked=await unpackLinuxAOTArchive(bytes,compiler);signal?.throwIfAborted();
  const prefix=compiler.name+'/',report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(unpacked.files.get(prefix+'Resources/vb6-build.json')));
  const applicationSha256=await sha256Bytes(bytes),format=LINUX_DISTRIBUTION_FORMATS[metadata.format];
  let packaged=bytes,entries,filename=linuxArtifactFilename(compiler.name,compiler.architecture,format.extension);
  if(metadata.format==='tar.gz'){
    entries=completeEntries([...unpacked.files].map(([path,value])=>({path,bytes:value,mode:path===prefix+'bin/'+compiler.name?0o755:0o644})));
    packaged=gzipStore(tarArchive(entries));
  }else if(metadata.format==='deb'||metadata.format==='rpm'){
    entries=installedEntries(unpacked.files,compiler,metadata);
    if(metadata.format==='deb')packaged=debianArchive(entries,metadata,compiler.architecture);
    else {
      const shared=new Set(['usr','usr/bin','usr/lib','usr/share','usr/share/applications','usr/share/doc']);
      packaged=await rpmArchive(entries.filter(entry=>!shared.has(entry.path)),{...metadata,architecture:compiler.architecture},report.dependencies);
    }
    const architecture=compiler.architecture==='arm64'?(metadata.format==='deb'?'arm64':'aarch64'):(metadata.format==='deb'?'amd64':'x86_64');
    filename=metadata.format==='deb'?metadata.packageName+'_'+metadata.version+'-'+metadata.release+'_'+architecture+'.deb':metadata.packageName+'-'+metadata.version+'-'+metadata.release+'.'+architecture+'.rpm';
  }
  signal?.throwIfAborted();
  const sha256=await sha256Bytes(packaged);signal?.throwIfAborted();
  const install=metadata.format==='deb'||metadata.format==='rpm'?{prefix:'/usr/lib/'+metadata.packageName,launcher:'/usr/bin/'+metadata.packageName,desktop:'/usr/share/applications/'+metadata.packageName+'.desktop'}:null;
  return {bytes:packaged,filename,mimeType:format.mimeType,options:compiler,distribution:metadata,
    report:{...report,bytes:packaged.length,sha256,applicationSha256,distribution:metadata,installation:install,integrityVerified:true,runtimeProvenanceVerified:true,signed:false}};
}
export async function exportLinuxDistribution(project,compiler={},distribution={},packaging={}) {
  // Validate package metadata before spending time compiling an application.
  const normalized=linuxDistributionOptions(distribution,compiler.name??project?.name??'Application');packaging.signal?.throwIfAborted();
  return packageLinuxApplication(await exportLinuxApplication(project,compiler,packaging),normalized,packaging);
}
