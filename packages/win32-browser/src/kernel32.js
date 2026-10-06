import {ERROR,Win32Error,integer,unsigned} from './core.js';

export function installKernel32(w){
  const m=w.memory,h=w.handles,fs=w.fs;
  const add=(name,arity,fn,options={})=>w.register('kernel32',name,fn,{arity,...options});
  const aw=(name,arity,fn,options={})=>{for(const wide of [false,true])add(name+(wide?'W':'A'),arity,(...args)=>fn(wide,...args),options);};
  const text=(p,wide)=>m.string(p,wide);
  add('GetLastError',0,()=>w.lastError);
  add('SetLastError',1,n=>{w.lastError=unsigned(n);});
  add('GetTickCount',0,()=>Math.floor(w.clock()-w.epoch)>>>0,{mode:'browser',notes:'Elapsed milliseconds since this compatibility process was created, not host OS boot.'});
  add('GetTickCount64',0,()=>Math.floor(w.clock()-w.epoch),{mode:'browser',notes:'JavaScript number; exact within the safe integer range.'});
  add('QueryPerformanceFrequency',1,p=>{m.view(p,8).setBigInt64(0,1000000n,true);return 1;});
  add('QueryPerformanceCounter',1,p=>{m.view(p,8).setBigInt64(0,BigInt(Math.floor((w.clock()-w.epoch)*1000)),true);return 1;},{mode:'browser',notes:'Microsecond units; precision is limited by browser timer policy.'});
  add('Sleep',1,ms=>w.sleep(unsigned(ms)),{mode:'browser',notes:'Asynchronous cooperative delay; does not block the UI thread.'});
  add('MulDiv',3,(a,b,c)=>{a=integer(a,-2147483648,2147483647);b=integer(b,-2147483648,2147483647);c=integer(c,-2147483648,2147483647);if(!c)return -1;let v=BigInt(a)*BigInt(b),d=BigInt(c),sign=(v<0n)!==(d<0n)?-1n:1n;v=v<0n?-v:v;d=d<0n?-d:d;const n=sign*((v+d/2n)/d);return n < -2147483648n||n>2147483647n?-1:Number(n);},{failure:-1});
  for(const utc of [false,true])add(utc?'GetSystemTime':'GetLocalTime',1,p=>{const d=w.now(),prefix=utc?'getUTC':'get',v=m.view(p,16),values=[d[prefix+'FullYear'](),d[prefix+'Month']()+1,d[prefix+'Day'](),d[prefix+'Date'](),d[prefix+'Hours'](),d[prefix+'Minutes'](),d[prefix+'Seconds'](),d[prefix+'Milliseconds']()];values.forEach((n,i)=>v.setUint16(i*2,n,true));});
  add('GetSystemTimeAsFileTime',1,p=>m.view(p,8).setBigUint64(0,(BigInt(w.now().getTime())+11644473600000n)*10000n,true));
  for(const name of ['RtlMoveMemory','CopyMemory','MoveMemory'])add(name,3,(dst,src,n)=>{n=integer(n,0,m.maxBytes);if(n)m.bytes(dst,n).set(m.bytes(src,n).slice());});
  for(const name of ['RtlZeroMemory','ZeroMemory'])add(name,2,(dst,n)=>{if(n)m.bytes(dst,integer(n,0,m.maxBytes)).fill(0);});
  for(const name of ['RtlFillMemory','FillMemory'])add(name,3,(dst,n,value)=>{if(n)m.bytes(dst,integer(n,0,m.maxBytes)).fill(unsigned(value)&255);});
  for(const prefix of ['Global','Local']){
    add(prefix+'Alloc',2,(flags,n)=>{flags=unsigned(flags);if(flags&~0x42)throw new Win32Error('Unsupported allocation flags',50);const ptr=m.alloc(n),value={ptr,locks:0,prefix};if(!(flags&2))return ptr;try{return h.add('memory',value);}catch(error){m.free(ptr);throw error;}});
    add(prefix+'Lock',1,handle=>{if(h.has(handle,'memory')){const a=h.get(handle,'memory');a.locks++;return a.ptr;}m.block(handle);return unsigned(handle);});
    add(prefix+'Unlock',1,handle=>{if(!h.has(handle,'memory')){m.block(handle);w.lastError=0;return 0;}const a=h.get(handle,'memory');if(!a.locks){w.lastError=158;return 0;}a.locks--;w.lastError=0;return a.locks?1:0;});
    add(prefix+'Size',1,handle=>m.size(h.has(handle,'memory')?h.get(handle,'memory').ptr:handle));
    add(prefix+'Free',1,handle=>{if(!handle)return 0;const a=h.has(handle,'memory')?h.get(handle,'memory'):null;if(a?.clipboard){w.lastError=5;return handle;}if(a&&a.locks){w.lastError=158;return handle;}if(['gdi-bitmap','co-task-memory'].includes(m.block(a?a.ptr:handle).owner)){w.lastError=5;return handle;}m.free(a?a.ptr:handle);if(a)h.close(handle,'memory');return 0;},{failure:args=>args[0]});
  }
  aw('lstrlen',1,(wide,p)=>m.stringBytes(text(p,wide),wide).length/(wide?2:1));
  aw('lstrcpyn',3,(wide,dst,src,n)=>{m.putString(dst,text(src,wide),n,wide);return dst;});
  aw('lstrcpy',2,(wide,dst,src)=>{const s=text(src,wide);m.putString(dst,s,m.stringBytes(s,wide).length/(wide?2:1)+1,wide);return dst;});
  const envName=p=>text(p,false).toUpperCase();
  aw('GetEnvironmentVariable',3,(wide,name,out,size)=>{const key=text(name,wide).toUpperCase();if(!w.environment.has(key)){w.lastError=203;return 0;}const s=w.environment.get(key),n=m.stringBytes(s,wide).length/(wide?2:1);if(unsigned(size)<=n)return n+1;m.putString(out,s,size,wide);return n;});
  aw('SetEnvironmentVariable',2,(wide,name,value)=>{const key=text(name,wide).toUpperCase();if(!key||key.includes('='))throw new Win32Error('Invalid environment variable');if(!value)w.environment.delete(key);else w.environment.set(key,text(value,wide));return 1;});
  aw('GetCurrentDirectory',2,(wide,size,out)=>{const s='C:'+fs.cwd.replace(/\//g,'\\'),n=m.stringBytes(s,wide).length/(wide?2:1);if(unsigned(size)<=n)return n+1;m.putString(out,s,size,wide);return n;});
  aw('SetCurrentDirectory',1,(wide,p)=>{const path=fs.normalize(text(p,wide));if(!fs.directories.has(path))throw new Win32Error('Directory not found',3);fs.cwd=path;return 1;});
  aw('GetTempPath',2,(wide,size,out)=>{const s='C:\\Temp\\';if(unsigned(size)<=s.length)return s.length+1;m.putString(out,s,size,wide);return s.length;},{notes:'Path is in the application-private virtual filesystem.'});
  const openFiles=()=>[...h.entries.values()].filter(e=>e.type==='file').map(e=>e.value);
  const pathOf=(p,wide)=>{const raw=text(p,wide);if(/^(?:\\\\|\/\/)/.test(raw)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.:]|$)/i.test(raw.split(/[\\/]/).at(-1)))throw new Win32Error('Devices and UNC paths are not supported',50);return fs.normalize(raw);};
  const ensureParent=path=>{const parent=path.slice(0,path.lastIndexOf('/'))||'/';if(!fs.directories.has(parent))throw new Win32Error('Parent directory not found',3);};
  const assertMutable=path=>{if(openFiles().some(f=>f.path===path))throw new Win32Error('File is open',32);};
  aw('CreateFile',7,(wide,p,access,share,security,disposition,flags,template)=>{
    const path=pathOf(p,wide);access=unsigned(access);share=unsigned(share);flags=unsigned(flags);integer(disposition,1,5);
    if(security||template||flags&~0x80||share&~3||access&~0xc0000000)throw new Win32Error('Only synchronous ordinary files and read/write sharing are supported',50);
    if(fs.directories.has(path))throw new Win32Error('Cannot open directory as a file',5);ensureParent(path);
    const read=!!(access&0x80000000),write=!!(access&0x40000000),exists=fs.exists(path);
    if(openFiles().some(f=>f.path===path&&((read&&!(f.share&1))||(write&&!(f.share&2))||(f.read&&!(share&1))||(f.write&&!(share&2)))))throw new Win32Error('Sharing violation',32);
    if(disposition===1&&exists)throw new Win32Error('File exists',80);
    if((disposition===3||disposition===5)&&!exists)throw new Win32Error('File not found',2);
    if(disposition===5&&!write)throw new Win32Error('Write access required',5);
    const handle=h.add('file',{path,read,write,share,position:0});
    try{if(!exists||disposition===2||disposition===5)fs.writeBytes(path,[]);}catch(error){h.close(handle,'file');throw error;}
    if(disposition===2||disposition===4)w.lastError=exists?183:0;return handle;
  },{failure:-1,notes:'Synchronous app-private disk. No device paths, native disk, overlapped I/O, or security descriptors.'});
  add('CloseHandle',1,handle=>{h.close(handle,'file');return 1;});
  add('ReadFile',5,(handle,out,n,read,overlapped)=>{if(overlapped)throw new Win32Error('Overlapped I/O is not supported',50);n=integer(n,0,m.maxBytes);const f=h.get(handle,'file');if(!f.read)throw new Win32Error('Read access denied',5);m.writeU32(read,0);if(!n)return 1;const dest=m.bytes(out,n);const b=fs.readBytes(f.path).subarray(f.position,f.position+n);dest.set(b);f.position+=b.length;m.writeU32(read,b.length);return 1;});
  add('WriteFile',5,(handle,input,n,written,overlapped)=>{if(overlapped)throw new Win32Error('Overlapped I/O is not supported',50);n=integer(n,0,m.maxBytes);const f=h.get(handle,'file');if(!f.write)throw new Win32Error('Write access denied',5);m.writeU32(written,0);if(!n)return 1;const src=m.bytes(input,n).slice();const old=fs.readBytes(f.path),end=f.position+n;if(end>w.maxFileBytes)throw new Win32Error('File quota exceeded',8);const b=new Uint8Array(Math.max(old.length,end));b.set(old);b.set(src,f.position);fs.writeBytes(f.path,b);f.position=end;m.writeU32(written,n);return 1;});
  add('GetFileSize',2,(handle,high)=>{const n=fs.readBytes(h.get(handle,'file').path).length;if(high)m.writeU32(high,0);return n;},{failure:0xffffffff});
  add('SetFilePointer',4,(handle,low,high,method)=>{const f=h.get(handle,'file');integer(method,0,2);let offset=BigInt(integer(low,-2147483648,2147483647));if(high)offset=BigInt(m.readI32(high))*0x100000000n+BigInt(unsigned(low));const base=method===0?0:method===1?f.position:fs.readBytes(f.path).length;const next=BigInt(base)+offset;if(next<0||next>BigInt(w.maxFileBytes))throw new Win32Error('Invalid file position');if(high)m.writeU32(high,0);f.position=Number(next);w.lastError=0;return f.position;},{failure:0xffffffff});
  add('SetEndOfFile',1,handle=>{const f=h.get(handle,'file');if(!f.write)throw new Win32Error('Write access denied',5);if(f.position>w.maxFileBytes)throw new Win32Error('File quota exceeded',8);const b=new Uint8Array(f.position);b.set(fs.readBytes(f.path).subarray(0,f.position));fs.writeBytes(f.path,b);return 1;});
  aw('DeleteFile',1,(wide,p)=>{const path=pathOf(p,wide);assertMutable(path);fs.remove(path);return 1;});
  aw('CopyFile',3,(wide,a,b,fail)=>{a=pathOf(a,wide);b=pathOf(b,wide);if(a===b)throw new Win32Error('Source and destination are identical',87);ensureParent(b);if(fail&&fs.exists(b))throw new Win32Error('File exists',80);assertMutable(a);assertMutable(b);fs.writeBytes(b,fs.readBytes(a));return 1;});
  aw('MoveFile',2,(wide,a,b)=>{a=pathOf(a,wide);b=pathOf(b,wide);if(fs.exists(b))throw new Win32Error('File exists',183);ensureParent(b);assertMutable(a);assertMutable(b);const bytes=fs.readBytes(a);fs.writeBytes(b,bytes);fs.remove(a);return 1;});
  aw('GetFileAttributes',1,(wide,p)=>{const path=pathOf(p,wide);if(fs.directories.has(path))return 16;if(fs.exists(path))return 128;throw new Win32Error('File not found',2);},{failure:0xffffffff});
  aw('CreateDirectory',2,(wide,p,security)=>{if(security)throw new Win32Error('Security descriptors are not supported',50);const path=pathOf(p,wide);ensureParent(path);if(fs.exists(path)||fs.directories.has(path))throw new Win32Error('Already exists',183);fs.directories.add(path);fs.dirty=true;return 1;});
  aw('RemoveDirectory',1,(wide,p)=>{const path=pathOf(p,wide);if(!fs.directories.has(path))throw new Win32Error('Directory not found',3);if(path==='/'||path===fs.cwd)throw new Win32Error('Directory in use',5);if([...fs.files.keys(),...fs.directories].some(x=>x.startsWith(path+'/')))throw new Win32Error('Directory not empty',145);fs.directories.delete(path);fs.dirty=true;return 1;});
  installProfiles(w,aw);
  w.register('winmm','timeGetTime',()=>Math.floor(w.clock()-w.epoch)>>>0,{arity:0,mode:'browser',notes:'Process-relative monotonic browser time.'});
}

function installProfiles(w,aw){
  const m=w.memory,fs=w.fs,ci=s=>String(s).trim().toLowerCase();
  function path(p,wide){const s=m.string(p,wide);return fs.normalize(s.includes('\\')||s.includes('/')||s.includes(':')?s:'/Windows/'+s);}
  function read(p,wide){const file=path(p,wide);if(!fs.exists(file)){w.lastError=2;return {file,lines:[],sections:new Map()};}const b=fs.readBytes(file);const str=b[0]===255&&b[1]===254?m.decode(b.subarray(2),true):m.decode(b);const lines=str.replace(/^\uFEFF/,'').split(/\r?\n/),sections=new Map();let current=null;
    lines.forEach((line,i)=>{const s=line.trim(),match=/^\[([^\]]+)\]/.exec(s);if(match){const key=ci(match[1]);if(!sections.has(key))sections.set(key,{name:match[1],start:i,keys:new Map()});current=sections.get(key);}else if(current&&s&&!/^[;#]/.test(s)){const eq=s.indexOf('=');if(eq>=0){const name=s.slice(0,eq).trim(),key=ci(name);if(!current.keys.has(key))current.keys.set(key,{name,value:s.slice(eq+1).trim(),line:i});}}});return {file,lines,sections};}
  aw('GetPrivateProfileString',6,(wide,app,key,def,out,n,file)=>{const doc=read(file,wide),section=doc.sections.get(ci(m.string(app,wide)));if(!app||!key){const names=!app?[...doc.sections.values()].map(s=>s.name):[...(section?.keys.values()||[])].map(k=>k.name);const value=names.length?names.join('\0')+'\0':'';return m.putString(out,value,n,wide,true);}const entry=section?.keys.get(ci(m.string(key,wide)));let value=entry?.value??m.string(def,wide).replace(/ +$/,'');if(entry&&value.length>=2&&(['"',"'"].includes(value[0]))&&value.at(-1)===value[0])value=value.slice(1,-1);return m.putString(out,value,n,wide);});
  aw('GetPrivateProfileInt',4,(wide,app,key,def,file)=>{const doc=read(file,wide),entry=doc.sections.get(ci(m.string(app,wide)))?.keys.get(ci(m.string(key,wide)));if(!entry)return unsigned(def);const n=parseInt(entry.value,10);return (Number.isNaN(n)?0:n)>>>0;});
  aw('WritePrivateProfileString',4,(wide,app,key,value,file)=>{if(!app&&!key&&!value)return 1;if(!app)throw new Win32Error('Section required');const doc=read(file,wide),name=m.string(app,wide),k=m.string(key,wide),s=doc.sections.get(ci(name)),entry=s?.keys.get(ci(k));if(/[\r\n\[\]]/.test(name)||/[\r\n=]/.test(k)||/[\r\n]/.test(m.string(value,wide)))throw new Win32Error('Invalid INI field');
    let lines=doc.lines;if(!key){if(s){let end=lines.length;for(let i=s.start+1;i<lines.length;i++)if(/^\s*\[/.test(lines[i])){end=i;break;}lines.splice(s.start,end-s.start);}}
    else if(!value){if(entry)lines.splice(entry.line,1);}
    else if(entry)lines[entry.line]=entry.name+'='+m.string(value,wide);
    else if(s){let end=lines.length;for(let i=s.start+1;i<lines.length;i++)if(/^\s*\[/.test(lines[i])){end=i;break;}lines.splice(end,0,k+'='+m.string(value,wide));}
    else lines.push('['+name+']',k+'='+m.string(value,wide));
    const str=lines.join('\r\n');const old=fs.exists(doc.file)?fs.readBytes(doc.file):[];const unicode=old[0]===255&&old[1]===254;const b=m.stringBytes(str,unicode);if(unicode){const bytes=new Uint8Array(b.length+2);bytes.set([255,254]);bytes.set(b,2);fs.writeBytes(doc.file,bytes);}else fs.writeBytes(doc.file,b);return 1;
  },{notes:'Project-private INI files. Preserves unrelated lines; does not implement Windows registry IniFileMapping.'});
}
