import {VBError,tokenize} from '../language/lexer.js';
import {lower} from '../core/core.js';
import {truth} from './values.js';

/** Reset/cancellation is not a trappable VB run-time error. */
export class StopExecution extends Error {}
const MODES=new Set(['all','class','unhandled']);
export const isSequencePoint=instruction=>!!instruction&&!instruction.implicit&&instruction.sequencePoint!==false;

/** Select one executable statement, optionally within a colon-separated line. */
export function statementIndex(code,line,column=null){
  const candidates=code.map((ins,index)=>({ins,index})).filter(({ins})=>ins.line===line&&isSequencePoint(ins));
  if(!candidates.length)return -1;
  if(column===null||column===undefined)return candidates[0].index;
  if(!Number.isInteger(column)||column<1)throw new VBError('Invalid source column',5);
  return (candidates.find(({ins})=>ins.column<=column&&column<ins.endColumn)||candidates.find(({ins})=>ins.column>=column)||candidates.at(-1)).index;
}

/** Source-level execution control, shared by IDE, embedders and agent commands.
 * Automatic inspection never invokes user procedures. Error breaks are opt-in
 * for headless hosts, so shipping an application cannot leave it suspended with
 * no debugger available to resume it.
 */
export class RuntimeDebugger {
  constructor(vm){this.vm=vm;this.presentedErrors=new WeakSet();this.nextFrameId=1;this.pendingError=null;}
  configure({enabled=this.vm.options.debuggerEnabled,errorTrapping=this.vm.options.errorTrapping||'unhandled'}={}){
    if(typeof enabled!=='boolean'||!MODES.has(errorTrapping))throw new VBError('Invalid debugger error-trapping options',5);
    this.vm.options.debuggerEnabled=enabled;this.vm.options.errorTrapping=errorTrapping;
    return {enabled,errorTrapping};
  }
  location(frame,top=frame===this.vm.currentFrame){
    const instruction=top?frame.proc.code[frame.pc]:frame.activeInstruction;
    return instruction||frame.activeInstruction||frame.proc.code.at(-1)||{source:frame.module.name,procedure:frame.proc.name,line:frame.proc.line};
  }
  stack(){return this.vm.stack.map((frame,index)=>{const ins=this.location(frame,index===this.vm.stack.length-1);return {index,id:frame.debugId,module:frame.module.name,procedure:frame.proc.name,line:ins.line,column:ins.column,endColumn:ins.endColumn,depth:frame.depth,...(frame.pinnedSource===undefined?{}:{sourceText:frame.pinnedSource,revision:frame.pinnedRevision,retained:true})};});}
  async suspend(instruction,frame,reason,details={}){
    const vm=this.vm;
    if(vm.debugEvaluation)return;
    if(vm.state==='stopped')throw new StopExecution();
    vm.pauseRequested=false;vm.stepMode=null;vm.runTarget=null;
    vm.debugPauseId++;vm.pauseReason=reason;vm.currentFrame=frame;
    // Install the resolver before notifying synchronous pause listeners.
    const suspended=new Promise(resolve=>vm.pauseResolver=resolve);
    vm.setState('paused');
    vm.emit('pause',{instruction,frame,stack:[...vm.stack],reason,pauseId:vm.debugPauseId,...details});
    await suspended;vm.pauseResolver=null;
    if(vm.state==='stopped')throw new StopExecution();
  }
  async checkpoint(ins,frame){
    const visible=isSequencePoint(ins);if(!visible&&!(ins?.op==='return'&&ins.implicit))return;
    const vm=this.vm,lineChanged=frame.lastLine!==ins.line||frame.pc<=frame.lastPc;
    const bp=frame.pinnedSource===undefined?vm.breakpoints.get(lower(ins.source)+':'+ins.line):null;
    let reason=null,details={};
    if(visible&&lineChanged&&bp&&bp.enabled!==false){
      try{if(!bp.condition||truth(vm.debugInspector.node(vm.debugInspector.parse(bp.condition),frame,{count:0},0)))reason='breakpoint';}
      catch(error){reason='breakpoint-condition';details.conditionError=error.message;}
    }
    if(visible&&vm.stepMode&&(vm.stepMode.mode==='into'||vm.stepMode.mode==='over'&&frame.depth<=vm.stepMode.depth||vm.stepMode.mode==='out'&&frame.depth<vm.stepMode.depth))reason ||= 'step';
    if(visible&&frame.pinnedSource===undefined&&vm.runTarget&&lower(ins.source)===lower(vm.runTarget.module)&&ins.line===vm.runTarget.line&&(!vm.runTarget.column||ins.column===vm.runTarget.column))reason ||= 'run-to-cursor';
    for(const watch of vm.watchpoints){
      // Procedure watches observe each live invocation, including a suspended
      // caller modified ByRef by a callee. Module watches retain one baseline
      // per instance instead of losing it whenever a procedure returns.
      const frames=watch.module||watch.procedure?vm.stack.filter(f=>(!watch.module||lower(f.module.name)===lower(watch.module))&&(!watch.procedure||lower(f.proc.name)===lower(watch.procedure))):[frame];
      if(watch.module&&!watch.procedure&&!frames.length){const instance=vm.instances.get(lower(watch.module));if(instance)frames.push(vm.makeFrame(instance));}
      const observed=new Set();
      for(const scope of [...frames].reverse()){
        const owner=watch.procedure?scope:watch.module?scope.instance:scope;
        if(observed.has(owner))continue;observed.add(owner);
        let values=vm.watchpointValues.get(watch.id);if(!values)vm.watchpointValues.set(watch.id,values=new WeakMap());
        try{
          const context=watch.module&&!watch.procedure?vm.makeFrame(scope.instance):scope;
          const value=vm.debugInspector.node(watch.node,context,{count:0},0),prior=values.get(owner);
          if(watch.mode==='true'?truth(value)&&(visible||!prior||!vm.sameWatchValue(prior.value,value)):prior!==undefined&&!vm.sameWatchValue(prior.value,value)){reason ||= 'watch:'+watch.expression;details.watch={id:watch.id,expression:watch.expression,frameIndex:vm.stack.indexOf(scope)};}
          values.set(owner,{value:vm.watchSnapshot(value)});
        }catch{/* Out of scope, uninitialized and effectful expressions are not executed. */}
      }
    }
    if(visible&&vm.pauseRequested)reason ||= 'break';
    if(visible){frame.lastLine=ins.line;frame.lastPc=frame.pc;}
    if(reason)await this.suspend(ins,frame,reason,details);
  }
  async breakAfter(ins,frame,reason){
    const vm=this.vm;if(vm.debugEvaluation)return;
    frame.pc=frame.activePc;frame.debugRedirect=false;
    try{await this.suspend(ins,frame,reason);}finally{
      // A debugger jump is intentional; otherwise Stop/Assert has already run.
      if(!frame.debugRedirect)frame.pc++;
    }
  }
  async error(error,frame,current,ins){
    const vm=this.vm;
    if(!vm.options.debuggerEnabled||vm.debugEvaluation||this.presentedErrors.has(error))return false;
    const localHandler=!frame.errorActive&&frame.errorMode!=='off';
    const handled=vm.stack.some(f=>!f.errorActive&&f.errorMode!=='off');
    const mode=vm.options.errorTrapping||'unhandled',isClass=frame.module.kind!=='module';
    const pause=mode==='all'||mode==='class'&&(isClass&&!localHandler||!handled)||mode==='unhandled'&&!handled&&(!isClass||vm.stack.length===1);
    if(!pause)return false;
    this.presentedErrors.add(error);
    const pending={error,frame,action:handled?'handler':'retry'};this.pendingError=pending;
    frame.pc=current;frame.debugRedirect=false;
    try{
      await this.suspend(ins,frame,'error',{error:{number:error.number,message:error.message,source:error.source,line:error.line,erl:error.erl,handled,trapping:mode}});
      if(frame.debugRedirect||pending.action==='next'){if(!frame.debugRedirect)frame.pc++;vm.err.Clear();return true;}
      if(pending.action==='retry'){this.presentedErrors.delete(error);vm.err.Clear();return true;}
      return frame.pc++;
    }finally{this.pendingError=null;}
  }
  resumeError(action='retry'){
    if(!['retry','next','handler'].includes(action))throw new VBError('Invalid debugger error action',5);
    if(!this.pendingError||this.vm.state!=='paused')throw new VBError('The debugger is not paused on a run-time error',5);
    if(this.vm.debugEvaluation)throw new VBError('Finish or cancel debugger evaluation before continuing',5);
    this.pendingError.action=action;this.vm.resume();
    return {action};
  }
}

/** Token offsets distinguish statement separators from strings, dates, named
 * arguments, type suffixes and comments. Comments consume only their own line. */
export function immediateStatements(text){
  const statements=[];
  for(const line of String(text).replace(/\r\n?/g,'\n').split('\n')){
    let start=0,depth=0;
    for(const token of tokenize(line.replace(/\?/g,' '))){
      if(token.type==='op'&&token.value==='(')depth++;
      else if(token.type==='op'&&token.value===')')depth--;
      if(token.type==='eof'||token.type==='op'&&token.value===':'&&depth===0){
        const statement=line.slice(start,token.start).trim();
        // A Rem comment's EOF includes the scanned keyword; it is not a call.
        if(statement&&!/^Rem(?:\s|$)/i.test(statement))statements.push(statement);
        start=token.end;
      }
    }
  }
  return statements;
}
