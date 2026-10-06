import {ComputeError,ARRAY_HEADER_WORDS,integer} from './protocol.js';
import {encodeDouble,decodeDouble} from './double-layout.js';
const DAY=86400000,EPOCH=Date.UTC(1899,11,30);
/** Capture civil host fields, not a UTC timestamp. Numeric IO preserves OLE bits. */
export function dateSerialValue(value) {
  if(value instanceof Date){
    if(!Number.isFinite(value.getTime()))throw new ComputeError('Invalid Date input','GPU_VALUE');
    const d=new Date(0);d.setUTCFullYear(value.getFullYear(),value.getMonth(),value.getDate());d.setUTCHours(0,0,0,0);
    const day=Math.round((d.getTime()-EPOCH)/DAY),fraction=(value.getHours()*3600000+value.getMinutes()*60000+value.getSeconds()*1000+value.getMilliseconds())/DAY;
    value=day<0?day-fraction:day+fraction;
  }
  if(typeof value!=='number'||!Number.isFinite(value)||value<=-657435||value>=2958466)throw new ComputeError('Date must be a finite OLE serial in years 100 through 9999','GPU_VALUE');
  return value;
}
export const encodeDate=value=>encodeDouble(dateSerialValue(value));
export const decodeDate=(low,high)=>dateSerialValue(decodeDouble(low,high));
export function dateLiteral(value){if(typeof value==='string')value=new Date(value);return `vec2<u32>(${encodeDate(value).map(n=>n+'u').join(',')})`;}
export function attachDate(initial,symbol,value=0) {
  const count=symbol.array?symbol.capacity:1,offset=initial.length;symbol.dateStorage={offset,stride:2};const words=encodeDate(value);
  for(let i=0;i<count;i++){initial[symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0)+i]=initial.length;initial.push(...words);}return symbol;
}
export function validateDateStorage(artifact,symbol) {
  const storage=symbol.dateStorage,count=symbol.array?symbol.capacity:1;
  if(!storage||storage.stride!==2)throw new ComputeError('Invalid Date storage','GPU_ABI');
  integer(storage.offset,'Date storage offset',0,artifact.stateWords-count*2);
  for(let i=0;i<count;i++) {const p=storage.offset+i*2;if(artifact.initialState[symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0)+i]!==p)throw new ComputeError('Invalid Date reference','GPU_ABI');decodeDate(artifact.initialState[p],artifact.initialState[p+1]);}
  return [storage.offset,storage.offset+count*2];
}
