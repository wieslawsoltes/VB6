/** Execute only browser artifacts that exactly match our reviewed fixture. */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {exportLinuxDistribution, unpackLinuxAOTArchive} from '../packages/linux-native/src/index.js';
import {linuxBrowserProject} from '../tests/linux-browser-fixture.mjs';

if (process.platform !== 'linux' || !['x64','arm64'].includes(process.arch)) throw new Error('Browser ELF execution requires Linux x64 or ARM64.');
const input = path.resolve(process.argv[2] || 'reports/linux-aot-browser');
let architecture=process.arch,sysroot;
for(let index=3;index<process.argv.length;index+=2){
  const flag=process.argv[index],value=process.argv[index+1];
  if(flag==='--architecture'&&['x64','arm64'].includes(value))architecture=value;
  else if(flag==='--sysroot'&&value)sysroot=path.resolve(value);
  else throw new Error('Expected --architecture x64|arm64 or --sysroot PATH.');
}
if(architecture!==process.arch&&!sysroot)throw new Error('Cross-architecture browser execution requires an explicit sysroot.');
const cases = [];
for (const format of ['zip','tar.gz','deb','rpm']) {
const expected = await exportLinuxDistribution(linuxBrowserProject(architecture),{architecture},{format});
for (const browser of ['chromium', 'firefox', 'webkit']) for (const origin of ['http', 'file']) {
  const filename = browser + '-' + origin + (architecture==='x64'&&format==='zip'?'':'-'+architecture) + '.' + format, bytes = new Uint8Array(await fs.readFile(path.join(input, filename)));
  assert.deepEqual(bytes, expected.bytes, filename + ' must match the exact current-source fixture');
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 'vb6-linux-browser-'));
  try {
    const run=(tool,args,options={})=>execFileSync(tool,args,{cwd:work,encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024,...options});
    const archive=path.join(work,'download.'+format),directory=path.join(work,'application');await fs.writeFile(archive,bytes);await fs.mkdir(directory);
    // Exact byte comparison above establishes the file set before extraction.
    if(format==='zip'){
      const {files}=await unpackLinuxAOTArchive(bytes,expected.options);
      for (const [name, content] of files) {
        const file = path.join(directory, name); await fs.mkdir(path.dirname(file), {recursive: true});
        await fs.writeFile(file, content, {flag: 'wx', mode: name === 'LinuxBrowser/bin/LinuxBrowser' ? 0o755 : 0o644});
      }
    }else if(format==='tar.gz')run('tar',['-xzf',archive,'-C',directory]);
    else if(format==='deb')run('dpkg-deb',['--extract',archive,directory]);
    else {
      const digest=run('rpm',['--dbpath',path.join(work,'rpmdb'),'--checksig','--verbose',archive]);assert.match(digest,/Header SHA256 digest: OK/);assert.match(digest,/Payload SHA256 digest: OK/);
      run('cpio',['-idm','--quiet','--no-absolute-filenames'],{cwd:directory,input:run('rpm2cpio',[archive],{encoding:null})});
    }
    const executable = path.join(directory, format==='deb'||format==='rpm'?'usr/bin/linuxbrowser':'LinuxBrowser/bin/LinuxBrowser');
    assert.equal((await fs.stat(executable)).mode&0o777,0o755);
    assert.equal(createHash('sha256').update(await fs.readFile(executable)).digest('hex'),expected.report.executableSha256);
    const command=architecture===process.arch?executable:architecture==='arm64'?'qemu-aarch64':'qemu-x86_64';
    const args=architecture===process.arch?[]:['-L',sysroot,executable];
    const result = spawnSync(command, args, {cwd: os.tmpdir(), encoding: 'utf8', timeout: 30000, env: {...process.env, DISPLAY: '', WAYLAND_DISPLAY: ''}});
    assert.equal(result.error, undefined, result.error?.message);
    assert.equal(result.status, 0, filename + '\n' + result.stderr);
    assert.equal(result.stdout.trim(), 'LINUX_BROWSER_AOT_OK');
    cases.push({browser, origin,architecture,format,archiveSha256: createHash('sha256').update(bytes).digest('hex'), exitCode: result.status, output: result.stdout.trim()});
    console.log('PASS actual browser ELF execution:', browser, origin,architecture,format);
  } finally {await fs.rm(work, {recursive: true, force: true});}
}
}
const out = path.resolve('reports/linux-aot-browser-native'); await fs.mkdir(out, {recursive: true});
await fs.writeFile(path.join(out, 'validation-'+architecture+'.json'), JSON.stringify({platform: process.platform, architecture,hostArchitecture:process.arch,executionMode:architecture===process.arch?'native':'qemu-user',passed: true, cases}, null, 2) + '\n');
