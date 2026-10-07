import {el} from '../core/core.js';
/** Pointer-capture lifecycle shared by runtime form moving and resizing. */
export function installFormWindow(form){
  if(form.design)return;form.titleBar.tabIndex=0;let cancelInteraction=null;
  const start=(event,edge='move')=>{
    if(form.nativeWindow?.id||event.button!==0||event.target.closest('button')||form.savedBounds||form.minimized&&edge!=='move'||edge!=='move'&&Number(form.props.BorderStyle??2)!==2&&Number(form.props.BorderStyle)!==5)return;
    cancelInteraction?.();event.preventDefault();event.stopPropagation();const handle=event.currentTarget,original={Left:form.props.Left,Top:form.props.Top,ClientWidth:form.props.ClientWidth,ClientHeight:form.props.ClientHeight},moved=form.movedByUser,rect=form.node.getBoundingClientRect(),scale=rect.width/Math.max(1,form.node.offsetWidth)||1,startX=event.clientX,startY=event.clientY;
    form.movedByUser=true;handle.setPointerCapture(event.pointerId);let done=false;
    const apply=e=>{const dx=(e.clientX-startX)/scale,dy=(e.clientY-startY)/scale,area=form.node.parentElement,left=Number(original.Left||0)/15,top=Number(original.Top||0)/15,width=Number(original.ClientWidth||6000)/15,height=Number(original.ClientHeight||4500)/15;
      if(edge==='move'){form.props.Left=Math.max(0,Math.min(Math.max(0,area.clientWidth-64),left+dx))*15;form.props.Top=Math.max(0,Math.min(Math.max(0,area.clientHeight-24),top+dy))*15;}
      else{let x=left,y=top,w=width,h=height;if(edge.includes('e'))w=Math.max(92,width+dx);if(edge.includes('s'))h=Math.max(35,height+dy);if(edge.includes('w')){x=Math.min(left+width-92,Math.max(0,left+dx));w=left+width-x;}if(edge.includes('n')){y=Math.min(top+height-35,Math.max(0,top+dy));h=top+height-y;}form.props.Left=Math.round(x*15);form.props.Top=Math.round(y*15);form.props.ClientWidth=Math.min(300000,Math.round(w*15));form.props.ClientHeight=Math.min(300000,Math.round(h*15));}
      form.refresh();form.mdiController?.layout();};
    const finish=(cancel=false)=>{if(done)return;done=true;handle.removeEventListener('pointermove',apply);handle.removeEventListener('pointerup',up);handle.removeEventListener('pointercancel',abandon);handle.removeEventListener('lostpointercapture',abandon);document.removeEventListener('keydown',key,true);if(handle.hasPointerCapture?.(event.pointerId))handle.releasePointerCapture(event.pointerId);if(cancel){Object.assign(form.props,original);form.movedByUser=moved;form.refresh();form.mdiController?.layout();}else if(edge!=='move')form.event('Resize');cancelInteraction=null;};
    const up=()=>finish(false),abandon=()=>finish(true),key=e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(true);}};cancelInteraction=abandon;handle.addEventListener('pointermove',apply);handle.addEventListener('pointerup',up);handle.addEventListener('pointercancel',abandon);handle.addEventListener('lostpointercapture',abandon);document.addEventListener('keydown',key,true);
  };
  form.titleBar.addEventListener('pointerdown',e=>start(e));form.titleBar.addEventListener('dblclick',e=>{if(!form.nativeWindow?.id&&!e.target.closest('button')&&form.props.MaxButton!==0&&Number(form.props.BorderStyle??2)===2)form.toggleMaximize();});
  for(const edge of ['n','s','e','w','ne','nw','se','sw']){const grip=el('div',{class:'vb-form-grip vb-form-grip-'+edge,'aria-hidden':'true'});grip.addEventListener('pointerdown',e=>start(e,edge));form.node.append(grip);}
  form.cancelWindowInteraction=()=>cancelInteraction?.();
}
