import {statementIndex} from './debug-control.js';
import {instructionMap,linearInstruction,instructionKey,uniqueInstructionLines} from './instruction-map.js';
import {VBError} from '../language/lexer.js';
const json=value=>JSON.stringify(value,(_,v)=>v instanceof Map?[...v]:v);
const executionSettings=settings=>{const {errorTrapping,...rest}=settings||{};return rest;};
const signature=p=>({name:p.name,kind:p.kind,scope:p.scope,accessor:p.accessor,static:p.static,params:p.params,returnType:p.returnType});
const moduleShape=m=>({kind:m.kind,interfaces:m.interfaces,defaultTypes:m.defaultTypes,defaultMember:m.defaultMember,declarations:m.declarations,types:m.types,events:m.events,enums:m.enums,form:m.form,optionExplicit:m.optionExplicit,optionBase:m.optionBase,optionCompare:m.optionCompare});
function instructionShape(ins){
  const {line,column,endColumn,source,procedure,sequencePoint,...rest}=ins;
  if(['assign','expr','print','assert','graphics','filePrint','fileInput','fileRecord','fileSeek','fileCopy','fileRename'].includes(ins.op))return {op:ins.op};
  if(ins.op==='dim')return {...rest,decls:rest.decls.map(({initial,...decl})=>decl)};
  return rest;
}
export function sameActiveLayout(a,b){return a.length===b.length&&a.every((ins,i)=>json(instructionShape(ins))===json(instructionShape(b[i])));}
/** Static locals outlive the procedure invocation. Ordinary stack versioning
 * cannot reinterpret their existing Cells, including those in inactive methods.
 * New slots are safe; removing or changing an existing storage layout is not.
 */
export function validateStaticStorage(oldModule,newModule){
  const declarations=proc=>{
    const slots=new Map();
    for(const ins of proc?.code||[])if(ins.op==='dim'&&(ins.static||proc.static))for(const declaration of ins.decls){
      const {initial,...layout}=declaration;
      slots.set(declaration.name.toLowerCase(),json(layout));
    }
    return slots;
  };
  for(const [name,oldProc]of oldModule.procedures){
    const before=declarations(oldProc),after=declarations(newModule.procedures.get(name));
    for(const [key,layout]of before)if(after.get(key)!==layout)throw new VBError('Restart required: static local storage changed: '+oldModule.name+'.'+oldProc.name+'.'+key,5);
  }
}
/** Validate the entire patch before touching any live object, frame or bytecode. */
export function planLiveEdit(current,next,stack){
  if(!next.valid){const d=next.diagnostics[0];throw new VBError('Code changes were not applied: '+d.message,d.number,d.source,d.line);}
  if(json([...current.modules.keys()])!==json([...next.modules.keys()]))throw new VBError('Restart required: modules cannot be added, removed, or reordered while running',5);
  if(current.startup!==next.startup||json(executionSettings(current.settings))!==json(executionSettings(next.settings)))throw new VBError('Restart required: project execution settings changed',5);
  const updates=[],lineMap=new Map(),frameUpdates=[],active=new Set(stack.map(f=>f.proc));
  for(const [key,oldModule]of current.modules){
    const newModule=next.modules.get(key);
    validateStaticStorage(oldModule,newModule);
    if(json(moduleShape(oldModule))!==json(moduleShape(newModule)))throw new VBError('Restart required: module declarations, types, events, forms, or options changed in '+oldModule.name,5);
    for(const [name,oldProc]of oldModule.procedures){
      const newProc=newModule.procedures.get(name);
      if(newProc&&json(oldProc.constantBindings)!==json(newProc.constantBindings))throw new VBError('Restart required: local constant values changed: '+oldModule.name+'.'+oldProc.name,5);
      if(!newProc||json(signature(oldProc))!==json(signature(newProc)))throw new VBError('Restart required: procedure signature changed or removed: '+oldModule.name+'.'+oldProc.name,5);
      const same=sameActiveLayout(oldProc.code,newProc.code);
      if(active.has(oldProc)&&!same){
        if(!oldProc.code.every(linearInstruction)||!newProc.code.every(linearInstruction)||json(oldProc.code.filter(i=>i.op==='dim').map(instructionShape))!==json(newProc.code.filter(i=>i.op==='dim').map(instructionShape)))throw new VBError('Restart required: active procedure control flow or local declarations changed: '+oldModule.name+'.'+oldProc.name,5);
        const mapping=instructionMap(oldProc.code,newProc.code,ins=>json(instructionShape(ins)));
        for(const frame of stack.filter(f=>f.proc===oldProc)){
          const top=frame===stack.at(-1);let pc=mapping.get(frame.pc);
          if(!top){const prior=frame.pc-1,mapped=mapping.get(prior);if(mapped===undefined||instructionKey(oldProc.code[prior])!==instructionKey(newProc.code[mapped]))throw new VBError('Restart required: the active caller statement changed',5);pc=mapped+1;}
          if(pc===undefined)throw new VBError('Restart required: the active procedure statement was removed or cannot be relocated',5);
          frameUpdates.push({frame,pc,lastPc:pc,lastLine:newProc.code[pc]?.line??null});
        }
        for(const [oldIndex,newIndex]of mapping)if(oldProc.code[oldIndex]&&newProc.code[newIndex]&&!oldProc.code[oldIndex].implicit)lineMap.set(key+':'+oldProc.code[oldIndex].line,newProc.code[newIndex].line);
      }
      else if(same)oldProc.code.forEach((ins,i)=>{if(!ins.implicit)lineMap.set(key+':'+ins.line,newProc.code[i].line);});
      else for(const [line,mapped]of uniqueInstructionLines(oldProc.code,newProc.code))lineMap.set(key+':'+line,mapped);
      updates.push({oldProc,newProc});
    }
  }
  return {updates,lineMap,frameUpdates};
}
const BARRIERS=new Set(['dim','forInit','forNext','eachInit','eachNext','withPush','withPop','withUnwind','temp','case','branch','jump','gosub','computedJump','lineNumber','gosubReturn','onError','resume','return','end']);
export function nextStatementIndex(frame,line,column=null){
  if(!Number.isInteger(line)||line<1)throw new VBError('Invalid source line',5);
  const target=statementIndex(frame.proc.code,line,column);
  if(target<0)throw new VBError('Select an executable line in the active procedure',5);
  if(frame.errorActive)throw new VBError('Cannot move the next statement while an error handler is active',5);
  const a=Math.min(frame.pc,target),b=Math.max(frame.pc,target);
  if(frame.proc.code.slice(a,b).some(ins=>BARRIERS.has(ins.op)))throw new VBError('Cannot move the next statement across declarations or control-flow boundaries',5);
  return target;
}
