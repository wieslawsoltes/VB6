import {readInputField} from './sequential-codec.js';
import { VBError } from '../language/lexer.js';
import {encodeANSI,decodeANSI} from './binary-codec.js';
const MAX_FILE=20*1024*1024;
const integer=(value,min,max,message='Invalid procedure call or argument')=>{value=Number(value);if(!Number.isInteger(value)||value<min||value>max)throw new VBError(message,5);return value;};
function toBase64(bytes){let s='';for(let i=0;i<bytes.length;i+=8192)s+=String.fromCharCode(...bytes.subarray(i,i+8192));return btoa(s);}
/** Isolated per-project text/binary disk. No implicit access to the host disk. */
export class VirtualFileSystem {
  constructor(snapshot={}){
    this.files=new Map(Object.entries(snapshot.files||{}).map(([name,data])=>[name,data?.encoding==='base64'?Uint8Array.from(atob(data.data),c=>c.charCodeAt(0)):String(data)]));
    this.directories=new Set(snapshot.directories||['/']);this.handles=new Map();this.cwd='/';this.dirty=false;this.locks=[];
  }
  normalize(path){const raw=String(path).replace(/\\/g,'/').replace(/^[A-Za-z]:/,'');const result=[];for(const p of ((raw.startsWith('/')?'':this.cwd+'/')+raw).split('/')){if(!p||p==='.')continue;if(p==='..')result.pop();else result.push(p);}return '/'+result.join('/');}
  entry(path){const p=this.normalize(path);if(!this.files.has(p))throw new VBError('File not found: '+path,53);return this.files.get(p);}
  read(path){const data=this.entry(path);return data instanceof Uint8Array?decodeANSI(data):data;}
  readBytes(path){const data=this.entry(path);return data instanceof Uint8Array?data.slice():encodeANSI(data);}
  store(path,value){if(value.length>MAX_FILE)throw new VBError('Virtual file exceeds 20 MiB limit',7);this.files.set(this.normalize(path),value);this.dirty=true;}
  write(path,text){this.store(path,String(text));}
  writeBytes(path,bytes){this.store(path,Uint8Array.from(bytes));}
  exists(path){return this.files.has(this.normalize(path));}
  remove(path){const p=this.normalize(path);if([...this.handles.values()].some(h=>h.path===p))throw new VBError('File already open',55);if(!this.files.delete(p))throw new VBError('File not found',53);this.dirty=true;}
  copy(source,destination){const data=this.entry(source);this.store(destination,data instanceof Uint8Array?data.slice():data);}
  rename(source,destination){source=this.normalize(source);destination=this.normalize(destination);if(this.exists(destination))throw new VBError('File already exists',58);const value=this.entry(source);this.remove(source);this.store(destination,value);}
  freeFile(range=0){integer(range,0,1);const start=range?256:1,end=range?511:255;for(let n=start;n<=end;n++)if(!this.handles.has(n))return n;throw new VBError('Too many files',67);}
  open(path,mode,number,recordLength=128,access,sharing='shared'){
    number=Number(number);if(!Number.isInteger(number)||number<1||number>511||this.handles.has(number))throw new VBError('Bad file number',52);
    mode=String(mode).toLowerCase();if(!['input','output','append','binary','random'].includes(mode))throw new VBError('Bad file mode',54);
    const binary=mode==='binary'||mode==='random';recordLength=mode==='random'?integer(recordLength,1,32767):1;
    access=access||((mode==='input')?'read':binary?'read write':'write');access=access.toLowerCase();
    if(mode==='input'&&access!=='read'||['output','append'].includes(mode)&&access!=='write')throw new VBError('Bad file mode',54);
    path=this.normalize(path);
    for(const h of this.handles.values())if(h.path===path){
      if(mode==='output'||h.mode==='output'||h.sharing==='lock read write'||sharing==='lock read write'||h.sharing==='lock read'&&access.includes('read')||h.sharing==='lock write'&&access.includes('write')||sharing==='lock read'&&h.access.includes('read')||sharing==='lock write'&&h.access.includes('write'))throw new VBError('Permission denied',70);
    }
    if(!this.exists(path)){if(mode==='input'||access==='read')throw new VBError('File not found',53);binary?this.writeBytes(path,[]):this.write(path,'');}
    if(mode==='output')this.write(path,'');
    const content=binary?this.readBytes(path):this.read(path);
    this.handles.set(number,{path,mode,number,content,position:mode==='append'?content.length:0,lastRecord:0,recordLength,access,sharing});
  }
  handle(number){const h=this.handles.get(Number(number));if(!h)throw new VBError('Bad file number',52);return h;}
  close(number){if(number===undefined){for(const n of [...this.handles.keys()])this.close(n);return;}this.handle(number);this.handles.delete(Number(number));this.locks=this.locks.filter(l=>l.number!==Number(number));}
  requireAccess(h,action){if(!h.access.includes(action))throw new VBError('Bad file mode',54);}
  assertUnlocked(h,start,end){if(this.locks.some(l=>l.path===h.path&&l.number!==h.number&&start<l.end&&end>l.start))throw new VBError('Permission denied',70);}
  refresh(h){h.content=['binary','random'].includes(h.mode)?this.readBytes(h.path):this.read(h.path);return h;}
  print(number,text,newline=true){const h=this.handle(number);this.requireAccess(h,'write');if(!['output','append'].includes(h.mode))throw new VBError('Bad file mode',54);const addition=String(text)+(newline?'\r\n':'');this.assertUnlocked(h,h.position,h.position+addition.length);h.content+=addition;h.position=h.content.length;this.write(h.path,h.content);}
  lineInput(number){const h=this.refresh(this.handle(number));this.requireAccess(h,'read');if(h.mode!=='input')throw new VBError('Bad file mode',54);if(h.position>=h.content.length)throw new VBError('Input past end of file',62);let end=h.content.indexOf('\n',h.position);if(end<0)end=h.content.length;this.assertUnlocked(h,h.position,end);const s=h.content.slice(h.position,end).replace(/\r$/,'');h.position=Math.min(end+1,h.content.length);return s;}
  inputValue(number,type='Variant'){
    const h=this.refresh(this.handle(number));this.requireAccess(h,'read');
    if(!['input','binary'].includes(h.mode))throw new VBError('Bad file mode',54);
    const text=h.content instanceof Uint8Array?decodeANSI(h.content):h.content;
    const result=readInputField(text,h.position,type);this.assertUnlocked(h,h.position,result.next);h.position=result.next;return result.value;
  }
  input(number,count){const h=this.refresh(this.handle(number));this.requireAccess(h,'read');if(!['input','binary'].includes(h.mode))throw new VBError('Bad file mode',54);count=integer(count,0,MAX_FILE);if(h.position+count>h.content.length)throw new VBError('Input past end of file',62);this.assertUnlocked(h,h.position,h.position+count);const s=h.content.slice(h.position,h.position+count);h.position+=count;return s instanceof Uint8Array?decodeANSI(s):s;}
  eof(number){const h=this.refresh(this.handle(number));return h.position>=h.content.length?-1:0;}
  lof(number){return this.refresh(this.handle(number)).content.length;}
  loc(number){const h=this.handle(number);return h.mode==='random'?h.lastRecord:h.mode==='binary'?h.position:Math.trunc(h.position/128);}
  seek(number,position){const h=this.handle(number),unit=h.mode==='random'?h.recordLength:1;if(position!==undefined)h.position=(integer(position,1,2147483647)-1)*unit;return Math.floor(h.position/unit)+1;}
  bytePosition(h,position){const unit=h.mode==='random'?h.recordLength:1;return position===undefined?h.position:(integer(position,1,2147483647)-1)*unit;}
  put(number,position,bytes){const h=this.refresh(this.handle(number));this.requireAccess(h,'write');if(!['binary','random'].includes(h.mode))throw new VBError('Bad file mode',54);if(h.mode==='random'&&bytes.length>h.recordLength)throw new VBError('Bad record length',59);const start=this.bytePosition(h,position),size=h.mode==='random'?h.recordLength:bytes.length,end=start+size;if(end>MAX_FILE)throw new VBError('Virtual file exceeds 20 MiB limit',7);this.assertUnlocked(h,start,end);const content=new Uint8Array(Math.max(end,h.content.length));content.set(h.content);content.set(bytes,start);this.writeBytes(h.path,content);h.content=content;h.position=end;h.lastRecord=Math.floor(start/h.recordLength)+1;}
  get(number,position,decode){const h=this.refresh(this.handle(number));this.requireAccess(h,'read');if(!['binary','random'].includes(h.mode))throw new VBError('Bad file mode',54);const start=this.bytePosition(h,position),end=h.mode==='random'?start+h.recordLength:h.content.length;if(start>=h.content.length||end>h.content.length)throw new VBError('Input past end of file',62);const result=decode(h.content.subarray(start,end));this.assertUnlocked(h,start,h.mode==='random'?end:start+result.bytesRead);h.position=h.mode==='random'?end:start+result.bytesRead;h.lastRecord=Math.floor(start/h.recordLength)+1;return result.value;}
  lock(number,start,end,unlock=false){const h=this.handle(number),unit=h.mode==='random'?h.recordLength:1;start=start===undefined?0:(integer(start,1,2147483647)-1)*unit;end=end===undefined?(start===0?Infinity:start+unit):integer(end,1,2147483647)*unit;if(end<=start)throw new VBError('Invalid lock range',5);if(unlock){const i=this.locks.findIndex(l=>l.number===h.number&&l.start===start&&l.end===end);if(i<0)throw new VBError('Permission denied',70);this.locks.splice(i,1);}else{this.assertUnlocked(h,start,end);this.locks.push({number:h.number,path:h.path,start,end});}}
  snapshot(){return {version:2,files:Object.fromEntries([...this.files].map(([name,data])=>[name,data instanceof Uint8Array?{encoding:'base64',data:toBase64(data)}:data])),directories:[...this.directories]};}
  textStream(path,mode=1,create=false){if(mode===1&&!this.exists(path)&&create)this.write(path,'');const handle=this.freeFile();this.open(path,mode===1?'input':mode===8?'append':'output',handle);const fs=this;return {ReadLine:()=>fs.lineInput(handle),Read:n=>fs.input(handle,n),ReadAll:()=>{const h=fs.handle(handle);return fs.input(handle,h.content.length-h.position);},Write:s=>fs.print(handle,s,false),WriteLine:s=>fs.print(handle,s,true),Close:()=>fs.close(handle),get AtEndOfStream(){return fs.eof(handle);}};}
  fso(){const fs=this;return {FileExists:p=>fs.exists(p)?-1:0,FolderExists:p=>fs.directories.has(fs.normalize(p))?-1:0,CreateTextFile:(p,overwrite=true)=>{if(!overwrite&&fs.exists(p))throw new VBError('File already exists',58);return fs.textStream(p,2,true);},OpenTextFile:(...a)=>fs.textStream(...a),DeleteFile:p=>fs.remove(p),CopyFile:(a,b)=>fs.copy(a,b),GetFile:p=>({Name:fs.normalize(p).split('/').at(-1),Path:fs.normalize(p),Size:fs.entry(p).length}),GetAbsolutePathName:p=>fs.normalize(p),GetFileName:p=>String(p).replace(/\\/g,'/').split('/').at(-1),GetBaseName:p=>String(p).replace(/\\/g,'/').split('/').at(-1).replace(/\.[^.]*$/,''),BuildPath:(a,b)=>fs.normalize(a+'/'+b),CreateFolder:p=>fs.directories.add(fs.normalize(p))};}
}
