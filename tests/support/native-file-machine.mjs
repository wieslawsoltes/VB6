/** Explicit Win32 file/codec doubles for emitted IA-32 ABI tests. These exercise
 * real emitted code against bounded memory, NOT Windows execution. The Windows
 * fixture suite independently runs compiled EXEs against the operating system. */
import assert from 'node:assert/strict';
import {PE32Image} from '../../src/native/pe32.js';
import {compileWin32} from '../../src/native/compiler.js';
import {newProject} from '../../src/project/model.js';
import {NativeX86Machine} from './native-x86-machine.mjs';
export function nativeFileMachine(t,{optimization=1,encoding='windows-1252',code=null}={}){
 let linked;const finish=PE32Image.prototype.finish;
 const mock=t.mock.method(PE32Image.prototype,'finish',function(...args){return linked=finish.apply(this,args);});
 const result=compileWin32({...newProject('ReadAbi'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:code||'Sub Main\nDim s As String\nOpen "x" For Input As #1\ns=Input$(2,1)\nLine Input #1,s\nClose #1\nEnd Sub'}]},{optimization});mock.mock.restore();
 const vm=new NativeX86Machine(linked),m=vm.memory,files=new Map(),handles=new Map(),failures=new Map();let lastError=0,nextHandle=100;
 const add=(name,bytes)=>{const file={bytes:Uint8Array.from(bytes),id:files.size+1,size:BigInt(bytes.length)};files.set(name,file);return file;};
 const handle=h=>{assert.ok(handles.has(h),'live Win32 handle');return handles.get(h);};
 vm.hook('kernel32.dll','GetLastError',0,()=>lastError);
 vm.hook('kernel32.dll','CreateFileW',7,([path,access,sharing,security,creation,flags,template])=>{
  const name=m.bstr(path);assert.equal(security,0);assert.equal(template,0);assert.equal(flags,128);assert.ok([3,4].includes(creation));
  if(creation===3&&!files.has(name)){lastError=2;return -1;}
  const file=files.get(name)||add(name,[]),h=nextHandle++;handles.set(h,{file,position:0n,access});return h;
 });
 vm.hook('kernel32.dll','GetFileInformationByHandle',2,([h,out])=>{const {file}=handle(h);for(let i=0;i<52;i+=4)m.write(out+i,0);m.write(out+28,10);m.write(out+44,0);m.write(out+48,file.id);return 1;});
 vm.hook('kernel32.dll','SetEndOfFile',1,([h])=>{const f=handle(h);assert.ok(f.access&0x40000000);const next=new Uint8Array(Number(f.position));next.set(f.file.bytes.subarray(0,next.length));f.file.bytes=next;f.file.size=f.position;return 1;});
 vm.hook('kernel32.dll','CloseHandle',1,([h])=>{handle(h);handles.delete(h);return 1;});
 vm.hook('kernel32.dll','ReadFile',5,([h,out,count,actual,overlap])=>{
  const f=handle(h);assert.equal(overlap,0);assert.ok(f.access&0x80000000);assert.ok(count>=1&&count<=32767);
  if(failures.has('read')){lastError=failures.get('read');failures.delete('read');return 0;}
  const bytes=f.file.bytes.slice(Number(f.position),Number(f.position)+Math.min(count,failures.get('partial')||count));
  for(let i=0;i<bytes.length;i++)m.write(out+i,bytes[i],8);m.write(actual,bytes.length);f.position+=BigInt(bytes.length);return 1;
 });
 vm.hook('kernel32.dll','WriteFile',5,([h,source,count,actual,overlap])=>{
  const f=handle(h);assert.equal(overlap,0);assert.ok((f.access&0x40000000)||f.access===4);assert.ok(count>=1&&count<=32767);
  if(failures.has('write')){lastError=failures.get('write');failures.delete('write');return 0;}
  const length=Math.min(count,failures.get('partialWrite')||count),start=Number(f.access===4?f.file.size:f.position),end=start+length;
  const bytes=new Uint8Array(Math.max(end,f.file.bytes.length));bytes.set(f.file.bytes);
  for(let i=0;i<length;i++)bytes[start+i]=m.read(source+i,8);
  f.file.bytes=bytes;f.file.size=BigInt(bytes.length);f.position=BigInt(end);m.write(actual,length);return 1;
 });
 vm.hook('kernel32.dll','GetFileAttributesExW',3,([path,level,out])=>{
  assert.equal(level,0);const file=files.get(m.bstr(path));if(!file){lastError=2;return 0;}
  for(let i=0;i<36;i+=4)m.write(out+i,0);m.write(out,32);m.write(out+28,Number(file.size>>32n));m.write(out+32,Number(file.size&0xffffffffn));return 1;
 });
 vm.hook('kernel32.dll','DeleteFileW',1,([path])=>{
  const name=m.bstr(path),file=files.get(name);if(!file){lastError=2;return 0;}
  if([...handles.values()].some(h=>h.file===file)){lastError=32;return 0;}
  files.delete(name);return 1;
 });
 vm.hook('kernel32.dll','MoveFileW',2,([source,destination])=>{
  const from=m.bstr(source),to=m.bstr(destination),file=files.get(from);
  if(!file){lastError=2;return 0;}if(files.has(to)){lastError=80;return 0;}
  if([...handles.values()].some(h=>h.file===file)){lastError=32;return 0;}
  files.set(to,file);files.delete(from);return 1;
 });
 vm.hook('kernel32.dll','CopyFileW',3,([source,destination,failIfExists])=>{
  const from=m.bstr(source),to=m.bstr(destination),file=files.get(from);
  if(!file){lastError=2;return 0;}if(failIfExists&&files.has(to)){lastError=80;return 0;}
  add(to,file.bytes);return 1;
 });
 vm.hook('kernel32.dll','GetFileSizeEx',2,([h,out])=>{const {file}=handle(h);m.write(out,Number(file.size&0xffffffffn));m.write(out+4,Number(file.size>>32n));return 1;});
 vm.hook('kernel32.dll','SetFilePointerEx',5,([h,low,high,out,method])=>{
  const f=handle(h),distance=BigInt.asIntN(64,(BigInt(high)<<32n)|BigInt(low));assert.ok([0,1,2].includes(method));
  const next=(method===0?0n:method===1?f.position:f.file.size)+distance;assert.ok(next>=0n);f.position=next;
  if(out){m.write(out,Number(next&0xffffffffn));m.write(out+4,Number(next>>32n));}return 1;
 });
 vm.hook('kernel32.dll','MultiByteToWideChar',6,([cp,flags,source,count,out,capacity])=>{
  assert.equal(cp,0);assert.equal(flags,8);assert.ok(count>=1&&count<=4);assert.equal(capacity,2);
  const bytes=Uint8Array.from({length:count},(_,i)=>m.read(source+i,8));let text;
  try{text=encoding==='windows-1252'&&count===1&&bytes[0]===0x80?'€':new TextDecoder(encoding,{fatal:true,ignoreBOM:true}).decode(bytes);}catch{return 0;}
  if(text.length>capacity)return 0;for(let i=0;i<text.length;i++)m.write(out+2*i,text.charCodeAt(i),16);return text.length;
 });
 const invoke=(name,...args)=>vm.invoke('native:file:'+name,args);
 const open=(name,number=1,mode=3,capacity=512)=>{const path=m.string(name);invoke('open',path,number,mode,3,capacity);m.free(path-4);return invoke('resolve',number);};
 const generation=entry=>m.read(entry+12),text=(entry,n)=>m.bstr(vm.invoke('proc:NativeFileText:ReadText',[entry,n])),line=entry=>m.bstr(vm.invoke('proc:NativeFileText:ReadLine',[entry]));
 return {vm,m,result,add,files,handles,failures,invoke,open,generation,text,line};
}
