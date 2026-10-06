import {ComputeError, COMPUTE_ABI, STATE_HEADER_WORDS, ARRAY_HEADER_WORDS, integer, shaderLiteral} from './protocol.js';
import {runtimeWGSL} from './runtime-wgsl.js';
import {StringStorage,encodeStringBlock} from './string-layout.js';
import {stringsWGSL} from './strings-wgsl.js';
import {createStringLowering} from './string-lowering.js';
import {emitCallFrame,emitDispatcher} from './call-dispatch.js';
const key = s => String(s).toLowerCase().replace(/[$%&!#@]$/, '');
const scalarTypes = new Set(['boolean','byte','integer','long','single','string']);
const comparisons = {'=':'==','<>':'!=','<':'<','>':'>','<=':'<=','>=':'>='};
const bits = {and:'&',or:'|',xor:'^',eqv:'^',imp:'|'};
const colorConstants = {vbblack:0,vbred:255,vbgreen:65280,vbblue:16711680,vbwhite:16777215,vbyellow:65535,vbmagenta:16711935,vbcyan:16776960,vbtrue:-1,vbfalse:0};
const zero = type => type==='single'?'0.0f':'0i';
const store = type => type==='string'?'put_s':type==='single'?'put_f':'put_i';
const stringConstants={vbnullstring:'',vbcrlf:'\r\n',vbnewline:'\r\n',vbcr:'\r',vblf:'\n',vbtab:'\t',vbnullchar:'\0',vbback:'\b',vbformfeed:'\f',vbverticaltab:'\v'};
const wgtype = type => type==='single'?'f32':'i32';

/** Lowers the shared VB compiler IR to actual WGSL, not JavaScript execution.
 * Every invocation owns its state. A bounded PC loop preserves VB control flow.
 * Continuation frames implement bounded calls and recursion with ByRef aliases.
 */
export function compileComputeIR(program, options={}) {
  if(!program?.valid || !(program.modules instanceof Map))
    throw new ComputeError('The source program contains compiler errors','GPU_SOURCE',{diagnostics:program?.diagnostics||[]});
  const precision=options.precision??'strict';
  if(!['strict','single'].includes(precision))throw new ComputeError('precision must be strict or single','GPU_OPTION');
  const workgroupSize=integer(options.workgroupSize??64,'workgroupSize',1,256);
  const maxStateWords=integer(options.maxStateWords??16384,'maxStateWords',1,65536);
  const dynamicArrayCapacity=integer(options.dynamicArrayCapacity??256,'dynamicArrayCapacity',1,65536);
  const maxCallDepth=integer(options.maxCallDepth??16,'maxCallDepth',1,64);
  const maxStringLength=integer(options.maxStringLength??256,'maxStringLength',1,4096);
  const gosubStackDepth=integer(options.gosubStackDepth??64,'gosubStackDepth',1,1024);
  const warnings=[], globals=new Map(), procedures=new Map(), compiled=new Map(), active=new Set();
  const initial=[], exports=[], sources=[]; let current=null,requiresShared=false;
  const error=(message,code='GPU_UNSUPPORTED',line=current?.line||1)=>{
    throw new ComputeError(message,code,{source:current?.module?.name,line,procedure:current?.proc?.name});
  };
  const arena=new StringStorage(initial,{maxStringLength,maxStateWords,error});
  const warn=(message)=>{if(!warnings.some(w=>w.message===message))warnings.push({severity:'warning',code:'GPU_PRECISION',message});};
  const typeOf=(type)=>{
    const t=key(type||'Variant');
    if(t==='double'&&precision==='single'){warn('Explicit single-precision mode replaces Double values and operations with f32; this is not VB6 Double parity.');return 'single';}
    if(!scalarTypes.has(t))error(`Type ${type||'Variant'} is not supported by the typed compute target. Use Boolean, Byte, Integer, Long, Single or String.`,'GPU_TYPE');
    return t;
  };
  const getConstant=(name,module,proc)=>{
    const k=key(name); let scalar=proc?.constantScalars?.get(k)||module.constantScalars?.get(k);
    if(!scalar){const imported=module.importedConstantBindings?.get(k);if(imported?.ambiguous)error('Ambiguous constant '+name);scalar=imported?.scalar;}
    if(scalar)return {value:scalar.value,type:scalar.type};
    if(Object.hasOwn(stringConstants,k))return {value:stringConstants[k],type:'string'};
    if(k==='vbbinarycompare')return {value:0,type:'long'};
    if(k==='vbusecompareoption')return {value:-1,type:'long'};
    if(k==='vbtextcompare')return {value:1,type:'long'};
    if(Object.hasOwn(colorConstants,k))return {value:colorConstants[k],type:k==='vbtrue'||k==='vbfalse'?'boolean':'long'};
    return null;
  };
  const constNumber=(node,module,proc)=>{
    if(node?.kind==='group')return constNumber(node.expr,module,proc);
    if(node?.kind==='literal'&&typeof node.value==='number')return node.value;
    if(node?.kind==='unary'&&['+','-'].includes(node.op))return (node.op==='-'?-1:1)*constNumber(node.expr,module,proc);
    if(node?.kind==='id'){const c=getConstant(node.name,module,proc);if(c&&typeof c.value==='number')return c.value;}
    error('Static array bounds and initial values must be numeric literals or named constants','GPU_CONSTANT');
  };
  function allocate(decl,module,proc=null) {
    const saved=current;current={module,proc,line:decl.line||current?.line||proc?.line||1};
    const done=symbol=>{if(initial.length>maxStateWords)error('Compute state limit exceeded','GPU_LIMIT');current=saved;return symbol;};
    if(decl.autoNew||decl.withEvents)error('Object storage requires the host runtime');
    const type=typeOf(decl.storageType||decl.type), offset=initial.length;
    if(decl.fixedLength&&type!=='string')error('Fixed length is only valid for String','GPU_TYPE');
    if(decl.bounds!==null && decl.bounds!==undefined) {
      const dynamic=decl.bounds.length===0;
      integer(decl.bounds.length,'array rank',0,4);
      const bounds=decl.bounds.map(([low,high])=>[
        integer(low?constNumber(low,module,proc):module.optionBase,'lower bound',-1073741824,1073741823),
        integer(constNumber(high,module,proc),'upper bound',-1073741824,1073741823)]);
      let length=dynamic?0:1;const strides=[];
      for(const [low,high] of bounds){if(high<low)error('Array upper bound is below its lower bound','GPU_BOUNDS');strides.push(length);length*=high-low+1;if(length>maxStateWords)error('Array exceeds the compute state limit','GPU_LIMIT');}
      const capacity=dynamic?(type==='string'&&options.dynamicArrayCapacity===undefined?16:dynamicArrayCapacity):length;
      if(initial.length+ARRAY_HEADER_WORDS+capacity>maxStateWords)error('Compute array storage exceeds state limit','GPU_LIMIT');
      initial.push(bounds.length,length);
      for(let d=0;d<4;d++)initial.push(...(bounds[d]?[bounds[d][0]>>>0,bounds[d][1]>>>0,strides[d]]:[0,0,0]));
      initial.push(capacity,dynamic?1:0,...new Array(capacity).fill(0));
      const symbol={name:decl.name,type,offset,address:`${offset}u`,array:true,dynamic,bounds,length,capacity,words:ARRAY_HEADER_WORDS+capacity};
      return done(type==='string'?arena.attach(symbol,decl):symbol);
    }
    if(type==='string'){
      initial.push(0);const symbol=arena.attach({name:decl.name,type,offset,address:`${offset}u`,array:false,words:1},decl);
      if(decl.initial){const node=decl.initial,value=node.kind==='literal'?node.value:node.kind==='id'?getConstant(node.name,module,proc)?.value:undefined;
        if(typeof value!=='string')error('String initial value must be a literal or constant','GPU_CONSTANT');
        const block=encodeStringBlock(value,symbol.stringStorage);block.forEach((w,i)=>initial[symbol.stringStorage.offset+i]=w);}
      return done(symbol);
    }
    let value=decl.initial?constNumber(decl.initial,module,proc):0;
    if(!Number.isFinite(value))error('Non-finite initial value','GPU_VALUE');
    if(type==='single'){const f=new Float32Array([value]);if(!Number.isFinite(f[0]))error('Single initial value overflows','GPU_VALUE');initial.push(new Uint32Array(f.buffer)[0]);}
    else {if(type==='boolean')value=value?-1:0;const [lo,hi]=type==='byte'?[0,255]:type==='integer'?[-32768,32767]:[-2147483648,2147483647];integer(value,decl.name,lo,hi);initial.push(value>>>0);}
    return done({name:decl.name,type,offset,address:`${offset}u`,array:false,words:1});
  }
  for(const module of program.modules.values()) {
    current={module,line:1};
    if(module.kind!=='module'||module.form)error('The compute target accepts standard modules; forms, controls and COM remain host services','GPU_HOST_MODULE');
    const scope=new Map();globals.set(key(module.name),scope);
    for(const decl of module.declarations)if(!decl.constant){const symbol=allocate(decl,module);symbol.scope=decl.scope;scope.set(key(decl.name),symbol);exports.push({...symbol,module:module.name});}
    for(const [name,proc] of module.procedures)procedures.set(key(module.name)+'.'+name,{module,proc,id:procedures.size+1});
  }
  // A (procedure, depth) specialization makes a finite DAG acceptable to WGSL.
  // Static variables are shared by logical procedure, automatic storage by frame.
  const specializations=new Map(),staticLocals=new Map();let nextId=procedures.size;
  function specialize(info,depth){
    const k=info.id+':'+depth;if(specializations.has(k))return specializations.get(k);
    if(specializations.size>=1024)error('Compute call graph exceeds 1024 specializations','GPU_LIMIT');
    const result={...info,rootId:info.id,id:depth===0?info.id:++nextId,depth};specializations.set(k,result);return result;
  }
  const entryName=String(options.entry||program.startup||'Main').replace(/^Sub\s+/i,'');
  function resolveProcedure(name,module=null) {
    if(name.includes('.')){const p=procedures.get(name.toLowerCase());if(!p)error('Procedure not found: '+name,'GPU_NAME');if(module&&p.module!==module&&p.proc.scope==='private')error('Private procedure is inaccessible: '+name,'GPU_NAME');return p;}
    const own=module&&procedures.get(key(module.name)+'.'+key(name));if(own)return own;
    const matches=[...procedures.values()].filter(p=>key(p.proc.name)===key(name)&&p.proc.scope!=='private');
    if(matches.length!==1)error(matches.length?'Ambiguous procedure: '+name:'Procedure not found: '+name,'GPU_NAME');return matches[0];
  }
  const entry=specialize(resolveProcedure(entryName),0);
  if(entry.proc.kind!=='sub'||entry.proc.params.length)error('The compute entry must be a parameterless Sub','GPU_ENTRY');
  function compileProcedure(info) {
    if(active.has(info.id))error('Internal cyclic specialization','GPU_IR');
    if(compiled.has(info.id))return;
    active.add(info.id);const {module,proc,id}=info;
    current={module,proc,line:proc.line};
    if(proc.external||proc.kind==='property')error('Declare and Property procedures require a host service','GPU_HOST_CALL');
    if(proc.params.some(p=>p.paramArray))error('ParamArray requires tagged Variant storage','GPU_TYPE');
    const locals=new Map(),reset=[],params=[],lines=[],loops=new Map(),temps=new Map();let serial=0;
    const resultType=proc.kind==='sub'?'void':typeOf(proc.storageReturnType||proc.returnType);
    if(info.depth>=maxCallDepth){
      const signature=proc.params.map((p,i)=>`arg${i}:${p.byRef?'u32':wgtype(typeOf(p.storageType||p.type))}`);
      compiled.set(id,emitCallFrame({id,params:signature,resultType,limit:true}));
      active.delete(id);sources.push({id,module:module.name,procedure:proc.name,line:proc.line,depth:info.depth});return;
    }
    for(let i=0;i<proc.params.length;i++){
      const p=proc.params[i],type=typeOf(p.storageType||p.type),array=p.bounds!==null;
      if(p.byRef) {locals.set(key(p.name),{name:p.name,type,array,address:`arg${i}`,parameter:true});params.push(`arg${i}:u32`);}
      else {if(array)error('Array arguments must be ByRef');const s=allocate({...p,initial:null,bounds:null},module,proc);locals.set(key(p.name),s);params.push(`arg${i}:${wgtype(type)}`);reset.push(`${store(type)}(${s.address},arg${i});`);}
    }
    if(resultType!=='void') {const s=allocate({name:proc.name,type:resultType,bounds:null},module,proc);locals.set(key(proc.name),s);reset.push(s.type==='string'?`str_reset(${s.address});`:`mem[${s.address}]=0u;`);}
    for(const ins of proc.code)if(ins.op==='dim')for(const d of ins.decls)if(!d.constant){
      const staticKey=info.rootId+':'+key(d.name),isStatic=proc.static||ins.static;
      let s=isStatic?staticLocals.get(staticKey):null;
      if(!s){s=allocate({...d,initial:null,line:ins.line},module,proc);if(isStatic)staticLocals.set(staticKey,s);}
      locals.set(key(d.name),s);
      if(!proc.static&&!ins.static){
        if(s.array)reset.push(`array_erase(${s.address});`);
        else reset.push(s.type==='string'?`str_reset(${s.address});`:`mem[${s.address}]=0u;`);
      }
    }
    const out=line=>lines.push('        '+line);
    const bind=(code,type,snapshot=true)=>{if(type==='string'&&snapshot)code=`str_copy(${arena.scratch()},${code})`;const name=`t${serial++}`;out(`let ${name}:${wgtype(type)}=${code};`);return {code:name,type};};
    const convert=(value,to)=>{
      if(to==='void'||value.type==='void')error('Sub cannot be used as a value','GPU_TYPE');
      if(to==='string')return strings.toString(value).code;
      if(value.type==='string')error('String-to-number/Boolean coercion requires a locale-aware conversion target','GPU_CONVERSION');
      if(to==='single')return value.type==='single'?value.code:`f32(${value.code})`;
      let v=value.type==='single'?`to_i(${value.code})`:value.code;
      if(to==='boolean')return `select(0i,-1i,${value.code}!=${zero(value.type)})`;
      if(to==='integer')v=`narrow(${v},-32768i,32767i)`;
      if(to==='byte')v=`narrow(${v},0i,255i)`;
      return v;
    };
    function symbol(name,owner=module){
      const k=key(name);if(owner===module&&locals.has(k))return locals.get(k);
      const own=globals.get(key(owner.name))?.get(k);if(own){if(owner!==module&&own.scope==='private')error('Private field is inaccessible: '+name);return own;}
      if(owner!==module)return null;
      const matches=[...globals.entries()].filter(([m])=>m!==key(module.name)).map(([,s])=>s.get(k)).filter(s=>s&&s.scope!=='private');
      if(matches.length>1)error('Ambiguous field: '+name,'GPU_NAME');return matches[0]||null;
    }
    function nodeSymbol(node){
      if(node?.kind==='id')return symbol(node.name);
      if(node?.kind==='member'&&node.object.kind==='id'){
        const owner=program.modules.get(key(node.object.name));if(owner)return symbol(node.name,owner);
      }return null;
    }
    const strings=createStringLowering({arena,expr,bind,out,error,module,nodeSymbol});
    const literal=(value,type)=>typeOf(type)==='string'?bind(arena.literal(value),'string',false):bind(shaderLiteral(value,typeOf(type)),typeOf(type));
    function address(node){
      const s=nodeSymbol(node);if(s)return s;
      if(node?.kind==='call'){
        const array=nodeSymbol(node.callee);if(array?.array){
          if(node.args.length<1||node.args.length>4)error('Array indexing supports one through four dimensions','GPU_BOUNDS');
          const indexes=node.args.map(a=>convert(expr(a),'long'));
          while(indexes.length<4)indexes.push('0i');
          const addr=`a${serial++}`;out(`let ${addr}=array_at(${array.address},${node.args.length}u,vec4<i32>(${indexes.join(',')}));`);
          return {...array,array:false,address:addr,arrayBase:array.address};
        }
      }
      return null;
    }
    function namedCallee(node){
      if(node.kind==='id')return node.name;
      if(node.kind==='member'&&node.object.kind==='id')return node.object.name+'.'+node.name;
      error('Dynamic dispatch requires the host runtime','GPU_HOST_CALL');
    }
    function arithmeticType(a,b,op){
      if(op==='^')return typeOf('Double');
      if(Object.hasOwn(bits,op)&&a==='boolean'&&b==='boolean')return 'boolean';
      if(Object.hasOwn(bits,op)||op==='\\'||op==='mod')return a==='byte'&&b==='byte'?'byte':[a,b].every(t=>['byte','integer','boolean'].includes(t))?'integer':'long';
      a=a==='boolean'?'integer':a;b=b==='boolean'?'integer':b;
      if(op==='/')return [a,b].includes('single')&&[a,b].every(t=>['single','byte','integer'].includes(t))?'single':typeOf('Double');
      if([a,b].includes('single')&&[a,b].includes('long'))return typeOf('Double');
      const order=['byte','integer','long','single'];return order[Math.max(order.indexOf(a),order.indexOf(b))];
    }
    function expr(node){
      if(!node)error('Missing expression','GPU_EXPRESSION');
      if(node.kind==='group')return expr(node.expr);
      if(node.kind==='literal'){if(typeof node.value!=='number'&&typeof node.value!=='string')error('Null requires tagged Variant storage','GPU_TYPE');return literal(node.value,typeof node.value==='string'?'string':node.valueType||'long');}
      if(node.kind==='unary'){
        if(node.op==='-'&&node.expr.kind==='literal'&&typeof node.expr.value==='number'&&node.expr.valueType!=='boolean'){
          const n=node.expr,v=-n.value,t=n.numberSuffix?n.valueType:n.valueType==='long'&&v>=-32768&&v<=32767?'integer':n.valueType==='double'&&v===-2147483648?'long':n.valueType;return literal(v,t);
        }
        const a=expr(node.expr);if(a.type==='string')error('String unary coercion is not implemented','GPU_CONVERSION');let type=a.type,code=a.code;
        if(node.op==='not'){if(type==='single')type='long';code=`~${convert(a,'long')}`;if(type==='byte')code=`(${code})&255i`;}
        else {if(['byte','boolean'].includes(type))type='integer';if(node.op==='-')code=type==='single'?`checked_f(-${code})`:`sub_i(0i,${code})`;}
        return bind(convert({code,type},type),type);
      }
      if(node.kind==='binary'){
        const a=expr(node.left),b=expr(node.right),op=node.op;
        if(op==='&'||(op==='+'&&a.type==='string'&&b.type==='string')){const x=strings.toString(a),y=strings.toString(b);return strings.temporary(dst=>`str_concat(${dst},${x.code},${y.code})`);}
        if(a.type==='string'||b.type==='string'){
          if(a.type!==b.type||!comparisons[op])error('Mixed String/numeric operators require explicit supported conversions','GPU_CONVERSION');
          return bind(`select(0i,-1i,str_compare(${a.code},${b.code},${strings.compareMode()})${comparisons[op]}0i)`,'boolean');
        }
        if(comparisons[op]){
          if([a.type,b.type].includes('single')&&[a.type,b.type].includes('long')&&precision==='strict')error('Long/Single comparison requires Double precision; cast explicitly or select single-precision mode','GPU_PRECISION');
          const type=[a.type,b.type].includes('single')?'single':'long';
          return bind(`select(0i,-1i,${convert(a,type)}${comparisons[op]}${convert(b,type)})`,'boolean');
        }
        if(!['+','-','*','/','\\','mod','^',...Object.keys(bits)].includes(op))error('Unsupported compute operator: '+op);
        const type=arithmeticType(a.type,b.type,op);let x=convert(a,type==='single'?'single':'long'),y=convert(b,type==='single'?'single':'long'),code;
        if(Object.hasOwn(bits,op)){code=`(${op==='imp'?'~':''}${x}${bits[op]}${y})`;if(op==='eqv')code='~'+code;if(type==='byte')code=`(${code})&255i`;}
        else if(op==='\\'||op==='mod')code=`${op==='mod'?'mod_i':'div_i'}(${x},${y})`;
        else if(op==='^')code=`checked_f(pow(${x},${y}))`;
        else if(type==='single')code=op==='/'?`div_f(${x},${y})`:`checked_f(${x}${op}${y})`;
        else code=`${{'+':'add_i','-':'sub_i','*':'mul_i'}[op]}(${x},${y})`;
        return bind(convert({code,type},type),type);
      }
      const s=address(node);
      if(s){if(s.array)error('Array requires indices or a ByRef array parameter','GPU_TYPE');return bind(`${s.type==='single'?'get_f':'get_i'}(${s.address})`,s.type);}
      if(node.kind==='id'){
        const c=getConstant(node.name,module,proc);if(c)return literal(c.value,c.type);
        return call({kind:'call',callee:node,args:[]});
      }
      if(node.kind==='member'&&node.object.kind==='id'){
        if(key(node.object.name)==='err'&&key(node.name)==='number')return bind('i32(vb_last_error)','long');
        const owner=program.modules.get(key(node.object.name)),c=owner&&getConstant(node.name,owner,null);
        if(c)return literal(c.value,c.type);
        const e=module.enumBindings?.get(key(node.object.name));if(e?.values&&Object.hasOwn(e.values,key(node.name)))return literal(e.values[key(node.name)],'long');
      }
      if(node.kind==='call')return call(node);
      error('Unsupported compute expression: '+node.kind,'GPU_EXPRESSION');
    }
    function call(node){
      const name=namedCallee(node.callee),n=key(name),args=node.args;
      const expect=(count)=>{if(args.length!==count)error(`${name} expects ${count} arguments`,'GPU_ARGUMENT');};
      const stringCall=strings.call(n,args);if(stringCall)return stringCall;
      if(['computeindex','computecount','computewidth','computeheight','computetime'].includes(n)){
        expect(0);return bind({computeindex:'i32(vb_lane)',computecount:'i32(params.count)',computewidth:'i32(params.width)',computeheight:'i32(params.height)',computetime:'params.time'}[n],n==='computetime'?'single':'long');
      }
      if(['computelocalindex','computegroupindex','computegroupcount','computeworkgroupsize','computesharedlength'].includes(n)){
        expect(0);if(n==='computesharedlength')requiresShared=true;
        return bind({computelocalindex:`i32(vb_lane%${workgroupSize}u)`,computegroupindex:`i32(vb_lane/${workgroupSize}u)`,computegroupcount:`i32((params.count+${workgroupSize-1}u)/${workgroupSize}u)`,computeworkgroupsize:`${workgroupSize}i`,computesharedlength:'i32(params.shared_words)'}[n],'long');
      }
      if(['computeloadlong','computeloadsingle','computestorelong','computestoresingle','computeatomicadd','computeatomicsub','computeatomicexchange','computeatomicand','computeatomicor','computeatomicxor','computeatomiccompareexchange'].includes(n)){
        requiresShared=true;expect(n.startsWith('computeload')?1:n==='computeatomiccompareexchange'?3:2);
        const values=args.map(a=>expr(a)),index=convert(values[0],'long');
        if(n.startsWith('computeload'))return bind(n==='computeloadsingle'?`checked_f(bitcast<f32>(shared_load(${index})))`:`bitcast<i32>(shared_load(${index}))`,n==='computeloadsingle'?'single':'long');
        const value=`bitcast<u32>(${convert(values[1],n==='computestoresingle'?'single':'long')})`;
        if(n.startsWith('computestore')){out(`shared_store(${index},${value});`);return {code:'',type:'void'};}
        if(n==='computeatomiccompareexchange')return bind(`bitcast<i32>(shared_cas(${index},${value},bitcast<u32>(${convert(values[2],'long')})))`,'long');
        const op={computeatomicadd:0,computeatomicsub:1,computeatomicexchange:2,computeatomicand:3,computeatomicor:4,computeatomicxor:5}[n];
        return bind(`bitcast<i32>(shared_atomic(${index},${value},${op}u))`,'long');
      }
      if(['cbyte','cint','clng','csng','cbool','cdbl'].includes(n)){
        expect(1);const t=typeOf({cbyte:'Byte',cint:'Integer',clng:'Long',csng:'Single',cbool:'Boolean',cdbl:'Double'}[n]);
        // Explicit literal conversion can be folded without implementing runtime f64.
        if(n==='csng'){try{return literal(Math.fround(constNumber(args[0],module,proc)),'single');}catch(e){if(e.code!=='GPU_CONSTANT')throw e;}}
        const value=expr(args[0]);return bind(convert(value,t),t);
      }
      if(n==='lbound'||n==='ubound'){
        if(args.length<1||args.length>2)error(name+' expects an array and optional dimension','GPU_ARGUMENT');
        const s=nodeSymbol(args[0]);if(!s?.array)error('Expected array reference','GPU_TYPE');
        const dimension=args[1]?convert(expr(args[1]),'long'):'1i';return bind(`array_bound(${s.address},${dimension},${n==='ubound'})`,'long');
      }
      if(n==='rgb'){expect(3);const a=args.map(a=>convert(expr(a),'long'));return bind(`rgb(${a.join(',')})`,'long');}
      if(['abs','sgn','int','fix'].includes(n)){
        expect(1);const a=expr(args[0]);if(a.type==='string')error('Numeric function does not accept String','GPU_CONVERSION');const t=n==='sgn'?'integer':a.type==='boolean'?'integer':a.type;let code;
        if(n==='sgn')code=`select(select(0i,1i,${a.code}>${zero(a.type)}),-1i,${a.code}<${zero(a.type)})`;
        else if(n==='abs')code=a.type==='single'?`abs(${a.code})`:`select(${a.code},sub_i(0i,min(${a.code},0i)),${a.code}<0i)`;
        else code=a.type==='single'?`${n==='fix'?'trunc':'floor'}(${a.code})`:a.code;
        return bind(convert({code,type:t},t),t);
      }
      const math={computesin:'sin',computecos:'cos',computetan:'tan',computeatan:'atan',computesqrt:'sqrt',computeexp:'exp',computelog:'log',sin:'sin',cos:'cos',tan:'tan',atn:'atan',sqr:'sqrt',exp:'exp',log:'log'};
      if(math[n]){expect(1);if(!n.startsWith('compute'))typeOf('Double');const x=convert(expr(args[0]),'single');if(math[n]==='sqrt')out(`if(${x}<0.0f) {fail(5u);}`);if(math[n]==='log')out(`if(${x}<=0.0f) {fail(5u);}`);return bind(`checked_f(${math[n]}(${x}))`,'single');}
      if(n==='computemin'||n==='computemax'){expect(2);const a=args.map(a=>convert(expr(a),'single'));return bind(`${n==='computemin'?'min':'max'}(${a.join(',')})`,'single');}
      if(n==='err.clear'){expect(0);out('vb_last_error=0u;');return {code:'',type:'void'};}
      if(['computeclear','computerect','computeline','computecircle','cls','me.cls'].includes(n)){
        const counts={computeclear:1,computerect:5,computeline:6,computecircle:4,cls:0,'me.cls':0};expect(counts[n]);
        const evaluated=args.map(a=>expr(a));
        const color=evaluated.length?convert(evaluated.at(-1),'long'):'0i';
        const a=evaluated.slice(0,-1).map(a=>convert(a,'single'));
        if(n==='computeclear'||n==='cls'||n==='me.cls')out(`draw_shape(1u,vec4<f32>(0.0),vec4<f32>(0.0),${color},true);`);
        if(n==='computerect')out(`draw_shape(2u,vec4<f32>(${a[0]},${a[1]},${a[0]}+${a[2]},${a[1]}+${a[3]}),vec4<f32>(1.0,0.0,0.0,0.0),${color},true);`);
        if(n==='computeline')out(`draw_shape(3u,vec4<f32>(${a.slice(0,4).join(',')}),vec4<f32>(${a[4]},0.0,0.0,0.0),${color},false);`);
        if(n==='computecircle')out(`draw_shape(4u,vec4<f32>(${a.join(',')},0.0),vec4<f32>(1.0,0.0,0.0,0.0),${color},true);`);
        return {code:'',type:'void'};
      }
      const callee=specialize(resolveProcedure(name,module),info.depth+1);
      const bindings=new Map(),evaluated=[],locks=[];
      let positional=0,named=false;
      for(const arg of args){
        let slot;if(arg.kind==='named'){named=true;slot=callee.proc.params.findIndex(p=>key(p.name)===key(arg.name));if(slot<0)error('Unknown named argument: '+arg.name,'GPU_ARGUMENT');}
        else {if(named)error('Positional argument after named argument','GPU_ARGUMENT');slot=positional++;}
        const p=callee.proc.params[slot];if(!p||bindings.has(slot))error('Invalid argument count or duplicate named argument','GPU_ARGUMENT');
        if(arg.kind==='missing'){bindings.set(slot,null);continue;}
        const value=arg.kind==='named'?arg.expr:arg,pt=typeOf(p.storageType||p.type);
        if(p.byRef){
          const ref=address(value);
          if(p.bounds!==null){if(!ref?.array||ref.type!==pt)error('ByRef array argument type mismatch','GPU_ARGUMENT');bindings.set(slot,ref.address);}
          else if(ref){if(ref.array||ref.type!==pt)error('ByRef argument type mismatch; use parentheses for an explicit temporary','GPU_ARGUMENT');bindings.set(slot,ref.address);if(ref.arrayBase){const token=`lock${serial++}`;out(`let ${token}=array_lock(${ref.arrayBase});`);locks.push({token,base:ref.arrayBase});}}
          else {const v=expr(value),s=allocate({name:'$argument',type:pt,bounds:null},module,proc);out(`${store(pt)}(${s.address},${convert(v,pt)});`);bindings.set(slot,s.address);}
        }else bindings.set(slot,convert(expr(value),pt));
      }
      for(let i=0;i<callee.proc.params.length;i++){
        const p=callee.proc.params[i];if(bindings.get(i)==null){
          if(!p.optional||!callee.proc.defaultBindings?.has(key(p.name)))error('Missing required argument: '+p.name,'GPU_ARGUMENT');
          const pt=typeOf(p.storageType||p.type),defaultValue=callee.proc.defaultBindings.get(key(p.name)),value=pt==='string'?arena.literal(defaultValue):shaderLiteral(defaultValue,pt);
          if(p.byRef){const s=allocate({name:'$optional',type:pt,bounds:null},module,proc);out(`${store(pt)}(${s.address},${value});`);bindings.set(i,s.address);}else bindings.set(i,value);
        }evaluated.push(bindings.get(i));
      }
      const saved=current;compileProcedure(callee);current=saved;
      const type=callee.proc.kind==='sub'?'void':typeOf(callee.proc.storageReturnType||callee.proc.returnType);
      lines.push({callee:callee.id,args:evaluated});
      out(`vb_line=${current.line}u;vb_source=${id}u;`);
      const value=type==='void'?{code:'',type}:bind(`frame_${callee.id}.result`,type);
      for(const lock of locks)out(`if(${lock.token}) {array_unlock(${lock.base});}`);
      out(`vb_line=${current.line}u;vb_source=${id}u;`);return value;
    }
    // Loop state is private to this activation; start/end/step are evaluated once.
    const declarations=[];
    if(proc.code.some(ins=>ins.op==='gosub'||ins.op==='gosubReturn'||ins.gosub))declarations.push(`var gosub_stack:array<u32,${gosubStackDepth}>;var gosub_sp=0u;`);
    for(const ins of proc.code){
      if(ins.op==='forInit'){
        const variable=symbol(ins.name);if(!variable||variable.array||variable.type==='string')error('For control variable must be declared','GPU_NAME',ins.line);
        const idx=loops.size,loop={...variable,end:`for_end_${idx}`,step:`for_step_${idx}`};loops.set(ins.id,loop);
        declarations.push(`var ${loop.end}:${wgtype(loop.type)}; var ${loop.step}:${wgtype(loop.type)};`);
      }
      if(ins.op==='temp'){const name=`select_${temps.size}`;temps.set(ins.id,{name,type:null});}
    }
    const blocks=[];
    for(let pc=0;pc<proc.code.length;pc++){
      const ins=proc.code[pc];current={module,proc,line:ins.line||proc.line};lines.length=0;
      let next=`pc=${pc+1}u;`;
      switch(ins.op){
        case 'dim':for(const d of ins.decls)if(!d.constant&&d.initial){const s=locals.get(key(d.name)),v=expr(d.initial);out(`${store(s.type)}(${s.address},${convert(v,s.type)});`);}break;
        case 'assign':{if(ins.objectSet)error('Set assignment requires object storage');const s=address(ins.target);if(!s||s.array)error('Expected an assignable scalar or array element','GPU_NAME');const v=expr(ins.expr);out(`${store(s.type)}(${s.address},${convert(v,s.type)});`);break;}
        case 'stringMid':{
          const target=address(ins.target);if(!target||target.array||target.type!=='string')error('Mid assignment requires a String variable','GPU_TYPE');
          const start=convert(expr(ins.start),'long'),length=ins.length?convert(expr(ins.length),'long'):'2147483647i',value=strings.requireString(expr(ins.expr));
          out(`str_mid_assign(${target.address},${start},${length},${value});`);break;
        }
        case 'stringAlign':{
          const target=address(ins.target);if(!target||target.array||target.type!=='string')error('LSet/RSet requires a String variable','GPU_TYPE');
          out(`str_align(${target.address},${strings.requireString(expr(ins.expr))},${!!ins.right});`);break;
        }
        case 'expr':expr(ins.expr);break;
        case 'jump':next=`pc=${ins.target}u;`;break;
        case 'gosub':
          out(`if(gosub_sp>=${gosubStackDepth}u) {fail(28u);} else {gosub_stack[gosub_sp]=${pc+1}u;gosub_sp+=1u;}`);
          next=`pc=${ins.target}u;`;break;
        case 'gosubReturn':
          out('if(gosub_sp==0u) {fail(3u);} else {gosub_sp-=1u;}');
          next='pc=gosub_stack[gosub_sp];';break;
        case 'computedJump':{
          if(ins.targets.length>255)error('On GoTo/GoSub supports at most 255 targets','GPU_LIMIT');
          const index=convert(expr(ins.expr),'long');out(`if(${index}<0i || ${index}>255i) {fail(5u);}`);
          if(ins.gosub)out(`if(${index}>=1i && ${index}<=${ins.targets.length}i && vb_error==0u) {if(gosub_sp>=${gosubStackDepth}u) {fail(28u);} else {gosub_stack[gosub_sp]=${pc+1}u;gosub_sp+=1u;}}`);
          next=`switch ${index} {${ins.targets.map((target,i)=>`case ${i+1}i: {pc=${target}u;}`).join('')} default: {pc=${pc+1}u;} }`;break;
        }
        case 'redim':{
          for(const d of ins.decls){
            const s=symbol(d.name);if(!s?.array)error('ReDim requires a declared typed array','GPU_TYPE');
            if(s.dynamic===false)error('A fixed array cannot be ReDimmed','GPU_FIXED_ARRAY');
            if(d.explicitType&&typeOf(d.type)!==s.type)error('ReDim cannot change a typed array element type','GPU_TYPE');
            if(!d.bounds?.length||d.bounds.length>4)error('ReDim supports one through four dimensions','GPU_BOUNDS');
            const lows=[],highs=[];
            for(const [low,high] of d.bounds){lows.push(low?convert(expr(low),'long'):`${module.optionBase||0}i`);highs.push(convert(expr(high),'long'));}
            while(lows.length<4){lows.push('0i');highs.push('0i');}
            out(`array_redim(${s.address},${d.bounds.length}u,vec4<i32>(${lows.join(',')}),vec4<i32>(${highs.join(',')}),${!!ins.preserve});`);
          }break;
        }
        case 'erase':
          for(const node of ins.exprs){const s=nodeSymbol(node);if(!s?.array)error('Erase requires an array','GPU_TYPE');out(`array_erase(${s.address});`);}break;
        case 'branch':{const v=expr(ins.test);if(v.type==='string')error('String condition requires explicit comparison','GPU_TYPE');next=`pc=select(${ins.target}u,${pc+1}u,${ins.invert?'!':''}(${v.code}!=${zero(v.type)}));`;break;}
        case 'forInit':{
          const l=loops.get(ins.id),start=expr(ins.start),end=expr(ins.end),step=expr(ins.step);
          out(`${l.end}=${convert(end,l.type)}; ${l.step}=${convert(step,l.type)};`);
          out(`${l.type==='single'?'put_f':'put_i'}(${l.address},${convert(start,l.type)});`);
          const value=`${l.type==='single'?'get_f':'get_i'}(${l.address})`;
          next=`pc=select(${ins.target}u,${pc+1}u,select(${value}>=${l.end},${value}<=${l.end},${l.step}>=${zero(l.type)}));`;break;
        }
        case 'forNext':{
          const l=loops.get(ins.id),old=`${l.type==='single'?'get_f':'get_i'}(${l.address})`,sum=l.type==='single'?`checked_f(${old}+${l.step})`:`add_i(${old},${l.step})`;
          out(`${l.type==='single'?'put_f':'put_i'}(${l.address},${convert({code:sum,type:l.type},l.type)});`);
          next=`pc=select(${pc+1}u,${ins.target}u,select(${old}>=${l.end},${old}<=${l.end},${l.step}>=${zero(l.type)}));`;break;
        }
        case 'temp':{const v=expr(ins.expr),t=temps.get(ins.id);t.type=v.type;declarations.push(`var ${t.name}:${wgtype(t.type)};`);out(`${t.name}=${v.code};`);break;}
        case 'case':{
          const t=temps.get(ins.id);if(!t?.type)error('Invalid Select Case IR','GPU_IR');const tests=[];
          for(const c of ins.cases){if(c.kind==='range'){const low=expr(c.low),high=expr(c.high);if(low.type!==t.type||high.type!==t.type)error('Select Case values must match the selector type; cast explicitly','GPU_TYPE');tests.push(t.type==='string'?`(str_compare(${t.name},${low.code},${strings.compareMode()})>=0i && str_compare(${t.name},${high.code},${strings.compareMode()})<=0i)`:`(${t.name}>=${convert(low,t.type)} && ${t.name}<=${convert(high,t.type)})`);}else{const v=expr(c.expr);if(v.type!==t.type)error('Select Case values must match the selector type; cast explicitly','GPU_TYPE');tests.push(t.type==='string'?`(str_compare(${t.name},${v.code},${strings.compareMode()})${comparisons[c.kind==='compare'?c.op:'=']}0i)`:`(${t.name}${comparisons[c.kind==='compare'?c.op:'=']}${convert(v,t.type)})`);}}
          next=`pc=select(${ins.target}u,${pc+1}u,${tests.join(' || ')});`;break;
        }
        case 'return':next='done=true;';break;
        case 'end':out('vb_halt=true;');next='done=true;';break;
        case 'onError':out(`error_mode=${{off:0,next:1,goto:2}[ins.mode]}u; handler=${ins.target??0}u; handler_active=false; vb_last_error=0u;`);break;
        case 'raiseError':{const v=expr(ins.expr);out(`raise_error(${convert(v,'long')});`);break;}
        case 'resume':out('if(!handler_active) {fail(20u);} handler_active=false; vb_last_error=0u;');next=`pc=${ins.mode==='goto'?ins.target+'u':ins.mode==='next'?'error_pc+1u':'error_pc'};`;break;
        case 'assert':{const v=expr(ins.expr);if(v.type==='string')error('String assertion requires explicit comparison','GPU_TYPE');out(`if(${v.code}==${zero(v.type)}) {fatal(10003u);}`);break;}
        case 'graphics':{
          if(ins.object.kind!=='id'||key(ins.object.name)!=='me')error('Only the compute surface (unqualified graphics) is available','GPU_HOST_DRAW');
          const coords=ins.coords.map(v=>convert(expr(v),'single')),color=convert(expr(ins.color),'long');
          const kind={rect:2,line:3,circle:4,pixel:2}[ins.kind];if(!kind)error('Unsupported graphics command');
          let a=coords;if(ins.kind==='pixel')a=[coords[0],coords[1],`${coords[0]}+1.0f`,`${coords[1]}+1.0f`];while(a.length<4)a.push('0.0f');
          out(`draw_shape(${kind}u,vec4<f32>(${a.join(',')}),vec4<f32>(1.0,0.0,0.0,0.0),${color},${!!ins.fill||ins.kind==='pixel'});`);break;
        }
        case 'lineNumber':break;
        default:error('Instruction '+ins.op+' is not implemented in the compute target','GPU_INSTRUCTION');
      }
      blocks.push({pc,line:ins.line||proc.line,operations:[...lines],next});
    }
    const result=resultType==='void'?'':`${resultType==='single'?'get_f':'get_i'}(${locals.get(key(proc.name)).address})`;
    const body=emitCallFrame({id,params,resultType,reset:[`vb_line=${proc.line}u;vb_source=${id}u;`,...reset],declarations,blocks,result});
    compiled.set(id,body);active.delete(id);sources.push({id,module:module.name,procedure:proc.name,line:proc.line,depth:info.depth});
  }
  compileProcedure(entry);
  if(initial.length>maxStateWords)error(`State requires ${initial.length} words; limit is ${maxStateWords}`,'GPU_LIMIT');
  const words=initial.length,stride=STATE_HEADER_WORDS+words;
  const source=runtimeWGSL(words,arena.used?stringsWGSL(arena.arrays):'')+'\n'+[...compiled.values()].join('\n')+`
@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) invocation:vec3<u32>) {
  if(invocation.x>=params.count) {return;}
  vb_lane=invocation.x;vb_error=0u;vb_steps=0u;vb_draws=0u;vb_last_error=0u;vb_halt=false;vb_fatal=false;
  let base=vb_lane*${stride}u;
  for(var i=0u;i<${words}u;i+=1u) {mem[i]=state[base+${STATE_HEADER_WORDS}u+i];}
  ${emitDispatcher([...compiled.keys()],entry.id)}
  state[base]=vb_error;state[base+1u]=select(0u,vb_error_line,vb_error!=0u);state[base+2u]=vb_steps;
  state[base+3u]=vb_draws;state[base+4u]=select(0u,vb_error_source,vb_error!=0u);state[base+5u]=select(0u,1u,vb_fatal);
  for(var i=0u;i<${words}u;i+=1u) {state[base+${STATE_HEADER_WORDS}u+i]=mem[i];}
}`;
  if(source.length>4*1024*1024)error('Generated WGSL exceeds 4 MiB; reduce maxCallDepth or split the module','GPU_LIMIT');
  return {abi:COMPUTE_ABI,...(arena.used?{stringABI:1,maxStringLength}:{}),dynamicArrayCapacity,gosubStackDepth,maxCallDepth,target:'webgpu-compute',precision,requiresShared,entry:entry.module.name+'.'+entry.proc.name,entryPoint:'main',workgroupSize,
    stateWords:words,stateStride:stride,initialState:initial,globals:exports,sources:sources.sort((a,b)=>a.id-b.id),diagnostics:warnings,wgsl:source};
}
