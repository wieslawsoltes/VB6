import test from 'node:test';
import assert from 'node:assert/strict';
import {createWin32,WIN32_CONSTANTS as C} from '../src/index.js';

function setup(t,options={}){const w=createWin32(options);t.after(()=>w.dispose());return {w,m:w.memory,call:(name,...args)=>w.invoke('kernel32',name,args)};}
const u32=(m,n)=>{const p=m.alloc(4);m.writeU32(p,n);return p;};
const bytes=(m,values)=>{const p=m.alloc(values.length||1);m.bytes(p,values.length).set(values);return p;};
const list=(m,values)=>{const p=m.alloc(values.length*4);values.forEach((v,i)=>m.writeU32(p+i*4,v));return p;};

for(const wide of [false,true]){
  const suffix=wide?'W':'A',step=wide?2:1;
  test('file enumeration '+suffix+' includes immediate children and exact size layout',t=>{
    const {w,m,call}=setup(t);w.fs.directories.add('/docs');w.fs.directories.add('/docs/sub');w.fs.writeBytes('/docs/test.txt',[1,2,3]);w.fs.writeBytes('/docs/noext',[]);w.fs.writeBytes('/docs/sub/hidden.txt',[9]);
    const out=m.alloc(wide?592:320),handle=call('FindFirstFile'+suffix,'/docs/*.*',out),found=[];assert.ok(handle>0);
    do{found.push([m.string(out+44,wide),m.readU32(out),m.readU32(out+32)]);}while(call('FindNextFile'+suffix,handle,out));
    assert.equal(w.lastError,18);assert.deepEqual(found.sort(),[['noext',128,0],['sub',16,0],['test.txt',128,3]]);assert.equal(call('FindClose',handle),1);assert.equal(call('FindClose',handle),0);assert.equal(w.lastError,6);
  });
  test('file enumeration '+suffix+' keeps snapshot and invalid output does not advance',t=>{
    const {w,m,call}=setup(t);w.fs.writeBytes('/a.txt',[1]);w.fs.writeBytes('/b.txt',[2]);const out=m.alloc(wide?592:320),handle=call('FindFirstFile'+suffix,'/*.TXT',out);
    w.fs.remove('/b.txt');w.fs.writeBytes('/c.txt',[3]);assert.equal(call('FindNextFile'+suffix,handle,0),0);assert.equal(call('FindNextFile'+suffix,handle,out),1);assert.equal(m.string(out+44,wide),'b.txt');assert.equal(call('FindNextFile'+suffix,handle,out),0);
    assert.equal(call('CloseHandle',handle),0);assert.equal(w.handles.has(handle,'find'),true);assert.equal(call('FindClose',handle),1);
  });
  test('file enumeration '+suffix+' rejects unsupported locations and does not leak handles',t=>{
    const {w,m,call}=setup(t,{maxFindEntries:1});const out=m.alloc(wide?592:320),baseline=w.handles.entries.size;w.fs.writeBytes('/one',[]);w.fs.writeBytes('/two',[]);
    assert.equal(call('FindFirstFile'+suffix,'/*',out),-1);assert.equal(w.lastError,8);assert.equal(w.handles.entries.size,baseline);
    for(const path of ['\\\\server\\share\\*','/','/missing/*','/does-not-exist'])assert.equal(call('FindFirstFile'+suffix,path,out),-1);
  });
  test('file full and temporary paths '+suffix+' honor sizes and creation semantics',t=>{
    const {w,m,call}=setup(t),out=m.alloc(260*step),part=u32(m,123);
    const need=call('GetFullPathName'+suffix,'/Temp/../sample.txt',0,0,part);assert.equal(need,14);assert.equal(m.readU32(part),123);
    assert.equal(call('GetFullPathName'+suffix,'/Temp/../sample.txt',260,out,part),13);assert.equal(m.string(out,wide),'C:\\sample.txt');assert.equal(m.readU32(part),out+3*step);
    const id=call('GetTempFileName'+suffix,'C:\\Temp','abc',0,out);assert.ok(id>0);const name=m.string(out,wide);assert.ok(w.fs.exists(name));
    assert.equal(call('GetTempFileName'+suffix,'C:\\Temp','xyz',42,out),42);assert.equal(w.fs.exists(m.string(out,wide)),false);
    assert.equal(call('GetTempFileName'+suffix,'C:\\Temp','xyz',0,0),0);assert.equal([...w.fs.files].length,1);
  });
  test('environment expansion '+suffix+' is single pass, case insensitive, sized and private',t=>{
    const {w,m,call}=setup(t,{environment:{DEMO:'%OTHER%',OTHER:'secret'}}),out=m.alloc(128*step);
    const source=m.allocString('%demo%/%missing%',wide);const n=call('ExpandEnvironmentStrings'+suffix,source,0,0);assert.equal(n,18);
    assert.equal(call('ExpandEnvironmentStrings'+suffix,source,out,128),18);assert.equal(m.string(out,wide),'%OTHER%/%missing%');
    assert.equal(call('ExpandEnvironmentStrings'+suffix,source,source,128),0);assert.equal(w.lastError,87);
  });
  test('Base64 '+suffix+' includes exact query/terminator and round trip sizes',t=>{
    const {w,m}=setup(t),data=bytes(m,[0,255,1,254,2]),n=u32(m,0),out=m.alloc(256*step),decoded=m.alloc(16),used=u32(m,0),skip=u32(m,9),flag=u32(m,9);
    const api=(name,...args)=>w.invoke('crypt32',name+suffix,args);
    assert.equal(api('CryptBinaryToString',data,5,1,0,n),1);assert.equal(m.readU32(n),11);
    m.writeU32(n,256);assert.equal(api('CryptBinaryToString',data,5,1,out,n),1);assert.equal(m.readU32(n),10);assert.equal(m.string(out,wide),'AP8B/gI=\r\n');
    assert.equal(api('CryptStringToBinary',out,0,1,0,used,skip,flag),1);assert.equal(m.readU32(used),5);assert.equal(m.readU32(skip),0);assert.equal(m.readU32(flag),1);
    m.writeU32(used,16);assert.equal(api('CryptStringToBinary',out,0,1,decoded,used,skip,flag),1);assert.deepEqual([...m.bytes(decoded,5)],[0,255,1,254,2]);
  });
  test('Base64 '+suffix+' supports newline modes, exact input counts and atomic rejection',t=>{
    const {w,m}=setup(t),input=bytes(m,[77]),out=m.alloc(64*step),size=u32(m,64),api=(name,...args)=>w.invoke('crypt32',name+suffix,args);
    for(const [flag,text]of [[0x40000001,'TQ=='],[0x80000001,'TQ==\n']]){m.writeU32(size,64);assert.equal(api('CryptBinaryToString',input,1,flag,out,size),1);assert.equal(m.string(out,wide),text);}
    const encoded=m.allocString('TQ==ignored',wide);m.writeU32(size,64);assert.equal(api('CryptStringToBinary',encoded,4,1,out,size,0,0),1);assert.equal(m.bytes(out,1)[0],77);
    m.bytes(out,8).fill(77);m.writeU32(size,64);assert.equal(api('CryptStringToBinary',encoded,0,1,out,size,0,0),0);assert.equal(w.lastError,13);assert.deepEqual([...m.bytes(out,8)],Array(8).fill(77));
    m.writeU32(size,1);assert.equal(api('CryptBinaryToString',input,1,1,out,size),0);assert.equal(w.lastError,234);assert.equal(m.readU32(size),7);
    assert.equal(api('CryptBinaryToString',input,1,4,out,size),0);assert.equal(w.lastError,50);
  });
  test('lexical shell paths '+suffix+' preserve pointer offsets and in-place extension changes',t=>{
    const {w,m}=setup(t),p=m.alloc(260*step),api=(name,...args)=>w.invoke('shlwapi',name+suffix,args);m.putString(p,'C:\\folder\\report.txt',260,wide);
    assert.equal(m.string(api('PathFindFileName',p),wide),'report.txt');assert.equal(m.string(api('PathFindExtension',p),wide),'.txt');
    api('PathRemoveExtension',p);assert.equal(m.string(p,wide),'C:\\folder\\report');assert.equal(api('PathRenameExtension',p,'.log'),1);assert.equal(m.string(p,wide),'C:\\folder\\report.log');
    assert.equal(api('PathIsRelative','C:\\root'),0);assert.equal(api('PathIsRelative','file.txt'),1);assert.equal(api('PathIsRoot','C:\\'),1);assert.equal(api('PathIsUNC','\\\\server\\share'),1);
  });
  test('lexical shell paths '+suffix+' canonicalize and combine without filesystem access',t=>{
    const {w,m}=setup(t),p=m.alloc(260*step),api=(name,...args)=>w.invoke('shlwapi',name+suffix,args);
    assert.equal(api('PathCombine',p,'C:\\one\\two','..\\file.txt'),p);assert.equal(m.string(p,wide),'C:\\one\\file.txt');
    assert.equal(api('PathCombine',p,'C:\\one','\\two'),p);assert.equal(m.string(p,wide),'C:\\two');
    assert.equal(api('PathCanonicalize',p,'C:\\one\\.\\two\\..\\x'),1);assert.equal(m.string(p,wide),'C:\\one\\x');
    assert.equal(api('PathFileExists','C:\\Windows'),1);assert.equal(api('PathIsDirectory','C:\\Windows'),16);assert.equal(api('PathFileExists','\\\\server\\share'),0);
    m.putString(p,'C:\\a',260,wide);assert.equal(api('PathAddBackslash',p),p+5*step);assert.equal(m.string(p,wide),'C:\\a\\');assert.equal(api('PathRemoveBackslash',p),p+4*step);assert.equal(m.string(p,wide),'C:\\a');assert.equal(api('PathRemoveBackslash',p),p+3*step);
  });
  test('shell path '+suffix+' overflow leaves the destination unchanged',t=>{
    const {w,m}=setup(t),out=m.alloc(8*step);m.putString(out,'keep',8,wide);
    assert.equal(w.invoke('shlwapi','PathCombine'+suffix,[out,'C:\\folder','file']),0);assert.equal(m.string(out,wide),'keep');assert.equal(w.lastError,122);
  });
  test('registry enumeration '+suffix+' counts names/bytes and leaves last error independent',t=>{
    const {w,m}=setup(t),api=(name,...args)=>w.invoke('advapi32',name+suffix,args),key=u32(m,0),disp=u32(m,0),data=m.allocString('café',wide),name=m.alloc(80*step),nameSize=u32(m,80),dataSize=u32(m,0),type=u32(m,0),count=u32(m,0),maxName=u32(m,0),maxData=u32(m,0);
    assert.equal(api('RegCreateKeyEx',0x80000001,'Software\\Demo',0,0,0,0xf003f,0,key,disp),0);const handle=m.readU32(key);assert.equal(api('RegSetValueEx',handle,'Caption',0,1,data,5*step),0);
    w.lastError=123;assert.equal(api('RegQueryInfoKey',handle,0,0,0,0,0,0,count,maxName,maxData,0,0),0);assert.equal(m.readU32(count),1);assert.equal(m.readU32(maxName),7);assert.equal(m.readU32(maxData),5*step);assert.equal(w.lastError,123);
    assert.equal(api('RegEnumValue',handle,0,name,nameSize,0,type,0,dataSize),0);assert.equal(m.string(name,wide),'Caption');assert.equal(m.readU32(nameSize),7);assert.equal(m.readU32(type),1);assert.equal(m.readU32(dataSize),5*step);
    m.writeU32(nameSize,80);assert.equal(api('RegEnumValue',handle,1,name,nameSize,0,type,0,dataSize),259);assert.equal(w.lastError,123);
  });
  test('registry enumeration '+suffix+' handles small buffers and permissions',t=>{
    const {w,m}=setup(t),api=(name,...args)=>w.invoke('advapi32',name+suffix,args),key=u32(m,0),out=m.alloc(32*step),n=u32(m,32),size=u32(m,0);
    assert.equal(api('RegCreateKeyEx',0x80000001,'Software\\Demo',0,0,0,0xf003f,0,key,0),0);const handle=m.readU32(key);
    const value=u32(m,42);assert.equal(api('RegSetValueEx',handle,'LongName',0,4,value,4),0);m.putString(out,'keep',32,wide);m.writeU32(n,2);
    assert.equal(api('RegEnumValue',handle,0,out,n,0,0,0,size),234);assert.equal(m.string(out,wide),'keep');assert.equal(m.readU32(size),4);
    assert.equal(api('RegQueryInfoKey',handle,0,0,0,0,0,0,0,0,0,0,size),50);
    assert.equal(api('RegOpenKeyEx',handle,'',0,2,key),0);assert.equal(api('RegEnumValue',m.readU32(key),0,out,n,0,0,0,size),5);
  });
  test('atoms/properties '+suffix+' preserve names and borrowed values',t=>{
    const {w,m,call}=setup(t),out=m.alloc(128*step),window=w.registerWindow({}),api=(name,...args)=>w.invoke('user32',name+suffix,args);
    const a=call('GlobalAddAtom'+suffix,'Demo.Atom'),b=call('GlobalAddAtom'+suffix,'demo.atom');assert.equal(a,b);assert.ok(a>=0xc000);
    assert.equal(call('GlobalGetAtomName'+suffix,a,out,128),9);assert.equal(m.string(out,wide),'Demo.Atom');
    assert.equal(api('SetProp',window,a,0xffffffff),1);assert.equal(api('GetProp',window,'DEMO.ATOM'),0xffffffff);
    assert.equal(call('GlobalDeleteAtom',a),0);assert.equal(call('GlobalDeleteAtom',b),0);assert.equal(api('GetProp',window,a),0xffffffff);
    assert.equal(api('RemoveProp',window,'demo.atom'),0xffffffff);assert.equal(call('GlobalFindAtom'+suffix,'demo.atom'),0);
  });
  test('property enumeration '+suffix+' awaits callbacks and frees scratch strings',async t=>{
    const {w,m}=setup(t),baseline=w.handles.entries.size,window=w.registerWindow({}),api=(name,...args)=>w.invoke('user32',name+suffix,args),seen=[];
    api('SetProp',window,'first',1);api('SetProp',window,'second',2);const before=m.used;
    const cb=w.registerCallback(async(hwnd,name,data,extra)=>{assert.equal(hwnd,window);seen.push([m.string(name,wide),data,extra]);await Promise.resolve();api('RemoveProp',window,name);return 7;});
    assert.equal(await api('EnumPropsEx',window,cb,42),7);assert.deepEqual(seen,[['first',1,42],['second',2,42]]);assert.equal(m.used,before);assert.equal(await api('EnumPropsEx',window,cb,0),-1);
    w.unregisterCallback(cb);w.unregisterWindow(window);assert.equal(w.handles.entries.size,baseline);
  });
}

test('UTF-8 conversion uses UTF-16 units, includes requested NUL and preserves BOM',t=>{
  const {m,call}=setup(t),src=bytes(m,[0xef,0xbb,0xbf,0x41,0xf0,0x9f,0x98,0x80,0]),out=m.alloc(32);
  assert.equal(call('MultiByteToWideChar',65001,8,src,-1,0,0),5);assert.equal(call('MultiByteToWideChar',65001,8,src,8,out,16),4);assert.equal(m.decode(m.bytes(out,8),true),'\ufeffA😀');
  assert.equal(call('WideCharToMultiByte',65001,128,out,4,0,0,0,0),8);const back=m.alloc(16);assert.equal(call('WideCharToMultiByte',65001,128,out,4,back,16,0,0),8);assert.deepEqual([...m.bytes(back,8)],[0xef,0xbb,0xbf,65,240,159,152,128]);
});
test('UTF-8 strict errors and insufficient buffers leave output untouched',t=>{
  const {w,m,call}=setup(t),src=bytes(m,[0xc0,0xaf]),out=m.alloc(16);m.bytes(out,16).fill(17);
  assert.equal(call('MultiByteToWideChar',65001,8,src,2,out,8),0);assert.equal(w.lastError,1113);assert.deepEqual([...m.bytes(out,16)],Array(16).fill(17));
  assert.equal(call('MultiByteToWideChar',65001,1,src,2,out,8),0);assert.equal(w.lastError,1004);
  const text=m.allocString('hello',true);assert.equal(call('WideCharToMultiByte',65001,0,text,-1,out,1,0,0),0);assert.equal(w.lastError,122);assert.equal(call('WideCharToMultiByte',65001,0,text,-1,out,16,out,0),0);assert.equal(w.lastError,87);
  assert.equal(call('MultiByteToWideChar',65001,0,src,0,out,8),0);assert.equal(w.lastError,87);
});
test('ANSI conversion reports default substitution and composite characters',t=>{
  const {w,m,call}=setup(t),src=m.allocString('é € Ж',true),out=m.alloc(32),used=u32(m,0),replacement=bytes(m,[33]);
  assert.equal(call('GetACP'),1252);assert.equal(call('IsValidCodePage',65001),1);assert.equal(call('IsValidCodePage',932),0);
  assert.equal(call('WideCharToMultiByte',1252,1024,src,-1,out,32,replacement,used),6);assert.equal(m.string(out),'é € !');assert.equal(m.readU32(used),1);
  const accented=bytes(m,[233]);assert.equal(call('MultiByteToWideChar',1252,2,accented,1,out,16),2);assert.equal(m.decode(m.bytes(out,4),true),'e\u0301');
  assert.equal(call('MultiByteToWideChar',932,0,accented,1,out,16),0);assert.equal(w.lastError,87);
});
test('conversion handles embedded NUL, malformed UTF-16 and overlaps',t=>{
  const {w,m,call}=setup(t),src=bytes(m,[65,0,66]),out=m.alloc(16);assert.equal(call('MultiByteToWideChar',65001,8,src,3,out,8),3);assert.equal(m.decode(m.bytes(out,6),true),'A\0B');
  m.view(out,2).setUint16(0,0xd800,true);assert.equal(call('WideCharToMultiByte',65001,128,out,1,src,3,0,0),0);assert.equal(w.lastError,1113);
  assert.equal(call('MultiByteToWideChar',65001,0,src,3,src,1),0);assert.equal(w.lastError,87);
});
test('GUID conversion has Windows mixed endian layout and HRESULT semantics',t=>{
  const {w,m}=setup(t),api=(name,...args)=>w.invoke('ole32',name,args),guid=m.alloc(16),out=m.alloc(78),input=m.allocString('{00112233-4455-6677-8899-aabbccddeeff}',true);
  w.lastError=123;assert.equal(api('CLSIDFromString',input,guid),0);assert.deepEqual([...m.bytes(guid,16)],[51,34,17,0,85,68,119,102,136,153,170,187,204,221,238,255]);
  assert.equal(api('StringFromGUID2',guid,out,39),39);assert.equal(m.string(out,true),'{00112233-4455-6677-8899-AABBCCDDEEFF}');assert.equal(w.lastError,123);
  assert.equal(api('StringFromGUID2',guid,out,38),0);assert.equal(api('CLSIDFromString',m.allocString('not-a-guid',true),guid),0x800401f3);
  assert.equal(api('CLSIDFromString',0,guid),0);assert.deepEqual([...m.bytes(guid,16)],Array(16).fill(0));
});
test('GUID generation requires secure crypto and sets version and variant',t=>{
  const {w,m}=setup(t,{crypto:{getRandomValues:a=>{a.fill(255);return a;}}}),p=m.alloc(16);assert.equal(w.invoke('ole32','CoCreateGuid',[p]),0);assert.equal(m.bytes(p,16)[7],0x4f);assert.equal(m.bytes(p,16)[8],0xbf);
  w.options.crypto={};m.bytes(p,16).fill(12);assert.equal(w.invoke('ole32','CoCreateGuid',[p]),0x80004005);assert.deepEqual([...m.bytes(p,16)],Array(16).fill(12));
});
test('GetFileSizeEx and FlushFileBuffers validate handles and write access',async t=>{
  let calls=0;const {w,m,call}=setup(t);w.fs.writeBytes('/file',[1,2,3]);w.fs.flush=()=>{calls++;return Promise.resolve();};const handle=call('CreateFileA','/file',0xc0000000,3,0,3,128,0),out=m.alloc(8);
  assert.equal(call('GetFileSizeEx',handle,out),1);assert.equal(m.view(out,8).getBigInt64(0,true),3n);assert.equal(await call('FlushFileBuffers',handle),1);assert.equal(calls,1);assert.equal(call('CloseHandle',handle),1);assert.equal(call('GetFileSizeEx',handle,out),0);assert.equal(w.lastError,6);
});
test('named synchronization objects retain state, references and type identity',t=>{
  const {w,call}=setup(t),a=call('CreateEventA',0,0,0,'event'),b=call('CreateEventW',0,1,1,'event');assert.notEqual(a,b);assert.equal(w.lastError,183);assert.equal(call('WaitForSingleObject',b,0),258);
  assert.equal(call('CreateSemaphoreA',0,0,1,'event'),0);assert.equal(w.lastError,6);assert.equal(call('SetEvent',a),1);assert.equal(call('WaitForSingleObject',b,0),0);assert.equal(call('WaitForSingleObject',a,0),258);
  assert.equal(call('CloseHandle',a),1);assert.equal(call('SetEvent',b),1);assert.equal(call('CloseHandle',b),1);assert.equal(call('OpenEventA',C.SYNCHRONIZE,0,'event'),0);assert.equal(w.lastError,2);
});
test('auto-reset events release one waiter and manual-reset events release all',async t=>{
  const {call}=setup(t);for(const manual of [0,1]){const e=call('CreateEventA',0,manual,0,0),a=call('WaitForSingleObject',e,1000),b=call('WaitForSingleObject',e,1000);assert.equal(typeof a.then,'function');call('SetEvent',e);assert.equal(await a,0);if(!manual)call('SetEvent',e);assert.equal(await b,0);assert.equal(call('WaitForSingleObject',e,0),manual?0:258);call('ResetEvent',e);assert.equal(call('WaitForSingleObject',e,0),258);call('CloseHandle',e);}
});
test('wait-all does not partially consume event or semaphore',t=>{
  const {m,call}=setup(t),event=call('CreateEventA',0,0,1,0),sem=call('CreateSemaphoreA',0,0,2,0),handles=list(m,[event,sem]);
  assert.equal(call('WaitForMultipleObjects',2,handles,1,0),258);assert.equal(call('WaitForSingleObject',event,0),0);call('SetEvent',event);call('ReleaseSemaphore',sem,1,0);assert.equal(call('WaitForMultipleObjects',2,handles,1,0),0);assert.equal(call('WaitForSingleObject',event,0),258);assert.equal(call('WaitForSingleObject',sem,0),258);
});
test('wait-any chooses lowest index, semaphores enforce max and access rights',t=>{
  const {w,m,call}=setup(t),first=call('CreateSemaphoreA',0,1,2,'semaphore'),second=call('CreateEventA',0,1,1,0),handles=list(m,[first,second]),previous=u32(m,55);
  assert.equal(call('WaitForMultipleObjects',2,handles,0,0),0);assert.equal(call('WaitForMultipleObjects',2,handles,0,0),1);assert.equal(call('ReleaseSemaphore',first,3,previous),0);assert.equal(w.lastError,298);assert.equal(m.readU32(previous),55);
  assert.equal(call('ReleaseSemaphore',first,2,previous),1);assert.equal(m.readU32(previous),0);const read=call('OpenSemaphoreW',C.SYNCHRONIZE,0,'semaphore');assert.equal(call('ReleaseSemaphore',read,1,0),0);assert.equal(w.lastError,5);assert.equal(call('WaitForSingleObject',read,0),0);
});
test('timeouts, closing waited handles and disposal settle without dangling waits',async t=>{
  const {w,call}=setup(t),e=call('CreateEventA',0,0,0,0);assert.equal(await call('WaitForSingleObject',e,2),258);
  const closing=call('WaitForSingleObject',e,C.INFINITE);call('CloseHandle',e);assert.equal(await closing,0xffffffff);assert.equal(w.lastError,6);
  const other=call('CreateEventA',0,0,0,0),disposed=call('WaitForSingleObject',other,C.INFINITE);w.dispose();assert.equal(await disposed,0xffffffff);assert.equal(w.lastError,995);assert.equal(w.memory.used,0);
});
test('invalid duplicate waits, object quotas and security descriptors fail explicitly',t=>{
  const {w,m,call}=setup(t,{maxPendingWaits:1}),e=call('CreateEventA',0,0,0,0),handles=list(m,[e,e]);
  assert.equal(call('WaitForMultipleObjects',2,handles,1,0),0xffffffff);assert.equal(w.lastError,87);assert.equal(call('WaitForMultipleObjects',0,handles,0,0),0xffffffff);
  const first=call('WaitForSingleObject',e,C.INFINITE);assert.equal(call('WaitForSingleObject',e,1),0xffffffff);assert.equal(w.lastError,8);call('SetEvent',e);assert.ok(first.then);
  assert.equal(call('CreateEventA',1,0,0,0),0);assert.equal(w.lastError,50);assert.equal(call('CreateSemaphoreA',0,3,2,0),0);
});
test('integer atoms, empty callbacks, window destruction and property quota',async t=>{
  const {w,m,call}=setup(t,{maxWindowProperties:1}),window=w.registerWindow({}),out=m.alloc(32);assert.equal(call('GlobalAddAtomA','#123'),123);assert.equal(call('GlobalGetAtomNameA',123,out,32),4);assert.equal(m.string(out),'#123');
  assert.equal(w.invoke('user32','SetPropA',[window,'tag',1]),1);assert.equal(w.invoke('user32','SetPropA',[window,'tag',2]),1);assert.equal(w.invoke('user32','SetPropA',[window,'other',3]),0);assert.equal(w.lastError,8);
  w.unregisterWindow(window);assert.equal(call('GlobalFindAtomA','tag'),0);assert.equal(w.invoke('user32','GetPropA',[window,'tag']),0);assert.equal(w.lastError,1400);
});

test('registry key enumeration retains original key casing through both entry points',t=>{
  const {w,m}=setup(t),key=u32(m,0),out=m.alloc(128),size=u32(m,64),api=(name,...args)=>w.invoke('advapi32',name,args);
  assert.equal(api('RegCreateKeyExW',0x80000001,'Software\\MixedCase',0,0,0,0xf003f,0,key,0),0);api('RegCloseKey',m.readU32(key));
  assert.equal(api('RegOpenKeyExW',0x80000001,'software',0,0x20019,key),0);const handle=m.readU32(key);
  assert.equal(api('RegEnumKeyW',handle,0,out,64),0);assert.equal(m.string(out,true),'MixedCase');
  assert.equal(api('RegEnumKeyExW',handle,0,out,size,0,0,0,0),0);assert.equal(m.string(out,true),'MixedCase');
});
test('Base64 validation handles large input linearly without regexp recursion',t=>{
  const {w,m}=setup(t),input=m.allocString('QUJD'.repeat(32768)),out=m.alloc(98304),size=u32(m,98304);
  assert.equal(w.invoke('crypt32','CryptStringToBinaryA',[input,131072,1,out,size,0,0]),1);
  assert.deepEqual([...m.bytes(out,3)],[65,66,67]);assert.equal(m.readU32(size),98304);
});


test('ANSI conversion substitutes per UTF-16 unit without losing following text',t=>{
  const {w,m,call}=setup(t),out=m.alloc(64),used=u32(m,0),replacement=bytes(m,[33]);
  for(const [text,expected]of [['A😀é',[65,33,33,233]],['\ud800A\udc00',[33,65,33]],['😀😀',[33,33,33,33]]]){
    const source=m.allocString(text,true);
    assert.equal(call('WideCharToMultiByte',1252,1024,source,text.length,0,0,replacement,used),expected.length);
    assert.equal(m.readU32(used),1);
    assert.equal(call('WideCharToMultiByte',1252,1024,source,text.length,out,64,replacement,used),expected.length);
    assert.deepEqual([...m.bytes(out,expected.length)],expected);
    m.bytes(out,64).fill(17);m.writeU32(used,55);
    assert.equal(call('WideCharToMultiByte',1252,1024,source,text.length,out,expected.length-1,replacement,used),0);
    assert.equal(w.lastError,122);assert.deepEqual([...m.bytes(out,64)],Array(64).fill(17));assert.equal(m.readU32(used),55);
  }
});
test('Windows-1252 NLS roundtrip preserves all 256 code units without substitution',t=>{
  const {m,call}=setup(t),input=bytes(m,Array.from({length:256},(_,i)=>i)),wide=m.alloc(512),output=m.alloc(256),used=u32(m,99);
  assert.equal(call('MultiByteToWideChar',1252,0,input,256,wide,256),256);
  assert.equal(call('WideCharToMultiByte',1252,1024,wide,256,output,256,0,used),256);
  assert.deepEqual([...m.bytes(output,256)],[...m.bytes(input,256)]);assert.equal(m.readU32(used),0);
});
for(const wide of [false,true])test('Base64 '+(wide?'W':'A')+' rejects empty and NULL inputs without changing caller buffers',t=>{
  const {w,m}=setup(t),api=(...args)=>w.invoke('crypt32','CryptBinaryToString'+(wide?'W':'A'),args),input=m.alloc(1),output=m.alloc(32*(wide?2:1)),size=u32(m,0);
  for(const flags of [1,0x80000001,0x40000001]){
    m.putString(output,'keep',32,wide);m.writeU32(size,77);
    assert.equal(api(input,0,flags,0,size),0);assert.equal(w.lastError,87);assert.equal(m.readU32(size),77);
    assert.equal(api(input,0,flags,output,size),0);assert.equal(w.lastError,87);assert.equal(m.readU32(size),77);assert.equal(m.string(output,wide),'keep');
  }
  m.putString(output,'keep',32,wide);m.writeU32(size,77);
  assert.equal(api(0,0,1,0,size),0);assert.equal(w.lastError,87);assert.equal(m.readU32(size),77);
  assert.equal(api(0,0,1,output,size),0);assert.equal(w.lastError,87);assert.equal(m.readU32(size),77);assert.equal(m.string(output,wide),'keep');
});
