import {moduleSymbolSnapshot,projectSymbolSnapshot} from './symbol-snapshot.js';
import {layoutBindingSnapshot} from '../layout/language-gate.js';
import {compileModule,validateCompiledModules} from './compiler.js';

/** Clone only compiler inputs, never forms, image assets or the complete workspace.
 * Limits apply to automatic diagnostics, not to the project file/export format. */
export function diagnosticSnapshot(project) {
  if (!project || !Array.isArray(project.modules)) throw new TypeError('A project with modules is required.');
  if (project.modules.length > 2048) throw new RangeError('Automatic syntax checking is limited to 2,048 modules. Use Check Project Syntax.');
  let size=0,layoutNodes=0;
  const modules=project.modules.map((m,index)=>{
    const code=String(m.code||'');size+=code.length;layoutNodes+=m.form?.controls?.length||0;if(layoutNodes>100000)throw new RangeError('Automatic layout checking is limited to 100,000 component declarations.');
    if(size>16*1024*1024)throw new RangeError('Automatic syntax checking is limited to 16 Mi UTF-16 source characters. Use Check Project Syntax.');
    return {id:String(m.id||index),name:String(m.name||'Module'+index),kind:String(m.kind||'module'),attributes:[...(m.attributes||[])],code,symbolBindings:JSON.parse(JSON.stringify(moduleSymbolSnapshot(m))),layoutBindings:layoutBindingSnapshot(m)};
  });
  // Conditional compiler values are scalars. JSON also detaches mutable settings.
  const conditionalConstants=JSON.parse(JSON.stringify(project.settings?.conditionalConstants||{}));
  return {name:String(project.name||'Project'),modules,symbolMetadata:JSON.parse(JSON.stringify(projectSymbolSnapshot(project))),settings:{conditionalConstants,anchoring:project.settings?.anchoring===true}};
}

export function compilerDiagnostic(error,name) {
  return {severity:'error',message:String(error.message||error),number:error.number||1002,
    source:error.source||name,line:error.line||1,column:error.column||1,origin:'syntax'};
}

/** Retains compiled modules, but not project/DOM objects. Only changed source is
 * parsed again. A single completed semantic result is reused only when all
 * ordered module identities, layout/form metadata and compiler settings match.
 * Any dependency change revalidates the whole project; partial/cancelled passes
 * never become a semantic cache entry. No project or DOM object is retained. */
export class ProjectDiagnosticCache {
  constructor(){this.entries=new Map();this.validation=null;this.epoch=0;}
  *steps(project) {
    const modules=new Map(),diagnostics=[],seen=new Set(),inputs=[],epoch=this.epoch;let compiledModules=0,cacheHits=0;
    const constants=JSON.stringify(project.settings?.conditionalConstants||{}),counts=new Map();
    for(const input of project.modules)if(input.id!==undefined&&input.id!==null){const id=String(input.id);counts.set(id,(counts.get(id)||0)+1);}
    for(let i=0;i<project.modules.length;i++) {
      const input=project.modules[i],id=String(input.id),key=input.id!==undefined&&input.id!==null&&counts.get(id)===1?'id:'+id:'position:'+i,attributes=JSON.stringify(input.attributes||[]);seen.add(key);
      let entry=this.entries.get(key);
      if(!entry||entry.code!==input.code||entry.name!==input.name||entry.kind!==input.kind||entry.constants!==constants||entry.attributes!==attributes) {
        entry={code:input.code,name:input.name,kind:input.kind,constants,attributes};compiledModules++;
        try {entry.compiled=compileModule({...input,conditionalConstants:project.settings?.conditionalConstants||{}});}
        catch(error){entry.error=compilerDiagnostic(error,input.name);}
        if(epoch===this.epoch)this.entries.set(key,entry);
      } else cacheHits++;
      // Capture detached metadata, but install it only at completion. Interleaved
      // generators must not overwrite each other's module context at a yield.
      const layout=JSON.stringify(input.layoutBindings||layoutBindingSnapshot(input));
      const form=JSON.stringify(input.form?{type:input.form.type,properties:{MDIChild:input.form.properties?.MDIChild}}:null);
      const symbols=JSON.stringify(moduleSymbolSnapshot(input));
      inputs.push({entry,layout,form,symbols});
      if(entry.error)diagnostics.push({...entry.error});
      else {const name=entry.compiled.name.toLowerCase();
        if(modules.has(name))diagnostics.push({severity:'error',message:'Duplicate module name: '+entry.compiled.name,number:1002,source:entry.compiled.name,line:1,column:1,origin:'syntax'});
        else modules.set(name,entry.compiled);
      }
      yield {completed:i+1,total:project.modules.length};
    }
    if(epoch===this.epoch)for(const key of this.entries.keys())if(!seen.has(key))this.entries.delete(key);
    const settings=JSON.stringify(project.settings||{}),symbols=JSON.stringify(projectSymbolSnapshot(project)),previous=this.validation;
    const semanticCacheHit=!!previous&&previous.settings===settings&&previous.symbols===symbols&&previous.inputs.length===inputs.length&&inputs.every((input,i)=>{
      const old=previous.inputs[i];return old.entry===input.entry&&old.layout===input.layout&&old.form===input.form&&old.symbols===input.symbols;
    });
    let semantic;
    if(semanticCacheHit)semantic=previous.diagnostics;
    else {
      for(const {entry,layout,form,symbols} of inputs)if(entry.compiled){entry.compiled.layoutBindings=JSON.parse(layout);entry.compiled.form=JSON.parse(form);entry.compiled.symbolBindings=JSON.parse(symbols);}
      semantic=validateCompiledModules(modules,project.settings,JSON.parse(symbols)).map(d=>Object.freeze({...d,origin:'syntax'}));
      if(epoch===this.epoch)this.validation={inputs,settings,symbols,diagnostics:semantic};
    }
    // Results are caller-owned. Editing Error List diagnostics must not mutate
    // the immutable semantic result that a later identical snapshot will reuse.
    diagnostics.push(...semantic.map(d=>({...d})));
    return {diagnostics,valid:diagnostics.length===0,semanticCacheHit,stats:{compiledModules,cacheHits,totalModules:project.modules.length}};
  }
  check(project){const steps=this.steps(project);let next;do {next=steps.next();}while(!next.done);return next.value;}
  clear(){this.entries.clear();this.validation=null;this.epoch++;}
}
