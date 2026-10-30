import {setTargetConditionalConstants} from '../../../src/language/pascal/target-symbols.js';
import {prepareMacOSResources} from './resources.js';
/** Shared VB6 IR -> C++17 native procedure lowering. No VM/bytecode interpreter. */
import {compileProject} from '../../../src/language/compiler.js';
import {normalizeProject} from '../../../src/project/model.js';
import {defaultIdentifierType} from '../../../src/language/default-types.js';
import {RecordTypeIndex} from '../../../src/language/record-resolution.js';
import {parseExpression} from '../../../src/language/expression.js';
import {literalScalar,signedLiteralScalar,VBScalar,NOTHING,MISSING} from '../../../src/runtime/values.js';
import {dateToSerial} from '../../../src/runtime/calendar.js';
import {VB_CONSTANTS} from '../../../src/runtime/constants.js';
import {BUILTIN_SIGNATURES} from '../../../src/runtime/signatures.js';
import {MACOS_TARGET,MacOSCompileError,macOSOptions,macOSInfoPlist} from './target.js';
import {resolveMacOSDeclaration,macOSControlReport} from './catalog.js';
import {macOSAppearanceReport} from './macos26-appearance.js';
import {pascalObjectReferenceCompatible,pascalObjectDispatchBranches} from '../../../src/language/pascal/object-compatibility.js';
import {prepareMacOSCollections} from './native-collections.js';

const lower=value=>String(value).toLowerCase();
const q=value=>JSON.stringify(String(value)).replace(/[\u007f-\uffff]/g,c=>'\\u'+c.charCodeAt(0).toString(16).padStart(4,'0'));
// An explicit counted UTF-16 initializer preserves embedded NUL/unpaired UTF-16
// units and cannot break out into C++ tokens (unlike concatenating quoted code).
export function cppText(value){const text=String(value);return 'Text{'+Array.from({length:text.length},(_,i)=>'char16_t(0x'+text.charCodeAt(i).toString(16)+')').join(',')+'}';}
const bool=value=>value?'true':'false';
const typeTitle=type=>({empty:'Empty',null:'Null',integer:'Integer',long:'Long',single:'Single',double:'Double',currency:'Currency',date:'Date',string:'String',error:'Error',boolean:'Boolean',decimal:'Decimal',byte:'Byte'}[lower(type)]);
function cppScalar(input){
  if(input===NOTHING||input?.__nothing)return 'Value::object(nullptr)';
  if(input===MISSING||input?.__missing)return 'Value::missing()';
  if(input===undefined)return 'Value{}';if(input===null)return 'Value::null()';
  const scalar=input instanceof VBScalar?input:null,value=scalar?scalar.value:input;
  const type=scalar?.type||(typeof value==='boolean'?'boolean':typeof value==='string'?'string':typeof value==='number'?(Number.isInteger(value)&&value>=-32768&&value<=32767?'integer':Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?'long':'double'):value instanceof Date?'date':null);
  const variant=bool(scalar?.variant);
  if(type==='empty')return 'Value{}';if(type==='null')return 'Value::null()';
  if(type==='string')return `Value::string(${cppText(value)},${variant})`;
  if(type==='currency')return `Value::currency(${cppText(value.toString())})`;
  if(type==='decimal')return `Value::decimal(Decimal::parse(${cppText(value.toString())}))`;
  if(type==='date')return `Value::real(${dateToSerial(value)},Type::Date,${variant})`;
  if(type==='boolean')return `Value::integer(${value?-1:0},Type::Boolean,${variant})`;
  if(type==='error')return value===MISSING?'Value::missing()':`Value::integer(${value.number},Type::Error,${variant})`;
  if(typeof value==='number'&&Number.isFinite(value)){
    const number=Object.is(value,-0)?'-0.0':String(value);
    return ['byte','integer','long'].includes(type)?`Value::integer(${number},Type::${typeTitle(type)},${variant})`:`Value::real(${number},Type::${typeTitle(type)||'Double'},${variant})`;
  }
  throw new MacOSCompileError('Constant cannot be represented in the native ABI');
}
function wrapped(body){return `([&](){${body}}())`;}
const statementOps=new Set(['dim','assign','expr','print','assert','branch','jump','computedJump','raiseError','temp','case','forInit','forNext','eachInit','eachNext','redim','erase','withPush','withPop','withUnwind','onError','resume','gosub','gosubReturn','return','stop','end','lineNumber','form','fileOpen','fileRecord','fileSeek','fileLock','fileCopy','fileRename','fileClose','filePrint','fileInput','graphics','raiseEvent','stringAlign','stringMid']);
export class MacOSLowering {
  constructor(program,options){this.program=program;this.options=options;this.recordTypes=new RecordTypeIndex(program.modules);this.module=null;this.procedure=null;this.instruction=null;this.external=[];this.sourceMap=[];this.procedures=0;this.instructions=0;this.usedOps=new Set();this.usedBuiltins=new Set();}
  fail(message,code='MAC100'){throw new MacOSCompileError(message,this.module?.name,this.instruction?.line||this.procedure?.line||1,code);}
  // Resolve storage identities once per lowering pass, with the same owner,
  // visibility and shadowing rules as the shared binder and VM. Display names
  // travel separately so TypeName retains the authored declaration spelling.
  nativeType(raw,module=this.module){
    return this.recordTypes.resolve(raw,module)?.identity||raw;
  }
  pascalObjectMetadata(name,fields){
    const module=this.module,object=module.language==='pascal'&&module.pascal?.objectTypes?.find(value=>lower(value.name)===lower(name));
    if(!object)return null;
    const identity=lower(object.identity),parent=object.parent?lower(object.parent.identity):'';
    if(identity!==lower(module.name)+'.'+lower(name)||!Number.isInteger(object.typeId)||object.typeId<1||object.typeId>2147483647||
      parent&&!pascalObjectReferenceCompatible(this.program.modules,identity,parent))this.fail('Invalid Pascal object ancestry metadata','MACA231');
    const bound=node=>{
      const scalar=!node?module.optionBase:this.constant(node)||signedLiteralScalar(node)||(node.kind==='literal'?literalScalar(node):null);
      const value=typeof scalar==='number'?scalar:Number(scalar?.nativeValue??scalar?.value);
      if(!Number.isInteger(value)||value<-2147483648||value>2147483647)this.fail('Invalid Pascal object array bound metadata','MACA231');
      return value;
    };
    const fieldType=field=>lower(this.nativeType(field.storageType||field.type,module));
    return {name:object.name,identity,parent,typeId:object.typeId,hasVmt:!!object.hasVmt,
      fields:fields.map(field=>({name:lower(field.name),type:fieldType(field),fixedLength:Number(field.fixedLength)||0,bounds:field.bounds?.map(pair=>pair.map(bound))??null})),
      virtualMethods:(object.methods||[]).filter(method=>method.virtual&&lower(method.module)===lower(module.name)&&lower(method.declaringType)===lower(name)).map(method=>lower(method.module)+'.'+lower(method.vbName))};
  }
  pascalDispatchMetadata(proc){
    const module=this.module,dispatch=module.language==='pascal'&&module.pascal?.objectDispatchers?.find(value=>lower(value.name)===lower(proc.name));
    if(!dispatch)return null;
    if(!dispatch.branches?.length)this.fail('Invalid Pascal virtual dispatcher metadata','MACA231');
    const tags=new Set();
    for(const branch of dispatch.branches){
      if(tags.has(branch.typeId)||!pascalObjectDispatchBranches(this.program.modules,module.name,proc.name,dispatch.receiver.parameter,branch.targetModule,branch.targetProcedure,branch.viewType))this.fail('Invalid Pascal virtual dispatch branch metadata','MACA231');
      tags.add(branch.typeId);
    }
    return {receiver:{parameter:lower(dispatch.receiver.parameter),identity:lower(dispatch.receiver.identity),vmtField:lower(dispatch.receiver.vmtField)},
      branches:dispatch.branches.map(branch=>({typeId:branch.typeId,runtimeType:lower(branch.runtimeType),targetModule:lower(branch.targetModule),targetProcedure:lower(branch.targetProcedure),viewType:lower(branch.viewType)}))};
  }
  constant(node){
    if(node.kind==='id'){
      const name=lower(node.name),p=this.procedure,m=this.module;
      if(p?.constantScalars?.has(name))return p.constantScalars.get(name);
      if(p&&(p.params.some(v=>lower(v.name)===name)||p.code.some(i=>i.op==='dim'&&i.decls.some(v=>lower(v.name)===name))))return null;
      if(m.constantScalars.has(name))return m.constantScalars.get(name);
      const imported=m.importedConstantBindings.get(name);if(imported&&!imported.ambiguous)return imported.scalar;
      const key=Object.keys(VB_CONSTANTS).find(key=>lower(key)===name);if(key!==undefined)return {nativeValue:VB_CONSTANTS[key]};
    }
    if(node.kind==='member'&&node.object.kind==='id'){
      const owner=lower(node.object.name),name=lower(node.name);
      const enumeration=this.module.enumBindings.get(owner)||this.module.globalEnumMembers.get(owner);
      if(enumeration?.values&&Object.hasOwn(enumeration.values,name))return {nativeValue:enumeration.values[name]};
      const module=this.program.modules.get(owner);if(module?.constantScalars.has(name))return module.constantScalars.get(name);
    }
    return null;
  }
  expression(node){
    if(!node)return 'Value::missing()';
    const constant=this.constant(node);if(constant)return cppScalar(Object.hasOwn(constant,'nativeValue')?constant.nativeValue:constant);
    switch(node.kind){
      case 'literal':case 'currency':case 'date':return cppScalar(literalScalar(node));
      case 'empty':return 'Value{}';case 'nothing':return 'Value::object(nullptr)';case 'missing':return 'Value::missing()';
      case 'group':case 'byval':return this.expression(node.expr);
      case 'id':return `f.get(${q(node.name)})`;
      case 'with':return `f.with(${q(this.instruction?.withId||'')})`;
      case 'new':return `f.create(${q(node.name)})`;
      case 'member':return `getMember(f.runtime,${this.expression(node.object)},${q(node.name)})`;
      case 'call':return this.call(node);
      case 'unary':{const literal=signedLiteralScalar(node);return literal?cppScalar(literal):`unary(${q(node.op)},scalar(f.runtime,${this.expression(node.expr)}))`;}
      case 'binary':return wrapped(`auto a=${this.expression(node.left)};auto b=${this.expression(node.right)};return binary(${q(node.op)},${node.op==='is'?'a,b':'scalar(f.runtime,a),scalar(f.runtime,b)'},f.module.textCompare);`);
      case 'typeof':return wrapped(`auto v=${this.expression(node.expr)};if(v.type!=Type::Object)fail(13);auto object=std::get<ObjectPtr>(v.payload);return Value::boolean(object&&object->supports(${q(node.name)}));`);
      case 'addressOf':{
        const parts=node.name.split('.'),name=lower(parts.pop());let owners;
        if(parts.length)owners=[this.program.modules.get(lower(parts.join('.')))];
        else if(this.module.procedures.has(name))owners=[this.module];
        else owners=[...this.program.modules.values()].filter(m=>m.kind==='module'&&m.procedures.has(name)&&m.procedures.get(name).scope!=='private');
        owners=owners.filter(Boolean);if(owners.length!==1||owners[0].kind!=='module')this.fail('AddressOf must resolve one standard-module procedure','MAC230');
        const procedure=owners[0].procedures.get(name);if(!procedure||procedure.external||procedure.returnArray||procedure.params.some(p=>p.optional||p.paramArray||p.byRef||p.bounds!==null&&p.bounds!==undefined))this.fail('Native callbacks require fixed ByVal scalar parameters','MAC230');
        return `f.callback(${q(owners[0].name)},${q(procedure.name)})`;
      }
      default:this.fail('Unsupported native expression '+node.kind);
    }
  }
  reference(node){
    if(node.kind==='id')return `f.ref(${q(node.name)})`;
    if(node.kind==='member')return `memberRef(f.runtime,${this.expression(node.object)},${q(node.name)})`;
    if(node.kind==='call'){
      if(node.args.length===0&&node.callee.kind==='id'&&this.canReference(node))return this.reference(node.callee);
      if(node.callee.kind==='member')return wrapped(`auto receiver=${this.expression(node.callee.object)};auto borrow=borrowArrayValue(receiver);auto args=${this.arguments(node.args)};return objectReference(f.runtime,receiver,${q(node.callee.name)},args);`);
      if(node.callee.kind==='id'&&this.procedure?.returnArray&&lower(this.procedure.name)===lower(node.callee.name))return wrapped(`auto receiver=f.get(${q(node.callee.name)});auto borrow=borrowArrayValue(receiver);std::vector<Value> indices{${node.args.map(a=>this.expression(a.kind==='named'?a.expr:a)).join(',')}};return indexedRef(f.runtime,receiver,indices);`);
      if(node.callee.kind==='id'&&(this.module.procedures.has(lower(node.callee.name)+':get')||this.module.procedures.has(lower(node.callee.name)+':let')||this.module.procedures.has(lower(node.callee.name)+':set')))return `f.propertyRef(${q(node.callee.name)},${this.arguments(node.args)})`;
      return wrapped(`auto receiver=${this.expression(node.callee)};auto borrow=borrowArrayValue(receiver);std::vector<Value> indices{${node.args.map(a=>this.expression(a.kind==='named'?a.expr:a)).join(',')}};return indexedRef(f.runtime,receiver,indices);`);
    }
    this.fail('Native assignment target is not a variable, member, or indexed reference');
  }
  canReference(node){
    if(node.kind==='id'){
      if(this.constant(node))return false;const key=lower(node.name),p=this.procedure;
      const variables=[...(p?.params||[]),...this.module.declarations,...(p?.code||[]).flatMap(i=>i.decls||[])];
      if(variables.some(v=>lower(v.name)===key)||p&&lower(p.name)===key&&(p.kind==='function'||p.accessor==='get'))return true;
      if([...this.program.modules.values()].some(m=>m.kind==='module'&&(m.procedures.has(key)||m.procedures.has(key+':get'))))return false;
      if(this.module.procedures.has(key)||this.module.procedures.has(key+':get')||this.program.modules.has(key))return false;
      if(this.module.form?.controls.some(c=>lower(c.name)===key))return false;
      if(Object.keys(BUILTIN_SIGNATURES).some(n=>lower(n)===key.replace(/\$$/,''))||['me','err','app','screen','clipboard','forms','printer','printers','array','choose','switch','callbyname'].includes(key))return false;
      return true;
    }
    if(node.kind==='member')return !this.constant(node);
    // Member/default calls obtain a runtime reference: fields/indexed arrays
    // alias directly, while getters/methods remain once-evaluated value temporaries.
    if(node.kind==='call'&&node.callee.kind!=='id')return true;
    if(node.kind==='call'&&node.callee.kind==='id'){
      const name=lower(node.callee.name),variables=[...(this.procedure?.params||[]),...this.module.declarations,...(this.procedure?.code||[]).flatMap(i=>i.decls||[])];
      return !!(this.procedure?.returnArray&&lower(this.procedure.name)===name)||variables.some(v=>lower(v.name)===name&&v.bounds!==null&&v.bounds!==undefined);
    }
    return false;
  }
  arguments(nodes){
    // initializer_list elements live until the call's full expression ends.
    // Their cached Object values would retain a released ByRef argument across
    // the entire callee. Build the vector directly and transfer sole ownership.
    return wrapped(`Args args;args.reserve(${nodes.length});${nodes.map(node=>{
      const name=node.kind==='named'?node.name:'';if(node.kind==='named')node=node.expr;
      const reference=this.canReference(node),directOnly=reference&&node.kind==='call'&&node.callee.kind!=='id';
      return `args.emplace_back(${reference?this.reference(node):this.expression(node)},${q(name)}${directOnly?',true':''});`;
    }).join('')}return args;`);
  }
  call(node){
    const callee=node.callee,args=this.arguments(node.args);
    if(callee.kind==='id')return `f.call(${q(callee.name)},${args})`;
    if(callee.kind==='member')return wrapped(`auto receiver=${this.expression(callee.object)};auto args=${args};return callMember(f.runtime,receiver,${q(callee.name)},std::move(args));`);
    return wrapped(`auto receiver=${this.expression(callee)};auto args=${args};return callValue(f.runtime,receiver,std::move(args));`);
  }
  bounds(decl){return `Bounds{${(decl.bounds||[]).map(pair=>`{static_cast<int32_t>(coerce(scalar(f.runtime,${pair[0]?this.expression(pair[0]):`Value::integer(${this.module.optionBase})`}),"long").integral()),static_cast<int32_t>(coerce(scalar(f.runtime,${this.expression(pair[1])}),"long").integral())}`).join(',')}}`;}
  declaration(decl,global=false,isStatic=false){
    const name=q(decl.name),type=q(this.nativeType(decl.storageType||decl.type)),kind=decl.bounds===null||decl.bounds===undefined?0:decl.bounds.length?2:1;
    const args=`${name},${type},${this.bounds(decl)},${kind},${Number(decl.fixedLength)||0},${bool(decl.constant)},${global?`${bool(decl.autoNew)},${bool(decl.withEvents)}`:`${bool(isStatic)},${bool(decl.autoNew)}`},${q(decl.storageType||decl.type)}`;
    let out=`f.${global?'global':'declare'}(${args});`;
    if(decl.constant){const scalar=(this.procedure||this.module).constantScalars.get(lower(decl.name));if(!scalar)this.fail('Missing bound constant '+decl.name);out+=`f.initial(${name},${cppScalar(scalar)});`;}
    return out;
  }
  instructionCode(ins,index){
    this.instruction=ins;this.usedOps.add(ins.op);if(!statementOps.has(ins.op))this.fail('Unsupported native instruction '+ins.op);
    const e=node=>this.expression(node),s=node=>`scalar(f.runtime,${e(node)})`,r=node=>this.reference(node),values=nodes=>`std::vector<Value>{${nodes.map(s).join(',')}}`,go=target=>{if(!Number.isInteger(target)||target<0||target>this.procedure.code.length)this.fail('Invalid branch target');return `goto L${target};`;};
    switch(ins.op){
      case 'dim':return ''; // Procedure-scoped storage is initialized before the first statement.
      case 'assign':return `auto target=${r(ins.target)};auto value=${e(ins.expr)};assign(f.runtime,target,value,${bool(ins.objectSet)});`;
      case 'expr':return `(void)${e(ins.expr)};`;
      case 'print':return `auto values=${values(ins.exprs)};Text output;for(size_t i=0;i<values.size();++i){if(i)output+=u' ';output+=printValue(values[i]);}f.runtime.host->log(output,${bool(ins.newline)});`;
      case 'assert':return `if(!${s(ins.expr)}.truth())fail(5,"Debug.Assert failed");`;
      case 'branch':return `if(${ins.invert?'':'!'}${s(ins.test)}.truth()){${go(ins.target)}}`;
      case 'jump':return go(ins.target);
      case 'computedJump':return `auto selector=coerce(${s(ins.expr)},"integer").integral();if(selector<0)fail(5);switch(selector){${ins.targets.map((t,i)=>`case ${i+1}:${ins.gosub?`f.gosubs.push_back(${index+1});`:''}${go(t)}`).join('')}default:break;}`;
      case 'raiseError':return `auto number=coerce(${s(ins.expr)},"long").integral();if(number<1||number>65535)fail(5);fail(static_cast<int32_t>(number));`;
      case 'temp':return `f.temps[${q(ins.id)}]=${s(ins.expr)};`;
      case 'case':return `auto value=f.temps.at(${q(ins.id)});bool matched=false;${ins.cases.map(c=>c.kind==='range'?`if(!matched){auto a=${s(c.low)};auto b=${s(c.high)};matched=binary(">=",value,a,f.module.textCompare).truth()&&binary("<=",value,b,f.module.textCompare).truth();}`:`if(!matched)matched=binary(${q(c.op||'=')},value,${s(c.expr)},f.module.textCompare).truth();`).join('')}if(!matched){${go(ins.target)}}`;
      case 'forInit':return `auto variable=${r(parseExpression(ins.name))};auto start=${s(ins.start)};auto end=${s(ins.end)};auto step=${s(ins.step)};if(!f.forStart(${q(ins.id)},variable,start,end,step)){${go(ins.target)}}`;
      case 'forNext':return `if(f.forNext(${q(ins.id)})){${go(ins.target)}}`;
      case 'eachInit':return `f.closeEach(${q(ins.id)});auto iterable=${e(ins.expr)};auto borrow=borrowArrayValue(iterable,true);auto variable=${r(ins.variable||parseExpression(ins.name))};if(!f.eachStart(${q(ins.id)},variable,iterable,${ins.target})){${go(ins.target)}}`;
      case 'eachNext':return `if(f.eachNext(${q(ins.id)})){${go(ins.target)}}`;
      case 'redim':return ins.decls.map(d=>`{auto reference=f.ref(${q(d.name)});auto bounds=${this.bounds(d)};f.redim(reference,bounds,${bool(ins.preserve)},${q(d.explicitType?this.nativeType(d.storageType||d.type):'')},${q(d.explicitType?d.storageType||d.type:'')});}`).join('');
      case 'erase':return ins.exprs.map(node=>`${e(node)}.asArray()->erase();`).join('');
      case 'withPush':return this.canReference(ins.expr)?`f.closeWith(${q(ins.id)});auto reference=${r(ins.expr)};auto value=reference.get();f.pushWith(${q(ins.id)},value,${ins.target},std::move(reference));`:`f.closeWith(${q(ins.id)});f.pushWith(${q(ins.id)},${e(ins.expr)},${ins.target});`;
      case 'withPop':return `f.closeWith(${q(ins.id)});`;
      case 'withUnwind':return `f.unwindWith(${ins.count});`;
      case 'onError':return `f.onError(${q(ins.mode)},${ins.target??-1});`;
      case 'resume':return `f.resume(${q(ins.mode)},${ins.target??-1});goto dispatch;`;
      case 'gosub':return `if(f.gosubs.size()>=f.runtime.maxCallDepth)fail(28);f.gosubs.push_back(${index+1});${go(ins.target)}`;
      case 'gosubReturn':return 'if(f.gosubs.empty())fail(3);f.pc=f.gosubs.back();f.gosubs.pop_back();goto dispatch;';
      case 'return':return 'return f.result();';
      case 'end':return 'f.runtime.ending=true;throw EndExecution{};';
      case 'stop':return 'throw EndExecution{};';
      case 'lineNumber':return `f.labelLine=${ins.number};`;
      case 'form':return ins.expr.kind==='call'?`auto controls=${e(ins.expr.callee)};auto args=${this.arguments(ins.expr.args)};controls.asObject()->invoke(f.runtime,${q(ins.action)},args);`:`auto object=std::dynamic_pointer_cast<Instance>(${e(ins.expr)}.asObject());if(!object)fail(424);f.runtime.${ins.action}(object);`;
      case 'fileOpen':return `auto path=${s(ins.path)};auto number=${s(ins.handle)};auto length=${ins.recordLength?s(ins.recordLength):'Value::integer(128)'};fileOpen(f,path,${q(ins.mode)},number,length,${q(ins.access||'')},${q(ins.sharing||'')});`;
      case 'fileClose':return `fileClose(f,${values(ins.handles)});`;
      case 'fileSeek':return `auto number=${s(ins.handle)};auto position=${s(ins.position)};fileSeek(f,number,position);`;
      case 'fileRecord':return `auto number=${s(ins.handle)};auto position=${e(ins.position)};auto reference=${r(ins.target)};fileGetPut(f,number,position,reference,${bool(ins.action==='put')});`;
      case 'fileLock':return `auto number=${s(ins.handle)};auto start=${e(ins.start)};auto end=${e(ins.end)};fileLock(f,number,start,end,${bool(ins.unlock)});`;
      case 'fileCopy':case 'fileRename':return `auto source=${s(ins.sourcePath)};auto destination=${s(ins.destination)};fileMoveCopy(source,destination,${bool(ins.op==='fileRename')});`;
      case 'filePrint':return `auto number=${s(ins.handle)};auto values=${values(ins.exprs)};filePrint(f,number,values,${bool(ins.csv)},${bool(ins.newline)});`;
      case 'fileInput':return `auto number=${s(ins.handle)};std::vector<Ref>refs{${ins.targets.map(r).join(',')}};fileInput(f,number,refs,${bool(ins.whole)});`;
      case 'graphics':return `auto receiver=${ins.object?e(ins.object):'Value::object(f.self)'};auto coordinates=${values(ins.coords)};auto color=${e(ins.color)};f.runtime.host->graphics(f,receiver,${q(ins.kind)},coordinates,color,${bool(ins.fill)});`;
      case 'raiseEvent':if(ins.expr.kind!=='call'||ins.expr.callee.kind!=='id')this.fail('Invalid RaiseEvent');return `f.runtime.raiseEvent(f.self,${q(ins.expr.callee.name)},${this.arguments(ins.expr.args)});`;
      case 'stringAlign':return `auto target=${r(ins.target)};auto value=target.get();if(value.type!=Type::String)fail(13);auto current=value.string();auto text=${s(ins.expr)}.string().substr(0,current.size());text=${ins.right?'Text(current.size()-text.size(),u\' \')+text':'text+Text(current.size()-text.size(),u\' \')'};target.set(Value::string(text));`;
      case 'stringMid':return `auto target=${r(ins.target)};auto value=target.get();if(value.type!=Type::String)fail(13);auto text=value.string();auto start=coerce(${s(ins.start)},"long").integral();auto length=${ins.length?`coerce(${s(ins.length)},"long").integral()`:'static_cast<int64_t>(text.size())'};if(start<1||length<0)fail(5);auto replacement=${s(ins.expr)}.string();if(size_t(start)<=text.size()){auto count=std::min({size_t(length),replacement.size(),text.size()-size_t(start-1)});text.replace(size_t(start-1),count,replacement.substr(0,count));target.set(Value::string(text));}`;
      default:this.fail('Instruction not lowered: '+ins.op);
    }
  }
  procedureCode(procedure,id){
    this.procedure=procedure;this.instruction=null;this.procedures++;
    if(procedure.external){const adapter=resolveMacOSDeclaration(procedure,this.module.name);this.external.push({...adapter,procedure:procedure.name,source:this.module.name});return `static Value p${id}(Frame&f){auto result=f.runtime.host->api(f.runtime,${q(adapter.id)},f.arguments);return ${procedure.kind==='sub'?'Value{}':`coerce(result,${q(this.nativeType(procedure.storageReturnType||procedure.returnType))})`};}\n`;}
    const code=procedure.code;this.instructions+=code.length;
    const locals=(procedure.redimDeclarations||[]).map(d=>this.declaration(d,false,false)).join('\n')+code.filter(ins=>ins.op==='dim').flatMap(ins=>ins.decls.map(d=>this.declaration(d,false,ins.static))).join('\n');
    const instructions=code.map((ins,i)=>{this.sourceMap.push({function:`p${id}`,instruction:i,module:this.module.name,procedure:procedure.name,line:ins.line,sequencePoint:ins.sequencePoint});return `L${i}:{f.mark(${i},${i+1},${ins.line||procedure.line});${this.instructionCode(ins,i)}}`;});
    return `static Value p${id}(Frame&f){\n${locals}\ndispatch:\ntry {\nswitch(f.pc){${code.map((_,i)=>`case ${i}:goto L${i};`).join('')}default:goto L${code.length};}\n${instructions.join('\n')}\nL${code.length}:return f.result();\n}catch(const Error&e){if(!f.handle(e))throw;}\ngoto dispatch;\n}\n`;
  }
  recordCode(name,fields){
    const object=this.pascalObjectMetadata(name,fields),identity=this.nativeType(name);
    const contract=object?`rt.pascalObjects[${q(object.identity)}]=PascalObjectType{${q(object.identity)},${q(object.parent)},${object.typeId},${bool(object.hasVmt)},{${object.fields.map(field=>`PascalObjectField{${q(field.name)},${q(field.type)},${field.fixedLength},${bool(field.bounds!==null)},Bounds{${(field.bounds||[]).map(([low,high])=>`{${low},${high}}`).join(',')}}}`).join(',')}},{${object.virtualMethods.map(q).join(',')}}};\n`:'';
    return contract+`m.records[${q(lower(identity))}]=[](Frame&f){(void)f;auto record=std::make_shared<Record>();record->name=${q(identity)};record->displayName=${q(name)};${fields.map(field=>{
      const raw=field.storageType||field.type,type=this.nativeType(raw),array=field.bounds!==null&&field.bounds!==undefined;
      const init=array?`f.makeArray(${q(type)},${this.bounds(field)},${bool(!field.bounds.length)},${field.fixedLength||0},${q(raw)})`:`f.runtime.defaultValue(${q(type)},&f)`;
      return `record->order.push_back(${q(lower(field.name))});record->fields[${q(lower(field.name))}]=std::make_shared<Cell>(${init},${q(type)},${field.fixedLength||0},false,${bool(array)});`;
    }).join('')}return Value::record(record);};`;
  }
  pascalDispatchCode(proc){
    const contract=this.pascalDispatchMetadata(proc);if(!contract)return '';
    const receiver=contract.receiver;
    return `p.pascalDispatch=PascalDispatch{${q(receiver.parameter)},${q(receiver.identity)},${q(receiver.vmtField)},{${contract.branches.map(branch=>`PascalDispatchBranch{${branch.typeId},${q(branch.runtimeType)},${q(branch.targetModule)},${q(branch.targetProcedure)},${q(branch.viewType)}}`).join(',')}}};`;
  }
  spec(control){
    const properties=Object.entries(control.properties||{}).filter(([name])=>lower(name)!=='name').sort(([a],[b])=>a.localeCompare(b));
    const value=v=>Array.isArray(v)?`arrayValue(std::vector<Value>{${v.map(value).join(',')}})`:v&&typeof v==='object'?`Value::string(${cppText(JSON.stringify(v))})`:cppScalar(v);
    return `ControlSpec{${q(control.name)},${q(control.type||'Form')},${q(control.parent||'')},std::vector<Property>{${properties.map(([name,v])=>`Property{${q(lower(name))},${value(v)}}`).join(',')}},${Number.isInteger(Number(control.properties?.Index))&&control.properties?.Index!==undefined?Number(control.properties.Index):-1}}`;
  }
  emit(){
    const functions=[],initialize=[];let id=0;
    for(const module of this.program.modules.values()){
      this.module=module;this.procedure=null;this.instruction=null;
      const registrations=[];
      for(const [key,proc]of module.procedures){functions.push(this.procedureCode(proc,id));registrations.push(`{Procedure p;p.name=${q(proc.name)};p.scope=${q(proc.scope)};p.returnType=${q(this.nativeType(proc.storageReturnType||proc.returnType))};p.returnDisplayType=${q(proc.storageReturnType||proc.returnType)};p.accessor=${q(proc.accessor||'')};p.isFunction=${bool(proc.kind==='function'||proc.accessor==='get')};p.returnArray=${bool(proc.returnArray)};p.isStatic=${bool(proc.static)};p.external=${bool(proc.external)};p.code=&p${id++};p.parameters={${proc.params.map(param=>{
        const initial=proc.defaultScalars.get(lower(param.name));return `Parameter{${q(param.name)},${q(this.nativeType(param.storageType||param.type))},${bool(param.byRef)},${bool(param.optional)},${bool(param.paramArray)},${bool(param.bounds!==null&&param.bounds!==undefined)},${initial?`[](Frame&)->Value{return ${cppScalar(initial)};}`:'{}'}}`;
      }).join(',')}};${this.pascalDispatchCode(proc)}m.procedures[${q(key)}]=std::move(p);}`);}
      this.procedure=null;this.instruction=null;
      initialize.push(`{Module m;m.name=${q(module.name)};m.kind=${q(module.kind)};m.language=${q(module.language||'vb6')};m.defaultMember=${q(module.defaultMember||'')};m.optionExplicit=${bool(module.optionExplicit)};m.optionBase=${module.optionBase};m.textCompare=${bool(module.optionCompare==='text')};m.defaultTypes={${Object.entries(module.defaultTypes).map(([k,v])=>`{${q(k)},${q(v)}}`).join(',')}};m.interfaces={${module.interfaces.map(i=>q(i.name)).join(',')}};m.interfaceBindings={${Object.entries(module.interfaceBindings||{}).map(([name,contract])=>`{${q(name)},InterfaceContract{${q(contract.defaultMember||'')},{${Object.entries(contract.members).map(([key,member])=>`{${q(key)},InterfaceMember{${q(member.procedure)},{${member.signature.params.map(p=>q(lower(p.name))).join(',')}}}}`).join(',')}}}}`).join(',')}};m.publicFields={${module.declarations.filter(d=>d.scope!=='private').map(d=>q(lower(d.name))).join(',')}};\n${Object.entries(module.types).map(([name,fields])=>this.recordCode(name,fields)).join('\n')}\nm.initialize=[](Frame&f){(void)f;${module.declarations.map(d=>this.declaration(d,true)).join('\n')}};\n${registrations.join('\n')}\n${module.form?`m.form=${this.spec({...module.form,name:module.name})};m.controls={${module.form.controls.map(c=>this.spec(c)).join(',')}};m.menus={${(module.form.menus||[]).map(c=>this.spec({...c,type:'Menu'})).join(',')}};`:''}\nrt.modules[${q(lower(module.name))}]=std::move(m);}`);
    }
    return `// Generated VB6 native procedures. No project text is executed as C++ code.\n#include "vb6.hpp"\n#include "library.hpp"\n#include "array-ownership.hpp"\n#include <iostream>\nusing namespace vb6;\n${functions.join('\n')}\nvoid initializeProgram(Runtime&rt){rt.name=${q(this.options.name)};rt.startup=${q(this.program.startup)};rt.maxArrayElements=${this.options.maxArrayElements};rt.maxCallDepth=${this.options.maxCallDepth};\n${initialize.join('\n')}\n}\n#ifndef VB6_NATIVE_NO_MAIN\nint main(int argc,char**argv){try{Runtime rt(makeNativeHost());if(argc>0)rt.executablePath=std::filesystem::absolute(argv[0]);for(int i=1;i<argc;++i)rt.commandLine.emplace_back(argv[i]);initializeProgram(rt);rt.run();return 0;}catch(const vb6::Error&e){std::cerr<<"VB6 error "<<e.number<<": "<<e.what()<<"\\n";return 1;}catch(const std::exception&e){std::cerr<<"Native runtime failure: "<<e.what()<<"\\n";return 2;}}\n#endif\n`;
  }
}
export function compileMacOS(input,options={}){
  const project=normalizeProject(input);const normalized=macOSOptions({name:project.name,...options});
  const appearance=macOSAppearanceReport(project,normalized);
  const resources=prepareMacOSResources(project);
  setTargetConditionalConstants(project,{VBWEB:0,Win16:0,Win32:0,Win64:0,Mac:-1,MacOS:-1,Linux:0,Unix:-1,GTK:0,GTK3:0,GTK4:0,ARM64:-1,AARCH64:-1,X86_64:0,AMD64:0,X86:0,I386:0,IA32:0});
  const program=compileProject(project);if(!program.valid){const error=new MacOSCompileError('VB6 frontend rejected the project');error.diagnostics=program.diagnostics;throw error;}
  prepareMacOSCollections({modules:[...program.modules.values()]});
  const controls=macOSControlReport(project);
  const lowering=new MacOSLowering(program,normalized),source=lowering.emit();
  const report={target:MACOS_TARGET.id,architecture:'arm64',format:'Mach-O',artifact:'native-source-build-kit',compiler:'Apple Clang C++17',nativeRuntime:'vb6-native',modules:program.modules.size,procedures:lowering.procedures,instructions:lowering.instructions,operations:[...lowering.usedOps].sort(),controls,imports:lowering.external,optimization:normalized.optimization,minimumVersion:normalized.minimumVersion,sourceBytes:new TextEncoder().encode(source).length,resources:resources.report,appearance,diagnostics:appearance.diagnostics};
  return {target:MACOS_TARGET,options:normalized,project,files:{...resources.files,'main.cpp':source,'Info.plist':macOSInfoPlist(normalized),'source-map.json':JSON.stringify(lowering.sourceMap,null,2)+'\n'},report,diagnostics:appearance.diagnostics};
}
