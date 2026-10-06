import {bindApplicationTheme} from '../theme/application-appearance.js';
import {el} from '../core/core.js';
import {getTheme} from '../theme/theme.js';

/** Bounds-only model used by the classic two-button spin control. */
export function stepperValue(properties,direction){
  const min=Number(properties.Min),max=Number(properties.Max),current=Number(properties.Value),step=Math.abs(Number(properties.Increment??properties.SmallChange??1));
  if(![min,max,current,step].every(Number.isFinite))return current;
  const low=Math.min(min,max),high=Math.max(min,max),next=current+direction*step;
  return properties.Wrap&&next>high?low:properties.Wrap&&next<low?high:Math.max(low,Math.min(high,next));
}
export class ClassicUpDown {
  constructor(node,properties,onValue,{design=false}={}){
    Object.assign(this,{node,properties,onValue,design});this.abort=new AbortController();node.classList.add('vb-updown');node.setAttribute('role','spinbutton');
    this.up=el('button',{type:'button',class:'vb-spin-button up',tabindex:-1,'aria-label':'Increment'},el('i'));
    this.down=el('button',{type:'button',class:'vb-spin-button down',tabindex:-1,'aria-label':'Decrement'},el('i'));node.append(this.up,this.down);
    this.bind(this.up,1);this.bind(this.down,-1);node.addEventListener('keydown',e=>{if(this.design||!this.properties().Enabled)return;const direction={ArrowUp:1,ArrowRight:1,ArrowDown:-1,ArrowLeft:-1}[e.key];if(direction){e.preventDefault();e.stopPropagation();this.step(direction);}}, {signal:this.abort.signal});this.refresh();
  }
  step(direction){const p=this.properties();if(this.design||!p.Enabled)return;const value=stepperValue(p,direction);if(value!==Number(p.Value))this.onValue(value,direction);this.refresh();}
  bind(button,direction){button.addEventListener('pointerdown',e=>{if(e.button!==0||this.design||!this.properties().Enabled)return;e.preventDefault();this.node.focus();button.setPointerCapture(e.pointerId);this.step(direction);this.clear();this.delay=setTimeout(()=>this.repeat=setInterval(()=>this.step(direction),65),400);const end=()=>{this.clear();button.removeEventListener('pointerup',end);button.removeEventListener('pointercancel',end);button.removeEventListener('lostpointercapture',end);};button.addEventListener('pointerup',end);button.addEventListener('pointercancel',end);button.addEventListener('lostpointercapture',end);},{signal:this.abort.signal});button.addEventListener('click',e=>{if(e.detail===0)this.step(direction);},{signal:this.abort.signal});}
  refresh(){const p=this.properties(),disabled=!p.Enabled;this.node.classList.toggle('horizontal',Number(p.Orientation)===1);this.node.setAttribute('aria-valuemin',String(Math.min(p.Min,p.Max)));this.node.setAttribute('aria-valuemax',String(Math.max(p.Min,p.Max)));this.node.setAttribute('aria-valuenow',String(p.Value));this.node.setAttribute('aria-disabled',String(disabled));this.up.disabled=this.down.disabled=disabled;}
  clear(){clearTimeout(this.delay);clearInterval(this.repeat);}
  dispose(){this.clear();this.abort.abort();}
}

let comboSequence=0;
/** Editable, simple and list-only combos with a bounded, theme-scoped list. */
export class ClassicCombo {
  constructor(node,properties,items,onText,onSelect,{design=false}={}){
    Object.assign(this,{node,properties,items,onText,onSelect,design});this.id='vb-combo-'+(++comboSequence);this.abort=new AbortController();node.classList.add('vb-classic-combo');
    this.input=el('input',{type:'text',class:'vb-combo-field',role:'combobox','aria-label':node.dataset.control,'aria-expanded':'false','aria-haspopup':'listbox','aria-autocomplete':'list',autocomplete:'off',spellcheck:false});
    this.arrow=el('button',{type:'button',class:'vb-combo-arrow',tabindex:-1,'aria-label':'Open list'},el('i'));node.append(this.input,this.arrow);
    this.arrow.addEventListener('pointerdown',e=>e.preventDefault(),{signal:this.abort.signal});this.arrow.addEventListener('click',()=>{if(!this.design&&!this.input.disabled){this.input.focus();this.popup?this.close():this.open();}},{signal:this.abort.signal});
    this.input.addEventListener('input',()=>{if(!this.design){this.onText(this.input.value);this.preview=this.items().indexOf(this.input.value);this.paint();}},{signal:this.abort.signal});
    this.input.addEventListener('keydown',e=>this.keydown(e),{signal:this.abort.signal});this.input.addEventListener('click',()=>{if(Number(this.properties().Style)===2&&!this.design&&!this.popup)this.open();},{signal:this.abort.signal});this.refresh();
  }
  refresh(){const p=this.properties(),simple=Number(p.Style)===1;this.input.readOnly=Number(p.Style)===2;this.input.disabled=this.arrow.disabled=!p.Enabled;this.node.classList.toggle('simple',simple);this.arrow.hidden=simple;const value=Number(p.ListIndex)>=0?String(this.items()[p.ListIndex]??''):String(p.Text??'');if(this.input.value!==value)this.input.value=value;
    if(this.popup&&(this.input.disabled||this.popupSimple!==simple))this.close(false);
    if(simple&&!this.popup)this.open(true);
    if(this.popup){this.preview=Number(p.ListIndex);this.layout();this.paint();}
  }
  open(simple=false){if(this.popup||(!simple&&(this.design||this.input.disabled)))return;
    const document=this.node.ownerDocument,window=document.defaultView;
    const p=this.properties();this.popupSimple=simple;this.preview=Number(p.ListIndex);this.savedIndex=this.preview;
    this.popup=el('div',{id:this.id,class:'vb-combo-popup'+(simple?' simple-list':''),role:'listbox','aria-label':this.node.dataset.control+' items','data-vb-theme':getTheme(this.node).id});this.releaseTheme=bindApplicationTheme(this.node,this.popup);this.spacer=el('div',{class:'vb-combo-spacer'});this.popup.append(this.spacer);
    Object.assign(this.popup.style,{font:getComputedStyle(this.input).font});(simple?this.node:document.body).append(this.popup);this.input.setAttribute('aria-controls',this.id);this.input.setAttribute('aria-expanded','true');this.popupAbort=new window.AbortController();const signal=this.popupAbort.signal;
    this.popup.addEventListener('scroll',()=>this.paint(),{signal});this.popup.addEventListener('pointerdown',e=>e.preventDefault(),{signal});
    document.addEventListener('pointerdown',e=>{if(!simple&&!this.node.contains(e.target)&&!this.popup?.contains(e.target))this.close(false);},{signal,capture:true});window.addEventListener('resize',()=>simple?this.layout():this.close(),{signal});
    window.addEventListener('blur',()=>{if(!simple)this.close(false);},{signal});this.layout();this.reveal();this.paint();
  }
  layout(){if(!this.popup)return;const {innerWidth,innerHeight}=this.node.ownerDocument.defaultView;const r=this.node.getBoundingClientRect();this.rowHeight=Math.max(15,Math.ceil(parseFloat(getComputedStyle(this.input).fontSize)||11)+3);this.spacer.style.height=this.items().length*this.rowHeight+'px';if(this.popupSimple)return;
    const height=Math.min(8,Math.max(1,this.items().length))*this.rowHeight+4,width=Math.min(innerWidth-4,Math.max(80,r.width)),top=r.bottom+height>innerHeight-2&&r.top>=height?r.top-height:r.bottom;
    Object.assign(this.popup.style,{width:width+'px',height:Math.min(height,innerHeight-4)+'px',left:Math.max(2,Math.min(r.left,innerWidth-width-2))+'px',top:Math.max(2,Math.min(top,innerHeight-height-2))+'px'});
  }
  paint(){if(!this.popup)return;const items=this.items(),row=this.rowHeight||15,start=Math.max(0,Math.floor(this.popup.scrollTop/row)-2),end=Math.min(items.length,start+Math.ceil((this.popup.clientHeight||120)/row)+4);this.spacer.style.height=items.length*row+'px';const nodes=[];
    for(let i=start;i<end;i++){const item=el('div',{id:this.id+'-'+i,class:'vb-combo-option'+(i===this.preview?' selected':''),role:'option','aria-selected':i===this.preview,'aria-posinset':i+1,'aria-setsize':items.length,style:{top:i*row+'px',height:row+'px',lineHeight:row+'px'},text:String(items[i])});item.addEventListener('pointerenter',()=>{if(this.design||this.input.disabled||this.preview===i)return;this.preview=i;this.paint();});item.addEventListener('click',()=>this.choose(i));nodes.push(item);}this.spacer.replaceChildren(...nodes);if(this.preview>=0)this.input.setAttribute('aria-activedescendant',this.id+'-'+this.preview);else this.input.removeAttribute('aria-activedescendant');
  }
  reveal(){if(!this.popup||this.preview<0)return;const y=this.preview*(this.rowHeight||15),h=this.popup.clientHeight;if(y<this.popup.scrollTop)this.popup.scrollTop=y;else if(y+this.rowHeight>this.popup.scrollTop+h)this.popup.scrollTop=y+this.rowHeight-h;}
  choose(index){if(this.design||this.input.disabled||index<0||index>=this.items().length)return;this.preview=index;this.onSelect(index);if(!this.popupSimple)this.close();else {this.reveal();this.paint();}this.input.focus();}
  close(focus=true){if(!this.popup)return;this.releaseTheme?.();this.releaseTheme=null;this.popupAbort.abort();this.popup.remove();this.popup=this.spacer=null;this.input.setAttribute('aria-expanded','false');this.input.removeAttribute('aria-activedescendant');this.input.removeAttribute('aria-controls');if(focus&&this.input.isConnected)this.input.focus();}
  keydown(e){if(this.design||this.input.disabled)return;const key=e.key,simple=Number(this.properties().Style)===1;
    if(key==='F4'||e.altKey&&key==='ArrowDown'){e.preventDefault();e.stopPropagation();if(!simple){this.popup?this.close():this.open();}return;}
    if(this.popup&&(key==='Escape'||e.altKey&&key==='ArrowUp')){e.preventDefault();e.stopPropagation();if(!simple)this.close();return;}
    if(this.popup&&key==='Enter'){e.preventDefault();e.stopPropagation();this.choose(this.preview);return;}
    const move={ArrowDown:1,ArrowUp:-1,PageDown:8,PageUp:-8}[key];if(move||(this.popup||this.input.readOnly)&&['Home','End'].includes(key)){e.preventDefault();e.stopPropagation();const items=this.items(),current=this.popup?this.preview:Number(this.properties().ListIndex),next=key==='Home'?0:key==='End'?items.length-1:Math.max(0,Math.min(items.length-1,current+move));if(this.popup&&!simple){this.preview=next;this.reveal();this.paint();}else this.choose(next);return;}
    if(key==='Tab'&&this.popup&&!simple){this.close(false);return;}
    if(this.input.readOnly&&key.length===1&&!e.ctrlKey&&!e.altKey&&!e.metaKey){e.preventDefault();const now=performance.now();this.prefix=now-(this.lastSearch||0)<900?(this.prefix||'')+key:key;this.lastSearch=now;const items=this.items(),index=items.findIndex(t=>String(t).toLowerCase().startsWith(this.prefix.toLowerCase()));if(index>=0){if(this.popup){this.preview=index;this.reveal();this.paint();}else this.choose(index);}}
  }
  dispose(){this.close(false);this.abort.abort();}
}
