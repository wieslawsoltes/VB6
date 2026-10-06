import {ComputeError, ARRAY_HEADER_WORDS, integer} from './protocol.js';

/** Validate a descriptor before using its offsets to read host memory. */
export function readArrayLayout(words, offset, symbol) {
  const invalid=()=>{throw new ComputeError('Invalid array descriptor for '+symbol.name,'GPU_ABI');};
  if(offset<0||offset+ARRAY_HEADER_WORDS>words.length)invalid();
  const rank=words[offset],length=words[offset+1],capacity=words[offset+14],flags=words[offset+15];
  if(rank>4||capacity!==symbol.capacity||length>capacity||flags!==(symbol.dynamic?1:0))invalid();
  const bounds=[];let product=rank?1:0;
  for(let d=0;d<4;d++){
    const lo=words[offset+2+d*3]|0,hi=words[offset+3+d*3]|0,stride=words[offset+4+d*3];
    if(d<rank){
      if(hi<lo||stride!==product)invalid();
      bounds.push([lo,hi]);product*=hi-lo+1;if(product>capacity)invalid();
    }else if(lo!==0||hi!==0||stride!==0)invalid();
  }
  if(length!==product||(!symbol.dynamic&&JSON.stringify(bounds)!==JSON.stringify(symbol.bounds)))invalid();
  return {allocated:rank!==0,bounds,length,capacity,dynamic:!!symbol.dynamic};
}

/** Host-side exact initialization, separate from GPU ReDim/Preserve semantics. */
export function arrayHeader(bounds,capacity,dynamic=true) {
  if(!Array.isArray(bounds)||bounds.length>4||(!dynamic&&!bounds.length))throw new ComputeError('Array rank must be one through four (or unallocated dynamic)','GPU_BOUNDS');
  integer(capacity,'array capacity',1,65536);
  const header=new Uint32Array(ARRAY_HEADER_WORDS);let length=bounds.length?1:0;
  for(let d=0;d<bounds.length;d++){
    const b=bounds[d];if(!Array.isArray(b)||b.length!==2)throw new ComputeError('Bounds require [lower,upper] pairs','GPU_BOUNDS');
    const lo=integer(b[0],'lower bound',-2147483648,2147483647),hi=integer(b[1],'upper bound',lo,2147483647);
    header.set([lo>>>0,hi>>>0,length],2+d*3);length*=hi-lo+1;
    if(length>capacity)throw new ComputeError('Array exceeds reserved GPU capacity','GPU_LIMIT');
  }
  header[0]=bounds.length;header[1]=length;header[14]=capacity;header[15]=dynamic?1:0;return header;
}
