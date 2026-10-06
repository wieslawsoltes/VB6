import {loadRuntimeDocument} from './runtime-document.js';
import {el} from '../core/core.js';
import {newId} from '../project/model.js';
import {exportApplication} from '../exporter/exporter.js';
import {icon} from '../theme/icons.js';

/** A separate opaque-origin source runtime for design-mode Immediate commands.
 * Never runs project startup, shares grants, or executes source in the IDE DOM.
 * Changes live only in this session; editing, F5, Reset or project load discards it.
 */
export class DesignImmediateSession {
  constructor(ide){this.ide=ide;this.generation=0;this.pending=new Map();this.busy=false;}
  append(text){this.ide.immediateOutput.push(String(text));if(this.ide.immediateOutput.length>2000)this.ide.immediateOutput.shift();this.ide.renderDebug();}
  send(command,values={}){this.frame?.contentWindow?.postMessage({channel:'vb6-ide',token:this.token,command,...values},'*');}
  ensure(snapshot){
    if(this.ready)return this.ready;
    const token=globalThis.crypto?.randomUUID?.()||newId()+newId();
    // Compile/export before installing listeners, so invalid source leaks no UI.
    const html=exportApplication(this.ide.project,{bridgeToken:token,persist:false,immediateContext:true});
    this.token=token;this.snapshot=snapshot;
    this.frame=el('iframe',{title:'Design-mode Immediate runtime',sandbox:'allow-scripts allow-downloads allow-modals',referrerpolicy:'no-referrer'});
    this.window=el('div',{class:'runtime-window minimized design-immediate-window'});
    this.window.append(el('div',{class:'tool-caption'},icon('immediate'),el('strong',{},this.ide.project.name+' — Immediate'),
      el('button',{class:'runtime-caption-button',title:'Minimize Immediate application',onclick:()=>this.window?.classList.toggle('minimized')},icon('minimize',12)),
      el('button',{class:'runtime-caption-button',title:'Reset Immediate session',onclick:()=>this.promoted?this.ide.stop():this.reset()},icon('close',12))),this.frame);
    this.ready=new Promise((resolve,reject)=>{
      this.readyReject=reject;
      this.readyTimer=setTimeout(()=>{reject(new Error('Immediate runtime did not initialize'));this.reset();},10000);
      this.listener=event=>{
        const data=event.data;
        if(event.source!==this.frame?.contentWindow||data?.channel!=='vb6-runtime'||data.token!==this.token)return;
        if(data.type==='ready'){clearTimeout(this.readyTimer);this.readyReject=null;resolve();}
        else if(this.promoted&&data.type!=='commandResult')return;
        else if(data.type==='error'){reject(new Error(data.error?.message||'Immediate runtime failed'));this.reset();}
        else if(data.type==='output')this.append(data.text);
        else if(data.type==='interaction')this.window?.classList.remove('minimized');
        else if(data.type==='stopped')this.reset();
        else if(data.type==='commandResult'){
          const request=this.pending.get(data.id);if(!request)return;
          clearTimeout(request.timer);this.pending.delete(data.id);
          data.ok?request.resolve(data.result):request.reject(new Error(data.error?.message||'Immediate command failed'));
        }
      };
      window.addEventListener('message',this.listener);
    });
    this.ide.root.append(this.window);
    const frame=this.frame,generation=this.generation,ready=this.ready;
    loadRuntimeDocument(this.ide,frame,html,{
      isCurrent:()=>this.frame===frame&&this.generation===generation&&this.token===token,
      onError:error=>{this.readyReject?.(error);this.reset();}
    });
    return ready;
  }
  async execute(text,{module=this.ide.activeModule?.name??null,instructionLimit=100000,timeLimit=5000}={}){
    if(this.ide.runState!=='design')throw new Error('The IDE is no longer in design mode');
    const snapshot=JSON.stringify(this.ide.project);
    if(this.snapshot&&this.snapshot!==snapshot)this.reset();
    if(this.busy)throw new Error('Finish or cancel the current Immediate command first');
    this.busy=true;const generation=this.generation;
    try{
      await this.ensure(snapshot);
      if(generation!==this.generation||this.ide.runState!=='design')throw new Error('Immediate session changed');
      return await new Promise((resolve,reject)=>{
        const id=newId(),timer=setTimeout(()=>{this.pending.delete(id);reject(new Error('Immediate command did not respond'));this.reset();},Math.max(8000,Math.min(60000,Number(timeLimit)||5000)+3000));
        this.pending.set(id,{resolve,reject,timer});
        this.send('designImmediate',{id,text,module,instructionLimit,timeLimit});
      });
    }finally{if(generation===this.generation)this.busy=false;}
  }
  /** Promote the same isolated frame to the normal IDE debugging transport.
   * Source handlers gain the existing F8, Locals, watches and error UI; no IDE
   * capabilities or browser-origin access are granted to the application. */
  async enableEvents(){
    const ide=this.ide;
    if(ide.runState!=='design'||this.busy)throw new Error('Finish the Immediate command before enabling events');
    const snapshot=JSON.stringify(ide.project);
    if(this.snapshot&&this.snapshot!==snapshot)this.reset();
    const generation=this.generation;await this.ensure(snapshot);
    if(generation!==this.generation||ide.runState!=='design')throw new Error('Immediate session changed');
    this.promoted=true;ide.runtimeFrame=this.frame;ide.runtimeWindow=this.window;ide.bridgeToken=this.token;
    ide.pendingEdits=false;ide.runState='running';ide.locals=[];ide.stack=[];ide.watchValues=[];
    ide.documents.readOnly();ide.inspector.setReadOnly(true);ide.renderToolbox();ide.updateTitle();ide.updateCommandState();
    ide.debuggerWindows.sentWatchpoints=null;ide.updateWatches();
    ide.sendRuntime('breakpoints',{breakpoints:ide.breakpoints});
    try{await ide.requestRuntime('immediateEvents',{enabled:true});}
    catch(error){ide.stop(false);throw error;}
    this.window?.classList.remove('minimized');ide.showDebug('Immediate');
    ide.status('Immediate events enabled — no Sub Main or startup form was run. Reset before starting the project normally.');
    ide.emit('run',{project:ide.project,immediateContext:true});
    return {enabled:true};
  }
  cancel(){this.send('cancelEvaluation');}
  reset(){
    this.generation++;this.promoted=false;this.send('stop');this.window?.remove();
    if(this.listener)window.removeEventListener('message',this.listener);
    clearTimeout(this.readyTimer);this.readyReject?.(new Error('Immediate session reset'));
    for(const request of this.pending.values()){clearTimeout(request.timer);request.reject(new Error('Immediate session reset'));}
    this.pending.clear();this.frame=null;this.window=null;this.listener=null;this.token=null;this.ready=null;this.readyReject=null;this.snapshot=null;this.busy=false;
  }
}
