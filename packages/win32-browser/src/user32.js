import {Win32Error,integer,unsigned} from './core.js';

/** Registered windows only: never queries or controls unrelated page DOM. */
export function installUser32(w){
  const m=w.memory,h=w.handles;
  const add=(name,arity,fn,options={})=>w.register('user32',name,fn,{arity,mode:'browser',...options});
  const aw=(name,arity,fn,options={})=>{for(const wide of [false,true])add(name+(wide?'W':'A'),arity,(...args)=>fn(wide,...args),options);};
  const win=handle=>{if(!h.has(handle,'window'))throw new Win32Error('Invalid window handle',1400);return h.get(handle,'window');};
  const parent=entry=>Number(typeof entry.parent==='function'?entry.parent():entry.parent??0);
  const rect=entry=>{const r=entry.getRect?.()??entry.node?.getBoundingClientRect?.();if(!r)throw new Win32Error('Window has no geometry',50);return [r.left,r.top,r.right??r.left+r.width,r.bottom??r.top+r.height].map(Math.round);};
  const client=entry=>{const r=entry.getClientRect?.();if(r)return [r.left??0,r.top??0,r.right??r.width,r.bottom??r.height].map(Math.round);const n=entry.input||entry.node;return [0,0,n?.clientWidth||0,n?.clientHeight||0];};
  const writeRect=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));return 1;};
  const getText=entry=>String(entry.getText?.()??entry.input?.value??entry.node?.textContent??'');
  const setText=(entry,s)=>{if(entry.setText)entry.setText(s);else if(entry.input)entry.input.value=s;else if(entry.node)entry.node.textContent=s;else throw new Win32Error('Window text is not writable',50);return 1;};
  const visible=entry=>entry.isVisible?!!entry.isVisible():!entry.node?.hidden;
  const enabled=entry=>entry.isEnabled?!!entry.isEnabled():!entry.input?.disabled;
  add('IsWindow',1,handle=>h.has(handle,'window')?1:0);
  add('IsWindowVisible',1,handle=>{let entry=win(handle),seen=new Set();while(entry){if(seen.has(entry)||!visible(entry))return 0;seen.add(entry);const p=parent(entry);entry=p?win(p):null;}return 1;});
  add('IsWindowEnabled',1,handle=>enabled(win(handle))?1:0);
  add('EnableWindow',2,(handle,on)=>{const entry=win(handle),wasDisabled=!enabled(entry);if(entry.setEnabled)entry.setEnabled(!!on);else if(entry.input)entry.input.disabled=!on;else throw new Win32Error('Window enabled state is not writable',50);return wasDisabled?1:0;});
  add('ShowWindow',2,(handle,command)=>{const entry=win(handle);command=integer(command,0,11);const was=visible(entry);if(entry.show)entry.show(command);else if([0,1,5,8,9].includes(command)&&entry.node)entry.node.hidden=command===0;else throw new Win32Error('Show command needs a window adapter',50);return was?1:0;});
  aw('GetWindowText',3,(wide,handle,out,n)=>m.putString(out,getText(win(handle)),n,wide));
  aw('SetWindowText',2,(wide,handle,p)=>setText(win(handle),m.string(p,wide)));
  aw('GetWindowTextLength',1,(wide,handle)=>m.stringBytes(getText(win(handle)),wide).length/(wide?2:1));
  aw('GetClassName',3,(wide,handle,out,n)=>m.putString(out,win(handle).className||'Window',n,wide));
  const find=(wide,parentHandle,after,klass,title,topOnly)=>{if(parentHandle)win(parentHandle);if(after)win(after);let passed=!after;for(const [id,e]of h.entries){if(e.type!=='window')continue;if(!passed){if(id===Number(after))passed=true;continue;}const entry=e.value,p=parent(entry);if(topOnly?p!==0:p!==Number(parentHandle))continue;if(klass&&String(entry.className||'Window').toLowerCase()!==m.string(klass,wide).toLowerCase())continue;if(title&&getText(entry).toLowerCase()!==m.string(title,wide).toLowerCase())continue;return id;}return 0;};
  aw('FindWindow',2,(wide,klass,title)=>find(wide,0,0,klass,title,true));
  aw('FindWindowEx',4,(wide,p,after,klass,title)=>find(wide,p,after,klass,title,false));
  add('GetParent',1,handle=>parent(win(handle)));
  add('IsChild',2,(ancestor,handle)=>{win(ancestor);let p=parent(win(handle)),seen=new Set();while(p&&!seen.has(p)){if(p===Number(ancestor))return 1;seen.add(p);p=parent(win(p));}return 0;});
  add('GetDlgCtrlID',1,handle=>win(handle).controlId||0);
  add('GetDlgItem',2,(handle,id)=>{win(handle);for(const [key,e]of h.entries)if(e.type==='window'&&parent(e.value)===Number(handle)&&e.value.controlId===Number(id))return key;return 0;});
  add('GetWindowRect',2,(handle,p)=>writeRect(p,rect(win(handle))));
  add('GetClientRect',2,(handle,p)=>writeRect(p,client(win(handle))));
  for(const screen of [false,true])add(screen?'ClientToScreen':'ScreenToClient',2,(handle,p)=>{const entry=win(handle),origin=entry.clientOrigin?.()||rect(entry).slice(0,2),v=m.view(p,8),sign=screen?1:-1;v.setInt32(0,v.getInt32(0,true)+origin[0]*sign,true);v.setInt32(4,v.getInt32(4,true)+origin[1]*sign,true);return 1;});
  const move=(entry,x,y,width,height,repaint)=>{for(const n of [x,y,width,height])integer(n,-2147483648,2147483647);if(width<0||height<0)throw new Win32Error('Negative window size');if(entry.move)entry.move(x,y,width,height,!!repaint);else if(entry.node)Object.assign(entry.node.style,{position:'absolute',left:x+'px',top:y+'px',width:width+'px',height:height+'px'});else throw new Win32Error('Window cannot move',50);return 1;};
  add('MoveWindow',6,(handle,x,y,width,height,repaint)=>move(win(handle),x,y,width,height,repaint));
  add('SetWindowPos',7,(handle,after,x,y,width,height,flags)=>{const entry=win(handle);flags=unsigned(flags);if(flags&~0xdf)throw new Win32Error('Unsupported positioning flags',50);if(!(flags&4)&&![0,1,-1,-2,0xffffffff,0xfffffffe].includes(Number(after)))throw new Win32Error('Arbitrary sibling ordering is not supported',50);const r=entry.getPosition?.()||rect(entry);if(flags&2){x=r[0];y=r[1];}if(flags&1){width=r[2]-r[0];height=r[3]-r[1];}move(entry,x,y,width,height,!(flags&8));if(!(flags&4)&&entry.node)entry.node.style.zIndex=[-1,0xffffffff].includes(Number(after))?'10000':Number(after)===1?'0':'';if(flags&0x40)w.invoke('user32','ShowWindow',[handle,5]);if(flags&0x80)w.invoke('user32','ShowWindow',[handle,0]);return 1;},{notes:'App-local position and CSS stacking; no desktop topmost guarantee.'});
  add('GetFocus',0,()=>{for(const [id,e]of h.entries)if(e.type==='window'){const n=e.value.input||e.value.node;if(n&&n.ownerDocument?.activeElement===n)return id;}return 0;});
  add('SetFocus',1,handle=>{const prior=w.invoke('user32','GetFocus',[]);if(!handle){for(const e of h.entries.values())if(e.type==='window')e.value.input?.blur?.();return prior;}const entry=win(handle);if(!enabled(entry))throw new Win32Error('Window is disabled',5);const node=entry.input||entry.node;if(!node?.focus)throw new Win32Error('Focus not supported',50);node.focus();return prior;});
  add('GetForegroundWindow',0,()=>{let handle=w.invoke('user32','GetFocus',[]);while(handle&&parent(win(handle)))handle=parent(win(handle));return handle;});
  add('SetForegroundWindow',1,handle=>{const entry=win(handle);if(entry.activate)entry.activate();else (entry.input||entry.node)?.focus?.();return 1;},{notes:'Activates only an app-local window, not the OS browser window.'});
  aw('GetWindowLong',2,(wide,handle,index)=>{const e=win(handle);if(![-16,-20,-21,-12].includes(Number(index)))throw new Win32Error('Window procedure/instance addresses are unavailable',50);if([-16,-20].includes(Number(index))&&!e.longs?.has(Number(index)))throw new Win32Error('Window style values need an explicit adapter',50);return Number(index)===-12?e.controlId||0:(e.longs?.get(Number(index))||0);});
  aw('SetWindowLong',3,(wide,handle,index,value)=>{const e=win(handle);if(![-21,-12].includes(Number(index)))throw new Win32Error('Only user data and control IDs are writable; subclassing is unsupported',50);const old=Number(index)===-12?e.controlId||0:e.longs?.get(Number(index))||0;if(Number(index)===-12)e.controlId=Number(value);else{e.longs||=new Map();e.longs.set(Number(index),Number(value)|0);}w.lastError=0;return old;});
  add('GetSystemMetrics',1,index=>{const view=w.options.window||globalThis.window;const metrics={0:view?.innerWidth??1024,1:view?.innerHeight??768,5:1,6:1,16:view?.innerWidth??1024,17:view?.innerHeight??768,19:1,43:3,78:view?.innerWidth??1024,79:view?.innerHeight??768,80:1};if(!(index in metrics))throw new Win32Error('System metric is not implemented',50);return metrics[index];},{notes:'CSS-pixel app viewport metrics, not physical desktop measurements.'});
  aw('MessageBox',4,(wide,handle,message,title,type)=>{if(handle)win(handle);if(!w.options.messageBox)throw new Win32Error('Message box adapter unavailable',50);return w.options.messageBox(m.string(message,wide),unsigned(type),m.string(title,wide));});
  aw('SendMessage',4,async(wide,handle,msg,wp,lp)=>{
    const e=win(handle);msg=unsigned(msg);
    if(msg===12)return setText(e,m.string(lp,wide));
    if(msg===13)return m.putString(lp,getText(e),wp,wide);
    if(msg===14)return m.stringBytes(getText(e),wide).length/(wide?2:1);
    if(msg===0xb0){const start=e.input?.selectionStart??0,end=e.input?.selectionEnd??0;if(wp)m.writeU32(wp,start);if(lp)m.writeU32(lp,end);return start>65535||end>65535?-1:(end<<16)|start;}
    if(msg===0xb1){if(!e.input?.setSelectionRange)throw new Win32Error('Not an edit control',50);let start=Number(wp)|0,end=Number(lp)|0;if(start===-1)start=end=e.input.selectionEnd??0;else if(end===-1)end=getText(e).length;e.input.setSelectionRange(start,end);return 0;}
    if(msg===0xc2){if(!e.input?.setSelectionRange)throw new Win32Error('Not an edit control',50);const value=getText(e),start=e.input.selectionStart??0,end=e.input.selectionEnd??0,replacement=m.string(lp,wide);setText(e,value.slice(0,start)+replacement+value.slice(end));e.input.setSelectionRange(start+replacement.length,start+replacement.length);return 0;}
    if(msg===0xf0){if(!e.getCheck)throw new Win32Error('Not a checkable button',50);return e.getCheck();}
    if(msg===0xf1){if(!e.setCheck)throw new Win32Error('Not a checkable button',50);e.setCheck(integer(wp,0,2));return 0;}
    if(msg===0xf5){if(e.click)await e.click();else if(e.input?.click)e.input.click();else throw new Win32Error('Not a button',50);return 0;}
    if(e.message){const result=await e.message(msg,wp,lp,wide);if(result!==undefined)return result;}
    throw new Win32Error('Window message '+msg+' is not implemented',50);
  },{notes:'WM text, edit selection/replacement and button check/click messages; unknown messages fail explicitly.'});
  add('EnumWindows',2,async(callback,data)=>{const fn=h.get(callback,'callback');for(const [id,e]of [...h.entries])if(e.type==='window'&&!parent(e.value)&&h.has(id,'window'))if(!await fn(id,data))return 0;return 1;});
  add('SetTimer',4,(handle,id,ms,callback)=>{if(handle)win(handle);if(!callback)throw new Win32Error('WM_TIMER message queue is not implemented; supply a callback',50);h.get(callback,'callback');id=handle&&id?unsigned(id):w.nextTimer++;const key=handle+':'+id;if(w.timers.has(key))clearInterval(w.timers.get(key).timer);if(w.timers.size>=1024)throw new Win32Error('Timer quota exceeded',8);const state={handle,id,callback,busy:false,timer:null};state.timer=setInterval(async()=>{if(state.busy||w.disposed)return;state.busy=true;try{await (w.timerCallbacks.get(callback)||h.get(callback,'callback'))(handle,0x113,id,Math.floor(w.clock()-w.epoch)>>>0);}catch(error){w.options.onError?.(error);}finally{state.busy=false;}},Math.max(10,Math.min(unsigned(ms),0x7fffffff)));w.timers.set(key,state);return id;},{notes:'Browser timers are throttled in background tabs; callbacks are coalesced.'});
  add('KillTimer',2,(handle,id)=>{const key=handle+':'+unsigned(id),state=w.timers.get(key);if(!state)return 0;clearInterval(state.timer);w.timers.delete(key);return 1;});
  installRectangles(w,add);
}
function installRectangles(w,add){
  const m=w.memory,read=p=>{const v=m.view(p,16);return [0,4,8,12].map(i=>v.getInt32(i,true));},write=(p,r)=>{const v=m.view(p,16);r.forEach((n,i)=>v.setInt32(i*4,n,true));return 1;},empty=r=>r[0]>=r[2]||r[1]>=r[3];
  add('SetRect',5,(p,l,t,r,b)=>write(p,[l,t,r,b]),{mode:'emulated'});
  add('SetRectEmpty',1,p=>write(p,[0,0,0,0]),{mode:'emulated'});
  add('CopyRect',2,(a,b)=>write(a,read(b)),{mode:'emulated'});
  add('OffsetRect',3,(p,x,y)=>write(p,read(p).map((v,i)=>v+Number(i%2?y:x))),{mode:'emulated'});
  add('InflateRect',3,(p,x,y)=>write(p,read(p).map((v,i)=>v+Number(i%2?y:x)*(i<2?-1:1))),{mode:'emulated'});
  add('IsRectEmpty',1,p=>empty(read(p))?1:0,{mode:'emulated'});
  add('EqualRect',2,(a,b)=>{const x=read(a),y=read(b);return x.every((v,i)=>v===y[i])?1:0;},{mode:'emulated'});
  add('PtInRect',3,(p,x,y)=>{const r=read(p);return x>=r[0]&&x<r[2]&&y>=r[1]&&y<r[3]?1:0;},{mode:'emulated',notes:'POINT is passed by value as two 32-bit arguments.'});
  add('IntersectRect',3,(p,a,b)=>{const x=read(a),y=read(b),r=[Math.max(x[0],y[0]),Math.max(x[1],y[1]),Math.min(x[2],y[2]),Math.min(x[3],y[3])],none=empty(r);write(p,none?[0,0,0,0]:r);return none?0:1;},{mode:'emulated'});
  add('UnionRect',3,(p,a,b)=>{const x=read(a),y=read(b),r=empty(x)?y:empty(y)?x:[Math.min(x[0],y[0]),Math.min(x[1],y[1]),Math.max(x[2],y[2]),Math.max(x[3],y[3])],none=empty(r);write(p,none?[0,0,0,0]:r);return none?0:1;},{mode:'emulated'});
}
