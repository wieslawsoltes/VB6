/** Independent readers and real native execution qualify AppImage and Flatpak. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {appImageIsoNamespaceCommand} from './linux-appimage-iso-namespace.mjs';
import {exportLinuxApplication} from '../packages/linux-native/dist/index.js';
import {packageLinuxApplicationNative} from '../packages/linux-native/src/node.mjs';
import {runPackagingTool} from '../packages/linux-native/src/native-distribution-tools.mjs';
import {linuxGtkProject} from '../packages/linux-native/tests/gtk-fixture.mjs';
import {nativeDistributionProject,nativeDistributionInstanceProject,nativeDistributionFontProject,nativeDistributionImageResources} from '../packages/linux-native/tests/distribution-fixture.mjs';
const root=path.resolve(import.meta.dirname,'..'),hash=bytes=>createHash('sha256').update(bytes).digest('hex');

async function instancePair(command,args,settings) {
  const children=[];
  async function start() {
    const environment={...process.env,...settings.env};
    if(settings.appImageTemporaryDirectory){
      environment.TMPDIR=path.join(settings.appImageTemporaryDirectory,'instance-'+children.length);
      await fs.mkdir(environment.TMPDIR,{mode:0o700});
    }
    const child=spawn(command,args,{cwd:settings.cwd,env:environment,stdio:['ignore','pipe','pipe'],detached:true});children.push(child);
    let stderr='';child.stderr.on('data',value=>{stderr=(stderr+value.toString()).slice(-16384);});
    const lines=createInterface({input:child.stdout});let timer;
    return new Promise((resolve,reject)=>{
      child.once('error',reject);child.once('exit',code=>reject(new Error('Packaged instance exited before startup ('+code+'): '+stderr)));
      lines.on('line',value=>{if(/^INSTANCE_(?:FIRST|PREVIOUS)$/.test(value))resolve(value);});
      timer=setTimeout(()=>reject(new Error('Packaged instance startup timed out: '+stderr)),20000);
    }).finally(()=>clearTimeout(timer));
  }
  try {assert.equal(await start(),'INSTANCE_FIRST');assert.equal(await start(),'INSTANCE_PREVIOUS');}
  finally {
    const stop=(child,signal)=>{if(!child.pid)return;try{process.kill(-child.pid,signal);}catch(error){if(error.code!=='ESRCH')throw error;}};
    for(const child of children)if(child.exitCode===null&&child.signalCode===null)stop(child,'SIGTERM');
    await Promise.all(children.map(child=>child.exitCode!==null||child.signalCode!==null?undefined:new Promise(resolve=>{
      const timer=setTimeout(()=>stop(child,'SIGKILL'),2000);child.once('exit',()=>{clearTimeout(timer);resolve();});
    })));
  }
}

export async function testLinuxNativeDistribution({architecture=process.arch,toolkit='gtk3',sysroot,reportDirectory=path.join(root,'reports/linux-native-distribution-'+toolkit+'-'+architecture),
  flatpakUserDirectory,flatpakIconSandbox=true,execute=true,gtk=true,instances=true,signing=true,format='all',isoMountNamespace='user'}={}) {
  assert.equal(process.platform,'linux');assert.ok(['x64','arm64'].includes(architecture));assert.ok(['gtk3','gtk4'].includes(toolkit));
  assert.ok(['all','appimage','flatpak'].includes(format));const formats=format==='all'?['appimage','flatpak']:[format];
  assert.ok(['user','privileged'].includes(isoMountNamespace),'ISO mount namespace must be user or privileged');
  if(execute){
    assert.equal(process.arch,architecture,'Native package execution requires matching native hardware.');
    if(formats.includes('flatpak')){
      assert.ok(flatpakUserDirectory,'Native Flatpak execution requires --flatpak-user-dir with GNOME Platform 50 already installed.');
      // D-Bus activates the nested-image-loader portal from its own environment,
      // before any per-command overrides in this process can take effect.
      assert.ok(process.env.FLATPAK_USER_DIR&&path.resolve(process.env.FLATPAK_USER_DIR)===path.resolve(flatpakUserDirectory),
        'Export the matching FLATPAK_USER_DIR before starting dbus-run-session so the Flatpak portal uses the same isolated installation.');
    }
  }
  const work=await fs.mkdtemp(path.join(os.tmpdir(),'vb6-native-distribution-test-')),checks=[];
  const report={platform:process.platform,architecture,toolkit,formats,hostArchitecture:process.arch,executionMode:execute?'native':'containers-only',
    requestedChecks:{execute,gtk,instances,signing,flatpakIconSandbox},passed:false,checks};
  // Fixture-only software rendering makes the native CI display deterministic.
  // Production wrappers retain the user's GTK/rendering/accessibility settings.
  const fixtureEnvironment=toolkit==='gtk4'?{GDK_DEBUG:'gl-disable:vulkan-disable',GSK_RENDERER:'cairo',GTK_A11Y:'test'}:{};
  // GNOME Platform 50 has GTK4.22, where GPU feature switches moved from
  // GDK_DEBUG to GDK_DISABLE. The AppImage carries Ubuntu's GTK4.14 instead.
  const flatpakFixtureEnvironment=toolkit==='gtk4'?{...fixtureEnvironment,GDK_DEBUG:'',GDK_DISABLE:'gl,vulkan'}:{};
  const environment={LC_ALL:'C',...fixtureEnvironment,...(flatpakUserDirectory?{FLATPAK_USER_DIR:path.resolve(flatpakUserDirectory)}:{})};
  // The upstream extract-and-run mode caches extracted images. Keep only our
  // AppImage children inside a private temporary root so final fixture cleanup
  // also removes those caches; do not leak a host-only TMPDIR into Flatpak.
  const runtimeTemporary=path.join(work,'runtime-temporary'),appImageEnvironment={...environment,TMPDIR:runtimeTemporary};
  const flatpakRun=appId=>['--user','run','--cwd=/var/data',...Object.entries(flatpakFixtureEnvironment).map(([key,value])=>'--env='+key+'='+value),appId];
  const run=(command,args,options={})=>runPackagingTool(command,args,{cwd:work,env:environment,timeout:120000,...options});
  const runAppImage=file=>run(file,['--appimage-extract-and-run'],{env:appImageEnvironment});
  const packageOptions={packageName:'vb6-native-'+toolkit+'-'+architecture,version:'2.3.4',license:'MIT',maintainer:'Native packaging qualification'};
  const identity=name=>'org.vb6studio.'+name+'_'+toolkit+'_'+architecture+'_'+hash(work).slice(0,10);
  const toolchain=format=>format==='appimage'?{...(sysroot?{sysroot}:{})}:{flatpakIconSandbox};
  const write=async result=>{const file=path.join(work,result.filename);await fs.writeFile(file,result.bytes,{mode:result.distribution.format==='appimage'?0o755:0o644});return file;};
  const installedApps=[];
  const install=async(file,appId)=>{
    installedApps.push(appId);await run('flatpak',['--user','install','--noninteractive','--assumeyes','--no-deps',file]);
    return run('flatpak',flatpakRun(appId));
  };
  try {
    await fs.mkdir(reportDirectory,{recursive:true});await fs.mkdir(runtimeTemporary,{mode:0o700});
    const application=await exportLinuxApplication(nativeDistributionProject,{architecture,toolkit},{resources:{'Resources/data.txt':'NATIVE_PACKAGE_RESOURCE_OK\n'}});
    for(const format of formats){
      const appId=identity('NativeQualification');
      const result=await packageLinuxApplicationNative(application,{...packageOptions,format,...(format==='flatpak'?{appId}:{})},{toolchain:toolchain(format)}),file=await write(result);
      const directory=path.join(work,'independent-'+format);let executable;
      if(format==='appimage'){
        await run('unsquashfs',['-no-progress','-processors','1','-offset',String(result.report.nativePackaging.squashfsOffset),'-d',directory,file]);
        executable=path.join(directory,'usr/lib',packageOptions.packageName,'bin',application.options.name);
        const embedded=JSON.parse(await fs.readFile(path.join(directory,'usr/share/vb6',packageOptions.packageName,'distribution.json'),'utf8'));
        assert.equal(embedded.applicationSha256,application.report.sha256);
        assert.ok(embedded.bundledLibraries.some(entry=>entry.path==='usr/lib/'+(toolkit==='gtk4'?'libgtk-4.so.1':'libgtk-3.so.0')));
        for(const entry of embedded.dependencyFiles)assert.equal(hash(await fs.readFile(path.join(directory,entry.path))),entry.sha256,entry.path);
        assert.ok(embedded.licenseFiles>0);assert.ok(embedded.externalLibraries.includes('libc.so.6'));
        if(toolkit==='gtk4'){
          assert.equal(embedded.dataRelocations.length,1);const relocation=embedded.dataRelocations[0];
          const modified=await fs.readFile(path.join(directory,relocation.path));assert.equal(hash(modified),relocation.sha256);
          Buffer.from(relocation.original,'hex').copy(modified,relocation.offset);assert.equal(hash(modified),relocation.originalSha256);
        }
        await run('desktop-file-validate',[path.join(directory,packageOptions.packageName+'.desktop')]);
        if(execute)assert.match((await runAppImage(file)).stdout,/LINUX_NATIVE_DISTRIBUTION_OK/);
        const damaged=Buffer.from(result.bytes);damaged[result.report.nativePackaging.squashfsOffset]^=1;
        const bad=path.join(work,'damaged.AppImage');await fs.writeFile(bad,damaged);
        await assert.rejects(run('unsquashfs',['-stat','-offset',String(result.report.nativePackaging.squashfsOffset),bad]));
      }else {
        const repo=path.join(work,'independent-flatpak-repo');await run('ostree',['--repo='+repo,'init','--mode=archive-z2']);
        await run('flatpak',['build-import-bundle',repo,file]);
        assert.equal((await run('ostree',['--repo='+repo,'rev-parse',result.report.nativePackaging.ref])).stdout.trim(),result.report.nativePackaging.commit);
        await run('ostree',['--repo='+repo,'fsck']);await run('ostree',['--repo='+repo,'checkout','--user-mode',result.report.nativePackaging.commit,directory]);
        executable=path.join(directory,'files/lib',packageOptions.packageName,'bin',application.options.name);
        const metadata=await fs.readFile(path.join(directory,'metadata'),'utf8');
        assert.ok(metadata.includes('runtime=org.gnome.Platform/'+(architecture==='arm64'?'aarch64':'x86_64')+'/50'));
        assert.ok(!metadata.includes('filesystems=home')&&!metadata.includes('shared=network'));
        await run('desktop-file-validate',[path.join(directory,'files/share/applications',appId+'.desktop')]);
        if(execute)assert.match((await install(file,appId)).stdout,/LINUX_NATIVE_DISTRIBUTION_OK/);
        const damaged=Buffer.from(result.bytes);damaged[Math.floor(damaged.length/2)]^=0x80;
        const bad=path.join(work,'damaged.flatpak'),badRepo=path.join(work,'damaged-flatpak-repo');await fs.writeFile(bad,damaged);await run('ostree',['--repo='+badRepo,'init','--mode=archive-z2']);
        await assert.rejects(run('flatpak',['build-import-bundle',badRepo,bad]));
      }
      assert.deepEqual(new Uint8Array(await fs.readFile(executable)),application.executable);assert.equal((await fs.stat(executable)).mode&0o777,0o755);
      checks.push({format,bytes:result.bytes.length,sha256:result.report.sha256,executableSha256:application.report.executableSha256,independentReader:true,resourceExecution:execute,corruptionRejected:true});
      console.log('PASS '+architecture+' '+toolkit+' '+format+': independent container, original ELF/resources, permissions and corruption checks'+(execute?', native execution':''));
    }
    if(execute&&gtk){
      const project=linuxGtkProject();
      project.modules[0].code=project.modules[0].code.replace('    Debug.Print "LINUX_GTK_GRAPHICS_OK"',`    Set Picture1.Picture = LoadPicture(App.Path & "/../Resources/package-image.png")
    Debug.Assert Picture1.Picture.Width > 0
    Set Image1.Picture = LoadPicture(App.Path & "/../Resources/package-image.ico")
    Debug.Assert Image1.Picture.Width > 0
    Debug.Print "LINUX_GTK_PACKAGED_IMAGES_OK"
    Debug.Print "LINUX_GTK_GRAPHICS_OK"`);
      const gui=await exportLinuxApplication(project,{architecture,toolkit},{resources:nativeDistributionImageResources()});
      for(const format of formats){
        const appId=identity('GtkQualification');
        const result=await packageLinuxApplicationNative(gui,{...packageOptions,packageName:packageOptions.packageName+'-gtk',format,...(format==='flatpak'?{appId}:{})},{toolchain:toolchain(format)}),file=await write(result);
        const execution=format==='appimage'?await runAppImage(file):await install(file,appId);
        assert.match(execution.stdout,/LINUX_GTK_CONTROLS_OK/);assert.match(execution.stdout,/LINUX_GTK_GRAPHICS_OK/);assert.match(execution.stdout,/LINUX_GTK_PACKAGED_IMAGES_OK/);
        checks.push({format,nativeGtkControls:true,packagedPngAndIco:true,toolkit});console.log('PASS '+architecture+' '+toolkit+' '+format+': native controls, clipboard, graphics, image loaders, file I/O and timers');
      }
      const font=await exportLinuxApplication(nativeDistributionFontProject(),{architecture,toolkit});
      for(const format of formats){
        const appId=identity('FontQualification');
        const result=await packageLinuxApplicationNative(font,{...packageOptions,packageName:packageOptions.packageName+'-font',format,...(format==='flatpak'?{appId}:{})},{toolchain:toolchain(format)}),file=await write(result);
        let execution;
        if(format==='appimage'&&toolkit==='gtk4'){
          const empty=path.join(work,'empty-host-iso');await fs.mkdir(empty);
          // This fixture masks host data only inside its own mount namespace.
          // No host files or production launcher settings are modified.
          const isolation=appImageIsoNamespaceCommand({emptyDirectory:empty,filename:file,environment:{...process.env,...appImageEnvironment},mode:isoMountNamespace});
          execution=await run(isolation.command,isolation.args,{env:appImageEnvironment});
        }else execution=format==='appimage'?await runAppImage(file):await install(file,appId);
        assert.match(execution.stdout,/LINUX_GTK_FONT_CHOOSER_OK/);
        assert.doesNotMatch(execution.stderr,/(?:Failed to load|failed to load|Failed to open|failed to open).*iso_639|GLib-(?:GObject-)?(?:CRITICAL|ERROR)|Gtk-(?:CRITICAL|ERROR)/);
        checks.push({format,nativeFontChooser:true,hostIsoDataMasked:format==='appimage'&&toolkit==='gtk4',
          ...(format==='appimage'&&toolkit==='gtk4'?{isoMountNamespace,...(isoMountNamespace==='privileged'?{applicationUid:process.getuid(),applicationGid:process.getgid()}:{})}:{})});
        console.log('PASS '+architecture+' '+toolkit+' '+format+': native FontChooser'+(format==='appimage'&&toolkit==='gtk4'?' with host ISO language files absent':''));
      }
    }
    if(execute&&instances){
      const app=await exportLinuxApplication(nativeDistributionInstanceProject,{architecture,toolkit});
      for(const format of formats){
        const appId=identity('InstanceQualification');
        const result=await packageLinuxApplicationNative(app,{...packageOptions,packageName:packageOptions.packageName+'-instance',format,...(format==='flatpak'?{appId}:{})},{toolchain:toolchain(format)}),file=await write(result);
        if(format==='appimage')await instancePair(file,['--appimage-extract-and-run'],{cwd:work,env:appImageEnvironment,appImageTemporaryDirectory:runtimeTemporary});
        else {installedApps.push(appId);await run('flatpak',['--user','install','--noninteractive','--assumeyes','--no-deps',file]);await instancePair('flatpak',flatpakRun(appId),{cwd:work,env:environment});}
        checks.push({format,previousInstanceAcrossIndependentLaunches:true,isolatedExtractionDirectories:format==='appimage'});console.log('PASS '+architecture+' '+toolkit+' '+format+': stable packaged App.PrevInstance identity');
      }
    }
    // Exercise maximum accepted IDs with real filesystem/OSTree readers.
    if(formats.includes('flatpak')){
      const longId='org.example.'+'A'.repeat(230);
      const longBundle=await packageLinuxApplicationNative(application,{...packageOptions,format:'flatpak',appId:longId},{toolchain:toolchain('flatpak')});
      assert.ok(Buffer.byteLength(longBundle.filename)<=255);assert.ok(longBundle.report.nativePackaging.ref.includes('/'+longId+'/'));
      checks.push({format:'flatpak',maximumIdentityLengthVerified:true});
    }
    if(signing&&formats.includes('flatpak')){
      const keyring=path.join(work,'signing-keys'),publicKey=path.join(work,'signing-public.asc');await fs.mkdir(keyring,{mode:0o700});
      try{
        await run('gpg',['--homedir',keyring,'--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key','VB6 native packaging test <fixture@example.invalid>','ed25519','sign','0']);
        const listing=(await run('gpg',['--homedir',keyring,'--batch','--with-colons','--list-secret-keys'])).stdout;
        const fingerprint=listing.split('\n').find(line=>line.startsWith('fpr:'))?.split(':')[9];assert.match(fingerprint,/^[0-9A-F]{40,64}$/);
        const exported=(await run('gpg',['--homedir',keyring,'--batch','--armor','--export',fingerprint])).stdout;await fs.writeFile(publicKey,exported);
        const unsignedRepo=path.join(work,'independent-flatpak-repo');
        const unsignedVerification=path.join(work,'unsigned-verification');await run('ostree',['--repo='+unsignedVerification,'init','--mode=archive-z2']);
        await run('ostree',['--repo='+unsignedVerification,'remote','add','--gpg-import='+publicKey,'publisher','file://'+unsignedRepo]);
        const unsignedRef=(await run('ostree',['--repo='+unsignedRepo,'refs'])).stdout.trim().split('\n')[0];
        await assert.rejects(run('ostree',['--repo='+unsignedVerification,'pull-local','--untrusted','--gpg-verify','--remote=publisher','--commit-metadata-only',unsignedRepo,unsignedRef]),/signature|Signature|GPG|gpg/);
        const result=await packageLinuxApplicationNative(application,{...packageOptions,format:'flatpak',appId:identity('SignedQualification')},
          {toolchain:{...toolchain('flatpak'),gpgHome:keyring,gpgKeyId:fingerprint,gpgPublicKey:publicKey}});
        assert.equal(result.report.signed,true);assert.equal(result.report.nativePackaging.containerVerified,true);assert.equal(result.report.nativePackaging.signatureVerification,'ostree-pull-local-gpg-verify');
        await run('gpg',['--homedir',keyring,'--batch','--pinentry-mode','loopback','--passphrase','','--quick-generate-key','Wrong packaging test key <other@example.invalid>','ed25519','sign','0']);
        const keys=(await run('gpg',['--homedir',keyring,'--batch','--with-colons','--list-secret-keys'])).stdout;
        const other=keys.split('\n').filter(line=>line.startsWith('fpr:')).map(line=>line.split(':')[9]).find(value=>value!==fingerprint);assert.match(other,/^[0-9A-F]{40,64}$/);
        const wrongPublicKey=path.join(work,'wrong-signing-public.asc');await fs.writeFile(wrongPublicKey,(await run('gpg',['--homedir',keyring,'--batch','--armor','--export',other])).stdout);
        await assert.rejects(packageLinuxApplicationNative(application,{...packageOptions,format:'flatpak',appId:identity('WrongKeyQualification')},
          {toolchain:{...toolchain('flatpak'),gpgHome:keyring,gpgKeyId:fingerprint,gpgPublicKey:wrongPublicKey}}),/signature|Signature|GPG|gpg/);
        checks.push({format:'flatpak',publisherSignatureVerified:true,unsignedCommitRejected:true,wrongPublisherKeyRejected:true,fingerprint});console.log('PASS '+architecture+' '+toolkit+' Flatpak: verified signature, unsigned-commit and wrong-key rejection');
      }finally {await run('gpgconf',['--homedir',keyring,'--kill','gpg-agent']);}
    }
    report.passed=true;return report;
  }catch(error){report.error={message:error.message,stack:error.stack};throw error;}
  finally {
    for(const appId of installedApps){try{await run('flatpak',['--user','uninstall','--noninteractive','--assumeyes','--delete-data',appId]);}catch{/* Preserve the assertion; all identities belong to this isolated fixture run. */}}
    await fs.mkdir(reportDirectory,{recursive:true});await fs.writeFile(path.join(reportDirectory,'validation.json'),JSON.stringify(report,null,2)+'\n');
    await fs.rm(work,{recursive:true,force:true});
  }
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const options={};for(let index=2;index<process.argv.length;index+=2){
    const flag=process.argv[index],value=process.argv[index+1];
    const fields={'--architecture':'architecture','--toolkit':'toolkit','--format':'format','--sysroot':'sysroot','--report':'reportDirectory','--flatpak-user-dir':'flatpakUserDirectory','--iso-mount-namespace':'isoMountNamespace',
      '--flatpak-icon-sandbox':'flatpakIconSandbox','--execute':'execute','--gtk':'gtk','--instances':'instances','--signing':'signing'};
    if(!Object.hasOwn(fields,flag)||value===undefined)throw new Error('Unknown or missing native distribution qualification option: '+flag);
    if(['--flatpak-icon-sandbox','--execute','--gtk','--instances','--signing'].includes(flag)){
      if(!['on','off'].includes(value))throw new Error(flag+' must be on or off');options[fields[flag]]=value==='on';
    }else options[fields[flag]]=value;
  }
  await testLinuxNativeDistribution(options);
}
