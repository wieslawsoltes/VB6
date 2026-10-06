import {compileProject} from '../language/compiler.js';
import {compileComputeIR} from '../../packages/vb6-compute/src/compiler.js';
import {ComputeError} from '../../packages/vb6-compute/src/protocol.js';
import {APPLICATION_EVENTS, INPUT_FIELDS, validateApplication} from '../../packages/vb6-compute/src/application.js';

/** One compiled dispatcher, one persistent GPU state for every event handler.
 * DOM event collection remains host work; all VB handler execution is WGSL.
 */
export function compileComputeApplication(source,{events,...options}={}) {
  const project=typeof source==='string'?{name:'Compute',modules:[{name:options.moduleName||'Module1',kind:'module',code:source}]}:structuredClone(source);
  if(!project||!Array.isArray(project.modules))throw new ComputeError('Expected VB project or module source','GPU_SOURCE');
  if(project.modules.some(m=>String(m.name).toLowerCase()==='computeinput'))throw new ComputeError('ComputeInput is reserved for application inputs','GPU_NAME');
  const map=events??{load:options.entry||project.startup||'Main'};
  if(!map||typeof map!=='object'||Array.isArray(map)||!Object.keys(map).length)throw new ComputeError('At least one event handler is required','GPU_EVENT');
  const program=compileProject(project);
  if(!program.valid)throw new ComputeError('The application contains source errors','GPU_SOURCE',{diagnostics:program.diagnostics});
  const canonical={};
  for(const [event,name] of Object.entries(map)) {
    if(!Object.hasOwn(APPLICATION_EVENTS,event)||typeof name!=='string'||! /^(?:[A-Za-z_]\w*\.)?[A-Za-z_]\w*$/.test(name))throw new ComputeError('Invalid event binding: '+event,'GPU_EVENT');
    const candidates=[];
    for(const module of program.modules.values())for(const proc of module.procedures.values()) {
      if(name.toLowerCase()===`${module.name}.${proc.name}`.toLowerCase()||(!name.includes('.')&&name.toLowerCase()===proc.name.toLowerCase()))candidates.push({module,proc});
    }
    if(candidates.length!==1)throw new ComputeError('Missing or ambiguous event procedure: '+name,'GPU_EVENT');
    const {module,proc}=candidates[0];
    if(proc.kind!=='sub'||proc.params.length||proc.scope==='private'||proc.external)throw new ComputeError('Event handlers must be public parameterless Subs: '+name,'GPU_EVENT');
    canonical[event]=module.name+'.'+proc.name;
  }
  const code=['Option Explicit',...Object.entries(INPUT_FIELDS).map(([name,type])=>`Public ${name} As ${type}`),'Public Sub Dispatch()', 'Select Case EventId',
    ...Object.entries(canonical).map(([event,name])=>`Case ${APPLICATION_EVENTS[event]}&\nCall ${name}()`),'End Select','End Sub'].join('\n');
  project.modules.push({name:'ComputeInput',kind:'module',code});
  const artifact=compileComputeIR(compileProject(project),{...options,entry:'ComputeInput.Dispatch'});
  return validateApplication({kind:'vb6-compute-application',version:1,events:canonical,artifact});
}
