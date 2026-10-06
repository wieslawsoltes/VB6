import {ComputeError,integer,ARRAY_HEADER_WORDS} from './protocol.js';
/** Binary64 wire format is explicitly little-endian two-u32; no f32 conversion. */
export function encodeDouble(value) {
  if(typeof value!=='number'||!Number.isFinite(value))throw new ComputeError('Double must be a finite number','GPU_VALUE');
  const view=new DataView(new ArrayBuffer(8));view.setFloat64(0,value,true);return [view.getUint32(0,true),view.getUint32(4,true)];
}
export function decodeDouble(low,high) {
  const view=new DataView(new ArrayBuffer(8));view.setUint32(0,low,true);view.setUint32(4,high,true);
  const n=view.getFloat64(0,true);if(!Number.isFinite(n))throw new ComputeError('Non-finite GPU Double','GPU_ABI');return n;
}
export const doubleLiteral=value=>`vec2<u32>(${encodeDouble(value).map(n=>n+'u').join(',')})`;
export function attachDouble(initial,symbol,value=0) {
  const count=symbol.array?symbol.capacity:1,offset=initial.length;
  symbol.doubleStorage={offset,stride:2};
  for(let i=0;i<count;i++){initial[symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0)+i]=initial.length;initial.push(...encodeDouble(value));}
  return symbol;
}
export function validateDoubleStorage(artifact,symbol) {
  const storage=symbol.doubleStorage,count=symbol.array?symbol.capacity:1;
  if(!storage||storage.stride!==2)throw new ComputeError('Invalid Double storage','GPU_ABI');
  integer(storage.offset,'Double storage offset',0,artifact.stateWords-count*2);
  for(let i=0;i<count;i++) {
    const p=storage.offset+i*2;
    if(artifact.initialState[symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0)+i]!==p)throw new ComputeError('Invalid Double reference','GPU_ABI');
    decodeDouble(artifact.initialState[p],artifact.initialState[p+1]);
  }
  return [storage.offset,storage.offset+count*2];
}
