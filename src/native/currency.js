/** Native CY values are signed 64-bit integers scaled by 10,000. Expressions
 * return an immutable snapshot address in EAX; ABI returns use EDX:EAX. Never
 * route Currency storage, literals or same-type arithmetic through Double. */
import {VBCurrency} from '../runtime/values.js';
const C='native:currency:', DLL='oleaut32.dll';
const key=value=>String(value).toLowerCase();
const arg=argument=>({argument}), addr=address=>({address});
const floats=new Set(['single','double','date']);
const scalars=new Set(['byte','integer','long','boolean','single','double','currency']);

export const nativeCurrencyMethods = {
  currencyLiteral(value) {
    let raw;
    try { raw=new VBCurrency(value).raw; } catch { this.fail('Native Currency literal is invalid or exceeds its signed 64-bit range'); }
    this.currencyLiterals ||= new Map();
    if(!this.currencyLiterals.has(raw)) {
      const name='currency:'+this.currencyLiterals.size;
      const bytes=new Uint8Array(8);new DataView(bytes.buffer).setBigInt64(0,raw,true);
      this.ro.align(8).label(name).emit(...bytes);this.currencyLiterals.set(raw,name);
    }
    return this.currencyLiterals.get(raw);
  },
  currencyWorkspace() {const v=this.arrayWorkspace(8,'currency-temp');v.type='Currency';return v;},
  currencyType(node) {
    if(node.kind==='currency'||node.kind==='literal'&&node.value instanceof VBCurrency)return 'currency';
    if(node.kind==='id'&&this.constant(node) instanceof VBCurrency)return 'currency';
    if(node.kind==='unary'&&['+','-'].includes(node.op)&&this.type(node.expr)==='currency')return 'currency';
    if(node.kind==='binary'&&['+','-','*'].includes(node.op)) {
      const a=this.type(node.left),b=this.type(node.right);
      if((a==='currency'||b==='currency')&&scalars.has(a)&&scalars.has(b)) {
        // VB's addition/subtraction precision order differs from multiplication.
        return node.op==='*'&&(a==='double'||b==='double')?'double':'currency';
      }
    }
    if(node.kind==='call'&&node.callee.kind==='id') {
      const name=key(node.callee.name).replace(/\$$/,'');
      if(name==='ccur')return 'currency';
      if(['abs','fix','int','round'].includes(name)&&node.args.length&&this.type(node.args[0])==='currency')return 'currency';
      if(name==='typename')return 'string';
    }
    return null;
  },
  currencyExpression(node) {
    const type=this.type(node);this.expression(node);
    if(type==='currency')return;
    const x=this.x,out=this.currencyWorkspace();
    x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51).call(C+(type==='string'?'parse':floats.has(type)?'from-double':'from-int'));
  },
  loadCurrency(variable) {
    const x=this.x,out=this.currencyWorkspace(),pin=this.address(variable);
    x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51).call(C+'copy');this.releaseArrayPin(pin);
  },
  storeCurrency(variable) {
    const x=this.x;x.push();const pin=this.address(variable);
    x.emit(0x5a,0x8b,0x0a,0x89,0x08,0x8b,0x4a,4,0x89,0x48,4,0x89,0xd0);
    this.releaseArrayPin(pin);
  },
  currencyToFloat(single=false) {
    const out=this.floatWorkspace(),x=this.x;
    x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51).call(C+(single?'to-single':'to-double'));
  },
  currencyToInteger() {this.x.push().call(C+'integer');},
  currencyToString() {this.x.push().call(C+'string');this.ownString();},
  /** Currency-aware lowering runs before the generic floating/int paths. */
  currencyOperation(node) {
    const x=this.x,type=this.type(node);
    if(node.kind==='currency'||node.kind==='literal'&&node.value instanceof VBCurrency){x.value(this.currencyLiteral(node.value));return true;}
    if(node.kind==='unary'&&['+','-'].includes(node.op)&&type==='currency') {
      // The magnitude of the most-negative literal is outside positive CY range.
      if(node.op==='-'&&node.expr.kind==='currency'){x.value(this.currencyLiteral('-'+node.expr.value));return true;}
      this.currencyExpression(node.expr);if(node.op==='-')this.currencyUnary('negate');return true;
    }
    if(node.kind!=='binary')return false;
    const a=this.type(node.left),b=this.type(node.right),op=node.op;
    const compare=['=','<>','<','<=','>','>='].includes(op)&&(a==='currency'||b==='currency');
    if(compare) {
      if(!scalars.has(a)||!scalars.has(b))this.fail('Use CCur explicitly in mixed native text/Currency operations');
      const leftFloat=floats.has(a),rightFloat=floats.has(b);
      if(leftFloat)this.floatExpression(node.left);else this.currencyExpression(node.left);x.push();
      if(rightFloat)this.floatExpression(node.right);else this.currencyExpression(node.right);x.emit(0x59);
      if(leftFloat)x.emit(0x51).push().call(C+'compare-double').emit(0xf7,0xd8);
      else x.push().emit(0x51).call(C+(rightFloat?'compare-double':'compare'));
      x.compare(0);this.boolean(op);return true;
    }
    if(type!=='currency')return false;
    this.currencyExpression(node.left);x.push();this.currencyExpression(node.right);x.emit(0x59,0x51,0x50);
    const out=this.currencyWorkspace();this.rawStorageAddress(out);
    x.emit(0x5a,0x59).push().emit(0x52,0x51).call(C+({'+':'add','-':'subtract','*':'multiply'})[op]);return true;
  },
  currencyUnary(name) {
    const x=this.x,out=this.currencyWorkspace();x.push();this.rawStorageAddress(out);x.emit(0x59).push().emit(0x51).call(C+name);
  },
  nativeQueryType(node) {
    while(node.kind==='group')node=node.expr;
    if(node.kind==='literal'&&typeof node.value==='boolean')return 'boolean';
    // Comparisons yield Boolean even though EAX carries their -1/0 value in a
    // 32-bit register. Do not expose that physical register width as VarType.
    if(node.kind==='binary'&&['=','<>','<','<=','>','>='].includes(key(node.op)))return 'boolean';
    if(node.kind==='unary'&&key(node.op)==='not'&&this.nativeQueryType(node.expr)==='boolean')return 'boolean';
    if(node.kind==='binary'&&['and','or','xor','eqv','imp'].includes(key(node.op))&&this.nativeQueryType(node.left)==='boolean'&&this.nativeQueryType(node.right)==='boolean')return 'boolean';
    return this.type(node);
  },
  currencyBuiltin(node,name) {
    const x=this.x,args=node.args;
    if(name==='ccur'){if(args.length!==1)this.fail('CCur expects one argument');this.currencyExpression(args[0]);return true;}
    if(['vartype','typename'].includes(name)) {
      if(args.length!==1)this.fail(name+' expects one argument');
      let query=args[0];while(query.kind==='group')query=query.expr;
      // Authored literal and scalar expression metadata preserve their VB subtype.

      const variable=this.variable(query),array=variable?.nativeArray&&!variable.elementOf;
      const type=array?key(variable.type):this.nativeQueryType(query);
      const descriptor={byte:[17,'Byte'],integer:[2,'Integer'],long:[3,'Long'],boolean:[11,'Boolean'],single:[4,'Single'],double:[5,'Double'],date:[7,'Date'],currency:[6,'Currency'],string:[8,'String']}[type];
      if(!descriptor)this.fail('Native '+name+' requires a supported typed value');
      if(!array)this.expression(args[0]);
      x.value(name==='vartype'?descriptor[0]+(array?8192:0):this.string(descriptor[1]+(array?'()':'')));return true;
    }
    if(!args.length||this.type(args[0])!=='currency')return false;
    if(['clng','cint','cbyte','cbool'].includes(name)) {
      if(args.length!==1)this.fail(name+' expects one argument');this.expression(args[0]);
      if(name==='cbool')x.push().call(C+'boolean');else {this.currencyToInteger();this.check({clng:'Long',cint:'Integer',cbyte:'Byte'}[name]);}return true;
    }
    if(['abs','fix','int','sgn'].includes(name)) {
      if(args.length!==1)this.fail(name+' expects one argument');this.expression(args[0]);
      if(name==='sgn')x.push().call(C+'sign');else this.currencyUnary(name);return true;
    }
    if(name==='round') {
      if(args.length>2)this.fail('Round expects one or two arguments');
      this.expression(args[0]);x.push();this.numeric(args[1]||{kind:'literal',value:0});x.push();
      const out=this.currencyWorkspace();this.rawStorageAddress(out);x.emit(0x5a,0x59).push().emit(0x52,0x51).call(C+'round');return true;
    }
    if(name==='csng'){if(args.length!==1)this.fail('CSng expects one argument');this.expression(args[0]);this.currencyToFloat(true);return true;}
    return false;
  },
  captureCurrencyReturn() {
    const x=this.x,out=this.currencyWorkspace();
    // Preserve both ABI registers before address generation or error/lock helpers.
    x.emit(0x52,0x50);this.rawStorageAddress(out);x.emit(0x59,0x5a,0x89,0x08,0x89,0x50,4);
  }
};

/** All pointers/lengths here originate from emitted storage, not untrusted IPC. */
export function emitNativeCurrencyHelpers(c) {
  const x=c.x,check=()=>x.call('native:number:check');
  // copy(in*, out*) works on arbitrary bit patterns, not IEEE finite checks.
  x.label(C+'copy').enter().value(arg(8)).emit(0x8b,0x08,0x8b,0x50,4).value(arg(12)).emit(0x89,0x08,0x89,0x50,4).leave(8);
  x.label(C+'from-int').enter().api(DLL,'VarCyFromI4',[arg(8),arg(12)]);check();x.value(arg(12)).leave(8);
  x.label(C+'parse').enter().push(arg(8)).call('native:string:numeric-text').api(DLL,'VarCyFromStr',[arg(8),0x400,0,arg(12)]);check();x.value(arg(12)).leave(8);
  x.label(C+'from-double').enter().value(arg(8)).call('native:number:finite').emit(0x89,0xc3).push(arg(12)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarCyFromR8');check();x.value(arg(12)).leave(8);
  x.label(C+'to-double').enter().value(arg(8)).emit(0x89,0xc3).push(arg(12)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarR8FromCy');check();x.value(arg(12)).call('native:number:finite').leave(8);
  x.label(C+'to-single').enter(4).value(arg(8)).emit(0x89,0xc3).push(addr(-4)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarR4FromCy');check();x.emit(0xd9,0x45,0xfc).value(arg(12)).emit(0xdd,0x18).call('native:number:finite').leave(8);
  x.label(C+'integer').enter(4).value(arg(8)).emit(0x89,0xc3).push(addr(-4)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarI4FromCy');check();x.value(arg(-4)).leave(4);
  x.label(C+'string').enter(4).value(0).emit(0x89,0x45,0xfc).value(arg(8)).emit(0x89,0xc3).push(addr(-4)).push(0).push(0x400).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarBstrFromCy');check();x.value(arg(-4)).leave(4);
  x.label(C+'boolean').enter().value(arg(8)).emit(0x8b,0x10,0x0b,0x50,4,0x0f,0x95,0xc0,0x0f,0xb6,0xc0,0xf7,0xd8).leave(4);
  const negative=x.unique(),signDone=x.unique();
  x.label(C+'sign').enter().value(arg(8)).emit(0x8b,0x50,4,0x85,0xd2).branch('s',negative).emit(0x0b,0x10,0x0f,0x95,0xc0,0x0f,0xb6,0xc0).jump(signDone).label(negative).value(-1).label(signDone).leave(4);
  for(const [name,symbol]of [['add','VarCyAdd'],['subtract','VarCySub'],['multiply','VarCyMul']]) {
    x.label(C+name).enter().value(arg(8)).emit(0x89,0xc3).value(arg(12)).emit(0x89,0xc6).push(arg(16)).emit(0xff,0x76,4,0xff,0x36,0xff,0x73,4,0xff,0x33).invoke(DLL,symbol);check();x.value(arg(16)).leave(12);
  }
  for(const [name,symbol]of [['negate','VarCyNeg'],['abs','VarCyAbs'],['fix','VarCyFix'],['int','VarCyInt']]) {
    x.label(C+name).enter().value(arg(8)).emit(0x89,0xc3).push(arg(12)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,symbol);check();x.value(arg(12)).leave(8);
  }
  for(const [name,symbol]of [['compare','VarCyCmp'],['compare-double','VarCyCmpR8']]) {
    x.label(C+name).enter().value(arg(8)).emit(0x89,0xc3).value(arg(12)).emit(0x89,0xc6,0xff,0x76,4,0xff,0x36,0xff,0x73,4,0xff,0x33).invoke(DLL,symbol);check();x.emit(0x48).leave(8); // VARCMP_LT/EQ/GT = 0/1/2
  }
  const unchanged=x.unique();
  x.label(C+'round').enter().value(arg(12)).compare(0).branch('l','error:5').compare(28).branch('g','error:5').compare(4).branch('ge',unchanged);
  x.value(arg(8)).emit(0x89,0xc3).push(arg(16)).push(arg(12)).emit(0xff,0x73,4,0xff,0x33).invoke(DLL,'VarCyRound');check();x.value(arg(16)).leave(12);
  x.label(unchanged).push(arg(16)).push(arg(8)).call(C+'copy').leave(12);
}
