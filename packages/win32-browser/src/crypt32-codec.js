import {Win32Error,integer,unsigned} from './core.js';
import {registerAW,putComplete} from './services-utils.js';
export const CRYPT_CONSTANTS=Object.freeze({CRYPT_STRING_BASE64:1,CRYPT_STRING_NOCRLF:0x40000000,CRYPT_STRING_NOCR:0x80000000,CRYPT_STRING_STRICT:0x20000000});
/** Base64 serialization, NOT encryption or certificate validation.
 * https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptbinarytostringa
 * https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptstringtobinarya */
export function installBinaryCodec(w){
  const m=w.memory,alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const aw=(name,arity,fn)=>registerAW(w,'crypt32',name,arity,fn,{notes:'Raw Base64 only. Supports size queries, CRLF/LF/no-wrap, strict validation and explicit byte counts. No certificate or encryption APIs.'});
  aw('CryptBinaryToString',5,(wide,input,count,flags,out,size)=>{
    count=integer(count,0,Math.floor(m.maxBytes/2));flags=unsigned(flags);if((flags&0x3fffffff)!==1)throw new Win32Error('Only Base64 encoding is supported',50);
    if(!input)throw new Win32Error('A binary input pointer is required');
    const bytes=m.bytes(input,count);let value='';
    for(let i=0;i<bytes.length;i+=3){const a=bytes[i],b=bytes[i+1],c=bytes[i+2];value+=alphabet[a>>2]+alphabet[(a&3)<<4|(b??0)>>4]+(b===undefined?'=':alphabet[(b&15)<<2|(c??0)>>6])+(c===undefined?'=':alphabet[c&63]);}
    const eol=flags&0x40000000?'':flags&0x80000000?'\n':'\r\n';if(eol)value=(value.match(/.{1,64}/g)||[]).join(eol)+eol;
    const capacity=m.readU32(size),needed=value.length+1;
    if(!out){m.writeU32(size,needed);return 1;}
    if(capacity<needed){m.writeU32(size,needed);throw new Win32Error('Encoded buffer too small',234);}
    putComplete(m,out,value,capacity,wide);m.writeU32(size,value.length);return 1;
  });
  aw('CryptStringToBinary',7,(wide,input,count,flags,out,size,skip,actual)=>{
    count=integer(count,0,Math.floor(m.maxBytes/(wide?2:1)));flags=unsigned(flags);if((flags&~0x20000000)!==1)throw new Win32Error('Only raw Base64 decoding is supported',50);
    const text=count?m.decode(m.bytes(input,count*(wide?2:1)),wide):m.string(input,wide),value=text.replace(/[\t\r\n ]/g,'');
    // Malformed inputs fail without writing partial binary output. Native legacy
    // permissive trailing-junk variants are deliberately not accepted.
    const end=value.endsWith('==')?value.length-2:value.endsWith('=')?value.length-1:value.length;
    if(value.length%4||end<0)throw new Win32Error('Invalid Base64',13);
    for(let i=0;i<end;i++)if(!alphabet.includes(value[i]))throw new Win32Error('Invalid Base64',13);
    const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,needed=value.length/4*3-padding;
    if(needed>w.maxFileBytes)throw new Win32Error('Decoded data quota exceeded',8);
    const capacity=m.readU32(size);if(skip)m.view(skip,4);if(actual)m.view(actual,4);
    if(out&&capacity<needed){m.writeU32(size,needed);throw new Win32Error('Decoded buffer too small',234);}
    const target=out?m.bytes(out,capacity):null;
    if(target){let offset=0;for(let i=0;i<value.length;i+=4){const n=(alphabet.indexOf(value[i])<<18)|(alphabet.indexOf(value[i+1])<<12)|((alphabet.indexOf(value[i+2])&63)<<6)|(alphabet.indexOf(value[i+3])&63);for(const shift of [16,8,0])if(offset<needed)target[offset++]=(n>>>shift)&255;}}
    m.writeU32(size,needed);if(skip)m.writeU32(skip,0);if(actual)m.writeU32(actual,1);return 1;
  });
}
