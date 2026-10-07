/** Trusted host-installed Automation adapters. Projects never supply executable factories. */
import {VBError} from '../language/lexer.js';
import {Ref,Cell,MISSING,unbox,readScalar} from './values.js';
const objects=new WeakMap();
const eventTypes=new Map(['Variant','Byte','Integer','Long','Single','Double','Currency','Decimal','Date','String','Boolean','Object'].map(type=>[type.toLowerCase(),type]));
const nameOK=n=>typeof n==='string'&&n.length<=255&&/^[A-Za-z][A-Za-z0-9_.]*$/.test(n)&&!['constructor','prototype','caller','callee','arguments'].includes(n.toLowerCase());
export const isAutomationObject=o=>!!o&&objects.has(o);
function state(o){const s=objects.get(o);if(!s||s.closed||s.session.closed)throw new VBError('Automation object has been released',91);return s;}
function member(o,name,mode){const s=state(o),m=s.members.get(String(name).toLowerCase());if(!nameOK(name)||!m||mode&&!m.modes.includes(mode))throw new VBError('Automation member or invocation mode not supported: '+name,438);return {s,m};}
export function automationDefaultName(o){return state(o).defaultMember;}
export async function automationInvoke(o,name,mode,args=[]){
  const {s,m}=member(o,name,mode);if(args.length>65)throw new VBError('Too many Automation arguments',450);
  const params=(mode===4||mode===8)?[...m.params,{name:'value'}]:m.params;if(args.length>params.length||params.some((p,i)=>!p.optional&&(i>=args.length||args[i]===MISSING)))throw new VBError('Wrong number of Automation arguments',450);
  const refs=[],values=[];for(const [i,arg]of args.entries()){if(arg?.ref instanceof Ref||arg?.ref&&typeof arg.ref.get==='function'&&typeof arg.ref.set==='function'){refs.push([i,arg.ref]);values.push(typeof s.adapter.invokeScalar==='function'?await readScalar(arg.ref):unbox(await arg.ref.get()));}else values.push(typeof s.adapter.invokeScalar==='function'?arg:unbox(arg));}
  const invoke=s.adapter.invokeScalar||s.adapter.invoke;
  let result;s.session.invocations++;
  try{result=await invoke.call(s.adapter,m.name,mode,values,refs.map(([i])=>i));}finally{s.session.invocations--;}
  // An adapter must return an explicit value and optional copyback array.
  if(s.closed||s.session.closed)throw new VBError('Automation session closed during invocation',91);
  if(!result||typeof result!=='object'||!Object.hasOwn(result,'value'))throw new VBError('Invalid Automation adapter response',440);
  if(refs.length){if(!Array.isArray(result.args)||result.args.length!==args.length)throw new VBError('Invalid Automation ByRef response',440);for(const [i,ref]of refs)await ref.set(result.args[i]);}
  if(s.closed||s.session.closed)throw new VBError('Automation session closed during invocation',91);
  return result.value;
}
export function automationMember(o,name,readProperty=false){
  const {m}=member(o,name),mode=m.modes.includes(2)?2:m.modes.includes(1)?1:0;
  if(!mode)throw new VBError('Automation property is write-only',394);
  if(readProperty&&mode===2&&!m.params.length)return automationInvoke(o,m.name,mode,[]);
  const fn=(...args)=>automationInvoke(o,m.name,mode,args);fn.vbScalarInvoke=args=>automationInvoke(o,m.name,mode,args);fn.vbRawArgs=true;fn.vbPreserveMissing=true;fn.vbParams=m.params;
  return {__native:fn,__signature:{params:m.params},receiver:o};
}
export function automationReference(o,name,args=[],objectSet=false){
  member(o,name,objectSet?8:4);return new Ref(()=>automationInvoke(o,name,2,args),v=>automationInvoke(o,name,objectSet?8:4,[...args,v]));
}
export class AutomationRegistry {
  #factories=new Map();#active=new Map();#monikers=new Map();
  #register(map,progId,factory){if(!nameOK(progId)||typeof factory!=='function')throw new TypeError('A valid ProgID and trusted factory are required');const key=progId.toLowerCase();if(map.has(key))throw Error('Automation ProgID already registered');if(map.size>=256)throw RangeError('Automation registration limit');map.set(key,factory);return this;}
  register(progId,factory){return this.#register(this.#factories,progId,factory);}
  registerActive(progId,resolver){return this.#register(this.#active,progId,resolver);}
  /** Exact host-installed capability names. Never interpreted as URLs, files or script monikers. */
  registerMoniker(displayName,resolver,{className=null}={}){
    if(typeof displayName!=='string'||!displayName.length||displayName.length>4096||displayName.includes('\0')||typeof resolver!=='function'||className!==null&&!nameOK(className))throw TypeError('An exact moniker and trusted resolver are required');
    if(this.#monikers.has(displayName)||this.#monikers.size>=256)throw RangeError('Duplicate or excessive moniker registration');
    this.#monikers.set(displayName,Object.freeze({resolver,className:className?.toLowerCase()||null}));return this;
  }
  createSession(){return new AutomationSession(new Map(this.#factories),new Map(this.#active),new Map(this.#monikers));}
}
class AutomationSession {
  constructor(factories,active,monikers){this.factories=factories;this.active=active;this.monikers=monikers;this.adapters=new Map();this.closed=false;this.pending=new Set();this.invocations=0;}
  has(name){return !this.closed&&this.factories.has(String(name).toLowerCase());}
  #resolve(factory){
    if(this.closed)return Promise.reject(new VBError('Automation session closed',91));
    if(!factory)return Promise.reject(new VBError('Automation class or object binding not registered',429));
    // Track acquisition AND orphan cleanup: close must not finish while a late factory still owns an object.
    const task=Promise.resolve().then(async()=>{if(this.closed)throw new VBError('Automation session closed',91);let adapter;try{adapter=await factory(this);return this.adopt(adapter);}catch(error){if(adapter&&!this.adapters.has(adapter))try{await adapter.release?.();}catch{}throw error;}});
    this.pending.add(task);task.then(()=>this.pending.delete(task),()=>this.pending.delete(task));return task;
  }
  create(name){return this.#resolve(this.factories.get(String(name).toLowerCase()));}
  getObject(path=MISSING,className=MISSING){
    if(this.closed)return Promise.reject(new VBError('Automation session closed',91));
    if(path!==MISSING&&(typeof path!=='string'||path.length>4096||path.includes('\0'))||className!==MISSING&&!nameOK(className))return Promise.reject(new VBError('Invalid GetObject arguments',5));
    const name=className===MISSING?null:className.toLowerCase();
    if(path===MISSING)return this.#resolve(name?this.active.get(name):null);
    if(path==='')return this.#resolve(name?this.factories.get(name):null);
    const binding=this.monikers.get(path);
    return this.#resolve(binding&&(!name||binding.className===name)?binding.resolver:null);
  }
  adopt(adapter){
    if(this.closed)throw new VBError('Automation session closed',91);if(this.adapters.has(adapter))return this.adapters.get(adapter);
    if(!adapter||typeof adapter.invoke!=='function'||typeof adapter.release!=='function'||!Array.isArray(adapter.metadata?.members)||adapter.metadata.members.length>1024||this.adapters.size>=128)throw new VBError('Invalid or excessive Automation adapter',440);
    const members=new Map();for(const m of adapter.metadata.members){if(!nameOK(m.name)||members.has(m.name.toLowerCase())||!Array.isArray(m.modes)||!m.modes.length||m.modes.some(v=>![1,2,4,8].includes(v))||!Array.isArray(m.params)||m.params.length>64||m.params.some(p=>!nameOK(p.name)))throw new VBError('Invalid Automation member metadata',440);members.set(m.name.toLowerCase(),{name:m.name,modes:[...m.modes],params:m.params.map(p=>({name:p.name,byRef:!!p.byRef,optional:!!p.optional,type:'Variant'}))});}
    const defaultMember=adapter.metadata.defaultMember||null;if(defaultMember&&!members.has(String(defaultMember).toLowerCase()))throw new VBError('Invalid Automation default member',440);
    const events=new Map(),definitions=adapter.metadata.events||[];
    if(!Array.isArray(definitions)||definitions.length>256)throw new VBError('Invalid Automation event metadata',440);
    for(const e of definitions){
      if(!nameOK(e.name)||events.has(e.name.toLowerCase())||!Array.isArray(e.params)||e.params.length>64||e.params.some(p=>!nameOK(p.name)))throw new VBError('Invalid Automation event metadata',440);
      const names=new Set(),params=e.params.map(p=>{
        const type=eventTypes.get(String(p.type??'Variant').toLowerCase());
        if(!type||names.has(p.name.toLowerCase()))throw new VBError('Invalid Automation event parameter metadata',440);
        names.add(p.name.toLowerCase());return {name:p.name,byRef:!!p.byRef,type};
      });
      events.set(e.name.toLowerCase(),{name:e.name,params});
    }
    const object=Object.freeze(Object.create(null)),s={session:this,adapter,members,defaultMember,events,sinks:new Set(),closed:false,unsubscribe:null,eventDepth:0};
    objects.set(object,s);this.adapters.set(adapter,object);
    try{
      if(events.size&&typeof adapter.subscribe==='function'){
        s.unsubscribe=adapter.subscribe((name,args,context={})=>deliverAutomationEvent(object,name,args,context));
        if(typeof s.unsubscribe!=='function')throw new VBError('Automation subscription must return a synchronous unsubscribe function',440);
      }
    }catch(error){s.closed=true;this.adapters.delete(adapter);objects.delete(object);throw error;}
    return object;
  }
  async close(){if(this.closePromise)return this.closePromise;this.closed=true;return this.closePromise=(async()=>{await Promise.allSettled([...this.pending]);const results=await Promise.allSettled([...this.adapters].map(async([a,o])=>{const s=objects.get(o);s.closed=true;s.sinks.clear();try{await s.unsubscribe?.();}finally{await a.release();}}));this.adapters.clear();return results;})();}
}

/** Bounded enumeration snapshot, not an unrestricted native iterator lifetime. */
export async function automationEnumerate(o){const s=state(o);if(typeof s.adapter.enumerate!=='function')throw new VBError('Automation object does not expose enumeration',451);const values=await (s.adapter.enumerateScalar||s.adapter.enumerate).call(s.adapter);state(o);if(!Array.isArray(values)||values.length>10000)throw new VBError('Invalid Automation enumeration',7);return values;}

/** Subscribe through explicit event metadata, never through properties/prototypes. */
export function automationSubscribe(object,sink){
  const s=state(object);if(typeof sink!=='function')throw new TypeError('An Automation event sink is required');
  if(s.sinks.size>=256)throw new VBError('Automation event sink limit exceeded',7);
  const subscription={sink};s.sinks.add(subscription);let active=true;
  return ()=>{if(active){active=false;s.sinks.delete(subscription);}};
}
async function deliverAutomationEvent(object,name,values,context){
  const s=state(object),event=s.events.get(String(name).toLowerCase());
  if(!event||!Array.isArray(values)||values.length!==event.params.length)throw new VBError('Invalid Automation event payload',440);
  if(s.eventDepth>=32)throw new VBError('Automation event recursion limit exceeded',28);
  const args=values.map((value,i)=>event.params[i].byRef?{ref:new Cell(event.params[i].type,value)}:value);
  s.eventDepth++;
  try{
    for(const connection of [...s.sinks]){
      if(s.closed||s.session.closed)throw new VBError('Automation session closed during event',91);
      if(s.sinks.has(connection))await connection.sink(event.name,args.map((a,i)=>event.params[i].byRef?a:values[i]),{reentrant:context.reentrant===true&&s.session.invocations>0});
    }
    state(object);
    return {args:await Promise.all(args.map((a,i)=>event.params[i].byRef?(typeof s.adapter.invokeScalar==='function'?readScalar(a.ref):a.ref.get()):values[i]))};
  }finally{s.eventDepth--;}
}
