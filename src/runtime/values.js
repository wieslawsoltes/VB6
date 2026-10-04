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
export const explicitErrorValue=value=>value instanceof VBErrorValue?value.number:value;

/** Stable typed view: interface-only dispatch without copying object identity. */
export class VBInterfaceView {
  constructor(target,name){this.target=target;this.interfaceName=name;this.__vbInterface=true;this.__type=target.__type;Object.freeze(this);}
}
export const objectIdentity=value=>value?.__vbInterface?value.target:value;
export function objectSupports(value,name){const target=objectIdentity(value),type=lower(name).replace(/^vb\./,'');return !!target?.__vbInstance&&(lower(target.module.name)===type||Object.hasOwn(target.module.interfaceBindings||{},type));}
export function interfaceView(value,type){const target=objectIdentity(value),key=lower(type);if(lower(target.module.name)===key)return target;if(!Object.hasOwn(target.module.interfaceBindings||{},key))throw new VBError('Type mismatch: object does not implement '+type,13);target.interfaceViews ||= new Map();if(!target.interfaceViews.has(key))target.interfaceViews.set(key,new VBInterfaceView(target,key));return target.interfaceViews.get(key);}
export const isNothing = value => value === NOTHING;
export function truth(value){if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);if(value===MISSING)throw new VBError('Argument not optional',449);if(value===NOTHING)throw new VBError('Object variable not set',91);return value != null && value !== undefined && (typeof value === 'string' ? value !== '' : Number(value) !== 0);}
export function numeric(value) { if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13); if(value===MISSING)throw new VBError('Argument not optional',449); if(isNothing(value))throw new VBError('Object variable or With block variable not set',91); if(value===undefined)return 0;if(value===null)throw new VBError('Invalid use of Null',94);if(value instanceof Date)return dateToSerial(value);const n=Number(value);if(!Number.isFinite(n))throw new VBError('Type mismatch',13);return n; }
export function decimal(value){
  if(value instanceof VBDecimal)return value;
  if(value instanceof VBCurrency)return VBDecimal.fromParts(value.raw,4);
  if(value===MISSING)throw new VBError('Argument not optional',449);
  if(value===NOTHING)throw new VBError('Object variable not set',91);
  if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  return new VBDecimal(value instanceof Date?numeric(value):value);
}
export function vbString(value) { if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13); if(value===MISSING)throw new VBError('Argument not optional',449); if(isNothing(value))throw new VBError('Object variable or With block variable not set',91); if(value===undefined)return '';if(value===null)throw new VBError('Invalid use of Null',94);if(value instanceof Date)return value.toLocaleString();if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();return String(value); }
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
  if(value instanceof VBCurrency)return value.raw;
  if(value===undefined)return 0n;
  if(value===null)throw new VBError('Invalid use of Null',94);
  if(isNothing(value))throw new VBError('Object variable not set',91);
  if(value instanceof Date)value=numeric(value);
  if(typeof value==='boolean')value=value?-1:0;
  const text=String(value).trim();
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
  if(value instanceof VBArray){const copy=Object.create(VBArray.prototype);seen.set(value,copy);copy.type=value.type;copy.bounds=value.bounds.map(b=>[...b]);copy.dynamic=value.dynamic;copy.elementFactory=value.elementFactory;copy.fixedLength=value.fixedLength;copy.data=value.data.map(v=>cloneValue(v,seen,depth+1));return copy;}
  if(value.__fields instanceof Map){const fields=new Map(),copy=makeRecord(value.__type,fields);seen.set(value,copy);for(const [name,cell] of value.__fields){const field=Object.create(Cell.prototype);Object.assign(field,{type:cell.type,constant:false,fixedLength:cell.fixedLength,isArray:cell.isArray,elementType:cell.elementType,_value:cloneValue(cell.get(),seen,depth+1)});fields.set(name,field);Object.defineProperty(copy,name,{enumerable:true,get:()=>field.get(),set:v=>field.set(v)});}return copy;}
  return value;
}
function matchingRecord(target,source){
  if(lower(target.__type)!==lower(source.__type)||target.__fields.size!==source.__fields.size)return false;
  for(const [key,cell]of target.__fields){const next=source.__fields.get(key);if(!next||lower(cell.type)!==lower(next.type)||cell.fixedLength!==next.fixedLength||!!cell.isArray!==!!next.isArray)return false;if(cell.get()?.__fields&&(!next.get()?.__fields||!matchingRecord(cell.get(),next.get())))return false;}return true;
}
function commitRecord(target,source){for(const [key,cell]of target.__fields){const next=source.__fields.get(key).get();if(cell.get()?.__fields&&next?.__fields)commitRecord(cell.get(),next);else if(cell.get() instanceof VBArray&&next instanceof VBArray){const array=cell.get();array.bounds=next.bounds;array.data=next.data;array.elementFactory=next.elementFactory;array.fixedLength=next.fixedLength;array.dynamic=next.dynamic;}else cell._value=next;}return target;}
export function defaultValue(type='Variant') { switch(lower(type)){case 'string':return '';case 'boolean':case 'byte':case 'integer':case 'long':case 'single':case 'double':return 0;case 'currency':return new VBCurrency();case 'date':return new Date(1899,11,30);case 'object':return NOTHING;default:return undefined;} }
export function coerce(value,type='Variant',fixedLength=null) {
  type=lower(type);
  if(type==='variant')return cloneValue(value);
  if(value instanceof VBErrorValue)throw new VBError('Type mismatch',13);
  if(value===MISSING)throw new VBError('Argument not optional',449);
  if(type==='object'){if(value===NOTHING || value&&typeof value==='object'&&!(value instanceof Date)&&!(value instanceof VBCurrency)&&!(value instanceof VBDecimal)&&!(value instanceof VBArray)&&!value.__fields)return value;throw new VBError(value===null?'Invalid use of Null':'Object required',value===null?94:424);}
  if(type==='string'){const s=vbString(value);return fixedLength==null?s:s.padEnd(fixedLength,' ').slice(0,fixedLength);}
  if(type==='date')return asDate(value);
  if(type==='decimal')return decimal(value);
  if(type==='currency')return value instanceof VBCurrency?value:new VBCurrency(value);
  if(type==='boolean'){if(typeof value==='string'&&/^(true|false)$/i.test(value))return /^true$/i.test(value)?-1:0;return numeric(value)!==0?-1:0;}
  if(['byte','integer','long'].includes(type)){const n=value instanceof VBDecimal?Number(value.roundedInteger()):bankersRound(numeric(value)),bounds={byte:[0,255],integer:[-32768,32767],long:[-2147483648,2147483647]}[type];if(n<bounds[0]||n>bounds[1])throw new VBError('Overflow',6);return n;}
  if(type==='single'){const n=Math.fround(numeric(value));if(!Number.isFinite(n))throw new VBError('Overflow',6);return n;}
  if(type==='double')return numeric(value);
  if(value?.__fields){if(lower(value.__type)!==type)throw new VBError('Type mismatch',13);return cloneValue(value);}
  if(value?.__vbInstance||value?.__vbInterface)return interfaceView(value,type);
  return value;
}
export class Cell {
  constructor(type='Variant',value=defaultValue(type),constant=false,fixedLength=null){this.type=type;this.constant=constant;this.fixedLength=fixedLength;this._value=coerce(value,type,fixedLength);}
  get(){return this._value;}
  set(value){if(this.constant)throw new VBError('Assignment to constant not permitted',500);const next=coerce(value,this.type,this.fixedLength);if(this.isArray){if(!(next instanceof VBArray)||lower(next.type)!==lower(this.elementType))throw new VBError('Array type mismatch',13);}if(this._value?.__fields){if(!next?.__fields||!matchingRecord(this._value,next))throw new VBError('User-defined type mismatch',13);return commitRecord(this._value,next);}this._value=next;return this._value;}
}
/** Lazily creates As New variables; assigning Nothing resets the factory. */
export class LazyCell extends Cell {
  constructor(type,factory){super(type,NOTHING);this.factory=factory;this.pending=null;}
  async get(){if(this._value!==NOTHING)return this._value;if(!this.pending){this.pending=Promise.resolve().then(this.factory).then(value=>{this._value=value;return value;}).finally(()=>{this.pending=null;});}return this.pending;}
  set(value){if(this.pending)throw new VBError('Cannot replace an object during initialization',5);return super.set(value);}
  peek(){return this._value;}
}
export class Ref {
  constructor(get,set,type='Variant',fixedLength=null){this.get=get;this.set=set;this.type=type;this.fixedLength=fixedLength;}
}
export class VBArray {
  constructor(bounds=[],type='Variant',elementFactory=null,fixedLength=null){this.elementFactory=elementFactory;this.fixedLength=fixedLength;this.type=type;if(bounds.length>60)throw new VBError('An array cannot exceed 60 dimensions',9);this.bounds=bounds.map(([l,u])=>{const b=[bankersRound(numeric(l)),bankersRound(numeric(u))];if(b.some(n=>n< -2147483648||n>2147483647))throw new VBError('Array bound overflow',6);return b;});this.dynamic=!bounds.length;this.allocate();}
  allocate(){let n=this.bounds.length?1:0;for(const [l,u]of this.bounds){if(u<l)throw new VBError('Subscript out of range',9);n*=u-l+1;if(n>1000000)throw new VBError('Array allocation exceeds browser runtime limit (1,000,000 elements)',7);}this.data=Array.from({length:n},()=>this.elementFactory?this.elementFactory():coerce(defaultValue(this.type),this.type,this.fixedLength));}
  offset(indices){if(indices.length!==this.bounds.length||!indices.length)throw new VBError('Subscript out of range',9);let offset=0;for(let d=0;d<indices.length;d++){const [l,u]=this.bounds[d],i=bankersRound(numeric(indices[d]));if(i<l||i>u)throw new VBError('Subscript out of range',9);offset=offset*(u-l+1)+i-l;}return offset;}
  get(...indices){return this.data[this.offset(indices)];}
  set(indices,value){const offset=this.offset(indices),next=coerce(value,this.type,this.fixedLength);if(this.data[offset]?.__fields&&next?.__fields){if(!matchingRecord(this.data[offset],next))throw new VBError('User-defined type mismatch',13);commitRecord(this.data[offset],next);}else this.data[offset]=next;return value;}
  redim(bounds,preserve=false){
    const normalized=bounds.map(([l,u])=>[bankersRound(numeric(l)),bankersRound(numeric(u))]),old=this.bounds;
    if(preserve&&old.length&&(old.length!==normalized.length||old.some(([l,u],i)=>l!==normalized[i][0]||(i<old.length-1&&u!==normalized[i][1]))))throw new VBError('ReDim Preserve can change only the upper bound of the last dimension',9);
    if(!this.dynamic)throw new VBError('This array is fixed or temporarily locked',10);
    const next=new VBArray(normalized,this.type,this.elementFactory,this.fixedLength);next.dynamic=true;
    if(preserve&&old.length){for(const indices of this.indices()){if(indices.every((n,d)=>n<=normalized[d][1]))next.set(indices,this.get(...indices));}}
    this.bounds=next.bounds;this.data=next.data;return this;
  }
  erase(){if(this.dynamic){this.bounds=[];this.data=[];}else this.data=this.data.map(()=>this.elementFactory?this.elementFactory():coerce(defaultValue(this.type),this.type,this.fixedLength));}
  *indices(){if(!this.bounds.length||!this.data.length)return;const at=this.bounds.map(([l])=>l);for(;;){yield [...at];let d=0;for(;d<at.length;d++){if(++at[d]<=this.bounds[d][1])break;at[d]=this.bounds[d][0];}if(d===at.length)return;}}
  *[Symbol.iterator](){for(const at of this.indices())yield this.get(...at);}
  static from(values,base=0){const a=Object.create(VBArray.prototype);a.type='Variant';a.bounds=[[base,base+values.length-1]];a.dynamic=true;a.data=[...values];return a;}
}
export class VBCollection {
  constructor(){this.items=[];this.keys=new Map();}
  get Count(){return this.items.length;}
  Add(item,key,before,after){if(key!==undefined&&key!==''&&this.keys.has(String(key).toLowerCase()))throw new VBError('This key is already associated with an element of this collection',457);let index=this.items.length;if(before!==undefined)index=this.index(before);if(after!==undefined)index=this.index(after)+1;const entry={item,key:key===undefined?null:String(key).toLowerCase()};this.items.splice(index,0,entry);if(entry.key!==null)this.keys.set(entry.key,entry);return item;}
  index(key){if(typeof key==='number'){if(key<1||key>this.items.length)throw new VBError('Subscript out of range',9);return Math.trunc(key)-1;}const entry=this.keys.get(String(key).toLowerCase());if(!entry)throw new VBError('Invalid procedure call or argument',5);return this.items.indexOf(entry);}
  Item(key){return this.items[this.index(key)].item;}
  Remove(key){const i=this.index(key),entry=this.items[i];this.items.splice(i,1);if(entry.key!==null)this.keys.delete(entry.key);}
  [Symbol.iterator](){return this.items.map(x=>x.item)[Symbol.iterator]();}
}
export class VBDictionary {
  constructor(){this.map=new Map();this.CompareMode=0;}
  normalize(k){return this.CompareMode===1&&typeof k==='string'?k.toLowerCase():k;}
  get Count(){return this.map.size;}
  Add(k,v){const key=this.normalize(k);if(this.map.has(key))throw new VBError('Key already exists',457);this.map.set(key,{key:k,value:v});}
  Item(k){return this.map.get(this.normalize(k))?.value;}
  setItem(k,v){this.map.set(this.normalize(k),{key:k,value:v});}
  Exists(k){return this.map.has(this.normalize(k))?-1:0;}
  Remove(k){if(!this.map.delete(this.normalize(k)))throw new VBError('Key not found',5);}
  RemoveAll(){this.map.clear();}
  Keys(){return VBArray.from([...this.map.values()].map(v=>v.key));}
  Items(){return VBArray.from([...this.map.values()].map(v=>v.value));}
  [Symbol.iterator](){return this.Keys()[Symbol.iterator]();}
}
export function unary(op,value){if(value===null)return null;if(value instanceof VBDecimal){if(op==='-')return value.negate();if(op==='+')return value;}if(value instanceof VBCurrency){if(op==='-')return new VBCurrency(-value.raw,true);if(op==='+')return value;}if(op==='not')return ~bankersRound(numeric(value));if(op==='-')return -numeric(value);return numeric(value);}
export function binary(op,a,b,compare='binary') {
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
export function describe(value){if(value instanceof VBErrorValue)return value.toString();if(value===MISSING)return '<Missing>'; if(value===undefined)return 'Empty';if(value===null)return 'Null';if(value===NOTHING)return 'Nothing';if(value instanceof VBArray)return `Array(${value.bounds.map(([l,u])=>`${l} To ${u}`).join(', ')})`;if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();if(typeof value==='string')return '"'+value+'"';if(value instanceof Date)return '#'+value.toLocaleString()+'#';if(typeof value==='object')return value.__type||value.constructor?.name||'Object';return String(value);}
