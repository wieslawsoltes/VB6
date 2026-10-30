import {compileModule} from '../compiler-core.js';

const key=value=>String(value).toLowerCase();
const names=value=>(value||[]).map(item=>typeof item==='string'?item:item.name);

/** Unit interface cycles are illegal; implementation cycles are allowed.
 * Initialization follows source uses order with each linked unit visited once. */
export function pascalUnitOrder(modules) {
  const units=new Map([...modules].filter(([,module])=>module.pascal));
  const states=new Map(),path=[],diagnostics=[];
  function checkInterfaces(name) {
    if(states.get(name)===2)return;
    if(states.get(name)===1) {
      const cycle=[...path.slice(path.indexOf(name)),name].map(item=>units.get(item)?.name||item);
      diagnostics.push({severity:'error',code:'TP_UNIT_CYCLE',number:1002,source:units.get(name).name,line:1,column:1,
        message:'Circular unit interface dependency: '+cycle.join(' -> ')});
      return;
    }
    const module=units.get(name);if(!module)return;
    states.set(name,1);path.push(name);
    for(const dependency of names(module.pascal.interfaceUses))if(units.has(key(dependency)))checkInterfaces(key(dependency));
    path.pop();states.set(name,2);
  }
  for(const name of units.keys())checkInterfaces(name);
  if(diagnostics.length)return {order:[],diagnostics};
  const order=[],visited=new Set();
  function visit(name) {
    if(visited.has(name))return;
    const module=units.get(name);if(!module)return;
    visited.add(name);
    for(const dependency of names(module.pascal.uses))visit(key(dependency));
    order.push(module);
  }
  const roots=[...units.values()].filter(module=>module.form||module.pascal.kind==='program');
  // A Visual Basic host links its Pascal modules through public members instead
  // of a uses clause; all those project units participate in initialization.
  if([...modules.values()].some(module=>!module.pascal)||!roots.length)for(const name of units.keys())visit(name);
  else for(const module of roots)visit(key(module.name));
  return {order,diagnostics};
}

function prepend(procedure,initializers,module) {
  const prefix=initializers.map(unit=>({op:'expr',expr:{kind:'call',callee:{kind:'member',object:{kind:'id',name:unit.name},name:unit.pascal.initializer},args:[]},
    source:module.name,procedure:procedure.name,line:procedure.line||1,implicit:true,sequencePoint:false}));
  const shift=prefix.length;
  if(!shift)return;
  const relocated=procedure.code.map(instruction=>({...instruction,
    ...(Number.isInteger(instruction.target)?{target:instruction.target+shift}:{}),
    ...(Array.isArray(instruction.targets)?{targets:instruction.targets.map(target=>Number.isInteger(target)?target+shift:target)}:{})}));
  procedure.code=[...prefix,...relocated];
}

/** Install initialization as ordinary bound instructions. Browser, Win32,
 * macOS and Linux therefore execute the exact same startup semantics without
 * adding a language-specific instruction or changing the native helper ABI. */
export function linkPascalProject(program) {
  if(![...program.modules.values()].some(module=>module.pascal))return program;
  const {order,diagnostics}=pascalUnitOrder(program.modules);
  if(diagnostics.length)return {...program,valid:false,diagnostics:[...program.diagnostics,...diagnostics]};
  const initializers=order.filter(module=>module.pascal.initializer);
  if(!initializers.length)return program;
  for(const module of program.modules.values()) {
    if(module.form) {
      const name=(module.form.type==='MDIForm'?'MDIForm':'Form')+'_Initialize';
      let procedure=module.procedures.get(key(name));
      if(!procedure) {
        procedure=compileModule({name:module.name,kind:module.kind,code:`Private Sub ${name}()\nEnd Sub`}).procedures.get(key(name));
        module.procedures.set(key(name),procedure);
      }
      prepend(procedure,initializers,module);
    }else {
      const main=module.procedures.get('main');
      if(main)prepend(main,initializers,module);
    }
  }
  return {...program,pascalInitialization:initializers.map(module=>module.name)};
}
