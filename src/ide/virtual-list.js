import {el} from '../core/core.js';
import {icon} from '../theme/icons.js';
const GLYPHS={'◇':'method','▣':'property','•':'constant','◆':'class','ϟ':'event','▤':'module'};
/** Fixed-row listbox used by modeless tools. DOM cost depends on viewport, not item count. */
let nextListId=0;
const lists=new WeakMap();
export function refreshToolLists(root){
  for(const node of root.querySelectorAll('.tool-list'))lists.get(node)?.transferDocument();
}
export class ToolList {
  constructor(label,onSelect,onOpen){
    this.rows=new Map();this.paintFrame=null;this.id='tool-list-'+(++nextListId);this.items=[];this.selected=-1;this.rowHeight=19;this.onSelect=onSelect;this.onOpen=onOpen;
    this.root=el('div',{class:'tool-list',role:'listbox',tabindex:0,'aria-label':label||'Items'});this.spacer=el('div',{class:'tool-list-spacer'});this.layer=el('div',{class:'tool-list-layer'});this.root.append(this.spacer,this.layer);this.root.addEventListener('scroll',()=>this.schedulePaint());
    this.root.addEventListener('click',e=>{const i=e.target.closest('[data-index]')?.dataset.index;if(i!==undefined)this.select(Number(i));});
    this.root.addEventListener('dblclick',()=>this.onOpen?.(this.items[this.selected]));
    this.root.addEventListener('keydown',e=>{const moves={ArrowDown:1,ArrowUp:-1,PageDown:Math.max(1,Math.floor(this.root.clientHeight/this.rowHeight)-1),PageUp:-Math.max(1,Math.floor(this.root.clientHeight/this.rowHeight)-1)};let next;
      if(moves[e.key])next=this.selected+moves[e.key];else if(e.key==='Home')next=0;else if(e.key==='End')next=this.items.length-1;
      else if(e.key==='Enter'){e.preventDefault();this.onOpen?.(this.items[this.selected]);return;}
      else if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){const now=performance.now();this.prefix=(now-(this.prefixTime||0)<900?this.prefix||'':'')+e.key.toLowerCase();this.prefixTime=now;const found=this.items.findIndex(i=>i.label.toLowerCase().startsWith(this.prefix));if(found>=0)next=found;}
      if(next!==undefined){e.preventDefault();this.select(next);}
    });lists.set(this.root,this);this.observeDocument();
  }
  observeDocument(){
    this.observerWindow=this.root.ownerDocument.defaultView;
    // DOM writes during observer delivery can change scrollbar geometry and
    // trigger an undelivered-notifications error. Paint on the next frame.
    this.observer=new this.observerWindow.ResizeObserver(()=>this.schedulePaint());
    this.observer.observe(this.root);
  }
  cancelPaint(){
    if(this.paintFrame!==null){this.paintWindow.cancelAnimationFrame(this.paintFrame);this.paintFrame=null;}
  }
  schedulePaint(){
    if(this.disposed)return;
    const view=this.root.ownerDocument.defaultView;
    if(this.paintFrame!==null&&this.paintWindow===view)return;
    this.cancelPaint();this.paintWindow=view;
    this.paintFrame=view.requestAnimationFrame(()=>{
      this.paintFrame=null;
      if(this.disposed)return;
      if(this.root.ownerDocument.defaultView!==view){this.schedulePaint();return;}
      this.paint();
    });
  }
  transferDocument(){
    if(this.disposed)return;
    this.cancelPaint();this.observer.disconnect();this.observeDocument();this.paint();
  }
  set(items,key){this.items=items;this.spacer.style.height=items.length*this.rowHeight+'px';this.selected=key?items.findIndex(i=>i.key===key):0;if(this.selected<0&&items.length)this.selected=0;this.root.scrollTop=0;this.paint();this.onSelect?.(items[this.selected]);}
  select(index,notify=true){
    if(!this.items.length)return;
    // Read viewport geometry before changing scroll/selection DOM. Design source:
    // https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
    const height=this.root.clientHeight,scrollTop=this.root.scrollTop;
    this.selected=Math.max(0,Math.min(this.items.length-1,index));
    const top=this.selected*this.rowHeight;
    if(top<scrollTop)this.root.scrollTop=top;
    else if(top+this.rowHeight>scrollTop+height)this.root.scrollTop=top-height+this.rowHeight;
    this.paint(height);if(notify)this.onSelect?.(this.items[this.selected]);
  }
  paint(measuredHeight){
    if(this.disposed)return;
    this.cancelPaint();
    // A retained visible row is updated, not replaced. Unchanged paint has zero
    // DOM writes; scrolling creates only rows newly entering the overscan range.
    // This applies the read-before-write guidance above, not third-party code.
    const height=measuredHeight??this.root.clientHeight,scrollTop=this.root.scrollTop;
    const start=Math.max(0,Math.floor(scrollTop/this.rowHeight)-2);
    const end=Math.min(this.items.length,start+Math.ceil((height||190)/this.rowHeight)+5);
    for(const [index,record] of this.rows)if(index<start||index>=end){record.node.remove();this.rows.delete(index);}
    let next=this.layer.firstElementChild;
    for(let i=start;i<end;i++){
      const item=this.items[i],glyph=GLYPHS[item.glyph]||'property',selected=i===this.selected;
      let record=this.rows.get(i);
      if(!record){
        const glyphNode=el('span',{class:'member-kind','aria-hidden':'true'},icon(glyph,16));
        const labelNode=el('span',{class:'tool-list-label'},item.label);
        const node=el('div',{class:'tool-list-row',id:this.id+'-'+i,role:'option','aria-posinset':i+1,'data-index':i,style:{top:i*this.rowHeight+'px'},title:item.label},glyphNode,labelNode);
        record={node,glyphNode,labelNode,glyph,label:item.label,selected:null,count:null};this.rows.set(i,record);
      }
      if(record.label!==item.label){record.labelNode.textContent=item.label;record.node.title=item.label;record.label=item.label;}
      if(record.glyph!==glyph){record.glyphNode.replaceChildren(icon(glyph,16));record.glyph=glyph;}
      if(record.selected!==selected){record.node.classList.toggle('selected',selected);record.node.setAttribute('aria-selected',String(selected));record.selected=selected;}
      if(record.count!==this.items.length){record.node.setAttribute('aria-setsize',String(this.items.length));record.count=this.items.length;}
      if(record.node===next)next=next.nextElementSibling;else this.layer.insertBefore(record.node,next);
    }
    const active=this.selected>=start&&this.selected<end?this.id+'-'+this.selected:null;
    if(active!==this.root.getAttribute('aria-activedescendant')){
      if(active)this.root.setAttribute('aria-activedescendant',active);else this.root.removeAttribute('aria-activedescendant');
    }
  }

  dispose(){this.disposed=true;this.cancelPaint();this.observer.disconnect();this.rows.clear();lists.delete(this.root);}
}
