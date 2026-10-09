import {UIError} from './safety.js';

export const DISPLAY_MODES=Object.freeze(['inline','fullscreen','pip']);
/** Floating PiP is an in-window overlay, not an OS always-on-top promise.
 * Keep the iframe connected: reparenting a live iframe would reload its app.
 */
export class AppDisplayController {
  constructor(root,frame,{onChange=()=>{},available=DISPLAY_MODES}={}){
    if(!Array.isArray(available)||!available.includes('inline')||available.some(v=>!DISPLAY_MODES.includes(v)))throw new UIError('display','Invalid host display modes.');
    this.root=root;this.frame=frame;this.available=[...new Set(available)];this.onChange=onChange;this.mode='inline';this.supported=['inline'];this.disposed=false;
    this.doc=root.ownerDocument;this.win=this.doc.defaultView;
    this.escape=e=>{if(e.key==='Escape'&&this.mode!=='inline'){e.preventDefault();this.set('inline');}};
    this.win.addEventListener('keydown',this.escape);
    this.resize=()=>{if(this.mode==='pip')this.clamp();};this.win.addEventListener('resize',this.resize);
  }
  negotiate(modes){
    if(modes!==undefined&&(!Array.isArray(modes)||modes.length>3||modes.some(v=>!DISPLAY_MODES.includes(v))))throw new UIError('display','Invalid app display modes.');
    this.supported=modes===undefined?['inline']:[...new Set(['inline',...modes])];
    return this.available.filter(v=>this.supported.includes(v));
  }
  set(mode){
    if(this.disposed)throw new UIError('disposed','App display is closed.');
    if(!DISPLAY_MODES.includes(mode))throw new UIError('display','Unknown display mode.');
    if(!this.available.includes(mode)||!this.supported.includes(mode))return this.mode;
    if(mode===this.mode)return this.mode;
    const previous=this.mode;
    if(mode==='inline'){
      this.endDrag();this.bar?.remove();this.bar=null;
      if(this.popover){try{this.root.hidePopover();}catch{}this.root.removeAttribute('popover');this.popover=false;}
      if(this.savedStyle===null)this.root.removeAttribute?.('style');else if(this.savedStyle!==undefined)this.root.setAttribute('style',this.savedStyle);
      this.root.classList.remove('iui-app-floating','iui-app-pip','iui-app-fullscreen');
      this.frame.style.height=this.inlineHeight||'400px';this.frame.style.flex='';
      this.returnFocus?.focus?.({preventScroll:true});this.returnFocus=null;
    }else{
      if(previous==='inline'){
        this.savedStyle=this.root.getAttribute?.('style')??null;this.inlineHeight=this.frame.style.height;this.returnFocus=this.doc.activeElement;
        this.root.classList.add?.('iui-app-floating');
        // The top layer escapes ancestor MDI transforms and clipping without a DOM move.
        if(this.root.showPopover&&!this.root.hasAttribute('popover')){
          this.root.setAttribute('popover','manual');try{this.root.showPopover();this.popover=true;}catch{this.root.removeAttribute('popover');}
        }
        this.createBar();
      }
      this.root.classList.toggle('iui-app-pip',mode==='pip');this.root.classList.toggle('iui-app-fullscreen',mode==='fullscreen');
      Object.assign(this.root.style,{position:'fixed',inset:'auto',margin:'0',padding:'8px',boxSizing:'border-box',zIndex:'2147483000',display:'flex',flexDirection:'column',background:'var(--vb-face, #c0c0c0)',color:'var(--vb-window-text, #111)',border:'2px solid var(--vb-shadow, #808080)',overflow:'auto'});
      const width=this.win.innerWidth||1024,height=this.win.innerHeight||768;
      if(mode==='pip')Object.assign(this.root.style,{left:Math.max(0,width-500)+'px',top:Math.max(0,height-400)+'px',width:Math.min(480,width)+'px',height:Math.min(360,height)+'px',maxWidth:'100vw',maxHeight:'100vh',resize:'both'});
      else Object.assign(this.root.style,{left:'0px',top:'0px',width:'100vw',height:'100vh',maxWidth:'100vw',maxHeight:'100vh',resize:'none'});
      this.frame.style.height='100%';this.frame.style.flex='1 1 auto';this.back.focus?.({preventScroll:true});
    }
    this.mode=mode;this.onChange(mode);return mode;
  }
  createBar(){
    this.bar=this.doc.createElement('div');this.bar.className='iui-app-display-bar';
    this.move=this.doc.createElement('button');this.move.type='button';this.move.textContent='Move app';this.move.setAttribute('aria-label','Move floating app with arrow keys or drag');this.move.style.touchAction='none';
    this.back=this.doc.createElement('button');this.back.type='button';this.back.textContent='Return app inline';this.back.onclick=()=>this.set('inline');
    this.move.onkeydown=e=>{if(this.mode!=='pip'||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();const d=e.shiftKey?40:10;this.translate(e.key==='ArrowLeft'?-d:e.key==='ArrowRight'?d:0,e.key==='ArrowUp'?-d:e.key==='ArrowDown'?d:0);};
    this.move.onpointerdown=e=>{
      if(this.mode!=='pip'||e.button!==0)return;e.preventDefault();this.endDrag();let x=e.clientX,y=e.clientY;
      const move=next=>{this.translate(next.clientX-x,next.clientY-y);x=next.clientX;y=next.clientY;};
      this.move.setPointerCapture?.(e.pointerId);
      this.move.addEventListener('pointermove',move);
      const end=()=>{this.move?.removeEventListener('pointermove',move);this.move?.removeEventListener('pointerup',end);this.move?.removeEventListener('pointercancel',end);try{this.move?.releasePointerCapture?.(e.pointerId);}catch{}};
      this.endDrag=end;this.move.addEventListener('pointerup',end,{once:true});this.move.addEventListener('pointercancel',end,{once:true});
    };
    this.bar.append(this.move,this.back);this.root.prepend(this.bar);
  }
  endDrag(){}
  translate(x,y){this.root.style.left=((parseFloat(this.root.style.left)||0)+x)+'px';this.root.style.top=((parseFloat(this.root.style.top)||0)+y)+'px';this.clamp();}
  clamp(){const r=this.root.getBoundingClientRect?.();if(!r)return;this.root.style.left=Math.max(0,Math.min(parseFloat(this.root.style.left)||0,(this.win.innerWidth||1024)-Math.min(r.width,this.win.innerWidth||1024)))+'px';this.root.style.top=Math.max(0,Math.min(parseFloat(this.root.style.top)||0,(this.win.innerHeight||768)-Math.min(r.height,this.win.innerHeight||768)))+'px';}
  dispose(){if(this.disposed)return;this.set('inline');this.disposed=true;this.win.removeEventListener('keydown',this.escape);this.win.removeEventListener('resize',this.resize);this.endDrag();}
}
