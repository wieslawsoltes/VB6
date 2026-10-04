import {el} from '../core/core.js';
import {icon} from '../theme/icons.js';
const GLYPHS={'◇':'method','▣':'property','•':'constant','◆':'class','ϟ':'event','▤':'module'};
/** Fixed-row listbox used by modeless tools. DOM cost depends on viewport, not item count. */
let nextListId=0;
export class ToolList {
  constructor(label,onSelect,onOpen){
    this.id='tool-list-'+(++nextListId);this.items=[];this.selected=-1;this.rowHeight=19;this.onSelect=onSelect;this.onOpen=onOpen;
    this.root=el('div',{class:'tool-list',role:'listbox',tabindex:0,'aria-label':label});this.spacer=el('div',{class:'tool-list-spacer'});this.layer=el('div',{class:'tool-list-layer'});this.root.append(this.spacer,this.layer);this.root.addEventListener('scroll',()=>this.paint());
    this.root.addEventListener('click',e=>{const i=e.target.closest('[data-index]')?.dataset.index;if(i!==undefined)this.select(Number(i));});
    this.root.addEventListener('dblclick',()=>this.onOpen?.(this.items[this.selected]));
    this.root.addEventListener('keydown',e=>{const moves={ArrowDown:1,ArrowUp:-1,PageDown:Math.max(1,Math.floor(this.root.clientHeight/this.rowHeight)-1),PageUp:-Math.max(1,Math.floor(this.root.clientHeight/this.rowHeight)-1)};let next;
      if(moves[e.key])next=this.selected+moves[e.key];else if(e.key==='Home')next=0;else if(e.key==='End')next=this.items.length-1;
      else if(e.key==='Enter'){e.preventDefault();this.onOpen?.(this.items[this.selected]);return;}
      else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){const now=performance.now();this.prefix=(now-(this.prefixTime||0)<900?this.prefix||'':'')+e.key.toLowerCase();this.prefixTime=now;const found=this.items.findIndex(i=>i.label.toLowerCase().startsWith(this.prefix));if(found>=0)next=found;}
      if(next!==undefined){e.preventDefault();this.select(next);}
    });this.observer=new ResizeObserver(()=>this.paint());this.observer.observe(this.root);
  }
  set(items,key){this.items=items;this.spacer.style.height=items.length*this.rowHeight+'px';this.selected=key?items.findIndex(i=>i.key===key):0;if(this.selected<0&&items.length)this.selected=0;this.root.scrollTop=0;this.paint();this.onSelect?.(items[this.selected]);}
  select(index,notify=true){if(!this.items.length)return;this.selected=Math.max(0,Math.min(this.items.length-1,index));const top=this.selected*this.rowHeight;if(top<this.root.scrollTop)this.root.scrollTop=top;else if(top+this.rowHeight>this.root.scrollTop+this.root.clientHeight)this.root.scrollTop=top-this.root.clientHeight+this.rowHeight;this.paint();if(notify)this.onSelect?.(this.items[this.selected]);}
  paint(){const start=Math.max(0,Math.floor(this.root.scrollTop/this.rowHeight)-2),end=Math.min(this.items.length,start+Math.ceil((this.root.clientHeight||190)/this.rowHeight)+5),nodes=[];
    for(let i=start;i<end;i++){const item=this.items[i];nodes.push(el('div',{class:'tool-list-row'+(i===this.selected?' selected':''),id:this.id+'-'+i,role:'option','aria-selected':i===this.selected,'aria-posinset':i+1,'aria-setsize':this.items.length,'data-index':i,style:{top:i*this.rowHeight+'px'},title:item.label},el('span',{class:'member-kind','aria-hidden':'true'},icon(GLYPHS[item.glyph]||'property',16)),el('span',{class:'tool-list-label'},item.label)));}
    this.layer.replaceChildren(...nodes);if(this.selected>=start&&this.selected<end)this.root.setAttribute('aria-activedescendant',this.id+'-'+this.selected);else this.root.removeAttribute('aria-activedescendant');this.root.setAttribute('aria-label',this.root.getAttribute('aria-label')||'Items');
  }
  dispose(){this.observer.disconnect();}
}
