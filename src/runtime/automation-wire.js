/** Explicit bounded wire types. Never dispatch arbitrary object/prototype data.
 * `preserveScalars` is opt-in so existing JavaScript embedding APIs stay raw.
 */
import {NOTHING,MISSING,VBArray,VBErrorValue,VBCurrency,VBDecimal,VBScalar,SCALAR_TYPES,tagScalar,storageScalar,scalarType,unbox} from './values.js';
import {dateToSerial,serialToDate} from './calendar.js';
const bad=message=>{throw new TypeError(message);};
const numericTypes=Object.freeze({2:'integer',3:'long',4:'single',5:'double',17:'byte'});
const arrayTypes=Object.freeze({...numericTypes,6:'currency',7:'date',8:'string',11:'boolean',12:'Variant',14:'decimal'});
function budgetOf(budget,depth){
  const b=depth===0?{nodes:0,characters:0}:budget;
  if(!b||++b.nodes>20000)bad('Automation value exceeds aggregate node limit');
  return b;
}
function stringBudget(budget,text){budget.characters+=text.length;if(budget.characters>500000)bad('Automation value exceeds aggregate string limit');}
function boundsOf(bounds){
  if(!Array.isArray(bounds)||bounds.length<1||bounds.length>8)bad('Invalid Automation array rank');
  let total=1;
  for(const b of bounds){
    if(!Array.isArray(b)||b.length!==2||b.some(n=>!Number.isSafeInteger(n)||n< -2147483648||n>2147483647)||b[1]<b[0]-1)bad('Invalid Automation array bounds');
    const length=b[1]-b[0]+1;
    // Bound each dimension even when another dimension is empty.
    if(length>10000)bad('Automation array dimension exceeds 10,000 elements');
    total*=length;if(total>10000)bad('Automation array exceeds 10,000 elements');
  }
  return total;
}
function numberValue(v,vt=5){
  if(typeof v!=='number'||!Number.isFinite(v)||(!Number.isInteger(vt)||!Object.hasOwn(numericTypes,vt)))bad('Invalid Automation number or VARTYPE');
  const ranges={17:[0,255],2:[-32768,32767],3:[-2147483648,2147483647]};
  if(ranges[vt]&&(!Number.isInteger(v)||v<ranges[vt][0]||v>ranges[vt][1]))bad('Automation integer payload does not match its VARTYPE');
  if(vt===4&&(!Number.isFinite(Math.fround(v))||Math.fround(v)!==v))bad('Automation Single payload must be exactly representable');
  return v;
}
export function encodeAutomationValue(value,{objectId=()=>null}={},depth=0,budget){
  budget=budgetOf(budget,depth);
  if(depth>16)bad('Automation nesting exceeds 16');
  const encode=v=>encodeAutomationValue(v,{objectId},depth+1,budget),type=scalarType(value),tagged=value instanceof VBScalar;
  value=unbox(value);
  if(value===undefined)return {t:'empty'};if(value===null)return {t:'null'};if(value===NOTHING)return {t:'nothing'};if(value===MISSING)return {t:'missing'};
  if(type==='boolean')return {t:'boolean',v:!!value};
  if(typeof value==='string'){stringBudget(budget,value);if(value.length>500000)bad('Automation string too large');return {t:'string',v:value};}
  if(typeof value==='number'){
    const vt=tagged?SCALAR_TYPES[type]:5;numberValue(value,vt);
    return {t:'number',vt,v:value};
  }
  if(value instanceof Date){if(!Number.isFinite(value.getTime()))bad('Invalid Automation date');return {t:'date',v:dateToSerial(value)};}
  if(value instanceof VBCurrency)return {t:'currency',v:value.toString()};
  if(value instanceof VBDecimal)return {t:'decimal',v:value.toString()};
  if(value instanceof VBErrorValue)return {t:'error',v:value.number};
  if(value instanceof VBArray){
    const total=boundsOf(value.bounds),elementType=SCALAR_TYPES[String(value.type).toLowerCase()]??(String(value.type).toLowerCase()==='variant'?12:null);
    if(elementType===null||!Object.hasOwn(arrayTypes,elementType))bad('Unsupported Automation array element type');
    if(value.data.length!==total)bad('Automation array data mismatch');
    // Follow row-major backing order used by both VBArray.offset and .NET Array,
    // not VB For Each order. Retain Variant element tags without trusting stale tags.
    const data=value.data.map((v,i)=>{
      const tag=value.scalarData?.[i];
      return encode(tag instanceof VBScalar&&Object.is(tag.value,v)?tag:storageScalar(v,value.type));
    });
    return {t:'array',elementType,bounds:value.bounds.map(b=>[...b]),v:data};
  }
  const id=objectId(value);if(typeof id==='string'&&/^o[1-9]\d*$/.test(id))return {t:'object',id};
  bad('Value cannot be marshalled to native Automation');
}
export function decodeAutomationValue(wire,{object=()=>bad('Unexpected native object'),preserveScalars=false}={},depth=0,budget){
  budget=budgetOf(budget,depth);
  if(depth>16||!wire||typeof wire!=='object'||Array.isArray(wire))bad('Invalid Automation value');
  const decode=v=>decodeAutomationValue(v,{object,preserveScalars},depth+1,budget),v=wire.v;
  const scalar=(value,type)=>preserveScalars?tagScalar(value,type,true):value;
  switch(wire.t){
    case 'empty':return scalar(undefined,'empty');case 'null':return scalar(null,'null');case 'nothing':return NOTHING;case 'missing':return MISSING;
    case 'string':if(typeof v!=='string'||v.length>500000)bad('Invalid Automation string');stringBudget(budget,v);return scalar(v,'string');
    case 'boolean':if(typeof v!=='boolean')bad('Invalid Automation Boolean');return scalar(v?-1:0,'boolean');
    case 'number':{const vt=wire.vt??5;numberValue(v,vt);return scalar(v,numericTypes[vt]);}
    case 'date':if(typeof v!=='number'||!Number.isFinite(v))bad('Invalid Automation date');return scalar(serialToDate(v),'date');
    case 'decimal':case 'currency':
      if(typeof v!=='string'||v.length>64||!/^[-+]?\d+(?:\.\d+)?$/.test(v))bad('Invalid exact decimal');
      return scalar(wire.t==='currency'?new VBCurrency(v):new VBDecimal(v),wire.t);
    case 'error':if(!Number.isInteger(v)||v<0||v>65535)bad('Unsupported Automation SCODE');return scalar(new VBErrorValue(v),'error');
    case 'object':if(typeof wire.id!=='string'||!/^o[1-9]\d*$/.test(wire.id))bad('Invalid native handle');return object(wire);
    case 'array':{
      const total=boundsOf(wire.bounds),vt=wire.elementType??12;
      if((!Number.isInteger(vt)||!Object.hasOwn(arrayTypes,vt))||!Array.isArray(v)||v.length!==total)bad('Automation array data/type mismatch');
      const type=arrayTypes[vt],data=v.map(decode),array=Object.create(VBArray.prototype);
      Object.assign(array,{type,bounds:wire.bounds.map(b=>[...b]),dynamic:true,elementFactory:null,fixedLength:null});
      array.scalarData=data.map(item=>storageScalar(item,type));array.data=array.scalarData.map(unbox);
      return array;
    }
    default:bad('Unknown Automation wire type');
  }
}
