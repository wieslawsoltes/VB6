import {ComError,HRESULT,IID,guid,integer} from './contracts.js';
import {ComObject,ComEnumerator} from './identity.js';
const progId=value=>{if(typeof value!=='string'||! /^[A-Za-z][A-Za-z0-9_.]{0,254}$/.test(value))throw new ComError(HRESULT.E_INVALIDARG,'Invalid ProgID');return value.toLowerCase();};
export class ComClassFactory extends ComObject {
  #create; #locks=0;
  constructor(create) { super([IID.IClassFactory]);if(typeof create!=='function')throw new ComError(HRESULT.E_INVALIDARG);this.#create=create; }
  CreateInstance(outer=null,iid=IID.IUnknown) {
    this.assertAlive();if(outer!==null)throw new ComError(HRESULT.CLASS_E_NOAGGREGATION,'Aggregation is not supported by this factory');
    iid=guid(iid);const instance=this.#create();if(!instance?.QueryInterface||!instance?.Release)throw new ComError(HRESULT.E_NOINTERFACE,'Factory must return an owned COM object');
    try{return instance.QueryInterface(iid);}finally{instance.Release();}
  }
  LockServer(lock) {this.assertAlive();if(typeof lock!=='boolean'||!lock&&!this.#locks)throw new ComError(HRESULT.E_UNEXPECTED,'Unbalanced server lock');if(lock){this.AddRef();this.#locks++;}else{this.#locks--;this.Release();}return HRESULT.S_OK;}
  get serverLocks(){return this.#locks;}
}
/** Host-installed factories only: no imports, OS registration or activation from project metadata. */
export class ComClassRegistry {
  #classes=new Map(); #names=new Map(); #closed=false;
  #assert(){if(this.#closed)throw new ComError(HRESULT.CO_E_OBJNOTCONNECTED,'Class registry is closed');}
  RegisterClass(clsid,factory,{progIds=[]}={}) {
    this.#assert();clsid=guid(clsid);if(this.#classes.size>=256||this.#classes.has(clsid))throw new ComError(HRESULT.E_INVALIDARG,'Duplicate or excessive class registration');
    if(!Array.isArray(progIds)||progIds.length>32)throw new ComError(HRESULT.E_INVALIDARG);const names=progIds.map(progId);
    if(new Set(names).size!==names.length||names.some(n=>this.#names.has(n)))throw new ComError(HRESULT.E_INVALIDARG,'Duplicate ProgID');
    const reference=factory.QueryInterface(IID.IClassFactory);this.#classes.set(clsid,{factory:reference,names});for(const name of names)this.#names.set(name,clsid);return clsid;
  }
  CLSIDFromProgID(name){this.#assert();const id=this.#names.get(progId(name));if(!id)throw new ComError(HRESULT.REGDB_E_CLASSNOTREG);return id;}
  GetClassObject(id){this.#assert();const key=/^[{0-9a-f-]{36,38}$/i.test(id)?guid(id):this.CLSIDFromProgID(id);const entry=this.#classes.get(key);if(!entry)throw new ComError(HRESULT.REGDB_E_CLASSNOTREG);return entry.factory.QueryInterface(IID.IClassFactory);}
  CreateInstance(id,iid=IID.IUnknown){const factory=this.GetClassObject(id);try{return factory.CreateInstance(null,iid);}finally{factory.Release();}}
  RevokeClass(clsid){this.#assert();const key=guid(clsid),entry=this.#classes.get(key);if(!entry)throw new ComError(HRESULT.REGDB_E_CLASSNOTREG);this.#classes.delete(key);for(const name of entry.names)this.#names.delete(name);entry.factory.Release();return HRESULT.S_OK;}
  close(){if(this.#closed)return;this.#closed=true;const entries=[...this.#classes.values()];this.#classes.clear();this.#names.clear();const errors=[];for(const entry of entries)try{entry.factory.Release();}catch(e){errors.push(e);}if(errors.length)throw new AggregateError(errors,'Class registry release failed');}
}
/** Exact, case-sensitive portable names. Never interpreted as files, URLs or executable monikers. */
export class DisplayNameMoniker extends ComObject {
  #name;
  constructor(name){super([IID.IMoniker]);if(typeof name!=='string'||!name.length||name.length>4096||name.includes('\0'))throw new ComError(HRESULT.E_INVALIDARG,'Invalid moniker name');this.#name=name;}
  GetDisplayName(){this.assertAlive();return this.#name;}
  IsEqual(other){this.assertAlive();return other instanceof DisplayNameMoniker&&other.GetDisplayName()===this.#name?HRESULT.S_OK:HRESULT.S_FALSE;}
  BindToObject(rot,iid=IID.IUnknown){this.assertAlive();const object=rot.GetObject(this);try{return object.QueryInterface(iid);}finally{object.Release();}}
}
export const ROTFLAGS_REGISTRATIONKEEPSALIVE=1;
export class RunningObjectTable extends ComObject {
  #entries=new Map(); #next=0;
  constructor(){super([IID.IRunningObjectTable]);}
  Register(flags,object,moniker){
    this.assertAlive();integer(flags,0,1);if(!(moniker instanceof DisplayNameMoniker))throw new ComError(HRESULT.E_INVALIDARG,'A portable moniker is required');
    if(this.#entries.size>=256)throw new ComError(HRESULT.E_OUTOFMEMORY,'Running object table limit');
    const name=moniker.GetDisplayName(),reference=object.QueryInterface(IID.IUnknown),duplicate=[...this.#entries.values()].some(x=>x.name===name&&this.#object(x));
    moniker.AddRef();const cookie=++this.#next;this.#entries.set(cookie,{name,moniker,strong:flags===1?reference:null,weak:flags===0?new WeakRef(reference):null,changed:Date.now()});if(flags===0)reference.Release();
    return {cookie,hresult:duplicate?HRESULT.MK_S_MONIKERALREADYREGISTERED:HRESULT.S_OK};
  }
  #object(entry){const value=entry.strong||entry.weak?.deref();return value&&!value.disposed?value:null;}
  Revoke(cookie){this.assertAlive();const entry=this.#entries.get(cookie);if(!entry)throw new ComError(HRESULT.E_INVALIDARG,'Unknown running object cookie');this.#entries.delete(cookie);try{entry.strong?.Release();}finally{entry.moniker.Release();}return HRESULT.S_OK;}
  GetObject(moniker){this.assertAlive();const name=moniker.GetDisplayName();for(const entry of this.#entries.values()){const object=this.#object(entry);if(entry.name===name&&object){object.AddRef();return object;}}throw new ComError(HRESULT.MK_E_UNAVAILABLE,'No active object for this exact moniker');}
  IsRunning(moniker){try{this.GetObject(moniker).Release();return HRESULT.S_OK;}catch(error){if(error.hresult===HRESULT.MK_E_UNAVAILABLE)return HRESULT.S_FALSE;throw error;}}
  NoteChangeTime(cookie,time){this.assertAlive();integer(time,0,Number.MAX_SAFE_INTEGER);const entry=this.#entries.get(cookie);if(!entry)throw new ComError(HRESULT.E_INVALIDARG);entry.changed=time;return HRESULT.S_OK;}
  GetTimeOfLastChange(moniker){this.assertAlive();const name=moniker.GetDisplayName(),entry=[...this.#entries.values()].find(x=>x.name===name&&this.#object(x));if(!entry)throw new ComError(HRESULT.MK_E_UNAVAILABLE);return entry.changed;}
  EnumRunning(){this.assertAlive();return new ComEnumerator([...this.#entries.values()].filter(x=>this.#object(x)).map(x=>x.moniker),{iid:IID.IEnumMoniker,retain:x=>x.AddRef(),release:x=>x.Release(),copy:x=>{x.AddRef();return x;}});}
  disposeResources(){const entries=[...this.#entries.values()];this.#entries.clear();const errors=[];for(const entry of entries){try{entry.strong?.Release();}catch(e){errors.push(e);}try{entry.moniker.Release();}catch(e){errors.push(e);}}if(errors.length)throw new AggregateError(errors,'Running object table release failed');}
}
