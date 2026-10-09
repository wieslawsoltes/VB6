/** Native compiler procedures lowering. Kept separate from PE linkage and runtime kernels. */
import {BinarySection} from './pe32.js';
import {X86} from './x86.js';
import {REAL_TYPES} from './numeric.js';
import {key,lit,mem} from './compiler-constants.js';
export const nativeCompilerProcedureMethods={
  procedure(context) {
    this.context = context; const outer=this.x, body=new BinarySection('.body',0), x=this.x=new X86(body,this.image), code=this.optimizedNativeProcedure(context), end=context.label+':return';
    // Lower first so temporary text buffers are stack-local, including recursive calls.
    x.sequence=outer.sequence;context.stringTemps=[];context.variantTemps=[];context.arrayPins=[];context.nativeOwnedTemps=[];this.prepareNativeFlow(context);
    for (let i = 0; i < code.length; i++) {
      this.typeCache=new WeakMap();
      const ins = this.instruction = code[i]; x.label(context.label + ':' + i).call(context.label+':clear-strings');this.errorCheckpoint(context,i,ins);
      if(!context.module.nativeInternal)this.sourceMap.push({symbol:context.label + ':' + i,source:ins.source,line:ins.line,procedure:ins.procedure});
      if(this.errorInstruction(ins,context)||this.nativeFlowInstruction(ins,context,i))continue;
      if (ins.op === 'dim') { for (const decl of ins.decls) if (!decl.constant && decl.initial) { this.storageExpression(context.locals.get(key(decl.name)),decl.initial); this.store(context.locals.get(key(decl.name))); } }
      else if (ins.op === 'assign') {
        if(ins.objectSet){
          const target=ins.target.kind==='member'?this.object(ins.target.object):null;
          if(!(this.nativePictureOwner(target)&&['picture','icon'].includes(key(ins.target.name)))&&!this.nativeImageBindingProperty(target,key(ins.target.name)))this.fail('Native object assignment is not lowered');
        }
        const variable = this.variable(ins.target);
        if (variable?.nativeArray && !variable.elementOf) this.assignArrayStorage(variable,ins.expr);
        else if (variable) { this.storageExpression(variable,ins.expr); this.store(variable); }
        else if (this.nativeTabTextAssignment(ins.target,ins.expr)||this.gridIndexedAssignment(ins.target,ins.expr)) { /* native indexed control property */ }
        else if (ins.target.kind === 'member') this.setProperty(this.object(ins.target.object),key(ins.target.name),ins.expr);
        else if (ins.target.kind === 'id' && context.module.form) this.setProperty(context.module,key(ins.target.name),ins.expr);
        else this.fail('Unknown native variable: ' + (ins.target.name || ins.target.kind));
      }
      else if(ins.op==='redim'){for(const decl of ins.decls)this.redimArrayStorage(decl,ins.preserve);}
      else if(ins.op==='erase'){for(const expr of ins.exprs)this.eraseStorage(expr);}
      else if (ins.op === 'expr') this.expression(ins.expr);
      else if (ins.op === 'branch') { this.truth(ins.test); x.test().branch('e',context.label + ':' + ins.target); }
      else if (ins.op === 'jump') x.jump(context.label + ':' + ins.target);
      else if (ins.op === 'return') {if(!ins.implicit)x.call('native:error:clear');x.jump(end);}
      else if (ins.op === 'lineNumber') { /* Debug metadata remains in the map. */ }
      else if (ins.op === 'end') x.api('kernel32.dll','ExitProcess',[0]);
      else if (ins.op === 'form') {
        const object = this.object(ins.expr); if (!object?.form) this.fail('Native Load/Unload requires a form');
        if (ins.action === 'load') this.ensure(object);
        else if (ins.action === 'unload') { const done = x.unique(); x.value(this.controlHandleRef(object)).test().branch('e',done).api('user32.dll','SendMessageW',[this.controlHandleRef(object),0x10,1,0]).label(done); }
        else this.fail('Unsupported native form operation');
      }
      else if (ins.op === 'forInit') {
        const loop = context.loops.get(ins.id), variable = this.variable({kind:'id',name:ins.name}); if (!variable) this.fail('Undeclared native For variable: ' + ins.name);
        loop.endVariable.type=loop.stepVariable.type=variable.type;
        this.storageExpression(variable,ins.start); this.store(variable); this.storageExpression(loop.endVariable,ins.end); this.store(loop.endVariable); this.storageExpression(loop.stepVariable,ins.step); this.store(loop.stepVariable); this.forTest(loop,variable,context.label + ':' + ins.target);
      }
      else if (ins.op === 'forNext') {
        const loop = context.loops.get(ins.id), variable = this.variable({kind:'id',name:loop.name});
        this.expression({kind:'binary',op:'+',left:{kind:'id',name:variable.name},right:{kind:'id',name:loop.stepVariable.name}}); this.store(variable);
        const done = x.unique(); this.forTest(loop,variable,done); x.jump(context.label + ':' + ins.target).label(done);
      }
      else if(ins.op==='temp'){const variable=context.temporaries.get(ins.id);variable.type=this.type(ins.expr);this.storageExpression(variable,ins.expr);this.store(variable);}
      else if(ins.op==='case'){
        const yes=x.unique(),variable=context.temporaries.get(ins.id);if(!variable)this.fail('Invalid native Select Case');
        const compare=(op,right)=>this.truth({kind:'binary',op,left:{kind:'id',name:variable.name},right});
        for(const item of ins.cases){
          if(item.kind==='value'||item.kind==='compare'){compare(item.kind==='value'?'=':item.op,item.expr);x.test().branch('ne',yes);}
          else if(item.kind==='range'){const next=x.unique();compare('>=',item.low);x.test().branch('e',next);compare('<=',item.high);x.test().branch('ne',yes).label(next);}
          else this.fail('Native Case expression is not lowered');
        }
        x.jump(context.label+':'+ins.target).label(yes);
      }
      else this.fail('Native instruction is not yet lowered: ' + ins.op);
    }
    x.label(context.label + ':' + code.length).label(end);
    if(context.variantReturn){
      this.rawStorageAddress(context.returnValue);x.push().push({argument:8}).call('native:variant:copy');
    }else if(context.returnValue&&key(context.returnValue.type)==='string'){
      this.rawStorageAddress(context.returnValue);x.emit(0x8b,0x00);x.push();this.rawStorageAddress(context.returnValue);x.emit(0xc7,0x00,0,0,0,0,0x58);
    }else if(context.returnValue)this.load(context.returnValue);else x.value(0);
    const cleanup=context.label+':cleanup';x.jump(cleanup);
    x.label(context.label+':error-return').value(context.returnValue&&key(context.returnValue.type)==='currency'?this.currencyLiteral('0'):context.returnValue&&REAL_TYPES.has(key(context.returnValue.type))?this.floatLiteral(0):0);
    x.label(cleanup).push().call(context.label+':clear-strings');
    for(const reference of context.nativeOwnedTemps.filter(r=>r.blockScoped))this.clearNativeOwnedPointer(reference);
    for(const variable of context.locals.values())if(!variable.label&&!variable.parameter){if(variable.nativeArray)this.destroyArrayStorage(variable);else if(key(variable.type)==='string')this.clearStringStorage(variable);else if(key(variable.type)==='variant')this.clearVariantStorage(variable);}
    x.emit(0x58);this.leaveErrorFrame();if(context.returnValue&&key(context.returnValue.type)==='currency')x.emit(0x8b,0x50,4,0x8b,0x00);if(context.returnValue&&REAL_TYPES.has(key(context.returnValue.type)))x.emit(0xdd,0x00);x.leave(context.argumentBytes);
    this.emitErrorDispatch(context);
    x.label(context.label+':clear-strings');for(const reference of context.nativeOwnedTemps.filter(r=>!r.blockScoped))this.clearNativeOwnedPointer(reference);for(const pin of context.arrayPins)this.releaseArrayPin(pin);for(const variable of context.stringTemps)this.clearStringStorage(variable);for(const variable of context.variantTemps)this.clearVariantStorage(variable);x.emit(0xc3);
    this.instruction=null;this.x=outer;outer.sequence=x.sequence;const unitStart=this.text.length;outer.label(context.label).enter(context.size);
    for(const variable of [...context.locals.values(),...context.stringTemps,...context.variantTemps,...context.arrayPins,...context.nativeOwnedTemps.map(x=>x.variable)])if(!variable.parameter&&!variable.label)this.zeroStorage(variable);
    this.enterErrorFrame(context);
    for(const variable of context.locals.values())if(variable.ownedParameter){
      if(key(variable.type)==='variant'){outer.push({argument:variable.incomingOffset});this.rawStorageAddress(variable);outer.push().call('native:variant:copy');}
      else outer.value({argument:variable.incomingOffset}).push().call('native:string:copy').emit(0x89,0x85).imm(variable.offset);
    }
    for(const variable of context.locals.values()){
      if(!variable.label || variable.nativeArray)this.initializeFixedString(variable);
      else if(variable.fixedLength||variable.nativeRecord?.hasFixedStrings){const done=outer.unique();outer.value(mem(variable.initialized)).test().branch('ne',done);this.initializeFixedString(variable);outer.value(1).store(variable.initialized).label(done);}
    }
    const base=this.text.length;for(const [name,offset]of body.labels){if(this.text.labels.has(name))this.fail('Duplicate native label');this.text.labels.set(name,base+offset);}
    for(const fixup of body.fixups)this.text.fixups.push({...fixup,offset:base+fixup.offset});
    for(const byte of body.bytes)this.text.bytes.push(byte);
    (this.text.codeUnits||=[]).push({name:context.label,start:unitStart,end:this.text.length,closed:true});
  },
  forTest(loop,variable,exit) {
    const x=this.x,negative=x.unique(),done=x.unique();
    const compare=(op,a,b)=>this.truth({kind:'binary',op,left:{kind:'id',name:a.name},right:typeof b==='number'?lit(b):{kind:'id',name:b.name}});
    compare('<',loop.stepVariable,0);x.test().branch('ne',negative);
    compare('>',variable,loop.endVariable);x.test().branch('ne',exit).jump(done).label(negative);
    compare('<',variable,loop.endVariable);x.test().branch('ne',exit).label(done);
  },
  handler(module, name, args = []) {
    const proc = module.procedures.get(key(name)); if (!proc) return;
    if(proc.proc.kind!=='sub') this.fail('Native event handler must be a Sub: '+name,module);
    if (proc.proc.params.some(p=>p.optional||p.paramArray))this.fail('Native event parameters cannot be Optional or ParamArray: '+name,module);
    if (proc.proc.params.length !== args.length) this.fail('Native event signature mismatch: ' + name,module);
    args.forEach((arg,i) => { const param = proc.proc.params[i]; if ((arg.ref||arg.indirectRef) && (!param.byRef || !(arg.types||[arg.type||'integer']).includes(key(param.type)))) this.fail('Native event requires ByRef '+(arg.types?.join(' or ')||arg.type||'Integer')+': ' + param.name,module); });
    for (const arg of [...args].reverse()) { if (arg.ref) this.x.local(arg.ref).push(); else if(arg.indirectRef)this.x.value({argument:arg.indirectRef}).push();else this.x.push(arg); }
    this.x.call(proc.label);this.checkNativeError('native:error:fatal');
  }
};
