import {UIError,boundedData} from './safety.js';
import {validateReference} from './references.js';

/** Explicit trusted host integrations, not model-selected URLs or ambient network. */
export class UIReferenceProviders {
  constructor({approve=async()=>false,timeout=15000}={}){
    if(!Number.isInteger(timeout)||timeout<1||timeout>60000)throw new UIError('provider','Invalid provider timeout.');
    this.providers=new Map();this.active=new Map();this.approve=approve;this.timeout=timeout;this.disposed=false;
  }
  register(name,{description='',resolve}={}){
    if(this.disposed||typeof name!=='string'||!/^[a-z][a-z0-9-]{0,63}$/.test(name)||typeof description!=='string'||description.length>500||typeof resolve!=='function')throw new UIError('provider','Invalid trusted reference provider.');
    if(this.providers.has(name)||this.providers.size>=16)throw new UIError('provider','Duplicate provider or provider limit reached.');
    const entry={description,resolve,life:new AbortController()};this.providers.set(name,entry);
    return()=>{if(this.providers.get(name)===entry){entry.life.abort();this.providers.delete(name);}};
  }
  list(){return [...this.providers].map(([name,{description}])=>({name,description}));}
  async resolve(name,query,{owner,signal}={}){
    const provider=this.providers.get(name);
    if(this.disposed||!provider)throw new UIError('provider','Reference provider is not configured.');
    if(typeof owner!=='string'||!owner||owner.length>512||typeof query!=='string'||!query.trim()||query.length>2000)throw new UIError('provider','A trusted owner and bounded query are required.');
    if(this.active.has(owner)||this.active.size>=16)throw new UIError('provider','A reference request is already active or the request limit was reached.');
    const control=new AbortController(),combined=AbortSignal.any([control.signal,provider.life.signal,...(signal?[signal]:[])]);
    combined.throwIfAborted();
    this.active.set(owner,control);let timer,abort;
    const cancelled=new Promise((_,reject)=>{abort=()=>reject(combined.reason||new UIError('cancelled','Reference request cancelled.'));combined.addEventListener('abort',abort,{once:true});if(combined.aborted)abort();});
    timer=setTimeout(()=>control.abort(new UIError('timeout','Reference provider exceeded its timeout.')),this.timeout);
    try{
      combined.throwIfAborted();
      const allowed=await Promise.race([this.approve({provider:name,description:provider.description,query},{owner,signal:combined}),cancelled]);
      combined.throwIfAborted();if(allowed!==true)throw new UIError('denied','Reference request was declined.');
      const value=await Promise.race([provider.resolve(query,{owner,signal:combined}),cancelled]);combined.throwIfAborted();
      if(this.providers.get(name)!==provider)throw new UIError('provider','Provider registration was revoked.');
      const reference=validateReference(boundedData(value,32000));return reference;
    }finally{clearTimeout(timer);combined.removeEventListener('abort',abort);this.active.delete(owner);}
  }
  revoke(owner){this.active.get(owner)?.abort(new UIError('cancelled','Reference owner was revoked.'));}
  cancelAll(){for(const controller of this.active.values())controller.abort(new UIError('cancelled','Reference requests revoked.'));}
  dispose(){this.disposed=true;this.cancelAll();for(const p of this.providers.values())p.life.abort();this.providers.clear();}
}
