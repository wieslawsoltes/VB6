import {ProjectDiagnosticCache,diagnosticSnapshot} from '../language/diagnostics.js';
import {DIAGNOSTICS_WORKER_SOURCE} from './diagnostics-payload.js';

// One immutable URL per owner document. Revoking immediately after terminate()
// can race WebKit's asynchronous worker-script fetch during project replacement
// or reload. The document owns this bounded allocation and the browser releases
// it on document destruction; cancellation must not invalidate another worker.
let diagnosticWorkerSourceURL;
export function createDiagnosticWorker() {
  if(typeof Worker!=='function'||typeof URL?.createObjectURL!=='function')return null;
  diagnosticWorkerSourceURL ||= URL.createObjectURL(new Blob([DIAGNOSTICS_WORKER_SOURCE],{type:'text/javascript'}));
  return new Worker(diagnosticWorkerSourceURL,{name:'VB6 syntax diagnostics'});
}

/** Latest-revision-only scheduler. A worker never executes VB source. If workers
 * are unavailable/blocked, parsing yields between modules on the main thread.
 * New edits supersede old results without racing across projects or run states. */
export class DiagnosticsScheduler {
  constructor({onResult=()=>{},onState=()=>{},workerFactory=createDiagnosticWorker,delay=280,timeout=15000}={}) {
    this.onResult=onResult;this.onState=onState;this.workerFactory=workerFactory;this.delay=delay;this.timeout=timeout;
    this.revision=0;this.target=null;this.busy=null;this.timer=null;this.worker=null;this.workerUnavailable=false;
    this.cache=new ProjectDiagnosticCache();this.mode='idle';this.pending=false;this.disposed=false;this.suspended=false;
    this.metrics={requests:0,responses:0,discarded:0,workerStarts:0,fallbackRuns:0,compiledModules:0,cacheHits:0};
  }
  schedule(project,delay=this.delay) {
    if(this.disposed||this.suspended)return this.revision;
    this.target={revision:++this.revision,project};this.metrics.requests++;
    clearTimeout(this.timer);this.timer=setTimeout(()=>{this.timer=null;this.start();},Math.max(0,delay));this.state();return this.revision;
  }
  state(){this.pending=!!this.target;this.onState({pending:this.pending,mode:this.mode,revision:this.revision});}
  start() {
    if(this.disposed||this.suspended||!this.target||this.busy)return;
    const target=this.target;let snapshot;
    try {snapshot=diagnosticSnapshot(target.project);}
    catch(error){this.busy={revision:target.revision};this.complete(this.busy,{diagnostics:[{severity:'warning',origin:'syntax',source:target.project?.name||'Project',line:1,column:1,message:error.message}],valid:false,stats:{compiledModules:0,cacheHits:0,totalModules:0}});return;}
    const job=this.busy={revision:target.revision,project:snapshot};
    if(!this.worker&&!this.workerUnavailable) {
      try {this.worker=this.workerFactory?.()||null;if(!this.worker)this.workerUnavailable=true;
        else {const worker=this.worker;this.metrics.workerStarts++;
          worker.onmessage=e=>{if(this.worker!==worker||this.disposed||this.suspended)return;
            if(e.data?.type==='diagnostics-result'&&e.data.revision===this.busy?.revision)this.complete(this.busy,e.data.result);else this.metrics.discarded++;};
          worker.onerror=e=>{e.preventDefault?.();this.workerFailed(worker);};worker.onmessageerror=()=>this.workerFailed(worker);}
      } catch {this.workerUnavailable=true;}
    }
    if(this.worker) {
      const worker=this.worker;this.mode='worker';this.watchdog=setTimeout(()=>this.workerFailed(worker),this.timeout);
      try {this.worker.postMessage({type:'diagnostics-check',revision:job.revision,project:snapshot});this.state();return;}
      catch {this.workerFailed();return;}
    }
    this.fallback(job);
  }
  workerFailed(expectedWorker=this.worker) {
    if(!expectedWorker||this.worker!==expectedWorker)return;
    const job=this.busy;this.stopWorker();this.workerUnavailable=true;
    if(job&&!this.disposed&&!this.suspended)this.fallback(job);
  }
  fallback(job) {
    this.mode='fallback';this.metrics.fallbackRuns++;this.state();const steps=this.cache.steps(job.project);
    const tick=()=>{
      if(this.disposed||this.suspended||this.busy!==job)return;
      if(this.target?.revision!==job.revision){this.metrics.discarded++;this.busy=null;if(this.target&&!this.timer)this.start();this.state();return;}
      try {const next=steps.next();if(next.done)this.complete(job,next.value);else this.fallbackTimer=setTimeout(tick,0);}
      catch(error){this.complete(job,{diagnostics:[{severity:'warning',origin:'syntax',source:job.project.name,line:1,column:1,message:'Automatic syntax checking failed: '+error.message}],valid:false,stats:{compiledModules:0,cacheHits:0,totalModules:0}});}
    };
    this.fallbackTimer=setTimeout(tick,0);
  }
  complete(job,result) {
    if(this.disposed||this.suspended||this.busy!==job)return;
    clearTimeout(this.watchdog);this.busy=null;
    if(this.target?.revision===job.revision) {
      this.target=null;this.metrics.responses++;this.metrics.compiledModules+=result.stats?.compiledModules||0;this.metrics.cacheHits+=result.stats?.cacheHits||0;
      this.onResult({...result,revision:job.revision,mode:this.mode});
    } else this.metrics.discarded++;
    if(this.target&&!this.timer)this.start();this.state();
  }
  stopWorker(){clearTimeout(this.watchdog);const worker=this.worker;this.worker=null;
    // Detach identity first: a queued/reentrant failure from this worker cannot
    // terminate its successor or schedule fallback after cancellation.
    try {worker?.terminate();} finally {worker?.releaseSource?.();}}
  suspend(){if(this.disposed||this.suspended)return;this.suspended=true;this.cancel();}
  resume(){if(!this.disposed)this.suspended=false;}
  cancel(){this.revision++;this.target=null;this.busy=null;clearTimeout(this.timer);clearTimeout(this.fallbackTimer);this.timer=null;this.stopWorker();this.state();}
  dispose(){if(this.disposed)return;this.disposed=true;this.cancel();this.cache.clear();}
}
