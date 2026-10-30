/** Portable OLE document ownership. This is not COM structured storage and does
 * not activate installed Windows servers. All paths belong to the project disk.
 */
import {VBError} from '../language/lexer.js';
import {decodeANSI,encodeANSI} from '../runtime/binary-codec.js';
import {rasterDataURL,fromBase64,toBase64} from '../project/frx.js';
import {parseRTF,RichTextDocument,writeRTF} from './rtf.js';

export const OLE_DOCUMENT_LIMIT=8*1024*1024;
export const OLE_CLASSES=Object.freeze({text:'VB6.TextDocument',rtf:'VB6.RichTextDocument',image:'VB6.ImageDocument',package:'Package'});
const fail=(message,number=380)=>{throw new VBError('OLE: '+message,number);};
const bytesOf=value=>{if(!(value instanceof Uint8Array)||value.length>OLE_DOCUMENT_LIMIT)fail('document must contain at most 8 MiB of bytes',7);return value.slice();};
const documentBase64=value=>{if(typeof value!=='string'||value.length>Math.ceil(OLE_DOCUMENT_LIMIT/3)*4)fail('document must contain at most 8 MiB of bytes',7);return bytesOf(fromBase64(value));};
const checkedPath=value=>{value=String(value??'');if(value.length>4096||/[\0-\x1f]/.test(value))fail('invalid document path');return value;};
const checkedName=value=>{value=String(value??'').replace(/\\/g,'/').split('/').at(-1)||'Untitled';if(value.length>255||/[\0-\x1f]/.test(value))fail('invalid document name');return value;};
const sameBytes=(a,b)=>a.length===b.length&&a.every((byte,index)=>byte===b[index]);
const magic=new TextEncoder().encode('VB6OLE01');
function classKind(name){const match=Object.entries(OLE_CLASSES).find(([,value])=>value.toLowerCase()===String(name).toLowerCase());if(!match)fail('document server is unavailable: '+name+'. Browser exports support '+Object.values(OLE_CLASSES).join(', ')+'. Native Office/COM servers require a Windows host.',429);return match[0];}
function textFromBytes(bytes){
  if(bytes[0]===255&&bytes[1]===254)return new TextDecoder('utf-16le',{fatal:true}).decode(bytes.subarray(2));
  if(bytes[0]===254&&bytes[1]===255)return new TextDecoder('utf-16be',{fatal:true}).decode(bytes.subarray(2));
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{return decodeANSI(bytes);}
}
function detectKind(name,bytes){
  if(rasterDataURL(bytes))return 'image';
  if(/^\s*\{\\rtf1\b/.test(decodeANSI(bytes.subarray(0,128))))return 'rtf';
  if(/\.(?:txt|text|log|csv|tsv|md|json|xml|ini|bas|cls|pas|pp|html?|css|js)$/i.test(name))return 'text';
  return 'package';
}
function validateContent(kind,bytes){
  if(kind==='image'&&!rasterDataURL(bytes))fail('expected a supported PNG, JPEG, GIF, BMP or ICO image');
  if(kind==='rtf')parseRTF(decodeANSI(bytes));
  if(kind==='text'){try{textFromBytes(bytes);}catch{fail('invalid text encoding');}}
}
export function decodeOleRecord(bytes){
  if(!(bytes instanceof Uint8Array)||bytes.length<12||!magic.every((value,index)=>bytes[index]===value))fail('expected a portable VB6 OLE document record',13);
  const length=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength).getUint32(8,true);
  if(length>20*1024*1024-12||length>bytes.length-12)fail('truncated or oversized document record',13);
  let value;try{value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(12,12+length)));}catch{fail('invalid document record',13);}
  return {value,bytesRead:length+12};
}

export class OleDocument {
  #document=null;#disposed=false;#active=false;#dirty=false;#revision=0;#object;
  constructor({fs=null,assets={},onChange=()=>{},allow=2,snapshot}={}){
    this.fs=fs;this.assets=assets;this.onChange=onChange;this.allowed=allow;
    if(snapshot!==undefined&&snapshot!==null)this.restore(snapshot);
  }
  #assert(){if(this.#disposed)fail('document container is closed',462);}
  #require(){this.#assert();if(!this.#document)fail('there is no embedded or linked object',91);return this.#document;}
  #notify(reason){this.#revision++;this.onChange(reason,this);}
  #allow(type){if(![0,1,2].includes(Number(this.allowed)))fail('invalid OLETypeAllowed');if(Number(this.allowed)!==2&&Number(this.allowed)!==type)fail(type?'embedded objects are disabled':'linked objects are disabled',425);}
  get empty(){return !this.#document;}get active(){return this.#active;}get dirty(){return this.#dirty;}get revision(){return this.#revision;}
  get type(){return this.#document?.type??3;}get kind(){return this.#document?.kind??'';}
  get className(){return this.#document?OLE_CLASSES[this.#document.kind]:'';}
  get source(){return this.#document?.source??'';}get name(){return this.#document?.name??'';}
  get object(){this.#require();return this.#object;}
  get bytes(){return this.#require().bytes.slice();}
  get image(){const doc=this.#require();return doc.kind==='image'?rasterDataURL(doc.bytes):null;}
  get text(){const doc=this.#require();if(doc.kind==='rtf')return parseRTF(decodeANSI(doc.bytes)).text;if(doc.kind!=='text')fail('object does not support Text',438);return textFromBytes(doc.bytes);}
  set text(value){const doc=this.#require();if(!['text','rtf'].includes(doc.kind))fail('object does not support Text',438);const text=String(value??'');this.#edit(doc.kind==='rtf'?encodeANSI(writeRTF(new RichTextDocument([{text}]))):new TextEncoder().encode(text));}
  get rtf(){const doc=this.#require();if(doc.kind!=='rtf')fail('object does not support TextRTF',438);return decodeANSI(doc.bytes);}
  set rtf(value){const doc=this.#require();if(doc.kind!=='rtf')fail('object does not support TextRTF',438);value=String(value);parseRTF(value);this.#edit(encodeANSI(value));}
  #edit(value){const doc=this.#require(),bytes=bytesOf(value);validateContent(doc.kind,bytes);if(sameBytes(doc.bytes,bytes))return;doc.bytes=bytes;this.#dirty=true;this.#notify('changed');}
  #read(path){
    path=checkedPath(path);if(!path)fail('a document path is required',53);
    if(this.fs?.exists(path))return bytesOf(this.fs.readBytes(path));
    const key=Object.keys(this.assets).find(key=>key.replace(/\\/g,'/').toLowerCase()===path.replace(/\\/g,'/').replace(/^\//,'').toLowerCase()),asset=key&&this.assets[key];
    if(asset?.encoding==='base64')return documentBase64(asset.data);
    fail('file not found in this application: '+path,53);
  }
  createEmbed(path='',className=''){
    this.#assert();this.#allow(1);path=checkedPath(path);
    let bytes,kind;if(path){bytes=this.#read(path);kind=className?classKind(className):detectKind(path,bytes);}else{kind=className?classKind(className):'text';if(kind==='image')fail('an image requires a source document',53);bytes=kind==='rtf'?encodeANSI(writeRTF(new RichTextDocument())):new Uint8Array();}
    this.#replace({type:1,source:path,name:checkedName(path||({text:'Untitled.txt',rtf:'Untitled.rtf',package:'Untitled.bin'}[kind])),kind,bytes});
  }
  createLink(path,className=''){
    this.#assert();this.#allow(0);path=checkedPath(path);const bytes=this.#read(path),kind=className?classKind(className):detectKind(path,bytes);
    this.#replace({type:0,source:path,name:checkedName(path),kind,bytes});
  }
  importBytes(name,bytes,className=''){
    this.#assert();this.#allow(1);name=checkedName(name);bytes=bytesOf(bytes);this.#replace({type:1,source:'',name,kind:className?classKind(className):detectKind(name,bytes),bytes});
  }
  #replace(value){
    const bytes=bytesOf(value.bytes);validateContent(value.kind,bytes);
    // Validate first. A failed import or server lookup retains the live object.
    this.#document={...value,bytes,baseline:value.baseline?bytesOf(value.baseline):bytes.slice()};this.#active=false;this.#dirty=!!value.dirty;
    const owner=this,identity=this.#document,live=()=>{owner.#assert();if(owner.#document!==identity)fail('this document object has been removed',462);return owner;};
    this.#object=Object.freeze({
      get Name(){return live().name;},get Class(){return live().className;},get Text(){return live().text;},set Text(value){live().text=value;},
      get TextRTF(){return live().rtf;},set TextRTF(value){live().rtf=value;},Save(){live().saveLinked();},SaveAs(path){live().saveDocument(path);},
    });
    this.#notify('created');
  }
  doVerb(verb=0){this.#require();verb=Number(verb);if(![0,-1,-2,-3,-4,-5].includes(verb))fail('unsupported document verb',445);if(verb===-3){this.close();return;}if(!this.#active){this.#active=true;this.#notify('activated');}}
  close(){this.#assert();if(this.#active){this.#active=false;this.#notify('deactivated');}}
  delete(){this.#assert();if(this.empty)return;this.#document=null;this.#active=false;this.#dirty=false;this.#notify('deleted');}
  update(){
    const doc=this.#require();if(doc.type!==0)return;if(this.#dirty)fail('save or discard local edits before updating a linked document',445);
    const bytes=this.#read(doc.source);validateContent(doc.kind,bytes);doc.bytes=bytes;doc.baseline=bytes.slice();this.#notify('updated');
  }
  saveLinked(){
    const doc=this.#require();if(doc.type!==0)fail('embedded objects require SaveDocument with a destination',445);
    if(!this.fs?.exists(doc.source))fail('linked source is not writable in the application disk',70);
    if(!sameBytes(this.#read(doc.source),doc.baseline))fail('linked source changed; refusing to overwrite it',70);
    this.fs.writeBytes(doc.source,doc.bytes);doc.baseline=doc.bytes.slice();this.#dirty=false;this.#notify('saved');
  }
  saveDocument(path){const doc=this.#require();if(!this.fs)fail('runtime disk is unavailable',5);path=checkedPath(path);if(!path)fail('a destination path is required',52);if(doc.type===0&&this.fs.canonical(path)===this.fs.canonical(doc.source))return this.saveLinked();this.fs.writeBytes(path,doc.bytes);if(doc.type===1)this.#dirty=false;this.#notify('saved');}
  snapshot(){this.#assert();const doc=this.#document;return doc?{format:'VB6.OLE.Document',version:1,type:doc.type,kind:doc.kind,name:doc.name,source:doc.source,data:toBase64(doc.bytes),...(doc.type===0&&this.#dirty?{baseline:toBase64(doc.baseline),dirty:true}:{})}:null;}
  restore(value){
    this.#assert();if(value===null){this.delete();return;}if(!value||value.format!=='VB6.OLE.Document'||value.version!==1||![0,1].includes(value.type)||!Object.hasOwn(OLE_CLASSES,value.kind)||typeof value.data!=='string'||typeof value.name!=='string'||typeof value.source!=='string')fail('invalid portable document state',13);
    this.#allow(value.type);const source=checkedPath(value.source);if(value.type===0&&!source)fail('linked document requires a source',13);
    const bytes=documentBase64(value.data),baseline=value.baseline===undefined?bytes:documentBase64(value.baseline);
    if(value.dirty!==undefined&&typeof value.dirty!=='boolean')fail('invalid dirty state',13);
    this.#replace({type:value.type,source,name:checkedName(value.name),kind:value.kind,bytes,baseline,dirty:value.dirty});
  }
  encode(){this.#require();const bytes=new TextEncoder().encode(JSON.stringify(this.snapshot()));if(bytes.length>20*1024*1024-12)fail('portable document record exceeds the 20 MiB disk limit',7);const result=new Uint8Array(12+bytes.length);result.set(magic);new DataView(result.buffer).setUint32(8,bytes.length,true);result.set(bytes,12);return result;}
  saveToFile(number){const doc=this.#require();if(!this.fs)fail('runtime disk is unavailable',5);if(this.fs.handle(number).mode!=='binary')fail('SaveToFile requires an open Binary file number',54);this.fs.put(number,undefined,this.encode());if(doc.type===1)this.#dirty=false;this.#notify('saved');}
  readFromFile(number){this.#assert();if(!this.fs)fail('runtime disk is unavailable',5);if(this.fs.handle(number).mode!=='binary')fail('ReadFromFile requires an open Binary file number',54);const value=this.fs.get(number,undefined,bytes=>{const record=decodeOleRecord(bytes),check=new OleDocument({allow:this.allowed});try{check.restore(record.value);}finally{check.dispose();}return record;});this.restore(value);}
  dispose(){if(this.#disposed)return;this.#document=null;this.#active=false;this.#dirty=false;this.#disposed=true;this.onChange=()=>{};this.fs=null;this.assets={};}
}
