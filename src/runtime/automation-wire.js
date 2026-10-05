/** Explicit bounded wire types; no arbitrary JSON objects or prototype dispatch. */
import {NOTHING,MISSING,VBArray,VBErrorValue,VBCurrency,VBDecimal} from './values.js';
import {dateToSerial,serialToDate} from './calendar.js';
const bad=message=>{throw new TypeError(message);};
function boundsOf(bounds){if(!Array.isArray(bounds)||bounds.length<1||bounds.length>8)bad('Invalid Automation array rank');let total=1;for(const b of bounds){if(!Array.isArray(b)||b.length!==2||b.some(n=>!Number.isSafeInteger(n)||n< -2147483648||n>2147483647)||b[1]<b[0]-1)bad('Invalid Automation array bounds');total*=b[1]-b[0]+1;if(total>10000)bad('Automation array exceeds 10,000 elements');}return total;}
export function encodeAutomationValue(value,{objectId=()=>null}={},depth=0){
  if(depth>16)bad('Automation nesting exceeds 16');const encode=v=>encodeAutomationValue(v,{objectId},depth+1);
  if(value===undefined)return {t:'empty'};if(value===null)return {t:'null'};if(value===NOTHING)return {t:'nothing'};if(value===MISSING)return {t:'missing'};
  if(typeof value==='string'){if(value.length>500000)bad('Automation string too large');return {t:'string',v:value};}
  if(typeof value==='boolean')return {t:'boolean',v:value};
  if(typeof value==='number'){if(!Number.isFinite(value))bad('Nonfinite Automation number');return {t:'number',v:value};}
  if(value instanceof Date){if(!Number.isFinite(value.getTime()))bad('Invalid Automation date');return {t:'date',v:dateToSerial(value)};}
  if(value instanceof VBCurrency)return {t:'currency',v:value.toString()};if(value instanceof VBDecimal)return {t:'decimal',v:value.toString()};if(value instanceof VBErrorValue)return {t:'error',v:value.number};
  if(value instanceof VBArray){boundsOf(value.bounds);return {t:'array',bounds:value.bounds.map(b=>[...b]),v:value.data.map(encode)};}
  const id=objectId(value);if(typeof id==='string'&&/^o[1-9]\d*$/.test(id))return {t:'object',id};
  bad('Value cannot be marshalled to native Automation');
}
export function decodeAutomationValue(wire,{object=()=>bad('Unexpected native object')}={},depth=0){
  if(depth>16||!wire||typeof wire!=='object')bad('Invalid Automation value');const decode=v=>decodeAutomationValue(v,{object},depth+1),v=wire.v;
  switch(wire.t){
    case 'empty':return undefined;case 'null':return null;case 'nothing':return NOTHING;case 'missing':return MISSING;
    case 'string':if(typeof v!=='string'||v.length>500000)bad('Invalid Automation string');return v;
    case 'boolean':if(typeof v!=='boolean')bad('Invalid Automation Boolean');return v?-1:0;
    case 'number':if(typeof v!=='number'||!Number.isFinite(v))bad('Invalid Automation number');return v;
    case 'date':if(typeof v!=='number'||!Number.isFinite(v))bad('Invalid Automation date');return serialToDate(v);
    case 'decimal':case 'currency':if(typeof v!=='string'||v.length>64||!/^[-+]?\d+(?:\.\d+)?$/.test(v))bad('Invalid exact decimal');return wire.t==='currency'?new VBCurrency(v):new VBDecimal(v);
    case 'error':if(!Number.isInteger(v)||v<0||v>65535)bad('Unsupported Automation SCODE');return new VBErrorValue(v);
    case 'object':if(!/^o[1-9]\d*$/.test(wire.id))bad('Invalid native handle');return object(wire);
    case 'array':{const total=boundsOf(wire.bounds);if(!Array.isArray(v)||v.length!==total)bad('Automation array data mismatch');const data=v.map(decode);if(!total){const a=new VBArray();a.bounds=wire.bounds.map(b=>[...b]);a.data=[];return a;}const a=new VBArray(wire.bounds);a.data=data;return a;}
    default:bad('Unknown Automation wire type');
  }
}
