import {normalizeViewport} from './viewport.js';
import {UIError, boundedData, safeUrl} from './safety.js';
import {createReferenceFactories} from './reference-renderer.js';
import {DOMRenderer} from './renderer.js';
import {UIClient} from './client.js';

export function normalizeAction(action){
  const clean=boundedData(action,32000);if(!Array.isArray(clean.args))throw new UIError('action','Invalid UI action arguments.');
  const first=clean.args[0];
  if(['message','copy','link','entity'].includes(clean.type)){if(typeof first!=='string'||!first.trim()||first.length>16000)throw new UIError('action','Action text must contain 1–16,000 characters.');if(clean.type==='link')clean.args[0]=safeUrl(first);}
  else if(clean.type==='tool'){if(typeof first!=='string'||!/^[A-Za-z0-9_.-]{1,128}$/.test(first)||!clean.args[1]||typeof clean.args[1]!=='object'||Array.isArray(clean.args[1]))throw new UIError('action','A tool action needs an exact name and argument object.');}
  else if(clean.type!=='context')throw new UIError('action','Unsupported UI action.');
  return clean;
}
export class UISurface {
  constructor(root,{workerSource='',onAction=()=>{throw new UIError('action_denied','The host has not enabled this action.');},onUpdate=()=>{},snapshot,catalog,responsive=true,factories={},allowResource,resolveReference,approveResource,subscribeReferences}={}){
    this.root=root;this.doc=root.ownerDocument;this.options={workerSource,onAction,onUpdate,catalog,factories,allowResource,resolveReference,approveResource,subscribeReferences};this.client=new UIClient({workerSource,window:this.doc.defaultView,snapshot,catalog});this.version=0;this.generation=0;this.eventQueue=Promise.resolve();this.referenceListeners=new Set();
    const make=(tag,cls,text)=>{const n=this.doc.createElement(tag);n.className=cls;if(text)n.textContent=text;return n;};
    this.toolbar=make('div','iui-surface-toolbar');this.status=make('span','iui-status');this.status.setAttribute('role','status');this.sourceButton=make('button','','Source');this.sourceButton.type='button';this.sourceButton.onclick=()=>{this.source.hidden=!this.source.hidden;this.sourceButton.setAttribute('aria-expanded',String(!this.source.hidden));};this.fallbackButton=make('button','','Text fallback');this.fallbackButton.type='button';this.fallbackButton.onclick=()=>{this.fallback.hidden=!this.fallback.hidden;this.fallbackButton.setAttribute('aria-expanded',String(!this.fallback.hidden));};
    this.restartButton=make('button','','Restart view');this.restartButton.type='button';this.restartButton.onclick=()=>this.restart();this.toolbar.append(this.status,this.sourceButton,this.fallbackButton,this.restartButton);
    this.viewport=make('div','iui-viewport');this.source=make('pre','iui-surface-source');this.source.hidden=true;this.source.tabIndex=0;this.source.setAttribute('aria-label','Intelligent UI source');this.fallback=make('pre','iui-fallback');this.fallback.hidden=true;this.fallback.tabIndex=0;this.diagnostics=make('details','iui-diagnostics');this.diagnosticTitle=make('summary','','Diagnostics');this.diagnosticText=make('pre','');this.diagnostics.append(this.diagnosticTitle,this.diagnosticText);this.diagnostics.hidden=true;root.append(this.toolbar,this.viewport,this.source,this.fallback,this.diagnostics);
    this.makeRenderer();
    if(responsive&&this.doc.defaultView.ResizeObserver){
      this.resizeObserver=new this.doc.defaultView.ResizeObserver(entries=>{
        const width=entries[0]?.contentRect.width;
        if(!(width>0))return;
        this.setViewport({width:Math.min(16384,width),height:Math.min(16384,this.doc.defaultView.innerHeight||768)});
      });
      this.resizeObserver.observe(root);
    }
  }
  makeRenderer(){this.renderer=new DOMRenderer(this.viewport,{factories:{...(this.options.resolveReference?createReferenceFactories({resolveReference:this.options.resolveReference,allowResource:this.options.allowResource,approveResource:this.options.approveResource,onAction:(action,context)=>this.action(action,context),subscribe:listener=>{this.referenceListeners.add(listener);const off=this.options.subscribeReferences?.(listener);return()=>{this.referenceListeners.delete(listener);off?.();};}}):{}),...this.options.factories},allowResource:this.options.allowResource,onError:e=>this.error(e),onEvent:(id,args)=>this.event(id,args),onAction:(action,context)=>this.action(action,context)});}
  refreshReferences(){for(const listener of this.referenceListeners)listener({id:null});}
  action(action,context={}){if(this.disposed)throw new UIError('disposed','UI surface is disposed.');context.signal?.throwIfAborted();return this.options.onAction(normalizeAction(action),this,{signal:context.signal});}
  update(source,options={}){
    if(typeof source!=='string')return Promise.reject(new UIError('source','UI source must be a string.'));
    return this.enqueue('update',source,options);
  }
  updateCompiled(document,options={}){
    try{return this.enqueue('apply',boundedData(document),options);}catch(error){return Promise.reject(error);}
  }
  enqueue(method,value,options){
    if(this.disposed)return Promise.reject(new UIError('disposed','UI surface is disposed.'));
    options={...options,viewport:options.viewport??this.viewportSize};
    this.latest={method,value,options};this.source.textContent=method==='update'?value:JSON.stringify(value,null,2);
    if(this.pending){Object.assign(this.pending,{method,value,options});}
    else {const job={method,value,options};job.promise=new Promise((resolve,reject)=>{job.resolve=resolve;job.reject=reject;});this.pending=job;}
    // All superseded partial updates share one completion; no per-chunk waiter growth.
    const promise=this.pending.promise;
    if(!options.partial){clearTimeout(this.timer);this.timer=null;void this.flush();}
    else if(!this.timer&&!this.inflight)this.timer=setTimeout(()=>{this.timer=null;void this.flush();},80);
    return promise;
  }
  setViewport(value){
    if(this.disposed)return;
    const viewport=normalizeViewport(value);
    if(JSON.stringify(viewport)===JSON.stringify(this.viewportSize))return;
    this.viewportSize=viewport;
    if(this.pending)this.pending.options={...this.pending.options,viewport};
    if(this.latest)this.latest.options={...this.latest.options,viewport};
    this.resizePending=true;
    clearTimeout(this.resizeTimer);
    this.resizeTimer=setTimeout(()=>void this.flushResize(),80);
  }
  async flushResize(){
    if(this.disposed||!this.resizePending||this.inflight||this.pending||!this.version)return;
    const client=this.client,viewport=this.viewportSize;this.resizePending=false;
    try{const result=await client.request('resize',{viewport});if(!this.disposed&&client===this.client){this.generation++;this.apply(result);}}
    catch(error){if(client===this.client)this.error(error);}
  }
  async flush(){
    if(this.disposed||this.inflight||!this.pending)return;const job=this.pending;this.pending=null;this.inflight=true;
    try{const client=this.client;const result=await client.request(job.method,job.method==='apply'?{document:job.value,options:job.options}:{source:job.value,options:job.options});if(this.disposed)throw new UIError('disposed','UI surface is disposed.');if(this.client!==client)throw new UIError('stale_event','The UI client was restarted.');this.generation++;this.apply(result);job.resolve(result);}
    catch(error){this.error(error);job.reject(error);}
    finally{this.inflight=false;if(this.pending&&!this.disposed)void this.flush();else void this.flushResize();}
  }
  apply(result){this.renderer.apply(result.operations);this.version=result.version;this.result=result;this.fallback.textContent=result.fallbackMarkdown||this.viewport.textContent;const diagnostics=[...result.diagnostics,...result.recoveryDiagnostics];this.diagnosticTitle.textContent=diagnostics.length+' diagnostics';this.diagnosticText.textContent=diagnostics.map(d=>d.code+': '+d.message).join('\n');this.diagnostics.hidden=!diagnostics.length;this.status.textContent=(this.latest?.options.partial?'Streaming':'Interactive')+' · '+this.client.backend;try{this.options.onUpdate(result,this);}catch{/* Observers do not roll back successful renders. */}}
  event(id,args){const generation=this.generation;const action=this.eventQueue.then(async()=>{if(this.disposed||generation!==this.generation)throw new UIError('stale_event','UI changed before this interaction.');const client=this.client;const result=await client.request('event',{id,args,version:this.version});if(this.disposed||client!==this.client||generation!==this.generation)return;this.apply(result);for(const action of result.actions)await this.action(action);return result;});this.eventQueue=action.catch(error=>this.error(error));return action;}
  error(error){if(!this.disposed)this.status.textContent=error.message+' Last valid UI retained.';}
  snapshot(){return this.client.snapshot();}
  restart(){if(this.disposed)return;this.client.dispose();this.renderer.dispose();this.client=new UIClient({workerSource:this.options.workerSource,window:this.doc.defaultView,catalog:this.options.catalog});this.makeRenderer();this.generation++;this.version=0;if(this.latest)void this.enqueue(this.latest.method,this.latest.value,this.latest.options).catch(e=>this.error(e));}
  dispose(){if(this.disposed)return;this.disposed=true;clearTimeout(this.timer);clearTimeout(this.resizeTimer);this.resizeObserver?.disconnect();this.client.dispose();this.renderer.dispose();this.pending?.reject(new UIError('disposed','UI surface is disposed.'));this.pending=null;this.root.replaceChildren();}
}
