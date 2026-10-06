/** Compare independently captured Windows API behavior with the browser package.
 * The Windows probe calls OS DLL entry points; it does not use this implementation. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import assert from 'node:assert/strict';
import {createWin32} from '../packages/win32-browser/src/index.js';
const w=createWin32(),m=w.memory,results={};
const call=(dll,name,...args)=>w.invoke(dll,name,args),k=(name,...args)=>call('kernel32',name,...args);
const alloc=(values)=>{const p=m.alloc(values.length||1);m.bytes(p,values.length).set(values);return p;};
const u32=value=>{const p=m.alloc(4);m.writeU32(p,value);return p;};
const hex=(p,n)=>Buffer.from(m.bytes(p,n)).toString('hex').toUpperCase();
function multi(name,cp,flags,data,count){const p=alloc(data),out=m.alloc(128),query=k('MultiByteToWideChar',cp,flags,p,count,0,0);w.lastError=0;const n=k('MultiByteToWideChar',cp,flags,p,count,out,64);results[name]=[query,n,n?0:w.lastError,hex(out,n*2)];}
function wide(name,cp,flags,text,count){const p=m.allocString(text,true),out=m.alloc(128),used=u32(0),query=k('WideCharToMultiByte',cp,flags,p,count,0,0,0,cp===1252?used:0);w.lastError=0;const n=k('WideCharToMultiByte',cp,flags,p,count,out,128,0,cp===1252?used:0);results[name]=[query,n,n?0:w.lastError,hex(out,n),cp===1252?m.readU32(used):0];}
try{
 multi('utf8-terminated',65001,8,[65,195,169,226,130,172,0],-1);
 multi('utf8-astral',65001,8,[65,240,159,152,128],5);
 multi('utf8-bom',65001,8,[239,187,191,65],4);
 multi('utf8-invalid',65001,8,[195,40],2);
 multi('ansi-composite',1252,2,[233],1);
 wide('wide-utf8',65001,128,'Aé€',-1);
 wide('wide-invalid',65001,128,'\ud800',1);
 wide('ansi-replacement',1252,1024,'A界B',3);
 wide('ansi-astral',1252,1024,'😀',2);
 for(const suffix of ['A','W']){
  const wide=suffix==='W',step=wide?2:1;
  for(const [label,data,flags]of [['crlf',[0,255,1,254,2],1],['lf',[77],0x80000001],['nowrap',[77],0x40000001],['empty',[],1],['wrap',Array.from({length:51},(_,i)=>i),1]]){
   const input=alloc(data),out=m.alloc(256*step),n=u32(0);call('crypt32','CryptBinaryToString'+suffix,input,data.length,flags,0,n);const query=m.readU32(n);m.writeU32(n,256);const ok=call('crypt32','CryptBinaryToString'+suffix,input,data.length,flags,out,n);results['base64-'+suffix+'-'+label]=[query,ok,m.readU32(n),m.string(out,wide)];
  }
  const input=m.allocString(' QcOp\r\n4oKs ',wide),out=m.alloc(32),n=u32(0),skip=u32(9),actual=u32(9);call('crypt32','CryptStringToBinary'+suffix,input,0,1,0,n,skip,actual);const query=m.readU32(n);m.writeU32(n,32);const ok=call('crypt32','CryptStringToBinary'+suffix,input,0,1,out,n,skip,actual);results['decode-'+suffix]=[query,ok,m.readU32(n),hex(out,m.readU32(n)),m.readU32(skip),m.readU32(actual)];
  const path=m.alloc(260*step),s=(name,...args)=>call('shlwapi',name+suffix,...args);
  s('PathCombine',path,'C:\\one\\two','..\\file.txt');const combined=m.string(path,wide);s('PathCanonicalize',path,'C:\\one\\.\\two\\..\\x');const canonical=m.string(path,wide);
  m.putString(path,'C:\\a\\',260,wide);const removed=(s('PathRemoveBackslash',path)-path)/step,again=(s('PathRemoveBackslash',path)-path)/step;
  results['paths-'+suffix]=[combined,canonical,removed,again,s('PathIsRelative','item'),s('PathIsRelative','C:\\a')];
 }
 const guid=m.alloc(16),text=m.allocString('{00112233-4455-6677-8899-aabbccddeeff}',true),out=m.alloc(80);const parsed=call('ole32','CLSIDFromString',text,guid),n=call('ole32','StringFromGUID2',guid,out,39);results.guid=[parsed,hex(guid,16),n,m.string(out,true),call('ole32','CLSIDFromString','invalid',guid)>>>0];
 const event=k('CreateEventA',0,0,1,0);results['auto-event']=[k('WaitForSingleObject',event,0),k('WaitForSingleObject',event,0)];k('CloseHandle',event);
 const manual=k('CreateEventA',0,1,1,0);results['manual-event']=[k('WaitForSingleObject',manual,0),k('WaitForSingleObject',manual,0),k('ResetEvent',manual),k('WaitForSingleObject',manual,0)];k('CloseHandle',manual);
 const auto=k('CreateEventA',0,0,1,0),sem=k('CreateSemaphoreA',0,0,2,0),handles=m.alloc(8),prev=u32(91);m.writeU32(handles,auto);m.writeU32(handles+4,sem);
 const blocked=k('WaitForMultipleObjects',2,handles,1,0),released=k('ReleaseSemaphore',sem,1,prev),ready=k('WaitForMultipleObjects',2,handles,1,0);results['wait-all']=[blocked,released,m.readU32(prev),ready,k('WaitForSingleObject',auto,0),k('WaitForSingleObject',sem,0)];
 k('SetEvent',auto);k('ReleaseSemaphore',sem,1,0);results['wait-any']=[k('WaitForMultipleObjects',2,handles,0,0),k('WaitForMultipleObjects',2,handles,0,0),k('WaitForMultipleObjects',2,handles,0,0)];
 w.lastError=0;const overflow=k('ReleaseSemaphore',sem,3,prev);results['semaphore-overflow']=[overflow,w.lastError];k('CloseHandle',auto);k('CloseHandle',sem);
 const atom=k('GlobalAddAtomA','VB6.Services.Contract.20261006'),same=k('GlobalAddAtomA','vb6.services.contract.20261006'),name=m.alloc(128);const len=k('GlobalGetAtomNameA',atom,name,128);results.atoms=[atom===same,len,m.string(name),k('GlobalDeleteAtom',atom),k('GlobalFindAtomA','VB6.Services.Contract.20261006')===same];k('GlobalDeleteAtom',same);
 const window=w.registerWindow({}),cb=w.registerCallback((_h,name,value,context)=>{results['property-callback']=[m.string(name),value,context];return 321;});
 results.properties=[call('user32','SetPropA',window,'VB6.Contract',42),call('user32','GetPropA',window,'VB6.Contract'),await call('user32','EnumPropsExA',window,cb,99),call('user32','RemovePropA',window,'VB6.Contract'),call('user32','GetPropA',window,'VB6.Contract')];w.unregisterWindow(window);
 {const key=u32(0),child=u32(0),data=m.allocString('café',true),name=m.alloc(128),nameSize=u32(64),dataSize=u32(0),type=u32(0),count=u32(0),maxName=u32(0),maxData=u32(0),subs=u32(0),maxSub=u32(0);
 const reg=(fn,...args)=>call('advapi32',fn,...args),keyName='Software\\VB6ServicesContract';
 reg('RegCreateKeyExW',0x80000001,keyName,0,0,0,0xf003f,0,key,0);const kh=m.readU32(key);
 reg('RegCreateKeyExW',kh,'Child',0,0,0,0xf003f,0,child,0);reg('RegCloseKey',m.readU32(child));reg('RegSetValueExW',kh,'Caption',0,1,data,10);
 const info=reg('RegQueryInfoKeyW',kh,0,0,0,subs,maxSub,0,count,maxName,maxData,0,0),enumerated=reg('RegEnumValueW',kh,0,name,nameSize,0,type,0,dataSize);
 results.registry=[info,m.readU32(subs),m.readU32(maxSub),m.readU32(count),m.readU32(maxName),m.readU32(maxData),enumerated,m.string(name,true),m.readU32(nameSize),m.readU32(type),m.readU32(dataSize)];
 reg('RegEnumKeyW',kh,0,name,64);results['registry-child']=m.string(name,true);reg('RegDeleteKeyW',kh,'Child');reg('RegDeleteValueW',kh,'Caption');reg('RegCloseKey',kh);reg('RegDeleteKeyW',0x80000001,keyName);}
 w.fs.directories.add('/contract');w.fs.writeBytes('/contract/sample.dat',[65,66,67]);const findData=m.alloc(592),find=k('FindFirstFileW','/contract/*.dat',findData);results.files=[m.string(findData+44,true),m.readU32(findData+28),m.readU32(findData+32),k('FindNextFileW',find,findData),w.lastError];k('FindClose',find);
 const file=k('CreateFileW','/contract/sample.dat',0xc0000000,0,0,3,0,0),size64=m.alloc(8);results['file-size-flush']=[k('GetFileSizeEx',file,size64),Number(m.view(size64,8).getBigInt64(0,true)),k('FlushFileBuffers',file)];k('CloseHandle',file);
 mkdirSync('reports/win32-services-native',{recursive:true});writeFileSync('reports/win32-services-native/browser.json',JSON.stringify(results,null,2)+'\n');
 if(process.argv[2]){
  const native=JSON.parse(readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')),differences=[];
  for(const name of new Set([...Object.keys(native),...Object.keys(results)]))try{assert.deepEqual(results[name],native[name]);}catch{differences.push({name,browser:results[name],windows:native[name]});}
  const report={fields:Object.keys(results).length,matched:Object.keys(results).length-differences.length,differences};writeFileSync('reports/win32-services-native/comparison.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));assert.equal(differences.length,0,'Win32 service contract differences');
 }else console.log(JSON.stringify(results,null,2));
}finally{w.dispose();}
