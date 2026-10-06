/** Native Single/Double lowering. Floating expressions return an immutable Double
 * snapshot address in EAX; only ABI returns use ST(0). No live FPU values span
 * a call, checkpoint, allocation or VB error transfer. */
export const FLOAT_TYPES = new Set(['single','double']);
export const REAL_TYPES = new Set([...FLOAT_TYPES,'date']);
const key=value=>String(value).toLowerCase();
const N='native:number:';
const DLL='oleaut32.dll';
const arg=argument=>({argument});
const addr=address=>({address});
const literal=value=>({kind:'literal',value});
export const nativeParameterBytes=p=>!p.byRef && (p.bounds===null||p.bounds===undefined) && ['double','currency','date'].includes(key(p.type))?8:4;

export const nativeNumericMethods = {
  floatLiteral(value) {
    if(!Number.isFinite(value))this.fail('Native floating literal must be finite');
    this.floatLiterals ||= new Map();
    const bytes=new Uint8Array(8);new DataView(bytes.buffer).setFloat64(0,value,true);
    const identity=Array.from(bytes).join(',');
    if(!this.floatLiterals.has(identity)){
      const name='number:'+this.floatLiterals.size;this.ro.align(8).label(name).emit(...bytes);this.floatLiterals.set(identity,name);
    }
    return this.floatLiterals.get(identity);
  },
  floatWorkspace() { const v=this.arrayWorkspace(8,'number-temp');v.type='Double';return v; },
  numericType(node) {
    if(node.kind==='literal'&&typeof node.value==='number'&&(!Number.isInteger(node.value)||node.value>2147483647||node.value< -2147483648))return 'double';
    if(node.kind==='unary'&&['+','-'].includes(node.op)){const type=this.type(node.expr);return FLOAT_TYPES.has(type)?type:null;}
    if(node.kind==='binary'){
      const op=key(node.op);
      if(op==='^')return 'double';
      if(['+','-','*','/'].includes(op)){
        const a=this.type(node.left),b=this.type(node.right);
        if(a==='string'||b==='string')return null;
        if(op==='/'&&[a,b].every(t=>['byte','integer','single'].includes(t)))return 'single';
        if(op==='/'||a==='double'||b==='double')return 'double';
        if(a==='single'||b==='single')return [a,b].includes('long')?'double':'single';
      }
    }
    if(node.kind==='call'&&node.callee.kind==='id'){
      const name=key(node.callee.name).replace(/\$$/,'');
      if(['cdbl','val','sqr','round'].includes(name))return 'double';
      if(name==='csng')return 'single';
      if(['abs','fix','int'].includes(name)&&node.args.length===1)return this.type(node.args[0]);
      return {cint:'integer',cbyte:'byte',cbool:'boolean',clng:'long'}[name]||null;
    }
    return null;
  },
  floatExpression(node,single=false) {
    const type=this.type(node);this.expression(node);
    if(type==='currency'){this.currencyToFloat(single);return;}
    if(REAL_TYPES.has(type))return;
    const out=this.floatWorkspace();this.x.push();this.rawStorageAddress(out);this.x.emit(0x59).push().emit(0x51).call(N+(type==='string'?'parse':'from-int'));
  },
  loadFloat(variable) {
    const out=this.floatWorkspace(),x=this.x,pin=this.address(variable);x.push();this.rawStorageAddress(out);
    x.emit(0x59).push().emit(0x51).call(N+(key(variable.type)==='single'?'load-single':'copy'));
    this.releaseArrayPin(pin);
  },
  roundSingle() {
    const out=this.floatWorkspace(),x=this.x;x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51).call(N+'single');
  },
  storeFloat(variable) {
    const x=this.x;if(key(variable.type)==='single')this.roundSingle();
    x.push();const pin=this.address(variable);
    x.emit(0x5a,0xdd,0x02,...(key(variable.type)==='single'?[0xd9,0x18]:[0xdd,0x18]),0x89,0xd0);
    this.releaseArrayPin(pin);
  },
  floatToInteger() {this.x.push().call(N+'integer');},
  floatToString(type) {this.x.emit(0x89,0xc3).push(key(type)==='single'?1:0).emit(0x53).call(N+'string');this.ownString();},
  truth(node) {this.expression(node);if(this.type(node)==='currency')this.x.push().call('native:currency:boolean');else if(REAL_TYPES.has(this.type(node)))this.x.push().call(N+'boolean');else if(this.type(node)==='string')this.fail('Use CBool to convert native text to Boolean');},
  numericExpression(node) {
    const x=this.x;
    if(node.kind==='literal'&&REAL_TYPES.has(this.type(node))){x.value(this.floatLiteral(node.value));return true;}
    if(node.kind==='unary'&&['+','-'].includes(node.op)&&REAL_TYPES.has(this.type(node))){
      this.floatExpression(node.expr);if(node.op==='-')this.floatUnary('negate');return true;
    }
    if(node.kind!=='binary')return false;
    const op=key(node.op),type=this.type(node),a=this.type(node.left),b=this.type(node.right);
    const comparison=['=','<>','<','<=','>','>='].includes(op)&&(REAL_TYPES.has(a)||REAL_TYPES.has(b));
    if(!comparison&&!REAL_TYPES.has(type))return false;
    if(a==='string'||b==='string')this.fail('Use CDbl or Val explicitly in mixed native text/numeric operations');
    this.floatExpression(node.left);x.push();this.floatExpression(node.right);x.emit(0x59);
    if(comparison){x.push().emit(0x51).call(N+'compare').compare(0);this.boolean(op);return true;}
    const helper={'+':'add','-':'subtract','*':'multiply','/':'divide','^':'power'}[op];
    if(!helper)this.fail('Native floating operator is not implemented: '+op);
    x.emit(0x51,0x50);const out=this.floatWorkspace();this.rawStorageAddress(out);x.emit(0x5a,0x59).push().emit(0x52,0x51).call(N+helper);
    if(type==='single')this.roundSingle();return true;
  },
  floatUnary(name) {
    const x=this.x,out=this.floatWorkspace();x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51).call(N+name);
  },
  numericBuiltin(node,name) {
    const x=this.x,args=node.args;
    if(['cdbl','csng','val'].includes(name)){
      if(args.length!==1)this.fail(name+' expects one argument');
      if(name==='val'){
        this.textExpression(args[0]);x.push().call(N+'compact-val');this.ownString();
        const out=this.floatWorkspace();x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51).call(N+'val');
      }else this.floatExpression(args[0]);
      if(name==='csng')this.roundSingle();return true;
    }
    if(['clng','cint','cbyte','cbool'].includes(name)&&args.length===1&&REAL_TYPES.has(this.type(args[0]))){
      this.expression(args[0]);x.push().call(N+(name==='cbool'?'boolean':'integer'));this.check({cint:'Integer',cbyte:'Byte',cbool:'Boolean',clng:'Long'}[name]);return true;
    }
    if(['fix','int','sqr','abs','sgn'].includes(name)){
      if(args.length!==1)this.fail(name+' expects one argument');
      const type=this.type(args[0]);
      if(!REAL_TYPES.has(type)&&name!=='sqr'){
        if(name==='fix'||name==='int'){this.numeric(args[0]);return true;}
        return false;
      }
      this.floatExpression(args[0]);
      if(name==='sgn'){x.push().call(N+'sign');return true;}
      this.floatUnary(name);if(type==='single'&&name!=='sqr')this.roundSingle();if(type==='date'&&name!=='sqr')x.call('native:date:validate');return true;
    }
    if(name==='round'){
      if(args.length<1||args.length>2)this.fail('Round expects one or two arguments');
      this.floatExpression(args[0]);x.push();this.numeric(args[1]||literal(0));x.push();
      const out=this.floatWorkspace();this.rawStorageAddress(out);x.emit(0x5a,0x59).push().emit(0x52,0x51).call(N+'round');return true;
    }
    if(name==='instr'){
      if(args.length<2||args.length>4)this.fail('InStr expects two to four arguments');
      const offset=args.length===2?0:1,defaultCompare=this.context.module.module.optionCompare==='text'?1:0;
      this.numeric(offset?args[0]:literal(1));x.push();this.textExpression(args[offset]);x.push();this.textExpression(args[offset+1]);x.push();
      this.numeric(args[3]||literal(defaultCompare));const ready=x.unique();x.compare(-1).branch('ne',ready).value(defaultCompare).label(ready);
      x.emit(0x5a,0x59,0x5b).push().emit(0x52,0x51,0x53).call(N+'instr');return true;
    }
    return false;
  },
  nativeTypedCall(target,plan) {
    const x=this.x,signature=target.proc||target,callPins=[],callStrings=[],slots=new Array(signature.params.length);
    // Stage in the caller's frame: arguments are evaluated exactly once in source
    // order, even with mixed 4/8-byte ABI slots, recursion and array reallocation.
    plan.order.forEach(({node,index:i,omitted})=>{
      const p=signature.params[i],slot=this.arrayWorkspace(nativeParameterBytes(p),'call-argument');
      if(node.kind==='addressOf'){this.nativeCallbackArgument(p,node);}
      else if(node.kind==='byval'){this.numeric(node.expr);}
      else if(p.bounds!==null&&p.bounds!==undefined){
        if(node.kind==='group')this.fail('Parenthesized whole-array values are not yet lowered; pass the typed array directly');
        const a=this.variable(node);
        if(!target.proc||!p.byRef||!a?.nativeArray||a.elementOf||key(a.type)!==key(p.type))this.fail('ByRef array argument must have the exact declared element type');
        if(a.fixedLength)this.fail('Fixed-length String whole-array arguments are not yet lowered');this.rawStorageAddress(a);
      }else if(p.byRef){
        const {pin,temporary}=this.nativeReferenceArgument(p,node,omitted);
        if(pin)callPins.push(pin);if(temporary&&key(temporary.type)==='string')callStrings.push(temporary);
      }else if(key(p.type)==='currency'){slot.type=p.type;this.currencyExpression(node);this.storeCurrency(slot);slots[i]=slot;return;}
      else if(key(p.type)==='date'){slot.type=p.type;this.dateExpression(node);this.storeDate(slot);slots[i]=slot;return;}
      else if(REAL_TYPES.has(key(p.type))){slot.type=p.type;this.floatExpression(node,key(p.type)==='single');this.storeFloat(slot);slots[i]=slot;return;}
      else if(key(p.type)==='string')this.textExpression(node);else if(key(p.type)==='boolean'){this.truth(node);this.check('Boolean');}else{if(p.nativeCoerce&&this.type(node)==='string')this.call({kind:'call',callee:{kind:'id',name:'CLng'},args:[node]});else this.numeric(node);this.check(p.type);}
      x.push();this.rawStorageAddress(slot);x.emit(0x5a,0x89,0x10);slots[i]=slot;
    });
    for(const slot of [...slots].reverse()){this.rawStorageAddress(slot);if(slot.nativeBytes===8)x.emit(0xff,0x70,4);x.emit(0xff,0x30);}
    if(target.proc)x.call(target.label);else x.invoke(target.dll,target.symbol);
    if(signature.kind==='function'&&key(signature.returnType)==='currency'){
      this.captureCurrencyReturn();if(target.proc)this.checkNativeError();
    }else if(signature.kind==='function'&&REAL_TYPES.has(key(signature.returnType))){
      const out=this.floatWorkspace();this.rawStorageAddress(out);x.emit(0xdd,0x18); // Pop ABI result before any helper/error check.
      if(target.proc)this.checkNativeError();x.call(N+'finite');
      if(key(signature.returnType)==='single')this.roundSingle();
      if(key(signature.returnType)==='date')x.call('native:date:validate');
    }else if(target.proc)this.checkNativeError();
    for(const pin of callPins)this.releaseArrayPin(pin);
    if(callStrings.length){x.push();for(const string of callStrings)this.clearStringStorage(string);x.emit(0x58);}
    if(target.proc&&signature.kind==='function'&&key(signature.returnType)==='string')this.ownString();
    if(!target.proc){if(['integer','boolean'].includes(key(signature.returnType)))x.emit(0x0f,0xbf,0xc0);else if(key(signature.returnType)==='byte')x.emit(0x0f,0xb6,0xc0);}
  }
};

// Helpers use only documented Windows Automation conversions and generated x86.
// Save/restore x87 control state before checking failures. Invalid/nonfinite values
// become VB errors, never a pending FPU trap crossing an error-handler boundary.
export function emitNativeNumericHelpers(c) {
  const x=c.x;
  const startFP=(word=0x027f)=>x.emit(0xd9,0x7d,0xfc,0x66,0xc7,0x45,0xf8,word&255,word>>>8,0xd9,0x6d,0xf8);
  const endFP=()=>x.emit(0xdb,0xe2,0xd9,0x6d,0xfc);
  const ok=x.unique();
  x.label(N+'check').test().branch('ns',ok).compare(0x8002000a).branch('e','error:6').compare(0x8007000e).branch('e','error:7').compare(0x80020012).branch('e','error:11').compare(0x80070057).branch('e','error:5').jump('error:13').label(ok).emit(0xc3);
  x.label(N+'finite').emit(0x8b,0x50,4,0x81,0xe2).imm(0x7ff00000).emit(0x81,0xfa).imm(0x7ff00000).branch('e','error:6').emit(0xc3);
  x.label(N+'copy').enter().value(arg(8)).emit(0x8b,0x08,0x8b,0x50,4).value(arg(12)).emit(0x89,0x08,0x89,0x50,4).call(N+'finite').leave(8);
  x.label(N+'from-int').enter().emit(0xdb,0x45,8).value(arg(12)).emit(0xdd,0x18).leave(8);
  x.label(N+'load-single').enter().value(arg(8)).emit(0xd9,0x00).value(arg(12)).emit(0xdd,0x18).call(N+'finite').leave(8);
  x.label(N+'single').enter(12);startFP();x.value(arg(8)).emit(0xdd,0x00,0xd9,0x5d,0xf4);endFP();
  x.value(arg(-12)).emit(0x25).imm(0x7f800000).compare(0x7f800000).branch('e','error:6');x.emit(0xd9,0x45,0xf4).value(arg(12)).emit(0xdd,0x18).leave(8);
  for(const [name,opcode]of [['add',0xc1],['subtract',0xe9],['multiply',0xc9],['divide',0xf9]]){
    x.label(N+name).enter(8);
    if(name==='divide')x.value(arg(12)).emit(0x8b,0x50,4,0x81,0xe2).imm(0x7fffffff).emit(0x0b,0x10).branch('e','error:11');
    startFP();x.value(arg(8)).emit(0xdd,0x00).value(arg(12)).emit(0xdd,0x00,0xde,opcode).value(arg(16)).emit(0xdd,0x18);endFP();x.call(N+'finite').leave(12);
  }
  const less=x.unique(),greater=x.unique(),compared=x.unique();
  x.label(N+'compare').enter().value(arg(12)).emit(0xdd,0x00).value(arg(8)).emit(0xdd,0x00,0xde,0xd9,0xdf,0xe0,0x9e).branch('b',less).branch('a',greater).value(0).jump(compared).label(less).value(-1).jump(compared).label(greater).value(1).label(compared).leave(8);
  x.label(N+'boolean').enter().value(arg(8)).call(N+'finite').emit(0x8b,0x50,4,0x81,0xe2).imm(0x7fffffff).emit(0x0b,0x10,0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0xf7,0xd8).leave(4);
  x.label(N+'integer').enter(4).value(arg(8)).call(N+'finite').emit(0x89,0xc3).push(addr(-4)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarI4FromR8').call(N+'check').value(arg(-4)).leave(4);
  x.label(N+'parse').enter().push(arg(8)).call('native:string:numeric-text').push(arg(12)).push(0).push(0x400).push(arg(8)).invoke(DLL,'VarR8FromStr').call(N+'check').value(arg(12)).call(N+'finite').leave(8);
  const doubleString=x.unique(),stringDone=x.unique();
  x.label(N+'string').enter(8).value(0).emit(0x89,0x45,0xfc).value(arg(8)).call(N+'finite').emit(0x89,0xc3).value(arg(12)).test().branch('e',doubleString);
  x.emit(0xdd,0x03,0xd9,0x5d,0xf8).push(addr(-4)).push(0).push(0x400).push(arg(-8)).invoke(DLL,'VarBstrFromR4').jump(stringDone);
  x.label(doubleString).push(addr(-4)).push(0).push(0x400).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarBstrFromR8');
  x.label(stringDone).call(N+'check').value(arg(-4)).leave(8);
  for(const name of ['negate','abs']){
    x.label(N+name).enter().value(arg(8)).emit(0x8b,0x08,0x8b,0x50,4,0x81,name==='negate'?0xf2:0xe2).imm(name==='negate'?0x80000000:0x7fffffff).value(arg(12)).emit(0x89,0x08,0x89,0x50,4).leave(8);
  }
  x.label(N+'sign').enter().push(c.floatLiteral(0)).push(arg(8)).call(N+'compare').leave(4);
  for(const [name,cw]of [['fix',0x0e7f],['int',0x067f],['sqr',0x027f]]){
    x.label(N+name).enter(8);
    if(name==='sqr'){const nonnegative=x.unique();x.value(arg(8)).emit(0xf7,0x40,4).imm(0x80000000).branch('e',nonnegative).emit(0x8b,0x50,4,0x81,0xe2).imm(0x7fffffff).emit(0x0b,0x10).branch('ne','error:5').label(nonnegative);}
    startFP(cw);x.value(arg(8)).emit(0xdd,0x00,0xd9,name==='sqr'?0xfa:0xfc).value(arg(12)).emit(0xdd,0x18);endFP();x.call(N+'finite').leave(8);
  }
  x.label(N+'power').enter().value(arg(8)).emit(0x89,0xc3).value(arg(12)).emit(0x89,0xc6).push(arg(16)).emit(0xff,0x76,4,0xff,0x36,0xff,0x73,4,0xff,0x33).invoke(DLL,'VarR8Pow').call(N+'check').value(arg(16)).call(N+'finite').leave(12);
  x.label(N+'round').enter().value(arg(12)).compare(0).branch('l','error:5').compare(28).branch('g','error:5').value(arg(8)).emit(0x89,0xc3).push(arg(16)).push(arg(12)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarR8Round').call(N+'check').value(arg(16)).call(N+'finite').leave(12);
  emitValHelpers(c);
  emitInStrHelper(c);
}

function emitInStrHelper(c){
  const x=c.x,empty=x.unique(),notFound=x.unique(),found=x.unique(),loop=x.unique(),next=x.unique(),text=x.unique(),scan=x.unique(),done=x.unique();
  // instr(start, haystack BSTR, needle BSTR, compare) -- explicit lengths retain NULs.
  x.label(N+'instr').enter(12).value(arg(8)).compare(1).branch('l','error:5').emit(0x48,0x89,0xc6);
  x.value(arg(20)).compare(0).branch('l','error:5').compare(1).branch('g','error:5');
  x.api(DLL,'SysStringLen',[arg(12)]).emit(0x89,0x45,0xfc).test().branch('e',notFound);
  x.api(DLL,'SysStringLen',[arg(16)]).emit(0x89,0x45,0xf8).test().branch('e',empty);
  x.label(loop).value(arg(-4)).emit(0x2b,0x45,0xf8,0x39,0xc6).branch('g',notFound);
  x.value(arg(20)).test().branch('ne',text);
  x.value(arg(12)).emit(0x8d,0x1c,0x70).value(arg(16)).emit(0x89,0xc7,0x31,0xc9);
  x.label(scan).emit(0x3b,0x4d,0xf8).branch('e',found).emit(0x0f,0xb7,0x04,0x4b,0x66,0x3b,0x04,0x4f).branch('ne',next).emit(0x41).jump(scan);
  x.label(text).value(arg(12)).emit(0x8d,0x1c,0x70).push(arg(-8)).push(arg(16)).push(arg(-8)).emit(0x53).push(1).push(0x400).invoke('kernel32.dll','CompareStringW').test().branch('e','error:5').compare(2).branch('e',found);
  x.label(next).emit(0x46).jump(loop).label(found).emit(0x8d,0x46,1).jump(done).label(empty).value(arg(8)).jump(done).label(notFound).value(0).label(done).leave(16);
}

function emitValHelpers(c){
  const x=c.x;
  const compactLoop=x.unique(),compactNext=x.unique(),compactDone=x.unique();
  x.label(N+'compact-val').enter().api(DLL,'SysStringLen',[arg(8)]).compare(1048576).branch('g','error:7').emit(0x89,0xc3).push().push(0).invoke(DLL,'SysAllocStringLen').test().branch('e','error:7').emit(0x89,0xc7).push().value(arg(8)).emit(0x89,0xc6);
  x.label(compactLoop).emit(0x85,0xdb).branch('e',compactDone).emit(0x0f,0xb7,0x06,0x83,0xc6,2,0x4b).compare(32).branch('e',compactNext).compare(9).branch('e',compactNext).compare(10).branch('e',compactNext).compare(13).branch('e',compactNext).emit(0x66,0x89,0x07,0x83,0xc7,2);
  x.label(compactNext).jump(compactLoop).label(compactDone).emit(0x66,0xc7,0x07,0,0,0x58).leave(4);
  const signDone=x.unique(),negative=x.unique(),decimal=x.unique(),digitLoop=x.unique(),point=x.unique(),exponent=x.unique(),exponentSign=x.unique(),exponentDigits=x.unique(),exponentDone=x.unique(),end=x.unique(),zero=x.unique(),converted=x.unique(),finish=x.unique();
  const hex=x.unique(),radixLoop=x.unique(),radixEnd=x.unique(),hexLetter=x.unique(),radixDigit=x.unique(),radixValid=x.unique(),radixUnsigned=x.unique(),radixSign=x.unique();
  const suffixInteger=x.unique(),suffixLong=x.unique(),suffixSingle=x.unique(),suffixCurrency=x.unique(),suffixDone=x.unique();
  // val(owned compact buffer, Double out). All text ownership belongs to the caller.
  x.label(N+'val').enter(32).value(arg(8)).emit(0x89,0xc6,0x89,0xf7).value(0).emit(0x89,0x45,0xfc,0x89,0x45,0xf8,0x89,0x45,0xf4,0x89,0x45,0xf0);
  x.emit(0x0f,0xb7,0x06).compare(45).branch('e',negative).compare(43).branch('ne',signDone).emit(0x83,0xc6,2).jump(signDone);
  x.label(negative).value(1).emit(0x89,0x45,0xfc,0x83,0xc6,2).label(signDone).emit(0x0f,0xb7,0x06).compare(38).branch('ne',decimal);
  x.emit(0x0f,0xb7,0x46,2,0x83,0xe0,0xdf).compare(72).branch('e',hex).compare(79).branch('ne',zero).value(8).emit(0x89,0x45,0xf0).jump(radixLoop+':start');
  x.label(hex).value(16).emit(0x89,0x45,0xf0).label(radixLoop+':start').emit(0x83,0xc6,4,0x31,0xdb);
  x.label(radixLoop).emit(0x0f,0xb7,0x0e,0x83,0xf9,48).branch('b',radixEnd).emit(0x83,0xf9,57).branch('a',hexLetter).emit(0x83,0xe9,48).jump(radixDigit);
  x.label(hexLetter).emit(0x83,0xe1,0xdf,0x83,0xf9,65).branch('b',radixEnd).emit(0x83,0xf9,70).branch('a',radixEnd).emit(0x83,0xe9,55);
  x.label(radixDigit).emit(0x3b,0x4d,0xf0).branch('ae',radixEnd).emit(0x89,0xd8,0xf7,0x65,0xf0,0x85,0xd2).branch('ne','error:6').emit(0x01,0xc8).branch('b','error:6').emit(0x89,0xc3,0xff,0x45,0xf8,0x83,0xc6,2).jump(radixLoop);
  x.label(radixEnd).emit(0x83,0x7d,0xf8,0).branch('e',zero).emit(0x0f,0xb7,0x06,0x89,0x45,0xec).compare(38).branch('e',radixUnsigned).emit(0x81,0xfb).imm(65535).branch('a',radixUnsigned).emit(0x0f,0xbf,0xdb);
  x.label(radixUnsigned).emit(0x89,0x5d,0xe8).push(arg(12)).push(arg(-24)).call(N+'from-int');
  x.emit(0x83,0x7d,0xfc,0).branch('e',converted).push(arg(12)).push(arg(12)).call(N+'negate').jump(converted);
  x.label(decimal).label(digitLoop).emit(0x0f,0xb7,0x06).compare(48).branch('b',point).compare(57).branch('a',point).emit(0xff,0x45,0xf8,0x83,0xc6,2).jump(digitLoop);
  x.label(point).compare(46).branch('ne',exponent).emit(0x83,0x7d,0xf4,0).branch('ne',end).value(1).emit(0x89,0x45,0xf4,0x83,0xc6,2).jump(digitLoop);
  x.label(exponent).emit(0x83,0xe0,0xdf).compare(69).branch('e',exponentSign).compare(68).branch('ne',end);
  x.label(exponentSign).emit(0x89,0xf3,0x66,0xc7,0x06,69,0,0x83,0xc6,2,0x0f,0xb7,0x06).compare(43).branch('e',exponentDigits+':sign').compare(45).branch('ne',exponentDigits+':start');
  x.label(exponentDigits+':sign').emit(0x83,0xc6,2).label(exponentDigits+':start').emit(0x89,0xf2);
  x.label(exponentDigits).emit(0x0f,0xb7,0x06).compare(48).branch('b',exponentDone).compare(57).branch('a',exponentDone).emit(0x83,0xc6,2).jump(exponentDigits);
  x.label(exponentDone).emit(0x39,0xd6).branch('ne',end).emit(0x89,0xde);
  x.label(end).emit(0x83,0x7d,0xf8,0).branch('e',zero).emit(0x0f,0xb7,0x06,0x89,0x45,0xec,0x66,0xc7,0x06,0,0);
  x.api(DLL,'VarR8FromStr',[arg(8),0x409,0x80000000,arg(12)]).call(N+'check').value(arg(12)).call(N+'finite');
  x.label(converted).value(arg(-20)).compare(37).branch('e',suffixInteger).compare(38).branch('e',suffixLong).compare(33).branch('e',suffixSingle).compare(64).branch('e',suffixCurrency).compare(36).branch('e','error:13').jump(finish);
  x.label(suffixInteger).value(1).emit(0x89,0x45,0xf0).jump(suffixLong+':convert');
  x.label(suffixLong).value(0).emit(0x89,0x45,0xf0).label(suffixLong+':convert').push(arg(12)).call(N+'integer').emit(0x89,0xc3).push(addr(-32)).emit(0x53).call(N+'from-int');
  x.push(addr(-32)).push(arg(12)).call(N+'compare').test().branch('ne','error:13');const noIntRange=x.unique();x.emit(0x83,0x7d,0xf0,0).branch('e',noIntRange).emit(0x89,0xd8).compare(-32768).branch('l','error:6').compare(32767).branch('g','error:6').label(noIntRange).jump(finish);
  x.label(suffixSingle).push(arg(12)).push(arg(12)).call(N+'single').jump(finish);
  x.label(suffixCurrency).value(arg(12)).emit(0x89,0xc3).push(addr(-32)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarCyFromR8').call(N+'check').push(arg(12)).push(arg(-28)).push(arg(-32)).invoke(DLL,'VarR8FromCy').call(N+'check').jump(finish);
  x.label(zero).value(arg(12)).emit(0xc7,0x00,0,0,0,0,0xc7,0x40,4,0,0,0,0);
  x.label(finish).value(arg(12)).call(N+'finite').leave(8);
}
