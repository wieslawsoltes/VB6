import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {gunzipSync} from 'node:zlib';
import {md5Bytes,gzipStore,utf8} from '../packages/linux-native/src/distribution-archive.js';
import {exportLinuxApplication} from '../packages/linux-native/src/aot-export.js';
import {packageLinuxApplication,exportLinuxDistribution,linuxDistributionOptions} from '../packages/linux-native/src/distribution.js';
const hash=(algorithm,bytes)=>createHash(algorithm).update(bytes).digest('hex');
const project={schema:1,name:'Distribution App',startup:'Sub Main',modules:[{name:'MainModule',kind:'module',code:'Public Sub Main()\nDebug.Print "LINUX_DISTRIBUTION_OK"\nEnd Sub'}]};
let application;
const exported=async()=>application??=await exportLinuxApplication(project,{}, {resources:{'Resources/data.txt':'Resource fixture\n'}});
function arEntries(bytes) {
  assert.equal(Buffer.from(bytes.subarray(0,8)).toString(),'!<arch>\n');const files=new Map();
  for(let offset=8;offset<bytes.length;){
    const header=Buffer.from(bytes.subarray(offset,offset+60)).toString();assert.equal(header.slice(58),'`\n');
    const name=header.slice(0,16).trim().replace(/\/$/,''),size=Number(header.slice(48,58));
    files.set(name,bytes.slice(offset+60,offset+60+size));offset+=60+size+(size%2);
  }return files;
}
function rpmParts(bytes) {
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const read=offset=>{
    assert.equal(view.getUint32(offset),0x8eade801);const count=view.getUint32(offset+8),length=view.getUint32(offset+12),store=offset+16+count*16,tags=new Map();
    for(let index=0;index<count;index++){
      const at=offset+16+index*16,tag=view.getUint32(at),type=view.getUint32(at+4),start=store+view.getUint32(at+8),items=view.getUint32(at+12);
      if(type===6){let end=start;while(bytes[end])end++;tags.set(tag,Buffer.from(bytes.subarray(start,end)).toString());}
      else if(type===8){const values=[];let at=start;for(let item=0;item<items;item++){let end=at;while(bytes[end])end++;values.push(Buffer.from(bytes.subarray(at,end)).toString());at=end+1;}tags.set(tag,values);}
      else if(type===7)tags.set(tag,bytes.slice(start,start+items));
      else if(type===4)tags.set(tag,Array.from({length:items},(_,i)=>view.getUint32(start+i*4)));
    }
    return {tags,end:store+length,bytes:bytes.slice(offset,store+length)};
  };
  const signature=read(96),main=read(Math.ceil(signature.end/8)*8);
  return {signature,main,payload:bytes.slice(main.end),body:bytes.slice(Math.ceil(signature.end/8)*8)};
}
test('Linux package container checksums match independent implementations at block boundaries',()=>{
  for(const length of [0,1,55,56,57,63,64,65,65535,65536,131070]){
    const bytes=Uint8Array.from({length},(_,index)=>index%251);
    assert.equal(md5Bytes(bytes),hash('md5',bytes));assert.deepEqual(new Uint8Array(gunzipSync(gzipStore(bytes))),bytes);
  }
});
test('Linux package metadata rejects field, path, desktop, and spec injection',()=>{
  for(const options of [{format:'appimage'},{packageName:'../evil'},{packageName:'x;touch-pwn'},{packageName:'$(id)'},{packageName:'name\nBreak: true'},
    {version:'1.0-1'},{version:'1%{lua:print(1)}'},{release:'0'},{release:1},{maintainer:'X\nDepends: bad'},
    {summary:'X\nExec=bad'},{description:'text\rDepends: bad'},{license:'MIT\0bad'},{homepage:'file:///tmp/example'},
    {homepage:'https://user:password@example.com'},{homepage:false},{homepage:0},{categories:['Utility;Exec=bad']},{categories:['Utility','Utility']},{categories:[]}])assert.throws(()=>linuxDistributionOptions(options));
  const options=linuxDistributionOptions({packageName:'test-app',description:'First line\n\nLast line',homepage:'https://example.com/app',categories:['Utility','Office']},'Zażółć App');
  assert.equal(options.summary,'Zażółć App');assert.equal(options.license,'Unspecified');assert.ok(Object.isFrozen(options.categories));
});
test('ZIP distribution preserves the exact sealed executable and archive bytes',async()=>{
  const app=await exported(),packaged=await packageLinuxApplication(app);
  assert.deepEqual(packaged.bytes,app.bytes);assert.equal(packaged.report.sha256,app.report.sha256);assert.equal(packaged.report.applicationSha256,app.report.sha256);
  assert.equal(packaged.mimeType,'application/zip');assert.equal(packaged.report.installation,null);assert.equal(packaged.report.signed,false);
  const forged=await packageLinuxApplication({...app,files:{evil:utf8('ignored')},report:{dependencies:['evil'],executableSha256:'false'}});
  assert.equal(forged.report.executableSha256,app.report.executableSha256);assert.deepEqual(forged.bytes,app.bytes);
});
test('Debian package metadata and archive structure preserve the verified application',async()=>{
  const app=await exported(),options={format:'deb',packageName:'distribution-app',version:'2.3.4',release:'5',maintainer:'Example Publisher <publisher@example.com>',license:'MIT'};
  const packaged=await packageLinuxApplication(app,options),files=arEntries(packaged.bytes);
  assert.deepEqual([...files.keys()],['debian-binary','control.tar.gz','data.tar.gz']);assert.equal(Buffer.from(files.get('debian-binary')).toString(),'2.0\n');
  const control=gunzipSync(files.get('control.tar.gz')).toString();
  for(const field of ['Package: distribution-app','Version: 2.3.4-5','Architecture: amd64','Depends: libc6 (>= 2.39)','libcups2t64','Maintainer: Example Publisher <publisher@example.com>'])assert.ok(control.includes(field),field);
  assert.equal(packaged.filename,'distribution-app_2.3.4-5_amd64.deb');assert.equal(packaged.report.installation.launcher,'/usr/bin/distribution-app');
  assert.equal(packaged.report.executableSha256,app.report.executableSha256);assert.equal(packaged.report.sha256,hash('sha256',packaged.bytes));
  assert.deepEqual((await packageLinuxApplication(app,options)).bytes,packaged.bytes);
});
test('RPM has independent SHA256 header, payload and file digests plus legacy v4 digests',async()=>{
  const app=await exported(),options={format:'rpm',packageName:'distribution-app',version:'2.3.4',release:'5'};
  const packaged=await packageLinuxApplication(app,options),{signature,main,payload,body}=rpmParts(packaged.bytes);
  assert.deepEqual([...packaged.bytes.slice(0,4)],[0xed,0xab,0xee,0xdb]);
  assert.equal(signature.tags.get(273),hash('sha256',main.bytes));assert.equal(signature.tags.get(269),hash('sha1',main.bytes));
  assert.equal(Buffer.from(signature.tags.get(1004)).toString('hex'),hash('md5',body));assert.equal(signature.tags.get(1000)[0],body.length);
  assert.equal(main.tags.get(1000),'distribution-app');assert.equal(main.tags.get(1022),'x86_64');assert.equal(main.tags.get(5011)[0],8);
  assert.equal(gunzipSync(payload).subarray(0,6).toString(),'070702');assert.equal(packaged.filename,'distribution-app-2.3.4-5.x86_64.rpm');
  assert.deepEqual((await packageLinuxApplication(app,options)).bytes,packaged.bytes);
});
test('RPM declares every required libgcc symbol version for its target architecture',async()=>{
  for(const architecture of ['x64','arm64']){
    const app=architecture==='x64'?await exported():await exportLinuxApplication(project,{architecture});
    const {main}=rpmParts((await packageLinuxApplication(app,{format:'rpm',packageName:'gcc-abi-fixture'})).bytes);
    const names=main.tags.get(1049),flags=main.tags.get(1048),versions=main.tags.get(1050);
    assert.equal(names.length,flags.length);assert.equal(names.length,versions.length);
    const capabilities=names.filter(name=>name.startsWith('libgcc_s.so.1(GCC_'));
    const expected=architecture==='arm64'?['3.0','4.2.0','4.5.0']:['3.0','4.2.0'];
    assert.deepEqual(capabilities,expected.map(version=>'libgcc_s.so.1(GCC_'+version+')(64bit)'));
    for(const capability of capabilities){const index=names.indexOf(capability);assert.equal(flags[index],0);assert.equal(versions[index],'');}
  }
});
test('distribution packaging rejects damaged seals, cancelled work and invalid metadata before compiling',async()=>{
  const app=await exported(),bytes=app.bytes.slice();bytes[0]^=1;
  await assert.rejects(packageLinuxApplication({...app,bytes},{format:'rpm'}));
  await assert.rejects(packageLinuxApplication({...app,options:{...app.options,name:'Different'}}));
  const signal=AbortSignal.abort();await assert.rejects(packageLinuxApplication(app,{format:'rpm'},{signal}),{name:'AbortError'});
  await assert.rejects(exportLinuxDistribution(null,{}, {format:'invalid'}),/format must/);
});
test('portable tar.gz retains UTF-8 names, executable mode and deterministic gzip header',async()=>{
  const app=await exported(),result=await packageLinuxApplication(app,{format:'tar.gz'}),tar=gunzipSync(result.bytes);
  assert.equal(result.filename,'Distribution App-linux-x64.tar.gz');assert.deepEqual([...result.bytes.slice(4,8)],[0,0,0,0]);
  assert.ok(tar.includes(Buffer.from('Distribution App/bin/Distribution App')));assert.ok(tar.includes(Buffer.from('0000755')));
  assert.deepEqual((await packageLinuxApplication(app,{format:'tar.gz'})).bytes,result.bytes);
});
