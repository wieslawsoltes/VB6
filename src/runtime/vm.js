import {VBScalar,SCALAR_TYPES,printScalar,unbox,tagScalar,scalarType,storageScalar,readScalar,literalScalar,signedLiteralScalar} from './values.js';
import {RuntimeDebugger,StopExecution,isSequencePoint,statementIndex,immediateStatements} from './debug-control.js';
import {VBWin32Bridge} from './win32.js';
import {isAutomationObject,automationDefaultName,automationMember,automationReference,automationInvoke,automationEnumerate,automationSubscribe} from './automation.js';
import {DataContext} from '../data/context.js';
import {errorDescription} from './error-messages.js';
import {DebugEvaluationSession} from './debug-evaluation.js';
import {hasDataDefault,hasDataMember,dataDefaultType} from '../data/defaults.js';
import {defaultIdentifierType} from '../language/default-types.js';
import {DebugInspector} from './debug-inspector.js';
import {planLiveEdit,nextStatementIndex} from './live-edit.js';
import {planVersionedEdit} from './versioned-edit.js';
import {encodeVariable,decodeVariable,makeRecord} from './binary-codec.js';
import { Signal, lower, VERSION } from '../core/core.js';
import { VBError, splitTop, tokenize } from '../language/lexer.js';
import { parseExpression, parseCall } from '../language/expression.js';
import { compileProject } from '../language/compiler.js';
import { NOTHING, MISSING, objectIdentity, objectSupports, VBErrorValue, LazyCell, Cell, Ref, VBArray, VBCollection, VBDictionary, VBCurrency, VBDecimal, cloneValue, coerce, defaultValue, numeric, truth, vbString, unary, binary, describe } from './values.js';
import { VirtualFileSystem } from './filesystem.js';
import { createLibrary, MemoryRecordset } from './library.js';

const BLOCKED_MEMBERS=new Set(['constructor','__proto__','prototype','caller','callee','arguments','__definegetter__','__definesetter__','__lookupgetter__','__lookupsetter__']);
export class VBInstance {
  constructor(module){this.staticCells=new Map();this.__vbInstance=true;this.__type=module.name;this.module=module;this.fields=new Map();this.formObject=null;this.loaded=false;this.initialized=false;}
}
export class VirtualMachine extends Signal {
  constructor(program,host={},options={}) {
    super();this.program=program.modules instanceof Map?program:compileProject(program);this.host=host;this.options={instructionLimit:5000000,sliceMilliseconds:8,maxCallDepth:256,debuggerEnabled:false,errorTrapping:'unhandled',...options};
    this.fs=host.fs||new VirtualFileSystem();this.settings=host.settings||{};this.instances=new Map();this.formInstances=new Set();this.stack=[];this.library=createLibrary(this);this.state='ready';this.instructionCount=0;this.lastYield=0;this.breakpoints=new Map();this.stepMode=null;this.pauseRequested=false;this.pauseResolver=null;this.currentFrame=null;this.eventQueue=[];this.processing=false;this.staticCells=new Map();this.eventSinks=new WeakMap();this.lastError=null;
    const vm=this;this.lastErrorErl=0;
    this.err={Number:0,Description:'',Source:'',HelpFile:'',HelpContext:0,LastDLLError:0,
      Clear(){this.Number=0;this.Description='';this.Source='';this.HelpFile='';this.HelpContext=0;vm.lastErrorErl=0;},
      Raise(number,source=MISSING,description=MISSING,helpfile=MISSING,helpcontext=MISSING){
        number=coerce(number,'Long');if(!number)throw new VBError('Invalid procedure call or argument',5);
        const error=new VBError(description===MISSING?(this.Description||errorDescription(number)):vbString(description),number,source===MISSING?(this.Source||vm.program.name):vbString(source));
        error.helpFile=helpfile===MISSING?this.HelpFile:vbString(helpfile);
        error.helpContext=helpcontext===MISSING?this.HelpContext:coerce(helpcontext,'Long');
        throw error;
      }
    };
    this.err.Clear.vbParams=[];
    this.err.Raise.vbPreserveMissing=true;
    this.err.Raise.vbParams=[{name:'number'},...['source','description','helpfile','helpcontext'].map(name=>({name,optional:true}))];
    this.library.set('err',this.err);this.library.set('app',{Title:this.program.name,EXEName:this.program.name,Path:'/',Major:Number(VERSION.split('.')[0]),Minor:Number(VERSION.split('.')[1]),Revision:Number(VERSION.split('.')[2]),PrevInstance:0,TaskVisible:-1});
    this.library.set('screen',{TwipsPerPixelX:15,TwipsPerPixelY:15,Width:14400,Height:10800,MousePointer:0,ActiveForm:null});
    this.library.set('forms',{get Count(){return [...vm.formInstances].filter(i=>i.loaded).length;},Item(key){const forms=[...vm.formInstances].filter(i=>i.loaded),item=typeof key==='number'?forms[key]:forms.find(i=>lower(i.module.name)===lower(key));if(!item)throw new VBError('Form not found in Forms collection',9);return item;},[Symbol.iterator](){return [...vm.formInstances].filter(i=>i.loaded).values();}});
    this.library.set('debug',{Print:(...a)=>this.output(a.map(v=>v===null?'Null':v===undefined?'':v instanceof VBErrorValue?v.toString():vbString(v)).join(' '))});
    this.automation=host.automation?.createSession();
    this.data=host.data||new DataContext(this.program.sourceProject,{fs:this.fs,persist:host.persist,fetch:host.dataFetch,credentialProvider:host.dataCredential});this.data.install(this);
    this.debugger=new RuntimeDebugger(this);this.debugger.configure();this.debugInspector=new DebugInspector(this);this.debugPauseId=0;this.watchpoints=[];this.watchpointValues=new Map();this.runTarget=null;
    this.win32=new VBWin32Bridge(this);
    this.library.set('clipboard',{SetText:async text=>{this.clipboard=vbString(text);this.win32.api.setClipboardText(this.clipboard);await this.host.clipboardWrite?.(this.clipboard);},GetText:()=>this.win32.api.getClipboardText(),Clear:()=>{this.clipboard='';this.win32.api.setClipboardText(null);}});
  }
  output(text,newline=true){this.emit('output',{text:String(text),newline});this.host.print?.(String(text),newline);}
  setState(state){this.state=state;if(['paused','stopped','error'].includes(state)){this.inputEpoch=(this.inputEpoch||0)+1;const pending=this.eventQueue.filter(e=>e.input);this.eventQueue=this.eventQueue.filter(e=>!e.input);for(const event of pending)event.resolve();}this.emit('state',state);}
  breakpointLocation(module,line,column=null){
    const source=this.program.modules.get(lower(module));
    if(!Number.isInteger(line)||line<1||!source)throw new VBError('The selected line is not executable',5);
    const proc=[...source.procedures.values()].find(p=>statementIndex(p.code,line,column)>=0);
    if(!proc)throw new VBError('The selected line is not executable: comments and declarations cannot have breakpoints',5);
    return {module:source.name,line,...(column===null?{}:{column:proc.code[statementIndex(proc.code,line,column)].column})};
  }
  setBreakpoint(module,line,condition='',enabled=true){
    const location=this.breakpointLocation(module,line);condition=String(condition);
    if(condition.length>4096)throw new VBError('Breakpoint condition is too long',5);
    if(condition)this.debugInspector.parse(condition);
    const value={...location,condition,enabled:enabled!==false};this.breakpoints.set(lower(location.module)+':'+line,value);
    this.emit('breakpoints',[...this.breakpoints.values()]);return value;
  }
  replaceBreakpoints(breakpoints=[]){
    if(!Array.isArray(breakpoints)||breakpoints.length>10000)throw new VBError('Invalid breakpoint list',5);
    const next=new Map();for(const bp of breakpoints){const value={...this.breakpointLocation(bp.module,bp.line),condition:String(bp.condition||''),enabled:bp.enabled!==false};if(value.condition.length>4096)throw new VBError('Breakpoint condition is too long',5);if(value.condition)this.debugInspector.parse(value.condition);next.set(lower(value.module)+':'+value.line,value);}
    this.breakpoints=next;this.emit('breakpoints',[...next.values()]);
  }
  removeBreakpoint(module,line){this.breakpoints.delete(lower(module)+':'+line);this.emit('breakpoints',[...this.breakpoints.values()]);}
  toggleBreakpoint(module,line){const key=lower(module)+':'+line;if(this.breakpoints.has(key))this.removeBreakpoint(module,line);else this.setBreakpoint(module,line);}
  configureDebugger(options){return this.debugger.configure(options);}
  debugStack(){return this.debugger.stack();}
  resumeError(action){return this.debugger.resumeError(action);}
  /** Prepare module storage without running Sub Main or form startup events.
   * This is an opt-in debugger session, never a shipping application's startup. */
  async prepareImmediateContext(){
    if(this.state==='stopped')throw new VBError('The Immediate runtime was reset',5);
    if(this.immediatePreparation)return this.immediatePreparation;
    if(!this.options.debuggerEnabled||this.state!=='ready'||this.instances.size)throw new VBError('A fresh debugger runtime is required for design-mode Immediate',5);
    this.immediateContext=true;
    this.immediatePreparation=(async()=>{try{await this.initialize();if(this.state==='stopped')throw new StopExecution();this.setState('idle');return this;}catch(error){this.stop();throw error;}})();
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
    if(!this.program.valid)throw new VBError(this.program.diagnostics.map(d=>`${d.source}:${d.line}: ${d.message}`).join('\n'),1002);
    for(const module of this.program.modules.values())if(module.kind!=='class')this.instances.set(lower(module.name),new VBInstance(module));
    for(const instance of this.instances.values()){
      if(instance.module.form)await this.attachForm(instance);
    }
    for(const instance of this.instances.values())await this.initializeFields(instance);
  }
  makeFrame(instance,proc={name:'(Declarations)',params:[],returnType:'Variant',code:[]}){return {debugId:this.debugger.nextFrameId++,instance,module:instance.module,proc,locals:new Map(),pc:0,temps:new Map(),withStack:[],gosubStack:[],errorMode:'off',errorTarget:null,errorActive:false,errorPc:null,lastLine:null,lastPc:-1,erl:0,result:new Cell(proc.storageReturnType||proc.returnType||'Variant'),depth:this.stack.length};}
  async initializeFields(instance){const frame=this.makeFrame(instance);for(const decl of [...instance.module.declarations.filter(d=>d.constant),...instance.module.declarations.filter(d=>!d.constant)])await this.declare(decl,frame,instance.fields);instance.initialized=true;}
  async declare(decl,frame,target=frame.locals,staticFlag=false) {
    const key=lower(decl.name);if(target.has(key))return target.get(key);
    const staticKey=lower(frame.proc.name)+':'+(frame.proc.accessor||'')+'.'+key,staticCells=frame.instance.staticCells;
    if(staticFlag&&staticCells.has(staticKey)){target.set(key,staticCells.get(staticKey));return target.get(key);}
    const type=decl.storageType||decl.constantType||decl.type;let value;
    if(decl.bounds!==null&&decl.bounds!==undefined){const bounds=await this.evalBounds(decl.bounds,frame);value=await this.createArray(bounds,type,frame,decl.fixedLength);value.dynamic=!bounds.length;}
    else if(decl.autoNew){const cell=new LazyCell(decl.type,()=>this.createObject(decl.type,frame));cell.scope=decl.scope;target.set(key,cell);if(staticFlag)staticCells.set(staticKey,cell);return cell;}
    else if(this.recordSchema(type,frame.module))value=await this.createRecord(type,frame);
    else value=decl.constant?(frame.proc.constantScalars?.has(key)?frame.proc.constantScalars.get(key):frame.module.constantScalars?.get(key)??frame.module.constantBindings.get(key)):decl.initial?await this.evaluateScalar(decl.initial,frame):this.program.modules.has(lower(decl.type))||this.data.isObjectType(decl.type)?NOTHING:defaultValue(type);
    const cell=new Cell(decl.bounds!==null&&decl.bounds!==undefined?'Variant':type,value,decl.constant,decl.fixedLength);cell.scope=decl.scope;cell.isArray=decl.bounds!==null&&decl.bounds!==undefined;cell.elementType=type;target.set(key,cell);if(decl.withEvents)this.bindEventCell(cell,frame.instance,decl.name);if(staticFlag)staticCells.set(staticKey,cell);return cell;
  }
  recordSchema(name,module){const local=Object.entries(module.types).find(([key])=>lower(key)===lower(name));if(local)return local[1];for(const candidate of this.program.modules.values()){const match=Object.entries(candidate.types).find(([key])=>lower(key)===lower(name));if(match)return match[1];}return null;}
  async createArray(bounds,type,frame,fixedLength=null,depth=0){const record=this.recordSchema(type,frame.module)?await this.createRecord(type,frame,depth+1):null;return new VBArray(bounds,type,record?()=>cloneValue(record):null,fixedLength);}
  async createRecord(name,frame,depth=0){if(depth>32)throw new VBError('Recursive user-defined type',1002);const fields=new Map();for(const member of this.recordSchema(name,frame.module)||[]){const type=member.storageType||member.type;let value;if(member.bounds!==null){value=await this.createArray(await this.evalBounds(member.bounds,frame),type,frame,member.fixedLength,depth+1);value.dynamic=!member.bounds.length;}else if(this.recordSchema(type,frame.module))value=await this.createRecord(type,frame,depth+1);else value=member.initial?await this.evaluateScalar(member.initial,frame):defaultValue(type);const cell=new Cell(member.bounds!==null?'Variant':type,value,false,member.fixedLength);cell.isArray=member.bounds!==null;cell.elementType=type;fields.set(member.name,cell);}return makeRecord(name,fields);}
  // Event connections follow assignment order; replacing a reference detaches the old source.
  bindEventCell(cell,owner,prefix){
    const sink={owner,prefix},set=cell.set.bind(cell);let source=null,unsubscribe=null;
    const connect=value=>{
      unsubscribe?.();unsubscribe=null;
      if(source){const entries=this.eventSinks.get(source);if(entries){const i=entries.indexOf(sink);if(i>=0)entries.splice(i,1);}}
      source=value&&typeof value==='object'?value:null;
      if(source){
        let entries=this.eventSinks.get(source);if(!entries)this.eventSinks.set(source,entries=[]);entries.push(sink);
        if(isAutomationObject(source))unsubscribe=automationSubscribe(source,(name,args,context)=>this.dispatchAutomationEvent(owner,prefix+'_'+name,args,context));
      }
    };
    cell.set=value=>{const result=set(value);connect(result);return result;};connect(cell.get());
  }
  async dispatchAutomationEvent(instance,name,args,{reentrant=false}={}){
    if(['stopped','error'].includes(this.state)||this.immediateContext)return;
    const proc=instance?.module.procedures.get(lower(name));if(!proc)return;
    // A synchronous COM callback may interrupt precisely the outstanding native call.
    // Ordinary idle notifications remain on the VM event queue; never run two stacks.
    if(reentrant&&this.stack.length){
      if(this.state==='paused'||this.debugEvaluation)throw new VBError('Native event callback cannot enter a paused/debug-evaluation frame',5);
      return this.callProcedure(instance,proc,args);
    }
    return this.dispatch(instance,name,args);
  }

  async raiseEvent(instance,name,nodes,frame){
    const event=instance.module.events?.get(lower(name));if(!event)throw new VBError('Event not declared: '+name,1002);
    if(nodes.length!==event.params.length)throw new VBError('Wrong number of arguments to event '+name,450);
    const args=[];
    for(let i=0;i<nodes.length;i++){
      const param=event.params[i],type=param.storageType||param.type;
      const actual=param.byRef?await this.sourceArgument(nodes[i],frame):await this.evaluateScalar(nodes[i],frame);
      if(param.byRef&&actual?.ref){
        if(Object.hasOwn(SCALAR_TYPES,lower(type))&&lower(actual.ref.type)!==lower(type))throw new VBError('ByRef argument type mismatch',13);
        args.push(actual);
      }else if(param.byRef)args.push({ref:new Cell(type,actual)});
      else args.push(storageScalar(actual,type));
    }
    if(this.host.sourceEventEnabled?.(instance,name)===false)return;
    for(const sink of [...(this.eventSinks.get(instance)||[])]){if(!(this.eventSinks.get(instance)||[]).includes(sink))continue;const proc=sink.owner.module.procedures.get(lower(sink.prefix+'_'+name));if(proc)await this.callProcedure(sink.owner,proc,args,frame);}
    // An explicitly installed source-control host shares the declared cells,
    // so cancellable source events preserve the same ByRef storage as VB sinks.
    await this.host.sourceEvent?.(instance,name,args);
    this.emit('event',{instance,name,args:args.map(a=>a?.ref?a.ref.get():a)});
  }
  async evalBounds(bounds,frame){const result=[];for(const [lo,hi]of bounds)result.push([lo?numeric(await this.evaluateScalar(lo,frame)):frame.module.optionBase,numeric(await this.evaluateScalar(hi,frame))]);return result;}
  async start({breakOnEntry=false,runToCursor=null}={}) {
    if(this.immediateContext)throw new VBError('Reset design-mode Immediate before starting the project',5);
    try { if(runToCursor)this.runTarget=this.breakpointLocation(runToCursor.module,runToCursor.line,runToCursor.column??null);await this.initialize();this.setState('running');this.lastYield=performance.now();if(breakOnEntry)this.stepMode={mode:'into',depth:0};
      for(const instance of this.instances.values()){const init=this.formProcedure(instance,'initialize');if(init)await this.callProcedure(instance,init,[]);}
      const name=lower(this.program.startup||'');let instance=this.instances.get(name);
      if(instance?.module.kind==='form'){await this.showForm(instance);return;}
      if(name==='sub main'||name==='main'||!name){for(const i of this.instances.values()){const proc=i.module.procedures.get('main');if(proc){await this.callProcedure(i,proc,[]);return;}}}
      instance ||= [...this.instances.values()].find(i=>i.module.kind==='form');if(instance)await this.showForm(instance);else throw new VBError('Startup Sub Main or startup form was not found',35);
    }catch(error){if(error instanceof StopExecution)return;this.reportError(error);throw error;}
  }
  async attachForm(instance){if(this.host.createForm){instance.formObject=await this.host.createForm(structuredClone(instance.module.form),instance,this);for(const [name,control]of instance.formObject.controlMap||[])instance.fields.set(lower(name),new Cell('Object',control));this.formInstances.add(instance);}}
  formProcedure(instance,event){return instance.module.procedures.get((instance.module.form?.type==='MDIForm'?'mdiform_':'form_')+event);}
  async loadForm(instance){if(!instance?.__vbInstance||!instance.formObject)throw new VBError('Object does not support this property or method',438);if(!instance.loaded){if(this.immediateContext&&this.immediateEvents&&!instance.designInitialized){instance.designInitialized=true;const init=this.formProcedure(instance,'initialize');if(init)await this.callProcedure(instance,init,[]);}instance.loaded=true;await instance.formObject.initializeDataBindings?.();const load=this.formProcedure(instance,'load');if(load)await this.callProcedure(instance,load,[]);}}
  async showForm(instance,modal=false){
    if(this.immediateContext)this.host.debugInteraction?.();
    if(modal&&(instance.module.form?.type==='MDIForm'||Number(instance.module.form?.properties?.MDIChild)))throw new VBError('MDI forms and child forms cannot be shown modally',401);
    if(instance.formObject?.mdiChild){const parent=instance.formObject.mdiController.parent?.instance;if(!parent)throw new VBError('MDI child requires an MDI Form',366);if(!parent.formObject.shown&&!parent.showing)await this.showForm(parent);}
    instance.showing=true;try{await this.loadForm(instance);}finally{instance.showing=false;}if(modal&&instance.formObject.shown)throw new VBError('Form already displayed; cannot show modally',400);
    const previous=this.library.get('screen').ActiveForm;this.library.get('screen').ActiveForm=instance;instance.formObject.Show?.(modal);if(instance.module.form?.type==='MDIForm'&&instance.formObject.mdiController?.active?.shown)this.library.get('screen').ActiveForm=instance.formObject.mdiController.active.instance;const activate=this.formProcedure(instance,'activate');if(activate)await this.callProcedure(instance,activate,[]);
    if(modal){const evaluation=this.debugEvaluation,finish=this.host.beginModal?.(instance.formObject);try{while(instance.formObject.shown&&this.state!=='stopped'&&this.state!=='error'){evaluation?.check();if(this.state!=='paused'&&this.eventQueue.length)await this.runQueuedEvent(this.eventQueue.shift());else await new Promise(resolve=>setTimeout(resolve,8));}}finally{if(evaluation?.reason)instance.formObject.Hide?.();finish?.();this.library.get('screen').ActiveForm=previous;}}
  }
  async unloadForm(instance,mode=1){
    if(!instance?.__vbInstance)throw new VBError('Object required',424);if(!instance.loaded)return true;
    if(instance.unloading)return false;const children=instance.module.form?.type==='MDIForm'?[...this.formInstances].filter(i=>i.loaded&&Number(i.module.form?.properties?.MDIChild)):[],targets=[instance,...children];
    targets.forEach(i=>i.unloading=true);
    try{
      for(const target of targets){const cancel=new Cell('Integer',0),query=this.formProcedure(target,'queryunload');if(query)await this.callProcedure(target,query,[{ref:cancel},target===instance?mode:4]);if(truth(cancel.get()))return false;}
      for(const target of [...children,instance]){const cancel=new Cell('Integer',0),proc=this.formProcedure(target,'unload');if(proc)await this.callProcedure(target,proc,[{ref:cancel}]);if(truth(cancel.get()))return false;}
      for(const target of [...children,instance]){target.formObject?.Hide?.();target.formObject?.suspendTimers?.();target.loaded=false;target.staticCells.clear();}return true;
    }finally{targets.forEach(i=>i.unloading=false);}
  }
  requestUnload(instance){if(this.state==='stopped')return Promise.resolve();return new Promise(resolve=>{this.eventQueue.push({action:()=>this.unloadForm(instance,0),resolve,key:'unload:'+instance.module.name});this.processEvents();});}
  async doEvents(){await new Promise(resolve=>setTimeout(resolve,0));for(let i=0;i<32&&this.eventQueue.length&&this.state==='running';i++)await this.runQueuedEvent(this.eventQueue.shift());return [...this.formInstances].filter(i=>i.loaded).length;}
  async createObject(name,frame=this.currentFrame){if(this.automation?.has(name))return this.automation.create(name);const key=lower(name);if(key==='collection')return new VBCollection();if(key==='scripting.dictionary'||key==='dictionary')return new VBDictionary();if(key==='scripting.filesystemobject')return this.fs.fso();const dataObject=this.data.createObject(name);if(dataObject)return dataObject;const module=this.program.modules.get(key);if(module){if(module.form?.type==='MDIForm')throw new VBError('An MDI Form cannot be created with New',360);const instance=new VBInstance(module);if(module.form)await this.attachForm(instance);await this.initializeFields(instance);const init=module.form?this.formProcedure(instance,'initialize'):module.procedures.get('class_initialize');if(init)await this.callProcedure(instance,init,[]);return instance;}throw new VBError(`ActiveX component cannot create object in browser runtime: ${name}`,429);}
  /** Adapt one public JavaScript member back into a source value. Unknown
   * numeric adapters are Double; only documented built-ins receive a subtype. */
  nativeScalar(object,name,value){
    if(value instanceof VBScalar||!scalarType(value))return value;
    const key=lower(name||''),raw=unbox(value);let type=scalarType(value),variant=false;
    if(hasDataDefault(object)&&['value','originalvalue'].includes(key)){const declared=lower(dataDefaultType(object)||'');return raw==null?storageScalar(raw,'Variant'):Object.hasOwn(SCALAR_TYPES,declared)?tagScalar(raw,declared,true):storageScalar(value,'Variant');}
    if(object===this.err&&['number','helpcontext','lastdllerror'].includes(key))type='long';
    else if(object instanceof VBCollection||object instanceof VBDictionary){if(key==='count')type='long';if(key==='exists')type='boolean';}
    else if(object?.__control){
      const control=object.type||object.model?.type;
      if(['enabled','visible','tabstop','autoredraw','wordwrap','multiline','locked','sorted','cancel','default','mdichild'].includes(key))type='boolean';
      else if(['left','top','width','height','scalewidth','scaleheight','scaleleft','scaletop','currentx','currenty'].includes(key))type='single';
      else if(['hwnd','hdc','backcolor','forecolor','selstart','sellength','maxlength','interval','itemdata'].includes(key))type='long';
      else if(['listindex','listcount','tabindex','index','mousepointer','borderstyle','appearance','windowstate','scalemode','alignment','style'].includes(key))type='integer';
      else if(key==='selected')type='boolean';
      else if(key==='value')type=control==='OptionButton'?'boolean':control==='DTPicker'?'date':['HScrollBar','VScrollBar','CheckBox'].includes(control)?'integer':type;
    }
    return tagScalar(raw,type,variant);
  }
  async invokeScalar(target,args,frame){
    const fn=target?.__native||target,receiver=target?.receiver;
    if(fn.vbScalarInvoke)return this.debugAwait(fn.vbScalarInvoke(args,frame));
    const name=lower(target?.memberName||'');
    if((receiver instanceof VBCollection||receiver instanceof VBDictionary)&&name==='item')return receiver.itemScalar(...args);
    if(receiver===this.library.get('debug')&&name==='print'){this.output(args.map(v=>printScalar(v)).join(' '));return;}
    const input=receiver instanceof VBCollection||receiver instanceof VBDictionary?args:args.map(unbox);
    const result=await this.debugAwait(fn.vbInvoke?fn.vbInvoke(input,frame):fn.apply(receiver,input));
    return this.nativeScalar(receiver,name,result);
  }
  async expressionValue(value,frame){
    if(value?.__procedure)return this.callProcedure(value.instance,value.__procedure,[],frame,true);
    if(value?.__native||typeof value==='function')return this.invokeScalar(value,[],frame);
    return value;
  }
  /** Classify ByRef expressions without probing a getter and evaluating it a
   * second time. Properties/functions bind temporaries, real storage aliases. */
  async sourceOperand(node,frame){
    if(node.kind==='id'){
      const key=lower(node.name);
      let ref=key===lower(frame.proc.name)&&['function','property'].includes(frame.proc.kind)?frame.result:frame.locals.get(key)||frame.instance.fields.get(key);
      if(!ref)for(const instance of this.instances.values())if(instance.module.kind==='module'&&instance.fields.has(key)&&(instance===frame.instance||instance.fields.get(key).scope!=='private')){ref=instance.fields.get(key);break;}
      if(ref&&!ref.constant)return {ref};
      const value=await this.getIdentifier(node.name,frame,{noInvoke:true});
      // Implicit declaration performed by getIdentifier is genuine storage.
      if(!ref&&frame.locals.has(key))return {ref:frame.locals.get(key)};
      return {value};
    }
    if(node.kind==='member'){
      const object=await this.evaluateScalar(node.object,frame,{raw:true});
      this.assertVisible(object,node.name,frame);
      const fields=object?.__vbInstance?object.fields:object?.__fields;
      const ref=fields&&[...fields].find(([key])=>lower(key)===lower(node.name))?.[1];
      return ref&&!ref.constant?{ref}:{value:await this.getMemberScalar(object,node.name,frame)};
    }
    if(node.kind==='call'){
      const resolved=await this.sourceOperand(node.callee,frame),target=resolved.ref?await readScalar(resolved.ref):resolved.value;
      if(target instanceof VBArray){
        if(!node.args.length)return resolved.ref?{ref:resolved.ref}:{value:target};
        const indices=[];for(const arg of node.args)indices.push(numeric(await this.evaluateScalar(arg,frame)));
        target.offset(indices);
        const ref=new Ref(()=>target.get(...indices),v=>target.set(indices,v),target.type,target.fixedLength,()=>target.getScalar(...indices));
        ref.debugGet=ref.get;ref.debugGetScalar=ref.getScalar;ref.win32Array=target;ref.win32Offset=target.offset(indices);
        return {ref};
      }
      return {value:await this.callResolvedExpression(node,target,frame)};
    }
    return {value:await this.evaluateScalar(node,frame)};
  }
  async sourceArgument(node,frame){
    const resolved=await this.sourceOperand(node,frame);
    if(resolved.ref)return resolved;
    return this.expressionValue(resolved.value,frame);
  }
  async getIdentifier(name,frame,{noInvoke=false}={}) {
    const key=lower(name);
    if(key==='me')return frame.instance;
    if(frame.locals.has(key))return readScalar(frame.locals.get(key));
    if(key===lower(frame.proc.name)&&['function','property'].includes(frame.proc.kind))return readScalar(frame.result);
    if(frame.instance.fields.has(key))return readScalar(frame.instance.fields.get(key));
    if(frame.proc.constantBindings?.has(key))return frame.proc.constantScalars?.get(key)??frame.proc.constantBindings.get(key);
    if(frame.module.constantBindings?.has(key))return frame.module.constantScalars?.get(key)??frame.module.constantBindings.get(key);
    const enumeration=frame.module.enumBindings?.get(key);if(enumeration){if(enumeration.ambiguous)throw new VBError('Ambiguous enum name: '+name,1002);return enumeration;}
    const localProc=frame.module.procedures.get(key);if(localProc)return {__procedure:localProc,instance:frame.instance};
    const property=frame.module.procedures.get(key+':get');if(property)return await this.callProcedure(frame.instance,property,[],frame,true);
    if(frame.instance.formObject&&!(String(name).endsWith('$')&&this.library.has(key+'$'))&&this.hasMember(frame.instance.formObject,name))return this.nativeMemberScalar(frame.instance.formObject,name);
    const constant=frame.module.importedConstantBindings?.get(key);if(constant){if(constant.ambiguous)throw new VBError('Ambiguous constant: '+name,1002);return constant.scalar??constant.value;}
    if(this.instances.has(key))return this.instances.get(key);
    for(const instance of this.instances.values())if(instance.module.kind==='module'){
      if(instance.fields.has(key)&&instance.fields.get(key).scope!=='private')return readScalar(instance.fields.get(key));const proc=instance.module.procedures.get(key);if(proc&&proc.scope!=='private')return {__procedure:proc,instance};
    }
    const intrinsicKey=String(name).endsWith('$')&&this.library.has(key+'$')?key+'$':key;
    if(this.library.has(intrinsicKey)){const value=this.library.get(intrinsicKey);return typeof value==='number'?tagScalar(value,value>=-32768&&value<=32767?'integer':'long'):tagScalar(value);}
    if(frame.module.optionExplicit)throw new VBError(`Variable not defined: ${name}`,500);
    const cell=new Cell(defaultIdentifierType(name,frame.module.defaultTypes));frame.locals.set(key,cell);return readScalar(cell);
  }
  nativeKey(object,name){
    if(object===NOTHING||object===null||object===undefined)throw new VBError('Object variable or With block variable not set',91);
    const key=lower(name);if(BLOCKED_MEMBERS.has(key)||key.startsWith('_'))throw new VBError('Member access is not permitted',438);
    if(typeof object==='function'||object?.nodeType||object?.window===object)throw new VBError('Browser host objects are not exposed to Visual Basic',438);
    const isRecord=Object.getPrototypeOf(object)===Object.prototype&&!!object.__type;let obj=object,privateMatch=false;
    for(let depth=0;obj&&depth<5;depth++,obj=Object.getPrototypeOf(obj)){
      const candidates=Object.getOwnPropertyNames(obj).filter(k=>lower(k)===key&&!BLOCKED_MEMBERS.has(lower(k)));
      const publicKey=candidates.find(k=>/^[A-Z]/.test(k)||isRecord||['hwnd','hdc'].includes(key)&&object.__control||hasDataMember(object,k));if(publicKey)return publicKey;
      if(candidates.length)privateMatch=true;
    }
    if(privateMatch)throw new VBError('Implementation members are not exposed to Visual Basic: '+name,438);
    return null;
  }
  hasMember(object,name){try{return this.nativeKey(object,name)!==null;}catch{return false;}}
  nativeMember(object,name){const value=this.nativeMemberScalar(object,name);return unbox(value);}
  nativeMemberScalar(object,name){const key=this.nativeKey(object,name);if(key===null)throw new VBError(`Object does not support property or method: ${name}`,438);const v=object[key];if(typeof v==='function')return {__native:v,receiver:object,memberName:name};return this.nativeScalar(object,name,v);}
  assertVisible(object,name,frame){
    if(!object?.__vbInstance||frame?.module===object.module)return;
    const key=lower(name),field=object.fields.get(key),members=[object.module.procedures.get(key),object.module.procedures.get(key+':get'),object.module.procedures.get(key+':let'),object.module.procedures.get(key+':set')].filter(Boolean);
    if(field?.scope==='private'||members.length&&members.every(p=>p.scope==='private'))throw new VBError('Method or data member not found: '+name,438);
  }
  interfaceProcedure(object,name,accessor=null){
    const binding=object.target.module.interfaceBindings?.[object.interfaceName],member=binding?.members[lower(name)+(accessor?':'+accessor:'')];
    if(!member)throw new VBError('Member not found in '+object.interfaceName+': '+name,438);
    return {__procedure:object.target.module.procedures.get(member.procedure),__signature:member.signature,instance:object.target};
  }
  async getMember(object,name,frame){return unbox(await this.getMemberScalar(object,name,frame));}
  async getMemberScalar(object,name,frame){
    if(isAutomationObject(object))return automationMember(object,name,true);
    if(object?.__vbEnum){const key=lower(name);if(!Object.hasOwn(object.values,key))throw new VBError('Enum member not found: '+name,438);return tagScalar(object.values[key],'long');}
    if(object?.__vbInterface){const members=object.target.module.interfaceBindings[object.interfaceName].members,key=lower(name);const value=this.interfaceProcedure(object,name,members[key]?null:'get');return value.__signature.kind==='property'&&!value.__signature.params.length?this.callProcedure(value.instance,value.__procedure,[],frame,true):value;}
    this.assertVisible(object,name,frame);
    if(object?.__vbInstance){const key=lower(name);if(object.fields.has(key))return readScalar(object.fields.get(key));const proc=object.module.procedures.get(key);if(proc)return {__procedure:proc,instance:object};const property=object.module.procedures.get(key+':get');if(property){if(property.scope==='private'&&object.module!==frame?.module)throw new VBError('Property get is not accessible',438);return property.params.length?{__procedure:property,instance:object}:this.callProcedure(object,property,[],frame,true);}if(object.formObject){if(key==='show')return {__native:(modal=0)=>this.showForm(object,truth(modal)),receiver:this};if(key==='hide')return {__native:()=>object.formObject.Hide(),receiver:this};return this.nativeMemberScalar(object.formObject,name);}throw new VBError(`Method or data member not found: ${name}`,438);}
    if(object?.__fields){const field=[...object.__fields].find(([n])=>lower(n)===lower(name));if(field)return readScalar(field[1]);}
    return this.nativeMemberScalar(object,name);
  }
  async defaultValue(value,depth=0){
    if(value===this.err)return tagScalar(this.err.Number,'long');
    if(depth>32)throw new VBError('Circular default-member evaluation',28);
    if(value?.__control)return this.nativeScalar(value,['TextBox','RichTextBox','ComboBox','ListBox','FileListBox','DirListBox','DriveListBox','MSFlexGrid','MSHFlexGrid','DataGrid'].includes(value.type)?'Text':['CheckBox','OptionButton','HScrollBar','VScrollBar','Slider','ProgressBar','UpDown','DTPicker'].includes(value.type)?'Value':'Caption',value.defaultValue());
    if(hasDataDefault(value))return this.defaultValue(this.nativeScalar(value,'Value',value.Value),depth+1);
    if(isAutomationObject(value)){const name=automationDefaultName(value);if(!name)throw new VBError('Automation object has no default value',438);return this.defaultValue(await automationInvoke(value,name,2,[]),depth+1);}
    const instance=objectIdentity(value),name=value?.__vbInterface?instance.module.interfaceBindings[value.interfaceName]?.defaultMember:instance?.module?.defaultMember;
    if(instance?.__vbInstance&&name){const member=await this.getMemberScalar(value,name,this.currentFrame),result=member?.__procedure?await this.callProcedure(member.instance,member.__procedure,[],this.currentFrame,true):member;return this.defaultValue(result,depth+1);}
    return value;
  }
  async evaluate(node,frame=this.currentFrame,options={}) {return unbox(await this.evaluateScalar(node,frame,options));}
  async evaluateScalar(node,frame=this.currentFrame,{raw=false}={}) {
    if(!frame){const instance=this.instances.values().next().value;if(!instance)throw new VBError('Runtime is not initialized',5);frame=this.makeFrame(instance);}
    let value;
    switch(node.kind){
      case 'missing':return MISSING;case 'nothing':return NOTHING;case 'currency':case 'literal':case 'date':return literalScalar(node);case 'empty':return tagScalar(undefined,'empty',true);case 'group':return this.evaluateScalar(node.expr,frame,{raw});
      case 'id':value=await this.getIdentifier(node.name,frame);break;
      case 'with':if(!frame.withStack.length)throw new VBError('Invalid or unqualified reference',1002);return frame.withStack.at(-1);
      case 'member':value=await this.getMemberScalar(await this.evaluateScalar(node.object,frame,{raw:true}),node.name,frame);break;
      case 'addressOf':return tagScalar(this.win32.callback(await this.evaluateScalar(parseExpression(node.name),frame,{raw:true})),'long');
      case 'new':return this.createObject(node.name,frame);
      case 'typeof':{
        const object=await this.evaluateScalar(node.expr,frame,{raw:true}),type=lower(node.name).replace(/^vb\./,'');
        if(object===NOTHING)return tagScalar(0,'boolean');
        if(!object||typeof object!=='object'||object instanceof VBScalar||object instanceof Date||object instanceof VBCurrency||object instanceof VBDecimal||object instanceof VBArray||object instanceof VBErrorValue||object.__fields||object===MISSING)throw new VBError('Object required',424);
        if(type==='object')return tagScalar(-1,'boolean');
        if(objectSupports(object,type))return tagScalar(-1,'boolean');
        const actual=lower(object instanceof VBCollection?'Collection':object instanceof VBDictionary?'Dictionary':object.__type||object.model?.type||'');
        return tagScalar((actual===type||actual==='dictionary'&&type==='scripting.dictionary'||type==='form'&&!!object.module?.form||type==='control'&&!!object.__control)?-1:0,'boolean');
      }
      case 'unary':{const literal=signedLiteralScalar(node);if(literal)return literal;}return unary(node.op,await this.defaultValue(await this.evaluateScalar(node.expr,frame)));
      case 'binary':if(node.op==='is')return tagScalar(binary('is',unbox(await this.evaluateScalar(node.left,frame,{raw:true})),unbox(await this.evaluateScalar(node.right,frame,{raw:true}))),'boolean');return binary(node.op,await this.defaultValue(await this.evaluateScalar(node.left,frame)),await this.defaultValue(await this.evaluateScalar(node.right,frame)),frame.module.optionCompare);
      case 'call':return this.callExpression(node,frame);
      default:throw new VBError(`Invalid expression kind: ${node.kind}`,1002);
    }
    if(raw)return value;
    if(value?.__procedure)return this.callProcedure(value.instance,value.__procedure,[],frame,true);
    if(value?.__native)return this.invokeScalar(value,[],frame);
    if(typeof value==='function')return this.invokeScalar(value,[],frame);
    return value;
  }
  argumentSlots(nodes,params,allowExtra=false){
    const slots=[],used=new Set();let named=false,pos=0;
    for(const node of nodes){let index;
      if(node.kind==='named'){
        named=true;if(!params)throw new VBError('Object does not support named arguments',446);
        index=params.findIndex(p=>lower(p.name)===lower(node.name));
        if(index<0)throw new VBError('Named argument not found: '+node.name,448);
        if(params[index].paramArray)throw new VBError('ParamArray cannot be passed by name',446);
      }else{if(named)throw new VBError('Positional argument cannot follow named argument',1002);index=pos++;}
      if(used.has(index))throw new VBError('Argument already specified',450);used.add(index);
      if(params&&index>=params.length&&!allowExtra)throw new VBError('Wrong number of arguments',450);
      slots.push({index,node:node.kind==='named'?node.expr:node});
    }
    return slots;
  }
  async callExpression(node,frame){
    let target=node.callee.kind==='id'&&lower(node.callee.name)===lower(frame.proc.name)?{__procedure:frame.proc,instance:frame.instance}:await this.evaluateScalar(node.callee,frame,{raw:true});
    return this.callResolvedExpression(node,target,frame);
  }
  async callResolvedExpression(node,target,frame){
    if(isAutomationObject(target)){const name=automationDefaultName(target);if(!name)throw new VBError('Automation object has no default property',438);target=automationMember(target,name);}
    const instance=objectIdentity(target),defaultName=target?.__vbInterface?instance.module.interfaceBindings[target.interfaceName]?.defaultMember:instance?.module?.defaultMember;
    if(instance?.__vbInstance&&defaultName)target=await this.getMemberScalar(target,defaultName,frame);
    const proc=target?.__procedure,signature=target?.__signature||proc,fn=target?.__native||(typeof target==='function'?target:null),params=signature?.params||(fn?.vbShortParams&&node.args.length===2&&node.args.every(n=>n.kind!=='named')?fn.vbShortParams:fn?.vbParams);
    const slots=this.argumentSlots(node.args,params,!!proc?.params.at(-1)?.paramArray||!!fn?.vbVariadic);
    const actual=[];
    for(const {index,node:arg}of slots){
      const param=params?.[index];
      if(arg.kind==='missing'){actual[index]=proc||fn?.vbPreserveMissing?MISSING:undefined;continue;}
      if(arg.kind==='byval'){if(!proc?.external)throw new VBError('ByVal call-site override is supported only for Declare calls',49);actual[index]={__win32ByVal:true,value:await this.evaluateScalar(arg.expr,frame)};continue;}
      if(param?.byRef&&!param.paramArray&&!proc?.external){actual[index]=await this.sourceArgument(arg,frame);continue;}
      if(proc?.external&&(param?.byRef||param?.type.toLowerCase()==='string')&&!param.paramArray&&['id','member','call'].includes(arg.kind)){
        actual[index]={ref:await this.reference(arg,frame,true)};continue;
      }
      const value=await this.evaluateScalar(arg,frame);
      actual[index]=proc||fn?.vbRawArgs?value:await this.defaultValue(value);
    }
    if(proc){for(let i=0;i<actual.length;i++)if(!(i in actual))actual[i]=MISSING;return this.callProcedure(target.instance,proc,actual,frame,true);}
    if(fn&&params){for(let i=0;i<params.length;i++){if(!slots.some(s=>s.index===i&&s.node.kind!=='missing')&&!params[i].optional&&!params[i].paramArray)throw new VBError('Argument not optional: '+params[i].name,449);if(fn.vbPreserveMissing&&!(i in actual))actual[i]=MISSING;}}
    if(target instanceof VBArray)return actual.length?target.getScalar(...actual):target;
    if(target instanceof VBCollection||target instanceof VBDictionary)return target.itemScalar(...actual);
    if(target?.__native)return this.invokeScalar(target,actual,frame);
    if(typeof target==='function')return this.invokeScalar(target,actual,frame);
    if(target?.Item&&typeof target.Item==='function')return tagScalar(await this.debugAwait(target.Item(...actual.map(unbox))),undefined,true);
    if(target?.__vbInstance){const getter=target.module.procedures.get('item:get');if(getter)return this.callProcedure(target,getter,actual,frame,true);}
    throw new VBError('Expected array or callable procedure',13);
  }
  async reference(node,frame=this.currentFrame,objectSet=false) {
    if(node.kind==='group')return new Cell('Variant',await this.evaluateScalar(node.expr,frame));
    if(node.kind==='id'){
      const key=lower(node.name);if(key===lower(frame.proc.name)&&['function','property'].includes(frame.proc.kind))return frame.result;
      let cell=frame.locals.get(key)||frame.instance.fields.get(key);
      if(!cell){for(const instance of this.instances.values())if(instance.module.kind==='module'&&instance.fields.has(key)&&(instance===frame.instance||instance.fields.get(key).scope!=='private')){cell=instance.fields.get(key);break;}}
      if(cell){if(!objectSet){const value=await cell.get();if(value?.__control)return value.defaultRef();if(hasDataDefault(value))return new Ref(()=>value.Value,v=>{value.Value=v;});if(isAutomationObject(value))return automationReference(value,automationDefaultName(value));const instance=objectIdentity(value),name=value?.__vbInterface?instance.module.interfaceBindings[value.interfaceName]?.defaultMember:instance?.module?.defaultMember;if(instance?.__vbInstance&&name)return this.memberReference(value,name,frame);}return cell;}
      if(frame.proc.constantBindings?.has(key)||frame.module.constantBindings?.has(key)||frame.module.globalEnumMembers?.has(key))throw new VBError('Assignment to constant not permitted',500);
      const setter=frame.module.procedures.get(key+':let')||frame.module.procedures.get(key+':set');if(setter)return new Ref(()=>this.getIdentifier(node.name,frame),v=>this.callProcedure(frame.instance,setter,[v],frame));
      if(frame.instance.formObject&&this.hasMember(frame.instance.formObject,node.name))return this.memberReference(frame.instance.formObject,node.name,frame);
      if(frame.module.optionExplicit)throw new VBError(`Variable not defined: ${node.name}`,500);
      cell=new Cell(defaultIdentifierType(node.name,frame.module.defaultTypes));frame.locals.set(key,cell);return cell;
    }
    if(node.kind==='member')return this.memberReference(await this.evaluateScalar(node.object,frame,{raw:true}),node.name,frame,objectSet);
    if(node.kind==='call'){
      let target=await this.evaluateScalar(node.callee,frame,{raw:true});const args=[];for(const a of node.args)args.push(await this.evaluateScalar(a,frame));
      if(isAutomationObject(target))return automationReference(target,automationDefaultName(target),args,objectSet);
      const instance=objectIdentity(target),defaultName=target?.__vbInterface?instance.module.interfaceBindings[target.interfaceName]?.defaultMember:instance?.module?.defaultMember;
      if(instance?.__vbInstance&&defaultName){const getter=()=>this.callExpression(node,frame);if(target.__vbInterface){const member=this.interfaceProcedure(target,defaultName,objectSet?'set':'let');return new Ref(getter,v=>this.callProcedure(member.instance,member.__procedure,[...args,v],frame));}const setter=instance.module.procedures.get(defaultName+':'+(objectSet?'set':'let'));if(!setter)throw new VBError('Default property is read-only',383);return new Ref(getter,v=>this.callProcedure(instance,setter,[...args,v],frame));}
      if(target instanceof VBArray&&!args.length&&node.callee.kind==='id')return this.reference(node.callee,frame,true);
      if(target instanceof VBArray){const ref=new Ref(()=>target.get(...args),value=>target.set(args,value),target.type,target.fixedLength,()=>target.getScalar(...args));ref.debugGetScalar=ref.getScalar;ref.win32Array=target;ref.win32Offset=target.offset(args);return ref;}
      if(target instanceof VBDictionary)return new Ref(()=>target.Item(...args),value=>target.setItem(...args,value),'Variant',null,()=>target.itemScalar(...args));
      if(target?.__native&&target.receiver?.setItem)return new Ref(()=>target.__native.apply(target.receiver,args.map(unbox)),v=>target.receiver.setItem(...args.map(unbox),unbox(v)));
      if(node.callee.kind==='member'){
        const object=await this.evaluateScalar(node.callee.object,frame,{raw:true});const name=lower(node.callee.name);
        if(isAutomationObject(object))return automationReference(object,node.callee.name,args,objectSet);
        if(object?.__vbInterface){const member=this.interfaceProcedure(object,node.callee.name,objectSet?'set':'let');return new Ref(()=>this.callExpression(node,frame),v=>this.callProcedure(member.instance,member.__procedure,[...args,v],frame));}
        if(object?.__vbInstance){const proc=object.module.procedures.get(name+':let')||object.module.procedures.get(name+':set');if(proc){if(proc.scope==='private'&&object.module!==frame?.module)throw new VBError('Property assignment is not accessible',438);return new Ref(()=>this.getMemberScalar(object,node.callee.name,frame),v=>this.callProcedure(object,proc,[...args,v],frame));}}
        if(object?.setIndexed)return new Ref(()=>object[node.callee.name](...args.map(unbox)),value=>object.setIndexed(node.callee.name,args.map(unbox),unbox(value)));
      }
      if(target&&typeof target.setItem==='function')return new Ref(()=>target.Item(...args.map(unbox)),v=>target.setItem(...args.map(unbox),unbox(v)));
      throw new VBError('Invalid indexed assignment',13);
    }
    throw new VBError('Invalid assignment target',1002);
  }
  async memberReference(object,name,frame,objectSet=false){
    if(isAutomationObject(object))return automationReference(object,name,[],objectSet);
    if(object?.__vbInterface){const member=this.interfaceProcedure(object,name,objectSet?'set':'let');return new Ref(()=>this.getMemberScalar(object,name,frame),v=>this.callProcedure(member.instance,member.__procedure,[v],frame));}
    this.assertVisible(object,name,frame);
    if(object?.__vbInstance){const key=lower(name);if(object.fields.has(key))return object.fields.get(key);const setter=object.module.procedures.get(key+':let')||object.module.procedures.get(key+':set');if(setter){if(setter.scope==='private'&&object.module!==frame?.module)throw new VBError('Property assignment is not accessible',438);return new Ref(()=>this.getMemberScalar(object,name,frame),v=>this.callProcedure(object,setter,[v],frame));}if(object.formObject)return this.memberReference(object.formObject,name,frame);throw new VBError(`Method or data member not found: ${name}`,438);}
    if(object?.__fields){const entry=[...object.__fields].find(([key])=>lower(key)===lower(name));if(entry)return entry[1];}
    const key=this.nativeKey(object,name);if(key===null){if(Object.getPrototypeOf(object)===Object.prototype){object[name]=undefined;return new Ref(()=>object[name],v=>object[name]=v);}throw new VBError(`Property not found: ${name}`,438);}return new Ref(()=>object[key],v=>{object[key]=unbox(v);return unbox(v);},'Variant',null,()=>this.nativeScalar(object,name,object[key]));
  }
  async callByName(object,name,callType,args=[],frame=this.currentFrame,scalarReturn=false){
    const result=await this.callByNameScalar(object,name,callType,args,frame);return scalarReturn?result:unbox(result);
  }
  async callByNameScalar(object,name,callType,args=[],frame=this.currentFrame){
    if(![1,2,4,8].includes(callType))throw new VBError('Invalid procedure call',5);
    const key=lower(name);if(BLOCKED_MEMBERS.has(key)||key.startsWith('_'))throw new VBError('Member access is not permitted',438);
    if(object===NOTHING||object===null||object===undefined)throw new VBError('Object variable not set',91);
    if(typeof object!=='object'||object instanceof VBArray||object instanceof Date||object instanceof VBCurrency||object instanceof VBDecimal||object instanceof VBErrorValue||object===MISSING||object.__fields)throw new VBError('Object required',424);
    if(callType===8){const value=args.at(-1);if(value!==NOTHING&&(!value||typeof value!=='object'||value instanceof VBArray||value instanceof Date||value instanceof VBCurrency||value instanceof VBDecimal||value instanceof VBErrorValue||value.__fields))throw new VBError('Object required',424);}
    if(isAutomationObject(object))return this.debugAwait(automationInvoke(object,name,callType,args));
    if(object.__vbInterface){const member=this.interfaceProcedure(object,name,({2:'get',4:'let',8:'set'})[callType]||null);return this.callProcedure(member.instance,member.__procedure,args,frame,true);}
    if(object.__vbInstance){
      // Automation dispatch is public even when invoked by code in the same class.
      const proc=object.module.procedures.get(key+(callType===1?'':callType===2?':get':callType===4?':let':':set'));
      if(proc){if(proc.scope==='private')throw new VBError('Member is not publicly accessible',438);return this.callProcedure(object,proc,args,frame,true);}
      const field=object.fields.get(key);
      if(field){if(field.scope==='private')throw new VBError('Member is not publicly accessible',438);if(callType===2){if(args.length)throw new VBError('Wrong number of arguments',450);return readScalar(field);}if(callType===4||callType===8){if(args.length!==1)throw new VBError('Wrong number of arguments',450);if(callType===4&&lower(field.type)==='object')throw new VBError('Object assignment requires vbSet',13);return field.set(args[0]);}throw new VBError('Member is not a method',438);}
      if(object.formObject)return this.callByNameScalar(object.formObject,name,callType,args,frame);
      throw new VBError('Method or data member not found: '+name,438);
    }
    const native=this.nativeKey(object,name);if(native===null)throw new VBError('Object does not support property or method: '+name,438);
    const value=object[native];
    if(callType===1){if(typeof value!=='function')throw new VBError('Member is not a method',438);return this.invokeScalar({__native:value,receiver:object,memberName:name},args,frame);}
    if(callType===2){if(typeof value==='function'){if(!['item','list','selected','itemdata','textmatrix','colwidth','rowheight'].includes(key))throw new VBError('Member is not a property',438);return this.invokeScalar({__native:value,receiver:object,memberName:name},args,frame);}if(args.length)throw new VBError('Wrong number of arguments',450);return this.nativeScalar(object,name,value);}
    if(!args.length)throw new VBError('Argument not optional',449);
    if(typeof value==='function'){
      if(key==='item'&&typeof object.setItem==='function')return object.setItem(...args);
      if(typeof object.setIndexed==='function')return object.setIndexed(name,args.slice(0,-1),args.at(-1));
      throw new VBError('Property is read-only',383);
    }
    if(args.length!==1)throw new VBError('Wrong number of arguments',450);
    let owner=object,descriptor;for(let i=0;owner&&i<5;i++,owner=Object.getPrototypeOf(owner)){descriptor=Object.getOwnPropertyDescriptor(owner,native);if(descriptor)break;}
    if(descriptor&&(descriptor.get&&!descriptor.set||'writable'in descriptor&&!descriptor.writable))throw new VBError('Property is read-only',383);
    object[native]=unbox(args[0]);return args[0];
  }
  async callProcedure(instance,proc,args=[],caller=null,scalarReturn=false){
    if(proc.external){const value=await this.debugAwait(this.win32.invoke(proc,args.map(a=>a?.ref?a:a?.__win32ByVal?{...a,value:unbox(a.value)}:unbox(a))));return scalarReturn?storageScalar(value,proc.storageReturnType||proc.returnType||'Variant'):value;}
    if(this.stack.length>=this.options.maxCallDepth)throw new VBError('Out of stack space',28);
    const frame=this.makeFrame(instance,proc);frame.caller=caller;if(this.recordSchema(proc.returnType,frame.module))frame.result=new Cell(proc.returnType,await this.createRecord(proc.returnType,frame));
    if(args.length>proc.params.length&&!proc.params.at(-1)?.paramArray)throw new VBError(`Wrong number of arguments to ${proc.name}`,450);
    for(let i=0;i<proc.params.length;i++){
      const param=proc.params[i];let actual=i<args.length?args[i]:MISSING,cell;
      if(param.paramArray){cell=new Cell('Variant',VBArray.from(await Promise.all(args.slice(i).map(v=>v?.ref?readScalar(v.ref):v))));frame.locals.set(lower(param.name),cell);break;}
      if(unbox(actual)===MISSING){if(param.initial)actual=proc.defaultScalars?.has(lower(param.name))?proc.defaultScalars.get(lower(param.name)):await this.evaluateScalar(param.initial,frame);else if(!param.optional)throw new VBError(`Argument not optional: ${param.name}`,449);else actual=lower(param.type)==='variant'?MISSING:defaultValue(param.type);}
      const declared=param.storageType||param.type;
      if(param.byRef&&actual?.ref){
        const ref=actual.ref,value=await ref.get();
        if(param.bounds!==null){if(!(value instanceof VBArray)||lower(value.type)!==lower(declared))throw new VBError('ByRef array type mismatch',13);cell=ref;}
        else if(this.recordSchema(param.type,frame.module)){if(!value?.__fields||lower(value.__type)!==lower(param.type))throw new VBError('ByRef user-defined type mismatch',13);cell=ref;}
        else if(Object.hasOwn(SCALAR_TYPES,lower(declared))&&lower(ref.type)!==lower(declared))throw new VBError('ByRef argument type mismatch',13);
        else if(lower(declared)==='variant'&&scalarType(value)){
          cell=new Ref(()=>ref.get(),v=>ref.set(v),'Variant',ref.fixedLength,async()=>storageScalar(await readScalar(ref),'Variant'));
          // Only storage-backed references may participate in automatic watches.
          if(ref instanceof Cell||typeof ref.debugGetScalar==='function'){cell.debugGetScalar=()=>storageScalar(ref instanceof Cell?ref.getScalar():ref.debugGetScalar(),'Variant');cell.debugGet=()=>unbox(cell.debugGetScalar());}
        }else cell=objectSupports(value,param.type)&&lower(ref.type)!==lower(param.type)?new Ref(async()=>coerce(await ref.get(),param.type),v=>ref.set(v),param.type):ref;
      }else cell=new Cell(param.bounds!==null?'Variant':declared,actual?.ref?await readScalar(actual.ref):actual);
      frame.locals.set(lower(param.name),cell);
    }
    this.stack.push(frame);this.currentFrame=frame;
    try {await this.execute(frame);return scalarReturn?frame.result.getScalar():frame.result.get();}
    finally{this.stack.pop();this.currentFrame=this.stack.at(-1)||null;if(!this.stack.length&&!this.debugEvaluation&&frame.proc.code.some(isSequencePoint))this.stepMode=null;if(!this.stack.length&&this.eventQueue.length)queueMicrotask(()=>this.processEvents());}
  }
  async checkpoint(ins,frame){
    if(this.state==='stopped')throw new StopExecution();
    if(this.debugEvaluation){await this.debugEvaluation.checkpoint();return;}
    this.instructionCount++;if(this.instructionCount>this.options.instructionLimit)throw new VBError(`Instruction budget exceeded (${this.options.instructionLimit.toLocaleString()}); execution stopped`,7);
    if(this.breakpoints.size||this.stepMode||this.runTarget||this.watchpoints.length||this.pauseRequested)await this.debugger.checkpoint(ins,frame);
    const now=performance.now();if(now-this.lastYield>=this.options.sliceMilliseconds){await new Promise(resolve=>setTimeout(resolve,0));this.lastYield=performance.now();if(this.state==='stopped')throw new StopExecution();}
  }
  applyEdits(project,{policy='strict'}={}){
    if(!['strict','versioned'].includes(policy))throw new VBError('Invalid live-edit policy',5);
    if(this.debugEvaluation)throw new VBError('Finish or cancel debugger evaluation before editing code',5);
    if(this.state!=='paused'&&!(this.state==='running'&&!this.stack.length))throw new VBError('Pause execution before applying code changes',5);
    const next=compileProject(project),plan=policy==='versioned'?planVersionedEdit(this.program,next,this.stack,this.codeRevision||0):planLiveEdit(this.program,next,this.stack),invalidated=[];
    // Procedure objects retain their identity: pending events, property references,
    // class instances and suspended caller frames all observe the committed code.
    for(const {oldProc,newProc}of plan.updates)Object.assign(oldProc,newProc);
    for(const {frame,...update}of plan.frameUpdates)Object.assign(frame,update);
    for(const {module,name}of plan.removedProcedures||[])module.procedures.delete(name);
    for(const frame of this.stack.slice(0,-1)){frame.activePc=frame.pc-1;frame.activeInstruction=frame.proc.code[frame.activePc];}
    for(const [key,module]of this.program.modules){const replacement=next.modules.get(key);for(const [name,proc]of replacement.procedures)if(!module.procedures.has(name))module.procedures.set(name,proc);module.source=replacement.source;}
    const breakpoints=[];for(const bp of this.breakpoints.values()){const mapped=plan.lineMap.get(lower(bp.module)+':'+bp.line);if(mapped===undefined)invalidated.push(bp);else breakpoints.push({...bp,line:mapped});}
    this.breakpoints=new Map(breakpoints.map(bp=>[lower(bp.module)+':'+bp.line,bp]));
    this.program.settings=next.settings;this.program.sourceProject=structuredClone(project);this.codeRevision=(this.codeRevision||0)+1;
    this.emit('breakpoints',breakpoints);
    if(this.state==='paused'){this.debugPauseId++;const frame=this.currentFrame,ins=frame.proc.code[frame.pc];frame.lastLine=ins?.line??null;frame.lastPc=frame.pc;this.emit('pause',{instruction:ins,frame,stack:[...this.stack],reason:'code-edit',pauseId:this.debugPauseId});}
    const result={revision:this.codeRevision,breakpoints,invalidatedBreakpoints:invalidated,updatedProcedures:plan.updates.length,retainedFrames:plan.retainedFrames||[]};
    this.emit('codeChanged',result);return result;
  }
  setNextStatement(module,line,column=null){
    if(this.debugEvaluation)throw new VBError('Finish or cancel debugger evaluation before moving execution',5);
    const frame=this.currentFrame;if(this.state!=='paused'||!frame)throw new VBError('Set Next Statement is available only in break mode',5);
    if(frame.pinnedSource!==undefined)throw new VBError('This invocation is executing a retained source revision; step it or let it return before redirecting from edited source',5);
    if(lower(module)!==lower(frame.module.name))throw new VBError('The next statement must remain in the active procedure',5);
    frame.pc=nextStatementIndex(frame,Number(line),column);frame.debugRedirect=true;frame.lastPc=frame.pc;frame.lastLine=frame.proc.code[frame.pc].line;
    this.debugPauseId++;this.emit('pause',{instruction:frame.proc.code[frame.pc],frame,stack:[...this.stack],reason:'set-next',pauseId:this.debugPauseId});
    return {source:frame.module.name,line:frame.lastLine,procedure:frame.proc.name};
  }
  pause(){if(this.state==='running')this.pauseRequested=true;}
  resume(mode='continue'){if(!['continue','into','over','out'].includes(mode))throw new VBError('Invalid stepping mode',5);if(this.debugEvaluation)throw new VBError('Finish or cancel debugger evaluation before continuing',5);if(this.state!=='paused')return;this.stepMode=mode==='continue'?null:{mode,depth:this.currentFrame?.depth||0};this.setState('running');this.pauseResolver?.();}
  stop(){this.win32.dispose();this.debugEvaluation?.cancel();this.setState('stopped');if(!this.debugEvaluation)this.pauseResolver?.();for(const event of this.eventQueue)event.resolve?.();this.eventQueue=[];this.runTarget=null;this.stepMode=null;this.pauseRequested=false;this.automationClose=this.automation?.close();this.dataClose=this.data?.close();try{this.fs.close();}catch{}this.host.stop?.();this.emit('stop');}
  async execute(frame){
    while(frame.pc<frame.proc.code.length){if(frame.proc.code[frame.pc].op==='lineNumber'){frame.erl=frame.proc.code[frame.pc++].number;continue;}await this.checkpoint(frame.proc.code[frame.pc],frame);const current=frame.pc,ins=frame.proc.code[current];if(!ins)return;frame.activePc=current;frame.activeInstruction=ins;frame.pc++;
      try{
        switch(ins.op){
          case 'dim':for(const decl of ins.decls)await this.declare(decl,frame,frame.locals,ins.static||frame.proc.static);break;
          case 'assign':{const ref=await this.reference(ins.target,frame,ins.objectSet);const value=await this.evaluateScalar(ins.expr,frame);if(ref.isArray&&(await ref.get()) instanceof VBArray&&!(await ref.get()).dynamic)throw new VBError('Cannot assign to a fixed-size array',10);await ref.set(ins.objectSet?value:await this.defaultValue(value));break;}
          case 'expr':await this.evaluateScalar(ins.expr,frame);break;
          case 'print':{const values=[];for(const e of ins.exprs){const v=await this.defaultValue(await this.evaluateScalar(e,frame));values.push(printScalar(v));}this.output(values.join(' '),ins.newline);break;}
          case 'assert':if(this.options.debugStatements!==false&&!truth(await this.evaluateScalar(ins.expr,frame))){this.output('Assertion failed: '+ins.source+':'+ins.line);await this.debugger.breakAfter(ins,frame,'assert');}break;
          case 'branch':{const test=truth(await this.evaluateScalar(ins.test,frame));if(ins.invert?test:!test)frame.pc=ins.target;break;}
          case 'jump':frame.pc=ins.target;break;
          case 'computedJump':{
            const index=coerce(await this.defaultValue(await this.evaluateScalar(ins.expr,frame)),'Long');
            if(index<0||index>255)throw new VBError('Invalid procedure call or argument',5);
            if(index>0&&index<=ins.targets.length){if(ins.gosub)frame.gosubStack.push(frame.pc);frame.pc=ins.targets[index-1];}break;
          }
          case 'raiseError':{const number=coerce(await this.defaultValue(await this.evaluateScalar(ins.expr,frame)),'Long');if(number<1||number>65535)throw new VBError('Invalid procedure call or argument',5);throw new VBError(errorDescription(number),number);}

          case 'temp':frame.temps.set(ins.id,await this.evaluateScalar(ins.expr,frame));break;
          case 'case':{const value=frame.temps.get(ins.id);let matched=false;for(const c of ins.cases){if(c.kind==='range')matched=truth(binary('>=',value,await this.evaluateScalar(c.low,frame),frame.module.optionCompare))&&truth(binary('<=',value,await this.evaluateScalar(c.high,frame),frame.module.optionCompare));else matched=truth(binary(c.op||'=',value,await this.evaluateScalar(c.expr,frame),frame.module.optionCompare));if(matched)break;}if(!matched)frame.pc=ins.target;break;}
          case 'forInit':{
            const ref=await this.reference(parseExpression(ins.name),frame),start=await this.evaluateScalar(ins.start,frame),end=await this.evaluateScalar(ins.end,frame),step=await this.evaluateScalar(ins.step,frame);
            numeric(start);numeric(end);const direction=numeric(step)>=0;
            await ref.set(start);frame.temps.set(ins.id,{ref,end,step,direction});
            if(truth(binary(direction?'>':'<',await readScalar(ref),end,frame.module.optionCompare)))frame.pc=ins.target;break;
          }
          case 'forNext':{
            const data=frame.temps.get(ins.id);if(!data)throw new VBError('For loop not initialized',92);
            await data.ref.set(binary('+',await readScalar(data.ref),data.step,frame.module.optionCompare));
            if(truth(binary(data.direction?'<=':'>=',await readScalar(data.ref),data.end,frame.module.optionCompare)))frame.pc=ins.target;break;
          }
          case 'eachInit':{let value=await this.evaluateScalar(ins.expr,frame);if(isAutomationObject(value))value=await this.debugAwait(automationEnumerate(value));if(!value?.[Symbol.iterator])throw new VBError('Object is not a collection',451);const iterator=value.scalarIterator?value.scalarIterator():value[Symbol.iterator](),ref=await this.reference(parseExpression(ins.name),frame);frame.temps.set(ins.id,{iterator,ref});const next=iterator.next();if(next.done)frame.pc=ins.target;else await ref.set(next.value);break;}
          case 'eachNext':{const data=frame.temps.get(ins.id),next=data.iterator.next();if(!next.done){await data.ref.set(next.value);frame.pc=ins.target;}break;}
          case 'stringAlign':{
            const ref=await this.reference(ins.target,frame,true),current=await ref.get();
            if(typeof current!=='string')throw new VBError('String assignment requires a String variable',13);
            const source=vbString(await this.evaluateScalar(ins.expr,frame)).slice(0,current.length);
            await ref.set(ins.right?source.padStart(current.length,' '):source.padEnd(current.length,' '));break;
          }
          case 'stringMid':{
            const ref=await this.reference(ins.target,frame,true),current=await ref.get();
            if(typeof current!=='string')throw new VBError('Mid requires a String variable',13);
            const start=coerce(await this.evaluateScalar(ins.start,frame),'Long'),length=ins.length?coerce(await this.evaluateScalar(ins.length,frame),'Long'):current.length;
            if(start<1||length<0)throw new VBError('Invalid procedure call',5);
            const source=vbString(await this.evaluateScalar(ins.expr,frame)),count=Math.max(0,Math.min(length,source.length,current.length-start+1));
            if(count)await ref.set(current.slice(0,start-1)+source.slice(0,count)+current.slice(start-1+count));break;
          }
          case 'redim':for(const decl of ins.decls){let ref;try{ref=await this.reference({kind:'id',name:decl.name},frame,true);}catch(e){if(e.number===500){frame.locals.set(lower(decl.name),new Cell());ref=frame.locals.get(lower(decl.name));}else throw e;}const bounds=await this.evalBounds(decl.bounds,frame),value=await ref.get();if(value instanceof VBArray)value.redim(bounds,ins.preserve);else{const a=await this.createArray(bounds,decl.storageType||decl.type,frame,decl.fixedLength);a.dynamic=true;await ref.set(a);}}break;
          case 'erase':for(const expr of ins.exprs){const value=await this.evaluateScalar(expr,frame);if(!(value instanceof VBArray))throw new VBError('Expected array',13);value.erase();}break;
          case 'withPush':frame.withStack.push(await this.evaluateScalar(ins.expr,frame,{raw:true}));break;
          case 'withPop':frame.withStack.pop();break;
          case 'withUnwind':frame.withStack.splice(-ins.count);break;
          case 'onError':frame.errorMode=ins.mode;frame.errorTarget=ins.target;frame.errorActive=false;frame.errorPc=null;break;
          case 'resume':if(frame.errorPc===null)throw new VBError('Resume without error',20);frame.pc=ins.mode==='retry'?frame.errorPc:ins.mode==='next'?frame.errorPc+1:ins.target;frame.errorActive=false;frame.errorPc=null;this.err.Clear();break;
          case 'gosub':frame.gosubStack.push(frame.pc);frame.pc=ins.target;break;
          case 'gosubReturn':if(!frame.gosubStack.length)throw new VBError('Return without GoSub',3);frame.pc=frame.gosubStack.pop();break;
          case 'return':if(frame.errorActive)this.err.Clear();return;
          case 'stop':if(this.options.debugStatements===false){this.stop();throw new StopExecution();}await this.debugger.breakAfter(ins,frame,'stop');break;
          case 'end':this.stop();throw new StopExecution();
          case 'form':{if(ins.expr.kind==='call'){const array=await this.evaluateScalar(ins.expr.callee,frame,{raw:true});if(array?.__type==='ControlArray'){if(ins.expr.args.length!==1)throw new VBError('Control arrays require one index',450);const index=await this.evaluateScalar(ins.expr.args[0],frame);if(ins.action==='load')array.Load(index);else array.Unload(index);break;}}const object=await this.evaluateScalar(ins.expr,frame,{raw:true});if(ins.action==='unload')await this.unloadForm(object);else await this.loadForm(object);break;}
          case 'fileOpen':this.fs.open(await this.evaluateScalar(ins.path,frame),ins.mode,await this.evaluateScalar(ins.handle,frame),ins.recordLength?await this.evaluateScalar(ins.recordLength,frame):128,ins.access,ins.sharing);break;
          case 'fileRecord':{const n=await this.evaluateScalar(ins.handle,frame),position=ins.position?await this.evaluateScalar(ins.position,frame):undefined,ref=await this.reference(ins.target,frame,true),value=await readScalar(ref),mode=this.fs.handle(n).mode;if(ins.action==='put')this.fs.put(n,position,encodeVariable(value,ref,mode));else{const result=this.fs.get(n,position,bytes=>{const decoded=decodeVariable(bytes,ref,unbox(value),mode);return {...decoded,value:decoded.scalar};});await ref.set(result);}break;}
          case 'fileSeek':this.fs.seek(await this.evaluateScalar(ins.handle,frame),await this.evaluateScalar(ins.position,frame));break;
          case 'fileLock':this.fs.lock(await this.evaluateScalar(ins.handle,frame),ins.start?await this.evaluateScalar(ins.start,frame):undefined,ins.end?await this.evaluateScalar(ins.end,frame):undefined,ins.unlock);break;
          case 'fileCopy':this.fs.copy(await this.evaluateScalar(ins.sourcePath,frame),await this.evaluateScalar(ins.destination,frame));break;
          case 'fileRename':this.fs.rename(await this.evaluateScalar(ins.sourcePath,frame),await this.evaluateScalar(ins.destination,frame));break;
          case 'fileClose':if(!ins.handles.length)this.fs.close();else for(const h of ins.handles)this.fs.close(await this.evaluateScalar(h,frame));break;
          case 'filePrint':{const values=[];for(const e of ins.exprs)values.push(await this.defaultValue(await this.evaluateScalar(e,frame)));const text=values.map(v=>printScalar(v,ins.csv)).join(ins.csv?',':'');this.fs.print(await this.evaluateScalar(ins.handle,frame),text,ins.newline);break;}
          case 'fileInput':{const n=unbox(await this.evaluateScalar(ins.handle,frame));for(const target of ins.targets){const ref=await this.reference(target,frame,true);const value=ins.whole?this.fs.lineInput(n):this.fs.inputValue(n,ref.type);await ref.set(value);}break;}
          case 'graphics':{const obj=await this.evaluateScalar(ins.object,frame,{raw:true}),control=obj?.__vbInstance?obj.formObject:obj;if(!control?.draw)throw new VBError('Object does not support graphics methods',438);const coords=[];for(const e of ins.coords)coords.push(numeric(await this.evaluateScalar(e,frame)));control.draw(ins.kind,coords,numeric(await this.evaluateScalar(ins.color,frame)),ins.fill);break;}
          case 'raiseEvent':await this.raiseEvent(frame.instance,ins.expr.callee.name,ins.expr.args,frame);break;
          default:throw new VBError('Invalid bytecode instruction '+ins.op,1002);
        }
      }catch(error){
        if(error instanceof StopExecution||error.debugEvaluationAbort)throw error;
        if(!(error instanceof VBError))error=new VBError(error.message||String(error),Number.isInteger(error.number)?error.number:5);
        error.source ||= ins.source;error.line ||= ins.line;if(error.erl===undefined)error.erl=frame.erl;this.lastErrorErl=error.erl;this.err.Number=error.number;this.err.Description=error.message;this.err.Source=error.source;this.err.HelpFile=error.helpFile||'';this.err.HelpContext=error.helpContext||0;this.lastError=error;
        const debugResult=await this.debugger.error(error,frame,current,ins);if(debugResult===true)continue;
        const failedPc=typeof debugResult==='number'?debugResult:current;
        if(!frame.errorActive&&frame.errorMode!=='off'){frame.errorPc=failedPc;if(frame.errorMode==='goto'){frame.errorActive=true;frame.pc=frame.errorTarget;}else frame.pc=failedPc+1;}
        else throw error;
      }
    }
  }
  parseCSV(text){const values=[];let quoted=false,s='',wasString=false;for(let i=0;i<text.length;i++){const c=text[i];if(c==='"'){wasString=true;if(quoted&&text[i+1]==='"'){s+='"';i++;}else quoted=!quoted;}else if(c===','&&!quoted){values.push(wasString?s:Number(s));s='';wasString=false;}else s+=c;}values.push(wasString?s:Number(s));return values;}
  reportError(error){if(error instanceof StopExecution)return;this.lastError=error;this.emit('error',{message:error.message,number:error.number||5,source:error.source,line:error.line});this.host.error?.(error);this.setState('error');}
  // Trusted host input uses the normal interpreter queue, including debugger
  // stepping and DoEvents. Pending mouse motion is latest-value, per target and
  // actual instance; timers retain their existing dispatch/coalescing contract.
  enqueueInput(instance,key,action,{coalesce=false,valid=()=>true}={}){
    if(!['running','idle'].includes(this.state)||!valid())return Promise.resolve();
    const epoch=this.inputEpoch||0,guarded=()=>epoch===(this.inputEpoch||0)&&['running','idle'].includes(this.state)&&valid()?action():undefined;
    // Never move later pointer state ahead of a key/button/timer boundary.
    let existing;
    if(coalesce)for(let i=this.eventQueue.length-1;i>=0;i--){const pending=this.eventQueue[i];if(!pending.input||!pending.coalesce)break;if(pending.instance===instance&&pending.key===key){existing=pending;break;}}
    if(existing){existing.action=guarded;return existing.promise;}
    if(this.eventQueue.length>=1000){this.output('Event queue limit reached; newest input discarded.');return Promise.resolve();}
    const event={input:true,coalesce,instance,key,action:guarded};event.promise=new Promise(resolve=>event.resolve=resolve);
    this.eventQueue.push(event);this.processEvents();return event.promise;
  }
  dispatch(module,name,args=[],{coalesce=false}={}){
    if(this.state==='stopped'||this.state==='error'||(this.immediateContext&&!this.immediateEvents))return Promise.resolve();const instance=typeof module==='string'?this.instances.get(lower(module)):module;const proc=instance?.module.procedures.get(lower(name));if(!proc)return Promise.resolve();const key=lower(instance.module.name)+'.'+lower(name);
    if(coalesce&&this.eventQueue.some(e=>e.key===key))return Promise.resolve();if(this.eventQueue.length>=1000){this.output('Event queue limit reached; newest event discarded.');return Promise.resolve();}
    return new Promise((resolve,reject)=>{this.eventQueue.push({instance,proc,args,key,resolve,reject});this.processEvents();});
  }
  async runQueuedEvent(event){try{event.resolve(await(event.action?event.action():this.callProcedure(event.instance,event.proc,event.args)));}catch(error){if(!(error instanceof StopExecution))this.reportError(error);event.resolve(undefined);}}
  async processEvents(){if(this.processing||this.stack.length||this.state==='paused'||this.debugEvaluation||(this.immediateContext&&!this.immediateEvents))return;this.processing=true;try{while(this.eventQueue.length&&this.state!=='stopped'&&this.state!=='error'&&this.state!=='paused')await this.runQueuedEvent(this.eventQueue.shift());}finally{this.processing=false;}}
  async immediate(text,options={}){
    if(this.state==='paused')return this.evaluateExplicit(text,{...options,immediate:true});
    if(!['ready','idle','running'].includes(this.state)||this.stack.length)throw new VBError('Pause execution before using the Immediate window',5);
    if(!this.instances.size)throw new VBError('Start or prepare the runtime before evaluating an expression',5);
    return this.evaluateExplicit(text,{...options,immediate:true,allowIdle:true});
  }
  async immediateAt(text,selectedFrame=null){
    const instance=this.instances.values().next().value,frame=selectedFrame||this.currentFrame||(instance&&this.makeFrame(instance));
    if(!frame?.instance)throw new VBError('Start the runtime before evaluating an expression',5);
    if(this.state==='running'&&this.stack.length&&!selectedFrame)throw new VBError('Pause execution before using the Immediate window',5);
    text=String(text);if(text.length>65536)throw new VBError('Enter at most 65,536 characters',5);
    let value;
    for(let statement of immediateStatements(text)){
      this.debugEvaluation?.check();statement=statement.trim();if(!statement)continue;
      if(/^\?/.test(statement)||/^(?:Debug\.)?Print\b/i.test(statement)){
        const expression=statement.replace(/^(?:\?|(?:Debug\.)?Print\s*)/i,'');
        value=await this.evaluateScalar(parseExpression(expression),frame);this.output(describe(value));continue;
      }
      const objectSet=/^Set\s/i.test(statement),source=statement.replace(/^(?:Let|Set)\s+/i,'');
      let depth=0,equal=null;for(const token of tokenize(source)){if(token.value==='(')depth++;else if(token.value===')')depth--;else if(token.value==='='&&depth===0){equal=token;break;}}
      if(equal){
        const target=parseExpression(source.slice(0,equal.start));if(!['id','member','call'].includes(target.kind))throw new VBError('Invalid assignment target',1002);
        const ref=await this.reference(target,frame,objectSet);
        value=await this.evaluateScalar(parseExpression(source.slice(equal.end)),frame);
        if(ref.isArray&&(await ref.get()) instanceof VBArray&&!(await ref.get()).dynamic)throw new VBError('Cannot assign to a fixed-size array',10);
        await ref.set(objectSet?value:await this.defaultValue(value));
      }else{
        value=await this.evaluateScalar(parseCall(statement.replace(/^Call\s+/i,''),{explicit:/^Call\s+/i.test(statement)}),frame);
        // A tagged Empty result is still a void command. Explicit ?/Print above
        // displays Empty; an ordinary Sub/host call must not add a phantom line.
        if(unbox(value)!==undefined)this.output(describe(value));
      }
    }
    return value;
  }
  debugAwait(value){return this.debugEvaluation?this.debugEvaluation.wait(value):value;}
  cancelEvaluation(){this.debugEvaluation?.cancel();return {cancelled:!!this.debugEvaluation};}
  async evaluateExplicit(text,{frameIndex=null,pauseId,instructionLimit=100000,timeLimit=5000,immediate=false,allowIdle=false,module=null}={}){
    if(this.state!=='paused'&&!(allowIdle&&immediate&&!this.stack.length&&['ready','idle','running'].includes(this.state)))throw new VBError('Explicit debugger evaluation requires break mode',5);
    if(this.debugEvaluation)throw new VBError('Another debugger evaluation is in progress',5);
    if(pauseId!==undefined&&pauseId!==this.debugPauseId)throw new VBError('The debugger context changed; refresh before evaluating',5);
    text=String(text);if(!text.trim()||text.length>65536)throw new VBError('Enter an expression of at most 65,536 characters',5);
    let frame=this.debugInspector.frame(frameIndex);
    if(this.state!=='paused'&&module!==null){const instance=this.instances.get(lower(module));if(!instance)throw new VBError('No initialized module context: '+module,5);frame=this.makeFrame(instance);}
    if(!frame)throw new VBError('No selected stack frame',5);
    if(this.state!=='paused'){this.immediateFrames ||= new WeakMap();const instance=frame.instance;if(!this.immediateFrames.has(instance))this.immediateFrames.set(instance,frame);frame=this.immediateFrames.get(instance);}
    const session=new DebugEvaluationSession(this,{instructionLimit,timeLimit}),saved={frame:this.currentFrame,err:{...this.err},lastError:this.lastError,erl:this.lastErrorErl,step:this.stepMode,pauseRequested:this.pauseRequested,runTarget:this.runTarget};
    this.debugEvaluation=session;this.currentFrame=frame;this.emit('evaluation',{active:true,frameIndex:this.stack.indexOf(frame)});
    try {const value=immediate?await this.immediateAt(text,frame):await this.evaluateScalar(parseExpression(text.replace(/^\s*\?/,'')),frame);session.check();return unbox(value);}
    finally {session.dispose();this.debugEvaluation=null;this.currentFrame=saved.frame;if(this.state==='stopped')this.pauseResolver?.();Object.assign(this.err,saved.err);this.lastError=saved.lastError;this.lastErrorErl=saved.erl;this.stepMode=saved.step;this.pauseRequested=saved.pauseRequested;this.runTarget=saved.runTarget;this.emit('evaluation',{active:false,instructions:session.instructions,milliseconds:performance.now()-session.started});if(this.eventQueue.length&&!this.stack.length&&this.state!=='paused')queueMicrotask(()=>this.processEvents());}
  }
  async evaluateWatch(text,options={}){return this.debugInspector.evaluate(text,options.frameIndex??null);}
  inspectDebug(expression,options={}){return this.debugInspector.inspect(expression,options);}
  debugLocals(options={}){return this.debugInspector.locals(options);}
  assignDebug(expression,text,options={}){return this.debugInspector.assign(expression,text,options);}
  setWatchpoints(watches=[]){if(!Array.isArray(watches)||watches.length>100)throw new VBError('At most 100 break watches are supported',5);const next=watches.map((w,i)=>{if(!['true','change'].includes(w.mode))throw new VBError('Invalid watch type',5);return {id:String(w.id??i),expression:String(w.expression),mode:w.mode,module:String(w.module||''),procedure:String(w.procedure||''),node:this.debugInspector.parse(w.expression)};});this.watchpoints=next;this.watchpointValues.clear();}
  watchSnapshot(value){return value instanceof VBDecimal?{decimal:value}:value instanceof VBCurrency?{currency:value.raw}:value instanceof Date?{date:value.getTime()}:value instanceof VBErrorValue?{error:value.number}:value;}
  sameWatchValue(before,after){if(before&&typeof before==='object'){if(Object.hasOwn(before,'decimal'))return after instanceof VBDecimal&&before.decimal.compare(after)===0;if(Object.hasOwn(before,'currency'))return after instanceof VBCurrency&&before.currency===after.raw;if(Object.hasOwn(before,'date'))return after instanceof Date&&before.date===after.getTime();if(Object.hasOwn(before,'error'))return after instanceof VBErrorValue&&before.error===after.number;}return Object.is(before,after);}
  runToCursor(module,line,column=null){if(this.state!=='paused')throw new VBError('Run to Cursor requires break mode',5);const target=this.breakpointLocation(module,line,column);this.runTarget=target;this.resume('continue');return target;}
  locals(){return this.debugInspector.locals({includeFields:false}).map(({name,type,value})=>({name,type,value}));}
  saveSetting(app,section,key,value){const k=[app,section,key].join('/');this.settings[k]=String(value);this.host.persist?.();}
  getSetting(app,section,key,def=''){return this.settings[[app,section,key].join('/')]??def;}
  deleteSetting(app,section,key){const prefix=[app,section].join('/')+'/';for(const k of Object.keys(this.settings))if(key===undefined?k.startsWith(prefix):k===prefix+key)delete this.settings[k];this.host.persist?.();}
}
