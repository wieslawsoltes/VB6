import {el} from '../core/core.js';
import {getTheme} from './theme.js';
import {bindApplicationTheme} from './application-appearance.js';

// Legacy IDE menus and color pickers carry an application palette attribute,
// but their chrome belongs to the IDE. Every other local palette is an authored
// application/preview boundary and must keep that palette after portaling.
function applicationTooltip(target) {
  const owner=target.closest('[data-vb-theme]');
  if(!owner||owner.matches('.classic-menu:not(.runtime-popup),.property-color-popup'))return false;
  return owner!==target.ownerDocument.documentElement||!owner.hasAttribute('data-ide-theme');
}
/** Delegated tooltips: system-color palette, no browser-native balloon or event listener per tool. */
export class ClassicTooltips {
  constructor(root,{enabled=()=>true,delay=650}={}){this.root=root;this.enabled=enabled;this.delay=delay;this.abort=new AbortController();const options={capture:true,signal:this.abort.signal};root.addEventListener('pointerover',e=>this.enter(e),options);root.addEventListener('pointerout',e=>{if(this.target&&!this.target.contains(e.relatedTarget))this.hide();},options);root.addEventListener('pointerdown',()=>this.hide(),options);root.addEventListener('keydown',()=>this.hide(),options);root.ownerDocument.defaultView.addEventListener('blur',()=>this.hide(),{signal:this.abort.signal});root.addEventListener('scroll',()=>this.hide(),options);}
  enter(e) {
    const target=e.target.closest('[title],[data-classic-tooltip]');
    if(!target||!this.root.contains(target)||target===this.target)return;
    this.hide();this.target=target;
    const title=target.getAttribute('title')||target.dataset.classicTooltip;
    if(!title)return;
    target.dataset.classicTooltip=title;target.removeAttribute('title');
    if(!this.enabled())return;
    const x=e.clientX,y=e.clientY;
    this.timer=setTimeout(()=>{
      if(!target.isConnected||!this.enabled())return;
      const node=el('div',{class:'classic-tooltip'+(applicationTooltip(target)?' runtime-tooltip':''),role:'tooltip','data-vb-theme':getTheme(target).id},title);
      this.releaseTheme=bindApplicationTheme(target,node);
      const view=target.ownerDocument.defaultView;
      target.ownerDocument.body.append(node);
      node.style.left=Math.max(2,Math.min(view.innerWidth-node.offsetWidth-2,x+12))+'px';
      node.style.top=Math.max(2,Math.min(view.innerHeight-node.offsetHeight-2,y+20))+'px';
      this.node=node;
    },this.delay);
  }
  hide(){clearTimeout(this.timer);this.releaseTheme?.();this.releaseTheme=null;this.node?.remove();this.node=null;if(this.target?.dataset.classicTooltip){this.target.setAttribute('title',this.target.dataset.classicTooltip);delete this.target.dataset.classicTooltip;}this.target=null;}
  dispose(){this.hide();this.abort.abort();}
}
