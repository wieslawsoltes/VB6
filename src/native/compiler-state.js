/** Native compiler state lowering. Kept separate from PE linkage and runtime kernels. */
import {NATIVE_ERROR_FRAME_BYTES} from './errors.js';
import {storageLayout} from './storage.js';
import {REAL_TYPES,nativeParameterBytes} from './numeric.js';
import {key,mem,INT_TYPES,CONSTANTS} from './compiler-constants.js';
export const nativeCompilerStateMethods={
  scalar(decl) { if(key(decl.storageType||decl.type)==='variant')this.useVariant(); if(decl.storageType)decl.type=decl.storageType;return this.recordStorage(decl,this.preparingModule)||storageLayout(this,decl,this.preparingModule,this.preparingProcedure); },
  prepareModule(module) {
    this.preparingModule=module;this.preparingProcedure=null;
    for(const proc of module.procedures.values()){if(proc.storageReturnType)proc.returnType=proc.storageReturnType;for(const p of proc.params){if(p.storageType)p.type=p.storageType;const record=this.recordLayouts.resolve(p.type,module);if(record)p.nativeRecord=record;}}
    if (!['form','module'].includes(module.kind) || module.interfaces.length ) this.fail('Native AOT does not yet lower classes or interfaces', module);
    const result = {module,nativeInternal:!!module.nativeInternal,name:module.name,form:module.form,globals:new Map(),procedures:new Map(),controls:new Map(),controlArrays:new Map(),externals:this.externals.get(key(module.name))};
    this.modules.set(key(module.name), result);
    for (const decl of module.declarations) {
      if (decl.constant) continue; this.scalar(decl);
      const variable = {...decl,owner:result,label:'global:' + module.name + ':' + decl.name}; this.allocateStorage(variable); result.globals.set(key(decl.name),variable);
    }
    for (const proc of module.procedures.values()) {
      if (proc.external) continue;
      this.preparingProcedure=proc;
      if (!['sub','function'].includes(proc.kind)) this.fail('Native AOT does not lower property procedures', module);
      if (proc.kind === 'function' && !INT_TYPES.has(key(proc.returnType)) && key(proc.returnType)!=='string' && !REAL_TYPES.has(key(proc.returnType)) && !['currency','variant'].includes(key(proc.returnType))) this.fail('Native functions must return a supported scalar: ' + proc.name, module);
      const context = {module:result,proc,label:'proc:' + module.name + ':' + proc.name,locals:new Map(),temporaries:new Map(),loops:new Map(),size:NATIVE_ERROR_FRAME_BYTES};
      const local = (name, type = 'Long',decl={}) => { context.size += decl.nativeBytes || 4; if(context.size>512*1024)this.fail('Native procedure workspace exceeds 512 KiB',module); const variable = {...decl,name,type,offset:-context.size}; context.locals.set(key(name),variable); return variable; };
      this.prepareNativeParameters(context);
      context.variantReturn=proc.kind==='function'&&key(proc.returnType)==='variant';
      let argumentOffset=context.variantReturn?12:8;
      proc.params.forEach(p => { p=this.scalar({...p,parameter:true}); if(['string','variant'].includes(key(p.type))&&!p.byRef&& !p.nativeArray){const v=local(p.name,p.type,{...p,parameter:false});v.incomingOffset=argumentOffset;v.ownedParameter=true;}else context.locals.set(key(p.name),{...p,offset:argumentOffset,parameter:true}); argumentOffset+=nativeParameterBytes(p); });
      context.argumentBytes=argumentOffset-8;
      if (proc.kind === 'function') context.returnValue = local(proc.name,proc.returnType,this.scalar({name:proc.name,type:proc.returnType}));
      for (const instruction of proc.code) {
        if (instruction.op === 'dim') for (const decl of instruction.decls) {
          if (decl.constant) continue; this.scalar(decl); if (context.locals.has(key(decl.name))) this.fail('Duplicate local: ' + decl.name,module);
          if (instruction.static || proc.static) { if(decl.initial) this.fail('Native static initializers are not yet lowered',module); const variable = {...decl,label:'static:' + context.label + ':' + decl.name}; this.allocateStorage(variable);if(variable.fixedLength||variable.nativeRecord?.hasFixedStrings)variable.initialized=this.slot(variable.label+':initialized'); context.locals.set(key(decl.name),variable); }
          else local(decl.name,decl.type,decl);
        }
        if (instruction.op === 'forInit') { const end = local(instruction.id + ':end','Long',{nativeBytes:16}), step = local(instruction.id + ':step','Long',{nativeBytes:16}); context.loops.set(instruction.id,{...instruction,endVariable:end,stepVariable:step}); }
        if (instruction.op === 'temp') context.temporaries.set(instruction.id,local(instruction.id,'Long',{nativeBytes:16}));
      }
      result.procedures.set(key(proc.name),context);
    }
    for (const name of result.externals.keys()) if (result.procedures.has(name) || result.globals.has(name) || module.constantBindings.has(name)) this.fail('Native declaration conflicts with a project member: ' + name,module);
    if (!module.form) return;
    if (!['Form','MDIForm'].includes(module.form.type)) this.fail('Unsupported native form designer',module);
    if(module.form.type==='MDIForm'&&module.form.properties.Picture)this.fail('Native MDI background Picture is not yet lowered',module);
    if (![1,3].includes(Number(module.form.properties.ScaleMode ?? 1))) this.fail('Native form ScaleMode currently supports Twips (1) or Pixels (3)',module);
    if (module.form.properties.KeyPreview) this.fail('Native KeyPreview is not yet lowered',module);
    result.handle = this.slot('hwnd:' + module.name); result.loaded = this.slot('loaded:' + module.name); result.create = 'create:' + module.name; result.close = 'close:' + module.name;
    this.prepareNativeFormPictures(result);
    result.initialized = this.slot('initialized:' + module.name); result.initialize = 'initialize:' + module.name;
    result.client = this.slot('mdi-client:' + module.name); result.menu = this.slot('menu:' + module.name);
    result.className = this.string('VB6.Native.' + module.name);
    result.rect = 'rect:' + module.name; this.data.align(4).label(result.rect).zero(16);
    let id = 100;
    for (const model of module.form.controls) {
      this.nativeControlDescriptor(model,module);
      const controlKey=this.nativeControlKey(model,module);
      const control = {model,module:result,id:id++,handle:this.slot('hwnd:' + module.name + ':' + controlKey)};
      if (model.type === 'Timer') { control.interval = this.slot('timer-interval:' + module.name + ':' + controlKey,Number(model.properties.Interval) || 0); control.enabled = this.slot('timer-enabled:' + module.name + ':' + controlKey,model.properties.Enabled === 0 ? 0 : -1); }
      control.key=controlKey;this.registerNativeControl(result,control);this.prepareNativeControl(control);
    }
    const supported = new Set(['load','initialize','activate','deactivate','resize','queryunload','unload',...(module.form.type==='Form'?['paint']:[])]);
    if(result.procedures.has('form_paint'))this.prepareNativeSurface(result);
    for(const control of result.controls.values())if(control.model.type==='PictureBox'&&result.procedures.has(key(control.model.name)+'_paint'))this.prepareNativeSurface(control);
    for (const context of result.procedures.values()) {
      const name = key(context.proc.name), match = name.match(/^(?:mdi)?form_(.*)$/);
      if (match && !supported.has(match[1])) this.fail('Native form event is not yet routed: ' + context.proc.name,module);
      for (const control of result.controls.values()) if (name.startsWith(key(control.model.name) + '_')) {
        const event = name.slice(control.model.name.length + 1);
        const events = this.nativeControlEvents(control.model.type);
        if (!events.includes(event)) this.fail('Native control event is not yet routed: ' + context.proc.name,module);
      }
    }
  },
  variable(node, context = this.context) {
    if(node.kind==='nativeKernelStorage')return node.storage;
    const gridState=this.gridStateVariable(node,context);if(gridState)return gridState;
    if(node.kind==='with')return this.nativeWithBinding().record||null;
    const record=this.recordMember(node,context);if(record)return record;
    if (node.kind === 'group') return this.variable(node.expr,context);
    if (node.kind === 'call') {
      const array=this.variable(node.callee,context);
      if(array?.nativeArray){if(!node.args.length)return array;if(!array.nativeDynamic&&node.args.length!==array.nativeBounds.length)this.fail('Native array rank mismatch: '+array.name);return {type:array.type,fixedLength:array.fixedLength,elementOf:array,indices:node.args};}
      if(array&&key(array.type)==='variant'&&array!==context?.returnValue&&node.args.length) return {type:'Variant',variantElementOf:array,indices:node.args};
      return null;
    }
    if (node.kind === 'id') return context?.locals.get(key(node.name)) || context?.module.globals.get(key(node.name)) || this.publicVariable(node.name);
    if (node.kind === 'member' && node.object.kind === 'id') { const owner=this.modules.get(key(node.object.name)), variable=owner?.globals.get(key(node.name)); if(variable && owner!==context?.module && variable.scope!=='public') this.fail('Private native variable is not accessible: '+node.name); return variable; }
    return null;
  },
  publicVariable(name) { if(this.context?.module.nativeInternal)return; const matches = [...this.modules.values()].flatMap(m => [...m.globals.values()].filter(v => key(v.name) === key(name) && v.scope === 'public')); if (matches.length > 1) this.fail('Ambiguous global: ' + name); return matches[0]; },
  constant(node) {
    const binding=this.nativeConstant(node);if(binding)return binding.value;
    return node.kind==='id'&&!this.variable(node)?(CONSTANTS[key(node.name)]??this.layoutConstant(node.name)):undefined;
  },
  address(variable) { if(!variable)this.fail('Expression is not addressable'); if(variable.nativeGridState){this.gridStateAddress(variable);return null;} if(variable.recordOf)return this.recordAddress(variable); if(variable.variantElementOf)return this.variantElementAddress(variable); if(variable.elementOf)return this.elementAddress(variable); this.rawStorageAddress(variable);return null; },
  load(variable) {
    if(variable.nativeInlineString)return this.loadInlineRecordString(variable);
    if(variable.nativeRecord||variable.recordFieldArray)this.fail('Native record values require record assignment, ByRef, Len/LenB or VarPtr');
    if(variable.nativeArray&&!variable.elementOf)this.fail('Array requires indices: '+variable.name);
    if(key(variable.type)==='variant')return this.loadVariant(variable);
    if(key(variable.type)==='date'){this.loadFloat(variable);this.x.call('native:date:validate');return;}
    if(key(variable.type)==='currency')return this.loadCurrency(variable);
    if(REAL_TYPES.has(key(variable.type)))return this.loadFloat(variable);
    const pin=this.address(variable); const type=key(variable.type);
    this.x.emit(...(type==='byte'?[0x0f,0xb6,0x00]:['integer','boolean'].includes(type)?[0x0f,0xbf,0x00]:[0x8b,0x00]));
    if(type==='string'){this.x.push().call('native:string:copy');this.ownString();}
    this.releaseArrayPin(pin);
  },
  check(type) { type = key(type); if (type === 'boolean') this.x.test().emit(0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0xf7,0xd8); else if (type === 'integer') this.x.compare(-32768).branch('l','error:6').compare(32767).branch('g','error:6'); else if (type === 'byte') this.x.compare(255).branch('g','error:6').compare(0).branch('l','error:6'); },
  store(variable) {
    if(variable.nativeInlineString)return this.storeInlineRecordString(variable);
    if(variable.recordFieldArray)this.fail('Native record array field requires indices');
    if(variable.nativeRecord)return this.copyRecordTo(variable);
    if(key(variable.type)==='variant')return this.storeVariant(variable);
    if(key(variable.type)==='date')return this.storeDate(variable);
    if(key(variable.type)==='currency')return this.storeCurrency(variable);
    if(REAL_TYPES.has(key(variable.type)))return this.storeFloat(variable);
    if(key(variable.type)==='string'){
      if(variable.fixedLength){this.x.emit(0x89,0xc3).push(variable.fixedLength).emit(0x53).call('native:string:fixed');this.ownString();}
      this.x.push();const pin=this.address(variable);this.x.push().call('native:string:assign');this.releaseArrayPin(pin);return;
    }
    this.check(variable.type); this.x.push(); const pin=this.address(variable); this.x.emit(0x5a); const type = key(variable.type); this.x.emit(...(type === 'byte' ? [0x88,0x10] : ['integer','boolean'].includes(type) ? [0x66,0x89,0x10] : [0x89,0x10])); this.x.emit(0x89,0xd0);this.releaseArrayPin(pin); },
  object(node) {
    if(node.kind==='group')return this.object(node.expr);
    const imageCollection=this.nativeImageCollectionObject(node);if(imageCollection)return imageCollection;
    const imageItem=this.nativeImageItemObject(node);if(imageItem)return imageItem;
    const picture=this.nativePictureObject(node);if(picture)return picture;
    const collection=this.nativeControlCollectionObject(node);if(collection)return collection;
    if(node.kind==='with')return this.nativeWithBinding().object||null;
    const indexed=this.indexedControl(node);if(indexed)return indexed;
    if (node.kind === 'id') { if (key(node.name) === 'me') return this.context?.module.form ? this.context.module : null; return this.context?.module.controls.get(key(node.name)) || this.context?.module.controlArrays.get(key(node.name)) || (this.modules.get(key(node.name))?.form ? this.modules.get(key(node.name)) : null); }
    if (node.kind === 'member' && node.object.kind === 'id') return this.modules.get(key(node.object.name))?.controls.get(key(node.name)) || this.modules.get(key(node.object.name))?.controlArrays.get(key(node.name));
    return null;
  },
  ensure(object) { this.withGuard(object.nativeWithActive);const form = object.form ? object : object.module; this.x.call(form.create); if(object.indexed)this.resolveControlHandle(object); },
  handle(object) { this.ensure(object); this.x.value(this.controlHandleRef(object)); },
  resolveProcedure(callee) {
    const current = this.context?.module;
    if (callee.kind === 'member' && callee.object.kind === 'id') {
      const m = this.modules.get(key(callee.object.name)) || (key(callee.object.name) === 'me' ? current : null);
      const target = m?.procedures.get(key(callee.name)) || m?.externals.get(key(callee.name));
      if(target && m!==current && (target.proc || target).scope!=='public')this.fail('Private native procedure is not accessible: '+callee.name);
      return target;
    }
    if (callee.kind !== 'id') return null;
    const name = key(callee.name), own = current?.procedures.get(name) || current?.externals.get(name); if (own) return own;
    if(current?.nativeInternal)return;
    const candidates = [...this.modules.values()].flatMap(m => [...m.procedures.values(),...m.externals.values()].filter(p => key((p.proc || p).name) === name && (p.proc || p).scope === 'public'));
    if (candidates.length > 1) this.fail('Ambiguous native procedure: ' + callee.name); return candidates[0];
  }
};
