import {keyboardTransaction} from './keyboard-transaction.js';
/** Browser-native MDI host. Each document owns a live editor/designer, not a bitmap. */
import {el} from '../core/core.js';
import {icon,showMenu} from './ui.js';
export function constrainWindow(rect,width,height,minWidth=220,minHeight=140){
  const maxW=Math.max(40,width-4),maxH=Math.max(40,height-4),w=Math.min(maxW,Math.max(Math.min(minWidth,maxW),Number(rect.width)||minWidth)),h=Math.min(maxH,Math.max(Math.min(minHeight,maxH),Number(rect.height)||minHeight));
  return {x:Math.round(Math.max(0,Math.min(width-w,Number(rect.x)||0))),y:Math.round(Math.max(0,Math.min(height-h,Number(rect.y)||0))),width:Math.round(w),height:Math.round(h)};
}
export class MdiHost {
  constructor(container,{onActivate,onClose,onChange}={}){
    this.onActivate=onActivate;this.onClose=onClose;this.onChange=onChange;this.windows=new Map();this.z=0;
    this.node=el('div',{class:'mdi-desktop','aria-label':'Document workspace'});container.prepend(this.node);
    this.observer=new ResizeObserver(()=>this.reflow());this.observer.observe(this.node);
  }
  add(key,title,content,{width=660,height=470,glyph='form',bounds}={}){
    if(this.windows.has(key))return this.windows.get(key);
    const i=this.windows.size,rect=bounds||{x:8+(i%7)*24,y:8+(i%7)*24,width,height};
    const node=el('section',{class:'mdi-window','data-mdi-key':key,'aria-label':title}),header=el('div',{class:'document-title',tabindex:0,'aria-label':title+' title bar'}),label=el('strong',{},title),sys=el('button',{class:'mdi-system-menu',title:'Window menu','aria-label':'Window menu'},icon(glyph));
    const win={key,node,header,label,content,rect,minimized:false,maximized:false};
    const commands=el('div',{class:'window-buttons'});win.minimize=el('button',{title:'Minimize document','aria-label':'Minimize document',onclick:()=>this.minimize(key)},icon('minimize'));win.maximize=el('button',{title:'Maximize document','aria-label':'Maximize document',onclick:()=>this.maximize(key)},icon('maximize'));win.close=el('button',{title:'Close current document','aria-label':'Close current document',onclick:()=>this.onClose?.(key)},icon('close'));const detach=el('button',{'data-browser-detach':'',disabled:this.browserWindows?.enabled===false,title:'Float in Browser Window','aria-label':'Float document in Browser Window',onclick:()=>this.detach?.(key)},'↗');commands.append(detach,win.minimize,win.maximize,win.close);header.append(sys,label,commands);
    const client=el('div',{class:'mdi-client'});client.append(content);node.append(header,client);win.client=client;
    for(const edge of ['n','s','e','w','nw','ne','sw','se']){const h=el('div',{class:'mdi-resize mdi-resize-'+edge,'data-edge':edge});node.append(h);this.bindDrag(win,h,edge);}
    this.bindDrag(win,header,'move');header.addEventListener('dblclick',e=>{if(!e.target.closest('button'))this.maximize(key);});
    sys.addEventListener('click',()=>{const r=sys.getBoundingClientRect();showMenu(this.systemMenu(win),r.left,r.bottom,null,{opener:sys,label:'Window menu'});});
    header.addEventListener('contextmenu',e=>{e.preventDefault();showMenu(this.systemMenu(win),e.clientX,e.clientY);});
    header.addEventListener('keydown',e=>{if(e.altKey&&e.key===' '){e.preventDefault();sys.click();}else if(e.key==='Enter'&&!win.keyboardMode)this.maximize(key);});
    node.addEventListener('pointerdown',()=>this.activate(key),true);node.addEventListener('focusin',()=>this.activate(key));
    this.windows.set(key,win);this.node.append(node);this.layout(win);return win;
  }
  systemMenu(win){if(this.browserWindows?.has('document:'+win.key))return [{label:'Return to IDE',action:()=>this.browserWindows.attach('document:'+win.key)},null,{label:'&Close Document',action:()=>this.onClose?.(win.key)}];return [{label:'Float in Browser Window',enabled:this.browserWindows?.enabled!==false,action:()=>this.detach?.(win.key)},null,{label:'&Restore',enabled:win.maximized||win.minimized,action:()=>this.restore(win.key)},{label:'&Move',enabled:!win.maximized,action:()=>this.keyboardBounds(win,'move')},{label:'&Size',enabled:!win.maximized&&!win.minimized,action:()=>this.keyboardBounds(win,'size')},{label:'Mi&nimize',enabled:!win.minimized,action:()=>this.minimize(win.key)},{label:'Ma&ximize',enabled:!win.maximized,action:()=>this.maximize(win.key)},null,{label:'&Close',shortcut:'Ctrl+F4',action:()=>this.onClose?.(win.key)}];}
  activate(key,notify=true){const win=this.windows.get(key);if(!win)return;if(this.active===key)return;this.browserWindows?.focus('document:'+key);this.active=key;this.windows.forEach(w=>{w.node.classList.toggle('mdi-active',w===win);w.header.setAttribute('aria-current',String(w===win));});win.node.style.zIndex=String(++this.z);if(notify)this.onActivate?.(key);}
  layout(win){
    if(this.browserWindows?.has('document:'+win.key))return;
    const {clientWidth:w,clientHeight:h}=this.node;if(w<40||h<40)return;
    let r;if(win.maximized)r={x:0,y:0,width:w,height:h};else if(win.minimized){const i=[...this.windows.values()].filter(v=>v.minimized).indexOf(win);r={x:(i%Math.max(1,Math.floor(w/170)))*170,y:Math.max(0,h-26-Math.floor(i/Math.max(1,Math.floor(w/170)))*26),width:Math.min(168,w),height:24};}else{win.rect=constrainWindow(win.rect,w,h,win.tiled?40:220,win.tiled?40:140);r=win.rect;}
    Object.assign(win.node.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});win.node.classList.toggle('mdi-minimized',win.minimized);win.node.classList.toggle('mdi-maximized',win.maximized);
    win.maximize.replaceChildren(icon(win.maximized?'restore':'maximize'));win.maximize.title=win.maximized?'Restore document':'Maximize document';win.maximize.setAttribute('aria-label',win.maximize.title);
    win.minimize.replaceChildren(icon(win.minimized?'restore':'minimize'));win.minimize.title=win.minimized?'Restore document':'Minimize document';win.minimize.setAttribute('aria-label',win.minimize.title);
  }
  reflow(){for(const win of this.windows.values())this.layout(win);}
  restore(key){if(this.browserWindows?.has('document:'+key))return;const win=this.windows.get(key);if(!win)return;win.minimized=win.maximized=false;win.tiled=false;this.layout(win);this.activate(key);this.onChange?.();}
  minimize(key){if(this.browserWindows?.has('document:'+key))return;const win=this.windows.get(key);if(!win)return;if(win.minimized){this.restore(key);return;}win.minimized=true;win.maximized=false;this.layout(win);this.onChange?.();}
  maximize(key){if(this.browserWindows?.has('document:'+key))return;const win=this.windows.get(key);if(!win)return;win.maximized=!win.maximized;win.minimized=false;this.layout(win);this.activate(key);this.onChange?.();}
  remove(key){this.cancelInteraction?.();this.browserWindows?.attach('document:'+key,'remove');this.browserWindows?.pending.delete('document:'+key);const win=this.windows.get(key);win?.node.remove();this.windows.delete(key);if(this.active===key)this.active=null;this.reflow();}
  clear(){this.cancelInteraction?.();for(const key of this.windows.keys()){this.browserWindows?.attach('document:'+key,'remove');this.browserWindows?.pending.delete('document:'+key);}this.windows.forEach(w=>w.node.remove());this.windows.clear();this.active=null;}
  arrange(mode='cascade'){
    const all=[...this.windows.values()].filter(w=>!w.minimized&&!this.browserWindows?.has('document:'+w.key)),w=this.node.clientWidth,h=this.node.clientHeight,n=all.length;if(!n)return;
    const active=this.active;
    all.forEach((win,i)=>{win.maximized=false;win.tiled=mode!=='cascade';if(mode==='cascade')win.rect={x:8+(i%7)*24,y:8+(i%7)*24,width:Math.max(280,w-40-Math.min(6,n-1)*24),height:Math.max(180,h-40-Math.min(6,n-1)*24)};else if(mode==='horizontal')win.rect={x:0,y:Math.floor(h*i/n),width:w,height:Math.floor(h*(i+1)/n)-Math.floor(h*i/n)};else win.rect={x:Math.floor(w*i/n),y:0,width:Math.floor(w*(i+1)/n)-Math.floor(w*i/n),height:h};this.layout(win);win.node.style.zIndex=String(++this.z);});
    if(active){this.active=null;this.activate(active,false);}this.onChange?.();
  }
  cycle(direction=1){const keys=[...this.windows.keys()];if(keys.length){const key=keys[(keys.indexOf(this.active)+direction+keys.length)%keys.length];if(this.windows.get(key).minimized)this.restore(key);this.activate(key);this.windows.get(key).header.focus();}}
  bindDrag(win,handle,edge){
    handle.style.touchAction='none';handle.addEventListener('pointerdown',e=>{
      if(this.browserWindows?.has('document:'+win.key)||e.button!==0||e.target.closest('button')||win.maximized||win.minimized)return;e.preventDefault();this.activate(win.key);
      this.cancelInteraction?.();const before={...win.rect},oldTiled=win.tiled,x=e.clientX,y=e.clientY;win.tiled=false;let finished=false;handle.setPointerCapture(e.pointerId);win.node.classList.add('mdi-interacting');
      const move=event=>{const dx=event.clientX-x,dy=event.clientY-y,r={...before};if(edge==='move'){r.x+=dx;r.y+=dy;}else{if(edge.includes('e'))r.width+=dx;if(edge.includes('s'))r.height+=dy;if(edge.includes('w')){r.x+=dx;r.width-=dx;}if(edge.includes('n')){r.y+=dy;r.height-=dy;}}win.rect=r;this.layout(win);};
      const finish=event=>{if(finished)return;finished=true;if(event?.type==='pointercancel'||event?.type==='lostpointercapture'||event?.type==='blur'||event?.type==='keydown'||!event){win.rect=before;win.tiled=oldTiled;this.layout(win);}handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',finish);handle.removeEventListener('pointercancel',finish);handle.removeEventListener('lostpointercapture',finish);window.removeEventListener('keydown',abort,true);window.removeEventListener('blur',abort);if(this.cancelInteraction===abort)this.cancelInteraction=null;win.node.classList.remove('mdi-interacting');if(handle.hasPointerCapture(e.pointerId))handle.releasePointerCapture(e.pointerId);this.onChange?.();};
      const abort=event=>{if(event?.type==='keydown'&&event.key!=='Escape')return;if(event?.type==='keydown'){event.preventDefault();event.stopImmediatePropagation();}finish(event);};this.cancelInteraction=abort;window.addEventListener('keydown',abort,true);window.addEventListener('blur',abort);
      handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',finish);handle.addEventListener('pointercancel',finish);handle.addEventListener('lostpointercapture',finish);
    });
  }
  keyboardBounds(win,mode){
    const before={...win.rect};win.keyboardMode=true;win.header.focus();win.node.classList.add('mdi-interacting');
    const finish=()=>{win.keyboardMode=false;win.node.classList.remove('mdi-interacting');this.layout(win);this.onChange?.();};
    keyboardTransaction(this,{step:(dx,dy)=>{if(mode==='move'){win.rect.x+=dx;win.rect.y+=dy;}else{win.rect.width+=dx;win.rect.height+=dy;}this.layout(win);},commit:finish,cancel:()=>{win.rect=before;finish();}});
  }
  snapshot(){return [...this.windows.values()].map(w=>({key:w.key,rect:{...w.rect},minimized:w.minimized,maximized:w.maximized,tiled:!!w.tiled}));}
  restoreSnapshot(states){for(const state of states||[]){const win=this.windows.get(state.key);if(!win)continue;if(state.rect&&Object.values(state.rect).every(v=>Number.isFinite(v)))win.rect=state.rect;win.tiled=!!state.tiled;win.minimized=!!state.minimized;win.maximized=!!state.maximized&&!win.minimized;this.layout(win);}}
  dispose(){this.observer.disconnect();this.clear();this.node.remove();}
}
