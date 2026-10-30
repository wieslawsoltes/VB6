/** Real AppImage/OSTree bundles built locally from a verified AOT application. */
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {unpackLinuxAOTArchive,linuxDistributionOptions} from '../dist/index.js';
import {LINUX_NATIVE_DISTRIBUTION_FORMATS,LINUX_FLATPAK_RUNTIME,LINUX_FLATPAK_DEFAULT_PERMISSIONS} from './distribution-targets.js';
import {readPackageFile,writePackageFile,runPackagingTool,packageToolVersion} from './native-distribution-tools.mjs';
import {loadAppImageRuntime,APPIMAGE_RUNTIME_LICENSE} from './appimage-runtime.mjs';
import {bundleAppImageDependencies} from './appimage-dependencies.mjs';
import {appImageGtkDataNotice} from './appimage-gtk-data.mjs';
export {LINUX_NATIVE_DISTRIBUTION_FORMATS,LINUX_FLATPAK_RUNTIME,LINUX_FLATPAK_DEFAULT_PERMISSIONS};

const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value,null,2)+'\n';
const shellQuote=value=>"'"+value.replace(/'/g,"'\\''")+"'";
const xml=value=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
const desktopValue=value=>value.replace(/\\/g,'\\\\').replace(/\n/g,'\\n').replace(/\t/g,'\\t').replace(/^ | $/g,'\\s');
const icon='<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128"><rect x="4" y="4" width="120" height="120" rx="22" fill="#4355ad"/><path d="M24 35h15l11 41 11-41h15L57 94H43zm55 0h27v12H91v10h12v12H91v13h15v12H79z" fill="white"/></svg>\n';
const permitted=new Set(['share=ipc','share=network','socket=wayland','socket=x11','socket=fallback-x11','socket=cups','socket=pulseaudio','device=dri',
  'filesystem=home','filesystem=home:ro','filesystem=xdg-documents','filesystem=xdg-documents:ro','filesystem=xdg-download','filesystem=xdg-download:ro']);
const commonKeys=new Set(['format','packageName','version','release','maintainer','summary','description','license','homepage','categories']);
const flatpakKeys=new Set(['appId','runtime','runtimeVersion','runtimeRepository','branch','flatpakPermissions']);
export function linuxNativeDistributionOptions(options={},applicationName='Application') {
  if(!options||typeof options!=='object'||Array.isArray(options)||!Object.hasOwn(LINUX_NATIVE_DISTRIBUTION_FORMATS,options.format))throw new Error('Native Linux package format must be appimage or flatpak');
  for(const key of Object.keys(options))if(!commonKeys.has(key)&&!(options.format==='flatpak'&&flatpakKeys.has(key)))throw new Error('Unsupported '+options.format+' package option: '+key);
  const common=linuxDistributionOptions({...options,format:'zip'},applicationName);
  if(options.format==='appimage')return Object.freeze({...common,format:'appimage'});
  const appId=options.appId??'org.vb6studio.App_'+common.packageName.replace(/[^A-Za-z0-9_]/g,'_');
  if(typeof appId!=='string'||appId.length>242||!/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*){2,}$/.test(appId))throw new Error('Flatpak appId must be a reverse-DNS identifier with at least three ASCII components and at most 242 characters to fit exported metadata filenames');
  const runtime=options.runtime??LINUX_FLATPAK_RUNTIME.name,runtimeVersion=options.runtimeVersion??LINUX_FLATPAK_RUNTIME.version;
  if(runtime!==LINUX_FLATPAK_RUNTIME.name)throw new Error('Flatpak runtime must be org.gnome.Platform (GTK3 and GTK4 are required)');
  if(typeof runtimeVersion!=='string'||!/^[5-9][0-9]$/.test(runtimeVersion))throw new Error('Flatpak runtimeVersion must be a stable GNOME release 50 or newer');
  const branch=options.branch??'stable';
  if(typeof branch!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(branch))throw new Error('Invalid Flatpak application branch');
  const runtimeRepository=options.runtimeRepository??LINUX_FLATPAK_RUNTIME.repository;let url;
  try {url=new URL(runtimeRepository);}catch{throw new Error('Invalid Flatpak runtimeRepository URL');}
  if(typeof runtimeRepository!=='string'||runtimeRepository.length>2048||/[\x00-\x20\x7f]/.test(runtimeRepository)||url.protocol!=='https:'||url.username||url.password||url.hash)throw new Error('Flatpak runtimeRepository must be an HTTPS URL without credentials or fragments');
  const flatpakPermissions=options.flatpakPermissions??LINUX_FLATPAK_DEFAULT_PERMISSIONS;
  if(!Array.isArray(flatpakPermissions)||flatpakPermissions.length>permitted.size||new Set(flatpakPermissions).size!==flatpakPermissions.length||flatpakPermissions.some(value=>!permitted.has(value)))throw new Error('Unsupported or duplicate Flatpak sandbox permission');
  if(flatpakPermissions.includes('socket=x11')&&flatpakPermissions.includes('socket=fallback-x11'))throw new Error('Choose either x11 or fallback-x11 for Flatpak');
  return Object.freeze({...common,format:'flatpak',appId,runtime,runtimeVersion,runtimeRepository,branch,flatpakPermissions:Object.freeze([...flatpakPermissions])});
}
function nativeToolchain(value,format,architecture) {
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error('Native packaging toolchain must be an object');
  const common=['temporaryDirectory'],specific=format==='appimage'?['sysroot','readelf','mksquashfs','unsquashfs','appimageRuntime','appimageRuntimeSha256','appimageRuntimeLicense']:['flatpak','ostree','gpgKeyId','gpgHome','gpgPublicKey','flatpakIconSandbox'];
  for(const key of Object.keys(value))if(![...common,...specific].includes(key))throw new Error('Unsupported '+format+' toolchain option: '+key);
  for(const [key,item]of Object.entries(value)){
    if(key==='flatpakIconSandbox'){if(typeof item!=='boolean')throw new Error('flatpakIconSandbox must be boolean');continue;}
    if(typeof item!=='string'||!item||/[\x00-\x1f\x7f]/.test(item)||item.length>4096)throw new Error('Invalid native packaging toolchain '+key);
  }
  if(value.gpgKeyId&&!/^[A-Fa-f0-9]{40,64}$/.test(value.gpgKeyId))throw new Error('Flatpak gpgKeyId must be a full signing-key fingerprint');
  if((value.gpgHome||value.gpgPublicKey)&&!value.gpgKeyId)throw new Error('Flatpak signing options require gpgKeyId');
  if(value.gpgKeyId&&!value.gpgPublicKey)throw new Error('Flatpak signing requires gpgPublicKey for bundle verification');
  if(value.appimageRuntime&&!value.appimageRuntimeLicense)throw new Error('A custom AppImage runtime requires appimageRuntimeLicense');
  if(value.appimageRuntimeLicense&&!value.appimageRuntime)throw new Error('appimageRuntimeLicense requires appimageRuntime');
  if(format==='appimage'&&!value.sysroot&&architecture!==(process.arch==='arm64'?'arm64':process.arch==='x64'?'x64':'unsupported'))throw new Error('Cross-architecture AppImage packaging requires an explicit target sysroot');
  const normalized={...value};
  // Tool subprocesses run inside a private staging directory. Explicit relative
  // executable paths refer to the caller's working directory, like data paths;
  // bare command names continue to use PATH.
  for(const key of ['readelf','mksquashfs','unsquashfs','flatpak','ostree'])if(normalized[key]?.includes(path.sep))normalized[key]=path.resolve(normalized[key]);
  return normalized;
}
async function addApplication(root,files,compiler,prefix) {
  const appRoot=compiler.name+'/';
  for(const [name,bytes]of files){
    if(!name.startsWith(appRoot))throw new Error('Application archive escapes its root');
    await writePackageFile(root,prefix+name.slice(appRoot.length),bytes,name===appRoot+'bin/'+compiler.name?0o755:0o644);
  }
}
function desktop(application,metadata,command,iconName) {
  return '[Desktop Entry]\nType=Application\nVersion=1.0\nName='+desktopValue(application.name)+'\nComment='+desktopValue(metadata.summary)+'\nExec='+command+'\nIcon='+iconName+'\nTerminal=false\nCategories='+metadata.categories.join(';')+';\n';
}
function appstream(application,metadata) {
  return '<?xml version="1.0" encoding="UTF-8"?>\n<component type="desktop-application"><id>'+metadata.appId+'</id><metadata_license>CC0-1.0</metadata_license><project_license>'+xml(metadata.license==='Unspecified'?'LicenseRef-proprietary':metadata.license)+'</project_license><name>'+xml(application.name)+'</name><summary>'+xml(metadata.summary)+'</summary><description>'+metadata.description.split(/\n\s*\n/).map(p=>'<p>'+xml(p.replace(/\n/g,' '))+'</p>').join('')+'</description><launchable type="desktop-id">'+metadata.appId+'.desktop</launchable>'+ (metadata.homepage?'<url type="homepage">'+xml(metadata.homepage)+'</url>':'')+'<releases><release version="'+xml(metadata.version)+'"/></releases></component>\n';
}
function flatpakFilename(metadata,architecture) {
  const suffix='-'+metadata.version+'-'+architecture+'.flatpak',limit=255-Buffer.byteLength(suffix);
  const stem=metadata.appId.length>limit?metadata.appId.slice(0,limit-13)+'-'+hash(metadata.appId).slice(0,12):metadata.appId;
  return stem+suffix;
}
async function flatpakBundle(context) {
  const {work,files,compiler,metadata,toolchain,signal,applicationSha256,report}=context,settings={cwd:work,signal};
  const flatpak=toolchain.flatpak??'flatpak',ostree=toolchain.ostree??'ostree',architecture=compiler.architecture==='arm64'?'aarch64':'x86_64';
  const versions={flatpak:await packageToolVersion(flatpak,['--version'],settings),ostree:await packageToolVersion(ostree,['--version'],settings)};
  const build=path.join(work,'build'),repo=path.join(work,'repo'),reimport=path.join(work,'verified-repo'),bundle=path.join(work,'application.flatpak');
  await fs.mkdir(build);await addApplication(build,files,compiler,'files/lib/'+metadata.packageName+'/');
  await writePackageFile(build,'files/bin/'+metadata.packageName,'#!/bin/sh\nexec '+shellQuote('/app/lib/'+metadata.packageName+'/bin/'+compiler.name)+' "$@"\n',0o755);
  await writePackageFile(build,'files/share/applications/'+metadata.appId+'.desktop',desktop(compiler,metadata,metadata.packageName,metadata.appId));
  await writePackageFile(build,'files/share/icons/hicolor/scalable/apps/'+metadata.appId+'.svg',icon);
  await writePackageFile(build,'files/share/metainfo/'+metadata.appId+'.metainfo.xml',appstream(compiler,metadata));
  const reference=metadata.runtime+'/'+architecture+'/'+metadata.runtimeVersion;
  await writePackageFile(build,'metadata','[Application]\nname='+metadata.appId+'\nruntime='+reference+'\nsdk=org.gnome.Sdk/'+architecture+'/'+metadata.runtimeVersion+'\ncommand='+metadata.packageName+'\n');
  const provenance={version:1,format:'flatpak',applicationSha256,executableSha256:report.executableSha256,runtime:reference,permissions:metadata.flatpakPermissions,tools:versions};
  await writePackageFile(build,'files/share/vb6/'+metadata.packageName+'/distribution.json',json(provenance));
  await runPackagingTool(flatpak,['build-finish','--no-inherit-permissions',...metadata.flatpakPermissions.map(value=>'--'+value),build],settings);
  const signing=toolchain.gpgKeyId?['--gpg-sign='+toolchain.gpgKeyId,...(toolchain.gpgHome?['--gpg-homedir='+path.resolve(toolchain.gpgHome)]:[])]:[];
  // Normal exports retain Flatpak's icon-validator sandbox. Build containers
  // that prohibit user namespaces can explicitly opt out for our fixed source
  // SVG; no caller-provided icon is accepted. Application sandboxing is unchanged.
  const exported=await runPackagingTool(flatpak,['build-export',...(toolchain.flatpakIconSandbox===false?['--disable-sandbox']:[]),'--arch='+architecture,'--timestamp=2000-01-01T00:00:00Z',...signing,repo,build,metadata.branch],settings);
  const match=exported.stdout.match(/^Commit: ([0-9a-f]{64})$/m);if(!match)throw new Error('Flatpak export did not return a commit checksum');
  const commit=match[1],ref='app/'+metadata.appId+'/'+architecture+'/'+metadata.branch;
  await runPackagingTool(flatpak,['build-bundle','--arch='+architecture,'--runtime-repo='+metadata.runtimeRepository,...(toolchain.gpgPublicKey?['--gpg-keys='+path.resolve(toolchain.gpgPublicKey)]:[]),repo,bundle,metadata.appId,metadata.branch],settings);
  // Import the actual single-file output through Flatpak/OSTree again. This
  // independently checks the static delta, object checksums and destination ref.
  await runPackagingTool(ostree,['--repo='+reimport,'init','--mode=archive-z2'],settings);
  await runPackagingTool(flatpak,['build-import-bundle',reimport,bundle],settings);
  const imported=(await runPackagingTool(ostree,['--repo='+reimport,'rev-parse',ref],settings)).stdout.trim();
  if(imported!==commit)throw new Error('Flatpak bundle changed its exported commit');
  await runPackagingTool(ostree,['--repo='+reimport,'fsck'],settings);
  if(toolchain.gpgKeyId){
    await readPackageFile(path.resolve(toolchain.gpgPublicKey),4*1024*1024);
    // `ostree show --gpg-verify-remote` may succeed when no signature exists.
    // A fresh, explicitly verified local pull requires a present valid signature
    // on the actual bundle's reimported commit; no network remote is contacted.
    const signatures=path.join(work,'verified-signature');
    await runPackagingTool(ostree,['--repo='+signatures,'init','--mode=archive-z2'],settings);
    await runPackagingTool(ostree,['--repo='+signatures,'remote','add','--gpg-import='+path.resolve(toolchain.gpgPublicKey),'publisher','file://'+reimport],settings);
    await runPackagingTool(ostree,['--repo='+signatures,'pull-local','--untrusted','--gpg-verify','--remote=publisher','--commit-metadata-only',reimport,commit],settings);
    if((await runPackagingTool(ostree,['--repo='+signatures,'rev-parse',commit],settings)).stdout.trim()!==commit)throw new Error('Flatpak signature verification changed its commit');
  }
  const bytes=await readPackageFile(bundle);
  return {bytes,filename:flatpakFilename(metadata,architecture),nativePackaging:{...provenance,commit,ref,runtimeRepository:metadata.runtimeRepository,containerVerified:true,...(toolchain.gpgKeyId?{signatureVerification:'ostree-pull-local-gpg-verify'}:{})},signed:Boolean(toolchain.gpgKeyId),installation:{prefix:'/app/lib/'+metadata.packageName,launcher:'/app/bin/'+metadata.packageName,desktop:metadata.appId+'.desktop'}};
}
function appimageLauncher(compiler,metadata,dependencies) {
  const lines=['#!/bin/sh','set -u','APPDIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P) || exit 1','export APPDIR',
    'export LD_LIBRARY_PATH="$APPDIR/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"',
    'export XDG_DATA_DIRS="$APPDIR/usr/share${XDG_DATA_DIRS:+:$XDG_DATA_DIRS}:/usr/local/share:/usr/share"',
    'export GTK_DATA_PREFIX="$APPDIR/usr"',
    'export GSETTINGS_SCHEMA_DIR="$APPDIR/usr/share/glib-2.0/schemas"','export FONTCONFIG_FILE="$APPDIR/etc/fonts/fonts.conf"'];
  if(dependencies.gtkPaths.length)lines.push('export GTK_PATH='+dependencies.gtkPaths.map(value=>'"$APPDIR/'+value+'"').join(':'));
  if(dependencies.gioPaths.length)lines.push('export GIO_MODULE_DIR="$APPDIR/'+dependencies.gioPaths[0]+'"');
  if(dependencies.dataRelocations.length)lines.push('exec 9< "$APPDIR/usr/share/xml/iso-codes" || exit 1');
  if(!dependencies.caches.length){lines.push('exec "$APPDIR"/'+shellQuote('usr/lib/'+metadata.packageName+'/bin/'+compiler.name)+' "$@"');return lines.join('\n')+'\n';}
  lines.push('cache_root=$(mktemp -d "${TMPDIR:-/tmp}/vb6-appimage.XXXXXXXX") || exit 1','trap \'rm -rf -- "$cache_root"\' 0');
  for(let index=0;index<dependencies.caches.length;index++){
    const cache=dependencies.caches[index],filename='cache-'+index;
    lines.push('{');
    for(const chunk of cache.chunks)lines.push(chunk.text!==undefined?'  printf \'%s\' '+shellQuote(chunk.text):'  printf \'"%s/%s"\\n\' "$APPDIR" '+shellQuote(chunk.module));
    lines.push('} > "$cache_root/'+filename+'" || exit 1');
    const key=cache.path.endsWith('/loaders.cache')?'GDK_PIXBUF_MODULE_FILE':'GTK_IM_MODULE_FILE';lines.push('export '+key+'="$cache_root/'+filename+'"');
  }
  lines.push('"$APPDIR"/'+shellQuote('usr/lib/'+metadata.packageName+'/bin/'+compiler.name)+' "$@" &','child=$!',
    'trap \'kill -HUP "$child" 2>/dev/null || :\' HUP','trap \'kill -INT "$child" 2>/dev/null || :\' INT','trap \'kill -TERM "$child" 2>/dev/null || :\' TERM',
    'while :; do','  wait "$child"; status=$?','  kill -0 "$child" 2>/dev/null || break','done','trap - HUP INT TERM','exit "$status"');
  return lines.join('\n')+'\n';
}
async function appimageBundle(context) {
  const {work,files,compiler,metadata,toolchain,signal,applicationSha256,report}=context,settings={cwd:work,signal};
  const mksquashfs=toolchain.mksquashfs??'mksquashfs',unsquashfs=toolchain.unsquashfs??'unsquashfs',readelf=toolchain.readelf??'readelf';
  const versions={mksquashfs:await packageToolVersion(mksquashfs,['-version'],settings),unsquashfs:await packageToolVersion(unsquashfs,['-version'],{...settings,successCodes:[0,1]}),readelf:await packageToolVersion(readelf,['--version'],settings)};
  const runtime=await loadAppImageRuntime(compiler.architecture,{runtimePath:toolchain.appimageRuntime,runtimeSha256:toolchain.appimageRuntimeSha256});
  const appdir=path.join(work,'AppDir'),image=path.join(work,'filesystem.squashfs'),output=path.join(work,'application.AppImage'),verified=path.join(work,'verified');
  await fs.mkdir(appdir);const prefix='usr/lib/'+metadata.packageName+'/';await addApplication(appdir,files,compiler,prefix);
  const dependencies=await bundleAppImageDependencies({appdir,executable:path.join(appdir,prefix,'bin',compiler.name),compiler,toolchain,signal});
  const generated=[];
  const addGenerated=async(relative,bytes,mode=0o644)=>{await writePackageFile(appdir,relative,bytes,mode);generated.push({path:relative,sha256:hash(bytes),mode});};
  const launcher=appimageLauncher(compiler,metadata,dependencies);
  await addGenerated('AppRun',launcher,0o755);
  await addGenerated('usr/bin/'+metadata.packageName,'#!/bin/sh\nappdir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd -P) || exit 1\nexec "$appdir/AppRun" "$@"\n',0o755);
  await addGenerated(metadata.packageName+'.desktop',desktop(compiler,metadata,metadata.packageName,metadata.packageName));
  await addGenerated(metadata.packageName+'.svg',icon);
  await addGenerated('.DirIcon',icon);
  await addGenerated('usr/share/applications/'+metadata.packageName+'.desktop',desktop(compiler,metadata,metadata.packageName,metadata.packageName));
  await addGenerated('usr/share/icons/hicolor/scalable/apps/'+metadata.packageName+'.svg',icon);
  const runtimeLicense=toolchain.appimageRuntimeLicense?new TextDecoder('utf-8',{fatal:true}).decode(await readPackageFile(toolchain.appimageRuntimeLicense,4*1024*1024)):APPIMAGE_RUNTIME_LICENSE;
  await addGenerated('usr/share/vb6/'+metadata.packageName+'/appimage-runtime-license.txt',runtimeLicense+'\nPinned source: '+runtime.manifest.source+'\nRelease: '+runtime.manifest.release+'\n');
  if(dependencies.dataRelocations.length)await addGenerated('usr/share/vb6/'+metadata.packageName+'/gtk-data-relocations.txt',appImageGtkDataNotice(dependencies.dataRelocations));
  const provenance={version:1,format:'appimage',applicationSha256,executableSha256:report.executableSha256,appimageRuntime:runtime.manifest,tools:versions,
    minimumGlibc:dependencies.minimumGlibc,bundledLibraries:dependencies.libraries,externalLibraries:dependencies.externalLibraries,licenseFiles:dependencies.licenseFiles,
    dependencyFiles:dependencies.files,dataRelocations:dependencies.dataRelocations};
  await addGenerated('usr/share/vb6/'+metadata.packageName+'/distribution.json',json(provenance));
  await runPackagingTool(mksquashfs,[appdir,image,'-noappend','-all-root','-no-xattrs','-no-exports','-no-progress','-comp','gzip','-b','131072','-processors','1','-mkfs-time','0','-all-time','0','-root-mode','755'],{...settings,env:{SOURCE_DATE_EPOCH:undefined}});
  const filesystem=await readPackageFile(image),bytes=Buffer.concat([runtime.bytes,filesystem]);
  if(filesystem.length<96||filesystem.readUInt32LE(0)!==0x73717368||filesystem.readUInt16LE(28)!==4)throw new Error('mksquashfs did not produce a SquashFS 4 filesystem');
  await writePackageFile(work,'application.AppImage',bytes,0o755);
  await runPackagingTool(unsquashfs,['-no-progress','-processors','1','-offset',String(runtime.bytes.length),'-d',verified,output],settings);
  const expected=[];
  for(const [name,value]of files)expected.push({path:prefix+name.slice(compiler.name.length+1),sha256:hash(value),mode:name===compiler.name+'/bin/'+compiler.name?0o755:0o644});
  expected.push(...dependencies.files,...generated);
  for(const item of expected){
    signal?.throwIfAborted();const location=path.join(verified,...item.path.split('/')),info=await fs.lstat(location);
    if(!info.isFile()||(info.mode&0o777)!==item.mode||hash(await readPackageFile(location,128*1024*1024))!==item.sha256)throw new Error('AppImage independent extraction verification failed: '+item.path);
  }
  const architecture=compiler.architecture==='arm64'?'aarch64':'x86_64';
  const {dependencyFiles,...summary}=provenance;
  return {bytes,filename:metadata.packageName+'-'+metadata.version+'-'+architecture+'.AppImage',nativePackaging:{...summary,dependencyFileCount:dependencyFiles.length,dependencyManifest:'usr/share/vb6/'+metadata.packageName+'/distribution.json',containerVerified:true,squashfsOffset:runtime.bytes.length},signed:false,
    installation:{prefix:prefix.slice(0,-1),launcher:'AppRun',desktop:metadata.packageName+'.desktop'}};
}

/** Never invokes the exported program. Native tools inspect/build containers. */
export async function packageLinuxApplicationNative(application,options={}, {signal,toolchain={}}={}) {
  signal?.throwIfAborted();
  if(!(application?.bytes instanceof Uint8Array)||!application.options)throw new TypeError('Expected an exported Linux application');
  const metadata=linuxNativeDistributionOptions(options,application.options.name),normalized=nativeToolchain(toolchain,metadata.format,application.options.architecture);
  if(process.platform!=='linux')throw new Error('AppImage and Flatpak native packaging requires a Linux host; ZIP, tar.gz, DEB and RPM remain available on every Node host');
  const applicationBytes=application.bytes.slice(),unpacked=await unpackLinuxAOTArchive(applicationBytes,application.options),compiler=unpacked.options;
  const report=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(unpacked.files.get(compiler.name+'/Resources/vb6-build.json')));
  const applicationSha256=hash(applicationBytes);signal?.throwIfAborted();
  const tempRoot=normalized.temporaryDirectory?await fs.realpath(normalized.temporaryDirectory):os.tmpdir();
  const work=await fs.mkdtemp(path.join(tempRoot,'vb6-native-package-'));
  try {
    const context={work,files:unpacked.files,compiler,metadata,toolchain:normalized,signal,applicationSha256,report};
    const result=metadata.format==='flatpak'?await flatpakBundle(context):await appimageBundle(context);
    signal?.throwIfAborted();
    return {...result,mimeType:LINUX_NATIVE_DISTRIBUTION_FORMATS[metadata.format].mimeType,options:compiler,distribution:metadata,
      report:{...report,bytes:result.bytes.length,sha256:hash(result.bytes),applicationSha256,distribution:metadata,installation:result.installation,
        nativePackaging:result.nativePackaging,integrityVerified:true,runtimeProvenanceVerified:true,signed:result.signed}};
  }finally {await fs.rm(work,{recursive:true,force:true});}
}
