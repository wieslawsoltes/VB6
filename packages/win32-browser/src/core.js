/** MIT. A bounded, process-private 32-bit address and handle space. */
export const ERROR = Object.freeze({SUCCESS:0,FILE_NOT_FOUND:2,PATH_NOT_FOUND:3,ACCESS_DENIED:5,INVALID_HANDLE:6,NOT_ENOUGH_MEMORY:8,INVALID_DATA:13,SHARING_VIOLATION:32,NOT_SUPPORTED:50,FILE_EXISTS:80,INVALID_PARAMETER:87,INSUFFICIENT_BUFFER:122,MOD_NOT_FOUND:126,PROC_NOT_FOUND:127,DIR_NOT_EMPTY:145,ALREADY_EXISTS:183,ENVVAR_NOT_FOUND:203,MORE_DATA:234,NO_MORE_ITEMS:259,OPERATION_ABORTED:995,INVALID_WINDOW_HANDLE:1400});
export class Win32Error extends Error {
  constructor(message,code=ERROR.INVALID_PARAMETER){super(message);this.name='Win32Error';this.code=code;}
}
export function integer(value,min=0,max=0xffffffff){value=Number(value);if(!Number.isSafeInteger(value)||value<min||value>max)throw new Win32Error('Invalid integer argument');return value;}
export function unsigned(value){return integer(value,-0x80000000,0xffffffff)>>>0;}
export class Handles {
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
export function encodeANSI(text){return Uint8Array.from(String(text),c=>ansiCodes.get(c)??63);}
export function decodeANSI(bytes){let result='';for(let offset=0;offset<bytes.length;offset+=8192)result+=Array.from(bytes.subarray(offset,offset+8192),n=>ansiChars[n]).join('');return result;}
export class Memory {
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
export class MemoryFileSystem {
  constructor(){this.files=new Map();this.directories=new Set(['/']);this.cwd='/';}
  normalize(path){const raw=String(path).replace(/\\/g,'/').replace(/^[a-z]:/i,'');const parts=[];for(const p of ((raw.startsWith('/')?'':this.cwd+'/')+raw).split('/')){if(p==='..')parts.pop();else if(p&&p!=='.')parts.push(p);}return ('/'+parts.join('/')).toLowerCase();}
  exists(p){return this.files.has(this.normalize(p));}
  readBytes(p){const b=this.files.get(this.normalize(p));if(!b)throw new Win32Error('File not found',2);return b.slice();}
  writeBytes(p,bytes){this.files.set(this.normalize(p),Uint8Array.from(bytes));}
  remove(p){if(!this.files.delete(this.normalize(p)))throw new Win32Error('File not found',2);}
  read(p){return decodeANSI(this.readBytes(p));}
  write(p,s){this.writeBytes(p,encodeANSI(s));}
}
