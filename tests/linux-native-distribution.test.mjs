import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {loadAppImageRuntime,inspectAppImageRuntime} from '../packages/linux-native/src/appimage-runtime.mjs';
import {LINUX_NATIVE_DISTRIBUTION_FORMATS,LINUX_FLATPAK_DEFAULT_PERMISSIONS} from '../packages/linux-native/src/distribution-targets.js';
import {runPackagingTool,sysrootPath,readPackageFile,writePackageFile} from '../packages/linux-native/src/native-distribution-tools.mjs';
import {linuxNativeDistributionOptions,packageLinuxApplicationNative} from '../packages/linux-native/src/native-distribution.mjs';
import {bundleAppImageDependencies} from '../packages/linux-native/src/appimage-dependencies.mjs';
import {exportLinuxApplication} from '../packages/linux-native/dist/index.js';
import {exportLinuxProject} from '../packages/linux-native/src/node.mjs';
const project={schema:1,name:'Native Distribution',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:'Public Sub Main()\nDebug.Print "LINUX_NATIVE_DISTRIBUTION_OK"\nEnd Sub'}]};

test('native distribution capabilities identify the Linux tool authority and both architectures',()=>{
  assert.deepEqual(Object.keys(LINUX_NATIVE_DISTRIBUTION_FORMATS),['appimage','flatpak']);
  for(const format of Object.values(LINUX_NATIVE_DISTRIBUTION_FORMATS)){
    assert.equal(format.authority,'node-native');assert.equal(format.platform,'linux');assert.deepEqual(format.architectures,['x64','arm64']);
    assert.ok(Object.isFrozen(format));assert.ok(Object.isFrozen(format.tools));
  }
});
test('Flatpak defaults are bounded, versioned and avoid broad host access',()=>{
  const options=linuxNativeDistributionOptions({format:'flatpak'},'Zażółć Native App');
  assert.equal(options.runtime,'org.gnome.Platform');assert.equal(options.runtimeVersion,'50');
  assert.match(options.appId,/^org\.vb6studio\./);assert.equal(options.branch,'stable');
  assert.deepEqual(options.flatpakPermissions,LINUX_FLATPAK_DEFAULT_PERMISSIONS);
  assert.ok(!options.flatpakPermissions.some(value=>value.includes('filesystem=')||value==='share=network'));
  assert.ok(Object.isFrozen(options.flatpakPermissions));
  assert.deepEqual(linuxNativeDistributionOptions({format:'flatpak',appId:'org.example.Test',flatpakPermissions:[]}).flatpakPermissions,[]);
});
test('native Flatpak qualification rejects a different outer portal installation before packaging',async t=>{
  if(process.platform!=='linux'){t.skip('Native Linux qualification environment');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-flatpak-portal-env-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const qualifier=path.resolve(import.meta.dirname,'../tools/test-linux-native-distribution.mjs');
  for(const userDirectory of [undefined,path.join(directory,'different')]){
    await assert.rejects(runPackagingTool(process.execPath,[qualifier,'--format','flatpak','--flatpak-user-dir',path.join(directory,'selected'),'--report',path.join(directory,'report')],
      {env:{NODE_TEST_CONTEXT:undefined,FLATPAK_USER_DIR:userDirectory}}),/Export the matching FLATPAK_USER_DIR before starting dbus-run-session/);
  }
  assert.deepEqual(await fs.readdir(directory),[],'Preflight creates no packages, installs or reports');
});
test('native package options reject identity, INI, shell and permission injection',()=>{
  for(const options of [{format:'zip'},{format:'flatpak',appId:'org.example.Bad;exec'}, {format:'flatpak',appId:'org..bad'},
    {format:'flatpak',runtime:'org.freedesktop.Platform'},{format:'flatpak',runtimeVersion:'49'},{format:'flatpak',runtimeVersion:'50beta'},
    {format:'flatpak',runtimeVersion:'50\ncommand=evil'},{format:'flatpak',runtimeRepository:'http://example.invalid/repo'},
    {format:'flatpak',runtimeRepository:'https://user:secret@example.invalid/repo'},{format:'flatpak',runtimeRepository:'https://example.invalid/repo#fragment'},
    {format:'flatpak',branch:'../stable'},{format:'flatpak',flatpakPermissions:['filesystem=host']},
    {format:'flatpak',flatpakPermissions:['share=network','share=network']},{format:'flatpak',flatpakPermissions:['socket=x11','socket=fallback-x11']},
    {format:'appimage',appId:'org.example.Test'},{format:'appimage',unexpected:true}])assert.throws(()=>linuxNativeDistributionOptions(options),JSON.stringify(options));
});
test('Flatpak identity fits all exported filesystem component limits',()=>{
  const id='org.example.'+'A'.repeat(230);assert.equal(id.length,242);
  assert.equal(linuxNativeDistributionOptions({format:'flatpak',appId:id}).appId,id);
  assert.throws(()=>linuxNativeDistributionOptions({format:'flatpak',appId:id+'A'}),/242 characters/);
});
for(const architecture of ['x64','arm64'])test('pinned '+architecture+' AppImage runtime has a verified static type-2 ELF header',async()=>{
  const runtime=await loadAppImageRuntime(architecture),layout=inspectAppImageRuntime(runtime.bytes,architecture);
  assert.equal(layout.sha256,createHash('sha256').update(runtime.bytes).digest('hex'));
  assert.equal(layout.bytes,runtime.bytes.length);assert.equal(layout.type,2);assert.equal(layout.staticallyLinked,true);
  assert.equal(runtime.manifest.release,'20251108');assert.match(runtime.manifest.source,/dd6cebedcbddde9c82f89b011e8e1d40b6e43868$/);
  assert.throws(()=>inspectAppImageRuntime(runtime.bytes,architecture==='x64'?'arm64':'x64'),/architecture/);
  assert.throws(()=>inspectAppImageRuntime(Buffer.concat([runtime.bytes,Buffer.alloc(4)]),architecture),/offset/);
  const bytes=Buffer.from(runtime.bytes);bytes[8]=0;assert.throws(()=>inspectAppImageRuntime(bytes,architecture),/type-2/);
});
test('custom AppImage runtimes require a matching digest and reject links',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-appimage-header-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const runtime=await loadAppImageRuntime('x64'),filename=path.join(directory,'runtime');await fs.writeFile(filename,runtime.bytes);
  await assert.rejects(loadAppImageRuntime('x64',{runtimePath:filename}),/requires appimageRuntimeSha256/);
  await assert.rejects(loadAppImageRuntime('x64',{runtimePath:filename,runtimeSha256:'0'.repeat(64)}),/SHA256/);
  assert.equal((await loadAppImageRuntime('x64',{runtimePath:filename,runtimeSha256:runtime.manifest.sha256})).manifest.release,'custom');
  if(process.platform!=='win32'){
    const linked=path.join(directory,'linked');await fs.symlink(filename,linked);
    await assert.rejects(loadAppImageRuntime('x64',{runtimePath:linked,runtimeSha256:runtime.manifest.sha256}),error=>error.code==='ELOOP');
  }
});
test('target sysroot links resolve inside the target root and reject escapes',async t=>{
  if(process.platform==='win32'){t.skip('POSIX symbolic-link semantics');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-sysroot-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await fs.mkdir(path.join(directory,'usr/lib'),{recursive:true});await fs.writeFile(path.join(directory,'usr/lib/test.so'),'target');
  await fs.symlink('/usr/lib',path.join(directory,'lib'));
  assert.equal(await sysrootPath(directory,'lib/test.so'),path.join(directory,'usr/lib/test.so'));
  await fs.symlink('../../outside',path.join(directory,'escape'));
  await assert.rejects(sysrootPath(directory,'escape'),/escapes/);
  await fs.symlink('loop',path.join(directory,'loop'));
  await assert.rejects(sysrootPath(directory,'loop'),/Too many/);
});
test('native packaging uses literal tool arguments and bounds subprocess output',async()=>{
  const literal='literal $(touch should-not-exist); `uname`\nargument';
  const windows=process.platform==='win32';
  const result=await runPackagingTool(windows?process.execPath:'/usr/bin/printf',windows?['-e','process.stdout.write(process.argv[1])',literal]:['%s',literal]);
  assert.equal(result.stdout,literal);
  await assert.rejects(runPackagingTool(windows?process.execPath:'/usr/bin/printf',windows?['-e','process.stdout.write("x".repeat(8192))']:['%8192s',''],{maxOutput:128}),/output exceeded/);
  const controller=new AbortController();const pending=runPackagingTool(windows?process.execPath:'/bin/sleep',windows?['-e','setInterval(()=>{},1000)']:['30'],{signal:controller.signal});controller.abort();
  await assert.rejects(pending,{name:'AbortError'});
  await assert.rejects(runPackagingTool('vb6-required-packager-that-is-not-installed',[]),/Required native packaging tool/);
});
// Opening a shell redirection creates the marker before printf writes its PID.
// Wait for the newline-terminated record, not merely for the file to exist.
// The original 200 x 10 ms readiness bound and cancellation assertions remain.
async function waitForFixturePid(file,{readFile=fs.readFile,pause=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}) {
  for(let attempt=0;attempt<200;attempt++){
    try {
      const record=await readFile(file,'utf8');
      if(/^[1-9][0-9]*\n$/.test(record)){
        const pid=Number(record);
        if(Number.isSafeInteger(pid))return pid;
      }
    }catch(error){if(error.code!=='ENOENT')throw error;}
    await pause(10);
  }
  return undefined;
}
test('native packaging fixture readiness waits through missing, empty and partial PID records',async()=>{
  const records=[Object.assign(new Error('Not published'),{code:'ENOENT'}),'','4','417','417\n'];let reads=0;const pauses=[];
  const pid=await waitForFixturePid('fixture.pid',{
    readFile:async(file,encoding)=>{assert.equal(file,'fixture.pid');assert.equal(encoding,'utf8');const value=records[reads++];if(value instanceof Error)throw value;return value;},
    pause:async ms=>{pauses.push(ms);}
  });
  assert.equal(pid,417);assert.equal(reads,5);assert.deepEqual(pauses,[10,10,10,10]);
});
test('native packaging fixture readiness remains bounded for malformed or incomplete PID records',async()=>{
  const records=['','417','0\n','-1\n','1.5\n','Infinity\n','9007199254740992\n','12\n13\n'];let reads=0,pauses=0;
  const pid=await waitForFixturePid('fixture.pid',{
    readFile:async()=>records[reads++%records.length],
    pause:async ms=>{assert.equal(ms,10);pauses++;}
  });
  assert.equal(pid,undefined);assert.equal(reads,200);assert.equal(pauses,200);
});
test('native packaging fixture readiness does not conceal filesystem failures',async()=>{
  const failure=Object.assign(new Error('Permission denied'),{code:'EACCES'});
  await assert.rejects(waitForFixturePid('fixture.pid',{
    readFile:async()=>{throw failure;},pause:async()=>{assert.fail('No retry for a filesystem failure');}
  }),error=>error===failure);
});
test('native packaging cancellation terminates owned descendants that ignore SIGTERM',async t=>{
  if(process.platform!=='linux'){t.skip('Linux process-group and /proc semantics');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-package-cancellation-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const pidFile=path.join(directory,'descendant.pid'),controller=new AbortController();
  const pending=runPackagingTool('/bin/sh',['-c','trap "" TERM; /bin/sleep 30 & child=$!; printf "%s\\n" "$child" > "$1"; wait','vb6-cancellation-fixture',pidFile],{signal:controller.signal,timeout:10000});
  const rejected=assert.rejects(pending,{name:'AbortError'});let child,problem;
  try {
    child=await waitForFixturePid(pidFile);
    assert.ok(Number.isInteger(child)&&child>0,'Owned descendant started');
  }catch(error){problem=error;}
  finally {controller.abort();await rejected;}
  if(problem)throw problem;
  try {assert.match(await fs.readFile('/proc/'+child+'/status','utf8'),/^State:\s+Z\b/m,'Cancelled descendant is not running');}
  // Reaping can remove the entry before open (ENOENT) or during read (ESRCH).
  catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}
});
test('native packaging cancellation also terminates descendants after the leader closes its pipes',async t=>{
  if(process.platform!=='linux'){t.skip('Linux process-group and /proc semantics');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-package-orphan-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const pidFile=path.join(directory,'descendant.pid'),controller=new AbortController();
  const pending=runPackagingTool('/bin/sh',['-c',
    '/bin/sh -c \'trap "" TERM; printf "%s\\n" "$$" > "$1"; while :; do /bin/sleep 30; done\' vb6-orphan-fixture "$1" >/dev/null 2>&1 & wait',
    'vb6-parent-fixture',pidFile],{signal:controller.signal,timeout:10000});
  const rejected=assert.rejects(pending,{name:'AbortError'});let child,problem;
  try {
    child=await waitForFixturePid(pidFile);
    assert.ok(Number.isInteger(child)&&child>0,'Redirected descendant started');
  }catch(error){problem=error;}
  finally {controller.abort();await rejected;}
  if(problem)throw problem;
  try {assert.match(await fs.readFile('/proc/'+child+'/status','utf8'),/^State:\s+Z\b/m,'Redirected descendant is not running after cancellation settles');}
  // Reaping can remove the entry before open (ENOENT) or during read (ESRCH).
  catch(error){if(error.code!=='ENOENT'&&error.code!=='ESRCH')throw error;}
});
test('native package writers reject path traversal and preserve reserved outputs',async t=>{
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-native-writer-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  await assert.rejects(writePackageFile(directory,'../escape','bad'),/Invalid native package path/);
  await writePackageFile(directory,'files/app','first');await assert.rejects(writePackageFile(directory,'files/app','second'),error=>error.code==='EEXIST');
  assert.equal((await readPackageFile(path.join(directory,'files/app'))).toString(),'first');
  await assert.rejects(readPackageFile(path.join(directory,'files/app'),2),/bounded regular/);
  if(process.platform!=='win32'){
    const outside=path.join(directory,'outside');await fs.mkdir(outside);await fs.symlink(outside,path.join(directory,'linked'));
    await assert.rejects(writePackageFile(directory,'linked/escape','bad'),/must not be a link/);
    await assert.rejects(fs.stat(path.join(outside,'escape')),error=>error.code==='ENOENT');
  }
});
test('native package staging preserves exact modes under a restrictive user umask',async t=>{
  if(process.platform==='win32'){t.skip('POSIX file permission semantics');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-package-umask-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const helper=new URL('../packages/linux-native/src/native-distribution-tools.mjs',import.meta.url).href;
  const script=path.join(directory,'fixture.mjs');
  await fs.writeFile(script,'import {writePackageFile} from '+JSON.stringify(helper)+';\nprocess.umask(0o077);\nawait writePackageFile(process.argv[2],"usr/bin/application","executable",0o755);\nawait writePackageFile(process.argv[2],"usr/share/data.txt","resource",0o644);\n');
  // A child fixture changes only its own umask. Node's test-runner context is
  // cleared only for this ordinary Node subprocess, not in production globals.
  await runPackagingTool(process.execPath,[script,directory],{env:{NODE_TEST_CONTEXT:undefined}});
  for(const name of ['usr','usr/bin','usr/share','usr/bin/application'])assert.equal((await fs.stat(path.join(directory,name))).mode&0o777,0o755,name);
  assert.equal((await fs.stat(path.join(directory,'usr/share/data.txt'))).mode&0o777,0o644);
});
test('native package validation rejects damage and cancellation before invoking tools',async()=>{
  const app=await exportLinuxApplication(project),bad=app.bytes.slice();bad[0]^=1;
  await assert.rejects(packageLinuxApplicationNative({...app,bytes:bad},{format:'flatpak'},{toolchain:{flatpak:'never-execute-me'}}));
  await assert.rejects(packageLinuxApplicationNative(app,{format:'flatpak'},{signal:AbortSignal.abort()}),{name:'AbortError'});
  await assert.rejects(packageLinuxApplicationNative(app,{format:'flatpak'},{toolchain:{command:'bad'}}),/Unsupported flatpak toolchain/);
  await assert.rejects(packageLinuxApplicationNative(app,{format:'flatpak'},{toolchain:{gpgKeyId:'short'}}),/full signing-key fingerprint/);
  await assert.rejects(packageLinuxApplicationNative(app,{format:'appimage'},{toolchain:{appimageRuntime:'/tmp/runtime'}}),/requires appimageRuntimeLicense/);
  await assert.rejects(packageLinuxApplicationNative(app,{format:'flatpak'},{toolchain:{temporaryDirectory:'/tmp/one\ntwo'}}),/Invalid native packaging toolchain/);
  await assert.rejects(exportLinuxProject(null,{distribution:{format:'flatpak',appId:'invalid'}}),/reverse-DNS/);
  await assert.rejects(exportLinuxProject(null,{distribution:{format:'zip',appId:'org.example.Test'}}),/require flatpak/);
  await assert.rejects(exportLinuxProject(null,{distribution:{format:'zip'},toolchain:{flatpak:'bad'}}),/require appimage or flatpak/);
});
test('native packaging resolves explicit relative tool paths from the caller directory',async t=>{
  if(process.platform!=='linux'){t.skip('Linux native package host');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-relative-tool-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const tool=path.join(directory,'flatpak');await fs.writeFile(tool,'#!/bin/sh\nprintf "%s\\n" "RELATIVE_TOOL_WAS_EXECUTED" >&2\nexit 71\n',{mode:0o755});
  const application=await exportLinuxApplication(project);
  await assert.rejects(packageLinuxApplicationNative(application,{format:'flatpak'},{toolchain:{flatpak:path.relative(process.cwd(),tool)}}),/flatpak failed \(71\): RELATIVE_TOOL_WAS_EXECUTED/);
});
test('AppImage dependency traversal rejects a library from another architecture',async t=>{
  if(process.platform!=='linux'){t.skip('Linux ELF dependency reader');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-wrong-dependency-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const app=await exportLinuxApplication(project),bad=await loadAppImageRuntime('arm64');
  const sysroot=path.join(directory,'target'),libraries=path.join(sysroot,'usr/lib/x86_64-linux-gnu'),appdir=path.join(directory,'AppDir');
  await fs.mkdir(libraries,{recursive:true});await fs.mkdir(appdir);await fs.writeFile(path.join(libraries,'wrong-machine'),bad.bytes);
  for(const name of app.report.dependencies)await fs.symlink('wrong-machine',path.join(libraries,name));
  const executable=path.join(directory,'program');await fs.writeFile(executable,app.executable);
  await assert.rejects(bundleAppImageDependencies({appdir,executable,compiler:app.options,toolchain:{sysroot}}),/wrong ELF architecture/);
});
test('AppImage dependency traversal rejects conflicting real ELF origin trees',async t=>{
  if(process.platform!=='linux'){t.skip('Linux ELF dependency reader and native fixture compiler');return;}
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'linux-conflicting-dependency-'));t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const sysroot=path.join(directory,'target'),appdir=path.join(directory,'AppDir'),base=path.join(sysroot,'usr/lib');
  await fs.mkdir(appdir);await fs.mkdir(path.join(base,'a/private'),{recursive:true});await fs.mkdir(path.join(base,'b/private'),{recursive:true});
  const compile=async(name,source,output,flags=[])=>{
    const filename=path.join(directory,name+'.c');await fs.writeFile(filename,source);
    await runPackagingTool('cc',['-shared','-fPIC','-nostdlib',filename,...flags,'-o',output]);
  };
  for(const [name,value]of [['a',1],['b',2]]){
    const origin=path.join(base,name),privateDirectory=path.join(origin,'private');
    await compile(name+'-shared','int shared(void) { return '+value+'; }',path.join(privateDirectory,'libshared.so'),['-Wl,-soname,libshared.so']);
    await compile(name,'int shared(void); int '+name+'(void) { return shared(); }',path.join(origin,'lib'+name+'.so'),
      ['-L'+privateDirectory,'-Wl,--no-as-needed','-lshared','-Wl,-rpath,$ORIGIN/private','-Wl,-soname,lib'+name+'.so']);
  }
  const executable=path.join(base,'fixture');
  await compile('entry','int a(void); int b(void); int entry(void) { return a() + b(); }',executable,
    ['-L'+path.join(base,'a'),'-L'+path.join(base,'b'),'-Wl,--no-as-needed','-la','-lb','-Wl,-rpath,/usr/lib/a:/usr/lib/b']);
  await assert.rejects(bundleAppImageDependencies({appdir,executable,compiler:{architecture:process.arch,toolkit:'gtk3'},toolchain:{sysroot}}),/Conflicting AppImage dependency origins for libshared\.so/);
});
