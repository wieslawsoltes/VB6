/** Shared IDE/runtime popup menus: one session, a retained submenu stack, no leaked listeners. */
import {uiDocument} from '../core/window-context.js';
import {el} from '../core/core.js';
import {icon} from './icons.js';
import {getTheme} from './theme.js';
let active=null,sequence=0;
export function mnemonicText(node,text,explicit) {
  const input=String(text??'');node.replaceChildren();let used=false;
  for(let i=0;i<input.length;i++){
    if(input[i]==='&'&&input[i+1]==='&'){node.append('&');i++;continue;}
    if(input[i]==='&'&&input[i+1]){node.append(el('u',{},input[++i]));used=true;continue;}
    if(!used&&explicit&&input[i].toLowerCase()===explicit.toLowerCase()){node.append(el('u',{},input[i]));used=true;}else node.append(input[i]);
  }
  return node;
}
export function menuIsOpen(){return !!active;}
export function closeMenu(restore=true){if(active){const old=active;active=null;old.dispose(restore);}}
class MenuSession {
  constructor(items,x,y,onCommand,options){
    this.document=options.document||uiDocument(options.opener);this.view=this.document.defaultView;this.onCommand=onCommand;this.options=options;this.previous=options.opener||this.document.activeElement;this.stack=[];
    this.theme=options.theme||getTheme(options.opener||this.document.activeElement).id;
    this.abort=new AbortController();this.open(items,x,y,null);
    this.document.addEventListener('pointerdown',e=>{if(!this.stack.some(s=>s.node.contains(e.target))&&!options.opener?.closest('[role=menubar]')?.contains(e.target))closeMenu(false);},{capture:true,signal:this.abort.signal});
    this.view.addEventListener('blur',()=>closeMenu(false),{signal:this.abort.signal});
    this.view.addEventListener('resize',()=>closeMenu(false),{signal:this.abort.signal});
    if(options.opener){options.opener.classList.add('menu-open');options.opener.setAttribute('aria-expanded','true');}
  }
  open(items,x,y,parent){
    const depth=parent?parent.level+1:0;this.trim(depth);
    const node=el('div',{id:'classic-menu-'+(++sequence),class:'classic-menu ide-popup-menu'+(this.options.runtime?' vb-popup-menu runtime-popup':''),role:'menu',tabindex:-1,'data-vb-theme':this.theme,'aria-label':parent?.item.label?.replaceAll('&','')||this.options.label||'Commands'});
    const state={node,rows:[],selected:-1,level:depth,parent};
    for(const item of items){
      if(!item){node.append(el('div',{class:'menu-separator',role:'separator'}));continue;}
      const enabled=typeof item.enabled==='function'?!!item.enabled():item.enabled!==false;
      const row=el('button',{type:'button',class:'popup-menu-item',role:item.checked!==undefined?'menuitemcheckbox':'menuitem',tabindex:-1,disabled:!enabled,'aria-disabled':String(!enabled),'data-command':item.id||''});
      if(item.checked!==undefined)row.setAttribute('aria-checked',String(!!item.checked));
      if(item.items){row.setAttribute('aria-haspopup','menu');row.setAttribute('aria-expanded','false');}
      const mark=el('span',{class:'menu-icon'+(item.checked?' menu-checked':'')},item.checked?icon('check'):item.icon?icon(item.icon):null),label=mnemonicText(el('span',{class:'menu-label'}),item.label,item.mnemonic);
      row.append(mark,label,el('span',{class:'menu-shortcut'},item.shortcut||''),el('span',{class:'menu-arrow'},item.items?icon('arrow-right'):null));
      const entry={row,item,enabled,level:depth};state.rows.push(entry);
      row.addEventListener('click',()=>this.activate(state,entry));
      row.addEventListener('pointerenter',()=>{if(!enabled)return;this.select(state,state.rows.indexOf(entry),false);clearTimeout(this.timer);this.timer=setTimeout(()=>{if(active===this&&entry.item.items)this.submenu(state,entry,false);else this.trim(depth+1);},180);});
      node.append(row);
    }
    node.addEventListener('keydown',e=>this.keydown(state,e));
    this.document.body.append(node);this.stack.push(state);
    const width=node.offsetWidth,height=node.offsetHeight;
    if(parent&&x+width>this.view.innerWidth-2)x=parent.row.getBoundingClientRect().left-width+2;
    node.style.left=Math.round(Math.max(2,Math.min(x,this.view.innerWidth-width-2)))+'px';
    node.style.top=Math.round(Math.max(2,Math.min(y,this.view.innerHeight-height-2)))+'px';
    if(!parent){node.focus({preventScroll:true});if(this.options.focusFirst)this.select(state,this.next(state,-1,1),true);}
    return state;
  }
  trim(depth){clearTimeout(this.timer);while(this.stack.length>depth){const state=this.stack.pop();state.parent?.row.setAttribute('aria-expanded','false');state.node.remove();}}
  next(state,index,direction){const n=state.rows.length;for(let i=0;i<n;i++){index=(index+direction+n)%n;if(state.rows[index].enabled)return index;}return -1;}
  select(state,index,focus){state.selected=index;state.rows.forEach((entry,i)=>entry.row.classList.toggle('menu-selected',i===index));if(focus)state.rows[index]?.row.focus({preventScroll:true});state.rows[index]?.row.scrollIntoView({block:'nearest'});}
  submenu(state,entry,focus){
    if(this.stack[state.level+1]?.parent===entry){if(focus){const s=this.stack[state.level+1];this.select(s,this.next(s,-1,1),true);}return;}
    const r=entry.row.getBoundingClientRect();const child=this.open(typeof entry.item.items==='function'?entry.item.items():entry.item.items,r.right-2,r.top-3,entry);entry.row.setAttribute('aria-expanded','true');entry.row.setAttribute('aria-controls',child.node.id);if(focus)this.select(child,this.next(child,-1,1),true);
  }
  activate(state,entry){if(!entry?.enabled)return;if(entry.item.items){this.submenu(state,entry,true);return;}const item=entry.item;closeMenu(true);if(item.action)item.action();else this.onCommand?.(item.id);}
  keydown(state,e){
    if(e.ctrlKey||e.metaKey)return;
    const key=e.key;let handled=true;
    if(key==='ArrowDown'||key==='ArrowUp'){this.select(state,this.next(state,state.selected,key==='ArrowDown'?1:-1),true);}
    else if(key==='Home')this.select(state,this.next(state,-1,1),true);
    else if(key==='End')this.select(state,this.next(state,0,-1),true);
    else if(key==='Enter'||key===' ')this.activate(state,state.rows[state.selected]);
    else if(key==='ArrowRight'){const entry=state.rows[state.selected];if(entry?.item.items)this.submenu(state,entry,true);else this.options.onSwitch?.(1);}
    else if(key==='ArrowLeft'){if(state.parent){this.trim(state.level);state.parent.row.focus();}else this.options.onSwitch?.(-1);}
    else if(key==='Escape'){const deepest=this.stack.at(-1);if(deepest?.parent){this.trim(deepest.level);deepest.parent.row.focus();}else closeMenu(true);}
    else if(key==='Tab'||key==='F10'||key==='Alt')closeMenu(true);
    else if(key.length===1){const letter=key.toLowerCase(),matches=state.rows.map((entry,i)=>({entry,i})).filter(({entry})=>entry.enabled&&((entry.item.mnemonic||entry.row.querySelector('u')?.textContent||entry.item.label?.[0]||'').toLowerCase()===letter));if(matches.length){const found=matches.find(m=>m.i>state.selected)||matches[0];this.select(state,found.i,true);if(matches.length===1)this.activate(state,found.entry);}else handled=false;}
    else handled=false;
    if(handled){e.preventDefault();e.stopPropagation();}
  }
  dispose(restore){this.abort.abort();this.trim(0);this.document.querySelectorAll('.menu-open').forEach(n=>{n.classList.remove('menu-open');n.setAttribute('aria-expanded','false');});if(restore&&this.previous?.isConnected&&!this.previous.disabled)this.previous.focus({preventScroll:true});}
}
export function showMenu(items,x,y,onCommand,options={}){closeMenu(false);active=new MenuSession(items,x,y,onCommand,options);return active.stack[0].node;}
