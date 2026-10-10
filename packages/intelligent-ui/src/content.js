import {UIError, boundedData, record} from './safety.js';

// MCP ContentBlock is data, never executable markup or an instruction to fetch a URI.
// Source of truth: modelcontextprotocol/ext-apps src/spec.types.ts (2026-01-26).
export const CONTENT_TYPES=Object.freeze(['text','image','audio','resource','resource_link']);
const mime=value=>typeof value==='string'&&value.length<=128&&/^[a-z0-9][a-z0-9!#$&^_.+-]*\/[a-z0-9][a-z0-9!#$&^_.+-]*$/i.test(value);
export function base64Bytes(value){
  if(typeof value!=='string'||value.length>192000||value.length%4||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value))throw new UIError('content','Expected bounded canonical base64 data.');
  const decoded=atob(value);
  if(btoa(decoded)!==value)throw new UIError('content','Base64 padding bits are invalid.');
  return Uint8Array.from(decoded,c=>c.charCodeAt(0));
}
function uri(value){
  if(typeof value!=='string'||value.length>4096||/[\x00-\x20]/.test(value))throw new UIError('content','Invalid resource URI.');
  let url;try{url=new URL(value);}catch{throw new UIError('content','Resource URI must be absolute.');}
  if(url.username||url.password||['javascript:','data:','vbscript:'].includes(url.protocol))throw new UIError('content','Unsafe resource URI.');
  return value;
}
export function normalizeContentBlocks(value,{types=CONTENT_TYPES,allowEmpty=true}={}){
  const blocks=boundedData(value,500000,{maxText:192000});
  if(!Array.isArray(blocks)||blocks.length>32||!allowEmpty&&!blocks.length)throw new UIError('content','Expected up to 32 content blocks.');
  for(const b of blocks){
    if(!record(b)||!types.includes(b.type))throw new UIError('content','Content type is not enabled by this host.');
    if(b.type==='text'){if(typeof b.text!=='string'||b.text.length>100000)throw new UIError('content','Invalid text content.');}
    else if(b.type==='image'||b.type==='audio'){
      if(!mime(b.mimeType)||!b.mimeType.startsWith(b.type+'/')||!base64Bytes(b.data).length)throw new UIError('content','Invalid media content.');
    }else if(b.type==='resource'){
      const r=b.resource;
      if(!record(r)||(typeof r.text==='string')===(typeof r.blob==='string'))throw new UIError('content','An embedded resource needs exactly one text or blob value.');
      uri(r.uri);if(r.mimeType!==undefined&&!mime(r.mimeType))throw new UIError('content','Invalid resource MIME type.');
      if(r.blob!==undefined)base64Bytes(r.blob);
    }else {uri(b.uri);if(typeof b.name!=='string'||!b.name||b.name.length>256||b.mimeType!==undefined&&!mime(b.mimeType)||b.size!==undefined&&(!Number.isSafeInteger(b.size)||b.size<0))throw new UIError('content','Invalid resource link.');}
    if(b.annotations!==undefined){const a=b.annotations;if(!record(a)||a.audience!==undefined&&(!Array.isArray(a.audience)||a.audience.some(v=>!['user','assistant'].includes(v)))||a.priority!==undefined&&(typeof a.priority!=='number'||a.priority<0||a.priority>1)||a.lastModified!==undefined&&(typeof a.lastModified!=='string'||!Number.isFinite(Date.parse(a.lastModified))))throw new UIError('content','Invalid content annotations.');}
  }
  return blocks;
}
export function contentSummary(blocks){
  return normalizeContentBlocks(blocks).map(b=>b.type==='text'?b.text:b.type==='resource'?`[Resource ${b.resource.uri}; ${b.resource.mimeType||'unspecified MIME'}]\n`+(b.resource.text??`[${base64Bytes(b.resource.blob).length} binary bytes]`):b.type==='resource_link'?`[Linked resource ${b.name}: ${b.uri}; not fetched]`:`[${b.type}: ${b.mimeType}, ${base64Bytes(b.data).length} bytes]`).join('\n');
}
export function normalizeModelContext(value){
  const clean=boundedData(value,500000,{maxText:192000});
  if(!record(clean)||Object.keys(clean).some(k=>!['content','structuredContent'].includes(k)))throw new UIError('context','Invalid model context fields.');
  if(clean.content!==undefined)clean.content=normalizeContentBlocks(clean.content);
  if(clean.structuredContent!==undefined&&!record(clean.structuredContent))throw new UIError('context','Structured context must be an object.');
  return clean;
}
/** Latest reviewed context per view, not a follow-up queue. No persistence or effects. */
export class UIModelContextStore {
  constructor(){this.entries=new Map();this.revision=0;}
  set(id,value){
    if(typeof id!=='string'||!id||id.length>256)throw new UIError('context','Invalid view context identifier.');
    const clean=normalizeModelContext(value),next=new Map(this.entries);
    next.set(id,clean);if(next.size>16)throw new UIError('context','Too many view contexts.');
    boundedData([...next],500000,{maxText:192000});
    if([...next.values()].reduce((n,v)=>n+1+(v.content?.length||0),0)>32)throw new UIError('context','Combined view context exceeds the content-block limit.');
    if(JSON.stringify(this.entries.get(id))!==JSON.stringify(clean)){this.entries=next;this.revision++;}
    return this.revision;
  }
  delete(id){if(this.entries.delete(id))this.revision++;}
  clear(){if(this.entries.size){this.entries.clear();this.revision++;}}
  snapshot(){return boundedData([...this.entries].map(([id,value])=>({id,...value})),500000,{maxText:192000});}
}
/** Resolve ONLY connection-allowlisted links; stage every file before writing any. */
export async function prepareDownloads(contents,{resourceUris=[],readResource,signal}={}){
  const blocks=normalizeContentBlocks(contents,{types:['resource','resource_link'],allowEmpty:false});
  if(blocks.length>8)throw new UIError('download','At most eight files per download.');
  const allow=new Set(resourceUris),files=[];
  for(const block of blocks){
    signal?.throwIfAborted();let resources;
    if(block.type==='resource_link'){
      if(!allow.has(block.uri)||!readResource)throw new UIError('download','Linked resource is not available to this connection.');
      const response=await readResource(block.uri,{signal});signal?.throwIfAborted();
      if(!Array.isArray(response?.contents)||response.contents.some(r=>r.uri!==block.uri))throw new UIError('download','Linked resource response does not match the requested URI.');
      resources=normalizeContentBlocks(response.contents.map(resource=>({type:'resource',resource})),{types:['resource']});
    }else resources=[block];
    for(const {resource:r} of resources){
      const bytes=r.blob===undefined?new TextEncoder().encode(r.text):base64Bytes(r.blob);
      if(files.length>=8||files.reduce((n,f)=>n+f.bytes.length,0)+bytes.length>256000)throw new UIError('download','Download batch exceeds its byte limit.');
      const candidate=block.name||new URL(r.uri).pathname.split('/').pop()||'resource';
      const name=candidate.replace(/[^a-zA-Z0-9._-]/g,'_').replace(/^\.+/,'').slice(0,120)||'resource';
      files.push({name,mimeType:r.mimeType||'application/octet-stream',bytes});
    }
  }
  signal?.throwIfAborted();if(!files.length)throw new UIError('download','No resource content was returned.');return files;
}
