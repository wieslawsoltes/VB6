import {VBError} from '../language/lexer.js';
const MAX_RESOURCE_BYTES=20*1024*1024;
const fail=message=>{throw new VBError(message,1002);};
export function fromBase64(data){if(typeof data!=='string'||data.length>MAX_RESOURCE_BYTES*4/3+8)fail('invalid or oversized base64 resource');let binary;try{binary=atob(data);}catch{fail('invalid base64');}return Uint8Array.from(binary,c=>c.charCodeAt(0));}
export function toBase64(bytes){if(bytes.length>MAX_RESOURCE_BYTES)fail('resource exceeds 20 MiB limit');let result='';for(let at=0;at<bytes.length;at+=8192)result+=String.fromCharCode(...bytes.subarray(at,at+8192));return btoa(result);}
