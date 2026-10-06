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
    return {id:String(m.id||index),name:String(m.name||'Module'+index),kind:String(m.kind||'module'),attributes:[...(m.attributes||[])],code,layoutBindings:layoutBindingSnapshot(m)};
  });
  // Conditional compiler values are scalars. JSON also detaches mutable settings.
  const conditionalConstants=JSON.parse(JSON.stringify(project.settings?.conditionalConstants||{}));
  return {name:String(project.name||'Project'),modules,settings:{conditionalConstants,anchoring:project.settings?.anchoring===true}};
}

export function compilerDiagnostic(error,name) {
  return {severity:'error',message:String(error.message||error),number:error.number||1002,
    source:error.source||name,line:error.line||1,column:error.column||1,origin:'syntax'};
}

/** Retains compiled modules, but not project/DOM objects. Only changed source is
 * parsed again. Cross-module checks still run after every completed snapshot. */
export class ProjectDiagnosticCache {
  constructor(){this.entries=new Map();}
  *steps(project) {
    const modules=new Map(),diagnostics=[],seen=new Set();let compiledModules=0,cacheHits=0;
    const constants=JSON.stringify(project.settings?.conditionalConstants||{});
    for(let i=0;i<project.modules.length;i++) {
      const input=project.modules[i],key=String(input.id||i)+':'+i;seen.add(key);
      let entry=this.entries.get(key);
      if(!entry||entry.code!==input.code||entry.name!==input.name||entry.kind!==input.kind||entry.constants!==constants||entry.attributes!==JSON.stringify(input.attributes||[])) {
        entry={code:input.code,name:input.name,kind:input.kind,constants,attributes:JSON.stringify(input.attributes||[])};compiledModules++;
        try {entry.compiled=compileModule({...input,conditionalConstants:project.settings?.conditionalConstants||{}});}
        catch(error){entry.error=compilerDiagnostic(error,input.name);}
        this.entries.set(key,entry);
      } else cacheHits++;
      if(entry.compiled)entry.compiled.layoutBindings=input.layoutBindings||layoutBindingSnapshot(input);
      if(entry.error)diagnostics.push({...entry.error});
      else {const name=entry.compiled.name.toLowerCase();
        if(modules.has(name))diagnostics.push({severity:'error',message:'Duplicate module name: '+entry.compiled.name,number:1002,source:entry.compiled.name,line:1,column:1,origin:'syntax'});
        else modules.set(name,entry.compiled);
      }
      yield {completed:i+1,total:project.modules.length};
    }
    for(const key of this.entries.keys())if(!seen.has(key))this.entries.delete(key);
    diagnostics.push(...validateCompiledModules(modules,project.settings).map(d=>({...d,origin:'syntax'})));
    return {diagnostics,valid:diagnostics.length===0,stats:{compiledModules,cacheHits,totalModules:project.modules.length}};
  }
  check(project){const steps=this.steps(project);let next;do {next=steps.next();}while(!next.done);return next.value;}
  clear(){this.entries.clear();}
}
