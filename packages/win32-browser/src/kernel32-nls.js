import {Win32Error,integer,unsigned,encodeANSI,decodeANSI} from './core.js';
import {registerAW,units,putComplete,rejectOverlap} from './services-utils.js';

export const NLS_CONSTANTS=Object.freeze({CP_ACP:0,CP_UTF8:65001,MB_PRECOMPOSED:1,MB_COMPOSITE:2,MB_ERR_INVALID_CHARS:8,WC_ERR_INVALID_CHARS:128,WC_NO_BEST_FIT_CHARS:1024});
/** Original implementation of documented buffer contracts:
 * https://learn.microsoft.com/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar
 * https://learn.microsoft.com/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte
 * Process ACP is deterministic Windows-1252, not the host OS locale. */
export function installNLS(w) {
  const m=w.memory,add=(name,arity,fn)=>w.register('kernel32',name,fn,{arity,notes:'UTF-8 and process Windows-1252 only; bounded buffers, no host locale or best-fit table.'});
  const page=cp=>{cp=unsigned(cp);if(cp===0)cp=1252;if(![1252,65001].includes(cp))throw new Win32Error('Code page is not implemented',87);return cp;};
  const source=(p,count,wide)=>{
    count=integer(count,-1,Math.floor(m.maxBytes/(wide?2:1)));
    if(!p||count===0)throw new Win32Error('A nonempty input buffer is required');
    if(count===-1){const text=m.string(p,wide);count=units(m,text,wide)+1;}
    return m.bytes(p,count*(wide?2:1));
  };
  const output=(p,capacity,bytes,wide)=>{
    capacity=integer(capacity,0,Math.floor(m.maxBytes/(wide?2:1)));
    const length=bytes.length/(wide?2:1);
    if(!capacity)return length;
    if(capacity<length)throw new Win32Error('Conversion buffer is too small',122);
    m.bytes(p,capacity*(wide?2:1)).set(bytes);return length;
  };
  add('GetACP',0,()=>1252);
  add('IsValidCodePage',1,cp=>[1252,65001].includes(unsigned(cp))?1:0);
  add('MultiByteToWideChar',6,(cp,flags,input,count,out,capacity)=>{
    cp=page(cp);flags=unsigned(flags);
    if(cp===65001 ? !!(flags&~8) : !!(flags&~11)||(flags&3)===3)throw new Win32Error('Unsupported conversion flags',1004);
    const bytes=source(input,count,false);let text;
    if(cp===65001){try{text=new TextDecoder('utf-8',{fatal:!!(flags&8),ignoreBOM:true}).decode(bytes);}catch{throw new Win32Error('Invalid UTF-8 sequence',1113);}}
    else {text=decodeANSI(bytes);if(flags&2)text=text.normalize('NFD');}
    const result=m.stringBytes(text,true);rejectOverlap(input,bytes.length,out,Number(capacity)*2);
    return output(out,capacity,result,true);
  });
  add('WideCharToMultiByte',8,(cp,flags,input,count,out,capacity,defaultChar,usedDefault)=>{
    cp=page(cp);flags=unsigned(flags);
    if(cp===65001 ? !!(flags&~128) : !!(flags&~1024))throw new Win32Error('Unsupported conversion flags',1004);
    if(cp===65001&&(defaultChar||usedDefault))throw new Win32Error('UTF-8 does not accept default character parameters');
    const bytes=source(input,count,true),text=m.decode(bytes,true);let result,used=false;
    if(cp===65001){if(flags&128&&!text.isWellFormed())throw new Win32Error('Unpaired UTF-16 surrogate',1113);result=new TextEncoder().encode(text);}
    else {
      const replacement=defaultChar?m.bytes(defaultChar,1)[0]:63;
      if(usedDefault)m.view(usedDefault,4);
      result=encodeANSI(text);let i=0;
      for(const character of text){if(decodeANSI(result.subarray(i,i+1))!==character){result[i]=replacement;used=true;}i++;}
    }
    rejectOverlap(input,bytes.length,out,Number(capacity));
    const length=output(out,capacity,result,false);if(usedDefault)m.writeU32(usedDefault,used?1:0);return length;
  });
  registerAW(w,'kernel32','ExpandEnvironmentStrings',3,(wide,input,out,size)=>{
    const text=m.string(input,wide).replace(/%([^%]+)%/g,(all,name)=>w.environment.get(name.toUpperCase())??all),needed=units(m,text,wide)+1;
    size=integer(size,0,Math.floor(m.maxBytes/(wide?2:1)));
    if(size>=needed){rejectOverlap(input,typeof input==='number'?m.size(input):0,out,size*(wide?2:1));putComplete(m,out,text,size,wide);}return needed;
  },{notes:'Single-pass expansion of process-private variables; unknown names are preserved. No host environment access.'});
}
