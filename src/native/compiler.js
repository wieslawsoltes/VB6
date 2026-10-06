import {normalizeProject} from '../project/model.js';
import {compileProject, parseParameters} from '../language/compiler.js';
import {PE32Image, BinarySection} from './pe32.js';
import {X86} from './x86.js';
import {nativeBindingMethods} from './bindings.js';
import {nativeCallMethods} from './calls.js';
import {nativeCallbackMethods,emitNativeCallbackHelpers} from './callbacks.js';
import {nativeCurrencyMethods,emitNativeCurrencyHelpers} from './currency.js';
import {nativeDateMethods,emitNativeDateHelpers} from './dates.js';
import {nativeDateIntervalMethods,emitNativeDateIntervalHelpers,NATIVE_DATE_CONSTANTS} from './date-intervals.js';
import {REAL_TYPES,nativeNumericMethods,emitNativeNumericHelpers,nativeParameterBytes} from './numeric.js';
import {nativeControlArrayMethods} from './control-arrays.js';
import {MAX_NATIVE_STRING,storageLayout,nativeStorageMethods,emitNativeStorageHelpers} from './storage.js';
import {nativeArrayLimit,nativeArrayMethods,emitNativeArrayHelpers} from './arrays.js';
import {NATIVE_ERROR_FRAME_BYTES,nativeErrorMethods,emitNativeErrorHelpers} from './errors.js';

const key = value => String(value).toLowerCase();
const lit = value => ({kind:'literal', value});
const mem = memory => ({memory});
const INT_TYPES = new Set(['long', 'integer', 'byte', 'boolean']);
const CLASSES = {CommandButton:'BUTTON', Label:'STATIC', TextBox:'EDIT', CheckBox:'BUTTON', OptionButton:'BUTTON', Frame:'BUTTON', ListBox:'LISTBOX', ComboBox:'COMBOBOX', Timer:null};
const BOOL_CONDITIONS = {'=':0x94, '<>':0x95, '<':0x9c, '<=':0x9e, '>':0x9f, '>=':0x9d};
const CONSTANTS = {...NATIVE_DATE_CONSTANTS,vbtrue:-1,vbfalse:0,vbnormal:0,vbminimized:1,vbmaximized:2,vbmodal:1,vbmodeless:0,vbokonly:0,vbokcancel:1,vbyesno:4,vbyesnocancel:3,vbinformation:64,vbexclamation:48,vbcritical:16,vbquestion:32,vbok:1,vbcancel:2,vbyes:6,vbno:7,vbcrlf:'\r\n',vbnewline:'\r\n',vbtab:'\t',vbnullstring:''};
export class NativeCompileError extends Error {
  constructor(message, source = '', line = 0) { super(`${source ? source + ':' + line + ': ' : ''}${message}`); this.name = 'NativeCompileError'; this.diagnostics = [{severity:'error',source,line,message}]; }
}

/** Native declarations are stripped only for this backend; the browser VM remains sandboxed. */
export function extractNativeDeclarations(module) {
  const declarations = new Map();
  const code = module.code.split(/\r?\n/).map((line, index) => {
    if (!/^\s*(?:Public\s+|Private\s+)?Declare\b/i.test(line)) return line;
    const m = line.match(/^\s*(?:(Public|Private)\s+)?Declare\s+(Function|Sub)\s+(\w+)\s+Lib\s+"([\w.-]+)"(?:\s+Alias\s+"([\w?@$#]+)")?\s*\((.*)\)\s*(?:As\s+(\w+))?\s*(?:'.*)?$/i);
    if (!m) throw new NativeCompileError('Unsupported native Declare syntax; use a single-line stdcall declaration', module.name, index + 1);
    const dll = /\.dll$/i.test(m[4]) ? m[4] : m[4] + '.dll', name = key(m[3]);
    const params = parseParameters(m[6]);
    if (declarations.has(name)) throw new NativeCompileError('Duplicate native declaration: ' + m[3], module.name, index + 1);
    if (params.some(p => !INT_TYPES.has(key(p.type)) && !REAL_TYPES.has(key(p.type)) && key(p.type)!=='currency' || p.bounds !== null || p.optional || p.paramArray) || (key(m[2]) === 'function' && !INT_TYPES.has(key(m[7])) && !REAL_TYPES.has(key(m[7])) && key(m[7])!=='currency')) {
      throw new NativeCompileError('Native Declare supports Byte/Integer/Long/Boolean/Single/Double/Currency/Date parameters and returns; use StrPtr for explicit Unicode pointers', module.name, index + 1);
    }
    declarations.set(name, {name:m[3],kind:key(m[2]),scope:key(m[1] || 'public'),params,returnType:m[7] || 'Long',dll,symbol:/^#\d+$/.test(m[5] || '') ? Number(m[5].slice(1)) : m[5] || m[3],line:index + 1});
    return ''; // Keep line numbers stable.
  }).join('\n');
  return {declarations, code};
}

class NativeCompiler {
  constructor(project, options = {}) {
    this.maxArrayBytes=nativeArrayLimit(options.maxArrayBytes, message=>this.fail(message));
    this.project = normalizeProject(project); this.externals = new Map();
    if (this.project.dataSources?.connections?.length || this.project.modules.some(m => m.form?.controls?.some(c => c.properties?.DataSource || c.properties?.DataMember || /^(?:Data|Adodc)$/i.test(c.type)))) this.fail('Data-source providers and data-bound controls require the HTML or Electron desktop target; freestanding PE32 AOT does not implement the data runtime');
    if (project.resources?.entries?.length) this.fail('Native resource lowering is not yet implemented; use the classic or desktop target');
    const targetType = project.nativeProject?.entries?.find(e => key(e.key) === 'type')?.value;
    if (targetType && key(targetType) !== 'exe') this.fail('Freestanding AOT currently requires a Standard EXE project');
    for (const module of this.project.modules) { const result = extractNativeDeclarations(module); module.code = result.code; this.externals.set(key(module.name), result.declarations); }
    this.program = compileProject(this.project);
    if (!this.program.valid) { const error = new NativeCompileError('Project contains compile errors'); error.diagnostics = this.program.diagnostics; error.message = error.diagnostics.map(d => `${d.source}:${d.line}: ${d.message}`).join('\n'); throw error; }
    this.image = new PE32Image(); this.text = this.image.section('.text', 0x60000020); this.ro = this.image.section('.rdata', 0x40000040); this.data = this.image.section('.data', 0xc0000040);
    this.x = new X86(this.text, this.image); this.modules = new Map(); this.strings = new Map(); this.sourceMap = []; this.bufferCount = 0;
    this.slot('instance'); this.slot('live-forms'); this.data.align(4).label('msg').zero(32);
    this.title = this.string(project.name); this.errorTitle = this.string('VB6 native runtime error'); this.prepareErrors();
    for (const module of this.program.modules.values()) this.prepareModule(module);
    const parents = [...this.modules.values()].filter(m => m.form?.type === 'MDIForm');
    if (parents.length > 1) this.fail('Only one MDI parent is supported'); this.mdi = parents[0];
    for (const module of this.modules.values()) if (module.form?.properties.MDIChild && !this.mdi) this.fail('MDI child requires an MDIForm', module);
  }
  fail(message, context = this.context) { throw new NativeCompileError(message, context?.module?.name || context?.name || '', this.instruction?.line || context?.proc?.line || 0); }
  slot(label, value = 0) { this.data.align(4).label(label).u32(value); return label; }
  string(text) { text = String(text); if (text.length > MAX_NATIVE_STRING) this.fail('Native text exceeds 1,048,576 UTF-16 units'); if (!this.strings.has(text)) { const name = 'string:' + this.strings.size; this.ro.align(4).u32(text.length * 2).label(name).utf16(text); this.strings.set(text,name); } return this.strings.get(text); }
  buffer() { if(this.context?.proc?.name) { this.context.size+=8192; if(this.context.size>512*1024)this.fail('Native procedure text workspace exceeds 512 KiB'); return {address:-this.context.size}; } if (++this.bufferCount > 1024) this.fail('Native text-buffer limit exceeded'); const name = 'buffer:' + this.bufferCount; this.data.align(4).label(name).zero(8192); return name; }
  scalar(decl) { return storageLayout(this,decl,this.preparingModule,this.preparingProcedure); }
  prepareModule(module) {
    this.preparingModule=module;this.preparingProcedure=null;
    if (!['form','module'].includes(module.kind) || module.interfaces.length || Object.keys(module.types).length) this.fail('Native AOT does not yet lower classes, interfaces or UDTs', module);
    const result = {module,nativeInternal:!!module.nativeInternal,name:module.name,form:module.form,globals:new Map(),procedures:new Map(),controls:new Map(),controlArrays:new Map(),externals:this.externals.get(key(module.name))};
    this.modules.set(key(module.name), result);
    for (const decl of module.declarations) {
      if (decl.constant) continue; this.scalar(decl);
      const variable = {...decl,owner:result,label:'global:' + module.name + ':' + decl.name}; this.allocateStorage(variable); result.globals.set(key(decl.name),variable);
    }
    for (const proc of module.procedures.values()) {
      this.preparingProcedure=proc;
      if (!['sub','function'].includes(proc.kind)) this.fail('Native AOT does not lower property procedures', module);
      if (proc.kind === 'function' && !INT_TYPES.has(key(proc.returnType)) && key(proc.returnType)!=='string' && !REAL_TYPES.has(key(proc.returnType)) && key(proc.returnType)!=='currency') this.fail('Native functions must return a supported scalar: ' + proc.name, module);
      const context = {module:result,proc,label:'proc:' + module.name + ':' + proc.name,locals:new Map(),temporaries:new Map(),loops:new Map(),size:NATIVE_ERROR_FRAME_BYTES};
      const local = (name, type = 'Long',decl={}) => { context.size += decl.nativeBytes || 4; if(context.size>512*1024)this.fail('Native procedure workspace exceeds 512 KiB',module); const variable = {...decl,name,type,offset:-context.size}; context.locals.set(key(name),variable); return variable; };
      this.prepareNativeParameters(context);
      let argumentOffset=8;
      proc.params.forEach(p => { p=this.scalar({...p,parameter:true}); if(key(p.type)==='string'&&!p.byRef){const v=local(p.name,p.type,{...p,parameter:false});v.incomingOffset=argumentOffset;v.ownedParameter=true;}else context.locals.set(key(p.name),{...p,offset:argumentOffset,parameter:true}); argumentOffset+=nativeParameterBytes(p); });
      context.argumentBytes=argumentOffset-8;
      if (proc.kind === 'function') context.returnValue = local(proc.name,proc.returnType,this.scalar({name:proc.name,type:proc.returnType}));
      for (const instruction of proc.code) {
        if (instruction.op === 'dim') for (const decl of instruction.decls) {
          if (decl.constant) continue; this.scalar(decl); if (context.locals.has(key(decl.name))) this.fail('Duplicate local: ' + decl.name,module);
          if (instruction.static || proc.static) { if(decl.initial) this.fail('Native static initializers are not yet lowered',module); const variable = {...decl,label:'static:' + context.label + ':' + decl.name}; this.allocateStorage(variable);if(variable.fixedLength)variable.initialized=this.slot(variable.label+':initialized'); context.locals.set(key(decl.name),variable); }
          else local(decl.name,decl.type,decl);
        }
        if (instruction.op === 'forInit') { const end = local(instruction.id + ':end','Long',{nativeBytes:8}), step = local(instruction.id + ':step','Long',{nativeBytes:8}); context.loops.set(instruction.id,{...instruction,endVariable:end,stepVariable:step}); }
        if (instruction.op === 'temp') context.temporaries.set(instruction.id,local(instruction.id,'Long',{nativeBytes:8}));
      }
      result.procedures.set(key(proc.name),context);
    }
    for (const name of result.externals.keys()) if (result.procedures.has(name) || result.globals.has(name) || module.constantBindings.has(name)) this.fail('Native declaration conflicts with a project member: ' + name,module);
    if (!module.form) return;
    if (!['Form','MDIForm'].includes(module.form.type)) this.fail('Unsupported native form designer',module);
    if (module.form.properties.Picture || module.form.properties.Icon) this.fail('Native form picture/icon resources are not yet lowered',module);
    if (![1,3].includes(Number(module.form.properties.ScaleMode ?? 1))) this.fail('Native form ScaleMode currently supports Twips (1) or Pixels (3)',module);
    if (module.form.properties.KeyPreview) this.fail('Native KeyPreview is not yet lowered',module);
    result.handle = this.slot('hwnd:' + module.name); result.loaded = this.slot('loaded:' + module.name); result.create = 'create:' + module.name; result.close = 'close:' + module.name;
    result.initialized = this.slot('initialized:' + module.name); result.initialize = 'initialize:' + module.name;
    result.client = this.slot('mdi-client:' + module.name); result.menu = this.slot('menu:' + module.name);
    result.className = this.string('VB6.Native.' + module.name);
    result.rect = 'rect:' + module.name; this.data.align(4).label(result.rect).zero(16);
    let id = 100;
    for (const model of module.form.controls) {
      if (model.properties.Picture || model.properties.Icon) this.fail('Native picture/icon resources are not yet lowered',module);
      if (!Object.hasOwn(CLASSES,model.type)) this.fail('Unsupported native control: ' + model.type, module);
      const controlKey=this.nativeControlKey(model,module);
      const control = {model,module:result,id:id++,handle:this.slot('hwnd:' + module.name + ':' + controlKey)};
      if (model.type === 'Frame') control.oldProcedure=this.slot('frame-old-procedure:'+module.name+':'+controlKey);
      if (model.type === 'Timer') { control.interval = this.slot('timer-interval:' + module.name + ':' + controlKey,Number(model.properties.Interval) || 0); control.enabled = this.slot('timer-enabled:' + module.name + ':' + controlKey,model.properties.Enabled === 0 ? 0 : -1); }
      control.key=controlKey;this.registerNativeControl(result,control);
    }
    const supported = new Set(['load','initialize','activate','deactivate','resize','queryunload','unload']);
    for (const context of result.procedures.values()) {
      const name = key(context.proc.name), match = name.match(/^(?:mdi)?form_(.*)$/);
      if (match && !supported.has(match[1])) this.fail('Native form event is not yet routed: ' + context.proc.name,module);
      for (const control of result.controls.values()) if (name.startsWith(key(control.model.name) + '_')) {
        const event = name.slice(control.model.name.length + 1);
        const events = {CommandButton:['click'], Label:['click','dblclick'], TextBox:['change'], CheckBox:['click'],OptionButton:['click'],Frame:[], ListBox:['click','dblclick'], ComboBox:['click','change'], Timer:['timer']}[control.model.type];
        if (!events.includes(event)) this.fail('Native control event is not yet routed: ' + context.proc.name,module);
      }
    }
  }
  variable(node, context = this.context) {
    if (node.kind === 'group') return this.variable(node.expr,context);
    if (node.kind === 'call') {
      const array=this.variable(node.callee,context);
      if(array?.nativeArray){if(!node.args.length)return array;if(!array.nativeDynamic&&node.args.length!==array.nativeBounds.length)this.fail('Native array rank mismatch: '+array.name);return {type:array.type,fixedLength:array.fixedLength,elementOf:array,indices:node.args};}
      return null;
    }
    if (node.kind === 'id') return context?.locals.get(key(node.name)) || context?.module.globals.get(key(node.name)) || this.publicVariable(node.name);
    if (node.kind === 'member' && node.object.kind === 'id') { const owner=this.modules.get(key(node.object.name)), variable=owner?.globals.get(key(node.name)); if(variable && owner!==context?.module && variable.scope!=='public') this.fail('Private native variable is not accessible: '+node.name); return variable; }
    return null;
  }
  publicVariable(name) { if(this.context?.module.nativeInternal)return; const matches = [...this.modules.values()].flatMap(m => [...m.globals.values()].filter(v => key(v.name) === key(name) && v.scope === 'public')); if (matches.length > 1) this.fail('Ambiguous global: ' + name); return matches[0]; }
  constant(node) {
    const binding=this.nativeConstant(node);if(binding)return binding.value;
    return node.kind==='id'&&!this.variable(node)?CONSTANTS[key(node.name)]:undefined;
  }
  address(variable) { if(!variable)this.fail('Expression is not addressable'); if(variable.elementOf)return this.elementAddress(variable); this.rawStorageAddress(variable);return null; }
  load(variable) {
    if(variable.nativeArray&&!variable.elementOf)this.fail('Array requires indices: '+variable.name);
    if(key(variable.type)==='date'){this.loadFloat(variable);this.x.call('native:date:validate');return;}
    if(key(variable.type)==='currency')return this.loadCurrency(variable);
    if(REAL_TYPES.has(key(variable.type)))return this.loadFloat(variable);
    const pin=this.address(variable); const type=key(variable.type);
    this.x.emit(...(type==='byte'?[0x0f,0xb6,0x00]:['integer','boolean'].includes(type)?[0x0f,0xbf,0x00]:[0x8b,0x00]));
    if(type==='string'){this.x.push().call('native:string:copy');this.ownString();}
    this.releaseArrayPin(pin);
  }
  check(type) { type = key(type); if (type === 'boolean') this.x.test().emit(0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0xf7,0xd8); else if (type === 'integer') this.x.compare(-32768).branch('l','error:6').compare(32767).branch('g','error:6'); else if (type === 'byte') this.x.compare(255).branch('g','error:6').compare(0).branch('l','error:6'); }
  store(variable) {
    if(key(variable.type)==='date')return this.storeDate(variable);
    if(key(variable.type)==='currency')return this.storeCurrency(variable);
    if(REAL_TYPES.has(key(variable.type)))return this.storeFloat(variable);
    if(key(variable.type)==='string'){
      if(variable.fixedLength){this.x.emit(0x89,0xc3).push(variable.fixedLength).emit(0x53).call('native:string:fixed');this.ownString();}
      this.x.push();const pin=this.address(variable);this.x.push().call('native:string:assign');this.releaseArrayPin(pin);return;
    }
    this.check(variable.type); this.x.push(); const pin=this.address(variable); this.x.emit(0x5a); const type = key(variable.type); this.x.emit(...(type === 'byte' ? [0x88,0x10] : ['integer','boolean'].includes(type) ? [0x66,0x89,0x10] : [0x89,0x10])); this.x.emit(0x89,0xd0);this.releaseArrayPin(pin); }
  object(node) {
    const indexed=this.indexedControl(node);if(indexed)return indexed;
    if (node.kind === 'id') { if (key(node.name) === 'me') return this.context?.module.form ? this.context.module : null; return this.context?.module.controls.get(key(node.name)) || this.context?.module.controlArrays.get(key(node.name)) || (this.modules.get(key(node.name))?.form ? this.modules.get(key(node.name)) : null); }
    if (node.kind === 'member' && node.object.kind === 'id') return this.modules.get(key(node.object.name))?.controls.get(key(node.name)) || this.modules.get(key(node.object.name))?.controlArrays.get(key(node.name));
    return null;
  }
  ensure(object) { const form = object.form ? object : object.module; this.x.call(form.create); if(object.indexed)this.resolveControlHandle(object); }
  handle(object) { this.ensure(object); this.x.value(this.controlHandleRef(object)); }
  type(node) {
    const bound=this.nativeConstant(node);if(bound)return bound.type;
    const intervalType=this.dateIntervalType(node);if(intervalType)return intervalType;
    const dateType=this.dateType(node);if(dateType)return dateType;
    const currencyType=this.currencyType(node);if(currencyType)return currencyType;
    const numericType=this.numericType(node);if(numericType)return numericType;
    if (node.kind === 'group') return this.type(node.expr);
    const errorProperty=this.errorProperty(node);if(errorProperty)return errorProperty==='number'?'long':'string';
    const variable=this.variable(node);if(variable)return key(variable.type);
    if(node.kind==='call'){
      const name=node.callee.kind==='id'?key(node.callee.name).replace(/\$$/,''):'';
      if(['cstr','left','right','mid','chrw'].includes(name))return 'string';
      const result=this.nativeFunctionType(node);if(result)return result;
    }
    if(node.kind==='id'||node.kind==='member'){const result=this.nativeFunctionType(node);if(result)return result;}
    if (node.kind === 'id' && key(node.name)==='caption' && this.context?.module.form && !this.variable(node)) return 'string';
    if (node.kind === 'literal') return typeof node.value === 'string' ? 'string' : 'long';
    const constant = this.constant(node); if (constant !== undefined) return typeof constant === 'string' ? 'string' : 'long';
    if (node.kind==='binary' && (node.op==='&' || node.op==='+' && this.type(node.left)==='string' && this.type(node.right)==='string')) return 'string';
    if (node.kind === 'member' && ['caption','text'].includes(key(node.name)) && this.object(node.object)) return 'string';
    if (node.kind === 'call' && node.callee.kind === 'id' && key(node.callee.name) === 'cstr') return 'string';
    return 'long';
  }
  numeric(node) { if (this.type(node) === 'string') this.fail('Use CLng/CInt explicitly to convert native text to a number'); this.expression(node);if(this.type(node)==='currency')this.currencyToInteger();else if(REAL_TYPES.has(this.type(node)))this.floatToInteger(); }
  textExpression(node) { this.expression(node); if(this.type(node)==='date'){this.dateToString();}else if(this.type(node)==='currency'){this.currencyToString();}else if(REAL_TYPES.has(this.type(node))){this.floatToString(this.type(node));}else if(this.type(node)!=='string'){this.x.push().call('native:string:from-int');this.ownString();}this.stringPointer(); }
  expression(node) {
    if (!node) this.fail('Missing expression'); const x = this.x;
    const bound=this.nativeConstant(node);if(bound)return this.emitNativeConstant(bound);
    if(this.dateOperation(node))return;
    if(this.currencyOperation(node))return;
    if(this.numericExpression(node))return;
    if (node.kind === 'group') return this.expression(node.expr);
    if (node.kind === 'unary' && node.op === '-' && node.expr?.kind === 'literal' && node.expr.value === 2147483648) { x.value(-2147483648); return; }
    if (node.kind === 'literal') { if (typeof node.value === 'string') x.value(this.string(node.value)); else if (typeof node.value === 'boolean') x.value(node.value ? -1 : 0); else if (Number.isInteger(node.value) && node.value >= -2147483648 && node.value <= 2147483647) x.value(node.value); else this.fail('Native AOT currently requires signed 32-bit integer or string-literal values'); return; }
    const constant = this.constant(node); if (constant !== undefined) return this.expression(lit(constant));
    const variable = this.variable(node); if (variable) return this.load(variable);
    if(this.errorExpression(node))return;
    if (node.kind === 'member') {
      if(this.nativeFunctionType(node))return this.call({kind:'call',callee:node,args:[]});
      return this.getProperty(this.object(node.object),key(node.name));
    }
    if (node.kind === 'id') { if (this.context?.module.form && ['caption','hwnd','visible','enabled','windowstate','scalewidth','scaleheight'].includes(key(node.name))) return this.getProperty(this.context.module,key(node.name)); return this.call({kind:'call',callee:node,args:[]}); }
    if (node.kind === 'call') return this.call(node);
    if (node.kind === 'unary') {
      this.numeric(node.value ?? node.expr ?? node.operand); if (node.op === '-') x.emit(0xf7,0xd8).branch('o','error:6'); else if (key(node.op) === 'not') x.emit(0xf7,0xd0); else if (node.op !== '+') this.fail('Unsupported native unary operator: ' + node.op); return;
    }
    if (node.kind !== 'binary') this.fail('Unsupported native expression: ' + node.kind);
    const op = key(node.op);
    if (op === '&' || op==='+' && this.type(node.left)==='string' && this.type(node.right)==='string') {
      this.textExpression(node.left);x.push();this.textExpression(node.right);x.emit(0x5b).push().emit(0x53).call('native:string:concat');this.ownString();return;
    }
    if (this.type(node.left) === 'string' || this.type(node.right) === 'string') {
      if (!Object.hasOwn(BOOL_CONDITIONS,op) || this.type(node.left) !== this.type(node.right)) this.fail('Unsupported native string operation: ' + op);
      if (this.context.module.module.optionCompare !== 'binary') this.fail('Native strings currently require Option Compare Binary');
      this.expression(node.left); x.push(); this.expression(node.right); x.emit(0x5b).push().emit(0x53).call('native:string:compare').compare(0); this.boolean(op); return;
    }
    this.numeric(node.left); x.push(); this.numeric(node.right); x.emit(0x89,0xc1,0x58);
    if (op === '+') x.emit(0x01,0xc8).branch('o','error:6');
    else if (op === '-') x.emit(0x29,0xc8).branch('o','error:6');
    else if (op === '*') x.emit(0x0f,0xaf,0xc1).branch('o','error:6');
    else if (op === '\\' || op === 'mod') { const safe = x.unique(); x.emit(0x85,0xc9).branch('e','error:11').compare(-2147483648).branch('ne',safe).emit(0x83,0xf9,0xff).branch('e','error:6').label(safe).emit(0x99,0xf7,0xf9); if (op === 'mod') x.emit(0x89,0xd0); }
    else if (op === 'and') x.emit(0x21,0xc8); else if (op === 'or') x.emit(0x09,0xc8); else if (op === 'xor') x.emit(0x31,0xc8);
    else if (op === 'eqv') x.emit(0x31,0xc8,0xf7,0xd0); else if (op === 'imp') x.emit(0xf7,0xd0,0x09,0xc8);
    else if (Object.hasOwn(BOOL_CONDITIONS,op)) { x.emit(0x39,0xc8); this.boolean(op); }
    else this.fail('Native operator is not lowered: ' + op);
  }
  boolean(op) { this.x.emit(0x0f,BOOL_CONDITIONS[op],0xc0,0x0f,0xb6,0xc0,0xf7,0xd8); }
  getProperty(object, property) {
    if (!object) this.fail('Unknown native object'); const x = this.x;
    if(this.controlArrayProperty(object,property))return;
    if (property === 'hwnd') { if (object.model?.type === 'Timer') this.fail('Timer has no hWnd'); this.handle(object); return; }
    if (['text','caption'].includes(property)) {
      if (object.model?.type === 'Timer') this.fail('Timer has no text');
      const buffer = this.buffer(); this.handle(object); x.push().invoke('user32.dll','GetWindowTextLengthW').compare(4095).branch('g','error:7');
      x.api('user32.dll','GetWindowTextW',[this.controlHandleRef(object),buffer,4096]).push(buffer).invoke('oleaut32.dll','SysAllocString').test().branch('e','error:7');this.ownString(); return;
    }
    if (property === 'enabled' || property === 'visible') { if (object.model?.type === 'Timer') { if (property !== 'enabled') this.fail('Timer has no Visible property'); x.value(mem(object.enabled)); } else { this.handle(object); x.push().invoke('user32.dll',property === 'enabled' ? 'IsWindowEnabled' : 'IsWindowVisible').emit(0xf7,0xd8); } return; }
    if (property === 'interval' && object.model?.type === 'Timer') { x.value(mem(object.interval)); return; }
    if (property === 'value' && ['CheckBox','OptionButton'].includes(object.model?.type)) { this.ensure(object); x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),0xf0,0,0]); if (object.model.type === 'OptionButton') x.emit(0xf7,0xd8); return; }
    if (['listindex','listcount'].includes(property) && ['ListBox','ComboBox'].includes(object.model?.type)) { this.ensure(object); const combo = object.model.type === 'ComboBox'; x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),property === 'listindex' ? combo ? 0x147 : 0x188 : combo ? 0x146 : 0x18b,0,0]); return; }
    if (property === 'windowstate' && object.form) { const done = x.unique(), normal = x.unique(); this.ensure(object); x.api('user32.dll','IsIconic',[this.controlHandleRef(object)]).test().branch('e',normal).value(1).jump(done).label(normal).api('user32.dll','IsZoomed',[this.controlHandleRef(object)]).emit(0xd1,0xe0).label(done); return; }
    if (['scalewidth','scaleheight'].includes(property) && object.form) { this.ensure(object); x.api('user32.dll','GetClientRect',[this.controlHandleRef(object),object.rect]).value({memory:object.rect,addend:property === 'scalewidth' ? 8 : 12}); if(Number(object.form.properties.ScaleMode ?? 1)===1)x.emit(0x6b,0xc0,15); return; }
    this.fail('Native property is not lowered: ' + property);
  }
  setProperty(object, property, expr) {
    if (!object) this.fail('Unknown native assignment target'); const x = this.x;
    this.ensure(object);
    if (['text','caption'].includes(property) && object.model?.type !== 'Timer') { this.textExpression(expr); x.push().push(this.controlHandleRef(object)).invoke('user32.dll','SetWindowTextW'); return; }
    if (property === 'enabled' && object.model?.type === 'Timer' || property === 'interval' && object.model?.type === 'Timer') { this.numeric(expr); if (property === 'enabled') this.check('Boolean'); else x.compare(0).branch('l','error:5').compare(65535).branch('g','error:5'); x.store(property === 'enabled' ? object.enabled : object.interval); this.timer(object); return; }
    if (['enabled','visible'].includes(property)) { this.numeric(expr); this.check('Boolean'); x.emit(0xf7,0xd8); if (property === 'visible') x.emit(0x6b,0xc0,5); x.push().push(this.controlHandleRef(object)).invoke('user32.dll',property === 'enabled' ? 'EnableWindow' : 'ShowWindow'); return; }
    if (property === 'windowstate' && object.form) { const normal = x.unique(), minimize = x.unique(), done = x.unique(); this.numeric(expr); x.compare(0).branch('e',normal).compare(1).branch('e',minimize).compare(2).branch('ne','error:5').value(3).jump(done).label(minimize).value(6).jump(done).label(normal).value(9).label(done).push().push(this.controlHandleRef(object)).invoke('user32.dll','ShowWindow'); return; }
    if (property === 'value' && ['CheckBox','OptionButton'].includes(object.model?.type)) { this.numeric(expr); if (object.model.type === 'OptionButton') { this.check('Boolean'); x.emit(0xf7,0xd8); } x.compare(0).branch('l','error:5').compare(2).branch('g','error:5'); x.emit(0x89,0xc3).push(0).emit(0x53).push(0xf1).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW'); return; }
    if (property === 'listindex' && ['ListBox','ComboBox'].includes(object.model?.type)) { this.numeric(expr); x.emit(0x89,0xc3).push(0).emit(0x53).push(object.model.type === 'ComboBox' ? 0x14e : 0x186).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW'); return; }
    this.fail('Native assignment is not lowered: ' + property);
  }
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
  call(node) {
    const x = this.x, args = node.args, name = node.callee.kind === 'id' ? key(node.callee.name).replace(/\$$/,'') : null;
    if(this.errorCall(node))return;
    if(this.dateIntervalBuiltin(node,name))return;
    if(this.dateBuiltin(node,name))return;
    if(this.currencyBuiltin(node,name))return;
    if(this.numericBuiltin(node,name))return;
    if(this.stringBuiltin(node,name))return;
    if(name==='lbound'||name==='ubound'){this.arrayBoundCall(node,name==='ubound');return;}
    if (name === 'msgbox') {
      if (args.length < 1 || args.length > 3) this.fail('MsgBox expects one to three arguments');
      this.textExpression(args[0]); x.push(); this.numeric(args[1] || lit(0)); x.push(); this.textExpression(args[2] || lit(this.project.name)); x.emit(0x89,0xc2,0x59,0x5b,0x51,0x52,0x53).push(this.context.module.form ? mem(this.context.module.handle) : 0).invoke('user32.dll','MessageBoxW'); return;
    }
    if (['clng','cint','cbyte','cbool'].includes(name)) {
      if (args.length !== 1) this.fail(name + ' expects one argument');
      if (this.type(args[0]) === 'string') { const out = this.slot(x.unique('conversion')); this.expression(args[0]);x.push().call('native:string:numeric-text'); x.emit(0x89,0xc3).push(out).push(0).push(0x400).emit(0x53).invoke('oleaut32.dll','VarI4FromStr').compare(0x8002000a).branch('e','error:6').test().branch('s','error:13').value(mem(out)); } else this.numeric(args[0]);
      this.check({clng:'Long',cint:'Integer',cbyte:'Byte',cbool:'Boolean'}[name]); return;
    }
    if (name === 'cstr') { if (args.length !== 1) this.fail('CStr expects one argument'); this.textExpression(args[0]); return; }
    if (name === 'len') { if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail('Native Len requires text'); this.expression(args[0]); x.push().invoke('kernel32.dll','lstrlenW'); return; }
    if (name === 'strptr') { if (args.length !== 1 || this.type(args[0]) !== 'string') this.fail('StrPtr requires text'); this.expression(args[0]); return; }
    if (name === 'abs' || name === 'sgn') { if (args.length !== 1) this.fail(name + ' expects one argument'); this.numeric(args[0]); const done = x.unique(); if (name === 'abs') x.test().branch('ns',done).emit(0xf7,0xd8).branch('o','error:6').label(done); else { x.emit(0x99,0x85,0xc0,0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0x09,0xd0); } return; }
    if (name === 'beep') { if (args.length) this.fail('Beep takes no arguments'); x.api('user32.dll','MessageBeep',[0]); return; }
    if (node.callee.kind === 'member') {
      const object = this.object(node.callee.object), method = key(node.callee.name);
      if (object) {
        if (['show','hide','setfocus','additem','clear','removeitem'].includes(method)) this.ensure(object);
        if (method === 'show' && object.form) {
          if(args.length>2)this.fail('Native Show expects mode and optional owner');
          this.numeric(args[0] || lit(0));x.push();
          if(args[1]){const owner=this.object(args[1]);if(!owner?.form)this.fail('Native Show owner must be a form');this.handle(owner);}else x.api('user32.dll','GetActiveWindow');
          x.emit(0x59,0x50,0x51).call('show:'+object.name);return;
        }
        if (method === 'hide' && object.form && !args.length) { x.api('user32.dll','ShowWindow',[this.controlHandleRef(object),0]); return; }
        if (method === 'setfocus' && !args.length) { x.api('user32.dll','SetFocus',[this.controlHandleRef(object)]); return; }
        if (['ListBox','ComboBox'].includes(object.model?.type)) {
          const combo = object.model.type === 'ComboBox';
          if (method === 'additem' && args.length === 1) { this.textExpression(args[0]); x.push().push(0).push(combo ? 0x143 : 0x180).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW').test().branch('s','error:7'); return; }
          if (method === 'clear' && !args.length) { x.api('user32.dll','SendMessageW',[this.controlHandleRef(object),combo ? 0x14b : 0x184,0,0]); return; }
          if (method === 'removeitem' && args.length === 1) { this.numeric(args[0]); x.emit(0x89,0xc3).push(0).emit(0x53).push(combo ? 0x144 : 0x182).push(this.controlHandleRef(object)).invoke('user32.dll','SendMessageW').test().branch('s','error:5'); return; }
        }
      }
    }
    const target = this.resolveProcedure(node.callee);
    if (!target) this.fail('Native procedure is not available: ' + (name || node.callee.name));
    const plan=this.nativeCallPlan(target,args);
    if(target.module?.form && target.module!==this.context.module)x.call(target.module.initialize);
    this.nativeTypedCall(target,plan);
  }
  procedure(context) {
    this.context = context; const outer=this.x, body=new BinarySection('.body',0), x=this.x=new X86(body,this.image), code=context.proc.code, end=context.label+':return';
    // Lower first so temporary text buffers are stack-local, including recursive calls.
    x.sequence=outer.sequence;context.stringTemps=[];context.arrayPins=[];
    for (let i = 0; i < code.length; i++) {
      const ins = this.instruction = code[i]; x.label(context.label + ':' + i).call(context.label+':clear-strings');this.errorCheckpoint(context,i,ins);
      if(!context.module.nativeInternal)this.sourceMap.push({symbol:context.label + ':' + i,source:ins.source,line:ins.line,procedure:ins.procedure});
      if(this.errorInstruction(ins,context))continue;
      if (ins.op === 'dim') { for (const decl of ins.decls) if (!decl.constant && decl.initial) { this.storageExpression(context.locals.get(key(decl.name)),decl.initial); this.store(context.locals.get(key(decl.name))); } }
      else if (ins.op === 'assign') {
        if (ins.objectSet) this.fail('Native object assignment is not lowered');
        const variable = this.variable(ins.target);
        if (variable?.nativeArray && !variable.elementOf) this.assignArrayStorage(variable,ins.expr);
        else if (variable) { this.storageExpression(variable,ins.expr); this.store(variable); }
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
        const compare=(op,right)=>this.expression({kind:'binary',op,left:{kind:'id',name:variable.name},right});
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
    if(context.returnValue&&key(context.returnValue.type)==='string'){
      this.rawStorageAddress(context.returnValue);x.emit(0x8b,0x00);x.push();this.rawStorageAddress(context.returnValue);x.emit(0xc7,0x00,0,0,0,0,0x58);
    }else if(context.returnValue)this.load(context.returnValue);else x.value(0);
    const cleanup=context.label+':cleanup';x.jump(cleanup);
    x.label(context.label+':error-return').value(context.returnValue&&key(context.returnValue.type)==='currency'?this.currencyLiteral('0'):context.returnValue&&REAL_TYPES.has(key(context.returnValue.type))?this.floatLiteral(0):0);
    x.label(cleanup).push().call(context.label+':clear-strings');
    for(const variable of context.locals.values())if(!variable.label&&!variable.parameter){if(variable.nativeArray)this.destroyArrayStorage(variable);else if(key(variable.type)==='string')this.clearStringStorage(variable);}
    x.emit(0x58);this.leaveErrorFrame();if(context.returnValue&&key(context.returnValue.type)==='currency')x.emit(0x8b,0x50,4,0x8b,0x00);if(context.returnValue&&REAL_TYPES.has(key(context.returnValue.type)))x.emit(0xdd,0x00);x.leave(context.argumentBytes);
    this.emitErrorDispatch(context);
    x.label(context.label+':clear-strings');for(const pin of context.arrayPins)this.releaseArrayPin(pin);for(const variable of context.stringTemps)this.clearStringStorage(variable);x.emit(0xc3);
    this.instruction=null;this.x=outer;outer.sequence=x.sequence;outer.label(context.label).enter(context.size);
    for(const variable of [...context.locals.values(),...context.stringTemps,...context.arrayPins])if(!variable.parameter&&!variable.label)this.zeroStorage(variable);
    this.enterErrorFrame(context);
    for(const variable of context.locals.values())if(variable.ownedParameter){
      outer.value({argument:variable.incomingOffset}).push().call('native:string:copy').emit(0x89,0x85).imm(variable.offset);
    }
    for(const variable of context.locals.values()){
      if(!variable.label || variable.nativeArray)this.initializeFixedString(variable);
      else if(variable.fixedLength){const done=outer.unique();outer.value(mem(variable.initialized)).test().branch('ne',done);this.initializeFixedString(variable);outer.value(1).store(variable.initialized).label(done);}
    }
    const base=this.text.length;for(const [name,offset]of body.labels){if(this.text.labels.has(name))this.fail('Duplicate native label');this.text.labels.set(name,base+offset);}
    for(const fixup of body.fixups)this.text.fixups.push({...fixup,offset:base+fixup.offset});
    for(const byte of body.bytes)this.text.bytes.push(byte);
  }
  forTest(loop,variable,exit) {
    const x=this.x,negative=x.unique(),done=x.unique();
    const compare=(op,a,b)=>this.expression({kind:'binary',op,left:{kind:'id',name:a.name},right:typeof b==='number'?lit(b):{kind:'id',name:b.name}});
    compare('<',loop.stepVariable,0);x.test().branch('ne',negative);
    compare('>',variable,loop.endVariable);x.test().branch('ne',exit).jump(done).label(negative);
    compare('<',variable,loop.endVariable);x.test().branch('ne',exit).label(done);
  }
  handler(module, name, args = []) {
    const proc = module.procedures.get(key(name)); if (!proc) return;
    if(proc.proc.kind!=='sub') this.fail('Native event handler must be a Sub: '+name,module);
    if (proc.proc.params.some(p=>p.optional||p.paramArray))this.fail('Native event parameters cannot be Optional or ParamArray: '+name,module);
    if (proc.proc.params.length !== args.length) this.fail('Native event signature mismatch: ' + name,module);
    args.forEach((arg,i) => { const param = proc.proc.params[i]; if (arg.ref && (!param.byRef || key(param.type) !== 'integer')) this.fail('Native event requires ByRef Integer: ' + param.name,module); });
    for (const arg of [...args].reverse()) { if (arg.ref) this.x.local(arg.ref).push(); else this.x.push(arg); }
    this.x.call(proc.label);this.checkNativeError('native:error:fatal');
  }
  timer(control) {
    const x = this.x, skip = x.unique(); x.api('user32.dll','KillTimer',[mem(control.module.handle),control.id]);
    x.value(mem(control.enabled)).test().branch('e',skip).value(mem(control.interval)).test().branch('e',skip);
    x.api('user32.dll','SetTimer',[mem(control.module.handle),control.id,mem(control.interval),0]).test().branch('e','error:7').label(skip);
  }
  formStyle(module) {
    const p = module.form.properties, border = Number(p.BorderStyle ?? 2);
    if (![0,1,2,3,4,5].includes(border)) this.fail('Invalid native BorderStyle',module);
    if (border === 0) return 0x80000000;
    let style = 0xc00000;
    if (p.ControlBox !== 0) style |= 0x80000;
    if ([2,5].includes(border)) style |= 0x40000;
    if ([1,2].includes(border) && p.MinButton !== 0) style |= 0x20000;
    if (border === 2 && p.MaxButton !== 0) style |= 0x10000;
    return style | 0x02000000;
  }
  controls(module) {
    const x = this.x;
    const depth = control => {let count=0,parent=control.model.parent;while(parent){const p=module.controls.get(key(parent));if(!p||p.model.type!=='Frame'||++count>16)this.fail('Native controls currently nest only in Frames without cycles',module);parent=p.model.parent;}return count;};
    // Build containers before their children while preserving stable control IDs.
    const ordered=[...module.controls.values()].sort((a,b)=>depth(a)-depth(b));
    for (const control of ordered) {
      const model = control.model, p = model.properties;
      if (model.type === 'Timer') { this.timer(control); continue; }
      let style = 0x40000000 | (p.Visible === 0 ? 0 : 0x10000000) | (p.Enabled === 0 ? 0x08000000 : 0) | (p.TabStop === 0 ? 0 : 0x10000), ex = 0;
      if (model.type === 'TextBox') { ex = 0x200; style |= ({0:0,1:2,2:1})[Number(p.Alignment||0)]||0; style |= p.MultiLine ? 0x4 | 0x40 | 0x1000 : 0x80; if (p.Locked) style |= 0x800; if (p.PasswordChar) style |= 0x20; if (p.ScrollBars === 1 || p.ScrollBars === 3) style |= 0x100000; if (p.ScrollBars >= 2) style |= 0x200000; }
      if (model.type === 'CommandButton') style |= p.Default ? 1 : 0;
      if (model.type === 'Label') style = style & ~0x10000 | 0x100 | (({0:0,1:2,2:1})[Number(p.Alignment||0)]||0);
      if (model.type === 'CheckBox') style |= p.TripleState ? 6 : 3;
      if (model.type === 'OptionButton') style |= 9;
      if (model.type === 'Frame') style = style & ~0x10000 | 7 | 0x02000000;
      if (model.type === 'ListBox') { ex = 0x200; style |= 1 | 0x200000 | (p.Sorted ? 2 : 0); if (p.MultiSelect) this.fail('Native multi-selection ListBox is not lowered',module); }
      if (model.type === 'ComboBox') style |= 0x200000 | ([1,2].includes(Number(p.Style)) ? p.Style === 1 ? 1 : 3 : 2) | (p.Sorted ? 0x100 : 0);
      const left = Number(p.Left || 0), top = Number(p.Top || 0), parent = model.parent ? module.controls.get(key(model.parent)) : module;
      const width = this.pixels(p.Width ?? 1440), height = this.pixels(p.Height ?? 420) + (model.type === 'ComboBox' && p.Style !== 1 ? 160 : 0);
      x.api('user32.dll','CreateWindowExW',[ex,this.string(CLASSES[model.type]),this.string(p.Text ?? p.Caption ?? ''),style,this.pixels(left),this.pixels(top),width,height,mem(parent.handle),control.id,mem('instance'),0]).test().branch('e','error:7').store(control.handle);
      if (model.type === 'Frame') x.api('user32.dll','SetWindowLongW',[mem(control.handle),-4,'frame-procedure:'+module.name+':'+control.key]).test().branch('e','error:7').store(control.oldProcedure);
      this.applyNativeControlFont(control);
      if (model.type === 'TextBox' && p.MaxLength) x.api('user32.dll','SendMessageW',[mem(control.handle),0xc5,Number(p.MaxLength),0]);
      if (['CheckBox','OptionButton'].includes(model.type)) x.api('user32.dll','SendMessageW',[mem(control.handle),0xf1,p.Value ? 1 : 0,0]);
      if (['ListBox','ComboBox'].includes(model.type)) {
        for (const item of p.List || []) x.api('user32.dll','SendMessageW',[mem(control.handle),model.type === 'ListBox' ? 0x180 : 0x143,0,this.string(item)]);
        if (p.ListIndex !== undefined) x.api('user32.dll','SendMessageW',[mem(control.handle),model.type === 'ListBox' ? 0x186 : 0x14e,Number(p.ListIndex),0]);
      }
    }
  }
  pixels(value) { const n = Number(value) / 15; if (!Number.isFinite(n) || n < -32768 || n > 32767) this.fail('Native geometry is outside the supported range'); return Math.round(n); }
  menus(module) {
    const menus = module.form.menus || []; if (!menus.length) return;
    const x = this.x, used = new Set(); let next = 10000; module.menuCommands = new Map();
    const roots = menus.filter(m => !m.parent);
    const build = (items,handle,depth) => {
      if (depth > 16) this.fail('Native menu nesting limit exceeded',module);
      for (const menu of items) {
        if (used.has(key(menu.name))) this.fail('Duplicate or cyclic native menu',module); used.add(key(menu.name));
        if (menu.properties.Visible === 0) continue;
        let flags = (menu.properties.Enabled === 0 ? 1 : 0) | (menu.properties.Checked ? 8 : 0);
        const children = menus.filter(m => key(m.parent) === key(menu.name));
        if (children.length || menu.properties.WindowList) { const child = this.slot('menu:' + module.name + ':' + menu.name); x.api('user32.dll','CreatePopupMenu').test().branch('e','error:7').store(child); build(children,child,depth + 1); if (menu.properties.WindowList) module.windowMenu = child; x.api('user32.dll','AppendMenuW',[mem(handle),flags | 0x10,mem(child),this.string(menu.properties.Caption || menu.name)]); }
        else if (menu.properties.Caption === '-') x.api('user32.dll','AppendMenuW',[mem(handle),0x800,0,0]);
        else { const id = next++; if (next > 20000) this.fail('Native menu item limit exceeded',module); module.menuCommands.set(id,menu.name + '_Click'); x.api('user32.dll','AppendMenuW',[mem(handle),flags,id,this.string(menu.properties.Caption || menu.name)]); }
      }
    };
    x.api('user32.dll','CreateMenu').test().branch('e','error:7').store(module.menu); build(roots,module.menu,0);
    if (used.size < menus.filter(m => m.properties.Visible !== 0).length) this.fail('Unreachable or cyclic native menus',module);
  }
  form(module) {
    const x = this.x, prefix = module.form.type === 'MDIForm' ? 'MDIForm_' : 'Form_', p = module.form.properties;
    const done = x.unique(), wnd = 'wndproc:' + module.name, wc = 'wndclass:' + module.name;
    const style = this.formStyle(module), ex = Number(p.BorderStyle) >= 4 ? 0x80 : 0;
    this.data.align(4).label(wc).u32(3).reference(wnd).u32(0).u32(0).u32(0).u32(0).u32(0).u32(16).u32(0).reference(module.className);
    module.wc = wc;
    const initialized=x.unique();
    // Initialize a default form instance once, before window creation. Reentrant UI
    // access from Form_Initialize can load that form without recursively firing Initialize.
    x.label(module.initialize).enter().value(mem(module.initialized)).test().branch('ne',initialized).value(1).store(module.initialized);
    for (const variable of module.globals.values()) {
      this.context = {module,proc:{},locals:new Map()};if(variable.nativeArray)this.destroyArrayStorage(variable);else if(key(variable.type)==='string')this.clearStringStorage(variable);else this.zeroStorage(variable);this.initializeFixedString(variable);if(variable.initial){this.storageExpression(variable,variable.initial);this.store(variable);}
    }
    this.handler(module,prefix + 'Initialize');
    x.label(initialized).value(0).leave();
    x.label(module.create).enter().call(module.initialize).value(mem(module.handle)).test().branch('ne',done);
    this.menus(module);
    const width = this.pixels(p.ClientWidth ?? p.Width ?? 9000), height = this.pixels(p.ClientHeight ?? p.Height ?? 6000);
    x.value(0).store(module.rect).store(module.rect,4).value(width).store(module.rect,8).value(height).store(module.rect,12);
    x.api('user32.dll','AdjustWindowRectEx',[module.rect,style,module.form.menus?.length ? 1 : 0,ex]);
    if (p.MDIChild) {
      x.call(this.mdi.create);
      x.api('user32.dll','CreateMDIWindowW',[module.className,this.string(p.Caption || module.name),style,this.pixels(p.Left || 0),this.pixels(p.Top || 0),width,height,mem(this.mdi.client),mem('instance'),0]);
    } else {
      // AdjustWindowRectEx produces outer dimensions without assuming a title-bar height.
      x.value({memory:module.rect,addend:8}).emit(0x2b,0x05).addr(module.rect).emit(0x89,0xc6);
      x.value({memory:module.rect,addend:12}).emit(0x2b,0x05).addr(module.rect,4).emit(0x89,0xc7);
      x.push(0).push(mem('instance')).push(mem(module.menu)).push(0).emit(0x57,0x56);
      const position = Number(p.StartUpPosition) === 0;
      x.push(position ? this.pixels(p.Top || 0) : -2147483648).push(position ? this.pixels(p.Left || 0) : -2147483648).push(style).push(this.string(p.Caption || module.name)).push(module.className).push(ex).invoke('user32.dll','CreateWindowExW');
    }
    x.test().branch('e','error:7').store(module.handle);
    x.emit(0xff,0x05).addr('live-forms');
    if (module.form.type === 'MDIForm') {
      const clientInfo = this.slot('client-create:' + module.name,0); this.data.u32(30000); if (module.windowMenu) x.value(mem(module.windowMenu)).store(clientInfo);
      x.api('user32.dll','CreateWindowExW',[0,this.string('MDICLIENT'),this.string(''),0x50300000,0,0,width,height,mem(module.handle),1,mem('instance'),clientInfo]).test().branch('e','error:7').store(module.client);
    }
    this.controls(module); x.value(1).store(module.loaded); this.handler(module,prefix + 'Load');
    x.label(done).value(mem(module.handle)).leave();
    for(const control of module.controls.values())if(control.oldProcedure){
      const forward=x.unique();
      x.label('frame-procedure:'+module.name+':'+control.key).enter().value({argument:12}).compare(0x111).branch('e',forward);
      x.api('user32.dll','CallWindowProcW',[mem(control.oldProcedure),{argument:8},{argument:12},{argument:16},{argument:20}]).leave(16);
      x.label(forward).api('user32.dll','SendMessageW',[mem(module.handle),{argument:12},{argument:16},{argument:20}]).leave(16);
    }
    this.windowProcedure(module,wnd,prefix); this.showProcedure(module);
  }
  showProcedure(module) {
    const x=this.x, done=x.unique(), modeless=x.unique(), loop=x.unique(), finish=x.unique(), dispatch=x.unique(), interrupted=x.unique();
    const others=[...this.modules.values()].filter(m=>m.form&&m!==module);
    const saved=others.map((m,i)=>({module:m,hwnd:-40-i*8,enabled:-44-i*8}));
    const oldOwner=-48-others.length*8;
    x.label('show:'+module.name).enter(56+others.length*8);
    x.value({argument:8}).compare(0).branch('e',modeless).compare(1).branch('ne','error:5');
    if(module.form.properties.MDIChild)x.jump('error:5');
    // A nested message loop retains the caller's stack, VM-equivalent modal blocking.
    // Record HWND identity and enabled state so a recreated form is never modified on return.
    for(const item of saved){
      x.value(mem(item.module.handle)).emit(0x89,0x85).imm(item.hwnd).push().invoke('user32.dll','IsWindowEnabled').emit(0x89,0x85).imm(item.enabled);
      x.api('user32.dll','EnableWindow',[mem(item.module.handle),0]);
    }
    x.api('user32.dll','SetWindowLongW',[mem(module.handle),-8,{argument:12}]).emit(0x89,0x85).imm(oldOwner);
    x.api('user32.dll','ShowWindow',[mem(module.handle),5]).api('user32.dll','UpdateWindow',[mem(module.handle)]);
    x.label(loop).value(mem(module.handle)).test().branch('e',finish).push().invoke('user32.dll','IsWindowVisible').test().branch('e',finish);
    x.push(0).push(0).push(0).local(-32).push().invoke('user32.dll','GetMessageW').test().branch('e',interrupted).branch('s','error:5');
    x.local(-32).push().push(mem(module.handle)).invoke('user32.dll','IsDialogMessageW').test().branch('ne',loop);
    x.local(-32).push().invoke('user32.dll','TranslateMessage');x.local(-32).push().invoke('user32.dll','DispatchMessageW').jump(loop);
    x.label(interrupted).api('user32.dll','PostQuitMessage',[0]);
    x.label(finish);
    for(const item of saved){const skip=x.unique();x.value({argument:item.hwnd}).test().branch('e',skip).emit(0x3b,0x05).addr(item.module.handle).branch('ne',skip);x.api('user32.dll','EnableWindow',[{argument:item.hwnd},{argument:item.enabled}]).label(skip);}
    const noWindow=x.unique();x.value(mem(module.handle)).test().branch('e',noWindow).api('user32.dll','SetWindowLongW',[mem(module.handle),-8,{argument:oldOwner}]).label(noWindow);
    x.api('user32.dll','SetActiveWindow',[{argument:12}]).jump(done);
    x.label(modeless).api('user32.dll','ShowWindow',[mem(module.handle),5]).api('user32.dll','UpdateWindow',[mem(module.handle)]);
    x.label(done).value(0).leave(8);
  }
  windowProcedure(module,wnd,prefix) {
    const x = this.x, fallback = x.unique(), zero = x.unique(), exit = x.unique(), close = x.unique(), destroy = x.unique(), command = x.unique(), timer = x.unique(), size = x.unique(), focus = x.unique();
    x.label(wnd).enter(16);this.enterCallbackBoundary(-12);
    x.value({argument:12}).compare(2).branch('e',destroy).compare(0x10).branch('e',close);
    x.value(mem(module.loaded)).test().branch('e',fallback);
    x.value({argument:12}).compare(0x111).branch('e',command).compare(0x113).branch('e',timer).compare(5).branch('e',size).compare(6).branch('e',focus).jump(fallback);
    x.label(command).value({argument:16}).emit(0x89,0xc3,0x25).imm(65535);
    for (const control of module.controls.values()) {
      if (control.model.type === 'Timer') continue;
      const next = x.unique(); x.compare(control.id).branch('ne',next).emit(0xc1,0xeb,16);
      const events = control.model.type === 'TextBox' ? [[0x300,'Change']] : control.model.type === 'ComboBox' ? [[1,'Click'],[5,'Change']] : control.model.type === 'ListBox' ? [[1,'Click'],[2,'DblClick']] : [[0,'Click'],[1,'DblClick']];
      for (const [code,event] of events) { const another = x.unique(); x.emit(0x83,0xfb,code & 255); if (code > 127) { // Replace sign-extended short comparison with imm32.
          this.text.bytes.splice(this.text.bytes.length - 3,3); x.emit(0x81,0xfb).imm(code);
        } x.branch('ne',another); this.controlHandler(module,control,event); x.jump(zero).label(another); }
      x.jump(fallback).label(next);
    }
    for (const [id,event] of module.menuCommands || []) { const next = x.unique(); x.compare(id).branch('ne',next); this.handler(module,event); x.jump(zero).label(next); }
    x.jump(fallback);
    x.label(timer).value({argument:16});
    for (const control of module.controls.values()) if (control.model.type === 'Timer') { const next = x.unique(); x.compare(control.id).branch('ne',next); this.controlHandler(module,control,'Timer'); x.jump(zero).label(next); }
    x.jump(fallback);
    x.label(size);
    if (module.form.type === 'MDIForm') {
      x.api('user32.dll','GetClientRect',[{argument:8},module.rect]);
      x.api('user32.dll','MoveWindow',[mem(module.client),0,0,{memory:module.rect,addend:8},{memory:module.rect,addend:12},1]);
    }
    this.handler(module,prefix + 'Resize'); x.jump(fallback);
    x.label(focus).value({argument:16}).emit(0x25).imm(65535).test(); const deactivate = x.unique(); x.branch('e',deactivate); this.handler(module,prefix + 'Activate'); x.jump(fallback).label(deactivate); this.handler(module,prefix + 'Deactivate'); x.jump(fallback);
    x.label(close).value(mem(module.loaded)).test().branch('e',fallback).value(0).emit(0x89,0x45,0xfc).value({argument:16}).emit(0x89,0x45,0xf8);
    this.handler(module,prefix + 'QueryUnload',[{ref:-4},{ref:-8}]); x.emit(0x83,0x7d,0xfc,0).branch('ne',zero);
    if(module.form.type==='MDIForm')for(const child of this.modules.values())if(child.form?.properties.MDIChild){
      const skip=x.unique();x.value(mem(child.handle)).test().branch('e',skip).api('user32.dll','SendMessageW',[mem(child.handle),0x10,2,0]);x.value(mem(child.handle)).test().branch('ne',zero).label(skip);
    }
    this.handler(module,prefix + 'Unload',[{ref:-4}]); x.emit(0x83,0x7d,0xfc,0).branch('ne',zero);
    if(module.form.properties.MDIChild)x.api('user32.dll','SendMessageW',[mem(this.mdi.client),0x221,{argument:8},0]);else x.api('user32.dll','DestroyWindow',[{argument:8}]);x.jump(zero);
    x.label(destroy).value(mem(module.handle)).test().branch('e',zero).value(0).store(module.handle).store(module.loaded).store(module.initialized).store(module.client).store(module.menu);
    for (const control of module.controls.values()) x.store(control.handle);
    x.emit(0xff,0x0d).addr('live-forms').value(mem('live-forms')).test().branch('ne',zero).api('user32.dll','PostQuitMessage',[0]).jump(zero);
    x.label(fallback);
    if (module.form.type === 'MDIForm') x.api('user32.dll','DefFrameProcW',[{argument:8},mem(module.client),{argument:12},{argument:16},{argument:20}]);
    else x.api('user32.dll',module.form.properties.MDIChild ? 'DefMDIChildProcW' : 'DefWindowProcW',[{argument:8},{argument:12},{argument:16},{argument:20}]);
    x.jump(exit).label(zero).value(0).label(exit);this.leaveCallbackBoundary(-12);x.leave(16);
  }
  helpers() {
    const x = this.x;
    emitNativeNumericHelpers(this);emitNativeCurrencyHelpers(this);emitNativeDateHelpers(this);emitNativeDateIntervalHelpers(this);
    emitNativeStorageHelpers(this);
    emitNativeArrayHelpers(this);
    // int-to-string(value, buffer), including INT_MIN without signed negation overflow.
    const positive = x.unique(), digits = x.unique(), copy = x.unique(), done = x.unique();
    x.label('int-to-string').enter(64).value({argument:8}).emit(0x89,0xc3).value({argument:12}).emit(0x89,0xc7,0x89,0xd8,0x85,0xc0).branch('ns',positive);
    x.emit(0x66,0xc7,0x07,45,0,0x83,0xc7,2,0xf7,0xd8);
    x.label(positive).local(-2).emit(0x89,0xc6,0x89,0xd8,0x85,0xc0); const magnitude = x.unique(); x.branch('ns',magnitude).emit(0xf7,0xd8).label(magnitude).emit(0x31,0xdb);
    x.label(digits).emit(0x31,0xd2,0xb9).imm(10).emit(0xf7,0xf1,0x80,0xc2,48,0x66,0x89,0x16,0x83,0xee,2,0x43,0x85,0xc0).branch('ne',digits);
    x.label(copy).emit(0x83,0xc6,2,0x66,0x8b,0x06,0x66,0x89,0x07,0x83,0xc7,2,0x4b).branch('ne',copy).emit(0x66,0xc7,0x07,0,0).value({argument:12}).leave(8);
    emitNativeErrorHelpers(this);
  }
  build() {
    for (const module of this.modules.values()) for (const proc of module.procedures.values()) this.procedure(proc);
    for (const module of this.modules.values()) if (module.form) this.form(module);
    emitNativeCallbackHelpers(this);
    this.helpers(); this.context = null; this.instruction = null;
    const x = this.x, loop = x.unique(), dispatch = x.unique(), quit = x.unique();
    x.label('entry').api('kernel32.dll','GetModuleHandleW',[0]).store('instance');
    if(this.nativeCallbacks?.size)x.api('kernel32.dll','GetCurrentThreadId').store('native:callback:thread');
    for (const module of this.modules.values()) if (module.form) {
      x.value(mem('instance')).store(module.wc,16).api('user32.dll','LoadCursorW',[0,32512]).store(module.wc,24);
      x.api('user32.dll','RegisterClassW',[module.wc]).test().branch('e','error:7');
    }
    for(const module of this.modules.values())if(!module.form)for(const variable of module.globals.values())this.initializeFixedString(variable);
    for (const module of this.modules.values()) if (!module.form) { this.context = {module,proc:{},locals:new Map()}; for (const variable of module.globals.values()) if (variable.initial) { this.storageExpression(variable,variable.initial); this.store(variable); } }
    if (key(this.project.startup) === 'sub main') {
      const candidates = [...this.modules.values()].filter(m => !m.form).map(m => m.procedures.get('main')).filter(Boolean);
      if (candidates.length !== 1 || candidates[0].proc.params.length) this.fail('Native Sub Main startup must be unique and parameterless'); x.call(candidates[0].label);this.checkNativeError('native:error:fatal');
    } else {
      const startup = this.modules.get(key(this.project.startup)); if (!startup?.form) this.fail('Native startup form was not found');
      x.call(startup.create).api('user32.dll','ShowWindow',[mem(startup.handle),Number(startup.form.properties.WindowState) === 2 ? 3 : Number(startup.form.properties.WindowState) === 1 ? 6 : 5]);
    }
    x.value(mem('live-forms')).test().branch('e',quit);
    x.label(loop).api('user32.dll','GetMessageW',['msg',0,0,0]).test().branch('e',quit).branch('s','error:5');
    if (this.mdi) x.api('user32.dll','TranslateMDISysAccel',[mem(this.mdi.client),'msg']).test().branch('ne',loop);
    for (const module of this.modules.values()) if (module.form) { const next = x.unique(); x.value(mem(module.handle)).test().branch('e',next).api('user32.dll','IsDialogMessageW',[mem(module.handle),'msg']).test().branch('ne',loop).label(next); }
    x.label(dispatch).api('user32.dll','TranslateMessage',['msg']).api('user32.dll','DispatchMessageW',['msg']).jump(loop).label(quit).api('kernel32.dll','ExitProcess',[0]);
    this.image.manifest('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="x86" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency></assembly>');
    const linked = this.image.finish('entry');
    return {bytes:linked.bytes,report:{target:'win32-aot',architecture:'x86',format:'PE32',extraction:false,arrayLimits:{maxBytes:this.maxArrayBytes,maxRank:60},runtime:'Win32 system DLLs; no embedded JavaScript engine or VB6 runtime',graphics:'native Windows controls / GDI, not WebGPU',size:linked.bytes.length,imports:linked.imports,sections:linked.sections,sourceMap:this.sourceMap.map(s => ({...s,rva:linked.symbols[s.symbol]})),callbacks:[...(this.nativeCallbacks?.values()||[])].map(({target,label})=>({module:target.module.name,procedure:target.proc.name,rva:linked.symbols[label],argumentBytes:target.argumentBytes,thread:'application',convention:'stdcall'})),limits:['Typed integer/Single/Double/Currency/Date/String storage, fixed/dynamic arrays and error recovery; unsupported VB constructs fail compilation.','Native controls use Windows theme/font metrics, not pixel-identical VB6 styling.','WebGPU remains a separate Electron target.']}};
  }
}
Object.assign(NativeCompiler.prototype,nativeCallbackMethods,nativeCallMethods,nativeBindingMethods,nativeStorageMethods,nativeErrorMethods,nativeArrayMethods,nativeNumericMethods,nativeControlArrayMethods,nativeCurrencyMethods,nativeDateMethods,nativeDateIntervalMethods);
export function compileWin32(project, options = {}) {
  if (options.graphics && options.graphics !== 'gdi') throw new NativeCompileError('The freestanding Win32 target uses native controls/GDI; use the desktop target for WebGPU');
  if (options.arch && options.arch !== 'x86') throw new NativeCompileError('The freestanding compiler currently emits x86 PE32');
  if (!project || !Array.isArray(project.modules) || project.modules.length > 128) throw new NativeCompileError('Native project must contain at most 128 modules');
  return new NativeCompiler(project,options).build();
}
