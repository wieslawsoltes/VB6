import {VBError} from '../language/lexer.js';
import {uniqueInstructionLines} from './instruction-map.js';
import {planLiveEdit,validateStaticStorage} from './live-edit.js';

const json=value=>JSON.stringify(value,(_,v)=>v instanceof Map?[...v]:v);
const shape=m=>({kind:m.kind,interfaces:m.interfaces,defaultTypes:m.defaultTypes,defaultMember:m.defaultMember,declarations:m.declarations,types:m.types,events:m.events,enums:m.enums,form:m.form,optionExplicit:m.optionExplicit,optionBase:m.optionBase,optionCompare:m.optionCompare});
const execution=s=>{const {errorTrapping,...rest}=s||{};return rest;};
/** Prefer in-place Edit and Continue. If an active statement/control region or
 * signature cannot be migrated, retain its invocation's code revision and apply
 * the new procedure graph to future calls. Never invent a new PC, recreate a
 * ByRef cell, replay a completed expression, or unwind a suspended error handler.
 * Changing object/module storage is still a separate operation: versioning code
 * must not silently reset fields or invalidate already-exported native callbacks.
 */
export function planVersionedEdit(current,next,stack,revision=0){
  if(!stack.some(f=>f.pinnedSource!==undefined)){
    try{return planLiveEdit(current,next,stack);}catch(error){if(!(error instanceof VBError))throw error;}
  }
  if(!next.valid){const d=next.diagnostics[0];throw new VBError('Code changes were not applied: '+d.message,d.number,d.source,d.line);}
  if(json([...current.modules.keys()])!==json([...next.modules.keys()]))throw new VBError('Restart required: changing the module set also changes live storage',5);
  if(current.startup!==next.startup||json(execution(current.settings))!==json(execution(next.settings)))throw new VBError('Restart required: project execution settings changed',5);
  const updates=[],frameUpdates=[],lineMap=new Map(),removedProcedures=[],retainedFrames=[];
  // Finish every validation and snapshot before returning a commit plan.
  for(const [key,oldModule]of current.modules){
    const newModule=next.modules.get(key);
    validateStaticStorage(oldModule,newModule);
    if(json(shape(oldModule))!==json(shape(newModule)))throw new VBError('Restart required: live module/object storage changed in '+oldModule.name,5);
    for(const [name,oldProc]of oldModule.procedures){
      const newProc=newModule.procedures.get(name);
      if(!newProc){removedProcedures.push({module:oldModule,name});continue;}
      updates.push({oldProc,newProc});
      for(const [line,mapped]of uniqueInstructionLines(oldProc.code||[],newProc.code||[]))lineMap.set(key+':'+line,mapped);
    }
  }
  for(const frame of stack){
    const source=frame.pinnedSource??frame.module.source;
    const oldRevision=frame.pinnedRevision??revision;
    frameUpdates.push({frame,proc:{...frame.proc},pinnedSource:source,pinnedRevision:oldRevision});
    retainedFrames.push({id:frame.debugId,module:frame.module.name,procedure:frame.proc.name,revision:oldRevision});
  }
  return {updates,frameUpdates,lineMap,removedProcedures,retainedFrames};
}
