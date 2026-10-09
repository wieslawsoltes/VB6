import {tokenize} from '../../language/lexer.js';
import {safeMarkdown} from './protocol-converters.js';

const lower=value=>String(value||'').toLowerCase();

/** Only source identifiers and explicit field paths are inspected implicitly.
 * Calls, indexing, With-relative paths and members of call results are left to
 * the existing explicit debugger tools. The VM's storage-only inspector is the
 * final authority: this never sends debugEvaluate or executes a property getter. */
export function debugExpression(line,column) {
  if(line.length>16384)return null;
  let tokens;try{tokens=tokenize(line);}catch{return null;}
  const offset=column-1,index=tokens.findIndex(t=>t.type==='id'&&t.start<=offset&&offset<t.end);
  if(index<0)return null;
  let first=index;
  while(first>=2&&tokens[first-1].value==='.'&&tokens[first-2].type==='id')first-=2;
  if(tokens[first-1]?.value==='.')return null;
  const selected=tokens.slice(first,index+1),expression=selected.map(t=>t.raw).join('');
  if(expression.length>256)return null;
  return {expression,startColumn:tokens[first].start+1,endColumn:tokens[index].end+1};
}

/** Frame-, source- and pause-specific automatic data tips. The existing lexer
 * and declaration index keep source scope consistent with the selected frame.
 * Pending inspection is bounded; cancellation discards display immediately. */
export class DebugHoverProvider {
  constructor(runtime){this.runtime=runtime;this.pending=new Set();}
  snapshot(model,position) {
    const runtime=this.runtime,ide=runtime.ide,workbench=ide.debuggerWindows;
    if(this.disposed||runtime.disposed||ide.runState!=='paused'||ide.evaluating||ide.pendingEdits||!ide.runtimeFrame||!workbench)return null;
    const record=runtime.records.get(model.uri.toString());
    if(record?.language!=='vb6'||record.model!==model||model.isDisposed())return null;
    const module=ide.project.modules.find(m=>m.id===record.moduleId),frameIndex=workbench.frameIndex??((ide.stack?.length||0)-1),frame=ide.stack?.[frameIndex];
    if(!module||!frame||frame.retained||lower(frame.module)!==lower(module.name))return null;
    const editor=record.legacy;if(!editor?.intelligence)return null;
    const index=editor.intelligence.index(module,ide.project),offset=model.getOffsetAt(position);
    const procedure=index.procedures.find(p=>p.offset<=offset&&offset<p.endOffset);
    if(!procedure||lower(procedure.name)!==lower(frame.procedure)||!index.masked.slice(offset,offset+1).trim())return null;
    return {record,model,version:model.getVersionId(),project:ide.project,workbench,frame,frameIndex,pauseId:workbench.pauseId,serial:workbench.refreshSerial,bridge:ide.bridgeToken,editRevision:ide.editRevision};
  }
  current(snapshot) {
    const runtime=this.runtime,ide=runtime.ide,w=ide.debuggerWindows,s=snapshot;
    return !this.disposed&&!runtime.disposed&&ide.runState==='paused'&&!ide.evaluating&&!ide.pendingEdits&&ide.project===s.project&&ide.bridgeToken===s.bridge&&
      ide.editRevision===s.editRevision&&w===s.workbench&&w.pauseId===s.pauseId&&w.refreshSerial===s.serial&&
      (w.frameIndex??((ide.stack?.length||0)-1))===s.frameIndex&&ide.stack?.[s.frameIndex]===s.frame&&
      runtime.records.get(s.record.uri)===s.record&&!s.model.isDisposed()&&s.model.getVersionId()===s.version;
  }
  async provideHover(model,position,token) {
    if(token?.isCancellationRequested||this.pending.size>=2)return null;
    const snapshot=this.snapshot(model,position);if(!snapshot)return null;
    const expression=debugExpression(model.getLineContent(position.lineNumber),position.column);if(!expression)return null;
    let subscription,finish;
    const cancelled=new Promise(resolve=>{finish=resolve;subscription=token?.onCancellationRequested?.(()=>resolve(null));});
    const marker={finish};this.pending.add(marker);
    const request=Promise.resolve().then(()=>{
      if(!this.current(snapshot)||token?.isCancellationRequested)return null;
      return snapshot.workbench.inspect(expression.expression);
    }).then(value=>{
      if(!value||!this.current(snapshot)||token?.isCancellationRequested)return null;
      const context=value.context;
      if(!context||context.pauseId!==snapshot.pauseId||context.frameIndex!==snapshot.frameIndex||lower(context.module)!==lower(snapshot.frame.module)||lower(context.procedure)!==lower(snapshot.frame.procedure))return null;
      const text=expression.expression+' = '+String(value.value).slice(0,4096)+'\n'+String(value.type||'Variant').slice(0,128)+' · '+context.module+'.'+context.procedure;
      return {range:{startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:expression.startColumn,endColumn:expression.endColumn},contents:[safeMarkdown({kind:'plaintext',value:text})]};
    }).catch(()=>null).finally(()=>{this.pending.delete(marker);subscription?.dispose();});
    if(token?.isCancellationRequested)finish(null);
    return Promise.race([request,cancelled]);
  }
  dispose(){this.disposed=true;for(const marker of this.pending)marker.finish(null);this.pending.clear();}
}
