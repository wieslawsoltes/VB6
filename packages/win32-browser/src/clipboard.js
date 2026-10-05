import {Win32Error,unsigned} from './core.js';
/** Synchronous, app-private clipboard. System clipboard synchronization is explicit. */
export function installClipboard(w){
  const m=w.memory,h=w.handles;w.clipboard={open:false,owner:0,formats:new Map(),sequence:0};
  const c=w.clipboard,requireOpen=()=>{if(!c.open)throw new Win32Error('Clipboard is not open',1418);};
  const clear=()=>{for(const handle of c.formats.values()){if(h.has(handle,'memory')){const block=h.close(handle,'memory');m.free(block.ptr);}}c.formats.clear();};
  const add=(name,arity,fn)=>w.register('user32',name,fn,{arity,mode:'emulated',notes:'Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission.'});
  add('OpenClipboard',1,owner=>{if(owner)h.get(owner,'window');if(c.open)throw new Win32Error('Clipboard already open',5);c.open=true;c.pendingOwner=Number(owner);return 1;});
  add('CloseClipboard',0,()=>{requireOpen();c.open=false;return 1;});
  add('EmptyClipboard',0,()=>{requireOpen();clear();c.owner=c.pendingOwner;c.sequence++;return 1;});
  add('SetClipboardData',2,(format,handle)=>{requireOpen();format=unsigned(format);if(![1,13].includes(format))throw new Win32Error('Only text clipboard formats are implemented',50);if(!c.owner)throw new Win32Error('OpenClipboard needs a window owner before EmptyClipboard/SetClipboardData',5);const block=h.get(handle,'memory');if(block.prefix!=='Global'||block.clipboard||block.locks)throw new Win32Error('Clipboard requires unlocked moveable global memory',6);m.string(block.ptr,format===13);for(const old of new Set(c.formats.values())){const prior=h.close(old,'memory');m.free(prior.ptr);}c.formats.clear();block.clipboard=true;c.formats.set(format,Number(handle));c.sequence++;return handle;});
  const getData=format=>{requireOpen();format=unsigned(format);if(![1,13].includes(format))return 0;if(c.formats.has(format))return c.formats.get(format);const source=c.formats.entries().next().value;if(!source)return 0;const text=m.string(h.get(source[1],'memory').ptr,source[0]===13),p=m.allocString(text,format===13),handle=h.add('memory',{ptr:p,prefix:'Global',locks:0,clipboard:true});c.formats.set(format,handle);return handle;};
  add('GetClipboardData',1,getData);
  add('IsClipboardFormatAvailable',1,format=>[1,13].includes(Number(format))&&c.formats.size?1:0);
  add('CountClipboardFormats',0,()=>c.formats.size?2:0);
  add('EnumClipboardFormats',1,format=>{requireOpen();if(!c.formats.size)return 0;if(Number(format)===0)return 1;if(Number(format)===1)return 13;w.lastError=0;return 0;});
  add('GetClipboardOwner',0,()=>c.owner);
  add('GetOpenClipboardWindow',0,()=>c.open?c.pendingOwner:0);
  add('GetClipboardSequenceNumber',0,()=>c.sequence>>>0);
  w.getClipboardText=()=>{const first=c.formats.entries().next().value;return first?m.string(h.get(first[1],'memory').ptr,first[0]===13):'';};
  w.setClipboardText=text=>{if(c.open)throw new Win32Error('Clipboard already open',5);clear();if(text!==null){const ptr=m.allocString(String(text),true),handle=h.add('memory',{ptr,prefix:'Global',locks:0,clipboard:true});c.formats.set(13,handle);}c.sequence++;};
  // No automatic reads, writes, or permission prompts. Call from a user gesture.
  w.readSystemClipboard=async()=>{if(!w.options.allowClipboard||!w.options.clipboard?.readText)throw new Win32Error('System clipboard access is not enabled',5);const text=await w.options.clipboard.readText();if(w.disposed)throw new Win32Error('Disposed',995);w.setClipboardText(text);return text;};
  w.writeSystemClipboard=async()=>{if(!w.options.allowClipboard||!w.options.clipboard?.writeText)throw new Win32Error('System clipboard access is not enabled',5);return w.options.clipboard.writeText(w.getClipboardText());};
}
