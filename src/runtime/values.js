import {VBDecimal} from './decimal.js';
export {VBDecimal};
import {asDate,dateToSerial} from './calendar.js';
import { VBError } from '../language/lexer.js';
import { lower } from '../core/core.js';
export function bankersRound(n) { if(!Number.isFinite(n))throw new VBError('Overflow',6);const floor=Math.floor(n), f=n-floor;return f===0.5?(floor%2===0?floor:floor+1):Math.round(n); }
export const NOTHING = Object.freeze({__nothing:true});
export const MISSING = Object.freeze({__missing:true});
/** Variant/Error is a value, not a thrown exception or a host object. */
export class VBErrorValue {
  constructor(number){number=bankersRound(numeric(number));if(number<0||number>65535)throw new VBError('Overflow',6);this.number=number;Object.freeze(this);}
  toString(){return 'Error '+this.number;}
}
export const explicitErrorValue=value=>unbox(value) instanceof VBErrorValue?unbox(value).number:unbox(value);

/** Execution-only scalar metadata. Public Cell.get()/Array.get() and host
 * adapters still expose ordinary JS values; getScalar() retains VB subtype and
 * whether an expression originated from Variant storage. Object identity is
 * never wrapped. The tag is immutable and is not a native COM VARIANT layout. */
export class VBScalar {
  constructor(value,type,variant=false) {
    this.type=String(type).toLowerCase();this.variant=!!variant;
    if(!Object.hasOwn(SCALAR_TYPES,this.type))throw new VBError('Invalid scalar type: '+type,13);
    if(this.type==='empty'||this.type==='null'){if(value!==(this.type==='empty'?undefined:null))throw new VBError('Invalid null/empty scalar',13);this.value=value;}
    else if(this.type==='error'){if(!(value instanceof VBErrorValue)&&value!==MISSING)throw new VBError('Invalid Error scalar',13);this.value=value;}
    else this.value=coerce(value,this.type);
    Object.freeze(this);
  }
  valueOf(){return this.type==='boolean'?(this.value?-1:0):this.value;}
  toString(){return this.type==='boolean'?(this.value?'True':'False'):String(this.value);}
}
export const SCALAR_TYPES=Object.freeze({empty:0,null:1,integer:2,long:3,single:4,double:5,currency:6,date:7,string:8,error:10,boolean:11,decimal:14,byte:17});
export const unbox=value=>value instanceof VBScalar?value.value:value;
export function scalarType(value){
  if(value instanceof VBScalar)return value.type;
  if(value===undefined)return 'empty';if(value===null)return 'null';
  if(value instanceof VBCurrency)return 'currency';if(value instanceof VBDecimal)return 'decimal';
  if(value instanceof Date)return 'date';if(value instanceof VBErrorValue||value===MISSING)return 'error';
  return typeof value==='number'?'double':typeof value==='string'?'string':typeof value==='boolean'?'boolean':null;
}
export function tagScalar(value,type=scalarType(value),variant=false){
  if(!type)return value;
  if(value instanceof VBScalar&&value.type===String(type).toLowerCase()&&value.variant===!!variant)return value;
  return new VBScalar(unbox(value),type,variant);
}
export function storageScalar(value,type='Variant',fixedLength=null){
  const key=String(type).toLowerCase(),actual=scalarType(value);
  if(key==='variant')return actual?tagScalar(cloneValue(unbox(value)),actual,true):cloneValue(value);
  const result=coerce(value,key,fixedLength);
  return Object.hasOwn(SCALAR_TYPES,key)?tagScalar(result,key,false):result;
}
export function readScalar(cell){if(cell instanceof LazyCell)return cell.get();return typeof cell.getScalar==='function'?cell.getScalar():Promise.resolve(cell.get()).then(value=>storageScalar(value,cell.type));}
export function literalScalar(node){
  if(node.kind==='currency')return tagScalar(new VBCurrency(node.value),'currency');
  if(node.kind==='date')return tagScalar(new Date(node.value),'date');
  const type=node.valueType||scalarType(node.value);return tagScalar(type==='null'?null:coerce(node.value,type),type,false);
}
export function signedLiteralScalar(node){
  if(node.op!=='-')return null;
  const n=node.expr;
  if(n.kind==='currency')return tagScalar(new VBCurrency('-'+n.value),'currency');
  if(n.kind!=='literal'||typeof n.value!=='number'||n.valueType==='boolean')return null;
  const value=-n.value;
  const type=n.numberSuffix?n.valueType:n.valueType==='long'&&value>=-32768&&value<=32767?'integer':n.valueType==='double'&&Number.isInteger(value)&&value===-2147483648?'long':n.valueType;
  return tagScalar(coerce(value,type),type);
}
const INTEGER_BOUNDS=Object.freeze({byte:[0,255],integer:[-32768,32767],long:[-2147483648,2147483647]});
function scalarResult(value,type,variant){
  if(value===null||value===undefined)return tagScalar(value,scalarType(value),true);
  if(type==='boolean')return tagScalar(value?-1:0,type,variant);
  if(INTEGER_BOUNDS[type]){
    while(value<INTEGER_BOUNDS[type][0]||value>INTEGER_BOUNDS[type][1]){
      if(!variant)throw new VBError('Overflow',6);
      type=type==='byte'?'integer':type==='integer'?'long':'double';
      if(type==='double')break;
    }
  }
  if(type==='single'&&!Number.isFinite(Math.fround(value))){if(!variant)throw new VBError('Overflow',6);type='double';}
  if(type==='double'&&!Number.isFinite(value))throw new VBError('Overflow',6);
  return tagScalar(coerce(value,type),type,variant);
}
function arithmeticType(a,b,op){
  let x=scalarType(a),y=scalarType(b);
  const normal=t=>t==='empty'||t==='boolean'?'integer':t==='string'||t==='date'?'double':t;
  if(op==='^')return 'double';
  if(['and','or','xor','eqv','imp'].includes(op)&&x==='boolean'&&y==='boolean')return 'boolean';
  if(['and','or','xor','eqv','imp','\\','mod'].includes(op)){
    if(!['byte','integer','boolean','empty'].includes(x)||!['byte','integer','boolean','empty'].includes(y))return 'long';
    return x==='byte'&&y==='byte'?'byte':'integer';
  }
  if((x==='decimal'||y==='decimal')&&['+','-','*','/'].includes(op))return 'decimal';
  if((op==='+'||op==='-')&&(x==='date'||y==='date')&&!(op==='-'&&x==='date'&&y==='date'))return 'date';
  if(op==='-'&&x==='date'&&y==='date')return 'double';
  if(x==='empty')x=y==='empty'?'integer':y;if(y==='empty')y=x;
  x=normal(x);y=normal(y);
  if(op==='/'){
    if(x==='decimal'||y==='decimal')return 'decimal';
    return (x==='single'||y==='single')&&[x,y].every(t=>['byte','integer','single'].includes(t))?'single':'double';
  }
  if((x==='single'&&y==='long')||(x==='long'&&y==='single'))return 'double';
  if(op==='*'&&[x,y].includes('currency')&&[x,y].some(t=>['single','double'].includes(t)))return 'double';
  const order=op==='*'?['byte','integer','long','single','currency','double','decimal']:['byte','integer','long','single','double','currency','decimal'];
  return order[Math.max(order.indexOf(x),order.indexOf(y))]||'double';
}
function compareScalar(a,b,compare){
  let x=unbox(a),y=unbox(b),tx=scalarType(a),ty=scalarType(b);
  if(tx==='empty'){x=ty==='string'?'':0;tx=ty==='string'?'string':'integer';}
  if(ty==='empty'){y=tx==='string'?'':0;ty=tx==='string'?'string':'integer';}
  const sx=tx==='string',sy=ty==='string';
  if(sx!==sy){
    if(a.variant&&b.variant)return sx?1:-1;
    if(sx&&!a.variant&&b.variant||sy&&!b.variant&&a.variant){x=vbString(a);y=vbString(b);tx=ty='string';}
    else {const target=sx?ty:tx;if(sx){x=coerce(a,target);tx=target;}else {y=coerce(b,target);ty=target;}}
  }
  if(tx==='string'&&ty==='string'){
    if(compare==='text'){x=x.toLocaleLowerCase();y=y.toLocaleLowerCase();}
    return x<y?-1:x>y?1:0;
  }
  if(tx==='decimal'||ty==='decimal')return decimal(tagScalar(x,tx)).compare(decimal(tagScalar(y,ty)));
  if(tx==='date'||ty==='date'){x=numeric(x);y=numeric(y);return x<y?-1:x>y?1:0;}
  if(tx==='currency'||ty==='currency'){x=new VBCurrency(x).raw;y=new VBCurrency(y).raw;}
  else {x=numeric(x);y=numeric(y);if((tx==='single'||ty==='single')&&tx!=='long'&&ty!=='long'){x=Math.fround(x);y=Math.fround(y);}}
  return x<y?-1:x>y?1:0;
}
/** Scalar expressions implement VB promotion without relying on JS coercion.
 * Unboxed low-level SDK operators retain their established raw-value API. */
export function scalarBinary(op,left,right,compare='binary'){
  const a=left instanceof VBScalar?left:tagScalar(left,scalarType(left),true),b=right instanceof VBScalar?right:tagScalar(right,scalarType(right),true);
  let x=unbox(a),y=unbox(b);const tx=scalarType(a),ty=scalarType(b),variant=!!(a?.variant||b?.variant);
  if(op==='is')return tagScalar(binary('is',x,y),'boolean');
  if(x instanceof VBErrorValue||y instanceof VBErrorValue){
    if(x instanceof VBErrorValue&&y instanceof VBErrorValue&&['=','<>','<','>','<=','>='].includes(op))return scalarBinary(op,tagScalar(x.number,'long',true),tagScalar(y.number,'long',true));
    throw new VBError('Type mismatch',13);
  }
  if(x===MISSING||y===MISSING)throw new VBError('Argument not optional',449);
  if(x===NOTHING||y===NOTHING)throw new VBError('Object variable not set',91);
  if(op==='&')return x===null&&y===null?tagScalar(null,'null',true):tagScalar((x==null?'':vbString(a))+(y==null?'':vbString(b)),'string',variant);
  if(x===null||y===null){
    if(!['and','or','imp'].includes(op))return tagScalar(null,'null',true);
    const other=x===null?b:a;
    if(unbox(other)===null)return tagScalar(null,'null',true);
    const n=coerce(other,'long'),t=scalarType(other),type=t==='boolean'?'boolean':t==='byte'?'byte':['integer','empty'].includes(t)?'integer':'long';
    if(op==='and'&&n===0)return tagScalar(0,type==='boolean'?'boolean':type,true);
    if(op==='or'&&n!==0)return tagScalar(n,type,true);
    if(op==='imp'){
      const result=x===null?n:type==='byte'?(~n)&255:~n;
      if(result!==0)return tagScalar(result,type,true);
    }
    return tagScalar(null,'null',true);
  }
  if(['=','<>','<','>','<=','>='].includes(op)){
    const c=compareScalar(a,b,compare),result={'=':c===0,'<>':c!==0,'<':c<0,'>':c>0,'<=':c<=0,'>=':c>=0}[op];
    return tagScalar(result?-1:0,'boolean',variant);
  }
  if(op==='like')return tagScalar(binary(op,vbString(a),vbString(b),compare),'boolean',variant);
  if(op==='+'){
    if(tx==='empty'&&ty!=='empty')return tagScalar(y,ty==='boolean'?'integer':ty,variant);
    if(ty==='empty'&&tx!=='empty')return tagScalar(x,tx==='boolean'?'integer':tx,variant);
    const sx=tx==='string',sy=ty==='string';
    if(sx&&sy||sx&&!a.variant&&b.variant||sy&&!b.variant&&a.variant)return tagScalar(vbString(a)+vbString(b),'string',variant);
    if(sx!==sy&&!a.variant&&!b.variant)throw new VBError('Type mismatch',13);
  }
  const type=arithmeticType(a,b,op);
  if(type==='decimal'&&['+','-','*','/'].includes(op)){
    const da=decimal(a),db=decimal(b);return tagScalar(op==='+'?da.add(db):op==='-'?da.subtract(db):op==='*'?da.multiply(db):da.divide(db),'decimal',variant);
  }
  if(type==='currency'&&['+','-','*'].includes(op)){
    const ca=new VBCurrency(x),cb=new VBCurrency(y);return tagScalar(new VBCurrency(op==='+'?ca.raw+cb.raw:op==='-'?ca.raw-cb.raw:roundRatio(ca.raw*cb.raw,10000n),true),'currency',variant);
  }
  if(['and','or','xor','eqv','imp','\\','mod'].includes(op)){x=coerce(x,'long');y=coerce(y,'long');}
  else{x=numeric(x);y=numeric(y);}
  if(op==='^'&&(x===0&&y<0||x<0&&!Number.isInteger(y)))throw new VBError('Invalid procedure call or argument',5);
  if(op==='/'&&x===0&&y===0&&!(ty==='empty'&&['single','double','string','date'].includes(tx)))throw new VBError('Overflow',6);
  let result=binary(op,x,y,compare);
  if(type==='byte'&&['eqv','imp'].includes(op))result&=255;
  if(type==='date'){
    try{return tagScalar(asDate(result),'date',variant);}catch(e){if(!variant)throw e;return scalarResult(result,'double',true);}
  }
  return scalarResult(result,type,variant);
}
export function scalarUnary(op,input){
  const value=input instanceof VBScalar?input:tagScalar(input,scalarType(input),true),raw=unbox(value),type=scalarType(value),variant=!!value?.variant;
  if(raw===null)return tagScalar(null,'null',true);
  if(op==='not'){
    const result=~coerce(raw,'long'),out=type==='boolean'?'boolean':type==='byte'?'byte':['integer','empty'].includes(type)?'integer':'long';
    return tagScalar(out==='byte'?result&255:result,out,variant);
  }
  if(type==='currency')return tagScalar(op==='-'?new VBCurrency(-raw.raw,true):raw,type,variant);
  if(type==='decimal')return tagScalar(op==='-'?raw.negate():raw,type,variant);
  const out=type==='byte'||type==='boolean'||type==='empty'?'integer':type==='string'?'double':type;
  if(out==='date')return tagScalar(asDate(op==='-'?-numeric(raw):numeric(raw)),'date',variant);
  return scalarResult(op==='-'?-numeric(raw):numeric(raw),out,variant);
}


/** Stable typed view: interface-only dispatch without copying object identity. */
export class VBInterfaceView {
  constructor(target,name){this.target=target;this.interfaceName=name;this.__vbInterface=true;this.__type=target.__type;Object.freeze(this);}
}
export const objectIdentity=value=>value?.__vbInterface?value.target:value;
export function objectSupports(value,name){const target=objectIdentity(value),type=lower(name).replace(/^vb\./,'');return !!target?.__vbInstance&&(lower(target.module.name)===type||Object.hasOwn(target.module.interfaceBindings||{},type));}
export function interfaceView(value,type){const target=objectIdentity(value),key=lower(type);if(lower(target.module.name)===key)return target;if(!Object.hasOwn(target.module.interfaceBindings||{},key))throw new VBError('Type mismatch: object does not implement '+type,13);target.interfaceViews ||= new Map();if(!target.interfaceViews.has(key))target.interfaceViews.set(key,new VBInterfaceView(target,key));return target.interfaceViews.get(key);}
export const isNothing = value => value === NOTHING;
export function truth(value){if(value instanceof VBScalar&&value.type==='string')return coerce(value,'boolean')!==0;value=unbox(value);if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);if(value===MISSING)throw new VBError('Argument not optional',449);if(value===NOTHING)throw new VBError('Object variable not set',91);return value != null && value !== undefined && (typeof value === 'string' ? value !== '' : Number(value) !== 0);}
export function numeric(value) { value=unbox(value);if(typeof value==='boolean')return value?-1:0; if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13); if(value===MISSING)throw new VBError('Argument not optional',449); if(isNothing(value))throw new VBError('Object variable or With block variable not set',91); if(value===undefined)return 0;if(value===null)throw new VBError('Invalid use of Null',94);if(value instanceof Date)return dateToSerial(value);if(typeof value==='string')value=normalizeNumericString(value);const n=Number(value);if(!Number.isFinite(n))throw new VBError(Number.isNaN(n)?'Type mismatch':'Overflow',Number.isNaN(n)?13:6);return n; }
export function decimal(value){
  const type=scalarType(value);value=unbox(value);
  if(type==='single')value=Number(value).toPrecision(7);
  if(typeof value==='string')value=normalizeNumericString(value);
  if(value instanceof VBDecimal)return value;
  if(value instanceof VBCurrency)return VBDecimal.fromParts(value.raw,4);
  if(value===MISSING)throw new VBError('Argument not optional',449);
  if(value===NOTHING)throw new VBError('Object variable not set',91);
  if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  return new VBDecimal(value instanceof Date?numeric(value):value);
}
/** Invariant numeric text. Locale-specific profiles can translate separators at
 * the host boundary; parsing never accepts JavaScript-only 0x/Infinity/NaN. */
export function normalizeNumericString(value,target='double') {
  const text=value.trim();if(text.length>4096)throw new VBError('Numeric input exceeds conversion limit',7);
  const radix=text.match(/^([+-]?)&([hHoO])([0-9a-fA-F]+)$/);
  if(radix){
    if(radix[2].toLowerCase()==='o'&&/[^0-7]/.test(radix[3]))throw new VBError('Type mismatch',13);
    let n=BigInt((radix[2].toLowerCase()==='h'?'0x':'0o')+radix[3]);
    if(n>0xffffffffn)throw new VBError('Overflow',6);
    n=BigInt.asIntN(target==='integer'?16:32,n);if(radix[1]==='-')n=-n;
    return n.toString();
  }
  const normalized=text.replace(/,/g,'').replace(/[dD]/g,'e');
  if(!text||!/^[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?$/.test(normalized)||/^[,+.-]*$/.test(text))throw new VBError('Type mismatch',13);
  return normalized;
}
export function scalarNumberString(value,type='double') {
  const n=numeric(value);if(n===0)return '0';
  if(type!=='single'&&type!=='double')return String(n);
  const precision=type==='single'?7:15,rounded=Number(n.toPrecision(precision));
  if(Math.abs(rounded)>=10**precision||Math.abs(rounded)<.0001){
    const [m,e]=rounded.toExponential(precision-1).split('e');
    return m.replace(/(\.\d*?)0+$/,'$1').replace(/\.$/,'')+'E'+(Number(e)<0?'-':'+')+String(Math.abs(Number(e))).padStart(2,'0');
  }
  return String(rounded);
}
export function vbString(value) {
  if(value instanceof VBScalar){
    if(value.type==='boolean')return value.value?'True':'False';
    if(value.type==='single'||value.type==='double')return scalarNumberString(value.value,value.type);
  }
  value=unbox(value);
  if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  if(value===MISSING)throw new VBError('Argument not optional',449);
  if(isNothing(value))throw new VBError('Object variable or With block variable not set',91);
  if(value===undefined)return '';if(value===null)throw new VBError('Invalid use of Null',94);
  if(value instanceof Date){
    const time=value.toLocaleTimeString('en-US'),base=value.getFullYear()===1899&&value.getMonth()===11&&value.getDate()===30;
    return base?time:value.toLocaleDateString('en-US')+(value.getHours()||value.getMinutes()||value.getSeconds()?' '+time:'');
  }
  if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();
  return typeof value==='boolean'?(value?'True':'False'):String(value);
}
/** Source Print/Write representations. Kept separate from debugger rendering. */
export function printScalar(value,csv=false){
 const raw=unbox(value),type=scalarType(value);
 if(type==='boolean')return csv?(raw?'#TRUE#':'#FALSE#'):(raw?'True':'False');
 if(raw===null)return csv?'#NULL#':'Null';
 if(raw===undefined)return '';
 if(raw instanceof VBErrorValue)return csv?'#ERROR '+raw.number+'#':raw.toString();
 if(raw instanceof Date&&csv){const pad=n=>String(n).padStart(2,'0');return '#'+String(raw.getFullYear()).padStart(4,'0')+'-'+pad(raw.getMonth()+1)+'-'+pad(raw.getDate())+' '+pad(raw.getHours())+':'+pad(raw.getMinutes())+':'+pad(raw.getSeconds())+'#';}
 const text=vbString(value);return csv&&type==='string'? '"'+text.replace(/"/g,'""')+'"':text;
}
/** Round an exact rational to the nearest integer, ties to even. */
export function roundRatio(numerator, denominator) {
  if (denominator === 0n) throw new VBError('Division by zero',11);
  const negative=(numerator<0n)!==(denominator<0n);
  let a=numerator<0n?-numerator:numerator, b=denominator<0n?-denominator:denominator;
  let q=a/b, remainder=a%b;
  if(remainder*2n>b || (remainder*2n===b && q%2n!==0n))q++;
  return negative?-q:q;
}
/** Parse invariant decimal Currency without passing through IEEE-754 first. */
function currencyRaw(value) {
  value=unbox(value);
  if(value instanceof VBCurrency)return value.raw;
  if(value===undefined)return 0n;
  if(value===null)throw new VBError('Invalid use of Null',94);
  if(isNothing(value))throw new VBError('Object variable not set',91);
  if(value instanceof Date)value=numeric(value);
  if(typeof value==='boolean')value=value?-1:0;
  const text=typeof value==='string'?normalizeNumericString(value):String(value).trim();
  const m=text.match(/^([+-]?)(\d+(?:\.\d*)?|\.\d+)(?:[eEdD]([+-]?\d+))?$/);
  if(!m)throw new VBError('Type mismatch',13);
  const exponent=Number(m[3]||0), parts=m[2].split('.'), digits=(parts.join('').replace(/^0+/,'')||'0');
  if(digits.length>1024 || Math.abs(exponent)>1024)throw new VBError('Overflow',6);
  let n=BigInt(digits);if(m[1]==='-')n=-n;
  const power=4+exponent-(parts[1]?.length||0);
  return power>=0?n*10n**BigInt(power):roundRatio(n,10n**BigInt(-power));
}
export class VBCurrency {
  constructor(value=0,raw=false) {
    this.raw=raw?BigInt(value):currencyRaw(value);
    if(this.raw<-(1n<<63n)||this.raw>(1n<<63n)-1n)throw new VBError('Overflow',6);
    Object.freeze(this);
  }
  valueOf(){return Number(this.raw)/10000;}
  toString(){const n=this.raw<0n?-this.raw:this.raw;const fraction=String(n%10000n).padStart(4,'0').replace(/0+$/,'');return (this.raw<0n?'-':'')+String(n/10000n)+(fraction?'.'+fraction:'');}
  toJSON(){return {__currency:this.raw.toString()};}
  round(digits=0){digits=bankersRound(numeric(digits));if(digits<0||digits>28)throw new VBError('Invalid procedure call',5);if(digits>=4)return this;const scale=10n**BigInt(4-digits);return new VBCurrency(roundRatio(this.raw,scale)*scale,true);}
}
/** Value-copy semantics for records, arrays and dates. Native object references stay shared. */
export function makeRecord(name,fields){
  const result={__type:name};Object.defineProperty(result,'__fields',{value:fields});
  for(const [key,cell]of fields){if(['__type','__fields','__proto__','constructor','prototype'].includes(key))throw new VBError('Reserved record member: '+key,1002);Object.defineProperty(result,key,{enumerable:true,get:()=>cell.get(),set:value=>cell.set(value)});}return result;
}
export function cloneValue(value,seen=new Map(),depth=0){
  if(depth>64)throw new VBError('Value nesting exceeds runtime limit',7);
  if(value instanceof Date)return new Date(value);
  if(!value||typeof value!=='object'||value===NOTHING||value instanceof VBCurrency)return value;
  if(seen.has(value))return seen.get(value);
  if(value instanceof VBArray){const copy=Object.create(VBArray.prototype);seen.set(value,copy);copy.type=value.type;copy.bounds=value.bounds.map(b=>[...b]);copy.dynamic=value.dynamic;copy.elementFactory=value.elementFactory;copy.fixedLength=value.fixedLength;copy.scalarData=value.scalarData?.slice();copy.data=value.data.map(v=>cloneValue(v,seen,depth+1));return copy;}
  if(value.__fields instanceof Map){const fields=new Map(),copy=makeRecord(value.__type,fields);seen.set(value,copy);for(const [name,cell] of value.__fields){const field=Object.create(Cell.prototype);Object.assign(field,{type:cell.type,constant:false,fixedLength:cell.fixedLength,isArray:cell.isArray,elementType:cell.elementType,_value:cloneValue(cell.get(),seen,depth+1),_scalar:cell.getScalar?.()});fields.set(name,field);Object.defineProperty(copy,name,{enumerable:true,get:()=>field.get(),set:v=>field.set(v)});}return copy;}
  return value;
}
function matchingRecord(target,source){
  if(lower(target.__type)!==lower(source.__type)||target.__fields.size!==source.__fields.size)return false;
  for(const [key,cell]of target.__fields){const next=source.__fields.get(key);if(!next||lower(cell.type)!==lower(next.type)||cell.fixedLength!==next.fixedLength||!!cell.isArray!==!!next.isArray)return false;if(cell.get()?.__fields&&(!next.get()?.__fields||!matchingRecord(cell.get(),next.get())))return false;}return true;
}
function commitRecord(target,source){for(const [key,cell]of target.__fields){const next=source.__fields.get(key).get();if(cell.get()?.__fields&&next?.__fields)commitRecord(cell.get(),next);else if(cell.get() instanceof VBArray&&next instanceof VBArray){const array=cell.get();array.bounds=next.bounds;array.data=next.data;array.elementFactory=next.elementFactory;array.fixedLength=next.fixedLength;array.dynamic=next.dynamic;array.scalarData=next.scalarData;}else {cell._value=next;cell._scalar=source.__fields.get(key).getScalar();}}return target;}
export function defaultValue(type='Variant') { switch(lower(type)){case 'string':return '';case 'boolean':case 'byte':case 'integer':case 'long':case 'single':case 'double':return 0;case 'currency':return new VBCurrency();case 'date':return new Date(1899,11,30);case 'object':return NOTHING;default:return undefined;} }
export function coerce(value,type='Variant',fixedLength=null) {
  const original=value;value=unbox(value);type=lower(type);
  if(type==='variant')return cloneValue(value);
  if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  if(value===MISSING)throw new VBError('Argument not optional',449);
  if(type==='object'){if(value===NOTHING || value&&typeof value==='object'&&!(value instanceof Date)&&!(value instanceof VBCurrency)&&!(value instanceof VBDecimal)&&!(value instanceof VBArray)&&!value.__fields)return value;throw new VBError(value===null?'Invalid use of Null':'Object required',value===null?94:424);}
  if(type==='string'){const s=vbString(original);return fixedLength==null?s:s.padEnd(fixedLength,' ').slice(0,fixedLength);}
  if(type==='date')return asDate(scalarType(original)==='boolean'||value instanceof VBCurrency||value instanceof VBDecimal?numeric(value):value);
  if(type==='decimal')return decimal(original);
  if(type==='currency')return value instanceof VBCurrency?value:new VBCurrency(value);
  if(type==='boolean'){if(typeof value==='string'){if(value==='#TRUE#'||/^(true)$/i.test(value))return -1;if(value==='#FALSE#'||/^(false)$/i.test(value))return 0;}return numeric(value)!==0?-1:0;}
  if(['byte','integer','long'].includes(type)){if(type==='byte'&&scalarType(original)==='boolean')return value?255:0;if(typeof value==='string')value=new VBDecimal(normalizeNumericString(value,type));const n=value instanceof VBDecimal?Number(value.roundedInteger()):bankersRound(numeric(value)),bounds={byte:[0,255],integer:[-32768,32767],long:[-2147483648,2147483647]}[type];if(n<bounds[0]||n>bounds[1])throw new VBError('Overflow',6);return n;}
  if(type==='single'){const n=Math.fround(numeric(value));if(!Number.isFinite(n))throw new VBError('Overflow',6);return n;}
  if(type==='double')return numeric(value);
  if(value?.__fields){if(lower(value.__type)!==type)throw new VBError('Type mismatch',13);return cloneValue(value);}
  if(value?.__vbInstance||value?.__vbInterface)return interfaceView(value,type);
  return value;
}
export class Cell {
  constructor(type='Variant',value=defaultValue(type),constant=false,fixedLength=null){this.type=type;this.constant=constant;this.fixedLength=fixedLength;this._scalar=storageScalar(value,type,fixedLength);this._value=unbox(this._scalar);}
  get(){return this._value;}
  getScalar(){if(!scalarType(this._value))return this._value;return this._scalar instanceof VBScalar&&Object.is(this._scalar.value,this._value)?this._scalar:storageScalar(this._value,this.type,this.fixedLength);}
  set(value){if(this.constant)throw new VBError('Assignment to constant not permitted',500);const tagged=storageScalar(value,this.type,this.fixedLength),next=unbox(tagged);if(this.isArray){if(!(next instanceof VBArray)||lower(next.type)!==lower(this.elementType))throw new VBError('Array type mismatch',13);}if(this._value?.__fields){if(!next?.__fields||!matchingRecord(this._value,next))throw new VBError('User-defined type mismatch',13);return commitRecord(this._value,next);}this._value=next;this._scalar=tagged;return this._value;}
}
/** Lazily creates As New variables; assigning Nothing resets the factory. */
export class LazyCell extends Cell {
  constructor(type,factory){super(type,NOTHING);this.factory=factory;this.pending=null;}
  async get(){if(this._value!==NOTHING)return this._value;if(!this.pending){this.pending=Promise.resolve().then(this.factory).then(value=>{this._value=value;return value;}).finally(()=>{this.pending=null;});}return this.pending;}
  set(value){if(this.pending)throw new VBError('Cannot replace an object during initialization',5);return super.set(value);}
  peek(){return this._value;}
}
export class Ref {
  constructor(get,set,type='Variant',fixedLength=null,getScalar=null){this.get=get;this.set=set;this.type=type;this.fixedLength=fixedLength;if(getScalar)this.getScalar=getScalar;}
}
export class VBArray {
  constructor(bounds=[],type='Variant',elementFactory=null,fixedLength=null){this.elementFactory=elementFactory;this.fixedLength=fixedLength;this.type=type;if(bounds.length>60)throw new VBError('An array cannot exceed 60 dimensions',9);this.bounds=bounds.map(([l,u])=>{const b=[bankersRound(numeric(l)),bankersRound(numeric(u))];if(b.some(n=>n< -2147483648||n>2147483647))throw new VBError('Array bound overflow',6);return b;});this.dynamic=!bounds.length;this.allocate();}
  allocate(){let n=this.bounds.length?1:0;for(const [l,u]of this.bounds){if(u<l)throw new VBError('Subscript out of range',9);n*=u-l+1;if(n>1000000)throw new VBError('Array allocation exceeds browser runtime limit (1,000,000 elements)',7);}this.data=Array.from({length:n},()=>this.elementFactory?this.elementFactory():coerce(defaultValue(this.type),this.type,this.fixedLength));}
  offset(indices){if(indices.length!==this.bounds.length||!indices.length)throw new VBError('Subscript out of range',9);let offset=0;for(let d=0;d<indices.length;d++){const [l,u]=this.bounds[d],i=bankersRound(numeric(indices[d]));if(i<l||i>u)throw new VBError('Subscript out of range',9);offset=offset*(u-l+1)+i-l;}return offset;}
  get(...indices){return this.data[this.offset(indices)];}
  getScalar(...indices){const i=this.offset(indices),tag=this.scalarData?.[i];if(!scalarType(this.data[i]))return this.data[i];return tag instanceof VBScalar&&Object.is(tag.value,this.data[i])?tag:storageScalar(this.data[i],this.type,this.fixedLength);}
  set(indices,value){const offset=this.offset(indices),tagged=storageScalar(value,this.type,this.fixedLength),next=unbox(tagged);if(this.data[offset]?.__fields&&next?.__fields){if(!matchingRecord(this.data[offset],next))throw new VBError('User-defined type mismatch',13);commitRecord(this.data[offset],next);}else {this.data[offset]=next;(this.scalarData||=[])[offset]=tagged;}return unbox(value);}
  redim(bounds,preserve=false){
    const normalized=bounds.map(([l,u])=>[bankersRound(numeric(l)),bankersRound(numeric(u))]),old=this.bounds;
    if(preserve&&old.length&&(old.length!==normalized.length||old.some(([l,u],i)=>l!==normalized[i][0]||(i<old.length-1&&u!==normalized[i][1]))))throw new VBError('ReDim Preserve can change only the upper bound of the last dimension',9);
    if(!this.dynamic)throw new VBError('This array is fixed or temporarily locked',10);
    const next=new VBArray(normalized,this.type,this.elementFactory,this.fixedLength);next.dynamic=true;
    if(preserve&&old.length){for(const indices of this.indices()){if(indices.every((n,d)=>n<=normalized[d][1]))next.set(indices,this.getScalar(...indices));}}
    this.bounds=next.bounds;this.data=next.data;this.scalarData=next.scalarData;return this;
  }
  erase(){this.scalarData=[];if(this.dynamic){this.bounds=[];this.data=[];}else this.data=this.data.map(()=>this.elementFactory?this.elementFactory():coerce(defaultValue(this.type),this.type,this.fixedLength));}
  *indices(){if(!this.bounds.length||!this.data.length)return;const at=this.bounds.map(([l])=>l);for(;;){yield [...at];let d=0;for(;d<at.length;d++){if(++at[d]<=this.bounds[d][1])break;at[d]=this.bounds[d][0];}if(d===at.length)return;}}
  *[Symbol.iterator](){for(const at of this.indices())yield this.get(...at);}
  *scalarIterator(){for(const at of this.indices())yield this.getScalar(...at);}
  static from(values,base=0){const a=Object.create(VBArray.prototype);a.type='Variant';a.bounds=[[base,base+values.length-1]];a.dynamic=true;a.scalarData=values.map(v=>storageScalar(v,'Variant'));a.data=a.scalarData.map(unbox);return a;}
}
export class VBCollection {
  constructor(){this.items=[];this.keys=new Map();}
  get Count(){return this.items.length;}
  Add(item,key,before,after){key=unbox(key);before=unbox(before);after=unbox(after);if(key!==undefined&&key!==''&&this.keys.has(String(key).toLowerCase()))throw new VBError('This key is already associated with an element of this collection',457);let index=this.items.length;if(before!==undefined)index=this.index(before);if(after!==undefined)index=this.index(after)+1;const scalar=storageScalar(item,'Variant');const entry={item:unbox(scalar),scalar,key:key===undefined?null:String(key).toLowerCase()};this.items.splice(index,0,entry);if(entry.key!==null)this.keys.set(entry.key,entry);return item;}
  index(key){key=unbox(key);if(typeof key==='number'){if(key<1||key>this.items.length)throw new VBError('Subscript out of range',9);return Math.trunc(key)-1;}const entry=this.keys.get(String(key).toLowerCase());if(!entry)throw new VBError('Invalid procedure call or argument',5);return this.items.indexOf(entry);}
  Item(key){return this.items[this.index(key)].item;}
  itemScalar(key){const entry=this.items[this.index(key)];return entry.scalar??storageScalar(entry.item,'Variant');}
  *scalarIterator(){for(const entry of this.items)yield entry.scalar??storageScalar(entry.item,'Variant');}
  Remove(key){const i=this.index(key),entry=this.items[i];this.items.splice(i,1);if(entry.key!==null)this.keys.delete(entry.key);}
  [Symbol.iterator](){return this.items.map(x=>x.item)[Symbol.iterator]();}
}
export class VBDictionary {
  constructor(){this.map=new Map();this.CompareMode=0;}
  normalize(k){k=unbox(k);return this.CompareMode===1&&typeof k==='string'?k.toLowerCase():k;}
  get Count(){return this.map.size;}
  Add(k,v){const key=this.normalize(k);if(this.map.has(key))throw new VBError('Key already exists',457);const scalar=storageScalar(v,'Variant');this.map.set(key,{key:unbox(k),keyScalar:storageScalar(k,'Variant'),value:unbox(scalar),scalar});}
  Item(k){return this.map.get(this.normalize(k))?.value;}
  itemScalar(k){const entry=this.map.get(this.normalize(k));return entry?.scalar??storageScalar(entry?.value,'Variant');}
  setItem(k,v){const scalar=storageScalar(v,'Variant'),key=this.normalize(k),entry=this.map.get(key);if(entry){entry.value=unbox(scalar);entry.scalar=scalar;}else this.map.set(key,{key:unbox(k),keyScalar:storageScalar(k,'Variant'),value:unbox(scalar),scalar});}
  Exists(k){return this.map.has(this.normalize(k))?-1:0;}
  Remove(k){if(!this.map.delete(this.normalize(k)))throw new VBError('Key not found',5);}
  RemoveAll(){this.map.clear();}
  Keys(){return VBArray.from([...this.map.values()].map(v=>v.keyScalar??v.key));}
  Items(){return VBArray.from([...this.map.values()].map(v=>v.scalar??v.value));}
  *scalarIterator(){for(const entry of this.map.values())yield entry.keyScalar??storageScalar(entry.key,'Variant');}
  [Symbol.iterator](){return this.Keys()[Symbol.iterator]();}
}
export function unary(op,value){if(value instanceof VBScalar)return scalarUnary(op,value);if(value===null)return null;if(value instanceof VBDecimal){if(op==='-')return value.negate();if(op==='+')return value;}if(value instanceof VBCurrency){if(op==='-')return new VBCurrency(-value.raw,true);if(op==='+')return value;}if(op==='not')return ~bankersRound(numeric(value));if(op==='-')return -numeric(value);return numeric(value);}
export function binary(op,a,b,compare='binary') {
  if(a instanceof VBScalar||b instanceof VBScalar)return scalarBinary(op,a,b,compare);
  if(a instanceof VBErrorValue||b instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  if(op==='is'){const object=v=>v===NOTHING||v&&typeof v==='object'&&!(v instanceof Date)&&!(v instanceof VBCurrency)&&!(v instanceof VBDecimal)&&!(v instanceof VBArray)&&!v.__fields;if(!object(a)||!object(b))throw new VBError('Object required',424);return objectIdentity(a)===objectIdentity(b)?-1:0;}
  if(isNothing(a)||isNothing(b))throw new VBError('Object variable not set',91);
  if(op==='&')return a===null&&b===null?null:(a==null?'':vbString(a))+(b==null?'':vbString(b));
  if(a===null||b===null){if(op==='and'&&(a===0||b===0))return 0;if(op==='or'&&(a===-1||b===-1))return -1;if(op==='imp'&&(a===0||b===-1))return -1;return null;}
  if(['=','<>','<','>','<=','>=','like'].includes(op)) {
    if(a===undefined)a=typeof b==='string'?'':0;if(b===undefined)b=typeof a==='string'?'':0;
    if(op!=='like'&&(a instanceof VBDecimal||b instanceof VBDecimal)){const c=decimal(a).compare(decimal(b));return ({'=':c===0,'<>':c!==0,'<':c<0,'>':c>0,'<=':c<=0,'>=':c>=0}[op])?-1:0;}
    if(a instanceof VBCurrency&&b instanceof VBCurrency){a=a.raw;b=b.raw;}else{if(a instanceof VBCurrency)a=numeric(a);if(b instanceof VBCurrency)b=numeric(b);}
    if(a instanceof Date)a=numeric(a);if(b instanceof Date)b=numeric(b);
    if(compare==='text'&&typeof a==='string'&&typeof b==='string'){a=a.toLocaleLowerCase();b=b.toLocaleLowerCase();}
    if(op==='like'){let pattern='^';for(let i=0;i<String(b).length;i++){const c=String(b)[i];if(c==='*')pattern+='.*';else if(c==='?')pattern+='.';else if(c==='#')pattern+='[0-9]';else if(c==='['){const end=String(b).indexOf(']',i+1);if(end<0)throw new VBError('Invalid pattern string',93);let part=String(b).slice(i+1,end);if(part[0]==='!')part='^'+part.slice(1);pattern+='['+part+']';i=end;}else pattern+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');}return new RegExp(pattern+'$',compare==='text'?'i':'').test(String(a))?-1:0;}
    return ({'=':()=>a==b,'<>':()=>a!=b,'<':()=>a<b,'>':()=>a>b,'<=':()=>a<=b,'>=':()=>a>=b}[op]())?-1:0;
  }
  if(op==='+'&&typeof a==='string'&&typeof b==='string')return a+b;
  if((a instanceof VBDecimal||b instanceof VBDecimal)&&['+','-','*','/'].includes(op)){const x=decimal(a),y=decimal(b);return op==='+'?x.add(y):op==='-'?x.subtract(y):op==='*'?x.multiply(y):x.divide(y);}
  if(a instanceof VBCurrency&&b instanceof VBCurrency){if(op==='+')return new VBCurrency(a.raw+b.raw,true);if(op==='-')return new VBCurrency(a.raw-b.raw,true);if(op==='*')return new VBCurrency(roundRatio(a.raw*b.raw,10000n),true);}
  const x=numeric(a),y=numeric(b);let n;
  switch(op){case '+':n=x+y;break;case '-':n=x-y;break;case '*':n=x*y;break;case '/':if(y===0)throw new VBError('Division by zero',11);n=x/y;break;case '\\':if(bankersRound(y)===0)throw new VBError('Division by zero',11);n=Math.trunc(bankersRound(x)/bankersRound(y));break;case 'mod':if(bankersRound(y)===0)throw new VBError('Division by zero',11);n=bankersRound(x)%bankersRound(y);break;case '^':n=x**y;break;case 'and':return bankersRound(x)&bankersRound(y);case 'or':return bankersRound(x)|bankersRound(y);case 'xor':return bankersRound(x)^bankersRound(y);case 'eqv':return ~(bankersRound(x)^bankersRound(y));case 'imp':return (~bankersRound(x))|bankersRound(y);default:throw new VBError(`Unknown operator ${op}`,1002);}
  if(!Number.isFinite(n))throw new VBError('Overflow',6);return n;
}
export function describe(value){if(value instanceof VBScalar)return value.type==='boolean'?value.toString():describe(value.value);if(value instanceof VBErrorValue)return value.toString();if(value===MISSING)return '<Missing>'; if(value===undefined)return 'Empty';if(value===null)return 'Null';if(value===NOTHING)return 'Nothing';if(value instanceof VBArray)return `Array(${value.bounds.map(([l,u])=>`${l} To ${u}`).join(', ')})`;if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();if(typeof value==='string')return '"'+value+'"';if(value instanceof Date)return '#'+value.toLocaleString()+'#';if(typeof value==='object')return value.__type||value.constructor?.name||'Object';return String(value);}
