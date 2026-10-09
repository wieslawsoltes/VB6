import {UIError, boundedData, record, safeKey, safeUrl} from './safety.js';

/** Host-owned records, kept outside model-authored source and caller-provided data. */
export class UIReferenceStore {
  constructor({maxEntries=128, maxBytes=500000}={}) {
    if(!Number.isSafeInteger(maxEntries)||maxEntries<1||maxEntries>512||!Number.isSafeInteger(maxBytes)||maxBytes<1||maxBytes>2000000)throw new UIError('reference_limit','Invalid reference-store bounds.');
    this.maxEntries=maxEntries;this.maxBytes=maxBytes;this.entries=new Map();this.listeners=new Set();this.bytes=0;this.revision=0;this.closed=false;
  }
  put(id,value) {
    if(this.closed)throw new UIError('disposed','Reference store is disposed.');
    if(typeof id!=='string'||!id||id.length>256)throw new UIError('reference','Reference ID must contain 1–256 characters.');safeKey(id);
    const result=validateReference(value),bytes=JSON.stringify(result).length*2,old=this.entries.get(id);
    if((!old&&this.entries.size>=this.maxEntries)||this.bytes-(old?.bytes||0)+bytes>this.maxBytes)throw new UIError('reference_limit','Reference store is full.');
    this.entries.set(id,{value:result,bytes});this.bytes+=bytes-(old?.bytes||0);this.changed(id);return this.get(id);
  }
  get(id) {if(this.closed)return null;const entry=this.entries.get(id);return entry?boundedData(entry.value):null;}
  list() {return boundedData([...this.entries].map(([id,entry])=>({id,kind:entry.value.kind,title:entry.value.title||'',provenance:entry.value.provenance}))); }
  delete(id) {const old=this.entries.get(id);if(!old)return false;this.entries.delete(id);this.bytes-=old.bytes;this.changed(id);return true;}
  clear() {this.entries.clear();this.bytes=0;this.changed(null);}
  subscribe(listener) {if(typeof listener!=='function')throw new UIError('reference','A listener is required.');this.listeners.add(listener);return()=>this.listeners.delete(listener);}
  changed(id) {this.revision++;for(const listener of this.listeners)try{listener({id,revision:this.revision});}catch{}}
  dispose() {if(this.closed)return;this.clear();this.closed=true;this.listeners.clear();}
}
export function validateReference(input) {
  const value=boundedData(input,64000);
  if(!record(value)||!['image','images','entity','citation'].includes(value.kind))throw new UIError('reference','Unknown reference kind.');
  if(!record(value.provenance)||typeof value.provenance.source!=='string'||!value.provenance.source.trim())throw new UIError('provenance','Host references need an explicit source.');
  if(value.title!==undefined&&typeof value.title!=='string')throw new UIError('reference','Reference title must be text.');
  if(value.url!==undefined)value.url=safeUrl(value.url);
  if(value.kind==='image')value.src=safeUrl(value.src);
  if(value.kind==='images'){
    if(!Array.isArray(value.items)||value.items.length>32)throw new UIError('reference','An image group requires at most 32 images.');
    value.items=value.items.map(image=>{
      if(!record(image))throw new UIError('reference','Invalid image record.');
      const result={src:safeUrl(image.src),alt:typeof image.alt==='string'?image.alt:'',title:typeof image.title==='string'?image.title:''};
      if(image.url!==undefined)result.url=safeUrl(image.url);return result;
    });
  }
  return value;
}
