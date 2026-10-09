import {nativeMathMethods,emitNativeMathHelpers} from './math-intrinsics.js';
import {emitNativeRecordStringHelpers} from './record-strings.js';
import {nativeCompilerStateMethods} from './compiler-state.js';
import {nativeCompilerExpressionMethods} from './compiler-expressions.js';
import {nativeCompilerProcedureMethods} from './compiler-procedures.js';
import {nativeCompilerFormMethods} from './compiler-forms.js';
import {nativeVariantMethods} from './variants.js';
import {emitNativeVariantHelpers} from './variant-kernels.js';
import {normalizeNativeTabPages} from './control-tabs.js';
import {nativeControlMethods} from './controls.js';
import {NATIVE_STRING_CONSTANTS,nativeStringLibraryMethods,emitNativeStringLibraryHelpers} from './string-library.js';
import {nativeIntegerMethods} from './integers.js';
import {nativeFlowMethods,nativeGoSubLimit} from './control-flow.js';
import {nativeOptimizationLevel} from './optimizer.js';
import {nativeOptimizationMethods} from './optimization.js';
import {NativeRecordLayouts,nativeRecordMethods} from './records.js';
import {THEMES} from '../theme/theme.js';
import {nativeLayoutMethods} from './layout.js';
import {normalizeProject} from '../project/model.js';
import {compileProject} from '../language/compiler.js';
import {NativeCompileError,extractNativeDeclarations,lowerNativeDeclarations} from './declarations.js';
export {NativeCompileError,extractNativeDeclarations};
import {PE32Image, BinarySection} from './pe32.js';
import {X86} from './x86.js';
import {nativeBindingMethods} from './bindings.js';
import {nativeStringInteropMethods,emitNativeStringInteropHelpers} from './string-interop.js';
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

import {key,lit,mem,INT_TYPES,BOOL_CONDITIONS,CONSTANTS} from './compiler-constants.js';
class NativeCompiler {
  get context() { return this.nativeContext; }
  set context(value) { this.nativeContext=value; this.typeCache=new WeakMap(); }
  constructor(project, options = {}) {
    try { this.optimization=nativeOptimizationLevel(options.optimization);this.maxGoSubDepth=nativeGoSubLimit(options.maxGoSubDepth); } catch(error) { this.fail(error.message); }
    this.pruneUnusedProcedures=options.pruneUnusedProcedures===undefined?false:options.pruneUnusedProcedures;
    if(typeof this.pruneUnusedProcedures!=='boolean'||this.pruneUnusedProcedures&&this.optimization!==2)this.fail('pruneUnusedProcedures requires a Boolean and optimization 2');
    this.optimizationStats={constantsFolded:0,immediateOperations:0,constantsPropagated:0,directBranches:0,constantBranches:0,jumpTables:0};
    this.maxArrayBytes=nativeArrayLimit(options.maxArrayBytes, message=>this.fail(message));
    try{this.project=normalizeNativeTabPages(normalizeProject(project));}catch(error){this.fail(error.message);}
    this.externals = new Map();
    if(THEMES[this.project.settings.theme]?.family) this.fail('Optional application theme '+this.project.settings.theme+' requires the HTML or Electron desktop target; native Win32 AOT uses system-managed controls. Choose a classic application theme for this target.');
    if (this.project.dataSources?.connections?.length || this.project.modules.some(m => m.form?.controls?.some(c => c.properties?.DataSource || c.properties?.DataMember || /^(?:Data|Adodc)$/i.test(c.type)))) this.fail('Data-source providers and data-bound controls require the HTML or Electron desktop target; freestanding PE32 AOT does not implement the data runtime');
    // Native resource intrinsics retain their required resources at use sites.
    const targetType = project.nativeProject?.entries?.find(e => key(e.key) === 'type')?.value;
    if (targetType && key(targetType) !== 'exe') this.fail('Freestanding AOT currently requires a Standard EXE project');
    this.program = compileProject(this.project);
    if (!this.program.valid) { const error = new NativeCompileError('Project contains compile errors'); error.diagnostics = this.program.diagnostics; error.message = error.diagnostics.map(d => `${d.source}:${d.line}: ${d.message}`).join('\n'); throw error; }
    for (const module of this.program.modules.values()) this.externals.set(key(module.name),lowerNativeDeclarations(module));
    this.recordLayouts=new NativeRecordLayouts(this.program,message=>this.fail(message));
    for(const module of this.program.modules.values())for(const declaration of this.externals.get(key(module.name)).values())for(const p of declaration.params)if(!INT_TYPES.has(key(p.type))&&!REAL_TYPES.has(key(p.type))&&!['currency','string','any'].includes(key(p.type))){p.nativeRecord=this.recordLayouts.resolve(p.type,module);if(!p.nativeRecord||!p.byRef)this.fail('Native Declare record parameters require a known ByRef POD record: '+p.type,module);}
    this.image = new PE32Image(); this.text = this.image.section('.text', 0x60000020); this.ro = this.image.section('.rdata', 0x40000040); this.data = this.image.section('.data', 0xc0000040);
    this.x = new X86(this.text, this.image); this.modules = new Map(); this.strings = new Map(); this.sourceMap = []; this.bufferCount = 0;
    this.slot('instance'); this.slot('live-forms'); this.data.align(4).label('msg').zero(32);
    this.title = this.string(project.name); this.errorTitle = this.string('VB6 native runtime error'); this.prepareErrors();
    for (const module of this.program.modules.values()) this.prepareModule(module);
    const parents = [...this.modules.values()].filter(m => m.form?.type === 'MDIForm');
    if (parents.length > 1) this.fail('Only one MDI parent is supported'); this.mdi = parents[0];
    for (const module of this.modules.values()) if (module.form?.properties.MDIChild && !this.mdi) this.fail('MDI child requires an MDIForm', module);
    this.prepareNativeTabPages();this.prepareLayout();this.prepareGridKernel();this.prepareChartKernel();
  }
  fail(message, context = this.context) { throw new NativeCompileError(message, context?.module?.name || context?.name || '', this.instruction?.line || context?.proc?.line || 0); }
  slot(label, value = 0) { this.data.align(4).label(label).u32(value); return label; }
  string(text) { text = String(text); if (text.length > MAX_NATIVE_STRING) this.fail('Native text exceeds 1,048,576 UTF-16 units'); if (!this.strings.has(text)) { const name = 'string:' + this.strings.size; this.ro.align(4).u32(text.length * 2).label(name).utf16(text); this.strings.set(text,name); } return this.strings.get(text); }
  buffer() { if(this.context?.proc?.name) { this.context.size+=8192; if(this.context.size>512*1024)this.fail('Native procedure text workspace exceeds 512 KiB'); return {address:-this.context.size}; } if (++this.bufferCount > 1024) this.fail('Native text-buffer limit exceeded'); const name = 'buffer:' + this.bufferCount; this.data.align(4).label(name).zero(8192); return name; }
  helpers() {
    const x = this.x;
    emitNativeRecordStringHelpers(this);emitNativeMathHelpers(this);
    emitNativeNumericHelpers(this);emitNativeCurrencyHelpers(this);emitNativeDateHelpers(this);emitNativeDateIntervalHelpers(this);
    emitNativeStorageHelpers(this);emitNativeStringLibraryHelpers(this);
    emitNativeArrayHelpers(this);
    this.emitNativeGridEditHelpers();this.emitNativePictureHelpers();this.emitNativeImageListHelpers();this.emitNativeDialogHelpers();this.emitNativeControlTextHelpers();this.emitNativeRichTextHelpers();this.emitNativeRangeHelpers();this.emitNativeFileHelpers();this.emitNativeFontHelpers();this.emitNativeInputHelpers();this.emitNativeTabHelpers();this.emitNativeTabTextHelpers();this.emitNativeColorHelpers();this.emitNativeDrawingHelpers();
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
    for (const module of this.modules.values()) if(module!==this.gridModule&&module!==this.chartModule)for (const proc of module.procedures.values()) this.procedure(proc);
    for (const module of this.modules.values()) if (module.form) this.form(module);
    this.emitGridKernel();this.emitChartKernel();
    emitNativeStringInteropHelpers(this);
    emitNativeCallbackHelpers(this);
    this.helpers(); this.context = null; this.instruction = null;
    const x = this.x, loop = x.unique(), dispatch = x.unique(), quit = x.unique();
    x.label('entry').api('kernel32.dll','GetModuleHandleW',[0]).store('instance');
    this.initializeNativeControlLibraries();
    if(this.nativeCallbacks?.size)x.api('kernel32.dll','GetCurrentThreadId').store('native:callback:thread');
    for (const module of this.modules.values()) if (module.form) {
      x.value(mem('instance')).store(module.wc,16).api('user32.dll','LoadCursorW',[0,32512]).store(module.wc,24);
      x.api('user32.dll','RegisterClassW',[module.wc]).test().branch('e','error:7');
    }
    for(const module of this.modules.values())if(!module.form)for(const variable of module.globals.values())this.initializeFixedString(variable);
    for (const module of this.modules.values()) if (!module.form) { this.context = {module,proc:{},locals:new Map()}; for (const variable of module.globals.values()) if (variable.initial) { const first=this.globalVariantTemps?.length||0;this.storageExpression(variable,variable.initial);this.store(variable);for(const temp of (this.globalVariantTemps||[]).slice(first))this.clearVariantStorage(temp); } }
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
    x.label(dispatch).api('user32.dll','TranslateMessage',['msg']).api('user32.dll','DispatchMessageW',['msg']).jump(loop).label(quit);this.shutdownNativePictures();x.api('kernel32.dll','ExitProcess',[0]);
    emitNativeVariantHelpers(this);
    this.image.manifest('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo><dependency><dependentAssembly><assemblyIdentity type="win32" name="Microsoft.Windows.Common-Controls" version="6.0.0.0" processorArchitecture="x86" publicKeyToken="6595b64144ccf1df" language="*"/></dependentAssembly></dependency></assembly>',this.nativePictureResources());
    const linked = this.image.finish('entry',{optimization:this.optimization,pruneUnusedProcedures:this.pruneUnusedProcedures});
    return {bytes:linked.bytes,report:{controls:this.nativeControlsReport(),optimization:{...linked.optimization,...this.optimizationStats},records:[...this.recordLayouts.layouts.values()].map(r=>({name:r.id,size:r.size,fileSize:r.fileSize,alignment:r.alignment,fields:[...r.fields.values()].map(f=>({name:f.name,type:f.type,offset:f.recordOffset,bytes:f.nativeBytes}))})),...(this.layoutModule?{layout:{enabled:true,kernel:'private VB-to-x86',logicalUnit:'twip',rounding:'nearest HWND pixel',nodes:this.layoutSeed.count,features:['anchor-16-masks','nested-containers','min-max','dock','horizontal','vertical','wrap','suspend-resume']}}:{}),target:'win32-aot',architecture:'x86',format:'PE32',extraction:false,arrayLimits:{maxBytes:this.maxArrayBytes,maxRank:60},controlFlow:{maxGoSubDepth:this.maxGoSubDepth,withRecords:true,computedBranches:true},runtime:'Win32 system DLLs; no embedded JavaScript engine or VB6 runtime',graphics:'native Windows controls / GDI, not WebGPU',size:linked.bytes.length,imports:linked.imports,sections:linked.sections,sourceMap:this.sourceMap.map(s => ({...s,rva:linked.symbols[s.symbol]??null,...(linked.symbols[s.symbol]===undefined?{optimizedOut:true}:{})})),callbacks:[...(this.nativeCallbacks?.values()||[])].map(({target,label})=>({module:target.module.name,procedure:target.proc.name,rva:linked.symbols[label],argumentBytes:target.argumentBytes,thread:'application',convention:'stdcall'})),limits:['Typed scalars, owned Variants/Decimal, Variant-contained arrays, ParamArray, typed arrays, POD records and error recovery; managed records, classes, Object/IDispatch and unsupported VB constructs fail compilation.','Native controls use Windows theme/font metrics, not pixel-identical VB6 styling.','WebGPU remains a separate Electron target.']}};
  }
}
Object.assign(NativeCompiler.prototype,nativeCompilerStateMethods,nativeCompilerExpressionMethods,nativeCompilerProcedureMethods,nativeCompilerFormMethods,nativeVariantMethods,nativeControlMethods,nativeStringLibraryMethods,nativeFlowMethods,nativeIntegerMethods,nativeOptimizationMethods,nativeLayoutMethods,nativeStringInteropMethods,nativeCallbackMethods,nativeCallMethods,nativeBindingMethods,nativeStorageMethods,nativeErrorMethods,nativeArrayMethods,nativeNumericMethods,nativeControlArrayMethods,nativeCurrencyMethods,nativeDateMethods,nativeDateIntervalMethods,nativeRecordMethods,nativeMathMethods);
export function compileWin32(project, options = {}) {
  if (options.graphics && options.graphics !== 'gdi') throw new NativeCompileError('The freestanding Win32 target uses native controls/GDI; use the desktop target for WebGPU');
  if (options.arch && options.arch !== 'x86') throw new NativeCompileError('The freestanding compiler currently emits x86 PE32');
  if (!project || !Array.isArray(project.modules) || project.modules.length > 128) throw new NativeCompileError('Native project must contain at most 128 modules');
  return new NativeCompiler(project,options).build();
}
