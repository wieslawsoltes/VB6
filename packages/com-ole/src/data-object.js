import {ComError,HRESULT,IID,integer,FAILED} from './contracts.js';
import {ComObject,ComEnumerator} from './identity.js';
import {StgMedium,formatEtc,ADVF,DATADIR} from './medium.js';
const key=f=>`${f.cfFormat}:${f.dwAspect}:${f.lindex}:${f.tymed}`;
const matches=(a,b)=>(a.cfFormat===0||a.cfFormat===b.cfFormat&&a.dwAspect===b.dwAspect&&a.lindex===b.lindex&&(a.tymed&b.tymed)!==0);
function sync(value){if(value?.then){Promise.resolve(value).catch(()=>{});throw new ComError(HRESULT.E_INVALIDARG,'OLE callbacks must be synchronous');}return value;}
/** Portable IDataObject, including delayed rendering and reentrancy-safe advisory connections. */
export class OleDataObject extends ComObject {
  #entries=new Map();#advises=new Map();#next=0;#rendering=new Set();#depth=0;#stopped=false;#maxBytes;#failures=[];
  constructor({maxBytes=16*1024*1024}={}){super([IID.IDataObject]);this.#maxBytes=integer(maxBytes,0,256*1024*1024);}
  get notificationFailures(){return this.#failures.slice();}
  #record(error,cookie=0){if(this.#failures.length===64)this.#failures.shift();this.#failures.push({cookie,error});}
  #validate(medium,format){
    if(!(medium instanceof StgMedium)||medium.tymed!==format.tymed)throw new ComError(HRESULT.DV_E_TYMED,'Renderer returned the wrong medium');
    if(medium.byteLength>this.#maxBytes)throw new ComError(HRESULT.STG_E_MEDIUMFULL,'OLE data limit exceeded');
  }
  #install(format,entry){
    const id=key(format),previous=this.#entries.get(id);
    if(!previous&&this.#entries.size>=256)throw new ComError(HRESULT.E_OUTOFMEMORY,'OLE format limit exceeded');
    const bytes=[...this.#entries].reduce((sum,[k,e])=>sum+(k===id?0:e.medium?.byteLength||0),entry.medium?.byteLength||0);
    if(bytes>this.#maxBytes)throw new ComError(HRESULT.STG_E_MEDIUMFULL,'OLE aggregate data limit exceeded');
    this.#entries.set(id,{format,...entry});
    // Replacement is committed before arbitrary owner cleanup or advisory callbacks run.
    try{previous?.medium?.release();}catch(error){this.#record(error);}
  }
  SetData(format,medium,release=false){
    this.assertAlive();format=formatEtc(format,{singleMedium:true});if(typeof release!=='boolean')throw new ComError(HRESULT.E_INVALIDARG);this.#validate(medium,format);
    // Validate capacity before transferring the caller's ownership.
    const id=key(format);if(!this.#entries.has(id)&&this.#entries.size>=256)throw new ComError(HRESULT.E_OUTOFMEMORY);
    const total=[...this.#entries].reduce((n,[k,e])=>n+(k===id?0:e.medium?.byteLength||0),medium.byteLength);
    if(total>this.#maxBytes)throw new ComError(HRESULT.STG_E_MEDIUMFULL);
    const owned=release?medium.move():medium.clone();this.AddRef();
    try{this.#install(format,{medium:owned});this.#notify(format);return HRESULT.S_OK;}catch(error){if(![...this.#entries.values()].some(e=>e.medium===owned))owned.release();throw error;}finally{this.Release();}
  }
  SetDelayedData(format,render){
    this.assertAlive();format=formatEtc(format,{singleMedium:true});if(typeof render!=='function')throw new ComError(HRESULT.E_INVALIDARG);
    this.AddRef();try{this.#install(format,{render});this.#notify(format);return HRESULT.S_OK;}finally{this.Release();}
  }
  #find(format){
    let list=[...this.#entries.values()].filter(e=>e.format.cfFormat===format.cfFormat);if(!list.length)throw new ComError(HRESULT.DV_E_FORMATETC);
    list=list.filter(e=>e.format.dwAspect===format.dwAspect);if(!list.length)throw new ComError(HRESULT.DV_E_DVASPECT);
    list=list.filter(e=>e.format.lindex===format.lindex);if(!list.length)throw new ComError(HRESULT.DV_E_LINDEX);
    const entry=list.find(e=>(e.format.tymed&format.tymed)!==0);if(!entry)throw new ComError(HRESULT.DV_E_TYMED);return entry;
  }
  QueryGetData(format){this.assertAlive();try{this.#find(formatEtc(format));return HRESULT.S_OK;}catch(error){if(error instanceof ComError)return error.hresult;throw error;}}
  GetData(format){
    this.assertAlive();const entry=this.#find(formatEtc(format)),id=key(entry.format);
    if(this.#rendering.has(id)||this.#rendering.size>=32)throw new ComError(HRESULT.E_ABORT,'Recursive delayed rendering');
    this.AddRef();this.#rendering.add(id);let result;
    try{result=entry.medium?entry.medium.clone():sync(entry.render(entry.format));this.#validate(result,entry.format);return result;}
    catch(error){if(result instanceof StgMedium&&!result.released)result.release();throw error;}
    finally{this.#rendering.delete(id);this.Release();}
  }
  GetDataHere(format,destination){
    this.assertAlive();format=formatEtc(format,{singleMedium:true});this.#validate(destination,format);
    if(destination.owner)throw new ComError(HRESULT.E_INVALIDARG,'GetDataHere needs caller-owned storage');
    const source=this.GetData(format);
    try{
      if(format.tymed===1){if(destination.data.length<source.data.length)throw new ComError(HRESULT.STG_E_MEDIUMFULL);destination.data.set(source.data);}
      else{source.data.Seek(0);const result=source.data.CopyTo(destination.data,source.byteLength);if(FAILED(result.hresult)||result.bytesWritten!==source.byteLength)throw new ComError(HRESULT.STG_E_MEDIUMFULL);}
      return HRESULT.S_OK;
    }finally{source.release();}
  }
  GetCanonicalFormatEtc(format){this.assertAlive();return {hresult:HRESULT.DATA_S_SAMEFORMATETC,format:formatEtc(format)};}
  EnumFormatEtc(direction=DATADIR.GET){this.assertAlive();if(![1,2].includes(direction))throw new ComError(HRESULT.E_INVALIDARG);return new ComEnumerator([...this.#entries.values()].map(e=>e.format),{iid:IID.IEnumFORMATETC,copy:f=>({...f})});}
  DAdvise(format,flags,sink){
    this.assertAlive();if(!Number.isInteger(flags)||flags<0||(flags&~71))throw new ComError(HRESULT.OLE_E_ADVISENOTSUPPORTED);
    format=formatEtc(format,{wildcard:(flags&ADVF.NODATA)!==0});if(this.#advises.size>=256)throw new ComError(HRESULT.CONNECT_E_ADVISELIMIT);
    const reference=sink.QueryInterface(IID.IAdviseSink);if(typeof reference.OnDataChange!=='function'){reference.Release();throw new ComError(HRESULT.E_NOINTERFACE);}
    const cookie=++this.#next,entry={format,flags,sink:reference};this.#advises.set(cookie,entry);
    if(flags&ADVF.PRIMEFIRST)this.#notify(format,cookie);
    return cookie;
  }
  DUnadvise(cookie){this.assertAlive();const entry=this.#advises.get(cookie);if(!entry)throw new ComError(HRESULT.OLE_E_NOCONNECTION);this.#advises.delete(cookie);entry.sink.Release();return HRESULT.S_OK;}
  EnumDAdvise(){this.assertAlive();return new ComEnumerator([...this.#advises].map(([cookie,e])=>({cookie,...e})),{iid:IID.IEnumSTATDATA,retain:e=>e.sink.AddRef(),release:e=>e.sink.Release(),copy:e=>{e.sink.AddRef();return {...e,format:{...e.format}};}});}
  #notify(format,onlyCookie=null,stopping=false){
    if(this.#depth>=32){this.#record(new ComError(HRESULT.E_ABORT,'Advisory recursion limit'));return;}
    this.AddRef();this.#depth++;
    try{for(const [cookie,e]of [...this.#advises]){
      if(!this.#advises.has(cookie)||onlyCookie!==null&&cookie!==onlyCookie||!matches(e.format,format)||stopping&&!(e.flags&64)||!stopping&&(e.flags&64)&&onlyCookie===null)continue;
      e.sink.AddRef();let medium;
      try{
        medium=(e.flags&ADVF.NODATA)&&!stopping?new StgMedium(0):this.GetData(e.format);
        if(e.flags&ADVF.ONLYONCE)this.DUnadvise(cookie);
        sync(e.sink.OnDataChange(e.format,medium));
      }catch(error){this.#record(error,cookie);}finally{try{if(medium&&!medium.released)medium.release();}finally{e.sink.Release();}}
    }}finally{this.#depth--;this.Release();}
  }
  /** Explicit shutdown phase, while the object can still satisfy DATAONSTOP callbacks. */
  Stop(){this.assertAlive();if(this.#stopped)return HRESULT.S_FALSE;this.#stopped=true;this.AddRef();try{for(const [cookie,e]of [...this.#advises])if(e.flags&64)this.#notify(e.format,cookie,true);return HRESULT.S_OK;}finally{this.Release();}}
  Release(){if(!this.disposed&&this.referenceCount===1&&!this.#stopped)this.Stop();return super.Release();}
  disposeResources(){
    const entries=[...this.#entries.values()],sinks=[...this.#advises.values()];this.#entries.clear();this.#advises.clear();const errors=[];
    for(const e of entries)try{e.medium?.release();}catch(error){errors.push(error);}for(const e of sinks)try{e.sink.Release();}catch(error){errors.push(error);}
    if(errors.length)throw new AggregateError(errors,'OLE data object cleanup failed');
  }
}
