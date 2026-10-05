import {VBCurrency,VBDecimal} from '../runtime/values.js';
import {assertData} from './common.js';
/** Explicit tagged cells: transport cannot silently round BigInt or turn BLOBs into objects. */
export function encodeCell(value){
 if(value instanceof VBCurrency||value instanceof VBDecimal)return value.toString();
 if(typeof value==='bigint')return {$vb6:'integer',value:value.toString()};
 // Native ODBC can return ArrayBuffer; views must not expose bytes outside their slice.
 const bytes=ArrayBuffer.isView(value)?new Uint8Array(value.buffer,value.byteOffset,value.byteLength):value instanceof ArrayBuffer?new Uint8Array(value):null;
 if(bytes){let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return {$vb6:'binary',value:btoa(binary)};}
 if(value instanceof Date)return {$vb6:'date',value:value.toISOString()};
 if(value!=null&&typeof value==='object'&&typeof value.toJSON!=='function'&&value.__type)throw new TypeError('Unsupported gateway parameter object');
 return value;
}
export function decodeCell(value){
 if(!value||typeof value!=='object'||!Object.hasOwn(value,'$vb6'))return value;
 if(value.$vb6==='binary'){assertData(typeof value.value==='string'&&value.value.length<=28000000,'Invalid gateway binary');return Uint8Array.from(atob(value.value),c=>c.charCodeAt(0));}
 if(value.$vb6==='integer'){assertData(/^-?\d+$/.test(value.value),'Invalid gateway integer');const n=BigInt(value.value);return n>=BigInt(Number.MIN_SAFE_INTEGER)&&n<=BigInt(Number.MAX_SAFE_INTEGER)?Number(n):value.value;}
 if(value.$vb6==='date'){const date=new Date(value.value);assertData(Number.isFinite(+date),'Invalid gateway date');return date;}
 throw new TypeError('Unknown gateway cell encoding');
}
export function encodeResult(result){return {columns:result.columns,values:result.values.map(row=>row.map(encodeCell)),rowsAffected:Number(result.rowsAffected||0)};}
export function decodeResult(result){assertData(Array.isArray(result.columns)&&Array.isArray(result.values),'Invalid gateway result');return {...result,values:result.values.map(row=>row.map(decodeCell))};}
