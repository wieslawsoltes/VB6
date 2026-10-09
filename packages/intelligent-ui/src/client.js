import {UIError, boundedData} from './safety.js';
import {UIRuntime} from './runtime.js';

let liveWorkers=0;
/** Runs the same bounded interpreter in a Worker when supplied, otherwise locally. */
export class UIClient {
  constructor({workerSource='',window=globalThis,timeout=3000,snapshot,catalog}={}){
    this.catalog=catalog?boundedData(catalog):undefined;this.nextId=0;this.pending=new Map();this.timeout=timeout;this.disposed=false;this.lastSnapshot=snapshot||{state:{}};this.backend='bounded-main';
    if(workerSource&&window.Worker&&liveWorkers<8){
      let url;try{url=window.URL.createObjectURL(new window.Blob([workerSource],{type:'text/javascript'}));this.worker=new window.Worker(url);liveWorkers++;this.backend='worker';this.worker.onmessage=e=>this.receive(e.data);this.worker.onerror=()=>this.fail(new UIError('worker','UI worker failed; restart the view to retry.'));this.worker.onmessageerror=()=>this.fail(new UIError('worker','Invalid worker message.'));}catch{this.worker=null;}finally{if(url)window.URL.revokeObjectURL(url);}
    }
    if(!this.worker){this.runtime=new UIRuntime({catalog:this.catalog});if(snapshot)this.runtime.restore(snapshot);}
  }
  receive(message){const pending=this.pending.get(message?.id);if(!pending)return;this.pending.delete(message.id);clearTimeout(pending.timer);if(message.error)pending.reject(new UIError(message.error.code||'worker',message.error.message));else {this.lastSnapshot=message.snapshot;pending.resolve(message.result);}}
  request(method,payload={}){
    if(this.disposed)return Promise.reject(new UIError('disposed','UI client is disposed.'));
    if(this.failure)return Promise.reject(this.failure);
    if(!this.worker){try{let result;if(method==='update')result=this.runtime.update(payload.source,payload.options);else if(method==='apply')result=this.runtime.apply(payload.document,payload.options);else if(method==='patch')result=this.runtime.patch(payload.patch,payload.version);else if(method==='resize')result=this.runtime.resize(payload.viewport,payload.version);else if(method==='event')result=this.runtime.dispatch(payload.id,payload.args,payload.version);else throw new UIError('method','Unknown UI request.');this.lastSnapshot=this.runtime.snapshot();return Promise.resolve(result);}catch(error){return Promise.reject(error);}}
    if(this.pending.size>=32)return Promise.reject(new UIError('queue','UI request queue is full.'));
    const id=++this.nextId;return new Promise((resolve,reject)=>{const timer=setTimeout(()=>this.fail(new UIError('watchdog','UI worker exceeded its watchdog; last rendered view was retained.')),this.timeout);this.pending.set(id,{resolve,reject,timer});try{this.worker.postMessage({id,method,payload,...(id===1?{snapshot:this.lastSnapshot,catalog:this.catalog}:{})});}catch(error){clearTimeout(timer);this.pending.delete(id);reject(error);}});
  }
  fail(error){this.failure=error;if(this.worker){this.worker.terminate();this.worker=null;liveWorkers--;}for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(error);}this.pending.clear();}
  snapshot(){return boundedData(this.lastSnapshot);}
  dispose(){if(this.disposed)return;this.disposed=true;this.fail(new UIError('disposed','UI client is disposed.'));this.runtime?.dispose();}
}
export function startUIWorker(scope){
  let runtime,initialized=false;
  scope.addEventListener('message',event=>{
    const message=event.data;if(!Number.isSafeInteger(message?.id)||message.id<1)return;
    try{if(!initialized){runtime=new UIRuntime({catalog:message.catalog});if(message.snapshot)runtime.restore(message.snapshot);initialized=true;}let result;
      if(message.method==='update')result=runtime.update(message.payload.source,message.payload.options);
      else if(message.method==='apply')result=runtime.apply(message.payload.document,message.payload.options);
      else if(message.method==='patch')result=runtime.patch(message.payload.patch,message.payload.version);
      else if(message.method==='resize')result=runtime.resize(message.payload.viewport,message.payload.version);
      else if(message.method==='event')result=runtime.dispatch(message.payload.id,message.payload.args,message.payload.version);
      else throw new UIError('method','Unknown UI worker method.');
      scope.postMessage({id:message.id,result,snapshot:runtime.snapshot()});
    }catch(error){scope.postMessage({id:message.id,error:{code:error.code||'runtime',message:String(error.message||error).slice(0,1000)}});}
  });
}
