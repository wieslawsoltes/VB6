import {VBError} from '../language/lexer.js';
import {VBScalar,SCALAR_TYPES,scalarType,tagScalar,unbox,VBArray,VBCurrency,VBDecimal,VBErrorValue,NOTHING,coerce,numeric,vbString,Cell,makeRecord as buildRecord} from './values.js';

// Classic VB files use an ANSI code page. This browser runtime explicitly uses
// Windows-1252 rather than silently writing UTF-8 or host-locale-dependent bytes.
const c1=[0x20AC,0x81,0x201A,0x192,0x201E,0x2026,0x2020,0x2021,0x2C6,0x2030,0x160,0x2039,0x152,0x8D,0x17D,0x8F,0x90,0x2018,0x2019,0x201C,0x201D,0x2022,0x2013,0x2014,0x2DC,0x2122,0x161,0x203A,0x153,0x9D,0x17E,0x178];
const charCodes=Array.from({length:256},(_,i)=>i>=128&&i<160?c1[i-128]:i);
const encodeMap=new Map(charCodes.map((code,i)=>[String.fromCharCode(code),i]));
export function encodeANSI(text){return Uint8Array.from(String(text),c=>{const b=encodeMap.get(c);if(b===undefined)throw new VBError('Character is not representable in the Windows-1252 file encoding',5);return b;});}
export function decodeANSI(bytes){let result='';for(let i=0;i<bytes.length;i+=8192)result+=String.fromCharCode(...Array.from(bytes.subarray(i,i+8192),byte=>charCodes[byte]));return result;}
const TYPES={byte:[1,'Uint8'],integer:[2,'Int16'],long:[4,'Int32'],single:[4,'Float32'],double:[8,'Float64'],boolean:[2,'Int16'],date:[8,'Float64'],currency:[8,'BigInt64']};
const VARTYPES={0:'Empty',1:'Null',2:'Integer',3:'Long',4:'Single',5:'Double',6:'Currency',7:'Date',8:'String',10:'Error',11:'Boolean',14:'Decimal',17:'Byte'};
const MAX_BYTES=20*1024*1024;

/** Builds a typed UDT value with non-enumerable field metadata. */
export function makeRecord(name,fields){return buildRecord(name,fields);}
export function recordLength(value){
  if(!value?.__fields)throw new VBError('User-defined type required',13);
  let n=0;
  for(const [,cell]of value.__fields){const v=cell.get(),type=String(cell.type).toLowerCase();if(v?.__fields)n+=recordLength(v);else if(v instanceof VBArray){for(const element of v.data)n+=element?.__fields?recordLength(element):TYPES[v.type.toLowerCase()]?.[0]||String(element??'').length;}else if(type==='string')n+=cell.fixedLength??String(v??'').length;else if(TYPES[type])n+=TYPES[type][0];else if(type==='variant')n+=16;else throw new VBError('Unsupported record field: '+cell.type,458);}
  return n;
}
class Writer {
  constructor(){this.chunks=[];this.length=0;}
  write(bytes){if(this.length+bytes.length>MAX_BYTES)throw new VBError('Binary record exceeds 20 MiB limit',7);this.chunks.push(bytes);this.length+=bytes.length;}
  number(type,value){const [size,method]=TYPES[type],bytes=new Uint8Array(size);new DataView(bytes.buffer)['set'+method](0,value,true);this.write(bytes);}
  finish(){const bytes=new Uint8Array(this.length);let p=0;for(const b of this.chunks){bytes.set(b,p);p+=b.length;}return bytes;}
}
class Reader {
  constructor(bytes){this.bytes=bytes;this.position=0;}
  read(length){if(!Number.isInteger(length)||length<0||this.position+length>this.bytes.length)throw new VBError('Input past end of file',62);const result=this.bytes.subarray(this.position,this.position+length);this.position+=length;return result;}
  number(type){const [size,method]=TYPES[type],b=this.read(size);return new DataView(b.buffer,b.byteOffset,b.byteLength)['get'+method](0,true);}
}
function variantType(value){if(value instanceof VBScalar)return SCALAR_TYPES[value.type];if(value instanceof VBDecimal)return 14;if(value instanceof VBErrorValue)return 10;if(value===undefined)return 0;if(value===null)return 1;if(value instanceof VBCurrency)return 6;if(value instanceof Date)return 7;if(typeof value==='string')return 8;if(typeof value==='boolean')return 11;if(typeof value==='number')return 5;throw new VBError('Cannot serialize objects or scalar Variants containing arrays',458);}
function* arrayIndices(bounds){if(!bounds.length)return;const idx=bounds.map(([l])=>l);while(true){yield [...idx];let d=0;for(;d<bounds.length;d++){if(++idx[d]<=bounds[d][1])break;idx[d]=bounds[d][0];}if(d===bounds.length)break;}}
function put(writer,value,schema,mode,inRecord=false,depth=0){
  if(depth>32)throw new VBError('Record nesting exceeds runtime limit',7);
  const type=String(schema.type||'Variant').toLowerCase();
  if(value instanceof VBArray){
    if(!schema.isArray)throw new VBError('Scalar Variant containing an array is not supported by Put',458);
    if(!value.bounds.length)throw new VBError('Subscript out of range',9);
    if(value.dynamic&&(mode==='random'||inRecord)){writer.number('integer',value.bounds.length);for(const [lo,hi]of value.bounds){writer.number('long',hi-lo+1);writer.number('long',lo);}}
    for(const indices of arrayIndices(value.bounds))put(writer,value.getScalar(...indices),{type:value.type,fixedLength:value.fixedLength},mode,inRecord,depth+1);
    return;
  }
  if(value?.__fields){for(const [,cell]of value.__fields)put(writer,cell.getScalar(),cell,mode,true,depth+1);return;}
  if(value===NOTHING||type==='object')throw new VBError('Objects cannot be written with Put',458);
  if(type==='variant'){const kind=variantType(value);writer.number('integer',kind);if(kind<2)return;put(writer,value,{type:VARTYPES[kind]},mode,kind===8||inRecord,depth+1);return;}
  value=unbox(value);
  if(type==='decimal'){writer.write(coerce(value,'Decimal').toBytes());return;}
  if(type==='error'){writer.number('long',value.number);return;}
  if(type==='string'){
    const text=coerce(value,'String',schema.fixedLength),bytes=encodeANSI(text);
    if(schema.fixedLength==null&&(mode==='random'||inRecord)){if(bytes.length>65535)throw new VBError('String exceeds 16-bit record descriptor',63);writer.number('integer',bytes.length>32767?bytes.length-65536:bytes.length);}
    writer.write(bytes);return;
  }
  if(!TYPES[type])throw new VBError('Unsupported file data type: '+schema.type,458);
  const coerced=coerce(value,type);
  writer.number(type,type==='currency'?coerced.raw:type==='date'?numeric(coerced):coerced);
}
function get(reader,schema,current,mode,inRecord=false,depth=0){
  if(depth>32)throw new VBError('Record nesting exceeds runtime limit',7);
  const type=String(schema.type||'Variant').toLowerCase();
  if(current instanceof VBArray||schema.isArray){
    if(!schema.isArray)throw new VBError('Scalar Variant containing an array is not supported by Get',458);
    let bounds=current?.bounds||[],dynamic=current?.dynamic??true,elementType=current?.type||schema.elementType||'Variant';
    if(dynamic&&(mode==='random'||inRecord)){
      const rank=reader.number('integer');if(rank<1||rank>32)throw new VBError('Invalid array descriptor',63);
      bounds=[];for(let i=0;i<rank;i++){const size=reader.number('long'),lower=reader.number('long');if(size<1)throw new VBError('Invalid array descriptor',63);bounds.push([lower,lower+size-1]);}
    }
    if(!bounds.length)throw new VBError('Dimension the array before Binary Get',9);
    const result=new VBArray(bounds,elementType,current?.elementFactory,current?.fixedLength);result.dynamic=dynamic;
    for(const idx of arrayIndices(bounds))result.set(idx,get(reader,{type:elementType,fixedLength:current?.fixedLength},result.get(...idx),mode,inRecord,depth+1));
    return result;
  }
  if(current?.__fields){const fields=new Map();for(const [name,cell]of current.__fields){const value=get(reader,cell,cell.get(),mode,true,depth+1),next=new Cell(cell.type,value,false,cell.fixedLength);next.isArray=cell.isArray;next.elementType=cell.elementType;fields.set(name,next);}return makeRecord(current.__type,fields);}
  if(type==='object'||current===NOTHING)throw new VBError('Objects cannot be read with Get',458);
  if(type==='variant'){
    const kind=reader.number('integer');if(kind===0)return undefined;if(kind===1)return null;if(!VARTYPES[kind])throw new VBError('Unsupported Variant file descriptor: '+kind,458);
    return tagScalar(get(reader,{type:VARTYPES[kind]},undefined,mode,kind===8||inRecord,depth+1),VARTYPES[kind],true);
  }
  if(type==='decimal')return VBDecimal.fromBytes(reader.read(16));
  if(type==='error')return new VBErrorValue(reader.number('long'));
  if(type==='string'){
    const length=schema.fixedLength??((mode==='random'||inRecord)?reader.number('integer')&65535:vbString(current).length);
    return decodeANSI(reader.read(length));
  }
  if(!TYPES[type])throw new VBError('Unsupported file data type: '+schema.type,458);
  const value=reader.number(type);return type==='currency'?new VBCurrency(value,true):coerce(value,type);
}
export function encodeVariable(value,schema={},mode='binary'){const writer=new Writer();put(writer,value,schema,mode);return writer.finish();}
export function decodeVariable(bytes,schema={},current,mode='binary'){const reader=new Reader(bytes),value=get(reader,schema,current,mode);return {value:unbox(value),scalar:value,bytesRead:reader.position};}
