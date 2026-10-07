import {ComError,HRESULT,IID,integer} from './contracts.js';
export const TYMED=Object.freeze({NULL:0,HGLOBAL:1,FILE:2,ISTREAM:4,ISTORAGE:8,GDI:16,MFPICT:32,ENHMF:64});
export const DVASPECT=Object.freeze({CONTENT:1,THUMBNAIL:2,ICON:4,DOCPRINT:8});
export const DATADIR=Object.freeze({GET:1,SET:2});
export const ADVF=Object.freeze({NODATA:1,PRIMEFIRST:2,ONLYONCE:4,DATAONSTOP:64});
export const CF=Object.freeze({TEXT:1,BITMAP:2,METAFILEPICT:3,SYLK:4,DIF:5,TIFF:6,OEMTEXT:7,DIB:8,PALETTE:9,PENDATA:10,RIFF:11,WAVE:12,UNICODETEXT:13,ENHMETAFILE:14,HDROP:15,LOCALE:16,DIBV5:17});
export function formatEtc(value,{singleMedium=false,wildcard=false}={}) {
  if(!value||typeof value!=='object'||value.ptd!=null)throw new ComError(HRESULT.DV_E_FORMATETC,'Target-device pointers are not portable');
  const {cfFormat,dwAspect=1,lindex=-1,tymed=1}=value;
  if(wildcard&&cfFormat===0&&dwAspect===-1&&lindex===-1&&tymed===-1)return Object.freeze({cfFormat,ptd:null,dwAspect,lindex,tymed});
  if(!Number.isInteger(cfFormat)||cfFormat<1||cfFormat>65535)throw new ComError(HRESULT.DV_E_FORMATETC,'Invalid clipboard format');
  if(![1,2,4,8].includes(dwAspect))throw new ComError(HRESULT.DV_E_DVASPECT);
  if(!Number.isInteger(lindex)||lindex< -1||lindex>0x7fffffff)throw new ComError(HRESULT.DV_E_LINDEX);
  if(!Number.isInteger(tymed)||tymed<1||(tymed&~5)||singleMedium&&![1,4].includes(tymed))throw new ComError(HRESULT.DV_E_TYMED,'Only byte buffers and streams are portable media');
  return Object.freeze({cfFormat,ptd:null,dwAspect,lindex,tymed});
}
/** Owns one medium and optional release-owner reference. Buffer handles are Uint8Arrays, not OS handles. */
export class StgMedium {
  #tymed; #data; #owner; #released=false;
  constructor(tymed,data=null,{owner=null,copy=true}={}) {
    if(![0,1,4].includes(tymed))throw new ComError(HRESULT.DV_E_TYMED);
    if(typeof copy!=='boolean'||tymed===0&&(data!==null||owner!==null))throw new ComError(HRESULT.E_INVALIDARG);
    if(tymed===1&&!(data instanceof Uint8Array))throw new ComError(HRESULT.DV_E_TYMED,'HGLOBAL requires bytes');
    this.#tymed=tymed;this.#data=tymed===1?(copy?data.slice():data):null;
    if(tymed===4)this.#data=data.QueryInterface(IID.IStream);
    try{this.#owner=owner?.QueryInterface(IID.IUnknown)||null;}catch(error){if(tymed===4)this.#data.Release();throw error;}
  }
  get released(){return this.#released;}
  assertAlive(){if(this.#released)throw new ComError(HRESULT.CO_E_OBJNOTCONNECTED,'Storage medium was released or transferred');}
  get tymed(){this.assertAlive();return this.#tymed;}
  get data(){this.assertAlive();return this.#data;}
  get owner(){this.assertAlive();return this.#owner;}
  get byteLength(){this.assertAlive();return this.#tymed===1?this.#data.byteLength:this.#tymed===4?integer(this.#data.Stat().size,0,Number.MAX_SAFE_INTEGER):0;}
  clone(){
    this.assertAlive();if(this.#tymed!==4)return new StgMedium(this.#tymed,this.#data);
    const stream=this.#data.Clone();try{return new StgMedium(4,stream);}finally{stream.Release();}
  }
  /** Move invalidates this wrapper without incrementing/decrementing the transferred references. */
  move(){this.assertAlive();const result=new StgMedium(0);result.#tymed=this.#tymed;result.#data=this.#data;result.#owner=this.#owner;this.#released=true;this.#data=null;this.#owner=null;return result;}
  release(){
    this.assertAlive();this.#released=true;const data=this.#data,owner=this.#owner;this.#data=null;this.#owner=null;
    try{if(this.#tymed===4)data.Release();}finally{owner?.Release();}
  }
}
export function ReleaseStgMedium(medium){if(!(medium instanceof StgMedium))throw new ComError(HRESULT.E_INVALIDARG);medium.release();}
/** Registry is scoped to its embedding host; registered-format numbers are not globally meaningful. */
export class ClipboardFormats {
  #names=new Map();#ids=new Map();#next=0xc000;
  RegisterClipboardFormat(name){
    if(typeof name!=='string'||!name.length||name.length>255||name.includes('\0'))throw new ComError(HRESULT.E_INVALIDARG,'Invalid format name');
    const key=name.toLowerCase();if(this.#names.has(key))return this.#names.get(key);
    if(this.#next>0xffff)throw new ComError(HRESULT.E_OUTOFMEMORY,'Registered format range exhausted');
    const id=this.#next++;this.#names.set(key,id);this.#ids.set(id,name);return id;
  }
  GetClipboardFormatName(id){integer(id,0xc000,0xffff);return this.#ids.get(id)||null;}
}
