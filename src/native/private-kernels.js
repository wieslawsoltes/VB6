/** Compiler-owned VB helpers are compiled to ordinary x86, never interpreted or
 * embedded as source. Registry naming and reachability keep them isolated from
 * authored modules and avoid emitting unused native services. */
import {compileProject} from '../language/compiler.js';
import {lowerNativeDeclarations} from './declarations.js';
import {NativeRecordLayouts} from './records.js';
const key=value=>String(value).toLowerCase();
export function nativeKernelDependencies(procedures,roots){
  const needed=new Set();
  const visit=name=>{
    name=key(name);if(needed.has(name))return;
    const procedure=procedures.get(name);if(!procedure)throw new TypeError('Unknown private native procedure: '+name);
    needed.add(name);
    const walk=node=>{
      if(!node||typeof node!=='object')return;
      if(node.kind==='id'&&procedures.has(key(node.name)))visit(node.name);
      if(Array.isArray(node)){for(const item of node)walk(item);}
      else for(const value of Object.values(node))walk(value);
    };
    walk(procedure.proc?.code||procedure.code);
  };
  for(const root of roots)visit(root);return needed;
}
export const nativePrivateKernelMethods={
  privateNativeKernel(baseName,code,hosts={}){
    let name=baseName,suffix=0;while(this.modules.has(key(name)))name=baseName+(++suffix);
    const program=compileProject({name,startup:'Sub Main',modules:[{id:name,name,kind:'module',code}]});
    if(!program.valid)throw new Error('Invalid private native kernel: '+JSON.stringify(program.diagnostics));
    const module=program.modules.get(key(name));module.nativeInternal=true;
    // The main record registry was prepared before demand for this kernel was
    // known. Add only this module's private definitions, preserving user layouts.
    const records=new NativeRecordLayouts(program,message=>this.fail(message));
    for(const [id,definition] of records.definitions)this.recordLayouts.definitions.set(id,definition);
    const declarations=lowerNativeDeclarations(module);
    for(const declaration of declarations.values())for(const parameter of declaration.params){
      if(['byte','integer','long','boolean','single','double','date','currency','string','any'].includes(key(parameter.type)))continue;
      parameter.nativeRecord=this.recordLayouts.resolve(parameter.type,module);
      if(!parameter.byRef||!parameter.nativeRecord)this.fail('Private native Declare requires a known ByRef record: '+parameter.type);
    }
    this.externals.set(key(name),declarations);
    const before=[this.preparingModule,this.preparingProcedure];
    try{this.prepareModule(module);}finally{[this.preparingModule,this.preparingProcedure]=before;}
    const kernel=this.modules.get(key(name));kernel.deferredNativeKernel=true;
    kernel.roots=new Set();kernel.emitted=new Set();kernel.hosts=hosts;
    (this.privateNativeKernels||=[]).push(kernel);return kernel;
  },
  privateNativeProcedure(kernel,name){
    const target=kernel.procedures.get(key(name));
    if(!target)throw new TypeError('Unknown private native procedure: '+name);
    kernel.roots.add(key(name));return target;
  },
  invokePrivateNative(kernel,name,args){
    const target=this.privateNativeProcedure(kernel,name);
    this.nativeTypedCall(target,this.nativeCallPlan(target,args));
  },
  nativeKernelValue(value){return {kind:'nativeKernelValue',value};},
  emitPrivateNativeKernels(){
    for(const kernel of this.privateNativeKernels||[]){
      // Emitting a host can discover another root. Iterate to a fixed point;
      // normal recursive VB calls are handled by dependency closure, not inlining.
      for(;;){
        const pending=[...nativeKernelDependencies(kernel.procedures,kernel.roots)].filter(n=>!kernel.emitted.has(n));
        if(!pending.length)break;
        for(const name of pending){
          const proc=kernel.procedures.get(name);kernel.emitted.add(name);
          if(kernel.hosts[name])kernel.hosts[name](this,proc);else this.procedure(proc);
        }
      }
    }
  }
};
