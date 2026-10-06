import {Win32Error,integer} from './core.js';
import {putComplete} from './services-utils.js';
/** GUID byte order follows the Win32 GUID structure, not network byte order.
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-clsidfromstring
 * https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-stringfromguid2 */
export function installGUID(w){
  const m=w.memory,notes='GUID values only. No COM activation, registry ProgID lookup or native allocation.';
  const add=(name,arity,fn,options={})=>w.register('ole32',name,fn,{arity,notes,...options});
  const format=p=>{const v=m.view(p,16),hex=(n,len)=>n.toString(16).padStart(len,'0');return ('{'+hex(v.getUint32(0,true),8)+'-'+hex(v.getUint16(4,true),4)+'-'+hex(v.getUint16(6,true),4)+'-'+Array.from(m.bytes(p+8,2),n=>hex(n,2)).join('')+'-'+Array.from(m.bytes(p+10,6),n=>hex(n,2)).join('')+'}').toUpperCase();};
  function parse(input,out){
    const target=m.bytes(out,16);if(!input){target.fill(0);return 0;}
    const s=m.string(input,true);if(!/^\{[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}\}$/i.test(s))return 0x800401f3;
    const parts=s.slice(1,-1).split('-'),bytes=new Uint8Array(16),v=new DataView(bytes.buffer);
    v.setUint32(0,parseInt(parts[0],16),true);v.setUint16(4,parseInt(parts[1],16),true);v.setUint16(6,parseInt(parts[2],16),true);
    (parts[3]+parts[4]).match(/../g).forEach((pair,i)=>bytes[8+i]=parseInt(pair,16));target.set(bytes);return 0;
  }
  add('CLSIDFromString',2,parse,{failure:0x80070057});
  add('IIDFromString',2,parse,{failure:0x80070057});
  add('StringFromGUID2',3,(guid,out,capacity)=>{capacity=integer(capacity,0,0x7fffffff);const text=format(guid);if(capacity<39)return 0;putComplete(m,out,text,capacity,true);return 39;});
  add('CoCreateGuid',1,out=>{
    const target=m.bytes(out,16),crypto=w.options.crypto??globalThis.crypto;
    if(!crypto?.getRandomValues)throw new Win32Error('Secure random source unavailable',50);
    const bytes=new Uint8Array(16);crypto.getRandomValues(bytes);bytes[7]=(bytes[7]&15)|64;bytes[8]=(bytes[8]&63)|128;target.set(bytes);return 0;
  },{failure:0x80004005,mode:'browser',notes:notes+' Uses Web Crypto random values (version-4 UUID); never Math.random.'});
}
