import {Win32Error,integer,unsigned} from './core.js';
import {registerAW} from './services-utils.js';

export const MESSAGE_CONSTANTS=Object.freeze({FORMAT_MESSAGE_ALLOCATE_BUFFER:0x100,FORMAT_MESSAGE_IGNORE_INSERTS:0x200,FORMAT_MESSAGE_FROM_STRING:0x400,FORMAT_MESSAGE_FROM_HMODULE:0x800,FORMAT_MESSAGE_FROM_SYSTEM:0x1000,FORMAT_MESSAGE_ARGUMENT_ARRAY:0x2000,FORMAT_MESSAGE_MAX_WIDTH_MASK:255});
// Portable, explicit English entries, not an assertion that every OS message exists.
const MESSAGES=Object.freeze({0:'The operation completed successfully.',2:'The system cannot find the file specified.',3:'The system cannot find the path specified.',5:'Access is denied.',6:'The handle is invalid.',8:'Not enough memory resources are available to process this command.',13:'The data is invalid.',18:'There are no more files.',50:'The request is not supported.',87:'The parameter is incorrect.',122:'The data area passed to a system call is too small.',126:'The specified module could not be found.',127:'The specified procedure could not be found.',183:'Cannot create a file when that file already exists.',234:'More data is available.',259:'No more data is available.',995:'The I/O operation has been aborted because of either a thread exit or an application request.',1004:'Invalid flags.',1400:'Invalid window handle.'});
export function installMessageFormatting(w) {
  const m=w.memory;
  registerAW(w,'kernel32','FormatMessage',7,(wide,flags,source,id,language,dst,capacity,args)=>{
    flags=unsigned(flags);id=unsigned(id);language=unsigned(language);capacity=integer(capacity,0,65536);
    if(flags&~0x3fff)throw new Win32Error('Invalid FormatMessage flags',1004);
    const kind=flags&0x1c00,width=flags&255;
    if(kind!==0x400&&kind!==0x1000)throw new Win32Error('Only FROM_STRING or FROM_SYSTEM is supported',kind&0x800?50:1004);
    if(width!==0&&width!==255)throw new Win32Error('Automatic FormatMessage line wrapping is not implemented',50);
    if(kind===0x1000&&language!==0&&language!==0x409)throw new Win32Error('Message language is unavailable',1815);
    let template;
    if(kind===0x400){if(!source)throw new Win32Error('Message source is required');template=m.string(source,wide);}
    else {if(!Object.hasOwn(MESSAGES,id))throw new Win32Error('Message identifier is unavailable',317);template=MESSAGES[id]+'\r\n';}
    if(template.length>65535)throw new Win32Error('Message is too large',234);
    if(width===255)template=template.replace(/\r\n|\r|\n/g,' ');
    let text='';const append=s=>{text+=s;if(text.length>65535)throw new Win32Error('Message is too large',234);};
    for(let i=0;i<template.length;) {
      if(template[i]!=='%'){append(template[i++]);continue;}
      const start=i++;if(i===template.length)throw new Win32Error('Incomplete message escape');
      const c=template[i++];if(c==='0')break;
      if(/[1-9]/.test(c)) {
        let index=Number(c);if(/[0-9]/.test(template[i]??''))index=index*10+Number(template[i++]);
        let spec='s';if(template[i]==='!'){const end=template.indexOf('!',i+1);if(end<0)throw new Win32Error('Unterminated message insertion');spec=template.slice(i+1,end);i=end+1;}
        if(flags&0x200){append(template.slice(start,i));continue;}
        if(!(flags&0x2000))throw new Win32Error('Native va_list is not supported; supply ARGUMENT_ARRAY',50);
        const match=/^(-)?(0)?(\d{1,5})?(?:\.(\d{1,5}))?(s|d|i|u|x|X)$/.exec(spec);
        if(!match)throw new Win32Error('Unsupported message insert format',50);
        const [,left,zero,padding,precision,conversion]=match,min=Number(padding||0);
        if(min>32767||precision!==undefined&&Number(precision)>32767)throw new Win32Error('Message insert width is too large',234);
        const value=m.readU32(unsigned(args)+(index-1)*4);let result;
        if(conversion==='s'){result=m.string(value,wide);if(precision!==undefined)result=result.slice(0,Number(precision));}
        else {if(precision!==undefined)throw new Win32Error('Integer insert precision is not implemented',50);result=conversion==='d'||conversion==='i'?String(value|0):conversion==='u'?String(value):value.toString(16);if(conversion==='X')result=result.toUpperCase();}
        if(result.length<min){const fill=(zero&&!left&&conversion!=='s'?'0':' ').repeat(min-result.length);result=left?result+fill:result.startsWith('-')&&fill[0]==='0'?'-'+fill+result.slice(1):fill+result;}
        append(result);continue;
      }
      const escapes={n:'\r\n',r:'\r',t:'\t',b:' ', '%':'%'};
      append(Object.hasOwn(escapes,c)?escapes[c]:c);
    }
    const bytes=m.stringBytes(text,wide),step=wide?2:1,needed=bytes.length+step;
    if(needed>65536)throw new Win32Error('Message output exceeds 64 KiB',234);
    if(flags&0x100) {
      const target=m.view(dst,4),size=Math.max(needed,capacity*step);if(size>65536)throw new Win32Error('Message allocation exceeds 64 KiB',234);
      const ptr=w.resolve('kernel32','LocalAlloc').fn(0,size);
      try {m.bytes(ptr,bytes.length).set(bytes);target.setUint32(0,ptr,true);}catch(error){w.resolve('kernel32','LocalFree').fn(ptr);throw error;}
    } else {
      if(capacity*step<needed)throw new Win32Error('Insufficient message output buffer',122);
      const output=m.bytes(dst,capacity*step);output.set(bytes);output.fill(0,bytes.length,needed);
    }
    return bytes.length/step;
  },{notes:'Bounded FROM_STRING/selected English FROM_SYSTEM; 32-bit argument arrays, string/integer inserts, escapes and LocalFree-owned output. No native va_list/module tables or automatic wrapping.'});
}
