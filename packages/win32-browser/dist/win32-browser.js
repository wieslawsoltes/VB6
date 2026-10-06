/* VB6 Studio Web 0.5.0 - MIT. Generated from modular sources. */
(()=>{'use strict';
const __modules=[];

/* core.js */
__modules[0]=(()=>{

/** MIT. A bounded, process-private 32-bit address and handle space. */
const ERROR = Object.freeze({SUCCESS:0,FILE_NOT_FOUND:2,PATH_NOT_FOUND:3,ACCESS_DENIED:5,INVALID_HANDLE:6,NOT_ENOUGH_MEMORY:8,INVALID_DATA:13,SHARING_VIOLATION:32,NOT_SUPPORTED:50,FILE_EXISTS:80,INVALID_PARAMETER:87,INSUFFICIENT_BUFFER:122,MOD_NOT_FOUND:126,PROC_NOT_FOUND:127,DIR_NOT_EMPTY:145,ALREADY_EXISTS:183,ENVVAR_NOT_FOUND:203,MORE_DATA:234,NO_MORE_ITEMS:259,OPERATION_ABORTED:995,INVALID_WINDOW_HANDLE:1400});
class Win32Error extends Error {
  constructor(message,code=ERROR.INVALID_PARAMETER){super(message);this.name='Win32Error';this.code=code;}
}
function integer(value,min=0,max=0xffffffff){value=Number(value);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Win32Error('Invalid integer argument');return value;}
function unsigned(value){return integer(value,-0x80000000,0xffffffff)>>>0;}
class Handles {
  constructor(limit=16384){this.limit=limit;this.next=0x40000000;this.entries=new Map();}
  add(type,value){if(this.entries.size>=this.limit||this.next>=0x7fffffff)throw new Win32Error('Handle quota exceeded',8);const h=this.next++;this.entries.set(h,{type,value});return h;}
  get(handle,type){const e=this.entries.get(Number(handle));if(!e||type&&e.type!==type)throw new Win32Error('Invalid '+(type||'object')+' handle',6);return e.value;}
  has(handle,type){const e=this.entries.get(Number(handle));return !!e&&(!type||e.type===type);}
  close(handle,type){const value=this.get(handle,type);this.entries.delete(Number(handle));return value;}
}
// Explicit CP1252 table: some Node/ICU builds alias this label to ISO-8859-1.
const extended=[0x20ac,0x81,0x201a,0x192,0x201e,0x2026,0x2020,0x2021,0x2c6,0x2030,0x160,0x2039,0x152,0x8d,0x17d,0x8f,0x90,0x2018,0x2019,0x201c,0x201d,0x2022,0x2013,0x2014,0x2dc,0x2122,0x161,0x203a,0x153,0x9d,0x17e,0x178];
const ansiChars=Array.from({length:256},(_,i)=>String.fromCharCode(i>=128&&i<160?extended[i-128]:i));
const ansiCodes=new Map(ansiChars.map((c,i)=>[c,i]));
function encodeANSI(text){return Uint8Array.from(String(text),c=>ansiCodes.get(c)??63);}
function decodeANSI(bytes){let result='';for(let offset=0;offset<bytes.length;offset+=8192)result+=Array.from(bytes.subarray(offset,offset+8192),n=>ansiChars[n]).join('');return result;}
class Memory {
  constructor({maxBytes=32*1024*1024,ansi={encode:encodeANSI,decode:decodeANSI}}={}){this.maxBytes=integer(maxBytes,1,0x20000000);this.ansi=ansi;this.blocks=[];this.freeBlocks=[];this.next=0x10000;this.used=0;}
  alloc(size){size=Math.max(1,integer(size,0,this.maxBytes));if(this.used+size>this.maxBytes)throw new Win32Error('Memory quota exceeded',8);const span=Math.ceil(size/16)*16;let ptr,slot=this.freeBlocks.findIndex(b=>b.span>=span);if(slot>=0){const b=this.freeBlocks[slot];ptr=b.ptr;b.ptr+=span;b.span-=span;if(!b.span)this.freeBlocks.splice(slot,1);}else{if(this.next+span>=0x40000000)throw new Win32Error('Virtual address space exhausted',8);ptr=this.next;this.next+=span;}const block={ptr,size,span,bytes:new Uint8Array(size)};let lo=0,hi=this.blocks.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.blocks[mid].ptr<ptr)lo=mid+1;else hi=mid;}this.blocks.splice(lo,0,block);this.used+=size;return ptr;}
  block(pointer,length=1){const p=unsigned(pointer),n=integer(length,0,this.maxBytes);let lo=0,hi=this.blocks.length;while(lo<hi){const mid=(lo+hi)>>>1;if(this.blocks[mid].ptr<=p)lo=mid+1;else hi=mid;}const b=this.blocks[lo-1];if(!b||p<b.ptr||p-b.ptr+n>b.size)throw new Win32Error('Pointer is outside an allocated buffer',87);return b;}
  bytes(pointer,length){const b=this.block(pointer,length);return b.bytes.subarray(unsigned(pointer)-b.ptr,unsigned(pointer)-b.ptr+length);}
  view(pointer,length){const b=this.bytes(pointer,length);return new DataView(b.buffer,b.byteOffset,b.byteLength);}
  size(pointer){const b=this.block(pointer,0);return b.size-(unsigned(pointer)-b.ptr);}
  free(pointer){const i=this.blocks.findIndex(b=>b.ptr===unsigned(pointer));if(i<0)throw new Win32Error('Invalid allocation base',6);const [b]=this.blocks.splice(i,1);b.bytes.fill(0);this.used-=b.size;this.freeBlocks.push({ptr:b.ptr,span:b.span});this.freeBlocks.sort((a,b)=>a.ptr-b.ptr);for(let j=this.freeBlocks.length-1;j>0;j--){const a=this.freeBlocks[j-1],v=this.freeBlocks[j];if(a.ptr+a.span===v.ptr){a.span+=v.span;this.freeBlocks.splice(j,1);}}}
  readU32(p){return this.view(p,4).getUint32(0,true);}
  writeU32(p,n){this.view(p,4).setUint32(0,unsigned(n),true);}
  readI32(p){return this.view(p,4).getInt32(0,true);}
  writeI32(p,n){this.view(p,4).setInt32(0,Number(n),true);}
  stringBytes(text,wide=false){if(!wide)return this.ansi.encode(String(text));const s=String(text),b=new Uint8Array(s.length*2),v=new DataView(b.buffer);for(let i=0;i<s.length;i++)v.setUint16(i*2,s.charCodeAt(i),true);return b;}
  decode(bytes,wide=false){if(!wide)return this.ansi.decode(bytes);let s='';for(let i=0;i+1<bytes.length;i+=2)s+=String.fromCharCode(bytes[i]|bytes[i+1]<<8);return s;}
  string(pointer,wide=false){if(typeof pointer==='string')return pointer.split('\0')[0];if(!pointer)return '';const b=this.block(pointer),offset=unsigned(pointer)-b.ptr,step=wide?2:1;let end=offset;for(;end+step<=b.size;end+=step)if(!b.bytes[end]&&(!wide||!b.bytes[end+1]))return this.decode(b.bytes.subarray(offset,end),wide);throw new Win32Error('Unterminated string');}
  putString(pointer,text,capacity,wide=false,multi=false){
    const step=wide?2:1;capacity=integer(capacity,0,Math.floor(this.maxBytes/step));if(!capacity)return 0;
    const out=this.bytes(pointer,capacity*step),source=this.stringBytes(text,wide),units=source.length/step;
    // Enumeration source includes each entry's NUL; append the final NUL. On
    // truncation Win32 requires two terminators and returns capacity minus two.
    const terminators=multi&&units+1>capacity?Math.min(2,capacity):1;
    const n=Math.min(units,capacity-terminators);out.set(source.subarray(0,n*step));out.fill(0,n*step,(n+terminators)*step);
    if(multi&&!units&&capacity>1)out.fill(0,0,2*step);return n;
  }
  allocString(text,wide=false){const bytes=this.stringBytes(text,wide),p=this.alloc(bytes.length+(wide?2:1));this.bytes(p,bytes.length).set(bytes);return p;}
  clear(){for(const b of this.blocks)b.bytes.fill(0);this.blocks=[];this.freeBlocks=[];this.used=0;this.next=0x10000;}
}
/** Case-insensitive, app-private in-memory disk. Embedders can supply a disk adapter. */
class MemoryFileSystem {
  constructor(){this.files=new Map();this.directories=new Set(['/']);this.cwd='/';}
  normalize(path){const raw=String(path).replace(/\\/g,'/').replace(/^[a-z]:/i,'');const parts=[];for(const p of ((raw.startsWith('/')?'':this.cwd+'/')+raw).split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return ('/'+parts.join('/')).toLowerCase();}
  exists(p){return this.files.has(this.normalize(p));}
  readBytes(p){const b=this.files.get(this.normalize(p));if(!b)throw new Win32Error('File not found',2);return b.slice();}
  writeBytes(p,bytes){this.files.set(this.normalize(p),Uint8Array.from(bytes));}
  remove(p){if(!this.files.delete(this.normalize(p)))throw new Win32Error('File not found',2);}
  read(p){return decodeANSI(this.readBytes(p));}
  write(p,s){this.writeBytes(p,encodeANSI(s));}
}

return {ERROR,Win32Error,integer,unsigned,Handles,encodeANSI,decodeANSI,Memory,MemoryFileSystem};
})();

/* handle-services.js */
__modules[1]=(()=>{
const {Win32Error,unsigned}=__modules[0];

/** Process-private handle duplication. No OS process or thread authority.
 * https://learn.microsoft.com/windows/win32/api/handleapi/nf-handleapi-duplicatehandle
 * https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
 */
const HANDLE_CONSTANTS=Object.freeze({DUPLICATE_CLOSE_SOURCE:1,DUPLICATE_SAME_ACCESS:2,FILE_TYPE_UNKNOWN:0,FILE_TYPE_DISK:1,FILE_BEGIN:0,FILE_CURRENT:1,FILE_END:2});
function installHandleServices(w){
  const h=w.handles,m=w.memory;
  const add=(name,arity,fn,options={})=>w.register('kernel32',name,fn,{arity,notes:'Current compatibility instance only. File duplicates share the cursor; synchronization duplicates share the object. No OS process access or inheritance.',...options});
  add('GetCurrentProcess',0,()=>-1);
  add('DuplicateHandle',7,(sourceProcess,source,targetProcess,out,access,inherit,options)=>{
    options=unsigned(options);
    // Close-source applies even on an output/access/allocation failure, but only
    // to handles belonging to the explicitly selected compatibility process.
    if(unsigned(sourceProcess)!==0xffffffff)throw new Win32Error('Foreign process handle',6);
    const entry=h.entries.get(Number(source));
    if(!entry||!['file','sync'].includes(entry.type))throw new Win32Error('Unsupported source handle',6);
    try{
      if(options&~3)throw new Win32Error('Unsupported duplicate options');
      if(!targetProcess&&(options&1))return 1;
      if(unsigned(targetProcess)!==0xffffffff)throw new Win32Error('Foreign target process',6);
      if(inherit)throw new Win32Error('Handle inheritance is unavailable',50);
      // Win32's legacy NULL output intentionally leaks. Fail explicitly instead.
      m.view(out,4);
      let value=entry.value;
      if(!(options&2)){
        access=unsigned(access);
        if(entry.type==='sync'){
          if(access&~value.access)throw new Win32Error('Cannot increase granted access',5);
          value={object:value.object,access};
        }else{
          const granted=(value.read?0x80000000:0)|(value.write?0x40000000:0);
          if(access&~granted)throw new Win32Error('Cannot increase granted access',5);
          // Forward only the shared file cursor; permissions remain per handle.
          const original=value;
          value={path:original.path,share:original.share,read:!!(access&0x80000000),write:!!(access&0x40000000),get position(){return original.position;},set position(n){original.position=n;}};
        }
      }
      const duplicate=h.add(entry.type,value);
      if(entry.type==='sync')value.object.refs++;
      m.writeU32(out,duplicate);return 1;
    }finally{
      if(options&1)w.resolve('kernel32','CloseHandle').fn(source);
    }
  });
  add('GetFileType',1,handle=>{h.get(handle,'file');return 1;});
}

return {HANDLE_CONSTANTS,installHandleServices};
})();

/* task-memory.js */
__modules[2]=(()=>{
const {Win32Error,integer}=__modules[0];

/** Owned virtual COM task allocations, not COM activation or native pointers.
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-cotaskmemalloc
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-cotaskmemrealloc
 */
function installTaskMemory(w){
  const m=w.memory;
  const add=(name,arity,fn)=>w.register('ole32',name,fn,{arity,notes:'Owned bounded virtual task memory. NULL free is harmless; failed realloc retains its original allocation. No native COM heap.'});
  const owned=p=>{const b=m.block(p,0);if(b.ptr!==Number(p)||b.owner!=='co-task-memory')throw new Win32Error('Expected a task allocation base',6);return b;};
  const allocate=n=>{n=integer(n,0,m.maxBytes);const p=m.alloc(n);m.block(p).owner='co-task-memory';return p;};
  add('CoTaskMemAlloc',1,allocate);
  add('CoTaskMemFree',1,p=>{if(p){owned(p);m.free(p);}});
  add('CoTaskMemRealloc',2,(p,n)=>{
    n=integer(n,0,m.maxBytes);if(!p)return allocate(n);
    const old=owned(p);if(!n){m.free(p);return 0;}
    // Reserve before modifying/freeing the original; quotas are failure-atomic.
    const next=allocate(n);m.bytes(next,Math.min(n,old.size)).set(old.bytes.subarray(0,n));m.free(p);return next;
  });
}

return {installTaskMemory};
})();

/* services-utils.js */
__modules[3]=(()=>{
const {Win32Error,integer}=__modules[0];

/** Register both Win32 string encodings without bringing in the VB6 runtime. */
function registerAW(w,dll,name,arity,fn,options={}) {
  for (const wide of [false,true]) w.register(dll,name+(wide?'W':'A'),(...args)=>fn(wide,...args),{arity,...options});
}
function units(m,text,wide) { return m.stringBytes(text,wide).length/(wide?2:1); }
function putComplete(m,p,text,capacity,wide=false) {
  capacity=integer(capacity,0,Math.floor(m.maxBytes/(wide?2:1)));
  const length=units(m,text,wide);
  if(capacity<=length) throw new Win32Error('String buffer is too small',122);
  m.bytes(p,capacity*(wide?2:1));
  m.putString(p,text,capacity,wide);
  return length;
}
function rejectOverlap(a,an,b,bn) {
  if(an && bn && Number(a)<Number(b)+bn && Number(b)<Number(a)+an)
    throw new Win32Error('Input and output buffers overlap',87);
}

return {registerAW,units,putComplete,rejectOverlap};
})();

/* user32-properties.js */
__modules[4]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];
const {registerAW,units}=__modules[3];


/** Process-private atom table and registered-window properties.
 * https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-globaladdatoma
 * https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setpropa
 * https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumpropsexa */
function installWindowProperties(w){
  const m=w.memory,h=w.handles,atoms=new Map(),byName=new Map();let next=0xc000;
  const notes='Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API.';
  const aw=(dll,name,arity,fn,options={})=>registerAW(w,dll,name,arity,fn,{notes,...options});
  function parsed(p,wide){
    if(typeof p==='number'&&p<=0xffff){if(p<1||p>=0xc000)throw new Win32Error('Invalid integer atom');return p;}
    const name=m.string(p,wide);if(!name||units(m,name,wide)>255)throw new Win32Error('Atom name length must be 1..255');
    if(/^#\d+$/.test(name))return integer(Number(name.slice(1)),1,0xbfff);return name;
  }
  function find(name){if(typeof name==='number')return name;const id=byName.get(name.toLowerCase());if(!id)throw new Win32Error('Atom not found',2);return id;}
  function retain(name){
    if(typeof name==='number')return name;
    const old=byName.get(name.toLowerCase());if(old){atoms.get(old).refs++;return old;}
    if(atoms.size>=0x4000)throw new Win32Error('Atom table is full',8);
    while(atoms.has(next))next=next===0xffff?0xc000:next+1;
    const id=next;atoms.set(id,{name,refs:1});byName.set(name.toLowerCase(),id);next=next===0xffff?0xc000:next+1;return id;
  }
  function release(id){id=integer(id,1,0xffff);if(id<0xc000)return;const atom=atoms.get(id);if(!atom)throw new Win32Error('Invalid string atom',6);if(--atom.refs===0){atoms.delete(id);byName.delete(atom.name.toLowerCase());}}
  const atomName=id=>{id=integer(id,1,0xffff);if(id<0xc000)return '#'+id;const atom=atoms.get(id);if(!atom)throw new Win32Error('Invalid string atom',6);return atom.name;};
  aw('kernel32','GlobalAddAtom',1,(wide,p)=>retain(parsed(p,wide)));
  aw('kernel32','GlobalFindAtom',1,(wide,p)=>find(parsed(p,wide)));
  aw('kernel32','GlobalGetAtomName',3,(wide,id,out,capacity)=>{capacity=integer(capacity,1,0x7fffffff);return m.putString(out,atomName(id),capacity,wide);});
  w.register('kernel32','GlobalDeleteAtom',id=>{release(id);return 0;},{arity:1,notes});
  const windows=new Map();
  function props(handle){handle=Number(handle);if(!h.has(handle,'window'))throw new Win32Error('Invalid window handle',1400);let map=windows.get(handle);if(!map)windows.set(handle,map=new Map());return map;}
  function propertyName(p,wide){if(typeof p==='number'&&p>0&&p<=0xffff)return p<0xc000?p:atomName(p);return parsed(p,wide);}
  function propertyKey(name){return typeof name==='number'?'#'+name:'s:'+name.toLowerCase();}
  aw('user32','SetProp',3,(wide,handle,p,data)=>{
    const map=props(handle),name=propertyName(p,wide),key=propertyKey(name);data=unsigned(data);
    const old=map.get(key);if(old){old.data=data;return 1;}
    if(map.size>=integer(w.options.maxWindowProperties??1024,1,65536))throw new Win32Error('Window property quota exceeded',8);
    const id=retain(name);map.set(key,{name,id,data,integer:typeof name==='number'});return 1;
  });
  aw('user32','GetProp',2,(wide,handle,p)=>{const map=props(handle);return map.get(propertyKey(propertyName(p,wide)))?.data??0;});
  aw('user32','RemoveProp',2,(wide,handle,p)=>{const map=props(handle),key=propertyKey(propertyName(p,wide)),entry=map.get(key);if(!entry)return 0;map.delete(key);release(entry.id);return entry.data;});
  aw('user32','EnumPropsEx',3,async(wide,handle,callback,data)=>{
    const map=props(handle),fn=h.get(callback,'callback'),snapshot=[...map];let result=-1;
    for(const [key,entry]of snapshot){if(w.disposed||!h.has(handle,'window'))break;if(map.get(key)!==entry)continue;
      let pointer=entry.integer?entry.id:m.allocString(entry.name,wide);
      try{result=Number(await fn(handle,pointer,entry.data,data))|0;if(!result)break;}
      finally{if(!entry.integer&&!w.disposed)m.free(pointer);}
    }return result;
  },{failure:-1});
  w.releaseWindowProperties=handle=>{const map=windows.get(Number(handle));if(map){for(const entry of map.values())release(entry.id);windows.delete(Number(handle));}};
  w.disposeWindowProperties=()=>{windows.clear();atoms.clear();byName.clear();};
}

return {installWindowProperties};
})();

/* crypt32-codec.js */
__modules[5]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];
const {registerAW,putComplete}=__modules[3];


const CRYPT_CONSTANTS=Object.freeze({CRYPT_STRING_BASE64:1,CRYPT_STRING_NOCRLF:0x40000000,CRYPT_STRING_NOCR:0x80000000,CRYPT_STRING_STRICT:0x20000000});
/** Base64 serialization, NOT encryption or certificate validation.
 * https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptbinarytostringa
 * https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptstringtobinarya */
function installBinaryCodec(w){
  const m=w.memory,alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const aw=(name,arity,fn)=>registerAW(w,'crypt32',name,arity,fn,{notes:'Raw Base64 only. Supports size queries, CRLF/LF/no-wrap, strict validation and explicit byte counts. No certificate or encryption APIs.'});
  aw('CryptBinaryToString',5,(wide,input,count,flags,out,size)=>{
    count=integer(count,0,Math.floor(m.maxBytes/2));flags=unsigned(flags);if((flags&0x3fffffff)!==1)throw new Win32Error('Only Base64 encoding is supported',50);
    if(!input||count===0)throw new Win32Error('A nonempty binary input buffer is required');
    const bytes=m.bytes(input,count);let value='';
    for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];value+=alphabet[a>>2]+alphabet[(a&3)<<4|(b??0)>>4]+(b===undefined?'=':alphabet[(b&15)<<2|(c??0)>>6])+(c===undefined?'=':alphabet[c&63]);}
    const eol=flags&0x40000000?'':flags&0x80000000?'\n':'\r\n';if(eol)value=(value.match(/.{1,64}/g)||[]).join(eol)+eol;
    const capacity=m.readU32(size),needed=value.length+1;
    if(!out){m.writeU32(size,needed);return 1;}
    if(capacity<needed){m.writeU32(size,needed);throw new Win32Error('Encoded buffer too small',234);}
    putComplete(m,out,value,capacity,wide);m.writeU32(size,value.length);return 1;
  });
  aw('CryptStringToBinary',7,(wide,input,count,flags,out,size,skip,actual)=>{
    count=integer(count,0,Math.floor(m.maxBytes/(wide?2:1)));flags=unsigned(flags);if((flags&~0x20000000)!==1)throw new Win32Error('Only raw Base64 decoding is supported',50);
    const text=count?m.decode(m.bytes(input,count*(wide?2:1)),wide):m.string(input,wide),value=text.replace(/[\t\r\n ]/g,'');
    // Malformed inputs fail without writing partial binary output. Native legacy
    // permissive trailing-junk variants are deliberately not accepted.
    const end=value.endsWith('==')?value.length-2:value.endsWith('=')?value.length-1:value.length;
    if(value.length%4||end<0)throw new Win32Error('Invalid Base64',13);
    for(let i=0;i<end;i++)if(!alphabet.includes(value[i]))throw new Win32Error('Invalid Base64',13);
    const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,needed=value.length/4*3-padding;
    if(needed>w.maxFileBytes)throw new Win32Error('Decoded data quota exceeded',8);
    const capacity=m.readU32(size);if(skip)m.view(skip,4);if(actual)m.view(actual,4);
    if(out&&capacity<needed){m.writeU32(size,needed);throw new Win32Error('Decoded buffer too small',234);}
    const target=out?m.bytes(out,capacity):null;
    if(target){let offset=0;for(let i=0;i<value.length;i+=4){const n=(alphabet.indexOf(value[i])<<18)|(alphabet.indexOf(value[i+1])<<12)|((alphabet.indexOf(value[i+2])&63)<<6)|(alphabet.indexOf(value[i+3])&63);for(const shift of [16,8,0])if(offset<needed)target[offset++]=(n>>>shift)&255;}}
    m.writeU32(size,needed);if(skip)m.writeU32(skip,0);if(actual)m.writeU32(actual,1);return 1;
  });
}

return {CRYPT_CONSTANTS,installBinaryCodec};
})();

/* ole32-guid.js */
__modules[6]=(()=>{
const {Win32Error,integer}=__modules[0];
const {putComplete}=__modules[3];


/** GUID byte order follows the Win32 GUID structure, not network byte order.
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-clsidfromstring
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-stringfromguid2 */
function installGUID(w){
  const m=w.memory,notes='GUID values only. No COM activation, registry ProgID lookup or native allocation.';
  const add=(name,arity,fn,options={})=>w.register('ole32',name,fn,{arity,notes,...options});
  const format=p=>{const v=m.view(p,16),hex=(n,len)=>n.toString(16).padStart(len,'0');return ('{'+hex(v.getUint32(0,true),8)+'-'+hex(v.getUint16(4,true),4)+'-'+hex(v.getUint16(6,true),4)+'-'+Array.from(m.bytes(p+8,2),n=>hex(n,2)).join('')+'-'+Array.from(m.bytes(p+10,6),n=>hex(n,2)).join('')+'}').toUpperCase();};
  function parse(input,out){
    const target=m.bytes(out,16);if(!input){target.fill(0);return 0;}
    const s=m.string(input,true);if(!/^\{[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\}$/i.test(s))return 0x800401f3;
    const parts=s.slice(1,-1).split('-'),bytes=new Uint8Array(16),v=new DataView(bytes.buffer);
    v.setUint32(0,parseInt(parts[0],16),true);v.setUint16(4,parseInt(parts[1],16),true);v.setUint16(6,parseInt(parts[2],16),true);
    (parts[3]+parts[4]).match(/../g).forEach((pair,i)=>bytes[8+i]=parseInt(pair,16));target.set(bytes);return 0;
  }
  add('CLSIDFromString',2,parse,{failure:0x80070057});
  add('IIDFromString',2,parse,{failure:0x80070057});
  add('StringFromGUID2',3,(guid,out,capacity)=>{capacity=integer(capacity,0,0x7fffffff);const text=format(guid);if(capacity<39)return 0;putComplete(m,out,text,capacity,true);return 39;});
  add('CoCreateGuid',1,out=>{
    const target=m.bytes(out,16),crypto=w.options.crypto??globalThis.crypto;
    if(!crypto?.getRandomValues)throw new Win32Error('Secure random source unavailable',50);
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[7]=(bytes[7]&15)|64;bytes[8]=(bytes[8]&63)|128;target.set(bytes);return 0;
  },{failure:0x80004005,mode:'browser',notes:notes+' Uses Web Crypto random values (version-4 UUID); never Math.random.'});
}

return {installGUID};
})();

/* shlwapi.js */
__modules[7]=(()=>{
const {Win32Error}=__modules[0];
const {registerAW,units,putComplete}=__modules[3];


/** Lexical Windows path helpers. No shell, URL navigation or native filesystem.
 * https://learn.microsoft.com/windows/win32/api/shlwapi/nf-shlwapi-pathcombinea
 * https://learn.microsoft.com/windows/win32/api/shlwapi/nf-shlwapi-pathfindextensiona */
function installPathUtilities(w){
  const m=w.memory,notes='Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access.';
  const aw=(name,arity,fn)=>registerAW(w,'shlwapi',name,arity,fn,{notes});
  const read=(p,wide)=>{const s=m.string(p,wide);if(units(m,s,wide)>=260)throw new Win32Error('Path exceeds MAX_PATH',206);return s;};
  const write=(p,s,wide)=>{if(units(m,s,wide)>=260)throw new Win32Error('Path exceeds MAX_PATH',206);putComplete(m,p,s,Math.min(260,Math.floor(m.size(p)/(wide?2:1))),wide);};
  const filename=s=>Math.max(s.lastIndexOf('\\'),s.lastIndexOf('/'),s.lastIndexOf(':'))+1;
  const extension=s=>{const start=filename(s),dot=s.lastIndexOf('.');return dot>=start?dot:s.length;};
  const root=s=>/^(?:[A-Za-z]:\\|\\|\\\\[^\\]+\\[^\\]+\\?)$/.test(s);
  function canonical(s){
    if(/^\\\\[?.]\\/.test(s))throw new Win32Error('Device namespaces are unsupported',50);
    let prefix='',rest=s;
    const unc=/^(\\\\[^\\]+\\[^\\]+)(?:\\|$)/.exec(s),drive=/^[A-Za-z]:/.exec(s);
    if(unc){prefix=unc[1]+'\\';rest=s.slice(unc[0].length);}else if(drive){prefix=drive[0]+(s[2]==='\\'?'\\':'');rest=s.slice(prefix.length);}else if(s[0]==='\\'){prefix='\\';rest=s.slice(1);}
    const parts=[];for(const item of rest.split('\\')){if(!item||item==='.')continue;if(item==='..'){if(parts.length&&parts.at(-1)!=='..')parts.pop();else if(!prefix.endsWith('\\'))parts.push('..');}else parts.push(item);}
    return prefix+parts.join('\\')||(s?'\\':'');
  }
  aw('PathFindFileName',1,(wide,p)=>Number(p)+units(m,read(p,wide).slice(0,filename(read(p,wide))),wide)*(wide?2:1));
  aw('PathFindExtension',1,(wide,p)=>Number(p)+units(m,read(p,wide).slice(0,extension(read(p,wide))),wide)*(wide?2:1));
  aw('PathRemoveExtension',1,(wide,p)=>{const s=read(p,wide);write(p,s.slice(0,extension(s)),wide);});
  aw('PathRenameExtension',2,(wide,p,ext)=>{const s=read(p,wide),e=read(ext,wide);if(e&&(!e.startsWith('.')||/[\\/:*?]/.test(e)))throw new Win32Error('Invalid extension');write(p,s.slice(0,extension(s))+e,wide);return 1;});
  aw('PathAddBackslash',1,(wide,p)=>{let s=read(p,wide);if(s&&!s.endsWith('\\'))s+='\\';write(p,s,wide);return Number(p)+units(m,s,wide)*(wide?2:1);});
  aw('PathRemoveBackslash',1,(wide,p)=>{let s=read(p,wide);const index=Math.max(0,units(m,s,wide)-1);if(s.endsWith('\\')&&!root(s))s=s.slice(0,-1);write(p,s,wide);return Number(p)+index*(wide?2:1);});
  aw('PathIsRelative',1,(wide,p)=>{const s=read(p,wide);return s.startsWith('\\')||s.length>1&&s[1]===':'?0:1;});
  aw('PathIsRoot',1,(wide,p)=>root(read(p,wide))?1:0);
  aw('PathIsUNC',1,(wide,p)=>read(p,wide).startsWith('\\\\')?1:0);
  aw('PathCanonicalize',2,(wide,out,input)=>{write(out,canonical(read(input,wide)),wide);return 1;});
  aw('PathCombine',3,(wide,out,dir,file)=>{
    if(!dir&&!file)throw new Win32Error('At least one path is required');
    const a=read(dir,wide),b=read(file,wide);let value;
    if(!a||/^[A-Za-z]:|^\\\\/.test(b))value=b;
    else if(b.startsWith('\\')){const match=/^(?:[A-Za-z]:|\\\\[^\\]+\\[^\\]+)/.exec(a);value=(match?.[0]??'')+b;}
    else value=a+(a.endsWith('\\')||!b?'':'\\')+b;
    write(out,canonical(value),wide);return out;
  });
  aw('PathFileExists',1,(wide,p)=>{const s=read(p,wide);if(!s||s.startsWith('\\\\'))return 0;const path=w.fs.normalize(s);return w.fs.exists(path)||w.fs.directories.has(path)?1:0;});
  aw('PathIsDirectory',1,(wide,p)=>{const s=read(p,wide);return s&&!s.startsWith('\\\\')&&w.fs.directories.has(w.fs.normalize(s))?16:0;});
}

return {installPathUtilities};
})();

/* kernel32-files.js */
__modules[8]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];
const {registerAW,units,putComplete}=__modules[3];


/** File discovery in the existing app-private disk, not host disk discovery.
 * WIN32_FIND_DATA has DWORD fields at 0..43, then 260/14 TCHARs.
 * https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-findfirstfilea
 * https://learn.microsoft.com/windows/win32/api/minwinbase/ns-minwinbase-win32_find_dataa */
function installFileUtilities(w) {
  const m=w.memory,h=w.handles,fs=w.fs;
  const notes='Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero.';
  const aw=(name,arity,fn)=>registerAW(w,'kernel32',name,arity,fn,{notes});
  const pathOf=text=>{if(!text)throw new Win32Error('Path is empty',3);if(/^(?:\\\\|\/\/)/.test(text)||/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.:]|$)/i.test(text.split(/[\\/]/).at(-1)))throw new Win32Error('Devices and UNC paths are unsupported',50);return fs.normalize(text);};
  const parent=p=>p.slice(0,p.lastIndexOf('/'))||'/';
  function matches(pattern,name) {
    pattern=pattern.toLowerCase();name=name.toLowerCase();if(pattern==='*.*')pattern='*';
    // Bounded dynamic program, not a backtracking regular expression.
    function glob(p){let row=Array(name.length+1).fill(false);row[0]=true;
      for(const c of p){const next=Array(name.length+1).fill(false);next[0]=c==='*'&&row[0];for(let i=1;i<=name.length;i++)next[i]=c==='*'?(next[i-1]||row[i]):row[i-1]&&(c==='?'||c===name[i-1]);row=next;}return row[name.length];}
    return glob(pattern)||(!name.includes('.')&&pattern.endsWith('.*')&&glob(pattern.slice(0,-2)));
  }
  function writeFind(entry,out,wide){
    const step=wide?2:1,size=wide?592:320,n=units(m,entry.name,wide);
    if(n>=260)throw new Win32Error('Filename exceeds WIN32_FIND_DATA capacity',206);
    const buffer=m.bytes(out,size);buffer.fill(0);const view=m.view(out,size);
    view.setUint32(0,entry.directory?16:128,true);view.setUint32(32,entry.size,true);
    m.putString(out+44,entry.name,260,wide);return 1;
  }
  for(const wide of [false,true]){
    w.register('kernel32','FindFirstFile'+(wide?'W':'A'),(input,out)=>{
      const raw=m.string(input,wide);if(/[\\/]$/.test(raw))throw new Win32Error('Search path has a trailing separator',2);
      const path=pathOf(raw),folder=parent(path),pattern=path.slice(path.lastIndexOf('/')+1);
      if(folder.includes('*')||folder.includes('?'))throw new Win32Error('Wildcards are supported only in the filename',50);
      if(pattern.length>259)throw new Win32Error('Search pattern is too long',206);
      if(!fs.directories.has(folder))throw new Win32Error('Directory not found',3);
      m.bytes(out,wide?592:320);const entries=[],seen=new Set();
      const limit=integer(w.options.maxFindEntries??16384,1,1000000);
      for(const [paths,directory] of [[fs.directories,true],[fs.files.keys(),false]])for(const p of paths){
        if(p===folder||parent(p).toLowerCase()!==folder.toLowerCase()||seen.has(p.toLowerCase()))continue;
        const name=p.slice(p.lastIndexOf('/')+1);if(!matches(pattern,name))continue;
        if(entries.length>=limit)throw new Win32Error('File enumeration quota exceeded',8);
        seen.add(p.toLowerCase());entries.push({name,directory,size:directory?0:fs.readBytes(p).length});
      }
      if(!entries.length)throw new Win32Error('No matching files',2);
      // Validate the first record before reserving a handle, and roll back on error.
      if(units(m,entries[0].name,wide)>=260)throw new Win32Error('Filename is too long',206);
      const handle=h.add('find',{entries,index:0});try{writeFind(entries[0],out,wide);}catch(error){h.close(handle,'find');throw error;}return handle;
    },{arity:2,notes,failure:-1});
    w.register('kernel32','FindNextFile'+(wide?'W':'A'),(handle,out)=>{const state=h.get(handle,'find'),entry=state.entries[state.index+1];if(!entry)throw new Win32Error('No more files',18);writeFind(entry,out,wide);state.index++;return 1;},{arity:2,notes});
  }
  w.register('kernel32','FindClose',handle=>{h.close(handle,'find');return 1;},{arity:1,notes});
  w.register('kernel32','GetFileSizeEx',(handle,out)=>{const file=h.get(handle,'file');m.view(out,8).setBigInt64(0,BigInt(fs.readBytes(file.path).length),true);return 1;},{arity:2,notes});
  w.register('kernel32','FlushFileBuffers',handle=>{const file=h.get(handle,'file');if(!file.write)throw new Win32Error('Write access is required',5);const result=fs.flush?.(file.path);return result?.then?result.then(()=>1):1;},{arity:1,notes:'Writes to the private memory disk are immediate. Calls fs.flush(path) when supplied; no claim of host disk durability.'});
  aw('GetFullPathName',4,(wide,input,capacity,out,filePart)=>{
    const value='C:'+pathOf(m.string(input,wide)).replace(/\//g,'\\'),n=units(m,value,wide);
    capacity=integer(capacity,0,Math.floor(m.maxBytes/(wide?2:1)));if(capacity<=n)return n+1;
    if(filePart)m.view(filePart,4);putComplete(m,out,value,capacity,wide);
    if(filePart){const index=value.lastIndexOf('\\')+1;m.writeU32(filePart,index===value.length?0:Number(out)+units(m,value.slice(0,index),wide)*(wide?2:1));}return n;
  });
  // LARGE_INTEGER by value occupies two 32-bit Declare argument slots.
  // https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-setfilepointerex
  w.register('kernel32','SetFilePointerEx',(handle,low,high,out,method)=>{
    const file=h.get(handle,'file');method=integer(method,0,2);
    const distance=BigInt(integer(high,-0x80000000,0x7fffffff))*0x100000000n+BigInt(unsigned(low));
    const base=method===0?0:method===1?file.position:fs.readBytes(file.path).length;
    const next=BigInt(base)+distance;
    if(next<0n)throw new Win32Error('Negative file position',131);
    if(next>BigInt(Number.MAX_SAFE_INTEGER))throw new Win32Error('File position is not exactly representable');
    if(out)m.view(out,8).setBigInt64(0,next,true);
    file.position=Number(next);return 1;
  },{arity:5,notes:'Split low/high signed LARGE_INTEGER input, 8-byte output. Exact virtual positions up to Number.MAX_SAFE_INTEGER; actual file allocations remain quota-bound.'});
  const attributes=path=>fs.directories.has(path)?16:fs.exists(path)?128:(()=>{throw new Win32Error('File not found',2);})();
  aw('GetFileAttributesEx',3,(wide,input,level,out)=>{
    if(level!==0)throw new Win32Error('Only GetFileExInfoStandard is supported');
    const path=pathOf(m.string(input,wide)),flags=attributes(path),size=flags===16?0:fs.readBytes(path).length;
    const target=m.view(out,36);m.bytes(out,36).fill(0);target.setUint32(0,flags,true);target.setUint32(28,Math.floor(size/0x100000000),true);target.setUint32(32,size>>>0,true);return 1;
  });
  w.register('kernel32','GetFileInformationByHandle',(handle,out)=>{
    const file=h.get(handle,'file'),size=fs.readBytes(file.path).length,target=m.view(out,52);
    m.bytes(out,52).fill(0);target.setUint32(0,128,true);target.setUint32(36,size,true);target.setUint32(40,1,true);return 1;
  },{arity:2,notes:notes+' BY_HANDLE_FILE_INFORMATION has zero timestamps/volume/file identifiers and one link. No host identity is invented.'});
  let sequence=1;
  aw('GetTempFileName',4,(wide,directory,prefix,unique,out)=>{
    const dir=pathOf(m.string(directory,wide));if(!fs.directories.has(dir))throw new Win32Error('Temporary directory not found',3);
    const pre=m.string(prefix,wide).slice(0,3);if(/[\\/:*?<>|]/.test(pre))throw new Win32Error('Invalid temporary prefix');
    unique=unsigned(unique)&65535;let chosen=unique,path;
    for(let attempt=0;attempt<65535;attempt++){
      if(!unique){chosen=sequence;sequence=sequence%65535+1;}
      path=fs.normalize(dir+'/'+pre+chosen.toString(16).toUpperCase().padStart(4,'0')+'.tmp');
      if(unique||!fs.exists(path)&&!fs.directories.has(path))break;path=null;
    }
    if(!path)throw new Win32Error('Temporary name space exhausted',80);
    const value='C:'+path.replace(/\//g,'\\');if(units(m,value,wide)>=260)throw new Win32Error('Temporary path is too long',206);
    m.bytes(out,260*(wide?2:1));if(!unique)fs.writeBytes(path,[]);putComplete(m,out,value,260,wide);return chosen;
  });
}

return {installFileUtilities};
})();

/* kernel32-nls.js */
__modules[9]=(()=>{
const {Win32Error,integer,unsigned,decodeANSI}=__modules[0];
const {registerAW,units,putComplete,rejectOverlap}=__modules[3];


// Reverse the process code page once; WideCharToMultiByte consumes UTF-16 units,
// including one default byte for each half of an unrepresentable surrogate pair.
const ANSI_CODE_UNITS=new Map(Array.from({length:256},(_,value)=>[decodeANSI(Uint8Array.of(value)).charCodeAt(0),value]));

const NLS_CONSTANTS=Object.freeze({CP_ACP:0,CP_UTF8:65001,MB_PRECOMPOSED:1,MB_COMPOSITE:2,MB_ERR_INVALID_CHARS:8,WC_ERR_INVALID_CHARS:128,WC_NO_BEST_FIT_CHARS:1024});
/** Original implementation of documented buffer contracts:
 * https://learn.microsoft.com/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar
 * https://learn.microsoft.com/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte
 * Process ACP is deterministic Windows-1252, not the host OS locale. */
function installNLS(w) {
  const m=w.memory,add=(name,arity,fn)=>w.register('kernel32',name,fn,{arity,notes:'UTF-8 and process Windows-1252 only; bounded buffers, no host locale or best-fit table.'});
  const page=cp=>{cp=unsigned(cp);if(cp===0)cp=1252;if(![1252,65001].includes(cp))throw new Win32Error('Code page is not implemented',87);return cp;};
  const source=(p,count,wide)=>{
    count=integer(count,-1,Math.floor(m.maxBytes/(wide?2:1)));
    if(!p||count===0)throw new Win32Error('A nonempty input buffer is required');
    if(count===-1){const text=m.string(p,wide);count=units(m,text,wide)+1;}
    return m.bytes(p,count*(wide?2:1));
  };
  const output=(p,capacity,bytes,wide)=>{
    capacity=integer(capacity,0,Math.floor(m.maxBytes/(wide?2:1)));
    const length=bytes.length/(wide?2:1);
    if(!capacity)return length;
    if(capacity<length)throw new Win32Error('Conversion buffer is too small',122);
    m.bytes(p,capacity*(wide?2:1)).set(bytes);return length;
  };
  add('GetACP',0,()=>1252);
  add('IsValidCodePage',1,cp=>[1252,65001].includes(unsigned(cp))?1:0);
  add('MultiByteToWideChar',6,(cp,flags,input,count,out,capacity)=>{
    cp=page(cp);flags=unsigned(flags);
    if(cp===65001 ? !!(flags&~8) : !!(flags&~11)||(flags&3)===3)throw new Win32Error('Unsupported conversion flags',1004);
    const bytes=source(input,count,false);let text;
    if(cp===65001){try{text=new TextDecoder('utf-8',{fatal:!!(flags&8),ignoreBOM:true}).decode(bytes);}catch{throw new Win32Error('Invalid UTF-8 sequence',1113);}}
    else {text=decodeANSI(bytes);if(flags&2)text=text.normalize('NFD');}
    const result=m.stringBytes(text,true);rejectOverlap(input,bytes.length,out,Number(capacity)*2);
    return output(out,capacity,result,true);
  });
  add('WideCharToMultiByte',8,(cp,flags,input,count,out,capacity,defaultChar,usedDefault)=>{
    cp=page(cp);flags=unsigned(flags);
    if(cp===65001 ? !!(flags&~128) : !!(flags&~1024))throw new Win32Error('Unsupported conversion flags',1004);
    if(cp===65001&&(defaultChar||usedDefault))throw new Win32Error('UTF-8 does not accept default character parameters');
    const bytes=source(input,count,true),text=m.decode(bytes,true);let result,used=false;
    if(cp===65001){if(flags&128&&!text.isWellFormed())throw new Win32Error('Unpaired UTF-16 surrogate',1113);result=new TextEncoder().encode(text);}
    else {
      const replacement=defaultChar?m.bytes(defaultChar,1)[0]:63;
      if(usedDefault)m.view(usedDefault,4);
      result=new Uint8Array(text.length);
      for(let i=0;i<text.length;i++){const byte=ANSI_CODE_UNITS.get(text.charCodeAt(i));if(byte===undefined){result[i]=replacement;used=true;}else result[i]=byte;}
    }
    rejectOverlap(input,bytes.length,out,Number(capacity));
    const length=output(out,capacity,result,false);if(usedDefault)m.writeU32(usedDefault,used?1:0);return length;
  });
  registerAW(w,'kernel32','ExpandEnvironmentStrings',3,(wide,input,out,size)=>{
    const text=m.string(input,wide).replace(/%([^%]+)%/g,(all,name)=>w.environment.get(name.toUpperCase())??all),needed=units(m,text,wide)+1;
    size=integer(size,0,Math.floor(m.maxBytes/(wide?2:1)));
    if(size>=needed){rejectOverlap(input,typeof input==='number'?m.size(input):0,out,size*(wide?2:1));putComplete(m,out,text,size,wide);}return needed;
  },{notes:'Single-pass expansion of process-private variables; unknown names are preserved. No host environment access.'});
}

return {NLS_CONSTANTS,installNLS};
})();

/* kernel32-sync.js */
__modules[10]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];
const {registerAW}=__modules[3];


const SYNC_CONSTANTS=Object.freeze({WAIT_OBJECT_0:0,WAIT_TIMEOUT:258,WAIT_FAILED:0xffffffff,INFINITE:0xffffffff,MAXIMUM_WAIT_OBJECTS:64,SYNCHRONIZE:0x100000,EVENT_MODIFY_STATE:2,SEMAPHORE_MODIFY_STATE:2,EVENT_ALL_ACCESS:0x1f0003,SEMAPHORE_ALL_ACCESS:0x1f0003});
/** Cooperative process-private event/semaphore waits, never Atomics.wait on the UI.
 * https://learn.microsoft.com/windows/win32/api/synchapi/nf-synchapi-waitformultipleobjects
 * https://learn.microsoft.com/windows/win32/sync/event-objects
 * Names are case-sensitive and shared only by this Win32Browser instance. */
function installSynchronization(w) {
  const m=w.memory,h=w.handles,names=new Map(),pending=new Set();
  const limit=integer(w.options.maxPendingWaits??1024,1,65536);
  const notes='Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace.';
  const add=(name,arity,fn,extra={})=>w.register('kernel32',name,fn,{arity,notes,...extra});
  function get(handle,access=0){const e=h.get(handle,'sync');if((e.access&access)!==access)throw new Win32Error('Synchronization handle access denied',5);return e.object;}
  function makeHandle(object,access){const handle=h.add('sync',{object,access});object.refs++;return handle;}
  function nameOf(p,wide){const name=m.string(p,wide);if(name.length>260)throw new Win32Error('Object name is too long',206);return name;}
  function create(wide,type,security,a,b,namePtr){
    if(security)throw new Win32Error('Security descriptors are not supported',50);
    const name=nameOf(namePtr,wide);let object=name?names.get(name):null;
    if(object){if(object.type!==type)throw new Win32Error('Name belongs to another object type',6);const handle=makeHandle(object,0x1f0003);w.lastError=183;return handle;}
    if(type==='semaphore'){a=integer(a,0,0x7fffffff);b=integer(b,1,0x7fffffff);if(a>b)throw new Win32Error('Initial count exceeds maximum');}
    object={type,name,refs:0,manual:!!a,signaled:!!b,count:a,max:b};
    const handle=makeHandle(object,0x1f0003);if(name)names.set(name,object);w.lastError=0;return handle;
  }
  for(const type of ['event','semaphore']){
    const suffix=type==='event'?'Event':'Semaphore';
    registerAW(w,'kernel32','Create'+suffix,4,(wide,security,a,b,name)=>create(wide,type,security,a,b,name),{notes});
    registerAW(w,'kernel32','Open'+suffix,3,(wide,access,inherit,p)=>{
      access=unsigned(access);if(access&~0x1f0003||inherit)throw new Win32Error('Unsupported access or inheritance',50);
      const object=names.get(nameOf(p,wide));if(!object)throw new Win32Error('Named object not found',2);
      if(object.type!==type)throw new Win32Error('Named object type mismatch',6);return makeHandle(object,access);
    },{notes});
  }
  const ready=o=>o.type==='event'?o.signaled:o.count>0;
  const consume=o=>{if(o.type==='event'){if(!o.manual)o.signaled=false;}else o.count--;};
  function tryAcquire(wait){
    for(const handle of wait.handles)if(!h.has(handle,'sync'))throw new Win32Error('A waited handle was closed',6);
    const index=wait.all?(wait.objects.every(ready)?0:-1):wait.objects.findIndex(ready);
    if(index<0)return null;
    if(wait.all)wait.objects.forEach(consume);else consume(wait.objects[index]);return index;
  }
  function finish(wait,value,error){pending.delete(wait);clearTimeout(wait.timer);if(error)wait.reject(error);else wait.resolve(value);}
  function notify(){for(const wait of [...pending]){try{const result=tryAcquire(wait);if(result!==null)finish(wait,result);}catch(error){finish(wait,0,error);}}}
  add('SetEvent',1,handle=>{const o=get(handle,2);if(o.type!=='event')throw new Win32Error('Expected event',6);o.signaled=true;notify();return 1;});
  add('ResetEvent',1,handle=>{const o=get(handle,2);if(o.type!=='event')throw new Win32Error('Expected event',6);o.signaled=false;return 1;});
  add('ReleaseSemaphore',3,(handle,count,previous)=>{const o=get(handle,2);if(o.type!=='semaphore')throw new Win32Error('Expected semaphore',6);count=integer(count,1,0x7fffffff);if(previous)m.view(previous,4);if(o.count+count>o.max)throw new Win32Error('Semaphore maximum exceeded',298);if(previous)m.writeU32(previous,o.count);o.count+=count;notify();return 1;});
  function wait(handles,all,timeout){
    timeout=unsigned(timeout);if(new Set(handles).size!==handles.length)throw new Win32Error('Duplicate wait handles');
    const state={handles,all,objects:handles.map(handle=>get(handle,0x100000)),timer:null};
    // Aliased handles to the same object cannot be consumed twice in wait-all.
    if(all&&new Set(state.objects).size!==state.objects.length)throw new Win32Error('Duplicate wait objects');
    const result=tryAcquire(state);if(result!==null)return result;if(timeout===0)return 258;
    if(pending.size>=limit)throw new Win32Error('Wait quota exceeded',8);
    return new Promise((resolve,reject)=>{
      Object.assign(state,{resolve,reject});pending.add(state);
      if(timeout!==0xffffffff){const end=w.clock()+timeout;const tick=()=>{const remaining=end-w.clock();if(remaining<=0)finish(state,258);else state.timer=setTimeout(tick,Math.min(remaining,0x7fffffff));};state.timer=setTimeout(tick,Math.min(timeout,0x7fffffff));}
    });
  }
  add('WaitForSingleObject',2,(handle,timeout)=>wait([Number(handle)],false,timeout),{failure:0xffffffff});
  add('WaitForMultipleObjects',4,(count,list,all,timeout)=>{count=integer(count,1,64);const v=m.view(list,count*4);return wait(Array.from({length:count},(_,i)=>v.getUint32(i*4,true)),!!all,timeout);},{failure:0xffffffff});
  const closeFile=w.resolve('kernel32','CloseHandle').fn;
  add('CloseHandle',1,handle=>{
    if(!h.has(handle,'sync'))return closeFile(handle);
    const o=h.close(handle,'sync').object;if(--o.refs===0&&o.name)names.delete(o.name);notify();return 1;
  },{replace:true,notes:'Closes file or synchronization handles. Closing a pending wait fails it with INVALID_HANDLE rather than leaving an unresolved promise.'});
  w.disposeSynchronization=()=>{for(const state of [...pending])finish(state,0,new Win32Error('Compatibility process disposed',995));names.clear();};
}

return {SYNC_CONSTANTS,installSynchronization};
})();

/* gpu-presenter.js */
__modules[11]=(()=>{

/** WebGPU presentation of a retained, CPU-readable GDI surface. Raster operations
 * remain synchronous in the compatibility engine; only presentation is GPU work.
 * One cached texture and a fullscreen triangle replace Canvas2D display blits. */
const SHADER=`@group(0) @binding(0) var image: texture_2d<f32>;
struct Size { value: vec2f, padding: vec2f };
@group(0) @binding(1) var<uniform> size: Size;
@vertex fn vs(@builtin(vertex_index) index: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(vec2f(-1.0, -1.0), vec2f(3.0, -1.0), vec2f(-1.0, 3.0));
  return vec4f(positions[index], 0.0, 1.0);
}
@fragment fn fs(@builtin(position) position: vec4f) -> @location(0) vec4f {
  let dimensions = textureDimensions(image);
  let point = min(vec2u(position.xy / size.value * vec2f(dimensions)), dimensions - vec2u(1u));
  return vec4f(textureLoad(image, vec2i(point), 0).rgb, 1.0);
}`;
class GPURasterPresenter {
  constructor(device,format){
    this.device=device;this.revision=-1;this.width=this.height=0;this.disposed=false;
    const module=device.createShaderModule({code:SHADER});
    const descriptor={layout:'auto',vertex:{module,entryPoint:'vs'},fragment:{module,entryPoint:'fs',targets:[{format}]},primitive:{topology:'triangle-list'}};
    this.ready=(async()=>{
      const info=await module.getCompilationInfo();
      const errors=info.messages.filter(message=>message.type==='error');
      if(errors.length)throw new Error('GDI presentation shader: '+errors.map(e=>e.message).join('; '));
      const pipeline=await device.createRenderPipelineAsync(descriptor);
      if(this.disposed)return;
      this.pipeline=pipeline;
      this.uniform=device.createBuffer({size:16,usage:0x40|0x08}); // UNIFORM | COPY_DST
    })();
  }
  static async create(device,format){const presenter=new GPURasterPresenter(device,format);try{await presenter.ready;return presenter;}catch(error){presenter.dispose();throw error;}}
  render(context,source,revision,width,height){
    const d=this.device;if(!d)throw new Error('GPU raster presenter is disposed');if(!this.pipeline)throw new Error('Await GPU raster presenter.ready before rendering');
    if(!Number.isInteger(width)||!Number.isInteger(height)||width<1||height<1||!source.width||!source.height)throw new RangeError('Invalid GPU presentation dimensions');
    if(source.width>d.limits.maxTextureDimension2D||source.height>d.limits.maxTextureDimension2D)throw new RangeError('GDI texture exceeds device dimensions');
    if(!this.texture||this.width!==source.width||this.height!==source.height){
      this.texture?.destroy();this.width=source.width;this.height=source.height;
      this.texture=d.createTexture({size:[this.width,this.height],format:'rgba8unorm',usage:0x04|0x02|0x10});
      this.bindGroup=d.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.texture.createView()},{binding:1,resource:{buffer:this.uniform}}]});this.revision=-1;
    }
    if(this.revision!==revision){d.queue.copyExternalImageToTexture({source},{texture:this.texture,premultipliedAlpha:false},[this.width,this.height]);this.revision=revision;}
    d.queue.writeBuffer(this.uniform,0,new Float32Array([width,height,0,0]));
    const encoder=d.createCommandEncoder(),pass=encoder.beginRenderPass({colorAttachments:[{view:context.getCurrentTexture().createView(),loadOp:'clear',storeOp:'store',clearValue:{r:0,g:0,b:0,a:1}}]});
    pass.setPipeline(this.pipeline);pass.setBindGroup(0,this.bindGroup);pass.draw(3);pass.end();d.queue.submit([encoder.finish()]);
  }
  dispose(){this.disposed=true;this.texture?.destroy();this.uniform?.destroy();this.texture=this.uniform=this.bindGroup=this.pipeline=this.device=null;}
}

return {GPURasterPresenter};
})();

/* gdi-transform.js */
__modules[12]=(()=>{
const {Win32Error,integer}=__modules[0];

const TRANSFORM_CONSTANTS=Object.freeze({GM_COMPATIBLE:1,GM_ADVANCED:2,MWT_IDENTITY:1,MWT_LEFTMULTIPLY:2,MWT_RIGHTMULTIPLY:3,MM_TEXT:1,MM_LOMETRIC:2,MM_HIMETRIC:3,MM_LOENGLISH:4,MM_HIENGLISH:5,MM_TWIPS:6,MM_ISOTROPIC:7,MM_ANISOTROPIC:8});
const IDENTITY=Object.freeze([1,0,0,1,0,0]);
function multiply(a,b){return [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];}
function inverse(a){const det=a[0]*a[3]-a[1]*a[2];if(!Number.isFinite(det)||Math.abs(det)<1e-20)throw new Win32Error('Singular coordinate transform');return [a[3]/det,-a[1]/det,-a[2]/det,a[0]/det,(a[2]*a[5]-a[3]*a[4])/det,(a[1]*a[4]-a[0]*a[5])/det];}
function mapPoint(a,x,y){const px=a[0]*x+a[2]*y+a[4],py=a[1]*x+a[3]*y+a[5];if(!Number.isFinite(px)||!Number.isFinite(py)||Math.abs(px)>0x3ffffff||Math.abs(py)>0x3ffffff)throw new Win32Error('Transformed coordinate out of range');return [px,py];}
function mapping(s){
  let sx=1,sy=1;const mode=s.mapMode||1;
  if(mode>=2&&mode<=6){sx=96/({2:254,3:2540,4:100,5:1000,6:1440})[mode];sy=-sx;}
  else if(mode>=7){sx=s.viewportExtX/s.windowExtX;sy=s.viewportExtY/s.windowExtY;if(mode===7){const n=Math.min(Math.abs(sx),Math.abs(sy));sx=Math.sign(sx)*n;sy=Math.sign(sy)*n;}}
  return multiply([sx,0,0,sy,s.viewportX-sx*(s.windowX||0),s.viewportY-sy*(s.windowY||0)],s.world||IDENTITY);
}
function translatedOnly(s){const a=mapping(s);return a[0]===1&&!a[1]&&!a[2]&&a[3]===1;}
function devicePoint(s,x,y){return mapPoint(mapping(s),x,y).map(Math.round);}
function mapBounds(a,r){const p=[[r[0],r[1]],[r[2],r[1]],[r[2],r[3]],[r[0],r[3]]].map(([x,y])=>mapPoint(a,x,y));return [Math.floor(Math.min(...p.map(p=>p[0]))),Math.floor(Math.min(...p.map(p=>p[1]))),Math.ceil(Math.max(...p.map(p=>p[0]))),Math.ceil(Math.max(...p.map(p=>p[1])))];}
function readTransform(memory,p){const v=memory.view(p,24),a=[0,4,8,12,16,20].map(o=>v.getFloat32(o,true));if(a.some(n=>!Number.isFinite(n)))throw new Win32Error('Non-finite XFORM');return a;}
function installTransforms(w,{dc,add}){
  const m=w.memory,pair=(p,x,y)=>{const v=m.view(p,8);v.setInt32(0,x,true);v.setInt32(4,y,true);};
  add('GetGraphicsMode',1,id=>dc(id).graphicsMode||1);
  add('SetGraphicsMode',2,(id,mode)=>{mode=integer(mode,1,2);const s=dc(id),old=s.graphicsMode||1;if(mode===1&&(s.world||IDENTITY).some((v,i)=>v!==IDENTITY[i]))throw new Win32Error('Reset world transform before GM_COMPATIBLE');s.graphicsMode=mode;return old;});
  add('GetWorldTransform',2,(id,p)=>{const a=dc(id).world||IDENTITY,v=m.view(p,24);a.forEach((n,i)=>v.setFloat32(i*4,n,true));return 1;});
  const set=(s,a)=>{if(s.graphicsMode!==2)throw new Win32Error('World transform requires GM_ADVANCED');inverse(a);s.world=Object.freeze(a);return 1;};
  add('SetWorldTransform',2,(id,p)=>set(dc(id),readTransform(m,p)));
  add('ModifyWorldTransform',3,(id,p,mode)=>{const s=dc(id);mode=integer(mode,1,3);const a=mode===1?IDENTITY:readTransform(m,p),old=s.world||IDENTITY;return set(s,mode===1?[...IDENTITY]:mode===2?multiply(old,a):multiply(a,old));});
  add('CombineTransform',3,(out,a,b)=>{const x=readTransform(m,a),y=readTransform(m,b),r=multiply(y,x),v=m.view(out,24);if(r.some(n=>!Number.isFinite(Math.fround(n))))throw new Win32Error('XFORM overflow');r.forEach((n,i)=>v.setFloat32(i*4,n,true));return 1;});
  add('GetMapMode',1,id=>dc(id).mapMode||1,{replace:true});
  add('SetMapMode',2,(id,mode)=>{mode=integer(mode,1,8);const s=dc(id),old=s.mapMode||1;s.mapMode=mode;s.windowExtX=s.windowExtY=s.viewportExtX=s.viewportExtY=1;return old;},{replace:true});
  for(const [name,x,y] of [['WindowOrg','windowX','windowY'],['WindowExt','windowExtX','windowExtY'],['ViewportExt','viewportExtX','viewportExtY']]){
    add('Get'+name+'Ex',2,(id,p)=>{const s=dc(id);pair(p,s[x],s[y]);return 1;});
    add('Set'+name+'Ex',4,(id,a,b,p)=>{const s=dc(id);a=integer(a,-0x7fffffff,0x7fffffff);b=integer(b,-0x7fffffff,0x7fffffff);if(p)pair(p,s[x],s[y]);if(name!=='WindowOrg'&&(s.mapMode||1)<7)return 1;if(name!=='WindowOrg'&&(!a||!b))throw new Win32Error('Mapping extents cannot be zero');s[x]=a;s[y]=b;return 1;});
  }
  add('OffsetWindowOrgEx',4,(id,x,y,p)=>{const s=dc(id);return w.resolve('gdi32','SetWindowOrgEx').fn(id,s.windowX+Number(x),s.windowY+Number(y),p);});
  for(const [name,x,y]of [['Window','windowExtX','windowExtY'],['Viewport','viewportExtX','viewportExtY']])add('Scale'+name+'ExtEx',6,(id,xn,xd,yn,yd,p)=>{const s=dc(id);[xn,xd,yn,yd]=[xn,xd,yn,yd].map(n=>integer(n,-0x7fffffff,0x7fffffff));if(!xd||!yd)throw new Win32Error('Zero mapping denominator');return w.resolve('gdi32','Set'+name+'ExtEx').fn(id,Math.round(s[x]*xn/xd),Math.round(s[y]*yn/yd),p);});
  for(const inv of [false,true])add(inv?'DPtoLP':'LPtoDP',3,(id,p,n)=>{n=integer(n,0,Math.floor(m.maxBytes/8));const s=dc(id),a=inv?inverse(mapping(s)):mapping(s),v=m.view(p,n*8),points=Array.from({length:n},(_,i)=>mapPoint(a,v.getInt32(i*8,true),v.getInt32(i*8+4,true)).map(Math.round));points.forEach(([x,y],i)=>{v.setInt32(i*8,x,true);v.setInt32(i*8+4,y,true);});return 1;});
}

return {TRANSFORM_CONSTANTS,IDENTITY,multiply,inverse,mapPoint,mapping,translatedOnly,devicePoint,mapBounds,readTransform,installTransforms};
})();

/* gdi-path.js */
__modules[13]=(()=>{
const {Win32Error,integer}=__modules[0];
const {mapping,mapPoint,inverse,IDENTITY}=__modules[12];


const PATH_CONSTANTS=Object.freeze({ALTERNATE:1,WINDING:2,PT_CLOSEFIGURE:1,PT_LINETO:2,PT_BEZIERTO:4,PT_MOVETO:6});
function installPaths(w,{dc,bitmaps,regions,add,style}){
  const h=w.handles,m=w.memory,max=integer(w.options.maxPathPoints??16384,4,262144);
  const wrap=(name,fn)=>{const old=w.resolve('gdi32',name);add(name,old.arity,(...args)=>fn(old.fn,...args),{replace:true});};
  const checked=(x,y)=>[integer(x,-0x4000000,0x3ffffff),integer(y,-0x4000000,0x3ffffff)];
  const device=(s,x,y)=>mapPoint(mapping(s),...checked(x,y)).map(Math.round);
  const path=s=>{if(s.path?.state!=='closed')throw new Win32Error('A completed path is required',1003);return s.path;};
  const append=(s,entries)=>{const old=s.path.entries;if(old.length+entries.length>max)throw new Win32Error('Path point quota exceeded',8);s.path={state:'open',entries:[...old,...entries]};};
  const last=s=>s.path.entries.at(-1);
  const start=(s,p)=>{if(!last(s)||last(s).type&1)append(s,[{point:p,type:6}]);};
  const points=(p,n,min=2)=>{n=integer(n,min,max);const v=m.view(p,n*8);return Array.from({length:n},(_,i)=>[v.getInt32(i*8,true),v.getInt32(i*8+4,true)]);};
  const flatten=entries=>{
    const out=[];let at=null;
    for(let i=0;i<entries.length;i++){
      const e=entries[i],type=e.type&~1;
      if(type!==4){out.push(e);at=e.point;continue;}
      if(!at||i+2>=entries.length||entries[i+1].type!==4||(entries[i+2].type&~1)!==4)throw new Win32Error('Invalid Bezier path');
      const end=entries[i+2],stack=[[at,e.point,entries[i+1].point,end.point,0]];i+=2;
      while(stack.length){const [a,b,c,d,depth]=stack.pop(),dx=d[0]-a[0],dy=d[1]-a[1],length=Math.hypot(dx,dy),distance=p=>length?Math.abs(dy*p[0]-dx*p[1]+d[0]*a[1]-d[1]*a[0])/length:Math.hypot(p[0]-a[0],p[1]-a[1]);
        if(depth>=16||Math.max(distance(b),distance(c))<=.25){out.push({point:d.map(Math.round),type:2});if(out.length>max)throw new Win32Error('Flattened path quota exceeded',8);continue;}
        const mid=(p,q)=>[(p[0]+q[0])/2,(p[1]+q[1])/2],ab=mid(a,b),bc=mid(b,c),cd=mid(c,d),abc=mid(ab,bc),bcd=mid(bc,cd),center=mid(abc,bcd);
        stack.push([center,bcd,cd,d,depth+1],[a,ab,abc,center,depth+1]);
      }
      if(end.type&1)out[out.length-1]={...out.at(-1),type:3};at=end.point;
    }
    return out;
  };
  const figures=entries=>{const result=[];let current=null;for(const e of flatten(entries)){if((e.type&~1)===6){current=[];result.push(current);}if(!current)throw new Win32Error('Path has no starting point');current.push(e.point);if(e.type&1){current.closed=true;current=null;}}return result.filter(p=>p.length>=2);};
  const shape=(s,entries)=>regions.polygons(figures(entries),s.polyFillMode||1);
  const strokeShape=(s,entries)=>{
    const pen=h.get(s.pen,'pen');if(pen.null)return regions.rectangle(0,0,0,0);
    const transform=mapping(s),width=Math.max(1,(pen.width||1)*Math.sqrt(Math.abs(transform[0]*transform[3]-transform[1]*transform[2]))),polys=[];
    for(const figure of figures(entries)){
      const p=figure.closed?[...figure,figure[0]]:figure;
      for(let i=1;i<p.length;i++){const a=p[i-1],b=p[i],length=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!length)continue;const ox=-(b[1]-a[1])*width/2/length,oy=(b[0]-a[0])*width/2/length;
        polys.push([[a[0]+ox,a[1]+oy],[a[0]-ox,a[1]-oy],[b[0]-ox,b[1]-oy],[b[0]+ox,b[1]+oy]].map(p=>p.map(Math.round)));if(polys.length*4>max)throw new Win32Error('Stroke path quota exceeded',8);}
    }
    return polys.length?regions.polygons(polys,2):regions.rectangle(0,0,0,0);
  };
  const paint=(s,fill,stroke)=>{
    const effective=bitmaps.effective(s),f=fill?regions.combine(fill,effective,1):null,t=stroke?regions.combine(stroke,effective,1):null;
    const union=f&&t?regions.combine(f,t,2):f||t;if(!union?.count)return 1;
    const image=bitmaps.read(s,union.bounds),brush=h.get(s.brush,'brush'),pen=h.get(s.pen,'pen');
    for(const [region,color]of [[f,brush.color||0],[t,pen.color||0]])if(region)for(const band of region.bands)for(let y=band.top;y<band.bottom;y++)for(let j=0;j<band.spans.length;j+=2)for(let x=band.spans[j];x<band.spans[j+1];x++){const i=((y-union.bounds[1])*image.width+x-union.bounds[0])*4;image.data.set([color&255,color>>>8&255,color>>>16&255,0],i);}
    bitmaps.write(s,union.bounds,image);return 1;
  };
  const render=(s,entries,fill,stroke)=>paint(s,fill&&!h.get(s.brush,'brush').null?shape(s,entries):null,stroke?strokeShape(s,entries):null);
  const submit=(s,entries,fill=true,stroke=true)=>{if(s.path?.state==='open'){append(s,entries);return 1;}return render(s,entries,fill,stroke);};
  add('BeginPath',1,id=>{dc(id).path={state:'open',entries:[]};return 1;});
  add('EndPath',1,id=>{const s=dc(id);if(s.path?.state!=='open')throw new Win32Error('No open path',1003);s.path={...s.path,state:'closed'};return 1;});
  add('AbortPath',1,id=>{dc(id).path=null;return 1;});
  add('CloseFigure',1,id=>{const s=dc(id);if(s.path?.state!=='open')throw new Win32Error('No open path',1003);const entries=s.path.entries;if(entries.length)s.path={state:'open',entries:[...entries.slice(0,-1),{...entries.at(-1),type:entries.at(-1).type|1}]};return 1;});
  add('FlattenPath',1,id=>{const s=dc(id),p=path(s);s.path={state:'closed',entries:flatten(p.entries)};return 1;});
  add('WidenPath',1,id=>{const s=dc(id),r=strokeShape(s,path(s).entries),entries=[];for(const [l,t,right,b]of regions.rectangles(r))entries.push({point:[l,t],type:6},{point:[right,t],type:2},{point:[right,b],type:2},{point:[l,b],type:3});if(entries.length>max)throw new Win32Error('Widened path quota exceeded',8);s.path={state:'closed',entries};return 1;});
  add('GetPath',4,(id,p,types,n)=>{const s=dc(id),entries=path(s).entries;n=integer(n,0,max);if(!n)return entries.length;if(n<entries.length)throw new Win32Error('Path output buffer too small');const pts=m.view(p,entries.length*8),flags=m.bytes(types,entries.length),back=inverse(mapping(s)),result=entries.map(e=>mapPoint(back,...e.point).map(Math.round));result.forEach(([x,y],i)=>{pts.setInt32(i*8,x,true);pts.setInt32(i*8+4,y,true);flags[i]=entries[i].type;});return entries.length;},{failure:-1});
  add('PathToRegion',1,id=>{const s=dc(id),r=shape(s,path(s).entries),handle=h.add('region',{shape:r});s.path=null;return handle;});
  add('SelectClipPath',2,(id,mode)=>{mode=integer(mode,1,5);const s=dc(id),r=shape(s,path(s).entries),next=mode===5?r:regions.combine(s.clip||regions.rectangle(...bitmaps.bounds(s)),r,mode);s.clip=next;s.path=null;return 1;});
  for(const [name,fill,stroke]of [['FillPath',true,false],['StrokePath',false,true],['StrokeAndFillPath',true,true]])add(name,1,id=>{const s=dc(id),entries=path(s).entries;const result=render(s,entries,fill,stroke);s.path=null;return result;});
  wrap('MoveToEx',(old,id,x,y,p)=>{const s=dc(id),entry={point:device(s,x,y),type:6};if(s.path?.state==='open'&&s.path.entries.length>=max)throw new Win32Error('Path quota exceeded',8);const result=old(id,x,y,p);if(s.path?.state==='open')append(s,[entry]);return result;});
  wrap('LineTo',(old,id,x,y)=>{const s=dc(id);if(s.path?.state!=='open')return old(id,x,y);const entries=[];if(!last(s)||last(s).type&1)entries.push({point:device(s,s.x,s.y),type:6});entries.push({point:device(s,x,y),type:2});append(s,entries);[s.x,s.y]=checked(x,y);return 1;});
  for(const name of ['Rectangle','Ellipse'])wrap(name,(old,id,l,t,r,b)=>{const s=dc(id);if(s.path?.state!=='open')return old(id,l,t,r,b);let p;
    if(name==='Rectangle')p=[[l,t],[r,t],[r,b],[l,b]];
    else{[l,t,r,b]=[l,t,r,b].map(n=>integer(n,-0x4000000,0x3ffffff));const n=Math.min(1024,Math.max(16,Math.ceil(Math.PI*Math.sqrt(Math.max(Math.abs(r-l),Math.abs(b-t))))));p=Array.from({length:n},(_,i)=>[(l+r)/2+(r-l)/2*Math.cos(i/n*2*Math.PI),(t+b)/2+(b-t)/2*Math.sin(i/n*2*Math.PI)]).map(p=>p.map(Math.round));}
    append(s,p.map((vertex,i)=>({point:device(s,...vertex),type:i===0?6:i===p.length-1?3:2})));return 1;});
  const poly=(id,polys,closed,bezier=false,to=false)=>{
    const s=dc(id),entries=[];
    for(let p of polys){
      if(to)p=[[s.x,s.y],...p];
      if(bezier&&(p.length-1)%3)throw new Win32Error('Bezier points must be 1+3n');
      const continuing=to&&s.path?.state==='open'&&last(s)&&!(last(s).type&1);
      entries.push(...p.map((vertex,i)=>({point:device(s,...vertex),type:i===0?6:(bezier?4:2)|(closed&&i===p.length-1?1:0)})).slice(continuing?1:0));
    }
    const result=submit(s,entries,closed,true);
    if(to)[s.x,s.y]=polys.at(-1).at(-1);
    return result;
  };
  add('Polygon',3,(id,p,n)=>poly(id,[points(p,n)],true));
  add('Polyline',3,(id,p,n)=>poly(id,[points(p,n)],false));
  add('PolylineTo',3,(id,p,n)=>poly(id,[points(p,n,1)],false,false,true));
  add('PolyBezier',3,(id,p,n)=>poly(id,[points(p,n,4)],false,true));
  add('PolyBezierTo',3,(id,p,n)=>poly(id,[points(p,n,3)],false,true,true));
  for(const closed of [false,true])add(closed?'PolyPolygon':'PolyPolyline',4,(id,p,counts,n)=>{n=integer(n,1,max);const v=m.view(counts,n*4),polys=[];let offset=0;for(let i=0;i<n;i++){const count=integer(v.getInt32(i*4,true),2,max);if(offset+count>max)throw new Win32Error('Polygon point quota exceeded',8);polys.push(points(p+offset*8,count));offset+=count;}return poly(id,polys,closed);});
}

return {PATH_CONSTANTS,installPaths};
})();

/* gdi-text.js */
__modules[14]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];
const {mapping,multiply,mapPoint,mapBounds}=__modules[12];


const TEXT_CONSTANTS=Object.freeze({OBJ_FONT:6,FW_NORMAL:400,FW_BOLD:700,ANSI_CHARSET:0,DEFAULT_CHARSET:1,TRANSPARENT:1,OPAQUE:2,TA_NOUPDATECP:0,TA_UPDATECP:1,TA_LEFT:0,TA_RIGHT:2,TA_CENTER:6,TA_TOP:0,TA_BOTTOM:8,TA_BASELINE:24,TA_RTLREADING:256,ETO_OPAQUE:2,ETO_CLIPPED:4,ETO_RTLREADING:128,ETO_PDY:8192,DT_CENTER:1,DT_RIGHT:2,DT_VCENTER:4,DT_BOTTOM:8,DT_WORDBREAK:16,DT_SINGLELINE:32,DT_EXPANDTABS:64,DT_CALCRECT:1024,DT_NOPREFIX:2048});
const fields=['height','width','escapement','orientation','weight'];
const bytes=['italic','underline','strikeOut','charSet','outPrecision','clipPrecision','quality','pitchAndFamily'];
const cssColor=c=>'#'+[c&255,c>>>8&255,c>>>16&255].map(n=>n.toString(16).padStart(2,'0')).join('');
function installText(w,{dc,bitmaps,regions,add,stock,stocks}){
  const h=w.handles,m=w.memory,limit=integer(w.options.maxTextLength??16384,1,1048576);
  const canvas=(width,height)=>{
    if(width*height>bitmaps.maxPixels)throw new Win32Error('Text raster quota exceeded',8);
    let c;if(w.options.createCanvas)c=w.options.createCanvas(width,height);
    else if(typeof globalThis.OffscreenCanvas==='function')c=new globalThis.OffscreenCanvas(width,height);
    else{const doc=w.options.window?.document||globalThis.document;if(doc){c=doc.createElement('canvas');c.width=width;c.height=height;}}
    if(!c?.getContext)throw new Win32Error('Font rendering requires Canvas2D, OffscreenCanvas, or createCanvas adapter',50);
    c.width=width;c.height=height;return c;
  };
  const font=(faceName='Arial',height=-12,pitchAndFamily=0)=>({height,width:0,escapement:0,orientation:0,weight:400,italic:0,underline:0,strikeOut:0,charSet:1,outPrecision:0,clipPrecision:0,quality:0,pitchAndFamily,faceName});
  const fontStocks=[10,11,12,13,14,16,17],ensure=index=>{if(!stocks.has(index))stock(index,'font',font([10,11,16].includes(index)?'monospace':'Arial',-12,[10,11,16].includes(index)?1:2));return stocks.get(index);};
  const oldStock=w.resolve('gdi32','GetStockObject');add('GetStockObject',1,index=>fontStocks.includes(Number(index))?ensure(Number(index)):oldStock.fn(index),{replace:true});
  const oldCurrent=w.resolve('gdi32','GetCurrentObject');add('GetCurrentObject',2,(id,type)=>Number(type)===6?(dc(id).font||ensure(13)):oldCurrent.fn(id,type),{replace:true});
  const oldSelect=w.resolve('gdi32','SelectObject');add('SelectObject',2,(id,obj)=>{const s=dc(id);if(h.has(obj,'font')&&!s.font)s.font=ensure(13);return oldSelect.fn(id,obj);},{replace:true});
  const get=s=>h.get(s.font||ensure(13),'font');
  const readFont=(p,wide)=>{const v=m.view(p,wide?92:60),f={};fields.forEach((k,i)=>f[k]=v.getInt32(i*4,true));bytes.forEach((k,i)=>f[k]=v.getUint8(20+i));f.faceName=m.decode(m.bytes(p+28,wide?64:32),wide).split('\0')[0];return validate(f);};
  const validate=f=>{fields.forEach(k=>f[k]=integer(f[k],-32767,32767));bytes.forEach(k=>f[k]=integer(f[k],0,255));f.faceName=String(f.faceName||'Arial').slice(0,31);return f;};
  const writeFont=(f,p,n,wide)=>{const size=wide?92:60;if(!p)return size;if(integer(n,0,0x7fffffff)<size)throw new Win32Error('LOGFONT buffer too small');const v=m.view(p,size);m.bytes(p,size).fill(0);fields.forEach((k,i)=>v.setInt32(i*4,f[k],true));bytes.forEach((k,i)=>v.setUint8(20+i,f[k]));m.putString(p+28,f.faceName,32,wide);return size;};
  for(const wide of [false,true]){
    const suffix=wide?'W':'A';
    add('CreateFontIndirect'+suffix,1,p=>h.add('font',readFont(p,wide)));
    add('CreateFont'+suffix,14,(height,width,escapement,orientation,weight,italic,underline,strikeOut,charSet,outPrecision,clipPrecision,quality,pitchAndFamily,p)=>h.add('font',validate({height,width,escapement,orientation,weight,italic,underline,strikeOut,charSet,outPrecision,clipPrecision,quality,pitchAndFamily,faceName:m.string(p,wide)})));
    const old=w.resolve('gdi32','GetObject'+suffix);add('GetObject'+suffix,3,(id,n,p)=>h.has(id,'font')?writeFont(h.get(id,'font'),p,n,wide):old.fn(id,n,p),{replace:true});
  }
  const setup=s=>{
    const f=get(s),c=canvas(1,1),ctx=c.getContext('2d');if(!ctx)throw new Win32Error('Canvas2D text context unavailable',50);
    let size=Math.abs(f.height)||12;const family=f.faceName.replace(/["\\\n\r]/g,'');
    ctx.font=`${f.italic?'italic ':''}${Math.max(1,Math.min(1000,f.weight||400))} ${size}px "${family}", sans-serif`;
    if(['monospace','serif','sans-serif','system-ui','cursive','fantasy'].includes(family.toLowerCase()))ctx.font=ctx.font.replace('\"'+family+'\"',family);
    ctx.textBaseline='alphabetic';ctx.direction=s.textAlign&256?'rtl':'ltr';
    if(f.height>0){const measured=ctx.measureText('Mg'),cell=(measured.fontBoundingBoxAscent??measured.actualBoundingBoxAscent)+(measured.fontBoundingBoxDescent??measured.actualBoundingBoxDescent);if(cell>0){size=size*f.height/cell;ctx.font=ctx.font.replace(/[\d.]+px/,size+'px');}}
    const metric=ctx.measureText('Mg'),ascent=metric.fontBoundingBoxAscent??metric.actualBoundingBoxAscent??size*.8,descent=metric.fontBoundingBoxDescent??metric.actualBoundingBoxDescent??size*.2;
    const average=ctx.measureText('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz').width/52;
    return {ctx,font:f,size,ascent,descent,height:ascent+descent,xscale:f.width&&average?Math.abs(f.width)/average:1};
  };
  const read=(p,n,wide)=>{n=integer(n,0,limit);if(typeof p==='string')return p.slice(0,n);if(!n)return '';return m.decode(m.bytes(p,n*(wide?2:1)),wide);};
  const extent=(s,text,c=null)=>{if(!text.length)return {width:0,height:0,context:c};c=c||setup(s);return {width:c.ctx.measureText(text).width*c.xscale+text.length*(s.charExtra||0),height:c.height,context:c};};
  const draw=(s,x,y,text,flags=0,rectangle=null,advances=null)=>{
    flags=unsigned(flags);if(flags&~(2|4|128|8192))throw new Win32Error('Unsupported ExtTextOut options (glyph-index input requires a font-specific adapter)',50);
    if(flags&6&&!rectangle)throw new Win32Error('ExtTextOut rectangle required');
    const c=setup(s),e=extent(s,text,c),align=s.textAlign||0;
    if(align&1){x=s.x;y=s.y;}x=Number(x);y=Number(y);if(!Number.isFinite(x)||!Number.isFinite(y))throw new Win32Error('Invalid text origin');
    let advanceX=e.width,advanceY=0;
    if(advances){advanceX=advances.reduce((n,p)=>n+p[0],0);advanceY=advances.reduce((n,p)=>n+p[1],0);}
    const offset=(align&6)===6?-advanceX/2:(align&2)?-advanceX:0;
    const baseline=(align&24)===24?0:(align&8)?-c.descent:c.ascent;
    const angle=-c.font.escapement*Math.PI/1800,rotation=[Math.cos(angle),Math.sin(angle),-Math.sin(angle),Math.cos(angle),x,y],matrix=multiply(mapping(s),rotation);
    const logical=[offset-2,baseline-c.ascent-2,offset+Math.max(0,advanceX,e.width)+c.size+2,baseline+c.descent+Math.abs(advanceY)+2];
    let bounds=mapBounds(matrix,logical);if(flags&2){const b=mapBounds(mapping(s),rectangle);bounds=[Math.min(bounds[0],b[0]),Math.min(bounds[1],b[1]),Math.max(bounds[2],b[2]),Math.max(bounds[3],b[3])];}
    let clip=bitmaps.effective(s);if(flags&4)clip=regions.combine(clip,regions.transform(regions.rectangle(...rectangle),mapping(s)),1);
    const advance=()=>{if(align&1){s.x=Math.round(x+advanceX*Math.cos(angle)-advanceY*Math.sin(angle));s.y=Math.round(y+advanceX*Math.sin(angle)+advanceY*Math.cos(angle));}};
    const region=regions.combine(regions.rectangle(...bounds),clip,1);if(!region.count){advance();return 1;}
    bounds=region.bounds;const width=bounds[2]-bounds[0],height=bounds[3]-bounds[1],surface=canvas(width,height),ctx=surface.getContext('2d');
    ctx.font=c.ctx.font;ctx.textBaseline='alphabetic';ctx.direction=flags&128||align&256?'rtl':'ltr';ctx.textAlign='left';
    if(flags&2){const a=mapping(s);ctx.setTransform(a[0],a[1],a[2],a[3],a[4]-bounds[0],a[5]-bounds[1]);ctx.fillStyle=cssColor(s.backgroundColor);ctx.fillRect(rectangle[0],rectangle[1],rectangle[2]-rectangle[0],rectangle[3]-rectangle[1]);}
    ctx.setTransform(matrix[0],matrix[1],matrix[2],matrix[3],matrix[4]-bounds[0],matrix[5]-bounds[1]);
    if(s.backgroundMode===2&&text.length){ctx.fillStyle=cssColor(s.backgroundColor);ctx.fillRect(offset,baseline-c.ascent,advanceX,c.height);}
    ctx.fillStyle=cssColor(s.textColor);ctx.save();ctx.scale(c.xscale,1);
    if(!advances&&!s.charExtra)ctx.fillText(text,offset/c.xscale,baseline);
    else{let px=offset,py=baseline,index=0;for(const character of text){ctx.fillText(character,px/c.xscale,py);if(advances){for(let k=0;k<character.length;k++){px+=advances[index+k][0];py+=advances[index+k][1];}}else px+=c.ctx.measureText(character).width*c.xscale+(s.charExtra||0);index+=character.length;}}
    ctx.restore();if(c.font.underline)ctx.fillRect(offset,baseline+1,advanceX,Math.max(1,c.size/16));if(c.font.strikeOut)ctx.fillRect(offset,baseline-c.ascent*.35,advanceX,Math.max(1,c.size/16));
    const pixels=ctx.getImageData(0,0,width,height),target=bitmaps.read(s,bounds);
    for(const band of region.bands)for(let py=band.top;py<band.bottom;py++)for(let j=0;j<band.spans.length;j+=2)for(let px=band.spans[j];px<band.spans[j+1];px++){
      const i=((py-bounds[1])*width+px-bounds[0])*4,a=pixels.data[i+3]/255;if(!a)continue;for(let k=0;k<3;k++)target.data[i+k]=Math.round(pixels.data[i+k]*a+target.data[i+k]*(1-a));target.data[i+3]=0;
    }
    bitmaps.write(s,bounds,target);advance();return 1;
  };
  for(const [name,key]of [['TextAlign','textAlign'],['TextCharacterExtra','charExtra']]){
    add('Get'+name,1,id=>dc(id)[key]||0,{failure:key==='charExtra'?0x80000000:0xffffffff});
    add('Set'+name,2,(id,value)=>{value=integer(value,-0x7fffffff,0x7fffffff);if(key==='textAlign'&&(value&~(1|6|24|256)||![0,2,6].includes(value&6)||![0,8,24].includes(value&24)))throw new Win32Error('Invalid text alignment');const s=dc(id),old=s[key]||0;s[key]=value;return old;},{failure:key==='charExtra'?0x80000000:0xffffffff});
  }
  const rect=p=>{const v=m.view(p,16);return [0,4,8,12].map(o=>v.getInt32(o,true));};
  const pair=(p,x,y)=>{const v=m.view(p,8);v.setInt32(0,Math.round(x),true);v.setInt32(4,Math.round(y),true);};
  for(const wide of [false,true]){
    const suffix=wide?'W':'A';
    add('TextOut'+suffix,5,(id,x,y,p,n)=>draw(dc(id),x,y,read(p,n,wide)),{replace:true,mode:'browser',notes:'Canvas font shaping/rasterization on window and memory DCs, with complex clipping and affine transforms.'});
    add('ExtTextOut'+suffix,8,(id,x,y,flags,r,p,n,dx)=>{const text=read(p,n,wide),advance=[];if(dx){const stride=flags&8192?8:4,v=m.view(dx,text.length*stride);for(let i=0;i<text.length;i++)advance.push([v.getInt32(i*stride,true),stride===8?v.getInt32(i*stride+4,true):0]);}return draw(dc(id),x,y,text,flags,r?rect(r):null,dx?advance:null);},{mode:'browser'});
    for(const name of ['GetTextExtentPoint32','GetTextExtentPoint'])add(name+suffix,4,(id,p,n,out)=>{const e=extent(dc(id),read(p,n,wide));pair(out,e.width,e.height);return 1;},{mode:'browser'});
    add('GetTextFace'+suffix,3,(id,n,out)=>{const f=get(dc(id));if(!out)return f.faceName.length+1;n=integer(n,0,Math.floor(m.maxBytes/(wide?2:1)));return n?m.putString(out,f.faceName,n,wide)+1:0;});
    add('GetTextMetrics'+suffix,2,(id,out)=>{const c=setup(dc(id)),size=wide?60:56,v=m.view(out,size),values=[c.height,c.ascent,c.descent,Math.max(0,c.height-c.size),0,c.ctx.measureText('x').width*c.xscale,c.ctx.measureText('W').width*c.xscale,c.font.weight,0,96,96];m.bytes(out,size).fill(0);values.forEach((n,i)=>v.setInt32(i*4,Math.round(n),true));let o=44;for(const ch of [32,wide?65535:255,63,32]){if(wide){v.setUint16(o,ch,true);o+=2;}else v.setUint8(o++,ch);}for(const value of [c.font.italic,c.font.underline,c.font.strikeOut,6,c.font.charSet])v.setUint8(o++,value);return 1;},{mode:'browser',notes:'Metrics come from the selected Canvas font; native GDI hinting/font mapper values are not guaranteed identical.'});
    add('GetTextExtentExPoint'+suffix,7,(id,p,n,maxExtent,fit,dx,out)=>{const s=dc(id),text=read(p,n,wide);if(text.length>4096)throw new Win32Error('Cumulative text extent work quota exceeded',8);const c=setup(s),widths=Array.from({length:text.length},(_,i)=>Math.round(extent(s,text.slice(0,i+1),c).width)),fv=fit?m.view(fit,4):null,dv=dx?m.view(dx,widths.length*4):null,ov=m.view(out,8);let count=0;for(const value of widths){if(value<=Number(maxExtent))count++;else break;}if(fv)fv.setInt32(0,count,true);widths.forEach((n,i)=>dv?.setInt32(i*4,n,true));ov.setInt32(0,widths.at(-1)||0,true);ov.setInt32(4,text.length?Math.round(c.height):0,true);return 1;},{mode:'browser'});
    w.register('user32','DrawText'+suffix,(id,p,n,r,flags)=>{
      const s=dc(id),rectangle=rect(r),c=setup(s);flags=unsigned(flags);if(flags&~(1|2|4|8|16|32|64|1024|2048))throw new Win32Error('DrawText option is not supported',50);
      let text=Number(n)===-1?m.string(p,wide):read(p,n,wide);if(text.length>limit)throw new Win32Error('Text length quota exceeded',8);
      if(!(flags&2048))text=text.replace(/&&/g,'\u0001').replace(/&/g,'').replace(/\u0001/g,'&');if(flags&64)text=text.replace(/\t/g,'        ');if(flags&32)text=text.replace(/[\r\n]+/g,' ');
      const lines=[];for(const paragraph of text.split(/\r?\n/)){if(!(flags&16)||flags&32){lines.push(paragraph);continue;}let line='';for(const word of paragraph.split(/(\s+)/)){const next=line+word;if(line&&extent(s,next,c).width>rectangle[2]-rectangle[0]){lines.push(line.trimEnd());line=word.trimStart();}else line=next;}lines.push(line);}
      const lineHeight=Math.round(c.height),height=lines.length*lineHeight,width=Math.ceil(Math.max(0,...lines.map(t=>extent(s,t,c).width)));
      if(!text.length&&(flags&1024)&&!(flags&32)){const v=m.view(r,16);v.setInt32(8,rectangle[0],true);v.setInt32(12,rectangle[1],true);return 1;}
      if(flags&1024){const v=m.view(r,16);v.setInt32(8,rectangle[0]+width,true);v.setInt32(12,rectangle[1]+height,true);return height;}
      let y=rectangle[1];if(flags&32&&flags&4)y+=Math.floor((rectangle[3]-rectangle[1]-height)/2);else if(flags&32&&flags&8)y=rectangle[3]-height;
      const old=s.textAlign;try{s.textAlign=0;for(const line of lines){const width=extent(s,line,c).width,x=flags&1?(rectangle[0]+rectangle[2]-width)/2:flags&2?rectangle[2]-width:rectangle[0];draw(s,x,y,line,4,rectangle);y+=lineHeight;}}finally{s.textAlign=old;}return Math.round(y-rectangle[1]);
    },{arity:5,mode:'browser'});
  }
}

return {TEXT_CONSTANTS,installText};
})();

/* user32-paint.js */
__modules[15]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];

const PAINT_CONSTANTS=Object.freeze({WM_PAINT:15,WM_ERASEBKGND:20,RDW_INVALIDATE:1,RDW_INTERNALPAINT:2,RDW_ERASE:4,RDW_VALIDATE:8,RDW_NOINTERNALPAINT:16,RDW_NOERASE:32,RDW_NOCHILDREN:64,RDW_ALLCHILDREN:128,RDW_UPDATENOW:256,RDW_ERASENOW:512,RDW_FRAME:1024,RDW_NOFRAME:2048,DCX_WINDOW:1,DCX_CACHE:2,DCX_INTERSECTRGN:128,DCX_EXCLUDERGN:64});
/** Window-owned HRGNs and independent pending/active update regions. All state is
 * process-local and is destroyed with its registered application window. */
function installPainting(w,{dc,bitmaps,regions}){
  const h=w.handles,m=w.memory,tasks=new Map(),add=(name,arity,fn,options={})=>w.register('user32',name,fn,{arity,mode:'browser',...options});
  const win=id=>{if(!h.has(id,'window'))throw new Win32Error('Invalid window handle',1400);return h.get(id,'window');};
  const empty=()=>regions.rectangle(0,0,0,0);
  const full=e=>{const r=e.getClientRect?.(),node=e.context?.canvas||e.node;return regions.rectangle(0,0,Math.round(r?.width??node?.clientWidth??node?.width??0),Math.round(r?.height??node?.clientHeight??node?.height??0));};
  const state=e=>e.gdiPaint||(e.gdiPaint={update:empty(),erase:false,active:null,internal:false,nonclient:false,notifying:false});
  const region=id=>{const r=h.get(id,'region');if(r.windowOwner)throw new Win32Error('Region ownership belongs to a window',5);return r;};
  const rect=p=>{const v=m.view(p,16);return [0,4,8,12].map(o=>v.getInt32(o,true));};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));};
  const request=id=>{
    if(tasks.has(id)||w.disposed)return;const e=win(id);if(!e.requestPaint&&!e.message&&!e.requestNonClientPaint)return;
    tasks.set(id,setTimeout(()=>{
      tasks.delete(id);
      if(!w.disposed&&h.has(id,'window'))notify(id).catch(error=>w.options.onError?.(error));
    },0));
  };
  const eraseBackground=(e,handle)=>{
    if(e.eraseBackground)return e.eraseBackground(handle)!==false;
    if(e.getBackgroundColor&&handle){
      const d=dc(handle),r=bitmaps.effective(d),color=unsigned(e.getBackgroundColor())&0xffffff;
      if(r.count){const image=bitmaps.read(d,r.bounds);for(const band of r.bands)for(let y=band.top;y<band.bottom;y++)for(let j=0;j<band.spans.length;j+=2)for(let x=band.spans[j];x<band.spans[j+1];x++){
        const i=((y-r.bounds[1])*image.width+x-r.bounds[0])*4;image.data.set([color&255,color>>>8&255,color>>>16&255,0],i);
      }bitmaps.write(d,r.bounds,image);}return true;
    }
    return false;
  };
  const notify=async(id,force=false,eraseOnly=false)=>{
    const e=win(id),s=state(e);if(s.notifying)return 1;
    if(!(force||s.update.count||s.internal||s.nonclient))return 1;
    if(tasks.has(id)){clearTimeout(tasks.get(id));tasks.delete(id);}
    s.notifying=true;
    try{
      if(s.nonclient){if(e.requestNonClientPaint)await e.requestNonClientPaint();else if(e.message)await e.message(133,1,0,false);else throw new Win32Error('No nonclient repaint adapter',50);s.nonclient=false;}
      if(eraseOnly){if(s.erase){const handle=getDC(id);try{dc(handle).paintClip=s.update;s.erase=false;try{if(!eraseBackground(e,handle))s.erase=true;}catch(error){s.erase=true;throw error;}}finally{release(id,handle);}}return 1;}
      if(force||s.update.count||s.internal){s.internal=false;if(e.requestPaint)await e.requestPaint();else if(e.message)await e.message(15,0,0,false);else throw new Win32Error('No WM_PAINT adapter for this window',50);}
      return 1;
    }finally{s.notifying=false;}
  };
  const change=(id,shape,invalidate,erase)=>{const e=win(id),s=state(e),clip=regions.combine(shape||full(e),full(e),1),next=regions.combine(s.update,clip,invalidate?2:4);s.update=next;if(invalidate)s.erase=s.erase||!!erase;else if(!next.count)s.erase=false;if(invalidate)request(id);return 1;};
  add('InvalidateRect',3,(id,p,erase)=>change(id,p?regions.rectangle(...rect(p)):null,true,erase));
  add('ValidateRect',2,(id,p)=>change(id,p?regions.rectangle(...rect(p)):null,false,false));
  add('InvalidateRgn',3,(id,r,erase)=>change(id,r?region(r).shape:null,true,erase));
  add('ValidateRgn',2,(id,r)=>change(id,r?region(r).shape:null,false,false));
  const erasePending=e=>{const s=state(e);if(!s.erase)return;const id=e.gdiWindowHandle;if(!id)return;const handle=getDC(id);try{dc(handle).paintClip=s.update;s.erase=false;try{if(!eraseBackground(e,handle))s.erase=true;}catch(error){s.erase=true;throw error;}}finally{release(id,handle);}};
  add('GetUpdateRect',3,(id,p,erase)=>{const e=win(id),s=state(e);if(p)writeRect(p,s.update.bounds);if(erase&&s.erase){e.gdiWindowHandle=Number(id);erasePending(e);}return s.update.count?1:0;});
  add('GetUpdateRgn',3,(id,r,erase)=>{const e=win(id),s=state(e),dest=region(r);if(erase&&s.erase){e.gdiWindowHandle=Number(id);erasePending(e);}dest.shape=s.update;return dest.shape.type;});
  add('SetWindowRgn',3,(id,r,redraw)=>{
    const e=win(id),s=state(e),object=r?region(r):null,shape=object?.shape??null;
    const wr=e.getRect?.(),origin=e.clientOrigin?.(),dx=origin&&wr?Math.round(origin[0]-wr.left):0,dy=origin&&wr?Math.round(origin[1]-wr.top):0;
    const clientShape=shape?regions.offset(shape,-dx,-dy):null;
    if(e.setRegion)e.setRegion(shape?regions.rectangles(shape):null);
    else if(e.node?.style){const path=shape?regions.rectangles(shape).map(([l,t,right,b])=>`M${l} ${t}H${right}V${b}H${l}Z`).join(' '):null;e.node.style.clipPath=path===null?'':path?`path('${path}')`:'inset(100%)';}
    else if(!e.allowVirtualRegion)throw new Win32Error('Window shape requires a DOM or explicit region adapter',50);
    const old=s.shapeHandle;if(object)object.windowOwner=Number(id);s.shapeHandle=Number(r)||0;e.gdiWindowShape=shape;e.gdiClientShape=clientShape;
    if(old&&old!==Number(r)&&h.has(old,'region'))h.close(old,'region');if(redraw)change(id,null,true,true);return 1;
  });
  add('GetWindowRgn',2,(id,r)=>{const e=win(id),dest=region(r);if(!e.gdiWindowShape)return 0;dest.shape=e.gdiWindowShape;return dest.shape.type;});
  add('GetWindowRgnBox',2,(id,p)=>{const shape=win(id).gdiWindowShape;writeRect(p,shape?.bounds||[0,0,0,0]);return shape?.type||0;});
  const getDC=w.resolve('user32','GetDC').fn,release=w.resolve('user32','ReleaseDC').fn;
  add('BeginPaint',2,(id,p)=>{
    const e=win(id),s=state(e),v=m.view(p,64);if(s.active)throw new Win32Error('BeginPaint already active for this window');
    const handle=getDC(id),d=dc(handle),snapshot=s.update,erase=s.erase;
    s.active={handle,region:snapshot};s.update=empty();s.erase=false;s.internal=false;
    try{d.paintClip=snapshot;d.paintOwner=Number(id);const erased=erase&&eraseBackground(e,handle);m.bytes(p,64).fill(0);v.setUint32(0,handle,true);v.setInt32(4,erase&&!erased?1:0,true);writeRect(p+8,snapshot.bounds);}
    catch(error){s.update=regions.combine(s.update,snapshot,2);s.erase=s.erase||erase;s.active=null;release(id,handle);throw error;}
    return handle;
  });
  add('EndPaint',2,(id,p)=>{const e=win(id),s=state(e),handle=m.readU32(p);m.view(p,64);if(!s.active||handle!==s.active.handle)throw new Win32Error('PAINTSTRUCT does not match the active paint');release(id,handle);s.active=null;if(s.update.count||s.internal)request(id);return 1;});
  add('ReleaseDC',2,(id,handle)=>{if(dc(handle).paintOwner)throw new Win32Error('Use EndPaint for a paint DC');return release(id,handle);},{replace:true});
  add('UpdateWindow',1,id=>notify(id));
  add('RedrawWindow',4,async(id,p,r,flags)=>{
    flags=unsigned(flags);
    if(flags&~4095||(flags&1)&&(flags&8)||(flags&64)&&(flags&128))throw new Win32Error('Invalid redraw flags');
    const e=win(id),shape=r?region(r).shape:p?regions.rectangle(...rect(p)):full(e),targets=[[Number(id),shape]],visited=new Set([Number(id)]);
    // All affected geometry is validated before any pending region is changed.
    for(let i=0;i<targets.length;i++){
      const [parent,parentShape]=targets[i],pe=win(parent);
      if(flags&64||(!(flags&128)&&((Number(typeof pe.style==='function'?pe.style():pe.style||0)&0x2000000)!==0)))continue;
      for(const [child,item]of h.entries)if(item.type==='window'&&Number(typeof item.value.parent==='function'?item.value.parent():item.value.parent)===parent&&!visited.has(child)){
        visited.add(child);const origin=pe.clientOrigin?.()||[0,0],co=item.value.clientOrigin?.()||[0,0];
        targets.push([child,regions.combine(regions.offset(parentShape,Math.round(origin[0]-co[0]),Math.round(origin[1]-co[1])),full(item.value),1)]);
      }
    }
    const plans=targets.map(([handle,shape])=>{const e=win(handle),s=state(e);if(flags&1024&&flags&1&&!e.requestNonClientPaint&&!e.message)throw new Win32Error('Nonclient repaint requires an adapter',50);return {handle,e,s,next:flags&9?regions.combine(s.update,regions.combine(shape,full(e),1),flags&1?2:4):s.update};});
    for(const {handle,e,s,next}of plans){s.update=next;if(flags&1&&flags&4)s.erase=true;if(flags&8&&!next.count)s.erase=false;if(flags&2)s.internal=true;if(flags&16)s.internal=false;if(flags&32)s.erase=false;if(flags&1024&&flags&1)s.nonclient=true;if(flags&2048&&flags&8)s.nonclient=false;}
    for(const {handle,s}of plans){if(flags&256)await notify(handle);else if(flags&512)await notify(handle,false,true);if(s.update.count||s.internal||s.nonclient)request(handle);}
    return 1;
  });
  add('GetDCEx',3,(id,r,flags)=>{flags=unsigned(flags);if(flags&~(2|64|128)||flags&64&&flags&128)throw new Win32Error('Unsupported DCX flags',50);const e=win(id),shape=flags&192?region(r).shape:null,clip=flags&64?regions.combine(full(e),shape,4):shape,handle=getDC(id);if(clip)dc(handle).clip=clip;if(r&&flags&192)h.close(r,'region');return handle;});
  for(const wide of [false,true]){
    const name='SendMessage'+(wide?'W':'A'),old=w.resolve('user32',name);add(name,4,(id,msg,wp,lp)=>Number(msg)===15?notify(id,true):old.fn(id,msg,wp,lp),{replace:true});
  }
  w.releaseWindowGDI=id=>{const e=win(id),s=e.gdiPaint;if(tasks.has(id)){clearTimeout(tasks.get(id));tasks.delete(id);}if(s?.shapeHandle&&h.has(s.shapeHandle,'region'))h.close(s.shapeHandle,'region');e.gdiPaint=null;e.gdiWindowShape=e.gdiClientShape=null;if(e.node?.style)e.node.style.clipPath='';};
  w.disposeWindowGDI=()=>{for(const id of [...tasks.keys()]){clearTimeout(tasks.get(id));tasks.delete(id);}for(const [id,e]of h.entries)if(e.type==='window')w.releaseWindowGDI(id);};
}

return {PAINT_CONSTANTS,installPainting};
})();

/* gdi-geometry.js */
__modules[16]=(()=>{
const {Win32Error,integer}=__modules[0];

const point=n=>integer(n,-0x4000000,0x3ffffff);
const quota=()=>{throw new Win32Error('Region scan conversion work quota exceeded',8);};
/** Exact ceil of an integer edge intersection. Large coordinates use BigInt to
 * avoid loss of a pixel when intermediate products exceed Number precision. */
function edgeX(a,b,y){
  const dy=b[1]-a[1],dx=b[0]-a[0],n=a[0]*dy+(y-a[1])*dx;
  if(Number.isSafeInteger(a[0]*dy)&&Number.isSafeInteger((y-a[1])*dx)&&Number.isSafeInteger(n))return Math.ceil(n/dy);
  const d=BigInt(dy),v=BigInt(a[0])*d+BigInt(y-a[1])*BigInt(dx);
  return Number(v/d+(v>0n&&v%d!==0n?1n:0n));
}
/** Integer scan conversion with ALTERNATE or WINDING fill. Edges are sampled at
 * integer device rows and intervals are half-open. No bitmap-area allocation. */
function polygonRegion(store,polygons,mode=1){
  mode=integer(mode,1,2);let count=0,top=Infinity,bottom=-Infinity;const edges=[];
  if(!Array.isArray(polygons))throw new Win32Error('Polygon array required');
  for(const polygon of polygons){
    if(!Array.isArray(polygon)||polygon.length<2)throw new Win32Error('A polygon requires at least two points');
    count+=polygon.length;if(count>store.limit*4||count>store.workLimit)quota();
    const points=polygon.map(p=>{if(!Array.isArray(p)||p.length!==2)throw new Win32Error('Invalid POINT');return p.map(point);});
    for(let i=0;i<points.length;i++){
      let a=points[i],b=points[(i+1)%points.length];if(a[1]===b[1])continue;
      const sign=a[1]<b[1]?1:-1;if(sign<0)[a,b]=[b,a];
      edges.push({a,b,sign});top=Math.min(top,a[1]);bottom=Math.max(bottom,b[1]);
    }
  }
  if(!edges.length)return store.rectangle(0,0,0,0);
  if((bottom-top)*edges.length>store.workLimit)quota();
  const bands=[],budget={count:0};
  for(let y=top;y<bottom;y++){
    const hits=[];for(const e of edges)if(e.a[1]<=y&&e.b[1]>y)hits.push([edgeX(e.a,e.b,y),e.sign]);
    hits.sort((a,b)=>a[0]-b[0]);let winding=0,active=false;const spans=[];
    for(let i=0;i<hits.length;){const x=hits[i][0];do{winding+=mode===1?1:hits[i][1];i++;}while(i<hits.length&&hits[i][0]===x);
      const next=mode===1?(winding&1)!==0:winding!==0;if(active!==next){spans.push(x);active=next;}}
    store.append(bands,y,y+1,spans,budget);
  }
  return store.finish(bands);
}
/** Bounded analytic ellipse/rounded-rectangle scan conversion. Pixel edges are
 * deterministic across engines; curved-edge GDI rasterizer parity is measured
 * separately from Boolean geometry and is not assumed from API availability. */
function roundedRegion(store,left,top,right,bottom,ew,eh){
  [left,top,right,bottom]=[left,top,right,bottom].map(point);
  if(left>right)[left,right]=[right,left];if(top>bottom)[top,bottom]=[bottom,top];
  // GDI curved region constructors exclude the last right/bottom raster edge.
  right--;bottom--;if(right<left)[left,right]=[right,left];if(bottom<top)[top,bottom]=[bottom,top];
  ew=Math.min(right-left,Math.abs(integer(ew,-0x7fffffff,0x7fffffff)));
  eh=Math.min(bottom-top,Math.abs(integer(eh,-0x7fffffff,0x7fffffff)));
  if(!ew||!eh)return store.rectangle(left,top,right,bottom);
  if(bottom-top>store.workLimit)quota();
  const rx=ew/2,ry=eh/2,bands=[],budget={count:0};
  for(let y=top;y<bottom;y++){
    const cy=y<top+ry?top+ry:bottom-ry;
    const yy=y+.5,dy=yy<top+ry||yy>bottom-ry?(yy-cy)/ry:0;
    const inset=rx-rx*Math.sqrt(Math.max(0,1-dy*dy));
    const l=Math.ceil(left+inset-.5),r=Math.ceil(right-inset-.5);
    store.append(bands,y,y+1,l<r?[l,r]:[],budget);
  }
  return store.finish(bands);
}
function transformRegion(store,region,matrix){
  if(!Array.isArray(matrix)||matrix.length!==6||matrix.some(n=>!Number.isFinite(n)))throw new Win32Error('Invalid region transform');
  const [a,b,c,d,tx,ty]=matrix;
  if(a===1&&!b&&!c&&d===1&&Number.isInteger(tx)&&Number.isInteger(ty))return store.offset(region,tx,ty);
  if(!region.count)return region;
  // Transform all bands as one winding polygon set. Shared edges cancel and
  // self-overlap is handled once, rather than repeatedly unioning scan rows.
  return polygonRegion(store,store.rectangles(region).map(([l,t,r,bt])=>[[l,t],[r,t],[r,bt],[l,bt]].map(([x,y])=>[point(Math.round(a*x+c*y+tx)),point(Math.round(b*x+d*y+ty))])),2);
}
/** Rectangular morphological erosion: subtract the complement dilated by the
 * requested horizontal/vertical border widths. The result works on holes and
 * disconnected components, not just the outer bounding rectangle. */
function frameRegion(store,region,x,y){
  x=Math.abs(integer(x,-0x7fffffff,0x7fffffff));y=Math.abs(integer(y,-0x7fffffff,0x7fffffff));
  if(!x||!y||!region.count)return store.rectangle(0,0,0,0);
  const [l,t,r,b]=region.bounds;
  if(x*2>=r-l||y*2>=b-t)return region;
  const innerBox=store.rectangle(l+x,t+y,r-x,b-y);
  const holes=store.combine(store.rectangle(l,t,r,b),region,4);
  let inner=innerBox,work=0;
  for(const q of store.rectangles(holes)){
    work+=inner.count+holes.count;if(work>store.workLimit)quota();
    const dilated=store.rectangle(Math.max(l,q[0]-x),Math.max(t,q[1]-y),Math.min(r,q[2]+x),Math.min(b,q[3]+y));
    inner=store.combine(inner,dilated,4);
  }
  return store.combine(region,inner,4);
}

return {polygonRegion,roundedRegion,transformRegion,frameRegion};
})();

/* gdi-region.js */
__modules[17]=(()=>{
const {polygonRegion,roundedRegion,transformRegion,frameRegion}=__modules[16];
const {mapping,devicePoint,mapBounds,inverse,readTransform}=__modules[12];
const {Win32Error,integer}=__modules[0];



const REGION_CONSTANTS=Object.freeze({RGN_AND:1,RGN_OR:2,RGN_XOR:3,RGN_DIFF:4,RGN_COPY:5,ERROR:0,NULLREGION:1,SIMPLEREGION:2,COMPLEXREGION:3,OBJ_REGION:8,RDH_RECTANGLES:1});
const MIN=-0x4000000,MAX=0x3ffffff;
const coordinate=n=>integer(n,MIN,MAX);
const equalSpans=(a,b)=>a.length===b.length&&a.every((x,i)=>x===b[i]);
const inside=(mode,a,b)=>mode===1?a&&b:mode===2?a||b:mode===3?a!==b:a&&!b;
const EMPTY=Object.freeze({bands:Object.freeze([]),bounds:Object.freeze([0,0,0,0]),count:0,type:1});

/** Immutable, canonical y-bands: sorted disjoint half-open x intervals per band.
 * Boolean operations depend on edge count, never coordinate magnitude or area.
 * Frozen geometry may safely be shared by handles, clips and saved DC states.
 */
class RegionStore {
  constructor(options={}){
    this.limit=integer(options.maxRegionRectangles??4096,1,65536);
    this.workLimit=integer(options.maxRegionWork??1048576,16,16777216);
  }
  polygons(polygons,mode=1){return polygonRegion(this,polygons,mode);}
  rounded(...args){return roundedRegion(this,...args);}
  transform(region,matrix){return transformRegion(this,region,matrix);}
  frame(region,x,y){return frameRegion(this,region,x,y);}
  rectangle(left,top,right,bottom){
    [left,top,right,bottom]=[left,top,right,bottom].map(coordinate);
    if(left>right)[left,right]=[right,left];if(top>bottom)[top,bottom]=[bottom,top];
    return left===right||top===bottom?EMPTY:this.finish([{top,bottom,spans:[left,right]}]);
  }
  finish(bands){
    if(!bands.length)return EMPTY;
    let count=0,left=MAX,right=MIN;
    for(const b of bands){count+=b.spans.length/2;left=Math.min(left,b.spans[0]);right=Math.max(right,b.spans.at(-1));Object.freeze(b.spans);Object.freeze(b);}
    if(count>this.limit)throw new Win32Error('Region rectangle quota exceeded',8);
    return Object.freeze({bands:Object.freeze(bands),bounds:Object.freeze([left,bands[0].top,right,bands.at(-1).bottom]),count,type:count===1?2:3});
  }
  append(bands,top,bottom,spans,budget){
    if(!spans.length||bottom<=top)return;
    const last=bands.at(-1);
    if(last&&last.bottom===top&&equalSpans(last.spans,spans)){last.bottom=bottom;return;}
    budget.count+=spans.length/2;if(budget.count>this.limit)throw new Win32Error('Region rectangle quota exceeded',8);
    bands.push({top,bottom,spans});
  }
  combine(a,b,mode){
    mode=integer(mode,1,5);if(mode===5)return a;
    if(a===b)return mode===3||mode===4?EMPTY:a;
    if(!a.count)return mode===2||mode===3?b:EMPTY;
    if(!b.count)return mode===1?EMPTY:a;
    const ys=[...new Set([...a.bands,...b.bands].flatMap(x=>[x.top,x.bottom]))].sort((x,y)=>x-y);
    const result=[],budget={count:0};let ai=0,bi=0,work=0;
    for(let y=0;y+1<ys.length;y++){
      const top=ys[y],bottom=ys[y+1];while(ai<a.bands.length&&a.bands[ai].bottom<=top)ai++;while(bi<b.bands.length&&b.bands[bi].bottom<=top)bi++;
      const aa=a.bands[ai],bb=b.bands[bi],as=aa&&aa.top<=top?aa.spans:[],bs=bb&&bb.top<=top?bb.spans:[];
      work+=as.length+bs.length;if(work>this.workLimit)throw new Win32Error('Region operation work quota exceeded',8);
      let i=0,j=0,inA=false,inB=false,active=false;const spans=[];
      while(i<as.length||j<bs.length){
        const x=Math.min(as[i]??Infinity,bs[j]??Infinity);
        if(as[i]===x){inA=!inA;i++;}if(bs[j]===x){inB=!inB;j++;}
        const next=inside(mode,inA,inB);if(next!==active){spans.push(x);active=next;}
      }
      this.append(result,top,bottom,spans,budget);
    }
    return this.finish(result);
  }
  // RGNDATA already consists of sorted, non-overlapping rectangles. Validate
  // this contract rather than accepting quadratic arbitrary rectangle soups.
  fromRectangles(rectangles){
    if(rectangles.length>this.limit)throw new Win32Error('Region rectangle quota exceeded',8);
    const bands=[],budget={count:0};let current=null;
    for(const input of rectangles){
      const [left,top,right,bottom]=input.map(coordinate);
      if(left>=right||top>=bottom)throw new Win32Error('RGNDATA contains an empty or inverted rectangle');
      if(current&&top===current.top&&bottom===current.bottom){
        const last=current.spans.at(-1);if(left<last)throw new Win32Error('RGNDATA rectangles overlap or are unsorted');
        if(left===last)current.spans[current.spans.length-1]=right;else current.spans.push(left,right);
      }else{
        if(current){if(top<current.bottom)throw new Win32Error('RGNDATA bands overlap or are unsorted');this.append(bands,current.top,current.bottom,current.spans,budget);}
        current={top,bottom,spans:[left,right]};
      }
    }
    if(current)this.append(bands,current.top,current.bottom,current.spans,budget);
    return this.finish(bands);
  }
  offset(region,x,y){
    x=integer(x,-0x80000000,0x7fffffff);y=integer(y,-0x80000000,0x7fffffff);if(!region.count)return region;
    // Check every new bound before constructing or publishing any new state.
    [region.bounds[0]+x,region.bounds[1]+y,region.bounds[2]+x,region.bounds[3]+y].forEach(coordinate);
    if(!x&&!y)return region;
    return this.finish(region.bands.map(b=>({top:b.top+y,bottom:b.bottom+y,spans:b.spans.map(n=>n+x)})));
  }
  row(region,y){
    let lo=0,hi=region.bands.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(region.bands[mid].bottom<=y)lo=mid+1;else hi=mid;}
    const band=region.bands[lo];return band&&band.top<=y?band.spans:[];
  }
  contains(region,x,y){
    const spans=this.row(region,y);let lo=0,hi=spans.length;
    while(lo<hi){const mid=(lo+hi)>>>1;if(spans[mid]<=x)lo=mid+1;else hi=mid;}
    return (lo&1)!==0;
  }
  intersects(region,rect){
    const [l,t,r,b]=rect;if(l>=r||t>=b)return false;
    for(const band of region.bands){if(band.top>=b)break;if(band.bottom<=t)continue;for(let i=0;i<band.spans.length;i+=2){if(band.spans[i]>=r)break;if(band.spans[i+1]>l)return true;}}
    return false;
  }
  equal(a,b){return a===b||(a.count===b.count&&a.bands.length===b.bands.length&&a.bands.every((x,i)=>x.top===b.bands[i].top&&x.bottom===b.bands[i].bottom&&equalSpans(x.spans,b.bands[i].spans)));}
  rectangles(region){return region.bands.flatMap(b=>{const out=[];for(let i=0;i<b.spans.length;i+=2)out.push([b.spans[i],b.top,b.spans[i+1],b.bottom]);return out;});}
}

/** Register region, application clip and region-painting APIs on the shared DCs. */
function installRegions(w,{dc,bitmaps,regions,add}){
  const h=w.handles,m=w.memory,get=id=>{const r=h.get(id,'region');if(r.windowOwner)throw new Win32Error('Region ownership belongs to a window',5);return r;},set=(id,shape)=>{get(id).shape=shape;return shape.type;};
  const rect=p=>{const v=m.view(p,16);return [0,4,8,12].map(o=>v.getInt32(o,true));};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));};
  const create=shape=>h.add('region',{shape});
  const deviceRegion=s=>regions.rectangle(...bitmaps.bounds(s));
  const effective=s=>bitmaps.effective(s);
  const logicalRect=(s,r)=>regions.transform(regions.rectangle(...r),mapping(s));
  const select=(s,object,mode)=>{
    mode=integer(mode,1,5);
    if(!object){if(mode!==5)throw new Win32Error('NULL clip requires RGN_COPY');s.clip=null;return effective(s).type;}
    const shape=get(object).shape;
    const next=mode===5||mode===1&&!s.clip?shape:regions.combine(s.clip||deviceRegion(s),shape,mode);
    // Calculate before assigning, so failures preserve the previous clip.
    const type=regions.combine(next,deviceRegion(s),1).type;s.clip=next;return type;
  };
  add('CreateRectRgn',4,(...r)=>create(regions.rectangle(...r)));
  add('CreateRectRgnIndirect',1,p=>create(regions.rectangle(...rect(p))));
  add('SetRectRgn',5,(object,...r)=>{get(object);set(object,regions.rectangle(...r));return 1;});
  add('CombineRgn',4,(dest,a,b,mode)=>{get(dest);const first=get(a).shape;mode=integer(mode,1,5);return set(dest,mode===5?first:regions.combine(first,get(b).shape,mode));});
  add('EqualRgn',2,(a,b)=>regions.equal(get(a).shape,get(b).shape)?1:0);
  add('OffsetRgn',3,(object,x,y)=>set(object,regions.offset(get(object).shape,x,y)));
  add('GetRgnBox',2,(object,out)=>{const shape=get(object).shape;writeRect(out,shape.bounds);return shape.type;});
  add('PtInRegion',3,(object,x,y)=>regions.contains(get(object).shape,integer(x,-0x80000000,0x7fffffff),integer(y,-0x80000000,0x7fffffff))?1:0);
  add('RectInRegion',2,(object,p)=>regions.intersects(get(object).shape,rect(p))?1:0);
  add('GetRegionData',3,(object,count,out)=>{
    const shape=get(object).shape,size=32+shape.count*16;count=integer(count,0,0xffffffff);if(!out)return size;
    if(count<size)throw new Win32Error('Region data buffer is too small',87);
    const v=m.view(out,size);v.setUint32(0,32,true);v.setUint32(4,1,true);v.setUint32(8,shape.count,true);v.setUint32(12,shape.count*16,true);writeRect(out+16,shape.bounds);
    let offset=32;for(const r of regions.rectangles(shape)){writeRect(out+offset,r);offset+=16;}return size;
  });
  add('ExtCreateRegion',3,(transform,count,p)=>{
    count=integer(count,32,m.maxBytes);const v=m.view(p,count),n=v.getUint32(8,true),bytes=v.getUint32(12,true);
    if(v.getUint32(0,true)!==32||v.getUint32(4,true)!==1||n>regions.limit||bytes<n*16||bytes>count-32||32+n*16>count)throw new Win32Error('Invalid or excessive RGNDATA');
    const matrix=transform?readTransform(m,transform):null;
    let shape=regions.fromRectangles(Array.from({length:n},(_,i)=>rect(p+32+i*16)));
    const bounds=rect(p+16);if(!bounds.every((x,i)=>x===shape.bounds[i]))throw new Win32Error('RGNDATA bounding rectangle is inconsistent');
    if(matrix)shape=regions.transform(shape,matrix);return create(shape);
  });
  add('SelectClipRgn',2,(handle,object)=>select(dc(handle),object,5));
  add('ExtSelectClipRgn',3,(handle,object,mode)=>select(dc(handle),object,mode));
  add('GetClipRgn',2,(handle,object)=>{const s=dc(handle);get(object);if(!s.clip)return 0;set(object,s.clip);return 1;},{failure:-1});
  for(const [name,mode]of [['IntersectClipRect',1],['ExcludeClipRect',4]])add(name,5,(handle,...r)=>{
    const s=dc(handle),shape=logicalRect(s,r);
    // Intersecting an absent application clip stores the complete rectangle,
    // not only the currently visible bitmap portion. A later bitmap selection
    // or offset must recover that off-screen geometry (Windows GDI contracts).
    const next=mode===1&&!s.clip?shape:regions.combine(s.clip||deviceRegion(s),shape,mode);
    // Rectangle clip calls use GDI's conservative COMPLEXREGION success status;
    // GetClipBox reports the precise effective visible complexity separately.
    s.clip=next;return mode===4&&!next.count?1:3;
  });
  add('OffsetClipRgn',3,(handle,x,y)=>{const s=dc(handle);x=integer(x,-0x80000000,0x7fffffff);y=integer(y,-0x80000000,0x7fffffff);if(!s.clip)return effective(s).type;const matrix=mapping(s),next=regions.offset(s.clip,Math.round(matrix[0]*x+matrix[2]*y),Math.round(matrix[1]*x+matrix[3]*y));s.clip=next;return next.type;});
  add('GetClipBox',2,(handle,out)=>{const s=dc(handle),shape=effective(s);writeRect(out,shape.count?mapBounds(inverse(mapping(s)),shape.bounds):[0,0,0,0]);return shape.type;});
  add('PtVisible',3,(handle,x,y)=>{const s=dc(handle);[x,y]=devicePoint(s,integer(x,-0x80000000,0x7fffffff),integer(y,-0x80000000,0x7fffffff));return regions.contains(effective(s),x,y)?1:0;});
  add('RectVisible',2,(handle,p)=>{const s=dc(handle),r=rect(p);return regions.combine(effective(s),logicalRect(s,r),1).count?1:0;});
  const paint=(handle,object,brush,invert=false)=>{
    const s=dc(handle),shape=logicalRectShape(s,typeof object==='object'?object:get(object).shape),b=invert?null:h.get(brush,'brush');if(b?.null)return 1;
    const clipped=regions.combine(shape,effective(s),1);if(!clipped.count)return 1;
    const r=clipped.bounds,image=bitmaps.read(s,r),color=b?.color||0;
    for(const band of clipped.bands)for(let y=band.top;y<band.bottom;y++)for(let j=0;j<band.spans.length;j+=2)for(let x=band.spans[j];x<band.spans[j+1];x++){
      const i=((y-r[1])*image.width+x-r[0])*4;
      if(invert){image.data[i]^=255;image.data[i+1]^=255;image.data[i+2]^=255;image.data[i+3]=0;}
      else{image.data[i]=color&255;image.data[i+1]=color>>>8&255;image.data[i+2]=color>>>16&255;image.data[i+3]=0;}
    }
    bitmaps.write(s,r,image);return 1;
  };
  const logicalRectShape=(s,shape)=>regions.transform(shape,mapping(s));
  add('FillRgn',3,(handle,object,brush)=>paint(handle,object,brush));
  add('PaintRgn',2,(handle,object)=>paint(handle,object,dc(handle).brush));
  add('InvertRgn',2,(handle,object)=>paint(handle,object,0,true));
  add('FrameRgn',5,(handle,object,brush,x,y)=>paint(handle,regions.frame(get(object).shape,x,y),brush));
  add('CreateEllipticRgn',4,(l,t,r,b)=>create(regions.rounded(l,t,r,b,Math.abs(r-l),Math.abs(b-t))));
  add('CreateEllipticRgnIndirect',1,p=>{const [l,t,r,b]=rect(p);return create(regions.rounded(l,t,r,b,Math.abs(r-l),Math.abs(b-t)));});
  add('CreateRoundRectRgn',6,(...args)=>create(regions.rounded(...args)));
  const points=(p,n)=>{n=integer(n,2,regions.limit*4);const v=m.view(p,n*8);return Array.from({length:n},(_,i)=>[v.getInt32(i*8,true),v.getInt32(i*8+4,true)]);};
  add('CreatePolygonRgn',3,(p,n,mode)=>create(regions.polygons([points(p,n)],mode)));
  add('CreatePolyPolygonRgn',4,(p,counts,n,mode)=>{n=integer(n,1,regions.limit);const v=m.view(counts,n*4),polys=[];let offset=0;for(let i=0;i<n;i++){const count=integer(v.getInt32(i*4,true),2,regions.limit*4);if(offset+count>regions.limit*4)throw new Win32Error('Polygon point quota exceeded',8);polys.push(points(p+offset*8,count));offset+=count;}return create(regions.polygons(polys,mode));});
  add('GetPolyFillMode',1,id=>dc(id).polyFillMode||1);
  add('SetPolyFillMode',2,(id,mode)=>{mode=integer(mode,1,2);const s=dc(id),old=s.polyFillMode||1;s.polyFillMode=mode;return old;});
  return {select,paint};
}

return {REGION_CONSTANTS,RegionStore,installRegions};
})();

/* gdi-bitmap.js */
__modules[18]=(()=>{
const {mapping,inverse,mapPoint,mapBounds,devicePoint,translatedOnly}=__modules[12];
const {Win32Error,integer,unsigned}=__modules[0];


// All bitmap addresses are process-private. DIBs use Win32 BGR/BGRA scan lines,
// not Canvas RGBA. DDB scan lines are WORD aligned; DIBs are DWORD aligned.
const GDI_CONSTANTS=Object.freeze({BI_RGB:0,DIB_RGB_COLORS:0,CBM_INIT:4,
  SRCCOPY:0x00cc0020,SRCPAINT:0x00ee0086,SRCAND:0x008800c6,SRCINVERT:0x00660046,
  SRCERASE:0x00440328,NOTSRCCOPY:0x00330008,NOTSRCERASE:0x001100a6,
  MERGECOPY:0x00c000ca,MERGEPAINT:0x00bb0226,PATCOPY:0x00f00021,
  PATPAINT:0x00fb0a09,PATINVERT:0x005a0049,DSTINVERT:0x00550009,
  BLACKNESS:0x00000042,WHITENESS:0x00ff0062,COLORONCOLOR:3,
  AC_SRC_OVER:0,AC_SRC_ALPHA:1,OBJ_PEN:1,OBJ_BRUSH:2,OBJ_DC:3,OBJ_BITMAP:7,
  OBJ_MEMDC:10,MM_TEXT:1,NULLREGION:1,SIMPLEREGION:2,CLR_INVALID:0xffffffff});
const rops=new Set(Object.entries(GDI_CONSTANTS).filter(([k])=>['SRCCOPY','SRCPAINT','SRCAND','SRCINVERT','SRCERASE','NOTSRCCOPY','NOTSRCERASE','MERGECOPY','MERGEPAINT','PATCOPY','PATPAINT','PATINVERT','DSTINVERT','BLACKNESS','WHITENESS'].includes(k)).map(([,v])=>v));
const coord=value=>integer(value,-0x80000000,0x7fffffff);
function intersect(a,b){const r=[Math.max(a[0],b[0]),Math.max(a[1],b[1]),Math.min(a[2],b[2]),Math.min(a[3],b[3])];return r[2]<=r[0]||r[3]<=r[1]?[0,0,0,0]:r;}
function rgbBytes(color){color=unsigned(color);return [color&255,color>>>8&255,color>>>16&255,0];}
function rgbValue(data,i=0){return data[i]|data[i+1]<<8|data[i+2]<<16;}
function ropInfo(value){value=unsigned(value);if(!rops.has(value))throw new Win32Error('Unsupported raster operation or capture flags',50);const code=value>>>16&255;return {code,source:((code^(code>>>2))&0x33)!==0,pattern:((code^(code>>>4))&15)!==0};}
function applyROP(code,p,s,d){let out=0;for(let i=0;i<8;i++)if(code>>i&1)out|=(i&4?p:~p)&(i&2?s:~s)&(i&1?d:~d);return out&255;}

class BitmapStore {
  constructor(w,regions){this.clipCache=new WeakMap();this.regions=regions;this.w=w;this.m=w.memory;this.h=w.handles;this.maxPixels=integer(w.options.maxRasterPixels??Math.max(1,Math.min(4194304,Math.floor(w.memory.maxBytes/4))),1,16777216);}
  geometry(width,height,bpp,dib=false){width=integer(width,1,32767);height=integer(height,1,32767);if(![1,24,32].includes(bpp)||dib&&bpp===1)throw new Win32Error('Only 1-bit DDB and 24/32-bit BI_RGB bitmaps are supported',50);const unit=dib?32:16,stride=Math.ceil(width*bpp/unit)*unit/8,size=stride*height;if(size>this.m.maxBytes)throw new Win32Error('Bitmap exceeds process memory quota',8);return {width,height,bpp,stride,size};}
  header(pointer,usage=0){if(unsigned(usage)!==0)throw new Win32Error('Logical palettes are not supported',50);const v=this.m.view(pointer,40);if(v.getUint32(0,true)!==40)throw new Win32Error('Only BITMAPINFOHEADER is supported',50);const width=v.getInt32(4,true),signedHeight=v.getInt32(8,true),bpp=v.getUint16(14,true);if(v.getUint16(12,true)!==1||!signedHeight)throw new Win32Error('Invalid bitmap planes or height');if(v.getUint32(16,true)!==0||v.getUint32(32,true)!==0)throw new Win32Error('Only uncompressed true-color BI_RGB without a color table is supported',50);return {...this.geometry(width,Math.abs(signedHeight),bpp,true),topDown:signedHeight<0,dib:true};}
  create(width,height,bpp,{dib=false,topDown=true,bits=0,stock=false}={}){const g=this.geometry(width,height,bpp,dib);const input=bits?this.m.bytes(bits,g.size).slice():null;const ptr=this.m.alloc(g.size);this.m.block(ptr).owner='gdi-bitmap';try{if(input)this.m.bytes(ptr,g.size).set(input);return this.h.add('bitmap',{...g,ptr,dib,topDown,stock,dimensionX:0,dimensionY:0});}catch(error){this.m.free(ptr);throw error;}}
  get(handle){return this.h.get(handle,'bitmap');}
  data(bitmap){return this.m.bytes(bitmap.ptr,bitmap.size);}
  bytesFor(rect){const width=rect[2]-rect[0],height=rect[3]-rect[1];if(width<0||height<0||width*height>this.maxPixels)throw new Win32Error('Raster operation exceeds pixel quota',8);return {width,height,data:new Uint8ClampedArray(width*height*4)};}
  bounds(state){if(state.bitmap){const b=this.get(state.bitmap);return [0,0,b.width,b.height];}const d=state.window,r=d.getClientRect?.(),c=d.context?.canvas||d.node;return [0,0,integer(Math.ceil(r?.width??c?.width??c?.clientWidth??0),0,32767),integer(Math.ceil(r?.height??c?.height??c?.clientHeight??0),0,32767)];}
  effective(state){
    const bounds=this.bounds(state),window=state.window,shape=window?.gdiWindowShape??window?.gdiClientShape??null,paint=state.paintClip??null,prior=this.clipCache.get(state);
    const rect=shape&&window?.gdiWindowShape?window.getRect?.():null,origin=rect?window.clientOrigin?.():null;
    const dx=origin?Math.round(rect.left-origin[0]):0,dy=origin?Math.round(rect.top-origin[1]):0;
    if(prior&&prior.clip===state.clip&&prior.shape===shape&&prior.dx===dx&&prior.dy===dy&&prior.paint===paint&&bounds.every((n,i)=>n===prior.bounds[i]))return prior.region;
    let region=this.regions.rectangle(...bounds);for(const clip of [state.clip,shape?this.regions.offset(shape,dx,dy):null,paint])if(clip)region=this.regions.combine(region,clip,1);
    this.clipCache.set(state,{bounds,clip:state.clip,shape,paint,dx,dy,region});return region;
  }
  clip(state,rect){return this.regions.combine(this.regions.rectangle(...intersect(rect,this.bounds(state))),this.effective(state),1).bounds;}
  spans(state,y,left,right){return this.regions.row(this.effective(state),y);}
  context(state){const c=state.window.context||state.window.node?.getContext?.('2d');if(!c)throw new Win32Error('Drawing adapter does not support pixel readback/writeback',50);return c;}
  readBitmap(b,rect){const image=this.bytesFor(rect),bytes=this.data(b),[l,t]=rect;for(let y=0;y<image.height;y++){const row=(b.topDown?t+y:b.height-1-t-y)*b.stride;for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4,px=l+x;if(b.bpp===1){const c=bytes[row+(px>>>3)]&(0x80>>(px&7))?255:0;image.data.set([c,c,c,255],i);}else{const p=row+px*b.bpp/8;image.data[i]=bytes[p+2];image.data[i+1]=bytes[p+1];image.data[i+2]=bytes[p];image.data[i+3]=b.bpp===32?bytes[p+3]:255;}}}return image;}
  writeBitmap(b,rect,image,background=0xffffff){const bytes=this.data(b),[l,t]=rect;for(let y=0;y<image.height;y++){const row=(b.topDown?t+y:b.height-1-t-y)*b.stride;for(let x=0;x<image.width;x++){const i=(y*image.width+x)*4,px=l+x;if(b.bpp===1){const p=row+(px>>>3),mask=0x80>>(px&7);bytes[p]=rgbValue(image.data,i)===(background&0xffffff)?bytes[p]|mask:bytes[p]&~mask;}else{const p=row+px*b.bpp/8;bytes[p]=image.data[i+2];bytes[p+1]=image.data[i+1];bytes[p+2]=image.data[i];if(b.bpp===32)bytes[p+3]=image.data[i+3];}}}}
  read(state,rect){if(state.bitmap)return this.readBitmap(this.get(state.bitmap),rect);const image=this.bytesFor(rect);try{const result=state.window.readPixels?state.window.readPixels(rect[0],rect[1],image.width,image.height):this.context(state).getImageData(rect[0],rect[1],image.width,image.height);if(!result||result.width!==image.width||result.height!==image.height||result.data?.length!==image.data.length)throw new Win32Error('Invalid pixel readback from host',50);image.data.set(result.data);return image;}catch(error){if(error?.name==='SecurityError')throw new Win32Error('Canvas readback is not permitted',5);throw error;}}
  write(state,rect,image){if(state.bitmap)return this.writeBitmap(this.get(state.bitmap),rect,image,state.backgroundColor);for(let i=3;i<image.data.length;i+=4)image.data[i]=255;if(state.window.writePixels){if(state.window.writePixels(rect[0],rect[1],image)===false)throw new Win32Error('Host rejected raster transfer',50);return;}const ctx=this.context(state),data=ctx.createImageData(image.width,image.height);data.data.set(image.data);for(let i=3;i<data.data.length;i+=4)data.data[i]=255;ctx.putImageData(data,rect[0],rect[1]);}
  blit(dst,dx,dy,dw,dh,src,sx,sy,sw,sh,operation,extra=0){
    [dx,dy,dw,dh,sx,sy,sw,sh]=[dx,dy,dw,dh,sx,sy,sw,sh].map(coord);
    const blend=operation==='alpha',transparent=operation==='transparent',rop=blend||transparent?{source:true,pattern:false}:ropInfo(operation);
    if((blend||transparent)&&[dw,dh,sw,sh].some(n=>n<=0))throw new Win32Error('Alpha/transparent blits require positive extents');
    if(blend){extra=unsigned(extra);if(extra&0xffff||extra>>>24>1)throw new Win32Error('Unsupported BLENDFUNCTION');if(extra>>>24&&(!src?.bitmap||this.get(src.bitmap).bpp!==32))throw new Win32Error('Per-pixel alpha requires a 32-bit source bitmap');}
    if(!blend&&!transparent&&(Math.abs(dw)!==Math.abs(sw)||Math.abs(dh)!==Math.abs(sh))&&src&&dst.stretchMode!==3)throw new Win32Error('Scaled raster transfers require COLORONCOLOR',50);
    const dm=mapping(dst),di=inverse(dm),sm=src?mapping(src):null;
    const logicalDst=[Math.min(dx,dx+dw),Math.min(dy,dy+dh),Math.max(dx,dx+dw),Math.max(dy,dy+dh)];
    const rawDst=mapBounds(dm,logicalDst),r=this.clip(dst,rawDst);
    const rawSrc=src?mapBounds(sm,[Math.min(sx,sx+sw),Math.min(sy,sy+sh),Math.max(sx,sx+sw),Math.max(sy,sy+sh)]):[0,0,0,0];
    if(rop.source){if(!src)throw new Win32Error('Source device context required',6);const b=this.bounds(src);if(rawSrc[0]<0||rawSrc[1]<0||rawSrc[2]>b[2]||rawSrc[3]>b[3])throw new Win32Error('Source rectangle is outside its bitmap');if(blend&&(dst.bitmap?dst.bitmap===src.bitmap:dst.window===src.window)){const overlap=intersect(rawSrc,rawDst);if(overlap[2]>overlap[0])throw new Win32Error('Overlapping AlphaBlend rectangles');}}
    if(!dw||!dh||rop.source&&(!sw||!sh)||r[2]===r[0])return 1;
    const brush=this.h.get(dst.brush,'brush');if(rop.pattern&&brush.null)return 1;
    // Snapshot before writes: aliased source/destination is safe for every ROP.
    const source=rop.source?this.read(src,rawSrc):null,image=this.read(dst,r),pattern=rgbBytes(brush.color||0),mono=src?.bitmap&&this.get(src.bitmap).bpp===1;
    const effective=this.effective(dst),fg=rgbBytes(dst.textColor),bg=rgbBytes(dst.backgroundColor),constant=(extra>>>16&255)/255,perPixel=extra>>>24===1;
    for(let y=0;y<image.height;y++){const spans=this.regions.row(effective,r[1]+y);for(let span=0;span<spans.length;span+=2)for(let x=Math.max(r[0],spans[span])-r[0];x<Math.min(r[2],spans[span+1])-r[0];x++){
      const i=(y*image.width+x)*4,px=r[0]+x+.5,py=r[1]+y+.5,lx=di[0]*px+di[2]*py+di[4],ly=di[1]*px+di[3]*py+di[5];
      if(lx<logicalDst[0]||lx>=logicalDst[2]||ly<logicalDst[1]||ly>=logicalDst[3])continue;
      const ux=sx+((lx-dx)/dw)*sw,uy=sy+((ly-dy)/dh)*sh;
      const ix=source?Math.min(source.width-1,Math.max(0,Math.floor(sm[0]*ux+sm[2]*uy+sm[4])-rawSrc[0])):0;
      const iy=source?Math.min(source.height-1,Math.max(0,Math.floor(sm[1]*ux+sm[3]*uy+sm[5])-rawSrc[1])):0;
      const si=source?(iy*source.width+ix)*4:0,s=mono?(source.data[si]?bg:fg):source?.data;
      const offset=mono?0:si;
      if(transparent&&rgbValue(s,offset)===(unsigned(extra)&0xffffff))continue;
      if(blend){const alpha=constant*(perPixel?s[offset+3]/255:1);for(let c=0;c<3;c++)image.data[i+c]=Math.min(255,Math.round(s[offset+c]*constant+image.data[i+c]*(1-alpha)));image.data[i+3]=Math.round(255*alpha+image.data[i+3]*(1-alpha));}
      else{for(let c=0;c<3;c++)image.data[i+c]=transparent?s[offset+c]:applyROP(rop.code,pattern[c],s?.[offset+c]||0,image.data[i+c]);image.data[i+3]=transparent||rop.code===0xcc?s[offset+3]:0;}
    }
    }this.write(dst,r,image);return 1;
  }
  pixel(state,x,y,color){[x,y]=devicePoint(state,coord(x),coord(y));const r=this.clip(state,[x,y,x+1,y+1]);if(!r[2])return 0xffffffff;const image=this.read(state,r);if(color===undefined)return rgbValue(image.data);image.data.set(rgbBytes(color));this.write(state,r,image);return state.bitmap&&this.get(state.bitmap).bpp===1?rgbValue(this.read(state,r).data):color&0xffffff;}
  // Integer software primitives for memory DCs. Font rasterization remains a
  // Canvas/host facility; no platform font metrics are fabricated in workers.
  primitive(state,operation,args,style){
    if(!['line','rect','ellipse'].includes(operation))throw new Win32Error('Software memory DC does not support this primitive',50);
    let [x1,y1,x2,y2]=args.map(coord);const matrix=mapping(state),back=inverse(matrix);
    const width=style.pen.width||1,pad=operation==='line'?Math.ceil(width/2):0;
    const r=this.clip(state,mapBounds(matrix,[Math.min(x1,x2)-pad,Math.min(y1,y2)-pad,Math.max(x1,x2)+pad,Math.max(y1,y2)+pad]));if(!r[2])return;
    const effective=this.effective(state),image=this.read(state,r),pen=rgbBytes(style.pen.color||0),brush=rgbBytes(style.brush.color||0);
    const l=Math.min(x1,x2),t=Math.min(y1,y2),right=Math.max(x1,x2),bottom=Math.max(y1,y2),rx=(right-l)/2,ry=(bottom-t)/2;
    for(let y=0;y<image.height;y++){const spans=this.regions.row(effective,r[1]+y);for(let span=0;span<spans.length;span+=2)for(let x=Math.max(r[0],spans[span])-r[0];x<Math.min(r[2],spans[span+1])-r[0];x++){
      const vx=r[0]+x+.5,vy=r[1]+y+.5,px=back[0]*vx+back[2]*vy+back[4]-.5,py=back[1]*vx+back[3]*vy+back[5]-.5;let fill=false,stroke=false;
      if(operation==='rect'){fill=px>=l&&px<right&&py>=t&&py<bottom;stroke=fill&&(px<l+width||px>=right-width||py<t+width||py>=bottom-width);}
      else if(operation==='ellipse'){const nx=px+.5-l-rx,ny=py+.5-t-ry;fill=rx>0&&ry>0&&nx*nx/(rx*rx)+ny*ny/(ry*ry)<=1;stroke=fill&&(rx<=width||ry<=width||nx*nx/((rx-width)**2)+ny*ny/((ry-width)**2)>=1);}
      else {const dx=x2-x1,dy=y2-y1,len=dx*dx+dy*dy,u=len?((px-x1)*dx+(py-y1)*dy)/len:-1;stroke=u>=0&&u<1&&((px-x1-u*dx)**2+(py-y1-u*dy)**2)<=width*width/4;}
      if(stroke&&!style.pen.null)image.data.set(pen,(y*image.width+x)*4);else if(fill&&!style.brush.null)image.data.set(brush,(y*image.width+x)*4);
    }
    }this.write(state,r,image);
  }
}

return {GDI_CONSTANTS,coord,intersect,rgbBytes,rgbValue,ropInfo,BitmapStore};
})();

/* clipboard.js */
__modules[19]=(()=>{
const {Win32Error,unsigned}=__modules[0];

/** Synchronous, app-private clipboard. System clipboard synchronization is explicit. */
function installClipboard(w){
  const m=w.memory,h=w.handles;w.clipboard={open:false,owner:0,formats:new Map(),sequence:0};
  const c=w.clipboard,requireOpen=()=>{if(!c.open)throw new Win32Error('Clipboard is not open',1418);};
  const clear=()=>{for(const handle of c.formats.values()){if(h.has(handle,'memory')){const block=h.close(handle,'memory');m.free(block.ptr);}}c.formats.clear();};
  const add=(name,arity,fn)=>w.register('user32',name,fn,{arity,mode:'emulated',notes:'Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission.'});
  add('OpenClipboard',1,owner=>{if(owner)h.get(owner,'window');if(c.open)throw new Win32Error('Clipboard already open',5);c.open=true;c.pendingOwner=Number(owner);return 1;});
  add('CloseClipboard',0,()=>{requireOpen();c.open=false;return 1;});
  add('EmptyClipboard',0,()=>{requireOpen();clear();c.owner=c.pendingOwner;c.sequence++;return 1;});
  add('SetClipboardData',2,(format,handle)=>{requireOpen();format=unsigned(format);if(![1,13].includes(format))throw new Win32Error('Only text clipboard formats are implemented',50);if(!c.owner)throw new Win32Error('OpenClipboard needs a window owner before EmptyClipboard/SetClipboardData',5);const block=h.get(handle,'memory');if(block.prefix!=='Global'||block.clipboard||block.locks)throw new Win32Error('Clipboard requires unlocked moveable global memory',6);m.string(block.ptr,format===13);for(const old of new Set(c.formats.values())){const prior=h.close(old,'memory');m.free(prior.ptr);}c.formats.clear();block.clipboard=true;c.formats.set(format,Number(handle));c.sequence++;return handle;});
  const getData=format=>{requireOpen();format=unsigned(format);if(![1,13].includes(format))return 0;if(c.formats.has(format))return c.formats.get(format);const source=c.formats.entries().next().value;if(!source)return 0;const text=m.string(h.get(source[1],'memory').ptr,source[0]===13),p=m.allocString(text,format===13),handle=h.add('memory',{ptr:p,prefix:'Global',locks:0,clipboard:true});c.formats.set(format,handle);return handle;};
  add('GetClipboardData',1,getData);
  add('IsClipboardFormatAvailable',1,format=>[1,13].includes(Number(format))&&c.formats.size?1:0);
  add('CountClipboardFormats',0,()=>c.formats.size?2:0);
  add('EnumClipboardFormats',1,format=>{requireOpen();if(!c.formats.size)return 0;if(Number(format)===0)return 1;if(Number(format)===1)return 13;w.lastError=0;return 0;});
  add('GetClipboardOwner',0,()=>c.owner);
  add('GetOpenClipboardWindow',0,()=>c.open?c.pendingOwner:0);
  add('GetClipboardSequenceNumber',0,()=>c.sequence>>>0);
  w.getClipboardText=()=>{const first=c.formats.entries().next().value;return first?m.string(h.get(first[1],'memory').ptr,first[0]===13):'';};
  w.setClipboardText=text=>{if(c.open)throw new Win32Error('Clipboard already open',5);clear();if(text!==null){const ptr=m.allocString(String(text),true),handle=h.add('memory',{ptr,prefix:'Global',locks:0,clipboard:true});c.formats.set(13,handle);}c.sequence++;};
  // No automatic reads, writes, or permission prompts. Call from a user gesture.
  w.readSystemClipboard=async()=>{if(!w.options.allowClipboard||!w.options.clipboard?.readText)throw new Win32Error('System clipboard access is not enabled',5);const text=await w.options.clipboard.readText();if(w.disposed)throw new Win32Error('Disposed',995);w.setClipboardText(text);return text;};
  w.writeSystemClipboard=async()=>{if(!w.options.allowClipboard||!w.options.clipboard?.writeText)throw new Win32Error('System clipboard access is not enabled',5);return w.options.clipboard.writeText(w.getClipboardText());};
}

return {installClipboard};
})();

/* kernel32.js */
__modules[20]=(()=>{
const {ERROR,Win32Error,integer,unsigned}=__modules[0];

function installKernel32(w){
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

return {installKernel32};
})();

/* user32.js */
__modules[21]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];

/** Registered windows only: never queries or controls unrelated page DOM. */
function installUser32(w){
  const m=w.memory,h=w.handles;
  const add=(name,arity,fn,options={})=>w.register('user32',name,fn,{arity,mode:'browser',...options});
  const aw=(name,arity,fn,options={})=>{for(const wide of [false,true])add(name+(wide?'W':'A'),arity,(...args)=>fn(wide,...args),options);};
  const win=handle=>{if(!h.has(handle,'window'))throw new Win32Error('Invalid window handle',1400);return h.get(handle,'window');};
  const parent=entry=>Number(typeof entry.parent==='function'?entry.parent():entry.parent??0);
  const rect=entry=>{const r=entry.getRect?.()??entry.node?.getBoundingClientRect?.();if(!r)throw new Win32Error('Window has no geometry',50);return [r.left,r.top,r.right??r.left+r.width,r.bottom??r.top+r.height].map(Math.round);};
  const client=entry=>{const r=entry.getClientRect?.();if(r)return [r.left??0,r.top??0,r.right??r.width,r.bottom??r.height].map(Math.round);const n=entry.input||entry.node;return [0,0,n?.clientWidth||0,n?.clientHeight||0];};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));return 1;};
  const getText=entry=>String(entry.getText?.()??entry.input?.value??entry.node?.textContent??'');
  const setText=(entry,s)=>{if(entry.setText)entry.setText(s);else if(entry.input)entry.input.value=s;else if(entry.node)entry.node.textContent=s;else throw new Win32Error('Window text is not writable',50);return 1;};
  const visible=entry=>entry.isVisible?!!entry.isVisible():!entry.node?.hidden;
  const enabled=entry=>entry.isEnabled?!!entry.isEnabled():!entry.input?.disabled;
  add('IsWindow',1,handle=>h.has(handle,'window')?1:0);
  add('IsWindowVisible',1,handle=>{let entry=win(handle),seen=new Set();while(entry){if(seen.has(entry)||!visible(entry))return 0;seen.add(entry);const p=parent(entry);entry=p?win(p):null;}return 1;});
  add('IsWindowEnabled',1,handle=>enabled(win(handle))?1:0);
  add('EnableWindow',2,(handle,on)=>{const entry=win(handle),wasDisabled=!enabled(entry);if(entry.setEnabled)entry.setEnabled(!!on);else if(entry.input)entry.input.disabled=!on;else throw new Win32Error('Window enabled state is not writable',50);return wasDisabled?1:0;});
  add('ShowWindow',2,(handle,command)=>{const entry=win(handle);command=integer(command,0,11);const was=visible(entry);if(entry.show)entry.show(command);else if([0,1,5,8,9].includes(command)&&entry.node)entry.node.hidden=command===0;else throw new Win32Error('Show command needs a window adapter',50);return was?1:0;});
  aw('GetWindowText',3,(wide,handle,out,n)=>m.putString(out,getText(win(handle)),n,wide));
  aw('SetWindowText',2,(wide,handle,p)=>setText(win(handle),m.string(p,wide)));
  aw('GetWindowTextLength',1,(wide,handle)=>m.stringBytes(getText(win(handle)),wide).length/(wide?2:1));
  aw('GetClassName',3,(wide,handle,out,n)=>m.putString(out,win(handle).className||'Window',n,wide));
  const find=(wide,parentHandle,after,klass,title,topOnly)=>{if(parentHandle)win(parentHandle);if(after)win(after);let passed=!after;for(const [id,e]of h.entries){if(e.type!=='window')continue;if(!passed){if(id===Number(after))passed=true;continue;}const entry=e.value,p=parent(entry);if(topOnly?p!==0:p!==Number(parentHandle))continue;if(klass&&String(entry.className||'Window').toLowerCase()!==m.string(klass,wide).toLowerCase())continue;if(title&&getText(entry).toLowerCase()!==m.string(title,wide).toLowerCase())continue;return id;}return 0;};
  aw('FindWindow',2,(wide,klass,title)=>find(wide,0,0,klass,title,true));
  aw('FindWindowEx',4,(wide,p,after,klass,title)=>find(wide,p,after,klass,title,false));
  add('GetParent',1,handle=>parent(win(handle)));
  add('IsChild',2,(ancestor,handle)=>{win(ancestor);let p=parent(win(handle)),seen=new Set();while(p&&!seen.has(p)){if(p===Number(ancestor))return 1;seen.add(p);p=parent(win(p));}return 0;});
  add('GetDlgCtrlID',1,handle=>win(handle).controlId||0);
  add('GetDlgItem',2,(handle,id)=>{win(handle);for(const [key,e]of h.entries)if(e.type==='window'&&parent(e.value)===Number(handle)&&e.value.controlId===Number(id))return key;return 0;});
  add('GetWindowRect',2,(handle,p)=>writeRect(p,rect(win(handle))));
  add('GetClientRect',2,(handle,p)=>writeRect(p,client(win(handle))));
  for(const screen of [false,true])add(screen?'ClientToScreen':'ScreenToClient',2,(handle,p)=>{const entry=win(handle),origin=entry.clientOrigin?.()||rect(entry).slice(0,2),v=m.view(p,8),sign=screen?1:-1;v.setInt32(0,v.getInt32(0,true)+origin[0]*sign,true);v.setInt32(4,v.getInt32(4,true)+origin[1]*sign,true);return 1;});
  const move=(entry,x,y,width,height,repaint)=>{for(const n of [x,y,width,height])integer(n,-2147483648,2147483647);if(width<0||height<0)throw new Win32Error('Negative window size');if(entry.move)entry.move(x,y,width,height,!!repaint);else if(entry.node)Object.assign(entry.node.style,{position:'absolute',left:x+'px',top:y+'px',width:width+'px',height:height+'px'});else throw new Win32Error('Window cannot move',50);return 1;};
  add('MoveWindow',6,(handle,x,y,width,height,repaint)=>move(win(handle),x,y,width,height,repaint));
  add('SetWindowPos',7,(handle,after,x,y,width,height,flags)=>{const entry=win(handle);flags=unsigned(flags);if(flags&~0xdf)throw new Win32Error('Unsupported positioning flags',50);if(!(flags&4)&&![0,1,-1,-2,0xffffffff,0xfffffffe].includes(Number(after)))throw new Win32Error('Arbitrary sibling ordering is not supported',50);const r=entry.getPosition?.()||rect(entry);if(flags&2){x=r[0];y=r[1];}if(flags&1){width=r[2]-r[0];height=r[3]-r[1];}move(entry,x,y,width,height,!(flags&8));if(!(flags&4)&&entry.node)entry.node.style.zIndex=[-1,0xffffffff].includes(Number(after))?'10000':Number(after)===1?'0':'';if(flags&0x40)w.invoke('user32','ShowWindow',[handle,5]);if(flags&0x80)w.invoke('user32','ShowWindow',[handle,0]);return 1;},{notes:'App-local position and CSS stacking; no desktop topmost guarantee.'});
  add('GetFocus',0,()=>{for(const [id,e]of h.entries)if(e.type==='window'){const n=e.value.input||e.value.node;if(n&&n.ownerDocument?.activeElement===n)return id;}return 0;});
  add('SetFocus',1,handle=>{const prior=w.invoke('user32','GetFocus',[]);if(!handle){for(const e of h.entries.values())if(e.type==='window')e.value.input?.blur?.();return prior;}const entry=win(handle);if(!enabled(entry))throw new Win32Error('Window is disabled',5);const node=entry.input||entry.node;if(!node?.focus)throw new Win32Error('Focus not supported',50);node.focus();return prior;});
  add('GetForegroundWindow',0,()=>{let handle=w.invoke('user32','GetFocus',[]);while(handle&&parent(win(handle)))handle=parent(win(handle));return handle;});
  add('SetForegroundWindow',1,handle=>{const entry=win(handle);if(entry.activate)entry.activate();else (entry.input||entry.node)?.focus?.();return 1;},{notes:'Activates only an app-local window, not the OS browser window.'});
  aw('GetWindowLong',2,(wide,handle,index)=>{const e=win(handle);if(![-16,-20,-21,-12].includes(Number(index)))throw new Win32Error('Window procedure/instance addresses are unavailable',50);if([-16,-20].includes(Number(index))&&!e.longs?.has(Number(index)))throw new Win32Error('Window style values need an explicit adapter',50);return Number(index)===-12?e.controlId||0:(e.longs?.get(Number(index))||0);});
  aw('SetWindowLong',3,(wide,handle,index,value)=>{const e=win(handle);if(![-21,-12].includes(Number(index)))throw new Win32Error('Only user data and control IDs are writable; subclassing is unsupported',50);const old=Number(index)===-12?e.controlId||0:e.longs?.get(Number(index))||0;if(Number(index)===-12)e.controlId=Number(value);else{e.longs||=new Map();e.longs.set(Number(index),Number(value)|0);}w.lastError=0;return old;});
  add('GetSystemMetrics',1,index=>{const view=w.options.window||globalThis.window;const metrics={0:view?.innerWidth??1024,1:view?.innerHeight??768,5:1,6:1,16:view?.innerWidth??1024,17:view?.innerHeight??768,19:1,43:3,78:view?.innerWidth??1024,79:view?.innerHeight??768,80:1};if(!(index in metrics))throw new Win32Error('System metric is not implemented',50);return metrics[index];},{notes:'CSS-pixel app viewport metrics, not physical desktop measurements.'});
  aw('MessageBox',4,(wide,handle,message,title,type)=>{if(handle)win(handle);if(!w.options.messageBox)throw new Win32Error('Message box adapter unavailable',50);return w.options.messageBox(m.string(message,wide),unsigned(type),m.string(title,wide));});
  aw('SendMessage',4,async(wide,handle,msg,wp,lp)=>{
    const e=win(handle);msg=unsigned(msg);
    if(msg===12)return setText(e,m.string(lp,wide));
    if(msg===13)return m.putString(lp,getText(e),wp,wide);
    if(msg===14)return m.stringBytes(getText(e),wide).length/(wide?2:1);
    if(msg===0xb0){const start=e.input?.selectionStart??0,end=e.input?.selectionEnd??0;if(wp)m.writeU32(wp,start);if(lp)m.writeU32(lp,end);return start>65535||end>65535?-1:(end<<16)|start;}
    if(msg===0xb1){if(!e.input?.setSelectionRange)throw new Win32Error('Not an edit control',50);let start=Number(wp)|0,end=Number(lp)|0;if(start===-1)start=end=e.input.selectionEnd??0;else if(end===-1)end=getText(e).length;e.input.setSelectionRange(start,end);return 0;}
    if(msg===0xc2){if(!e.input?.setSelectionRange)throw new Win32Error('Not an edit control',50);const value=getText(e),start=e.input.selectionStart??0,end=e.input.selectionEnd??0,replacement=m.string(lp,wide);setText(e,value.slice(0,start)+replacement+value.slice(end));e.input.setSelectionRange(start+replacement.length,start+replacement.length);return 0;}
    if(msg===0xf0){if(!e.getCheck)throw new Win32Error('Not a checkable button',50);return e.getCheck();}
    if(msg===0xf1){if(!e.setCheck)throw new Win32Error('Not a checkable button',50);e.setCheck(integer(wp,0,2));return 0;}
    if(msg===0xf5){if(e.click)await e.click();else if(e.input?.click)e.input.click();else throw new Win32Error('Not a button',50);return 0;}
    if(e.message){const result=await e.message(msg,wp,lp,wide);if(result!==undefined)return result;}
    throw new Win32Error('Window message '+msg+' is not implemented',50);
  },{notes:'WM text, edit selection/replacement and button check/click messages; unknown messages fail explicitly.'});
  add('EnumWindows',2,async(callback,data)=>{const fn=h.get(callback,'callback');for(const [id,e]of [...h.entries])if(e.type==='window'&&!parent(e.value)&&h.has(id,'window'))if(!await fn(id,data))return 0;return 1;});
  add('SetTimer',4,(handle,id,ms,callback)=>{if(handle)win(handle);if(!callback)throw new Win32Error('WM_TIMER message queue is not implemented; supply a callback',50);h.get(callback,'callback');id=handle&&id?unsigned(id):w.nextTimer++;const key=handle+':'+id;if(w.timers.has(key))clearInterval(w.timers.get(key).timer);if(w.timers.size>=1024)throw new Win32Error('Timer quota exceeded',8);const state={handle,id,callback,busy:false,timer:null};state.timer=setInterval(async()=>{if(state.busy||w.disposed)return;state.busy=true;try{await (w.timerCallbacks.get(callback)||h.get(callback,'callback'))(handle,0x113,id,Math.floor(w.clock()-w.epoch)>>>0);}catch(error){w.options.onError?.(error);}finally{state.busy=false;}},Math.max(10,Math.min(unsigned(ms),0x7fffffff)));w.timers.set(key,state);return id;},{notes:'Browser timers are throttled in background tabs; callbacks are coalesced.'});
  add('KillTimer',2,(handle,id)=>{const key=handle+':'+unsigned(id),state=w.timers.get(key);if(!state)return 0;clearInterval(state.timer);w.timers.delete(key);return 1;});
  installRectangles(w,add);
}
function installRectangles(w,add){
  const m=w.memory,read=p=>{const v=m.view(p,16);return [0,4,8,12].map(i=>v.getInt32(i,true));},write=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));return 1;},empty=r=>r[0]>=r[2]||r[1]>=r[3];
  add('SetRect',5,(p,l,t,r,b)=>write(p,[l,t,r,b]),{mode:'emulated'});
  add('SetRectEmpty',1,p=>write(p,[0,0,0,0]),{mode:'emulated'});
  add('CopyRect',2,(a,b)=>write(a,read(b)),{mode:'emulated'});
  add('OffsetRect',3,(p,x,y)=>write(p,read(p).map((v,i)=>v+Number(i%2?y:x))),{mode:'emulated'});
  add('InflateRect',3,(p,x,y)=>write(p,read(p).map((v,i)=>v+Number(i%2?y:x)*(i<2?-1:1))),{mode:'emulated'});
  add('IsRectEmpty',1,p=>empty(read(p))?1:0,{mode:'emulated'});
  add('EqualRect',2,(a,b)=>{const x=read(a),y=read(b);return x.every((v,i)=>v===y[i])?1:0;},{mode:'emulated'});
  add('PtInRect',3,(p,x,y)=>{const r=read(p);return x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3]?1:0;},{mode:'emulated',notes:'POINT is passed by value as two 32-bit arguments.'});
  add('IntersectRect',3,(p,a,b)=>{const x=read(a),y=read(b),r=[Math.max(x[0],y[0]),Math.max(x[1],y[1]),Math.min(x[2],y[2]),Math.min(x[3],y[3])],none=empty(r);write(p,none?[0,0,0,0]:r);return none?0:1;},{mode:'emulated'});
  add('UnionRect',3,(p,a,b)=>{const x=read(a),y=read(b),r=empty(x)?y:empty(y)?x:[Math.min(x[0],y[0]),Math.min(x[1],y[1]),Math.max(x[2],y[2]),Math.max(x[3],y[3])],none=empty(r);write(p,none?[0,0,0,0]:r);return none?0:1;},{mode:'emulated'});
}

return {installUser32};
})();

/* advapi32.js */
__modules[22]=(()=>{
const {Win32Error,integer,unsigned}=__modules[0];

/** App-private registry: no machine registry is read or modified. */
function installRegistry(w){
  const m=w.memory,h=w.handles,roots=new Map([[0x80000000,'HKCR'],[0x80000001,'HKCU'],[0x80000002,'HKLM'],[0x80000003,'HKU'],[0x80000005,'HKCC']]);
  const store=w.registry=new Map([...roots.values()].map(name=>[name,{name,values:new Map()}]));
  const allowed=0xf003f; // KEY_ALL_ACCESS excluding WOW64 view selectors.
  const keyOf=(handle,access=0)=>{handle=unsigned(handle);if(roots.has(handle))return roots.get(handle);const e=h.get(handle,'registry');if((e.access&access)!==access)throw new Win32Error('Registry handle access denied',5);if(!store.has(e.path))throw new Win32Error('Registry key was deleted',1018);return e.path;};
  const sub=(base,name)=>{const parts=String(name).replace(/\//g,'\\').split('\\').filter(Boolean);if(parts.some(p=>p==='.'||p==='..'))throw new Win32Error('Invalid registry key');return base+(parts.length?'\\'+parts.join('\\').toLowerCase():'');};
  const save=()=>w.options.onRegistryChange?.(w.registrySnapshot());
  const add=(name,arity,fn)=>w.register('advapi32',name,fn,{arity,statusError:true,mode:'emulated',notes:'Isolated application registry, not the operating-system registry.'});
  const aw=(name,arity,fn)=>{for(const wide of [false,true])add(name+(wide?'W':'A'),arity,(...a)=>fn(wide,...a));};
  const accessOf=access=>{access=unsigned(access);if(access&~allowed)throw new Win32Error('Unsupported registry access flags',50);return access;};
  aw('RegCreateKeyEx',9,(wide,root,name,reserved,klass,options,access,security,result,disposition)=>{if(reserved||klass||options||security)throw new Win32Error('Registry security/classes/options are not supported',50);access=accessOf(access);m.view(result,4);if(disposition)m.view(disposition,4);const base=keyOf(root,4),text=m.string(name,wide),path=sub(base,text),existed=store.has(path),parts=path.split('\\'),names=text.replace(/\//g,'\\').split('\\').filter(Boolean),depth=base.split('\\').length;for(let i=1;i<=parts.length;i++){const p=parts.slice(0,i).join('\\');if(!store.has(p))store.set(p,{name:names[i-depth-1]??parts[i-1],values:new Map()});}const handle=h.add('registry',{path,access});m.writeU32(result,handle);if(disposition)m.writeU32(disposition,existed?2:1);save();return 0;});
  aw('RegOpenKeyEx',5,(wide,root,name,options,access,result)=>{if(options)throw new Win32Error('Registry options unsupported',50);access=accessOf(access);m.view(result,4);const path=sub(keyOf(root),m.string(name,wide));if(!store.has(path))return 2;m.writeU32(result,h.add('registry',{path,access}));return 0;});
  add('RegCloseKey',1,handle=>{if(!roots.has(unsigned(handle)))h.close(handle,'registry');return 0;});
  aw('RegSetValueEx',6,(wide,handle,name,reserved,type,data,size)=>{if(reserved)throw new Win32Error('Reserved must be zero');type=unsigned(type);if(![1,2,3,4,7,11].includes(type))throw new Win32Error('Registry type not implemented',50);size=integer(size,0,w.maxFileBytes);const path=keyOf(handle,2),bytes=size?m.bytes(data,size):new Uint8Array();if(type===4&&size!==4||type===11&&size!==8)throw new Win32Error('Invalid registry integer size');if(wide&&[1,2,7].includes(type)&&size%2)throw new Win32Error('Invalid Unicode registry value');const value=[1,2,7].includes(type)?m.decode(bytes,wide):Array.from(bytes);store.get(path).values.set(m.string(name,wide).toLowerCase(),{name:m.string(name,wide),type,value});save();return 0;});
  aw('RegQueryValueEx',6,(wide,handle,name,reserved,typeOut,data,sizeOut)=>{if(reserved||data&&!sizeOut)throw new Win32Error('Invalid registry query arguments');const path=keyOf(handle,1),entry=store.get(path).values.get(m.string(name,wide).toLowerCase());if(!entry)return 2;const bytes=typeof entry.value==='string'?m.stringBytes(entry.value,wide):Uint8Array.from(entry.value);if(typeOut)m.view(typeOut,4);let capacity=sizeOut?m.readU32(sizeOut):0;if(data)m.bytes(data,capacity);if(typeOut)m.writeU32(typeOut,entry.type);if(sizeOut)m.writeU32(sizeOut,bytes.length);if(!data)return 0;if(capacity<bytes.length)return 234;m.bytes(data,bytes.length).set(bytes);return 0;});
  aw('RegDeleteValue',2,(wide,handle,name)=>{const path=keyOf(handle,2);if(!store.get(path).values.delete(m.string(name,wide).toLowerCase()))return 2;save();return 0;});
  aw('RegDeleteKey',2,(wide,handle,name)=>{const path=sub(keyOf(handle,4),m.string(name,wide));if(roots.has(unsigned(handle))&&!m.string(name,wide))return 5;if(!store.has(path))return 2;if([...store.keys()].some(k=>k.startsWith(path+'\\')))return 5;store.delete(path);save();return 0;});
  aw('RegEnumKeyEx',8,(wide,handle,index,name,size,reserved,klass,classSize,time)=>{if(reserved||klass||classSize||time)throw new Win32Error('Registry class/timestamp enumeration is not implemented',50);const path=keyOf(handle,8),children=[...store].filter(([k])=>k.startsWith(path+'\\')&&!k.slice(path.length+1).includes('\\')),entry=children[integer(index)]?.[1];if(!entry)return 259;const capacity=m.readU32(size),n=m.stringBytes(entry.name,wide).length/(wide?2:1);if(capacity<=n)return 234;m.putString(name,entry.name,capacity,wide);m.writeU32(size,n);return 0;});
  // Enumeration contracts: https://learn.microsoft.com/windows/win32/api/winreg/nf-winreg-regenumvaluea
  // https://learn.microsoft.com/windows/win32/api/winreg/nf-winreg-regqueryinfokeya
  const childrenOf=path=>[...store].filter(([key])=>key.startsWith(path+'\\')&&!key.slice(path.length+1).includes('\\')).map(([,value])=>value);
  const encoded=(entry,wide)=>typeof entry.value==='string'?m.stringBytes(entry.value,wide):Uint8Array.from(entry.value);
  aw('RegEnumValue',8,(wide,handle,index,name,nameSize,reserved,type,data,dataSize)=>{
    if(reserved||data&&!dataSize)throw new Win32Error('Invalid enumeration parameters');
    const path=keyOf(handle,1),entry=[...store.get(path).values.values()][integer(index)];if(!entry)return 259;
    const capacity=m.readU32(nameSize),bytes=encoded(entry,wide),length=m.stringBytes(entry.name,wide).length/(wide?2:1);
    const dataCapacity=dataSize?m.readU32(dataSize):0;if(type)m.view(type,4);
    if(name)m.bytes(name,capacity*(wide?2:1));else throw new Win32Error('Name buffer required');
    if(data)m.bytes(data,dataCapacity);
    if(type)m.writeU32(type,entry.type);if(dataSize)m.writeU32(dataSize,bytes.length);
    if(capacity<=length||data&&dataCapacity<bytes.length)return 234;
    m.putString(name,entry.name,capacity,wide);m.writeU32(nameSize,length);if(data)m.bytes(data,bytes.length).set(bytes);return 0;
  });
  aw('RegEnumKey',4,(wide,handle,index,name,capacity)=>{
    const entry=childrenOf(keyOf(handle,8))[integer(index)];if(!entry)return 259;
    capacity=unsigned(capacity);if(capacity<=m.stringBytes(entry.name,wide).length/(wide?2:1))return 234;
    m.putString(name,entry.name,capacity,wide);return 0;
  });
  aw('RegQueryInfoKey',12,(wide,handle,klass,classSize,reserved,subkeys,maxSubkey,maxClass,values,maxName,maxData,security,time)=>{
    if(reserved||klass&&!classSize)throw new Win32Error('Invalid key information parameters');
    if(security||time)throw new Win32Error('Native security descriptors and timestamps are not available',50);
    const path=keyOf(handle,1),children=childrenOf(path),entries=[...store.get(path).values.values()];
    const capacity=classSize?m.readU32(classSize):0;
    for(const p of [subkeys,maxSubkey,maxClass,values,maxName,maxData])if(p)m.view(p,4);
    if(klass)m.bytes(klass,capacity*(wide?2:1));
    const length=text=>m.stringBytes(text,wide).length/(wide?2:1);
    const maximum=(items,fn)=>items.reduce((max,item)=>Math.max(max,fn(item)),0);
    const outputs=[[subkeys,children.length],[maxSubkey,maximum(children,e=>length(e.name))],[maxClass,0],[values,entries.length],[maxName,maximum(entries,e=>length(e.name))],[maxData,maximum(entries,e=>encoded(e,wide).length)]];
    for(const [pointer,value]of outputs)if(pointer)m.writeU32(pointer,value);
    if(classSize)m.writeU32(classSize,0);if(klass){if(!capacity)return 234;m.putString(klass,'',capacity,wide);}return 0;
  });
  add('RegFlushKey',1,handle=>{keyOf(handle,1);save();return 0;});

}

return {installRegistry};
})();

/* gdi32.js */
__modules[23]=(()=>{
const {installTransforms,mapping,translatedOnly,IDENTITY}=__modules[12];
const {installPaths}=__modules[13];
const {installText}=__modules[14];
const {installPainting}=__modules[15];
const {Win32Error,integer,unsigned}=__modules[0];
const {RegionStore,installRegions}=__modules[17];
const {BitmapStore,GDI_CONSTANTS,coord,intersect,rgbBytes,rgbValue,ropInfo}=__modules[18];







function colorRef(value){const n=unsigned(value);return '#'+[n&255,n>>>8&255,n>>>16&255].map(v=>v.toString(16).padStart(2,'0')).join('');}
function installGDI(w){
  const h=w.handles,m=w.memory,regions=new RegionStore(w.options),bitmaps=new BitmapStore(w,regions);
  const add=(name,arity,fn,options={})=>w.register('gdi32',name,fn,{arity,mode:'emulated',...options});
  const stocks=new Map(),stock=(index,type,value)=>stocks.set(index,h.add(type,{...value,stock:true}));
  stock(0,'brush',{color:0xffffff});stock(4,'brush',{color:0});stock(5,'brush',{null:true});stock(6,'pen',{color:0xffffff,width:1});stock(7,'pen',{color:0,width:1});stock(8,'pen',{null:true,width:1});
  const dc=handle=>h.get(handle,'dc');
  const newState=()=>({pen:stocks.get(7),brush:stocks.get(0),bitmap:0,font:0,x:0,y:0,world:IDENTITY,graphicsMode:1,mapMode:1,windowX:0,windowY:0,windowExtX:1,windowExtY:1,viewportExtX:1,viewportExtY:1,polyFillMode:1,textAlign:0,charExtra:0,viewportX:0,viewportY:0,clip:null,saved:[],stretchMode:1,textColor:0,backgroundColor:0xffffff,backgroundMode:2});
  const states=()=>[...h.entries.values()].filter(e=>e.type==='dc').flatMap(e=>[e.value,...e.value.saved]);
  const selected=object=>states().some(s=>s.pen===Number(object)||s.brush===Number(object)||s.bitmap===Number(object)||s.font===Number(object));
  const style=state=>({pen:h.get(state.pen,'pen'),brush:h.get(state.brush,'brush'),textColor:state.textColor,backgroundColor:state.backgroundColor,backgroundMode:state.backgroundMode});
  const draw=(state,operation,args)=>{
    if(!translatedOnly(state)||state.window?.gdiClientShape||state.paintClip||operation==='ellipse'&&state.window?.readPixels){if(operation==='pixel')return bitmaps.pixel(state,...args);return bitmaps.primitive(state,operation,args,style(state));}
    if(state.bitmap){if(operation==='pixel'){bitmaps.pixel(state,args[0],args[1],args[2]);return;}return bitmaps.primitive(state,operation,args,style(state));}
    // Hosts with a raster adapter also receive correct clipping. Legacy draw-only
    // descriptors continue to work for the original unclipped drawing surface.
    if(state.clip){if(operation==='pixel'){bitmaps.pixel(state,args[0],args[1],args[2]);return;}return bitmaps.primitive(state,operation,args,style(state));}
    args=[...args];const transform=mapping(state);args[0]+=transform[4];args[1]+=transform[5];if(['line','rect','ellipse'].includes(operation)){args[2]+=transform[4];args[3]+=transform[5];}
    const s=style(state);if(state.window.draw)return state.window.draw(operation,args,s);
    const ctx=bitmaps.context(state);ctx.save();try{
      ctx.strokeStyle=colorRef(s.pen.color||0);ctx.lineWidth=s.pen.width||1;ctx.fillStyle=colorRef(s.brush.color||0);
      switch(operation){
        case 'line':ctx.beginPath();ctx.moveTo(args[0],args[1]);ctx.lineTo(args[2],args[3]);if(!s.pen.null)ctx.stroke();break;
        case 'rect':if(!s.brush.null)ctx.fillRect(args[0],args[1],args[2]-args[0],args[3]-args[1]);if(!s.pen.null)ctx.strokeRect(args[0],args[1],args[2]-args[0],args[3]-args[1]);break;
        case 'ellipse':ctx.beginPath();ctx.ellipse((args[0]+args[2])/2,(args[1]+args[3])/2,Math.abs(args[2]-args[0])/2,Math.abs(args[3]-args[1])/2,0,0,Math.PI*2);if(!s.brush.null)ctx.fill();if(!s.pen.null)ctx.stroke();break;
        case 'pixel':ctx.fillStyle=colorRef(args[2]);ctx.fillRect(args[0],args[1],1,1);break;
        case 'text':ctx.font='12px Arial';ctx.textBaseline='top';if(s.backgroundMode===2){ctx.fillStyle=colorRef(s.backgroundColor);ctx.fillRect(args[0],args[1],ctx.measureText(args[2]).width,14);}ctx.fillStyle=colorRef(s.textColor);ctx.fillText(args[2],args[0],args[1]);break;
        default:throw new Win32Error('Unsupported drawing operation',50);
      }
    }finally{ctx.restore();}
  };
  add('GetStockObject',1,index=>{if(!stocks.has(Number(index)))throw new Win32Error('Stock object is not implemented',50);return stocks.get(Number(index));});
  add('CreateSolidBrush',1,color=>h.add('brush',{color:unsigned(color)&0xffffff}));
  add('CreatePen',3,(style,width,color)=>{if(![0,5].includes(Number(style)))throw new Win32Error('Only solid and null pens are supported',50);return h.add('pen',{null:Number(style)===5,width:Math.max(1,integer(width,0,4096)),color:unsigned(color)&0xffffff});});
  w.register('user32','GetDC',handle=>{const window=h.get(handle,'window');if(!window.draw&&!window.context&&!window.node?.getContext&&!window.writePixels)throw new Win32Error('No drawing adapter',50);return h.add('dc',{...newState(),window,handle:Number(handle)});},{arity:1,mode:'browser'});
  w.register('user32','ReleaseDC',(handle,hdc)=>{const state=dc(hdc);if(state.memory||state.handle!==Number(handle))throw new Win32Error('DC does not belong to window',6);h.close(hdc,'dc');return 1;},{arity:2,mode:'browser'});
  add('CreateCompatibleDC',1,handle=>{if(handle)dc(handle);if(h.entries.size+2>h.limit)throw new Win32Error('Handle quota exceeded',8);const bitmap=bitmaps.create(1,1,1,{stock:true});try{const id=h.add('dc',{...newState(),memory:true,bitmap,defaultBitmap:bitmap});bitmaps.get(bitmap).defaultFor=id;return id;}catch(error){m.free(bitmaps.get(bitmap).ptr);h.close(bitmap,'bitmap');throw error;}});
  const deleteDC=handle=>{const state=dc(handle);if(!state.memory)throw new Win32Error('Use ReleaseDC for a window DC',6);m.free(bitmaps.get(state.defaultBitmap).ptr);h.close(state.defaultBitmap,'bitmap');h.close(handle,'dc');return 1;};
  add('DeleteDC',1,deleteDC);
  add('SelectObject',2,(handle,object)=>{const state=dc(handle),entry=h.entries.get(Number(object));if(entry?.type==='region')return regionAPI.select(state,object,5);if(!entry||!['pen','brush','bitmap','font'].includes(entry.type))throw new Win32Error('Invalid GDI object',6);if(entry.type==='bitmap'){
      if(!state.memory||entry.value.defaultFor&&entry.value.defaultFor!==Number(handle))throw new Win32Error('Bitmap cannot be selected into this DC',87);
      for(const [id,e]of h.entries)if(e.type==='dc'&&id!==Number(handle)&&[e.value,...e.value.saved].some(s=>s.bitmap===Number(object)))throw new Win32Error('Bitmap is selected into another DC',87);
    }const old=state[entry.type];state[entry.type]=Number(object);return old;});
  add('DeleteObject',1,object=>{const entry=h.entries.get(Number(object));if(entry?.type==='dc')return deleteDC(object);if(!entry||!['pen','brush','bitmap','region','font'].includes(entry.type))throw new Win32Error('Invalid GDI object',6);if(entry.value.stock)return 1;if(entry.value.windowOwner)throw new Win32Error('Region ownership belongs to a window',5);if(selected(object))return 0;if(entry.type==='bitmap')m.free(entry.value.ptr);h.close(object,entry.type);return 1;});
  add('GetCurrentObject',2,(handle,type)=>{const state=dc(handle),field={1:'pen',2:'brush',6:'font',7:'bitmap'}[Number(type)];if(!field)throw new Win32Error('Object type is not implemented',50);return state[field]||0;});
  add('GetObjectType',1,handle=>{const e=h.entries.get(Number(handle));if(!e)throw new Win32Error('Invalid GDI handle',6);return e.type==='dc'?(e.value.memory?10:3):({pen:1,brush:2,font:6,bitmap:7,region:8})[e.type]||0;});
  const bitmapInfo=(b,p)=>{const v=m.view(p,40);v.setUint32(0,40,true);v.setInt32(4,b.width,true);v.setInt32(8,b.topDown?-b.height:b.height,true);v.setUint16(12,1,true);v.setUint16(14,b.bpp,true);v.setUint32(16,0,true);v.setUint32(20,Math.ceil(b.width*b.bpp/32)*4*b.height,true);for(let o=24;o<40;o+=4)v.setUint32(o,0,true);};
  for(const suffix of ['A','W'])add('GetObject'+suffix,3,(object,count,out)=>{const e=h.entries.get(Number(object));if(!e||!['pen','brush','bitmap'].includes(e.type))throw new Win32Error('Unsupported GDI object',6);const b=e.value,size=e.type==='pen'?16:e.type==='brush'?12:24;if(!out)return size;count=integer(count,0,0x7fffffff);const n=e.type==='bitmap'&&b.dib&&count>=84?84:size;if(count<n||unsigned(out)%4)throw new Win32Error('Invalid GDI object buffer');const v=m.view(out,n);m.bytes(out,n).fill(0);
    if(e.type==='pen'){v.setUint32(0,b.null?5:0,true);v.setInt32(4,b.width||1,true);v.setUint32(12,b.color||0,true);}
    else if(e.type==='brush'){v.setUint32(0,b.null?1:0,true);v.setUint32(4,b.color||0,true);}
    else{v.setInt32(4,b.width,true);v.setInt32(8,b.height,true);v.setInt32(12,b.stride,true);v.setUint16(16,1,true);v.setUint16(18,b.bpp,true);v.setUint32(20,b.dib?b.ptr:0,true);if(n===84)bitmapInfo(b,out+24);}return n;
  });
  add('CreateBitmap',5,(width,height,planes,bpp,bits)=>{if(integer(planes,1,0xffff)!==1)throw new Win32Error('Multiple bitmap planes are not supported',50);width=integer(width,0,32767);height=integer(height,0,32767);return !width||!height?bitmaps.create(1,1,1):bitmaps.create(width,height,Number(bpp),{bits});});
  add('CreateCompatibleBitmap',3,(handle,width,height)=>{const state=dc(handle);width=integer(width,0,32767);height=integer(height,0,32767);if(!width||!height)return bitmaps.create(1,1,1);const source=state.bitmap?bitmaps.get(state.bitmap):null;return bitmaps.create(width,height,source?.bpp||32,{dib:!!source?.dib,topDown:source?.topDown??true});});
  add('CreateDIBSection',6,(handle,info,usage,out,section,offset)=>{m.writeU32(out,0);if(handle)dc(handle);if(section)throw new Win32Error('File-mapped DIB sections are not supported',50);unsigned(offset);const b=bitmaps.header(info,usage),id=bitmaps.create(b.width,b.height,b.bpp,{dib:true,topDown:b.topDown});m.writeU32(out,bitmaps.get(id).ptr);return id;});
  // Get/SetBitmapBits expose top-down WORD-aligned DDB rows, including for DIBs.
  const rawLayout=b=>({...b,...bitmaps.geometry(b.width,b.height,b.bpp,false),topDown:true});
  add('GetBitmapBits',3,(object,count,out)=>{const b=bitmaps.get(object),raw=rawLayout(b);count=integer(count,0,0x7fffffff);if(!out)return raw.size;const n=Math.min(count,raw.size);if(!n)return 0;const bytes=new Uint8Array(raw.size),src=bitmaps.data(b);for(let y=0;y<b.height;y++)bytes.set(src.subarray((b.topDown?y:b.height-1-y)*b.stride,(b.topDown?y:b.height-1-y)*b.stride+Math.min(raw.stride,b.stride)),y*raw.stride);m.bytes(out,n).set(bytes.subarray(0,n));return n;});
  add('SetBitmapBits',3,(object,count,input)=>{const b=bitmaps.get(object),raw=rawLayout(b);count=integer(count,0,0x7fffffff);const n=Math.min(count,raw.size);if(!n)return 0;const bytes=m.bytes(input,n).slice(),dst=bitmaps.data(b);for(let pos=0;pos<n;pos++){const y=Math.floor(pos/raw.stride),x=pos%raw.stride;dst[(b.topDown?y:b.height-1-y)*b.stride+x]=bytes[pos];}return n;});
  const pair=(p,a,b)=>{const v=m.view(p,8);v.setInt32(0,a,true);v.setInt32(4,b,true);};
  add('GetBitmapDimensionEx',2,(object,out)=>{const b=bitmaps.get(object);pair(out,b.dimensionX,b.dimensionY);return 1;});
  add('SetBitmapDimensionEx',4,(object,x,y,out)=>{const b=bitmaps.get(object);x=coord(x);y=coord(y);if(out)pair(out,b.dimensionX,b.dimensionY);b.dimensionX=x;b.dimensionY=y;return 1;});
  const requireUnselected=object=>{if(selected(object))throw new Win32Error('DIB transfer requires an unselected bitmap',87);};
  add('GetDIBits',7,(handle,object,start,lines,out,info,usage)=>{
    dc(handle);const b=bitmaps.get(object);requireUnselected(object);integer(start,0,0xffffffff);integer(lines,0,0xffffffff);if(unsigned(usage)!==0)throw new Win32Error('Logical palettes are not supported',50);
    const v=m.view(info,40);if(v.getUint32(0,true)!==40)throw new Win32Error('Only BITMAPINFOHEADER is supported',50);
    if(!out&&!v.getUint16(14,true)){bitmapInfo({...b,topDown:false},info);return 1;}
    const format=bitmaps.header(info,usage);if(format.width!==b.width||format.height!==b.height)throw new Win32Error('DIB transfer dimensions must match bitmap',50);
    if(!out){bitmapInfo(format,info);return 1;}const n=Math.min(Number(lines),Math.max(0,b.height-Number(start)));if(!n)return 0;
    const dest=m.bytes(out,n*format.stride),temp=new Uint8Array(dest.length),source=bitmaps.readBitmap(b,[0,format.topDown?Number(start):b.height-Number(start)-n,b.width,format.topDown?Number(start)+n:b.height-Number(start)]);
    for(let y=0;y<n;y++)for(let x=0;x<b.width;x++){const i=((format.topDown?y:n-1-y)*b.width+x)*4,p=y*format.stride+x*format.bpp/8;temp[p]=source.data[i+2];temp[p+1]=source.data[i+1];temp[p+2]=source.data[i];if(format.bpp===32)temp[p+3]=source.data[i+3];}dest.set(temp);bitmapInfo(format,info);return n;
  });
  add('SetDIBits',7,(handle,object,start,lines,input,info,usage)=>{
    dc(handle);const b=bitmaps.get(object);requireUnselected(object);start=integer(start,0,0xffffffff);lines=integer(lines,0,0xffffffff);const f=bitmaps.header(info,usage);if(f.width!==b.width||f.height!==b.height)throw new Win32Error('DIB transfer dimensions must match bitmap',50);const n=Math.min(lines,Math.max(0,b.height-start));if(!n)return 0;const src=m.bytes(input,n*f.stride).slice(),image=bitmaps.bytesFor([0,0,b.width,n]);
    for(let y=0;y<n;y++)for(let x=0;x<b.width;x++){const i=((f.topDown?y:n-1-y)*b.width+x)*4,p=y*f.stride+x*f.bpp/8;image.data[i]=src[p+2];image.data[i+1]=src[p+1];image.data[i+2]=src[p];image.data[i+3]=f.bpp===32?src[p+3]:0;}const top=f.topDown?start:b.height-start-n;bitmaps.writeBitmap(b,[0,top,b.width,top+n],image);return n;
  });
  add('BitBlt',9,(dest,x,y,width,height,source,sx,sy,rop)=>{integer(width,0,0x7fffffff);integer(height,0,0x7fffffff);const r=ropInfo(rop);return bitmaps.blit(dc(dest),x,y,width,height,r.source?dc(source):null,sx,sy,width,height,rop);});
  add('StretchBlt',11,(dest,x,y,width,height,source,sx,sy,sw,sh,rop)=>{const r=ropInfo(rop);return bitmaps.blit(dc(dest),x,y,width,height,r.source?dc(source):null,sx,sy,sw,sh,rop);});
  add('PatBlt',6,(dest,x,y,width,height,rop)=>{if(ropInfo(rop).source)throw new Win32Error('PatBlt does not accept source-dependent ROPs',50);return bitmaps.blit(dc(dest),x,y,width,height,null,0,0,width,height,rop);});
  for(const [name,operation]of [['TransparentBlt','transparent'],['AlphaBlend','alpha']]){
    const fn=(dest,x,y,width,height,source,sx,sy,sw,sh,extra)=>bitmaps.blit(dc(dest),x,y,width,height,dc(source),sx,sy,sw,sh,operation,extra);
    w.register('msimg32',name,fn,{arity:11,notes:name==='AlphaBlend'?'Packed BLENDFUNCTION; premultiplied 32-bit source alpha.':'Color-key transfer; positive extents only.'});
    add('Gdi'+name,11,fn);
  }
  add('GdiFlush',0,()=>1,{notes:'Memory operations and host pixel transfers are synchronous. Browser presentation is independently scheduled.'});
  add('GetPixel',3,(handle,x,y)=>bitmaps.pixel(dc(handle),x,y),{failure:0xffffffff});
  add('SetPixel',4,(handle,x,y,color)=>{const state=dc(handle);color=unsigned(color)&0xffffff;if(state.bitmap||state.clip||state.paintClip||state.window?.gdiClientShape||!translatedOnly(state))return bitmaps.pixel(state,x,y,color);draw(state,'pixel',[coord(x),coord(y),color]);return color;},{failure:0xffffffff});
  add('SetPixelV',4,(handle,x,y,color)=>{const result=w.invoke('gdi32','SetPixel',[handle,x,y,color]);return result===0xffffffff?0:1;});
  add('MoveToEx',4,(handle,x,y,old)=>{const state=dc(handle);x=coord(x);y=coord(y);if(old)pair(old,state.x,state.y);state.x=x;state.y=y;return 1;});
  add('GetCurrentPositionEx',2,(handle,out)=>{const s=dc(handle);pair(out,s.x,s.y);return 1;});
  add('LineTo',3,(handle,x,y)=>{const state=dc(handle);x=coord(x);y=coord(y);draw(state,'line',[state.x,state.y,x,y]);state.x=x;state.y=y;return 1;});
  for(const [name,operation]of [['Rectangle','rect'],['Ellipse','ellipse']])add(name,5,(handle,l,t,r,b)=>{draw(dc(handle),operation,[l,t,r,b].map(coord));return 1;});
  for(const [name,field]of [['TextColor','textColor'],['BkColor','backgroundColor']]){
    add('Set'+name,2,(handle,color)=>{const state=dc(handle),old=state[field];state[field]=unsigned(color)&0xffffff;return old;},{failure:0xffffffff});
    add('Get'+name,1,handle=>dc(handle)[field],{failure:0xffffffff});
  }
  add('SetBkMode',2,(handle,mode)=>{integer(mode,1,2);const state=dc(handle),old=state.backgroundMode;state.backgroundMode=Number(mode);return old;});
  add('GetBkMode',1,handle=>dc(handle).backgroundMode);
  for(const wide of [false,true])add('TextOut'+(wide?'W':'A'),5,(handle,x,y,p,n)=>{n=integer(n,0,m.maxBytes/(wide?2:1));const text=typeof p==='string'?p.slice(0,n):m.decode(m.bytes(p,n*(wide?2:1)),wide);draw(dc(handle),'text',[coord(x),coord(y),text]);return 1;},{mode:'browser',notes:'Replaced by the shared Canvas font renderer during GDI installation.'});
  add('SaveDC',1,handle=>{const state=dc(handle);if(state.saved.length>=256)throw new Win32Error('Saved DC stack exceeds 256',8);const {saved,path,...snapshot}=state;state.saved.push(snapshot);return state.saved.length;});
  add('RestoreDC',2,(handle,level)=>{const state=dc(handle);level=coord(level);const index=level<0?state.saved.length+level:level-1;if(!level||index<0||index>=state.saved.length)throw new Win32Error('Invalid saved DC level');const snapshot=state.saved[index];state.saved.splice(index);Object.assign(state,snapshot);return 1;});
  add('SetViewportOrgEx',4,(handle,x,y,old)=>{const state=dc(handle);x=coord(x);y=coord(y);if(old)pair(old,state.viewportX,state.viewportY);state.viewportX=x;state.viewportY=y;return 1;});
  add('OffsetViewportOrgEx',4,(handle,x,y,old)=>{const state=dc(handle);return w.invoke('gdi32','SetViewportOrgEx',[handle,coord(state.viewportX+coord(x)),coord(state.viewportY+coord(y)),old]);});
  add('GetViewportOrgEx',2,(handle,out)=>{const s=dc(handle);pair(out,s.viewportX,s.viewportY);return 1;});
  add('GetMapMode',1,handle=>{dc(handle);return 1;});
  add('SetMapMode',2,(handle,mode)=>{dc(handle);if(Number(mode)!==1)throw new Win32Error('Only MM_TEXT is supported',50);return 1;});
  add('SetStretchBltMode',2,(handle,mode)=>{const state=dc(handle);if(Number(mode)!==3)throw new Win32Error('Only COLORONCOLOR scaling is supported',50);const old=state.stretchMode;state.stretchMode=3;return old;});
  add('GetStretchBltMode',1,handle=>dc(handle).stretchMode);
  const regionAPI=installRegions(w,{dc,bitmaps,regions,add});
  const services={dc,bitmaps,regions,add,stocks,stock,newState,style,draw,regionAPI};
  installTransforms(w,services);installPaths(w,services);installText(w,services);installPainting(w,services);
  add('GetDeviceCaps',2,(handle,index)=>{const s=dc(handle),r=bitmaps.bounds(s);const values={2:1,8:r[2],10:r[3],12:32,14:1,88:96,90:96};if(!(index in values))throw new Win32Error('Device capability not implemented',50);return values[index];});
}

return {colorRef,installGDI};
})();

/* index.js */
__modules[24]=(()=>{
const {installHandleServices,HANDLE_CONSTANTS}=__modules[1];
const {installTaskMemory}=__modules[2];
const {installWindowProperties}=__modules[4];
const {installBinaryCodec,CRYPT_CONSTANTS}=__modules[5];
const {installGUID}=__modules[6];
const {installPathUtilities}=__modules[7];
const {installFileUtilities}=__modules[8];
const {installNLS,NLS_CONSTANTS}=__modules[9];
const {installSynchronization,SYNC_CONSTANTS}=__modules[10];
const {GPURasterPresenter}=__modules[11];
const {TRANSFORM_CONSTANTS}=__modules[12];
const {PATH_CONSTANTS}=__modules[13];
const {TEXT_CONSTANTS}=__modules[14];
const {PAINT_CONSTANTS}=__modules[15];
const {REGION_CONSTANTS,RegionStore}=__modules[17];
const {GDI_CONSTANTS}=__modules[18];
const {installClipboard}=__modules[19];
const {ERROR,Win32Error,Handles,Memory,MemoryFileSystem,integer,unsigned,encodeANSI,decodeANSI}=__modules[0];
const {installKernel32}=__modules[20];
const {installUser32}=__modules[21];
const {installRegistry}=__modules[22];
const {installGDI,colorRef}=__modules[23];























const WIN32_CONSTANTS=Object.freeze({...HANDLE_CONSTANTS,...NLS_CONSTANTS,...SYNC_CONSTANTS,...CRYPT_CONSTANTS,...TRANSFORM_CONSTANTS,...PATH_CONSTANTS,...TEXT_CONSTANTS,...PAINT_CONSTANTS,...GDI_CONSTANTS,...REGION_CONSTANTS,INVALID_HANDLE_VALUE:-1,GENERIC_READ:0x80000000,GENERIC_WRITE:0x40000000,FILE_SHARE_READ:1,FILE_SHARE_WRITE:2,CREATE_NEW:1,CREATE_ALWAYS:2,OPEN_EXISTING:3,OPEN_ALWAYS:4,TRUNCATE_EXISTING:5,FILE_ATTRIBUTE_NORMAL:128,FILE_ATTRIBUTE_DIRECTORY:16,GMEM_FIXED:0,GMEM_MOVEABLE:2,GMEM_ZEROINIT:64,SW_HIDE:0,SW_SHOWNORMAL:1,SW_SHOW:5,SW_RESTORE:9,WM_SETTEXT:12,WM_GETTEXT:13,WM_GETTEXTLENGTH:14,HKEY_CURRENT_USER:0x80000001,KEY_READ:0x20019,KEY_WRITE:0x20006,KEY_ALL_ACCESS:0xf003f,REG_SZ:1,REG_EXPAND_SZ:2,REG_BINARY:3,REG_DWORD:4,REG_MULTI_SZ:7,REG_QWORD:11,CF_TEXT:1,CF_UNICODETEXT:13});
function normalizeDLL(name){const dll=String(name).replace(/\\/g,'/').split('/').at(-1).replace(/\.dll$/i,'').toLowerCase();if(!/^[a-z0-9_.-]+$/.test(dll))throw new Win32Error('Invalid DLL name',126);return dll;}
/** Reusable browser/worker/Node compatibility process; never loads native code. */
class Win32Browser {
  constructor(options={}){
    this.options=options;this.memory=new Memory(options);this.handles=new Handles(options.maxHandles);this.fs=options.fs||new MemoryFileSystem();this.lastError=0;this.disposed=false;this.modules=new Map();this.timers=new Map();this.timerCallbacks=new Map();this.nextTimer=1;this.delays=new Set();this.clock=options.clock||(()=>globalThis.performance?.now?.()??Date.now());this.now=options.now||(()=>new Date());this.epoch=this.clock();this.maxFileBytes=integer(options.maxFileBytes??Math.min(20*1024*1024,this.memory.maxBytes),1,this.memory.maxBytes);this.environment=new Map(Object.entries(options.environment||{}).map(([k,v])=>[k.toUpperCase(),String(v)]));
    for(const name of ['/Windows','/Temp'])this.fs.directories.add(this.fs.normalize(name));
    installKernel32(this);installUser32(this);installRegistry(this);installGDI(this);installClipboard(this);installFileUtilities(this);installNLS(this);installSynchronization(this);installPathUtilities(this);installGUID(this);installBinaryCodec(this);installWindowProperties(this);installHandleServices(this);installTaskMemory(this);
    if(options.registry){for(const [path,record]of options.registry){if(!/^(HKCR|HKCU|HKLM|HKU|HKCC)(\\|$)/.test(path)||!Array.isArray(record.values))throw new Win32Error('Invalid registry snapshot');this.registry.set(path,{name:String(record.name),values:new Map(record.values)});}}
    this.register('shell32','ShellExecuteA',(handle,operation,file,parameters,directory,show)=>this.openURL(false,handle,operation,file,parameters,directory,show),{arity:6,failure:5,mode:'browser',notes:'Only explicitly enabled http/https/mailto navigation; no executable launch.'});
    this.register('shell32','ShellExecuteW',(handle,operation,file,parameters,directory,show)=>this.openURL(true,handle,operation,file,parameters,directory,show),{arity:6,failure:5,mode:'browser',notes:'Only explicitly enabled http/https/mailto navigation; no executable launch.'});
  }
  register(dll,name,fn,{arity,mode='emulated',notes='',failure=0,statusError=false,replace=false}={}){dll=normalizeDLL(dll);if(typeof fn!=='function'||!Number.isInteger(arity)||arity<0||arity>64||!/^[A-Za-z_]\w*$/.test(name))throw new Win32Error('Invalid API registration');let exports=this.modules.get(dll);if(!exports)this.modules.set(dll,exports=new Map());if(exports.has(name)&&!replace)throw new Win32Error('Duplicate API export');exports.set(name,{dll,name,fn,arity,mode,notes,failure,statusError});return this;}
  resolve(dll,name){dll=normalizeDLL(dll);const module=this.modules.get(dll);if(!module)throw new Win32Error('DLL has no browser compatibility module: '+dll,126);const api=module.get(String(name));if(!api)throw new Win32Error('Win32 API is not implemented: '+dll+'!'+name,127);return api;}
  invoke(dll,name,args=[]){if(this.disposed)throw new Win32Error('Compatibility process is disposed',995);const api=this.resolve(dll,name);if(!Array.isArray(args)||args.length!==api.arity)throw new Win32Error('Invalid argument count for '+api.dll+'!'+name,87);const failure=error=>{if(!(error instanceof Win32Error))throw error;if(api.statusError)return error.code;this.lastError=error.code;this.options.onDiagnostic?.({dll:api.dll,name,code:error.code,message:error.message});return typeof api.failure==='function'?api.failure(args):api.failure;};try{const value=api.fn(...args);return value?.then?value.catch(failure):value;}catch(error){return failure(error);}}
  manifest(){return [...this.modules.values()].flatMap(exports=>[...exports.values()].map(({dll,name,arity,mode,notes})=>({dll,name,arity,mode,notes}))).sort((a,b)=>(a.dll+'!'+a.name).localeCompare(b.dll+'!'+b.name));}
  registerWindow(descriptor){if(!descriptor||typeof descriptor!=='object')throw new Win32Error('Window descriptor required');return this.handles.add('window',descriptor);}
  unregisterWindow(handle){if(!this.handles.has(handle,'window'))return;this.releaseWindowProperties?.(handle);this.releaseWindowGDI?.(handle);for(const [key,t]of this.timers)if(t.handle===Number(handle)){clearInterval(t.timer);this.timers.delete(key);}for(const [id,e]of this.handles.entries)if(e.type==='dc'&&e.value.handle===Number(handle))this.handles.close(id,'dc');this.handles.close(handle,'window');}
  registerCallback(fn,{onTimer=fn}={}){if(typeof fn!=='function'||typeof onTimer!=='function')throw new Win32Error('Callback must be a function');const handle=this.handles.add('callback',fn);this.timerCallbacks.set(handle,onTimer);return handle;}
  unregisterCallback(handle){for(const t of this.timers.values())if(t.callback===handle)throw new Win32Error('Callback is still used by a timer',5);this.handles.close(handle,'callback');this.timerCallbacks.delete(handle);}
  sleep(milliseconds){milliseconds=unsigned(milliseconds);return new Promise((resolve,reject)=>{const state={timer:null,reject};this.delays.add(state);const end=this.clock()+milliseconds;const next=()=>{if(this.disposed){this.delays.delete(state);reject(new Win32Error('Sleep cancelled',995));return;}const remaining=end-this.clock();if(remaining<=0){this.delays.delete(state);resolve();}else state.timer=setTimeout(next,Math.min(remaining,0x7fffffff));};state.timer=setTimeout(next,Math.min(milliseconds,0x7fffffff));});}
  registrySnapshot(){return [...this.registry].map(([path,r])=>[path,{name:r.name,values:[...r.values].map(([key,v])=>[key,{...v,value:Array.isArray(v.value)?v.value.slice():v.value}])}]);}
  async openURL(wide,handle,operation,file,parameters,directory,show){if(handle)this.handles.get(handle,'window');const verb=this.memory.string(operation,wide).toLowerCase();if(verb&&verb!=='open'||this.memory.string(parameters,wide)||this.memory.string(directory,wide))return 31;let url;try{url=new URL(this.memory.string(file,wide));}catch{throw new Win32Error('Invalid navigation URL',87);}if(!['http:','https:','mailto:'].includes(url.protocol)||!this.options.allowNavigation||typeof this.options.openURL!=='function')return 5;return await this.options.openURL(url.href,show)?33:5;}
  dispose(){if(this.disposed)return;this.disposeWindowGDI?.();this.disposeSynchronization?.();this.disposeWindowProperties?.();this.disposed=true;for(const t of this.timers.values())clearInterval(t.timer);this.timers.clear();for(const d of this.delays){clearTimeout(d.timer);d.reject(new Win32Error('Operation cancelled',995));}this.delays.clear();this.handles.entries.clear();this.timerCallbacks.clear();this.memory.clear();}
}
function createWin32(options={}){return new Win32Browser(options);}

return {WIN32_CONSTANTS,normalizeDLL,Win32Browser,createWin32,GPURasterPresenter,RegionStore,ERROR,Win32Error,Memory,MemoryFileSystem,encodeANSI,decodeANSI,colorRef};
})();
globalThis["Win32Compat"]=__modules[24];
})();