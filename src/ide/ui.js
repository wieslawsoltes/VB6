import { el } from '../core/core.js';

import {icon, controlIcon} from '../theme/icons.js';
import {showMenu as themedShowMenu, closeMenu, mnemonicText, menuIsOpen} from '../theme/menu.js';
import {decorateCommandItems} from './command-bar-model.js';
export {icon, controlIcon, closeMenu, mnemonicText, menuIsOpen};
// IDE menus share the command catalog; application menus remain undecorated.
export function showMenu(items,...args){
  return themedShowMenu(decorateCommandItems(items),...args);
}


let dialogSequence=0;
export function modal(title,{width=480,content,buttons=[{label:'OK',value:true,primary:true},{label:'Cancel',value:false}],onReady}={}) {
  return new Promise(resolve=>{
    closeMenu(false);
    const previous=document.activeElement,cover=el('div',{class:'ide-modal-cover'}),id='ide-dialog-'+(++dialogSequence);
    const dialog=el('div',{class:'ide-dialog',role:'dialog','aria-modal':'true','aria-labelledby':id,style:{width:width+'px'},tabindex:-1});
    const body=el('div',{class:'ide-dialog-body'}),footer=el('div',{class:'ide-dialog-footer'});
    const disabled=[...document.body.children].filter(n=>!n.inert&&n.tagName!=='SCRIPT'&&n.tagName!=='STYLE');disabled.forEach(n=>n.inert=true);
    let closed=false,pending=false;
    const finish=value=>{if(closed)return;closed=true;cover.remove();disabled.forEach(n=>n.inert=false);if(previous?.isConnected)previous.focus({preventScroll:true});resolve(value);};
    const titlebar=el('div',{class:'tool-caption dialog-caption'},el('strong',{id},title),el('button',{class:'caption-close',title:'Close dialog','aria-label':'Close dialog',onclick:()=>finish(false)},icon('close')));
    dialog.append(titlebar,body,footer);if(content)body.append(content);
    for(const button of buttons){const node=el('button',{type:'button',class:button.primary?'default-button':'',onclick:async()=>{
      if(pending)return;pending=true;
      try{if(button.action){const result=await button.action();if(result===false)return;}finish(button.value);}
      catch(error){await alertDialog(error.message||String(error),'Invalid value');}
      finally{pending=false;}
    }},button.label);footer.append(node);}
    cover.append(dialog);document.body.append(cover);
    cover.addEventListener('keydown',e=>{
      if(e.defaultPrevented)return;
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();finish(false);return;}
      if(e.key==='Enter'&&!e.target.closest('textarea,[contenteditable=true],[role=tablist]')&&e.target.tagName!=='BUTTON'){e.preventDefault();footer.querySelector('.default-button')?.click();return;}
      if(e.key==='Tab'){
        const nodes=[...dialog.querySelectorAll('input,select,textarea,button,[tabindex="0"]')].filter(n=>!n.disabled&&!n.hidden&&n.offsetParent&&n.tabIndex>=0),first=nodes[0],last=nodes.at(-1);
        if(!nodes.length){e.preventDefault();dialog.focus();}
        else if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus();}
      }
    });
    makeDraggable(titlebar,dialog);onReady?.({dialog,body,finish});
    queueMicrotask(()=>{if(closed)return;(body.querySelector('input:not([type=hidden]),select,textarea,[role=tab][aria-selected=true]')||footer.querySelector('button')||dialog).focus();});
  });
}
export function alertDialog(text,title='Visual Basic'){return modal(title,{content:el('div',{class:'dialog-message'},text),buttons:[{label:'OK',value:true,primary:true}]});}
export async function promptDialog(title,label,value=''){
  const input=el('input',{class:'dialog-input',value,'aria-label':label}),message=el('div',{},el('label',{},label),input);
  const result=await modal(title,{content:message,onReady:()=>queueMicrotask(()=>input.select())});return result?input.value:null;
}
export function makeDraggable(handle,node,{onEnd}={}){
  handle.style.touchAction='none';
  handle.addEventListener('pointerdown',event=>{
    if(event.button!==0||event.target.closest('button'))return;event.preventDefault();
    const r=node.getBoundingClientRect(),x=event.clientX,y=event.clientY;
    Object.assign(node.style,{position:'fixed',left:r.left+'px',top:r.top+'px',margin:'0',transform:'none'});handle.setPointerCapture(event.pointerId);
    const move=e=>{node.style.left=Math.round(Math.max(0,Math.min(Math.max(0,innerWidth-node.offsetWidth),r.left+e.clientX-x)))+'px';node.style.top=Math.round(Math.max(0,Math.min(Math.max(0,innerHeight-24),r.top+e.clientY-y)))+'px';};
    const done=()=>{handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',done);handle.removeEventListener('pointercancel',done);handle.removeEventListener('lostpointercapture',done);onEnd?.();};
    handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',done);handle.addEventListener('pointercancel',done);handle.addEventListener('lostpointercapture',done);
  });
}
export function resizeHandle(node,axis,callback,{label='Resize pane',value,min=0,max=1000,onReset}={}){
  node.tabIndex=0;node.setAttribute('role','separator');node.setAttribute('aria-label',label);node.setAttribute('aria-orientation',axis==='x'?'vertical':'horizontal');node.style.touchAction='none';
  const apply=delta=>{callback(delta);if(value)node.setAttribute('aria-valuenow',String(Math.round(value())));};
  node.setAttribute('aria-valuemin',String(min));node.setAttribute('aria-valuemax',String(max));if(value)node.setAttribute('aria-valuenow',String(value()));
  node.addEventListener('keydown',e=>{const positive=axis==='x'?'ArrowRight':'ArrowDown',negative=axis==='x'?'ArrowLeft':'ArrowUp';if(e.key===positive||e.key===negative){e.preventDefault();e.stopPropagation();apply((e.key===positive?1:-1)*(e.shiftKey?32:8));}else if(e.key==='Home'&&value){e.preventDefault();apply(min-value());}else if(e.key==='End'&&value){e.preventDefault();apply(max-value());}});
  if(onReset)node.addEventListener('dblclick',onReset);
  node.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;event.preventDefault();node.focus();node.setPointerCapture(event.pointerId);let last=axis==='x'?event.clientX:event.clientY;
    const move=e=>{const current=axis==='x'?e.clientX:e.clientY;apply(current-last);last=current;};
    const done=()=>{node.removeEventListener('pointermove',move);node.removeEventListener('pointerup',done);node.removeEventListener('pointercancel',done);node.removeEventListener('lostpointercapture',done);};
    node.addEventListener('pointermove',move);node.addEventListener('pointerup',done);node.addEventListener('pointercancel',done);node.addEventListener('lostpointercapture',done);
  });
}
export function tabbedPages(pages,{label='Options',selected=pages[0]?.id,onSelect}={}){
  const root=el('div',{class:'classic-tabs'}),bar=el('div',{class:'dialog-tabs',role:'tablist','aria-label':label}),panels=el('div',{class:'classic-tab-pages'}),buttons=[];
  const select=id=>{pages.forEach((p,i)=>{const yes=p.id===id;buttons[i].setAttribute('aria-selected',String(yes));buttons[i].tabIndex=yes?0:-1;buttons[i].classList.toggle('active',yes);p.node.hidden=!yes;});onSelect?.(id);};
  pages.forEach((p,i)=>{const id='tab-'+(++dialogSequence),button=el('button',{type:'button',role:'tab',id,'aria-controls':id+'-panel',onclick:()=>select(p.id)},p.label);p.node.id=id+'-panel';p.node.setAttribute('role','tabpanel');p.node.setAttribute('aria-labelledby',id);bar.append(button);buttons.push(button);panels.append(p.node);button.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=e.key==='Home'?0:e.key==='End'?pages.length-1:(i+(e.key==='ArrowLeft'?-1:1)+pages.length)%pages.length;select(pages[index].id);buttons[index].focus();}});});
  root.append(bar,panels);select(selected);root.select=select;return root;
}
