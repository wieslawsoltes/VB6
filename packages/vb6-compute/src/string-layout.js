import {ComputeError, integer, ARRAY_HEADER_WORDS} from './protocol.js';
export const STRING_HEADER_WORDS = 3; // length, reserved UTF-16 capacity, fixed length (0 = variable)

/** UTF-16 code units, not code points: preserve embedded NULs and unpaired surrogates. */
export function encodeStringBlock(value, storage) {
  if(typeof value!=='string')throw new ComputeError('String input must be a JavaScript string','GPU_VALUE');
  const {capacity,fixedLength=0}=storage;
  integer(capacity,'string capacity',1,4096);integer(fixedLength,'fixed string length',0,capacity);
  if(!fixedLength&&value.length>capacity)throw new ComputeError(`String exceeds reserved capacity ${capacity}`,'GPU_STRING_CAPACITY');
  const length=fixedLength||value.length,block=new Uint32Array(STRING_HEADER_WORDS+capacity);
  block.set([length,capacity,fixedLength]);
  for(let i=0;i<length;i++)block[STRING_HEADER_WORDS+i]=i<value.length?value.charCodeAt(i):32;
  return block;
}
export function decodeStringBlock(words, offset, storage) {
  const {capacity,fixedLength=0}=storage;
  if(offset<0||offset+STRING_HEADER_WORDS+capacity>words.length||words[offset]>capacity||words[offset+1]!==capacity||words[offset+2]!==fixedLength||(fixedLength&&words[offset]!==fixedLength))throw new ComputeError('Invalid GPU string descriptor','GPU_ABI');
  let value='';
  for(let i=0;i<words[offset];i++){
    const unit=words[offset+STRING_HEADER_WORDS+i];
    if(unit>65535)throw new ComputeError('Invalid GPU UTF-16 code unit','GPU_ABI');
    value+=String.fromCharCode(unit);
  }
  return value;
}
export function validateStringStorage(artifact,symbol) {
  const storage=symbol.stringStorage,count=symbol.array?symbol.capacity:1;
  if(!storage)throw new ComputeError('Missing string storage metadata','GPU_ABI');
  integer(storage.capacity,'string capacity',1,4096);integer(storage.fixedLength,'fixed string length',0,storage.capacity);
  if(storage.stride!==storage.capacity+STRING_HEADER_WORDS)throw new ComputeError('Invalid GPU string stride','GPU_ABI');
  integer(storage.offset,'string storage offset',0,artifact.stateWords-count*storage.stride);
  const first=symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0);
  for(let i=0;i<count;i++){
    const block=storage.offset+i*storage.stride;
    if(artifact.initialState[first+i]!==block)throw new ComputeError('Invalid initial string reference','GPU_ABI');
    decodeStringBlock(artifact.initialState,block,storage);
  }
  return [storage.offset,storage.offset+count*storage.stride];
}

/** Compiler-owned bounded slabs. Temporaries are reused on loop iterations, not
 * allocated per execution. Every depth-specialized frame owns its own scratch. */
export class StringStorage {
  constructor(initial,{maxStringLength,maxStateWords,error}) {
    this.initial=initial;this.maxStringLength=maxStringLength;this.maxStateWords=maxStateWords;this.error=error;
    this.arrays=[];this.literals=new Map();this.used=false;
  }
  reserve(capacity,fixedLength=0,value='') {
    const offset=this.initial.length;
    if(offset+STRING_HEADER_WORDS+capacity>this.maxStateWords)this.error('String storage exceeds maxStateWords; reduce maxStringLength, array capacity or call depth','GPU_LIMIT');
    this.used=true;
    if(capacity===0){this.initial.push(0,0,0);return offset;}
    this.initial.push(...encodeStringBlock(value,{capacity,fixedLength}));return offset;
  }
  attach(symbol,{fixedLength=0}={}) {
    fixedLength ||= 0;integer(fixedLength,'fixed string length',0,this.maxStringLength);
    const capacity=fixedLength||this.maxStringLength,stride=capacity+STRING_HEADER_WORDS,count=symbol.array?symbol.capacity:1;
    if(this.initial.length+stride*count>this.maxStateWords)this.error('String array storage exceeds maxStateWords; set a smaller dynamicArrayCapacity or maxStringLength','GPU_LIMIT');
    const offset=this.initial.length;
    for(let i=0;i<count;i++)this.initial[symbol.offset+(symbol.array?ARRAY_HEADER_WORDS:0)+i]=this.reserve(capacity,fixedLength);
    symbol.stringStorage={offset,capacity,stride,fixedLength};
    if(symbol.array)this.arrays.push(symbol);
    return symbol;
  }
  literal(value) {
    if(typeof value!=='string')this.error('Expected a String constant','GPU_TYPE');
    if(value.length>this.maxStringLength)this.error('String literal exceeds maxStringLength','GPU_STRING_CAPACITY');
    if(!this.literals.has(value))this.literals.set(value,this.reserve(value.length,0,value));
    return `${this.literals.get(value)}i`;
  }
  scratch(){return `${this.reserve(this.maxStringLength)}i`;}
}
