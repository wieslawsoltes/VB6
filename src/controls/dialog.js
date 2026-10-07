import {el} from '../core/core.js';
import {icon} from '../theme/icons.js';
/** The supported MsgBox style bits. Help/system-modal options remain host limitations. */
export function messageBoxOptions(style=0){
  const n=Number(style)|0,sets={0:[['OK',1]],1:[['OK',1],['Cancel',2]],2:[['Abort',3],['Retry',4],['Ignore',5]],3:[['Yes',6],['No',7],['Cancel',2]],4:[['Yes',6],['No',7]],5:[['Retry',4],['Cancel',2]]},buttons=(sets[n&15]||sets[0]).map(([caption,value])=>({caption,value}));
  const defaultIndex=Math.min(buttons.length-1,(n>>>8)&3),cancel=buttons.find(b=>b.value===2)||((n&15)===0?buttons[0]:null),glyph=({16:'error',32:'question',48:'warning',64:'information'})[n&240];
  return {buttons,defaultIndex,cancelValue:cancel?.value,glyph,rightAlign:!!(n&524288),rtl:!!(n&1048576)};
}
/** Focus-contained classic dialog; no window.alert or externally styled browser chrome. */
export function runtimeDialog(host,title,body,buttons,input=null,options={}){
  return new Promise(resolve=>{
    const document=host.container.ownerDocument,view=document.defaultView;
    const previous=document.activeElement,inert=[];
    for(const node of host.container.children){inert.push([node,node.inert]);node.inert=true;}
    const shade=el('div',{class:'vb-modal-shade'}),dialog=el('div',{class:'vb-dialog',role:'dialog','aria-modal':'true','aria-label':String(title)}),header=el('div',{class:'vb-form-title'},el('span',{class:'caption',text:title})),content=el('div',{class:'vb-dialog-body'}),message=el('div',{class:'vb-dialog-message',text:body}),actions=el('div',{class:'vb-dialog-actions'}),controller=new AbortController();
    const signal=controller.signal;let finished=false,field;
    if(options.rightAlign)message.style.textAlign='right';if(options.rtl)dialog.dir='rtl';
    const cancelValue=input!==null?'':options.cancelValue??buttons.find(b=>b.caption.replace('&','').toLowerCase()==='cancel')?.value??(buttons.length===1?buttons[0].value:undefined);
    const finish=value=>{if(finished)return;finished=true;controller.abort();shade.remove();host.dialogs=host.dialogs.filter(d=>d!==shade);for(const [node,was]of inert)if(node.isConnected)node.inert=was;const top=host.dialogs.at(-1);if(top){const target=previous?.isConnected&&top.contains(previous)?previous:top.querySelector('input,.vb-default-button,button:not(:disabled)');target?.focus?.({preventScroll:true});}else if(previous?.isConnected)previous.focus?.({preventScroll:true});resolve(value);};
    shade.vbFinish=()=>finish(cancelValue??0);
    const close=el('button',{class:'vb-window-button',type:'button','data-caption-action':'close','aria-label':'Close dialog',title:'Close',disabled:cancelValue===undefined,onclick:()=>finish(cancelValue)},icon('close',12));header.append(close);
    if(options.glyph)content.append(el('span',{class:'vb-message-symbol'},icon(options.glyph,32)));content.append(message);
    if(input!==null){field=el('input',{type:options.inputType==='password'?'password':'text',value:String(input),'aria-label':String(body)});message.append(el('div',{style:{height:'10px'}}),field);}
    const buttonNodes=buttons.map((button,index)=>{const node=el('button',{class:'vb-command'+(index===(options.defaultIndex||0)?' vb-default-button':''),type:'button',text:button.caption.replace('&',''),onclick:()=>finish(field&&button.value===1?field.value:button.value)});actions.append(node);return node;});
    dialog.append(header,content,actions);shade.append(dialog);host.container.append(shade);host.dialogs.push(shade);
    dialog.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();if(cancelValue!==undefined)finish(cancelValue);}else if(e.key==='Enter'&&!e.target.closest('button')){e.preventDefault();buttonNodes[options.defaultIndex||0]?.click();}else if(e.key==='Tab'){const list=[...dialog.querySelectorAll('button:not(:disabled),input:not(:disabled)')],index=list.indexOf(document.activeElement);e.preventDefault();list[(index+(e.shiftKey?-1:1)+list.length)%list.length]?.focus();}else if(['ArrowLeft','ArrowRight'].includes(e.key)&&buttonNodes.includes(document.activeElement)){e.preventDefault();buttonNodes[(buttonNodes.indexOf(document.activeElement)+(e.key==='ArrowLeft'?-1:1)+buttonNodes.length)%buttonNodes.length].focus();}else if(e.altKey&&e.key.length===1){const button=buttons.find(b=>(b.caption.match(/&([^&])/)?.[1]||b.caption[0]).toLowerCase()===e.key.toLowerCase());if(button){e.preventDefault();buttonNodes[buttons.indexOf(button)].click();}}},{signal});
    header.style.touchAction='none';header.addEventListener('pointerdown',e=>{if(options.nativeWindow||e.button!==0||e.target.closest('button'))return;e.preventDefault();header.setPointerCapture(e.pointerId);const rect=dialog.getBoundingClientRect(),x=e.clientX,y=e.clientY;let done=false;Object.assign(dialog.style,{position:'fixed',left:rect.left+'px',top:rect.top+'px',margin:0});const move=event=>{dialog.style.left=Math.max(0,Math.min(view.innerWidth-rect.width,rect.left+event.clientX-x))+'px';dialog.style.top=Math.max(0,Math.min(view.innerHeight-22,rect.top+event.clientY-y))+'px';};const end=event=>{if(done)return;done=true;if(event.type==='pointercancel')Object.assign(dialog.style,{left:rect.left+'px',top:rect.top+'px'});header.removeEventListener('pointermove',move);header.removeEventListener('pointerup',end);header.removeEventListener('pointercancel',end);header.removeEventListener('lostpointercapture',end);};header.addEventListener('pointermove',move,{signal});header.addEventListener('pointerup',end,{signal});header.addEventListener('pointercancel',end,{signal});header.addEventListener('lostpointercapture',end,{signal});},{signal});
    queueMicrotask(()=>{if(!finished&&host.dialogs.at(-1)===shade){(field||buttonNodes[options.defaultIndex||0])?.focus();field?.select();}});
  });
}
