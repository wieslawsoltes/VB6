/** Debounced document-diagnostic pulling for servers that do not push markers.
 * LSP 3.17 full/unchanged reports and related documents use captured document
 * identities and versions. Cancellation never erases a newer result. */
export class PullDiagnostics {
  constructor(client,{delay=200,maxConcurrent=2,onError=()=>{}}={}) {
    this.client=client;this.delay=delay;this.maxConcurrent=Math.max(1,maxConcurrent);this.onError=onError;
    this.states=new Map();this.queue=new Set();this.running=0;this.disposed=false;
    this.listeners=[
      client.on('document',event=>{
        if(event.kind==='close'){this.remove(event.uri);this.invalidateDependents();return;}
        if(event.kind==='change')this.invalidateDependents(event.uri);
        this.schedule(event.uri);
      }),
      client.on('refresh',name=>{if(name==='diagnostic')this.refresh();}),
      client.on('capabilities',()=>this.refresh(true)),client.on('closed',()=>this.dispose()),
    ];
    this.refresh();
  }
  supported(uri) {
    const document=this.client.documents.get(uri);
    return this.client.state==='ready'&&document&&this.client.capability('textDocument/diagnostic',document);
  }
  invalidateDependents(except) {
    for(const [uri]of this.client.documents)if(uri!==except&&this.supported(uri)?.interFileDependencies)this.schedule(uri);
  }
  schedule(uri,delay=this.delay) {
    if(this.disposed||!this.supported(uri))return;
    let state=this.states.get(uri);if(!state)this.states.set(uri,state={generation:0,result:null});
    ++state.generation;clearTimeout(state.timer);state.abort?.abort();this.queue.delete(uri);
    state.timer=setTimeout(()=>{state.timer=null;if(!this.disposed&&this.states.get(uri)===state){this.queue.add(uri);this.drain();}},delay);
  }
  refresh(clearResults=false) {
    if(this.disposed)return;
    for(const [uri,state]of this.states){
      if(clearResults)state.result=null;
      if(!this.supported(uri)){this.remove(uri);this.client.emit('diagnostics',{uri,diagnostics:[]});}
    }
    for(const [uri]of this.client.documents)this.schedule(uri);
  }
  remove(uri) {
    const state=this.states.get(uri);if(!state)return;clearTimeout(state.timer);state.abort?.abort();++state.generation;
    this.states.delete(uri);this.queue.delete(uri);
  }
  drain() {
    while(!this.disposed&&this.running<this.maxConcurrent&&this.queue.size){
      const uri=this.queue.values().next().value;this.queue.delete(uri);
      const state=this.states.get(uri),document=this.client.documents.get(uri),capability=this.supported(uri);
      if(!state||!document||!capability)continue;
      const generation=state.generation,version=document.version,abort=new AbortController();state.abort=abort;++this.running;
      // Related reports do not carry versions; only a captured workspace can
      // establish which snapshots those ranges refer to.
      const snapshots=new Map([...this.client.documents].map(([key,doc])=>[key,{document:doc,version:doc.version}]));
      const current=()=>!this.disposed&&!abort.signal.aborted&&this.states.get(uri)===state&&generation===state.generation&&this.client.documents.get(uri)===document&&document.version===version;
      this.client.request('textDocument/diagnostic',{textDocument:{uri},...(capability.identifier?{identifier:capability.identifier}:{}),...(state.result?.resultId?{previousResultId:state.result.resultId}:{})},{signal:abort.signal}).then(report=>{
        if(!current())return;
        if(capability.interFileDependencies&&[...snapshots].some(([key,s])=>this.client.documents.get(key)!==s.document||s.document.version!==s.version))return;
        this.accept(uri,report,version);
        for(const [relatedUri,related]of Object.entries(report.relatedDocuments||{})){
          const captured=snapshots.get(relatedUri),live=this.client.documents.get(relatedUri);
          if(!captured||captured.document!==live||live.version!==captured.version||relatedUri===uri)continue;
          // Do not overwrite a newer in-flight document generation.
          const relatedState=this.states.get(relatedUri);
          if(relatedState?.abort&&!relatedState.abort.signal.aborted)continue;
          this.accept(relatedUri,related,captured.version);
        }
      }).catch(error=>{
        if(current()&&![-32800,-32801,-32802].includes(error.code))this.onError(error);
      }).finally(()=>{
        if(state.abort===abort)state.abort=null;--this.running;this.drain();
      });
    }
  }
  accept(uri,report,version) {
    if(!report||!['full','unchanged'].includes(report.kind))throw new Error('The language server returned an invalid diagnostic report.');
    let state=this.states.get(uri);if(!state)this.states.set(uri,state={generation:0,result:null});
    if(report.kind==='full'){
      if(!Array.isArray(report.items))throw new Error('A full diagnostic report must include items.');
      state.result={resultId:report.resultId,items:report.items};
    }else{
      if(!state.result||typeof report.resultId!=='string')throw new Error('An unchanged diagnostic report has no corresponding previous result.');
      state.result={...state.result,resultId:report.resultId};
    }
    this.client.emit('diagnostics',{uri,version,diagnostics:state.result.items});
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;for(const uri of [...this.states.keys()])this.remove(uri);
    for(const unlisten of this.listeners)unlisten();this.listeners=[];
  }
}
