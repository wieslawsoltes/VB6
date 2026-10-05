/** Native project text: preserve bytes, BOMs and line endings; never replace unmappable characters. */
import {decodeANSI,encodeANSI} from '../runtime/binary-codec.js';
import {VBError} from '../language/lexer.js';
import {fromBase64,toBase64} from './binary-assets.js';

export const NATIVE_ENCODINGS=['auto','windows-1252','windows-1250','windows-1251','windows-1253','windows-1254','windows-1255','windows-1256','windows-1257','windows-1258','windows-874','shift_jis','gbk','big5','euc-kr','utf-8','utf-16le','utf-16be'];
const encoders=new Map();
const fail=message=>{throw new VBError(message,1002);};
export function bytesOf(value){if(typeof value==='string')return new TextEncoder().encode(value);if(ArrayBuffer.isView(value))return new Uint8Array(value.buffer,value.byteOffset,value.byteLength);if(value instanceof ArrayBuffer)return new Uint8Array(value);if(Array.isArray(value))return Uint8Array.from(value);fail('Expected text, an ArrayBuffer or a byte array');}
export function equalBytes(a,b){a=bytesOf(a);b=bytesOf(b);return a.length===b.length&&a.every((v,i)=>v===b[i]);}
export function linesOf(text){return String(text).match(/[^\r\n]*(?:\r\n|\r|\n|$)/g)?.filter(Boolean)||[];}
export function lineBody(line){return line.replace(/[\r\n]+$/,'');}
export function lineEnding(line){return line.slice(lineBody(line).length);}
export function preferredEOL(text){return text.match(/\r\n|\r|\n/)?.[0]||'\r\n';}
export function unquote(value){const s=String(value).trim();return /^"(?:[^"]|"")*"$/.test(s)?s.slice(1,-1).replace(/""/g,'"'):s;}
export function nativePathValue(value){return /[\s"';]/.test(value)?quote(value):value;}
export function quote(value){return '"'+String(value).replace(/"/g,'""')+'"';}
export function commentAt(value){let quoted=false;for(let i=0;i<value.length;i++){if(value[i]==='"'){if(quoted&&value[i+1]==='"'){i++;continue;}quoted=!quoted;}else if(value[i]==="'"&&!quoted)return i;}return -1;}
export function replaceLineValue(line,value){const body=lineBody(line),match=body.match(/^(\s*[^=]+?\s*=\s*)(.*)$/);if(!match)return line;const at=commentAt(match[2]),tail=at<0?'':match[2].slice(at),space=at<0?'':match[2].slice(0,at).match(/\s*$/)[0];return match[1]+value+space+tail+lineEnding(line);}

export function decodeNativeBytes(bytes,encoding){return new TextDecoder(encoding).encoding==='windows-1252'?decodeANSI(bytes):new TextDecoder(encoding,{fatal:true,ignoreBOM:true}).decode(bytes);}
export function decodeNativeText(input,{encoding='auto'}={}){
  // String callers have no original byte encoding; keep the legacy CRLF export convention.
  if(typeof input==='string')return {text:input.replace(/\r\n|\r|\n/g,'\r\n'),encoding:'utf-8',bom:false};
  const bytes=bytesOf(input);let label=encoding,bom=false,skip=0;
  if(bytes[0]===0xef&&bytes[1]===0xbb&&bytes[2]===0xbf){label='utf-8';bom=true;skip=3;}
  else if(bytes[0]===0xff&&bytes[1]===0xfe){label='utf-16le';bom=true;skip=2;}
  else if(bytes[0]===0xfe&&bytes[1]===0xff){label='utf-16be';bom=true;skip=2;}
  else if(label==='auto'){label='windows-1252';if(bytes.some(b=>b>=128))try{new TextDecoder('utf-8',{fatal:true}).decode(bytes);label='utf-8';}catch{}}
  try{const decoder=new TextDecoder(label,{fatal:true,ignoreBOM:true});return {text:decodeNativeBytes(bytes.subarray(skip),decoder.encoding),encoding:decoder.encoding,bom,bytes:toBase64(bytes)};}
  catch(error){fail('Cannot decode native source as '+label+': '+error.message);}
}
function legacyEncoder(label){
  if(encoders.has(label))return encoders.get(label);
  const decoder=new TextDecoder(label,{fatal:true,ignoreBOM:true}),map=new Map();
  const add=bytes=>{try{const text=decoder.decode(bytes);if([...text].length===1&&text!=='\ufffd'&&!map.has(text))map.set(text,bytes.slice());}catch{}};
  for(let a=0;a<256;a++)add(Uint8Array.of(a));
  if(['shift_jis','gbk','big5','euc-kr'].includes(decoder.encoding))for(let a=0x81;a<=0xfe;a++)for(let b=0x40;b<=0xff;b++)add(Uint8Array.of(a,b));
  encoders.set(label,map);return map;
}
export function encodeNativeText(text,document={encoding:'windows-1252',bom:false},override){
  document ||= {encoding:'windows-1252',bom:false};
  const encoding=override&&override!=='auto'?new TextDecoder(override).encoding:document.encoding||'windows-1252';
  if((!override||override==='auto')&&text===document.text&&document.bytes!==undefined)return fromBase64(document.bytes);
  if(encoding==='utf-8'){
    if(!document.bom)return text;
    const data=new TextEncoder().encode(text),bytes=new Uint8Array(data.length+3);bytes.set([239,187,191]);bytes.set(data,3);return bytes;
  }
  if(/^utf-16(?:le|be)$/.test(encoding)){
    const skip=document.bom?2:0,bytes=new Uint8Array(text.length*2+skip),view=new DataView(bytes.buffer),little=encoding==='utf-16le';if(skip)view.setUint16(0,0xfeff,little);for(let i=0;i<text.length;i++)view.setUint16(skip+i*2,text.charCodeAt(i),little);return bytes;
  }
  if(new TextDecoder(encoding).encoding==='windows-1252'){const bytes=encodeANSI(text);return bytes.every(b=>b<128)?text:bytes;}
  const map=legacyEncoder(encoding),parts=[];let length=0;
  for(const char of text){const data=map.get(char);if(!data)fail('Character '+quote(char)+' is not representable in '+encoding+'. Choose a matching native source encoding; no file was written.');parts.push(data);length+=data.length;}
  const bytes=new Uint8Array(length);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
  // ASCII text remains string-compatible with the existing sourceFiles API.
  return bytes.every(b=>b<128)?text:bytes;
}
