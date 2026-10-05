/** Bounded FRX records; no COM deserialization, native code, or remote resource loads. */
import {VBError} from '../language/lexer.js';
import {decodeNativeBytes,encodeNativeText,bytesOf} from './native-text.js';
export const MAX_RESOURCE_BYTES=20*1024*1024;
const fail=message=>{throw new VBError('FRX: '+message,1002);};
export function cleanProjectPath(path){
  path=String(path).replace(/\\/g,'/');if(!path||path.length>4096||/^[\/]|:|[\x00-\x1f]/i.test(path))fail('unsafe project path: '+path);
  const out=[];for(const part of path.split('/')){if(!part||part==='.')continue;if(part==='..'){if(!out.length)fail('path escapes project root: '+path);out.pop();}else out.push(part);}if(!out.length)fail('empty project path');return out.join('/');
}
export function relativeProjectPath(fromFile,toFile){const a=cleanProjectPath(fromFile).split('/');a.pop();const b=cleanProjectPath(toFile).split('/');while(a.length&&b.length&&a[0].toLowerCase()===b[0].toLowerCase()){a.shift();b.shift();}return [...a.map(()=> '..'),...b].join('\\');}
export function resolveProjectPath(paths,owner,reference,{basenameFallback=false}={}){
  if(/^[\\/]|^[a-z]:|\0/i.test(String(reference)))fail('unsafe resource reference: '+reference);
  const names=[...paths],parent=String(owner||'').replace(/\\/g,'/').split('/').slice(0,-1).join('/');
  const candidate=cleanProjectPath((parent?parent+'/':'')+reference),matches=names.filter(n=>n.toLowerCase()===candidate.toLowerCase());
  if(matches.length>1)fail('ambiguous case-insensitive file: '+candidate);if(matches.length)return matches[0];
  if(basenameFallback){const base=String(reference).replace(/\\/g,'/').split('/').at(-1).toLowerCase(),found=names.filter(n=>n.split('/').at(-1).toLowerCase()===base);if(found.length>1)fail('ambiguous file name: '+reference);return found[0]||null;}return null;
}
export function fromBase64(data){if(typeof data!=='string'||data.length>MAX_RESOURCE_BYTES*4/3+8)fail('invalid or oversized base64 resource');let binary;try{binary=atob(data);}catch{fail('invalid base64');}return Uint8Array.from(binary,c=>c.charCodeAt(0));}
export function toBase64(bytes){if(bytes.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');let result='';for(let at=0;at<bytes.length;at+=8192)result+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(result);}
function view(bytes){return new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);}
function range(bytes,offset,length){if(!Number.isInteger(offset)||!Number.isInteger(length)||offset<0||length<0||offset+length>bytes.length)fail('truncated record or out-of-range offset');}
export function resourceOffset(value){if(typeof value==='number'){if(Number.isInteger(value)&&value>=0)return value;}else if(/^[0-9a-f]{1,8}$/i.test(value||''))return parseInt(value,16);fail('invalid hexadecimal resource offset');}
/** Decode only the record identified by the property; never guess by scanning untrusted bytes. */
export function readFRXRecord(input,offset,property='Text',{encoding='windows-1252'}={}){
  const bytes=input instanceof Uint8Array?input:new Uint8Array(input);if(bytes.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');offset=resourceOffset(offset);range(bytes,offset,1);const v=view(bytes),remaining=bytes.length-offset;
  if(property==='List'){
    range(bytes,offset,4);const count=v.getUint16(offset,true),signature=v.getUint16(offset+2,true);if(![3,7].includes(signature))fail('unsupported list signature');let cursor=offset+4;const items=[];
    for(let i=0;i<count;i++){range(bytes,cursor,2);const size=v.getUint16(cursor,true);cursor+=2;range(bytes,cursor,size);items.push(decodeNativeBytes(bytes.subarray(cursor,cursor+size),encoding));cursor+=size;}return {kind:'list',items,signature,bytesRead:cursor-offset};
  }
  if(remaining>=12&&v.getUint32(offset+4,true)===0x746c){const size=v.getUint32(offset,true),payload=v.getUint32(offset+8,true);if(size!==payload+8)fail('inconsistent picture lengths');range(bytes,offset+12,payload);return {kind:'picture',bytes:bytes.slice(offset+12,offset+12+payload),bytesRead:12+payload};}
  let header=1,length=bytes[offset],kind='text8';
  if(property==='LongText'||bytes[offset]===255&&remaining>=4&&v.getUint32(offset,true)===remaining-4){range(bytes,offset,4);header=4;length=v.getUint32(offset,true);kind='text32';}
  else if(bytes[offset]===255){range(bytes,offset,3);header=3;length=v.getUint16(offset+1,true);kind='text16';}
  else if(remaining>=4&&bytes.subarray(offset,offset+4).includes(0)){header=4;length=v.getUint32(offset,true);kind='text32';}
  range(bytes,offset+header,length);return {kind,bytes:bytes.slice(offset+header,offset+header+length),bytesRead:header+length};
}
export function writeFRXRecord(value,kind='text32',{signature=3,encoding='windows-1252'}={}){
  if(kind==='list'){
    if(!Array.isArray(value)||value.length>65535)fail('list must contain at most 65,535 items');const encoded=value.map(item=>bytesOf(encodeNativeText(String(item),{encoding})));for(const b of encoded)if(b.length>65535)fail('list item exceeds 65,535 bytes');const size=4+encoded.reduce((n,b)=>n+2+b.length,0);if(size>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');const out=new Uint8Array(size),v=view(out);v.setUint16(0,value.length,true);v.setUint16(2,[3,7].includes(signature)?signature:3,true);let at=4;for(const b of encoded){v.setUint16(at,b.length,true);out.set(b,at+2);at+=2+b.length;}return out;
  }
  const bytes=kind==='picture'?new Uint8Array(value):bytesOf(encodeNativeText(String(value),{encoding}));if(bytes.length>MAX_RESOURCE_BYTES-12)fail('resource exceeds 20 MiB limit');let header=kind==='picture'?12:kind==='text8'&&bytes.length<255?1:kind==='text16'&&bytes.length<=65535?3:4;const out=new Uint8Array(header+bytes.length),v=view(out);if(header===12){v.setUint32(0,bytes.length+8,true);v.setUint32(4,0x746c,true);v.setUint32(8,bytes.length,true);}else if(header===4)v.setUint32(0,bytes.length,true);else if(header===3){out[0]=255;v.setUint16(1,bytes.length,true);}else out[0]=bytes.length;out.set(bytes,header);return out;
}
export function rasterDataURL(input){
  let bytes=input,mime='';const b=bytes,v=view(bytes),starts=hex=>hex.every((n,i)=>b[i]===n);
  if(starts([137,80,78,71,13,10,26,10]))mime='image/png';
  else if(starts([255,216,255]))mime='image/jpeg';
  else if(starts([71,73,70,56])&&[55,57].includes(b[4])&&b[5]===97)mime='image/gif';
  else if(starts([66,77]))mime='image/bmp';
  else if(starts([0,0,1,0]))mime='image/x-icon';
  else if(b.length>=40&&[40,108,124].includes(v.getUint32(0,true))){
    const header=v.getUint32(0,true),bits=v.getUint16(14,true),compression=v.getUint32(16,true);if(![1,4,8,16,24,32].includes(bits)||![0,3,6].includes(compression))return null;
    const colors=v.getUint32(32,true)||(bits<=8?1<<bits:0),extra=header===40?(compression===3?12:compression===6?16:0):0,pixelOffset=14+header+colors*4+extra;
    if(colors>256||pixelOffset>bytes.length+14)return null;const bmp=new Uint8Array(bytes.length+14),w=view(bmp);w.setUint16(0,0x4d42,true);w.setUint32(2,bmp.length,true);w.setUint32(10,pixelOffset,true);bmp.set(bytes,14);bytes=bmp;mime='image/bmp';
  }
  return mime?'data:'+mime+';base64,'+toBase64(bytes):null;
}
export function rasterBytes(url){const match=String(url).match(/^data:image\/(?:png|jpeg|gif|bmp|x-icon|vnd\.microsoft\.icon);base64,([A-Za-z0-9+/=]+)$/i);if(!match)fail('native Picture export requires an embedded PNG, JPEG, GIF, BMP, or ICO');const bytes=fromBase64(match[1]);if(!rasterDataURL(bytes))fail('unsupported raster signature');return bytes;}
const TEXT_PROPERTIES=new Set(['text','caption','tooltiptext','textrtf','linktopic','tag']);
export function hydrateResources(project,diagnostics=[]){
  const cache=new Map(),paths=Object.keys(project.assets||{});
  for(const module of project.modules){if(!module.form)continue;for(const node of [module.form,...module.form.controls,...module.form.menus])for(const [key,reference]of Object.entries(node.properties||{})){
    if(!reference?.resource)continue;try{
      const path=resolveProjectPath(paths,module.sourcePath||module.name+'.frm',reference.resource);
      if(!path)fail('missing resource file '+reference.resource);if(!cache.has(path))cache.set(path,fromBase64(project.assets[path].data));
      const lower=key.toLowerCase();if(!TEXT_PROPERTIES.has(lower)&&!['list','picture','icon','mouseicon'].includes(lower))fail('property '+key+' is retained as an opaque resource');
      const record=readFRXRecord(cache.get(path),reference.offset,lower==='list'?'List':reference.text?'LongText':key,{encoding:module.resourceEncoding||'windows-1252'});let value;
      if(lower==='list')value=record.items;else if(['picture','icon','mouseicon'].includes(lower)){if(record.kind!=='picture')fail('picture header not supported');value=rasterDataURL(record.bytes);if(!value)fail('native/OLE/metafile picture retained; no raster browser decoder');}
      else {if(record.kind==='picture')fail('text references a picture record');value=decodeNativeBytes(record.bytes,module.resourceEncoding||'windows-1252');}
      node.resourceBindings ||= {};node.resourceBindings[key]={reference:{...reference},assetPath:path,kind:record.kind,signature:record.signature,encoding:module.resourceEncoding||'windows-1252',originalValue:structuredClone(value)};node.properties[key]=value;
    }catch(error){diagnostics.push({severity:'warning',source:module.name,message:node.name+'.'+key+': '+error.message+' (original bytes and reference retained).'});}
  }}return project;
}
/** Native export is copy-on-write: original blobs never move; edited entries append. */
export function prepareResources(project){
  const modules=structuredClone(project.modules),files=Object.create(null);for(const [path,asset]of Object.entries(project.assets||{})){cleanProjectPath(path);if(asset.encoding==='base64')files[path]=fromBase64(asset.data);}
  const append=(path,value,kind,options)=>{path=cleanProjectPath(path);const record=writeFRXRecord(value,kind,options),before=files[path]||new Uint8Array();if(before.length+record.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');const all=new Uint8Array(before.length+record.length);all.set(before);all.set(record,before.length);files[path]=all;return before.length.toString(16).toUpperCase().padStart(4,'0');};
  for(const module of modules){if(!module.form)continue;const source=module.sourcePath||module.name+'.frm';for(const node of [module.form,...module.form.controls,...module.form.menus])for(const [key,value]of Object.entries(node.properties||{})){
    if(value?.resource)continue;const binding=node.resourceBindings?.[key],same=binding&&JSON.stringify(value)===JSON.stringify(binding.originalValue);if(same){const reference={...binding.reference};let resolved;try{resolved=resolveProjectPath(Object.keys(files),source,reference.resource);}catch{}if(resolved?.toLowerCase()!==binding.assetPath.toLowerCase())reference.resource=relativeProjectPath(source,binding.assetPath);node.properties[key]=reference;continue;}
    const lower=key.toLowerCase(),picture=['picture','icon','mouseicon'].includes(lower),list=lower==='list'&&Array.isArray(value),text=TEXT_PROPERTIES.has(lower)&&typeof value==='string';
    if(!binding&&!list&&!(picture&&value)&&!(text&&(/[\r\n]/.test(value)||value.length>255)))continue;
    if(picture&&!value){delete node.properties[key];continue;}if(!list&&!picture&&!text)fail('cannot serialize edited opaque resource '+node.name+'.'+key);
    const path=binding?.assetPath||source.replace(/\.(frm|ctl|pag|dob|dsr)$/i,(_,ext)=>'.'+({frm:'frx',ctl:'ctx',pag:'pgx',dob:'dox',dsr:'dsx'})[ext.toLowerCase()]),kind=picture?'picture':list?'list':'text32',offset=append(path,picture?rasterBytes(value):value,kind,{signature:binding?.signature,encoding:binding?.encoding||module.resourceEncoding||'windows-1252'});
    node.properties[key]={resource:relativeProjectPath(source,path),offset,...(text?{text:true}:{})};
  }}return {modules,files};
}
