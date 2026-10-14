import {el} from '../core/core.js';
/** Scroll-bar geometry is independent from DOM and remains stable at fractional DPR. */
export function scrollbarGeometry(min,max,value,length,page=1){
  const start=Number(min)||0,end=Number(max)||0,span=Math.abs(end-start),size=Math.max(0,Number(length)||0),thumb=Math.min(size,Math.max(8,Math.round(size*Math.max(1,Math.abs(Number(page)||1))/(span+Math.max(1,Math.abs(Number(page)||1)))))),travel=Math.max(0,size-thumb),fraction=span?Math.max(0,Math.min(1,(Number(value)-start)/(end-start))):0;
  return {thumb,travel,offset:Math.round(travel*fraction)};
}
export class ClassicScrollbar {
  constructor(node,properties,onValue,{vertical=false,design=false}={}){
    this.node=node;this.properties=properties;this.onValue=onValue;this.vertical=vertical;this.design=design;this.abort=new AbortController();this.signal=this.abort.signal;this.node.classList.add('vb-scrollbar',vertical?'vertical':'horizontal');node.setAttribute('role','scrollbar');node.setAttribute('aria-orientation',vertical?'vertical':'horizontal');
    this.before=el('button',{class:'vb-scroll-arrow before',type:'button',tabindex:-1,'aria-label':vertical?'Scroll up':'Scroll left'},el('i'));
    this.after=el('button',{class:'vb-scroll-arrow after',type:'button',tabindex:-1,'aria-label':vertical?'Scroll down':'Scroll right'},el('i'));
    this.track=el('div',{class:'vb-scroll-track'});this.thumb=el('div',{class:'vb-scroll-thumb','aria-hidden':'true'});this.track.append(this.thumb);node.append(this.before,this.track,this.after);
    this.bindRepeat(this.before,-1,false);this.bindRepeat(this.after,1,false);this.bindRepeat(this.track,0,true);
    this.thumb.addEventListener('pointerdown',e=>this.drag(e),{signal:this.signal});node.addEventListener('keydown',e=>this.keydown(e),{signal:this.signal});
    // The track can resize without the control resizing (arrowless platform skins).
    // Reuse the existing observer: no theme listener, polling, or extra observer.
    this.observer=new ResizeObserver(()=>this.refresh());this.observer.observe(node);this.observer.observe(this.track);this.refresh();
  }
  get props(){return this.properties();}
  available(){return !this.design&&this.props.Enabled!==0&&Number(this.props.Min)!==Number(this.props.Max);}
  refresh(){const p=this.props;this.node.setAttribute('aria-valuemin',String(Math.min(p.Min,p.Max)));this.node.setAttribute('aria-valuemax',String(Math.max(p.Min,p.Max)));this.node.setAttribute('aria-valuenow',String(p.Value));this.node.setAttribute('aria-disabled',String(p.Enabled===0||Number(p.Min)===Number(p.Max)));this.before.disabled=this.after.disabled=p.Enabled===0||Number(p.Min)===Number(p.Max);const length=this.vertical?this.track.clientHeight:this.track.clientWidth;this.geometry=scrollbarGeometry(p.Min,p.Max,p.Value,length,p.LargeChange);this.thumb.style[this.vertical?'height':'width']=this.geometry.thumb+'px';this.thumb.style[this.vertical?'top':'left']=this.geometry.offset+'px';this.thumb.hidden=Number(p.Min)===Number(p.Max);}
  assign(value,phase='change'){if(!this.available())return;const p=this.props,n=Math.round(Math.max(Math.min(p.Min,p.Max),Math.min(Math.max(p.Min,p.Max),value)));if(n!==Number(p.Value)){this.onValue(n,phase);this.refresh();}}
  step(direction,page){const p=this.props,amount=Math.abs(Number(page?p.LargeChange:p.SmallChange)||0);this.assign(Number(p.Value)+direction*(Number(p.Max)>=Number(p.Min)?1:-1)*amount);}
  clearRepeat(){clearTimeout(this.delay);clearInterval(this.repeat);this.delay=this.repeat=null;}
  bindRepeat(node,direction,page){node.addEventListener('pointerdown',e=>{if(e.button!==0||!this.available()||e.target===this.thumb)return;e.preventDefault();e.stopPropagation();this.node.focus({preventScroll:true});node.setPointerCapture(e.pointerId);let stopped=false;const point=this.vertical?e.clientY:e.clientX;
      const action=()=>{if(page){const r=this.thumb.getBoundingClientRect(),a=this.vertical?r.top:r.left,b=this.vertical?r.bottom:r.right;if(point>=a&&point<=b){this.clearRepeat();return;}this.step(point<a?-1:1,true);}else this.step(direction,false);};action();this.delay=setTimeout(()=>this.repeat=setInterval(action,65),400);
      const finish=()=>{if(stopped)return;stopped=true;this.clearRepeat();node.removeEventListener('pointerup',finish);node.removeEventListener('pointercancel',finish);node.removeEventListener('lostpointercapture',finish);};node.addEventListener('pointerup',finish);node.addEventListener('pointercancel',finish);node.addEventListener('lostpointercapture',finish);
    },{signal:this.signal});}
  drag(e){if(e.button!==0||!this.available())return;e.preventDefault();e.stopPropagation();this.node.focus({preventScroll:true});this.thumb.setPointerCapture(e.pointerId);const initial=Number(this.props.Value),position=this.vertical?e.clientY:e.clientX,rect=this.track.getBoundingClientRect(),scale=(this.vertical?rect.height/this.track.clientHeight:rect.width/this.track.clientWidth)||1,geometry={...this.geometry};let finished=false;
    const move=event=>{const delta=((this.vertical?event.clientY:event.clientX)-position)/scale,fraction=geometry.travel?Math.max(0,Math.min(1,(geometry.offset+delta)/geometry.travel)):0;this.assign(Number(this.props.Min)+(Number(this.props.Max)-Number(this.props.Min))*fraction,'scroll');};
    const finish=event=>{if(finished)return;finished=true;this.thumb.removeEventListener('pointermove',move);this.thumb.removeEventListener('pointerup',finish);this.thumb.removeEventListener('pointercancel',finish);this.thumb.removeEventListener('lostpointercapture',finish);if(event.type==='pointercancel')this.assign(initial,'scroll');if(Number(this.props.Value)!==initial)this.onValue(Number(this.props.Value),'commit');};
    this.thumb.addEventListener('pointermove',move);this.thumb.addEventListener('pointerup',finish);this.thumb.addEventListener('pointercancel',finish);this.thumb.addEventListener('lostpointercapture',finish);
  }
  keydown(e){if(!this.available())return;const key=e.key;if(['ArrowLeft','ArrowUp','ArrowRight','ArrowDown','PageUp','PageDown','Home','End'].includes(key)){e.preventDefault();e.stopPropagation();if(key==='Home'||key==='End')this.assign(Number(this.props[key==='Home'?'Min':'Max']));else this.step(['ArrowLeft','ArrowUp','PageUp'].includes(key)?-1:1,key.startsWith('Page'));}}
  dispose(){this.abort.abort();this.clearRepeat();this.observer.disconnect();}
}
