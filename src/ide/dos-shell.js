import {hasUIDialog,uiDocument} from '../core/window-context.js';
import {menuIsOpen} from '../theme/menu.js';
import {DOS_SHELL_COMMANDS,dosModifiers,dosMenuCommands,dosFunctionKeys,dosCycleIndex} from './dos-shell-model.js';

const MENUS=['File','Edit','View','Project','Format','Debug','Run','Tools','Window','Help'];
const PANES='.managed-panel,.mdi-window';
const FOCUSABLE='textarea,input:not([type=hidden]),select,[contenteditable=true],[role=tree],[role=grid],[role=listbox],[tabindex],button,a[href]';
const PREFERRED='.monaco-editor textarea.inputarea,.source-editor textarea,.xaml-source-input,.designer-scroll,.project-tree .tree-row.selected,.property-grid,[role=tree],[role=grid],[role=listbox],.tool-list';
const POPUPS='.ide-modal-cover,.property-color-popup,.vb-tui-picker,[role=dialog][aria-modal=true]';
const setAttribute=(node,key,value)=>{value=String(value);if(node.getAttribute(key)!==value)node.setAttribute(key,value);};

function visible(node) {
  try{
    const view=node?.ownerDocument?.defaultView;
    if(!view||view.closed||!node.isConnected||node.closest('[hidden],[inert],[aria-hidden=true]')||!node.getClientRects().length)return false;
    const style=view.getComputedStyle(node);
    return style.visibility!=='hidden'&&style.visibility!=='collapse'&&style.display!=='none';
  }catch{return false;}
}
function focusable(node) {
  return visible(node)&&!node.disabled&&!node.matches(':disabled,[aria-disabled=true]')&&
    (node.tabIndex>=0||node.matches('textarea,input,select,button,a[href],[contenteditable=true]'));
}

/** DOS keyboard chrome around the canonical IDE. The only additional keyboard
 * binding is F6/Shift+F6; every existing shortcut remains owned by the original
 * editor/menu/debugger path. Focus history is ephemeral and node scoped. */
export class DOSShell {
  constructor(ide,{onError=()=>{}}={}) {
    this.ide=ide;this.onError=onError;this.documents=new Map();this.focusHistory=new WeakMap();
    this.disposed=false;this.pending=false;
    const original=this.originalUpdate=ide.updateCommandState,shell=this;
    this.update=function(...args){const result=original?.apply(this,args);shell.schedule();return result;};
    ide.updateCommandState=this.update;
  }
  attach(document) {
    if(this.disposed||this.documents.has(document))return this.documents.get(document);
    const root=document===this.ide.root.ownerDocument?this.ide.root:document.querySelector('.browser-window-root');
    if(!root)return null;
    const record={document,root,modifiers:dosModifiers(),buttons:[],lastFocus:null,lastPane:null,offs:[]};
    const bar=document.createElement('div');bar.className='dos-function-bar';bar.setAttribute('role','toolbar');
    bar.setAttribute('aria-label','DOS function keys');bar.setAttribute('aria-orientation','horizontal');
    for(let index=0;index<10;index++){
      const button=document.createElement('button'),key=document.createElement('kbd'),label=document.createTextNode('');
      button.type='button';button.tabIndex=index===0?0:-1;button.append(key,label);bar.append(button);
      button.addEventListener('click',()=>this.activate(record,index));
      record.buttons.push({button,key,label,entry:null});
    }
    record.bar=bar;
    if(root===this.ide.root)this.ide.statusbar.before(bar);else root.append(bar);
    this.documents.set(document,record);
    const listen=(node,type,handler,capture=false)=>{node.addEventListener(type,handler,capture);record.offs.push(()=>node.removeEventListener(type,handler,capture));};
    listen(document,'keydown',event=>{
      record.modifiers=dosModifiers(event);this.schedule();
      if(event.key!=='F6'||event.ctrlKey||event.metaKey||event.altKey||event.isComposing||event.keyCode===229||event.defaultPrevented||!root.contains(event.target)||this.blocked(record))return;
      const id=event.shiftKey?'dosPreviousPane':'dosNextPane';
      if(this.panes(record).length>1){event.preventDefault();event.stopPropagation();this.invoke(id,record);}
    },true);
    listen(document,'keyup',event=>{record.modifiers=dosModifiers(event);this.schedule();},true);
    listen(document,'pointerdown',event=>{record.modifiers=dosModifiers(event);this.schedule();},true);
    listen(document,'click',()=>this.schedule(),true);
    listen(document,'focusin',event=>{
      if(root.contains(event.target)&&!bar.contains(event.target)&&!event.target.closest('.menubar,.classic-menu')){
        record.lastFocus=event.target;
        const pane=event.target.closest(PANES);
        if(pane&&root.contains(pane)){record.lastPane=pane;this.focusHistory.set(pane,event.target);}
      }
      if(bar.contains(event.target))this.rove(record,event.target);
      this.schedule();
    },true);
    listen(document.defaultView,'blur',()=>{record.modifiers=dosModifiers();this.schedule();});
    listen(document,'visibilitychange',()=>{if(document.hidden){record.modifiers=dosModifiers();this.schedule();}});
    listen(bar,'keydown',event=>this.navigateBar(record,event));
    this.schedule();return record;
  }
  blocked(record) {
    return hasUIDialog()||menuIsOpen()||[...record.document.querySelectorAll(POPUPS)].some(visible);
  }
  owns(record) {
    return !this.disposed&&this.documents.get(record.document)===record&&
      !record.document.defaultView?.closed&&record.root.isConnected&&record.bar.isConnected&&
      record.root.ownerDocument===record.document&&record.bar.ownerDocument===record.document&&record.root.contains(record.bar);
  }
  panes(record) {
    return [...record.root.querySelectorAll(PANES)].filter(node=>
      node.ownerDocument===record.document&&!node.matches('.mdi-minimized')&&visible(node));
  }
  context(record) {
    const ide=this.ide,mdi=ide.documents?.mdi,win=mdi?.windows.get(mdi.active||ide.activeDoc?.key);
    const source=!!ide.activeModule&&!!ide.editor?.root&&visible(ide.editor.root);
    return {panes:this.panes(record).length,documents:mdi?.windows.size||0,document:!!win,
      detached:!!win&&!!ide.browserWindows?.has('document:'+win.key),maximized:win?.maximized,
      menu:!!record.root.querySelector('.menubar'),source,runState:ide.runState,blocked:this.blocked(record)};
  }
  schedule() {
    if(this.disposed||this.pending)return;
    this.pending=true;queueMicrotask(()=>{this.pending=false;if(!this.disposed)this.refresh();});
  }
  refresh() {
    if(this.disposed)return;
    const menus=[];
    for(const name of MENUS){if(this.disposed)return;menus.push(this.ide.menu(name));}
    const commands=dosMenuCommands(menus);
    for(const record of [...this.documents.values()]){
      if(!this.owns(record))continue;
      const focused=record.document.activeElement,wasFocused=record.bar.contains(focused);
      const entries=dosFunctionKeys(record.modifiers,commands,this.context(record));
      setAttribute(record.bar,'data-dos-modifiers',record.modifiers.page);
      for(let index=0;index<entries.length;index++){
        if(!this.owns(record))break;
        const item=record.buttons[index],entry=entries[index];item.entry=entry;
        if(item.key.textContent!==entry.displayKey)item.key.textContent=entry.displayKey;
        if(item.label.data!==entry.label)item.label.data=entry.label;
        if(item.button.disabled===entry.enabled)item.button.disabled=!entry.enabled;
        if(!this.owns(record))break;
        setAttribute(item.button,'data-dos-command',entry.id||'');
        setAttribute(item.button,'aria-keyshortcuts',entry.shortcut);
        setAttribute(item.button,'aria-label',entry.label?entry.title+' ('+entry.shortcut+')':entry.shortcut+' — no DOS command');
        setAttribute(item.button,'title',entry.label?entry.title+' ('+entry.shortcut+')':'');
      }
      if(!this.owns(record))continue;
      const previous=record.buttons.find(item=>item.button.tabIndex===0)?.button;
      const next=wasFocused&&!focused.disabled?focused:previous&&!previous.disabled?previous:record.buttons.find(item=>!item.button.disabled)?.button;
      this.rove(record,next);
      if(wasFocused&&focused.disabled&&next){next.focus({preventScroll:true});if(this.owns(record))next.scrollIntoView({block:'nearest',inline:'nearest'});}
    }
  }
  rove(record,active) {
    for(const item of record.buttons){const next=item.button===active?0:-1;if(item.button.tabIndex!==next)item.button.tabIndex=next;}
  }
  navigateBar(record,event) {
    if(event.defaultPrevented||event.isComposing||event.altKey||event.ctrlKey||event.metaKey)return;
    if(event.key==='Escape'){
      if(this.returnFocus(record)){event.preventDefault();event.stopPropagation();}return;
    }
    if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;
    const buttons=record.buttons.map(item=>item.button).filter(focusable);
    const index=buttons.indexOf(record.document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:dosCycleIndex(buttons.length,index,event.key==='ArrowLeft'?-1:1);
    if(next<0)return;event.preventDefault();event.stopPropagation();
    this.rove(record,buttons[next]);buttons[next].focus({preventScroll:true});buttons[next].scrollIntoView({block:'nearest',inline:'nearest'});
  }
  returnFocus(record) {
    if(focusable(record.lastFocus)){record.lastFocus.focus({preventScroll:true});return record.document.activeElement===record.lastFocus;}
    const pane=this.panes(record).find(node=>node===record.lastPane)||this.panes(record)[0];
    return !!pane&&this.focusPane(record,pane);
  }
  focusPane(record,pane) {
    const remembered=this.focusHistory.get(pane),nodes=[remembered,...pane.querySelectorAll(PREFERRED),...pane.querySelectorAll(FOCUSABLE)];
    for(const node of new Set(nodes)){
      if(!node||!pane.contains(node)||!focusable(node))continue;
      node.focus({preventScroll:true});
      if(record.document.activeElement===node){if(this.owns(record))record.lastPane=pane;return true;}
    }
    return false;
  }
  cycle(record,direction) {
    const panes=this.panes(record);if(panes.length<2)return false;
    const active=record.document.activeElement,index=panes.findIndex(node=>node.contains(active)||record.bar.contains(active)&&node===record.lastPane);
    let next=dosCycleIndex(panes.length,index,direction);
    for(let count=0;count<panes.length;count++){
      if(this.focusPane(record,panes[next]))return true;
      next=dosCycleIndex(panes.length,next,direction);
    }
    return false;
  }
  activate(record,index) {
    if(!this.owns(record)||this.blocked(record))return;
    // A programmatic project/run-state change may have happened since paint.
    this.refresh();if(!this.owns(record)||this.blocked(record))return;
    const entry=record.buttons[index]?.entry;
    if(!entry?.enabled)return;
    // Restoring native focus can synchronously switch documents, open a modal,
    // change command availability or retire/recreate this document's shell.
    this.returnFocus(record);if(!this.owns(record)||this.blocked(record))return;
    this.refresh();if(!this.owns(record)||this.blocked(record))return;
    const current=record.buttons[index]?.entry;
    if(current?.id===entry.id&&current.enabled)this.invoke(entry.id,record);
  }
  invoke(id,record) {
    if(!this.owns(record)||this.blocked(record))return;
    try{Promise.resolve(this.ide.command(id,{document:record.document})).catch(this.onError).finally(()=>this.schedule());}
    catch(error){this.onError(error);}
  }
  handles(id) {return DOS_SHELL_COMMANDS.includes(id);}
  command(id,{document=uiDocument()}={}) {
    const record=this.documents.get(document)||this.documents.get(this.ide.root.ownerDocument);
    if(!record||!this.owns(record)||this.blocked(record))return false;
    const mdi=this.ide.documents?.mdi,win=mdi?.windows.get(mdi.active||this.ide.activeDoc?.key);
    if(id==='dosNextPane'||id==='dosPreviousPane')return this.cycle(record,id==='dosNextPane'?1:-1);
    if(id==='dosFocusMenu'){
      const button=record.root.querySelector('.menubar>button');if(!focusable(button)&&(!visible(button)||button.disabled))return false;
      this.ide.menuReturnFocus=record.lastFocus||record.document.activeElement;button.focus({preventScroll:true});return true;
    }
    if(id==='dosNextDocument'||id==='dosPreviousDocument'){mdi?.cycle(id==='dosNextDocument'?1:-1);return true;}
    if(id==='dosCloseDocument')return win?this.ide.closeDocument(win.key):false;
    if(id==='dosMaximizeDocument')return win?mdi.maximize(win.key):false;
    if(id==='dosFindPrevious')return this.ide.editor?.find(-1);
    return false;
  }
  detach(document) {
    const record=this.documents.get(document);if(!record)return;
    this.documents.delete(document);for(const off of record.offs)off();
    if(record.bar.contains(document.activeElement))this.returnFocus(record);
    record.bar.remove();record.buttons.length=0;record.lastFocus=record.lastPane=null;
  }
  dispose() {
    if(this.disposed)return;this.disposed=true;
    for(const document of [...this.documents.keys()])this.detach(document);
    if(this.ide.updateCommandState===this.update)this.ide.updateCommandState=this.originalUpdate;
    this.focusHistory=new WeakMap();
  }
}
