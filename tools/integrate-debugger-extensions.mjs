// One-time reviewed source integration. Refuse concurrent source drift.
import fs from "node:fs";
const changes = [
  {path: "src/runtime/vm.js", edits: [
    [String.raw`.js';
import {planLiveEdit,nextStatementIndex} from './live-edit.js';
import {encodeVariable,decodeVariable,makeRecord} from './binary-codec`, String.raw`.js';
import {planLiveEdit,nextStatementIndex} from './live-edit.js';
import {planVersionedEdit} from './versioned-edit.js';
import {encodeVariable,decodeVariable,makeRecord} from './binary-codec`],
    [String.raw`s.stop();throw error;}})();
    return this.immediatePreparation;
  }
  async initialize() {
    if(!this.program.valid)throw new VBError(th`, String.raw`s.stop();throw error;}})();
    return this.immediatePreparation;
  }
  /** Enable event-driven design execution only after an explicit debugger action.
   * Preparing the session still never executes project startup. */
  configureImmediateEvents(enabled){
    if(typeof enabled!=='boolean'||!this.immediateContext||!this.options.debuggerEnabled)throw new VBError('A prepared design-mode debugger session is required',5);
    if(this.debugEvaluation||this.stack.length||!['idle','running'].includes(this.state))throw new VBError('Finish the current handler or Reset before changing Immediate event delivery',5);
    this.immediateEvents=enabled;
    if(!enabled){for(const event of this.eventQueue)event.resolve?.();this.eventQueue=[];}
    this.setState(enabled?'running':'idle');
    if(enabled)queueMicrotask(()=>this.processEvents());
    return {enabled,state:this.state,startupExecuted:false};
  }
  async initialize() {
    if(!this.program.valid)throw new VBError(th`],
    [String.raw`t does not support this property or method',438);if(!instance.loaded){instance.loaded=true;await instance.formObject.initializeDataBindings?`, String.raw`t does not support this property or method',438);if(!instance.loaded){if(this.immediateContext&&this.immediateEvents&&!instance.designInitialized){instance.designInitialized=true;const init=this.formProcedure(instance,'initialize');if(init)await this.callProcedure(instance,init,[]);}instance.loaded=true;await instance.formObject.initializeDataBindings?`],
    [String.raw`state==='stopped')throw new StopExecution();}
  }
  applyEdits(project){
    if(this.debugEvaluation)throw new VBError('Finish or cancel debugg`, String.raw`state==='stopped')throw new StopExecution();}
  }
  applyEdits(project,{policy='strict'}={}){
    if(!['strict','versioned'].includes(policy))throw new VBError('Invalid live-edit policy',5);
    if(this.debugEvaluation)throw new VBError('Finish or cancel debugg`],
    [String.raw`pplying code changes',5);
    const next=compileProject(project),plan=planLiveEdit(this.program,next,this.stack),invalidated=[];
    // Proc`, String.raw`pplying code changes',5);
    const next=compileProject(project),plan=policy==='versioned'?planVersionedEdit(this.program,next,this.stack,this.codeRevision||0):planLiveEdit(this.program,next,this.stack),invalidated=[];
    // Proc`],
    [String.raw`st {frame,...update}of plan.frameUpdates)Object.assign(frame,update);
    for(const frame of this.stack.slice(0,-1)){frame.activePc=frame.pc`, String.raw`st {frame,...update}of plan.frameUpdates)Object.assign(frame,update);
    for(const {module,name}of plan.removedProcedures||[])module.procedures.delete(name);
    for(const frame of this.stack.slice(0,-1)){frame.activePc=frame.pc`],
    [String.raw`validatedBreakpoints:invalidated,updatedProcedures:plan.updates.length};
    this.emit('codeChanged',result);return result;
  }
  setNextSta`, String.raw`validatedBreakpoints:invalidated,updatedProcedures:plan.updates.length,retainedFrames:plan.retainedFrames||[]};
    this.emit('codeChanged',result);return result;
  }
  setNextSta`],
    [String.raw` new VBError('Set Next Statement is available only in break mode',5);
    if(lower(module)!==lower(frame.module.name))throw new VBError('The`, String.raw` new VBError('Set Next Statement is available only in break mode',5);
    if(frame.pinnedSource!==undefined)throw new VBError('This invocation is executing a retained source revision; step it or let it return before redirecting from edited source',5);
    if(lower(module)!==lower(frame.module.name))throw new VBError('The`],
    [String.raw`esce=false}={}){
    if(this.state==='stopped'||this.state==='error'||this.immediateContext)return Promise.resolve();const instance=typeof module==='string'?this`, String.raw`esce=false}={}){
    if(this.state==='stopped'||this.state==='error'||(this.immediateContext&&!this.immediateEvents))return Promise.resolve();const instance=typeof module==='string'?this`],
    [String.raw`sing||this.stack.length||this.state==='paused'||this.debugEvaluation||this.immediateContext)return;this.processing=true;try{while(this.eventQueue.length&&this.st`, String.raw`sing||this.stack.length||this.state==='paused'||this.debugEvaluation||(this.immediateContext&&!this.immediateEvents))return;this.processing=true;try{while(this.eventQueue.length&&this.st`],
  ]},
  {path: "src/runtime/host.js", edits: [
    [String.raw`;
      case 'watchpoints':vm.setWatchpoints(data.watches||[]);break;
      case 'applyEdits':{const result=vm.applyEdits(data.project);this.project=clone(data.project);this.send('commandResult',{id:data.`, String.raw`;
      case 'watchpoints':vm.setWatchpoints(data.watches||[]);break;
      case 'immediateEvents':{const result=vm.configureImmediateEvents(data.enabled);this.send('commandResult',{id:data.id,ok:true,result});break;}
      case 'applyEdits':{const result=vm.applyEdits(data.project,{policy:data.policy||'strict'});this.project=clone(data.project);this.send('commandResult',{id:data.`],
  ]},
  {path: "src/runtime/debug-control.js", edits: [
    [String.raw`e:ins.line,column:ins.column,endColumn:ins.endColumn,depth:frame.depth};});}
  async suspend(instruction,frame,reason,details={}){
    const`, String.raw`e:ins.line,column:ins.column,endColumn:ins.endColumn,depth:frame.depth,...(frame.pinnedSource===undefined?{}:{sourceText:frame.pinnedSource,revision:frame.pinnedRevision,retained:true})};});}
  async suspend(instruction,frame,reason,details={}){
    const`],
    [String.raw`anged=frame.lastLine!==ins.line||frame.pc<=frame.lastPc;
    const bp=vm.breakpoints.get(lower(ins.source)+':'+ins.line);
    let reason=null,details={};
    if(visible&&lineChanged&&bp&&bp.`, String.raw`anged=frame.lastLine!==ins.line||frame.pc<=frame.lastPc;
    const bp=frame.pinnedSource===undefined?vm.breakpoints.get(lower(ins.source)+':'+ins.line):null;
    let reason=null,details={};
    if(visible&&lineChanged&&bp&&bp.`],
    [String.raw`out'&&frame.depth<vm.stepMode.depth))reason ||= 'step';
    if(visible&&vm.runTarget&&lower(ins.source)===lower(vm.runTarget.module)&&ins.li`, String.raw`out'&&frame.depth<vm.stepMode.depth))reason ||= 'step';
    if(visible&&frame.pinnedSource===undefined&&vm.runTarget&&lower(ins.source)===lower(vm.runTarget.module)&&ins.li`],
  ]},
  {path: "src/ide/debug-windows.js", edits: [
    [String.raw`import {DesignImmediateSession} from './design-immediate.js';
import {`, String.raw`import {installNativeDebugger} from './native-debugger.js';
import {DesignImmediateSession} from './design-immediate.js';
import {`],
    [String.raw`rs','Errors'],['output','Output'],['evaluation','Evaluate Expression']];
/** Fixed-height, keyboard-operable storage tree. Expansion is expl`, String.raw`rs','Errors'],['output','Output'],['evaluation','Evaluate Expression'],['executingSource','Executing Source']];
/** Fixed-height, keyboard-operable storage tree. Expansion is expl`],
    [String.raw`ocals();this.buildWatches();this.buildStack();this.buildEvaluation();
 }
 current(){return this.views.get(WINDOWS.find(([,title])=>title===this`, String.raw`ocals();this.buildWatches();this.buildStack();this.buildEvaluation();
  this.retainedText=el('textarea',{readOnly:true,spellcheck:false,'aria-label':'Retained executing source',style:{flex:1,resize:'none',whiteSpace:'pre',font:'13px monospace',background:'var(--vb-window)',color:'var(--vb-window-text)'}});this.retainedCaption=el('div',{class:'debug-context-bar'});this.views.get('executingSource').body.append(this.retainedCaption,this.retainedText);
 }
 showRetained(frame){if(!frame?.retained)return;this.retainedCaption.textContent=frame.module+'.'+frame.procedure+' — revision '+frame.revision+' retained until this invocation returns; future calls use the edited code.';this.retainedText.value=frame.sourceText;this.show('executingSource');const lines=frame.sourceText.split(String.fromCharCode(10)),start=lines.slice(0,Math.max(0,frame.line-1)).reduce((n,s)=>n+s.length+1,0);this.retainedText.setSelectionRange(start,start+(lines[frame.line-1]?.length||0));this.retainedText.scrollTop=Math.max(0,(frame.line-4)*16);for(const editor of this.ide.documents.editors.values())editor.setExecution(null);}
 current(){return this.views.get(WINDOWS.find(([,title])=>title===this`],
    [String.raw`;for(const view of this.views.values()){
    if(view.id==='evaluation')continue;
    if(view.id==='locals'){const rows=ide.runState==='pause`, String.raw`;for(const view of this.views.values()){
    if(view.id==='evaluation'||view.id==='executingSource')continue;
    if(view.id==='locals'){const rows=ide.runState==='pause`],
    [String.raw`ack[index],module=frame&&findModule(this.ide.project,frame.module);if(module)this.ide.openDocument(module.id,'code',frame.line);this.renderS`, String.raw`ack[index],module=frame&&findModule(this.ide.project,frame.module);if(frame?.retained)this.showRetained(frame);else if(module)this.ide.openDocument(module.id,'code',frame.line);this.renderS`],
    [String.raw`',{},frame.module+'.'+frame.procedure),el('span',{},'Line '+frame.line));row.addEventListener('dblclick',()=>this.selectFrame(index));row.ad`, String.raw`',{},frame.module+'.'+frame.procedure),el('span',{},'Line '+frame.line+(frame.retained?' (revision '+frame.revision+')':'')));row.addEventListener('dblclick',()=>this.selectFrame(index));row.ad`],
    [String.raw`d(ide),restore=ide.restoreLayout.bind(ide),key=ide.keydown.bind(ide);
  const designImmediate=ide.designImmediate=new DesignImmediateSession(ide);
  for(const method of ['run','stop','markDirty']){const original=ide[method].bind(ide);ide[method]=(...args)=>{designImmediate.reset();return original(...args);};}
  ide.executeImme`, String.raw`d(ide),restore=ide.restoreLayout.bind(ide),key=ide.keydown.bind(ide);
  const request=ide.requestRuntime.bind(ide);ide.requestRuntime=(name,values={})=>request(name,name==='applyEdits'?{policy:'versioned',...values}:values);
  const designImmediate=ide.designImmediate=new DesignImmediateSession(ide);
  for(const method of ['run','stop','markDirty']){const original=ide[method].bind(ide);ide[method]=(...args)=>{if(method==='stop'&&designImmediate.promoted){designImmediate.reset();return original(false);}if(!designImmediate.promoted)designImmediate.reset();return original(...args);};}
  ide.executeImme`],
    [String.raw`refreshSerial++;message(event);if(valid){if(data.type==='pause'&&data.error)workbench.showRuntimeError(data);if(data.type==='state'&&data.st`, String.raw`refreshSerial++;message(event);if(valid){if(data.type==='pause'&&data.stack?.at(-1)?.retained)workbench.showRetained(data.stack.at(-1));if(data.type==='pause'&&data.error)workbench.showRuntimeError(data);if(data.type==='state'&&data.st`],
    [String.raw`))workbench.schedule();}};
  ide.command=async(id,...args)=>{if(id==='evaluateExpression')return workbench.showEvaluation();if(id==='cancelE`, String.raw`))workbench.schedule();}};
  ide.command=async(id,...args)=>{if(id==='immediateEvents'){try{return await designImmediate.enableEvents();}catch(error){return alertDialog(error.message,'Immediate Events');}}if(id==='evaluateExpression')return workbench.showEvaluation();if(id==='cancelE`],
    [String.raw`addWatch')return workbench.watchDialog();if(id==='showNextStatement'){const execution=workbench.execution,module=execution&&findModule(ide.p`, String.raw`addWatch')return workbench.watchDialog();if(id==='showNextStatement'){const retained=ide.stack?.at(-1);if(retained?.retained)return workbench.showRetained(retained);const execution=workbench.execution,module=execution&&findModule(ide.p`],
    [String.raw`name=>{const items=menu(name);if(name==='Debug')items.splice(3,0,{id:'evaluateExpression',label:'Evaluate Expression…',enabled:ide.runState=`, String.raw`name=>{const items=menu(name);if(name==='Debug')items.splice(3,0,{id:'immediateEvents',label:'Enable Events in Immediate Session',enabled:ide.runState==='design'},{id:'evaluateExpression',label:'Evaluate Expression…',enabled:ide.runState=`],
    [String.raw`nch.frameIndex=null;workbench.refreshSerial++;workbench.schedule();});return workbench;
}
`, String.raw`nch.frameIndex=null;workbench.refreshSerial++;workbench.schedule();});installNativeDebugger(ide);return workbench;
}
`],
  ]},
  {path: "packages/native-debugger/src/cdb-session.mjs", edits: [
    [String.raw`      await this.waitPaused();
      const processes =`, String.raw`      await this.waitPaused();
      if (debugChildren) await this.command('.childdbg 1');
      const processes =`],
  ]},
];
const updates=[];
for(const {path,edits} of changes){
  let source=fs.readFileSync(path,'utf8');
  for(const [before,after] of edits){
    if(source.split(before).length!==2)throw new Error('Source changed or edit is ambiguous: '+path+' '+before.slice(0,60));
    source=source.replace(before,()=>after);
  }
  updates.push([path,source]);
}
for(const [path,source] of updates)fs.writeFileSync(path,source);
console.log('Applied '+updates.length+' independently reviewed source integrations');
