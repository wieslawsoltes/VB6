#!/usr/bin/env node
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {readLinuxProject,exportLinuxProject,exportLinuxExecutable} from '../src/node.mjs';
export async function main(arguments_=process.argv.slice(2)) {
  const args=[...arguments_];
  if(!args.length||args.includes('--help')) {
    console.log('vb6-linux PROJECT.vb6web|PROJECT.vbp|FOLDER --out DIRECTORY [--architecture x64|arm64] [--toolkit gtk3|gtk4] [--format zip|tar.gz|deb|rpm|appimage|flatpak] [--extract] [--optimization 0..3] [--name NAME]');
    console.log('Package metadata: --package-name ID --version VERSION --release NUMBER --maintainer PUBLISHER --summary TEXT --description TEXT --license ID --homepage URL --categories Utility,Office');
    console.log('Default: offline Linux x86_64 ELF application ZIP export from any Node-supported host. --architecture arm64 selects native AArch64. --extract writes bin/NAME and Resources. ZIP/tar.gz/DEB/RPM require no native tools. AppImage requires Linux with squashfs-tools/readelf and bundles target system libraries; use --sysroot PATH for cross packaging. Flatpak requires Linux with flatpak/ostree and creates a real single-file bundle for GNOME Platform 50. Packaging never downloads runtimes or executes the exported application. Existing output is never overwritten.');
    console.log('Flatpak: --app-id REVERSE.DNS.ID --runtime-version 50 --runtime-repository HTTPS_URL --branch stable --flatpak-permissions share=ipc,socket=wayland,socket=fallback-x11,socket=cups,device=dri');
    console.log('Native tools: --sysroot PATH --mksquashfs PATH --unsquashfs PATH --readelf PATH --appimage-runtime PATH --appimage-runtime-sha256 HEX --appimage-runtime-license FILE --flatpak PATH --ostree PATH --temporary-directory PATH');
    console.log('Use --flatpak-permissions none for an empty permission set. --app-id is limited to 242 ASCII characters so desktop/icon/metainfo filenames fit.');
    console.log('Build containers only: --flatpak-icon-sandbox off validates the fixed generated icon without a helper namespace; the application sandbox is unchanged. Default: on.');
    console.log('Flatpak signing with an existing key: --gpg-key-id FULL_FINGERPRINT --gpg-home PATH --gpg-public-key FILE');
    return;
  }
  const input=args.shift(),options={compiler:{},distribution:{},toolchain:{}},seen=new Set();let extract=false;
  const packageFields={'--format':'format','--package-name':'packageName','--version':'version','--release':'release','--maintainer':'maintainer','--summary':'summary','--description':'description','--license':'license','--homepage':'homepage','--categories':'categories',
    '--app-id':'appId','--runtime-version':'runtimeVersion','--runtime-repository':'runtimeRepository','--branch':'branch','--flatpak-permissions':'flatpakPermissions'};
  const nativeFields={'--sysroot':'sysroot','--mksquashfs':'mksquashfs','--unsquashfs':'unsquashfs','--readelf':'readelf','--appimage-runtime':'appimageRuntime','--appimage-runtime-sha256':'appimageRuntimeSha256','--appimage-runtime-license':'appimageRuntimeLicense',
    '--flatpak':'flatpak','--ostree':'ostree','--temporary-directory':'temporaryDirectory','--gpg-key-id':'gpgKeyId','--gpg-home':'gpgHome','--gpg-public-key':'gpgPublicKey','--flatpak-icon-sandbox':'flatpakIconSandbox'};
  for(let index=0;index<args.length;++index) {
    const argument=args[index];if(seen.has(argument))throw new Error('Duplicate argument: '+argument);seen.add(argument);
    if(argument==='--extract'){extract=true;continue;}
    if(!['--out','--optimization','--name','--architecture','--toolkit',...Object.keys(packageFields),...Object.keys(nativeFields)].includes(argument)||!args[index+1])throw new Error('Unknown or missing argument: '+argument);
    const value=args[++index];
    if(argument==='--out')options.out=value;
    else if(argument==='--name')options.compiler.name=value;
    else if(argument==='--architecture'){if(!['x64','arm64'].includes(value))throw new Error('--architecture must be x64 or arm64.');options.compiler.architecture=value;}
    else if(argument==='--toolkit'){if(!['gtk3','gtk4'].includes(value))throw new Error('--toolkit must be gtk3 or gtk4.');options.compiler.toolkit=value;}
    else if(argument==='--flatpak-icon-sandbox'){if(!['on','off'].includes(value))throw new Error('--flatpak-icon-sandbox must be on or off.');options.toolchain.flatpakIconSandbox=value==='on';}
    else if(Object.hasOwn(nativeFields,argument))options.toolchain[nativeFields[argument]]=value;
    else if(Object.hasOwn(packageFields,argument))options.distribution[packageFields[argument]]=argument==='--flatpak-permissions'&&value==='none'?[]:['--categories','--flatpak-permissions'].includes(argument)?value.split(','):value;
    else {if(!/^[0-3]$/.test(value))throw new Error('--optimization must be 0, 1, 2 or 3.');options.compiler.optimization=Number(value);}
  }
  if(!options.out)throw new Error('--out DIRECTORY is required.');
  if(extract&&(Object.keys(options.distribution).length||Object.keys(options.toolchain).length))throw new Error('--extract cannot be combined with package format, metadata, or native toolchain options.');
  const project=await readLinuxProject(input);
  console.log(JSON.stringify(await (extract?exportLinuxExecutable:exportLinuxProject)(project,options),null,2));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  try {await main();}catch(error){console.error(error.message);if(error.diagnostics)console.error(JSON.stringify(error.diagnostics,null,2));process.exitCode=1;}
}
