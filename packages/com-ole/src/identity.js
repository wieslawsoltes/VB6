import {ComError,HRESULT,IID,guid,integer} from './contracts.js';
/** Explicit ownership, independent of JavaScript GC. Interfaces are fixed at construction. */
export class ComObject {
  #refs=1; #interfaces=new Map(); #disposed=false;
  constructor(interfaces=[]) {
    this.#interfaces.set(IID.IUnknown,this);
    for (const item of interfaces) {
      const [id,implementation]=Array.isArray(item)?item:[item,this], key=guid(id);
      if (key===IID.IUnknown || this.#interfaces.has(key)) throw new ComError(HRESULT.E_INVALIDARG,'Duplicate COM interface');
      if (implementation===this) { this.#interfaces.set(key,this); continue; }
      if (!implementation || typeof implementation!=='object') throw new ComError(HRESULT.E_INVALIDARG,'Invalid interface implementation');
      const view=Object.create(null);
      for (const name of Object.keys(implementation)) {
        if (['QueryInterface','AddRef','Release'].includes(name) || typeof implementation[name]!=='function') throw new ComError(HRESULT.E_INVALIDARG,'Interfaces contain explicit methods only');
        const fn=implementation[name]; view[name]=(...args)=>{this.assertAlive();return fn.apply(implementation,args);};
      }
      Object.assign(view,{QueryInterface:id=>this.QueryInterface(id),AddRef:()=>this.AddRef(),Release:()=>this.Release()});
      this.#interfaces.set(key,Object.freeze(view));
    }
  }
  get disposed() { return this.#disposed; }
  get referenceCount() { return this.#refs; }
  assertAlive() { if (this.#disposed) throw new ComError(HRESULT.CO_E_OBJNOTCONNECTED,'COM object has been released'); }
  QueryInterface(id) {
    this.assertAlive(); const result=this.#interfaces.get(guid(id));
    if (!result) throw new ComError(HRESULT.E_NOINTERFACE,'Interface is not supported');
    this.AddRef(); return result;
  }
  AddRef() { this.assertAlive(); if(this.#refs===0xffffffff)throw new ComError(HRESULT.E_OUTOFMEMORY,'Reference count overflow');return ++this.#refs; }
  Release() {
    this.assertAlive(); if (--this.#refs) return this.#refs;
    this.#disposed=true; this.#interfaces.clear(); this.disposeResources(); return 0;
  }
  disposeResources() {}
}
export function sameComIdentity(a,b) {
  let x,y;
  try { x=a.QueryInterface(IID.IUnknown); y=b.QueryInterface(IID.IUnknown); return x===y; }
  finally { try { y?.Release(); } finally { x?.Release(); } }
}
/** Snapshot enumerator. Retain/release hooks make pointer-bearing snapshots own their references. */
export class ComEnumerator extends ComObject {
  #items; #position; #iid; #retain; #release; #copy;
  constructor(items,{iid=IID.IEnumVARIANT,position=0,retain=()=>{},release=()=>{},copy=x=>x}={}) {
    super([iid]); if(!Array.isArray(items)||items.length>10000)throw new ComError(HRESULT.E_INVALIDARG,'Enumeration limit exceeded');
    this.#position=integer(position,0,items.length);this.#iid=iid;this.#retain=retain;this.#release=release;this.#copy=copy;this.#items=[];
    try { for(const item of items){retain(item);this.#items.push(item);} }
    catch(error){const errors=[error];for(const item of this.#items)try{release(item);}catch(cleanup){errors.push(cleanup);}this.#items=[];if(errors.length>1)throw new AggregateError(errors,'Enumerator acquisition and rollback failed');throw error;}
  }
  Next(count=1) {
    this.assertAlive(); integer(count,0,10000); const end=Math.min(this.#position+count,this.#items.length),values=[];
    try{for(let i=this.#position;i<end;i++)values.push(this.#copy(this.#items[i]));}
    catch(error){const errors=[error];for(const value of values)try{this.#release(value);}catch(cleanup){errors.push(cleanup);}if(errors.length>1)throw new AggregateError(errors,'Enumerator copy and rollback failed');throw error;}
    this.#position=end; return {hresult:values.length===count?HRESULT.S_OK:HRESULT.S_FALSE,values,fetched:values.length};
  }
  Skip(count) { this.assertAlive();integer(count);const previous=this.#position;this.#position=Math.min(this.#items.length,previous+count);return this.#position-previous===count?HRESULT.S_OK:HRESULT.S_FALSE; }
  Reset() { this.assertAlive();this.#position=0;return HRESULT.S_OK; }
  Clone() { this.assertAlive();return new ComEnumerator(this.#items,{iid:this.#iid,position:this.#position,retain:this.#retain,release:this.#release,copy:this.#copy}); }
  disposeResources() { const errors=[];for(const item of this.#items)try{this.#release(item);}catch(e){errors.push(e);}this.#items=[];if(errors.length)throw new AggregateError(errors,'Enumerator release failed'); }
}
export class ConnectionPoint extends ComObject {
  #iid; #connections=new Map(); #next=0; #depth=0;
  constructor(iid) { super([IID.IConnectionPoint]);this.#iid=guid(iid); }
  GetConnectionInterface() { this.assertAlive();return this.#iid; }
  Advise(sink) {
    this.assertAlive();if(this.#connections.size>=256)throw new ComError(HRESULT.CONNECT_E_ADVISELIMIT);
    let reference;try{reference=sink.QueryInterface(this.#iid);}catch(error){throw new ComError(HRESULT.CONNECT_E_CANNOTCONNECT,'Sink does not support the outgoing IID',{cause:error});}
    const cookie=++this.#next;this.#connections.set(cookie,reference);return cookie;
  }
  Unadvise(cookie) {
    this.assertAlive();const sink=this.#connections.get(cookie);if(!sink)throw new ComError(HRESULT.CONNECT_E_NOCONNECTION);
    this.#connections.delete(cookie);sink.Release();return HRESULT.S_OK;
  }
  EnumConnections() {
    this.assertAlive();return new ComEnumerator([...this.#connections].map(([cookie,sink])=>({cookie,sink})),{
      iid:IID.IEnumConnections,retain:x=>x.sink.AddRef(),release:x=>x.sink.Release(),copy:x=>{x.sink.AddRef();return {...x};}
    });
  }
  /** Synchronous COM-style callbacks; each failure is reported without starving other sinks. */
  Fire(callback) {
    this.assertAlive();if(typeof callback!=='function')throw new ComError(HRESULT.E_INVALIDARG);if(this.#depth>=32)throw new ComError(HRESULT.E_ABORT,'Event recursion limit');
    this.AddRef();this.#depth++;const failures=[];
    try { for(const [cookie,sink] of [...this.#connections]) {
      if(!this.#connections.has(cookie))continue;sink.AddRef();
      try { const result=callback(sink,cookie);if(result?.then){Promise.resolve(result).catch(()=>{});throw new ComError(HRESULT.E_INVALIDARG,'COM callbacks must be synchronous');} }
      catch(error){failures.push({cookie,error});}finally{sink.Release();}
    }return failures; } finally { this.#depth--;this.Release(); }
  }
  disposeResources() {const sinks=[...this.#connections.values()];this.#connections.clear();const errors=[];for(const sink of sinks)try{sink.Release();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Connection release failed');}
}
