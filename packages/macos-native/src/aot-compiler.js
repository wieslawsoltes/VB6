import {setTargetConditionalConstants} from '../../../src/language/pascal/target-symbols.js';
import {prepareMacOSResources} from './resources.js';
import {macOSAppearanceReport} from './macos26-appearance.js';
/** Bound VB6 IR -> actual ARM64 procedures using the existing native value ABI.
 * Metadata describes literals/types/forms, never an executable AST or opcode stream. */
import {compileProject} from '../../../src/language/compiler.js';
import {normalizeProject} from '../../../src/project/model.js';
import {parseExpression} from '../../../src/language/expression.js';
import {literalScalar,signedLiteralScalar,VBScalar,NOTHING,MISSING} from '../../../src/runtime/values.js';
import {dateToSerial} from '../../../src/runtime/calendar.js';
import {MacOSLowering} from './compiler.js';
import {macOSOptions,MacOSCompileError} from './target.js';
import {macOSControlReport,resolveMacOSDeclaration} from './catalog.js';
import {AOTFunction,emitAOTFunctions} from './aot-emitter.js';
import {AOT_ABI} from './aot-abi.js';
const lower=v=>String(v).toLowerCase();
export function aotScalar(input){
  let type,value,variant=false;
  if(input===NOTHING||input?.__nothing)type='nothing';
  else if(input===MISSING||input?.__missing)type='missing';
  else if(input===undefined)type='empty';else if(input===null)type='null';
  else if(Array.isArray(input)){type='array';value=input.map(aotScalar);}
  else {
    const scalar=input instanceof VBScalar?input:null;value=scalar?scalar.value:input;variant=!!scalar?.variant;
    type=scalar?.type||(typeof value==='boolean'?'boolean':typeof value==='string'?'string':typeof value==='number'?(Number.isInteger(value)&&value>=-32768&&value<=32767?'integer':Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?'long':'double'):value instanceof Date?'date':null);
    if(type==='boolean')value=value?'-1':'0';
    else if(type==='date')value=String(dateToSerial(value));
    else if(type==='error'){if(value===MISSING)type='missing';else value=String(value.number);}
    else if(type==='currency'||type==='decimal')value=value.toString();
    else if(['integer','long','single','double','byte'].includes(type)){if(!Number.isFinite(value))throw new MacOSCompileError('Nonfinite AOT constant');value=Object.is(value,-0)?'-0':String(value);}
    if(!type)throw new MacOSCompileError('Constant cannot be represented by the AOT native ABI');
  }
  return {type,variant,...(value===undefined?{}:{value})};
}
export class DirectLowering extends MacOSLowering {
  // The helper-call graph and VB6 binder are shared by native targets. Defaults
  // preserve the macOS code generator and its existing diagnostics exactly.
  constructor(program,options,platform={}){super(program,options);this.platform=platform;this.functions=[];this.names=[];this.nameIds=new Map();this.literals=[];this.literalIds=new Map();this.modules=[];this.depth=0;this.n('');}
  fail(message,code='MAC100'){if(!this.platform.CompileError)return super.fail(message,code);throw new this.platform.CompileError(message,this.module?.name,this.instruction?.line||this.procedure?.line||1,code.replace(/^MAC/,this.platform.diagnosticPrefix||'NATIVE'));}
  n(value){value=String(value);if(!this.nameIds.has(value)){this.nameIds.set(value,this.names.length);this.names.push(value);}return this.nameIds.get(value);}
  literalId(value){const item=aotScalar(value),key=JSON.stringify(item);if(!this.literalIds.has(key)){this.literalIds.set(key,this.literals.length);this.literals.push(item);}return this.literalIds.get(key);}
  literal(value){return this.f.call('literal',this.literalId(value));}
  expression(node){
    if(++this.depth>256)this.fail('AOT expression nesting exceeds 256 levels','MACA201');
    try{return this.expressionInner(node);}finally{--this.depth;}
  }
  expressionInner(node){
    if(!node)return this.literal(MISSING);
    const constant=this.constant(node);if(constant)return this.literal(Object.hasOwn(constant,'nativeValue')?constant.nativeValue:constant);
    const f=this.f,e=n=>this.expression(n);
    switch(node.kind){
      case 'literal':case 'currency':case 'date':return this.literal(literalScalar(node));
      case 'empty':return this.literal(undefined);case 'nothing':return this.literal(NOTHING);case 'missing':return this.literal(MISSING);
      case 'group':case 'byval':return e(node.expr);
      case 'id':return f.call('get',this.n(node.name));case 'with':return f.call('with',this.n(this.instruction?.withId||''));case 'new':return f.call('create',this.n(node.name));
      case 'member':return f.call('member',e(node.object),this.n(node.name));
      case 'call':{const c=node.callee;if(c.kind==='id')return f.call('call',this.n(c.name),this.arguments(node.args));
        if(c.kind==='member'){const receiver=e(c.object),args=this.arguments(node.args);return f.call('call_member',receiver,this.n(c.name),args);}
        return f.call('call_value',e(c),this.arguments(node.args));}
      case 'unary':{const literal=signedLiteralScalar(node);return literal?this.literal(literal):f.call('unary',this.n(node.op),e(node.expr));}
      case 'binary':return f.call('binary',this.n(node.op),e(node.left),e(node.right));
      case 'typeof':return f.call('is_type',e(node.expr),this.n(node.name));
      case 'addressOf':{
        const parts=node.name.split('.'),name=lower(parts.pop());let owners;
        if(parts.length)owners=[this.program.modules.get(lower(parts.join('.')))];else if(this.module.procedures.has(name))owners=[this.module];else owners=[...this.program.modules.values()].filter(m=>m.kind==='module'&&m.procedures.has(name)&&m.procedures.get(name).scope!=='private');
        owners=owners.filter(Boolean);if(owners.length!==1||owners[0].kind!=='module')this.fail('AddressOf must resolve one standard-module procedure','MAC230');
        const p=owners[0].procedures.get(name);if(!p||p.external||p.returnArray||p.params.some(p=>p.optional||p.paramArray||p.byRef||p.bounds!==null&&p.bounds!==undefined))this.fail('Native callbacks require fixed ByVal scalar parameters','MAC230');
        this.platform.validateCallback?.(node,this,owners[0],p);
        return f.call('callback',this.n(owners[0].name),this.n(p.name));
      }
      default:this.fail('Unsupported AOT expression '+node.kind,'MACA100');
    }
  }
  reference(node){
    const f=this.f;if(node.kind==='id')return f.call('ref',this.n(node.name));
    if(node.kind==='member')return f.call('member_ref',this.expression(node.object),this.n(node.name));
    if(node.kind==='call'){
      if(node.args.length===0&&node.callee.kind==='id'&&this.canReference(node))return this.reference(node.callee);
      if(node.callee.kind==='member'){const receiver=this.expression(node.callee.object),hold=f.call('retain',receiver),args=this.arguments(node.args),out=f.call('object_ref',receiver,this.n(node.callee.name),args);f.call('release',hold);return out;}
      if(node.callee.kind==='id'&&this.procedure?.returnArray&&lower(this.procedure.name)===lower(node.callee.name)){const receiver=f.call('get',this.n(node.callee.name)),hold=f.call('retain',receiver),out=f.call('index_ref',receiver,this.values(node.args.map(a=>a.kind==='named'?a.expr:a),false));f.call('release',hold);return out;}
      if(node.callee.kind==='id'&&['get','let','set'].some(a=>this.module.procedures.has(lower(node.callee.name)+':'+a)))return f.call('property_ref',this.n(node.callee.name),this.arguments(node.args));
      const receiver=this.expression(node.callee),hold=f.call('retain',receiver),out=f.call('index_ref',receiver,this.values(node.args.map(a=>a.kind==='named'?a.expr:a),false));f.call('release',hold);return out;
    }
    this.fail('AOT assignment target is not a variable, member or indexed reference','MACA101');
  }
  arguments(nodes){const args=this.f.call('args');for(let node of nodes){let name='';if(node.kind==='named'){name=node.name;node=node.expr;}const reference=this.canReference(node),value=reference?this.reference(node):this.expression(node);this.f.call(reference?'arg_ref':'arg_value',args,value,this.n(name),reference&&node.kind==='call'&&node.callee.kind!=='id'?1:0);}return args;}
  values(nodes,scalar=true){const out=this.f.call('values');for(const node of nodes)this.f.call('value_push',out,this.expression(node),scalar?1:0);return out;}
  references(nodes){const out=this.f.call('refs');for(const node of nodes)this.f.call('ref_push',out,this.reference(node));return out;}
  bounds(decl){const out=this.f.call('bounds');for(const pair of decl.bounds||[])this.f.call('bound_push',out,this.f.call('coerce',pair[0]?this.expression(pair[0]):this.literal(this.module.optionBase),this.n('long')),this.f.call('coerce',this.expression(pair[1]),this.n('long')));return out;}
  declaration(decl,global=false,isStatic=false){
    const kind=decl.bounds===null||decl.bounds===undefined?0:decl.bounds.length?2:1;
    this.f.call('declare',this.n(decl.name),this.n(this.nativeType(decl.storageType||decl.type)),this.bounds(decl),kind,(decl.constant?1:0)|(isStatic?2:0)|(decl.autoNew?4:0)|(global?8:0)|(decl.withEvents?16:0),Number(decl.fixedLength)||0);
    if(decl.constant){const value=(this.procedure||this.module).constantScalars.get(lower(decl.name));if(!value)this.fail('Missing bound constant '+decl.name);this.f.call('initial',this.n(decl.name),this.literal(value));}
  }
  instructionCode(ins,index){
    this.instruction=ins;this.usedOps.add(ins.op);const f=this.f,e=n=>this.expression(n),s=n=>f.call('scalar',e(n)),r=n=>this.reference(n),n=v=>this.n(v),go=target=>{if(!Number.isInteger(target)||target<0||target>this.procedure.code.length)this.fail('Invalid AOT branch target');return 'L'+target;};
    switch(ins.op){
      case 'dim':break;
      case 'assign':f.call('assign',r(ins.target),e(ins.expr),ins.objectSet?1:0);break;
      case 'expr':e(ins.expr);break;
      case 'print':f.call('print',this.values(ins.exprs),ins.newline?1:0);break;
      case 'assert':f.call('assert',e(ins.expr));break;
      case 'branch':f.branch(f.call('truth',e(ins.test)),go(ins.target),!ins.invert);break;
      case 'jump':f.jump(go(ins.target));break;
      case 'computedJump':{
        const value=f.call('ordinal',e(ins.expr)),done=f.unique('on_done');
        if(ins.gosub){const labels=ins.targets.map(()=>f.unique('gosub'));f.select(value,labels.map((v,i)=>[i+1,v]),done);labels.forEach((label,i)=>{f.label(label);f.call('gosub',index+1);f.jump(go(ins.targets[i]));});}
        else f.select(value,ins.targets.map((v,i)=>[i+1,go(v)]),done);
        f.label(done);break;
      }
      case 'raiseError':f.call('raise_error',e(ins.expr));break;
      case 'temp':f.call('temp_set',n(ins.id),e(ins.expr));break;
      case 'case':{
        const value=f.call('temp_get',n(ins.id)),matched=f.unique('case_match');
        for(const c of ins.cases){if(c.kind==='range'){const low=s(c.low),high=s(c.high),next=f.unique('case_next');f.branch(f.call('truth',f.call('binary',n('>='),value,low)),next,true);f.branch(f.call('truth',f.call('binary',n('<='),value,high)),matched);f.label(next);}
          else f.branch(f.call('truth',f.call('binary',n(c.op||'='),value,e(c.expr))),matched);}
        f.jump(go(ins.target));f.label(matched);break;
      }
      case 'forInit':f.branch(f.call('for_start',n(ins.id),r(parseExpression(ins.name)),s(ins.start),s(ins.end),s(ins.step)),go(ins.target),true);break;
      case 'forNext':f.branch(f.call('for_next',n(ins.id)),go(ins.target));break;
      case 'eachInit':{f.call('each_close',n(ins.id));const iterable=e(ins.expr),hold=f.call('retain',iterable,1),variable=r(ins.variable||parseExpression(ins.name)),out=f.call('each_start',n(ins.id),variable,iterable,ins.target);f.call('release',hold);f.branch(out,go(ins.target),true);break;}
      case 'eachNext':f.branch(f.call('each_next',n(ins.id)),go(ins.target));break;
      case 'redim':for(const d of ins.decls)f.call('redim',f.call('ref',n(d.name)),this.bounds(d),ins.preserve?1:0,n(d.explicitType?this.nativeType(d.storageType||d.type):''));break;
      case 'erase':for(const node of ins.exprs)f.call('erase',e(node));break;
      case 'withPush':{f.call('with_pop',n(ins.id),0);const ref=this.canReference(ins.expr),source=ref?r(ins.expr):e(ins.expr);f.call('with_push',n(ins.id),source,ins.target,ref?1:0);break;}
      case 'withPop':f.call('with_pop',n(ins.id),0);break;
      case 'withUnwind':f.call('with_pop',0,ins.count);break;
      case 'onError':f.call('on_error',n(ins.mode),(ins.target??-1)>>>0);break;
      case 'resume':f.dispatch(f.call('resume',n(ins.mode),(ins.target??-1)>>>0));break;
      case 'gosub':f.call('gosub',index+1);f.jump(go(ins.target));break;
      case 'gosubReturn':f.dispatch(f.call('gosub_return'));break;
      case 'return':f.call('finish');f.end();break;
      case 'end':f.call('end',1);break;
      case 'stop':f.call('end',0);break;
      case 'lineNumber':f.call('line',ins.number);break;
      case 'form':if(ins.expr.kind==='call')f.call('control_array',e(ins.expr.callee),n(ins.action),this.arguments(ins.expr.args));else f.call('form',e(ins.expr),n(ins.action));break;
      case 'fileOpen':f.call('file_open',s(ins.path),n(ins.mode),s(ins.handle),ins.recordLength?s(ins.recordLength):this.literal(128),n(ins.access||''),n(ins.sharing||''));break;
      case 'fileClose':f.call('file_close',this.values(ins.handles));break;
      case 'fileSeek':f.call('file_seek',s(ins.handle),s(ins.position));break;
      case 'fileRecord':f.call('file_record',s(ins.handle),e(ins.position),r(ins.target),ins.action==='put'?1:0);break;
      case 'fileLock':f.call('file_lock',s(ins.handle),e(ins.start),e(ins.end),ins.unlock?1:0);break;
      case 'fileCopy':case 'fileRename':f.call('file_move',s(ins.sourcePath),s(ins.destination),ins.op==='fileRename'?1:0);break;
      case 'filePrint':f.call('file_print',s(ins.handle),this.values(ins.exprs),ins.csv?1:0,ins.newline?1:0);break;
      case 'fileInput':f.call('file_input',s(ins.handle),this.references(ins.targets),ins.whole?1:0);break;
      case 'graphics':f.call('graphics',ins.object?e(ins.object):f.call('self'),n(ins.kind),this.values(ins.coords),e(ins.color),ins.fill?1:0);break;
      case 'raiseEvent':if(ins.expr.kind!=='call'||ins.expr.callee.kind!=='id')this.fail('Invalid RaiseEvent');f.call('raise_event',n(ins.expr.callee.name),this.arguments(ins.expr.args));break;
      case 'stringAlign':{const target=r(ins.target),current=f.call('string_target',target);f.call('string_align',target,current,s(ins.expr),ins.right?1:0);break;}
      case 'stringMid':{const target=r(ins.target),current=f.call('string_target',target),start=f.call('coerce',e(ins.start),n('long')),length=ins.length?f.call('coerce',e(ins.length),n('long')):0;f.call('mid_check',current,start,length);f.call('string_mid',target,current,start,length,s(ins.expr));break;}
      default:this.fail('Unsupported AOT instruction '+ins.op,'MACA102');
    }
  }
  startFunction(){const f=new AOTFunction(this.functions.length);this.functions.push(f);this.f=f;return f;}
  finishFunction(codeLength=null){
    const f=this.f;f.label('failure');const pc=f.call('exception');if(codeLength===null)f.end();else f.dispatch(pc);
    if(codeLength!==null){f.label('dispatch');f.select({slot:0},Array.from({length:codeLength+1},(_,i)=>[i,'L'+i]),'exit');}
  }
  emitProcedure(proc){
    this.procedure=proc;this.instruction=null;this.procedures++;const f=this.startFunction();
    if(proc.external){const adapter=(this.platform.resolveDeclaration||resolveMacOSDeclaration)(proc,this.module.name);this.external.push({...adapter,procedure:proc.name,source:this.module.name});f.call('api',this.n(adapter.id),proc.kind==='sub'?0:this.n(proc.storageReturnType||proc.returnType));f.end();this.finishFunction();return f.id;}
    for(const d of proc.redimDeclarations||[]){f.reset();this.declaration(d,false,false);}
    for(const ins of proc.code)if(ins.op==='dim')for(const d of ins.decls){f.reset();this.declaration(d,false,ins.static);}
    this.instructions+=proc.code.length;
    for(let i=0;i<proc.code.length;i++){const ins=proc.code[i];f.label('L'+i);f.nextSlot=1;f.call('step',i,i+1,ins.line||proc.line||1);this.sourceMap.push({function:'aot_entry_'+f.id,instruction:i,module:this.module.name,procedure:proc.name,line:ins.line,sequencePoint:ins.sequencePoint});this.instructionCode(ins,i);}
    f.label('L'+proc.code.length);f.call('finish');f.end();this.finishFunction(proc.code.length);return f.id;
  }
  spec(control){
    const propertyValue=v=>Array.isArray(v)?v.map(propertyValue):v&&typeof v==='object'?JSON.stringify(v):v;
    return {name:control.name,type:control.type||'Form',parent:control.parent||'',index:Number.isInteger(Number(control.properties?.Index))&&control.properties?.Index!==undefined?Number(control.properties.Index):-1,
      properties:Object.entries(control.properties||{}).filter(([k])=>lower(k)!=='name').sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[lower(k),this.literalId(propertyValue(v))])};
  }
  emit(){
    for(const module of this.program.modules.values()){
      this.module=module;this.procedure=null;this.instruction=null;
      const m={name:module.name,kind:module.kind,language:module.language||'vb6',defaultMember:module.defaultMember||'',optionExplicit:!!module.optionExplicit,optionBase:module.optionBase,textCompare:module.optionCompare==='text',defaultTypes:module.defaultTypes,interfaces:module.interfaces.map(i=>i.name),publicFields:module.declarations.filter(d=>d.scope!=='private').map(d=>lower(d.name)),interfaceBindings:{},records:[],procedures:[]};
      for(const [name,contract]of Object.entries(module.interfaceBindings||{}))m.interfaceBindings[name]={defaultMember:contract.defaultMember||'',members:Object.fromEntries(Object.entries(contract.members).map(([key,member])=>[key,{procedure:member.procedure,parameters:member.signature.params.map(p=>lower(p.name))}]))};
      for(const [key,proc]of module.procedures){
        const dispatch=this.pascalDispatchMetadata(proc);
        m.procedures.push({key,name:proc.name,scope:proc.scope,returnType:this.nativeType(proc.storageReturnType||proc.returnType),returnArray:!!proc.returnArray,accessor:proc.accessor||'',isFunction:proc.kind==='function'||proc.accessor==='get',isStatic:!!proc.static,external:!!proc.external,entry:this.emitProcedure(proc),parameters:proc.params.map(p=>({name:p.name,type:this.nativeType(p.storageType||p.type),byRef:!!p.byRef,optional:!!p.optional,paramArray:!!p.paramArray,array:p.bounds!==null&&p.bounds!==undefined,...(proc.defaultScalars.has(lower(p.name))?{initial:this.literalId(proc.defaultScalars.get(lower(p.name)))}:{})})),...(dispatch?{pascalDispatch:dispatch}:{})});
      }
      this.procedure=null;this.instruction=null;
      m.initialize=this.startFunction().id;for(const d of module.declarations){this.f.reset();this.declaration(d,true);}this.f.end();this.finishFunction();
      for(const [name,fields]of Object.entries(module.types)){
        const object=this.pascalObjectMetadata(name,fields),type=object?.identity||name;
        const f=this.startFunction();m.records.push({name:type,entry:f.id,...(object?{pascalObject:object}:{})});const record=f.call('record',this.n(type));
        for(const field of fields)f.call('record_field',record,this.n(field.name),this.n(this.nativeType(field.storageType||field.type)),this.bounds(field),Number(field.fixedLength)||0);
        f.call('finish',record);f.end();this.finishFunction();
      }
      if(module.form){m.form=this.spec({...module.form,name:module.name});m.controls=module.form.controls.map(c=>this.spec(c));m.menus=(module.form.menus||[]).map(c=>this.spec({...c,type:'Menu'}));}
      this.modules.push(m);
    }
    const section=(this.platform.emitFunctions||emitAOTFunctions)(this.functions,this.options.optimization),metadata={abi:AOT_ABI,name:this.options.name,startup:this.program.startup,maxArrayElements:this.options.maxArrayElements,maxCallDepth:this.options.maxCallDepth,names:this.names,literals:this.literals,modules:this.modules,entries:this.functions.map(f=>section.labels.get('aot_entry_'+f.id))};
    const text=JSON.stringify(metadata);if(new TextEncoder().encode(text).length>8*1024*1024)this.fail('Project metadata exceeds the bounded 8 MiB native reader','MACA202');
    return {section,metadata,functions:this.functions};
  }
}
export function compileMacOSAOT(input,options={}){
  const project=normalizeProject(input),normalized=macOSOptions({name:project.name,...options});
  const appearance=macOSAppearanceReport(project,normalized);
  const resources=prepareMacOSResources(project);
  setTargetConditionalConstants(project,{VBWEB:0,Win16:0,Win32:0,Win64:0,Mac:-1,MacOS:-1,Linux:0,Unix:-1,GTK:0,GTK3:0,GTK4:0,ARM64:-1,AARCH64:-1,X86_64:0,AMD64:0,X86:0,I386:0,IA32:0});
  const program=compileProject(project);if(!program.valid){const error=new MacOSCompileError('VB6 frontend rejected the project');error.diagnostics=program.diagnostics;throw error;}
  const controls=macOSControlReport(project),lowering=new DirectLowering(program,normalized),emitted=lowering.emit();
  const report={target:'macos-arm64',architecture:'arm64',format:'Mach-O',artifact:'native-object-code',compiled:false,codegen:'arm64-aot',runtime:'vb6-native',abi:AOT_ABI,modules:program.modules.size,procedures:lowering.procedures,instructions:lowering.instructions,codeBytes:emitted.section.length,optimization:emitted.section.optimization,metadataBytes:new TextEncoder().encode(JSON.stringify(emitted.metadata)).length,operations:[...lowering.usedOps].sort(),controls,imports:lowering.external,resources:resources.report,appearance,diagnostics:appearance.diagnostics};
  return {...emitted,resourceFiles:resources.files,options:normalized,project,report,diagnostics:appearance.diagnostics,sourceMap:lowering.sourceMap};
}
/** Test-only native C++ oracle generated from the same lowered helper-call graph.
 * It is never the exported binary or a browser fallback. */
export function emitAOTPortableTestSource(compiled){
  const bytes=new TextEncoder().encode(JSON.stringify(compiled.metadata));
  return '#include "helpers.hpp"\n'+compiled.functions.map(f=>f.cpp()).join('\n')+'\nstatic const unsigned char metadata[]={'+Array.from(bytes).join(',')+'};\nint main(int argc,char**argv){return vb6::aot::run(std::string(reinterpret_cast<const char*>(metadata),sizeof(metadata)),{'+compiled.functions.map(f=>'&aot_'+f.id).join(',')+'},argc,argv);}\n';
}
