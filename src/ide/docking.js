import {uiDocument} from '../core/window-context.js';
import {keyboardTransaction} from './keyboard-transaction.js';
import {el,download} from '../core/core.js';
import {showMenu,promptDialog,alertDialog,modal} from './ui.js';
import {DockLayout,DOCK_EDGES,constrainDockRect} from './dock-layout.js';

/** Live DOM docking: tool bodies are moved, never serialized/recreated on layout
 * changes. The model is separately validated and can be restored atomically. */
export class DockManager {
  constructor(ide){
    this.ide=ide;this.model=new DockLayout();this.panels=new Map();this.views=new Map();this.zones=new Map();this.order=20;
    this.root=ide.workspace;this.root.classList.add('dock-workspace');
    ide.debugResizer.remove();ide.projectResizer.remove();ide.rightResizer.remove();
    this.root.replaceChildren();
    for(const edge of DOCK_EDGES){const zone=el('div',{class:'dock-zone dock-zone-'+edge,'data-dock-edge':edge});this.zones.set(edge,zone);this.root.append(zone);const splitter=el('div',{class:'dock-edge-splitter dock-edge-splitter-'+edge,role:'separator',tabindex:0,'aria-label':'Resize '+edge+' dock','aria-orientation':['left','right'].includes(edge)?'vertical':'horizontal'});splitter.dataset.edge=edge;this.root.append(splitter);splitter.addEventListener('pointerdown',e=>this.resizeEdge(edge,e));splitter.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home'].includes(e.key))return;e.preventDefault();const positive=['ArrowRight','ArrowDown'].includes(e.key)?1:-1,sign=['right','bottom'].includes(edge)?-1:1;this.model.sizes[edge]=e.key==='Home'?({left:74,right:250,top:170,bottom:190})[edge]:Math.max(40,Math.min(1400,this.model.sizes[edge]+positive*sign*(e.ctrlKey?1:8)));this.reflow();this.changed();});}
    ide.center.classList.add('dock-center');this.root.append(ide.center);
    this.preview=el('div',{class:'dock-drop-preview',hidden:true,'aria-hidden':'true'});this.root.append(this.preview);
    this.root.addEventListener('focusin',e=>{const view=e.target.closest('.dock-group');if(view){for(const v of this.views.values())v.classList.toggle('dock-active',v===view);if(view.classList.contains('dock-floating'))view.style.zIndex=String(++this.order);}});
    this.observer=new ResizeObserver(()=>this.reflow());this.observer.observe(this.root);
  }
  register(id,panel,options={}){
    this.panels.set(id,{panel,title:options.title||panel.getAttribute('aria-label')||id});panel.dataset.dockWindow=id;panel.classList.add('managed-panel');this.model.register(id,options);
    const header=panel.querySelector('.tool-caption');if(header){header.tabIndex=0;header.setAttribute('aria-label',this.title(id)+' window title');header.title='Drag to dock or float; double-click to toggle; Ctrl+Enter to toggle';const detach=el('button',{class:'browser-detach','data-browser-detach':'',disabled:this.browserWindows?.enabled===false,title:'Float in Browser Window','aria-label':'Float '+this.title(id)+' in Browser Window',onclick:()=>this.detach?.(id)},'↗');header.insertBefore(detach,header.querySelector('button'));header.addEventListener('pointerdown',e=>{if(!e.target.closest('button'))this.drag(id,e);});header.addEventListener('dblclick',e=>{if(!e.target.closest('button'))this.toggleFloat(id);});header.addEventListener('keydown',e=>{if(e.ctrlKey&&e.key==='Enter'){e.preventDefault();this.toggleFloat(id);}else if((e.shiftKey&&e.key==='F10')||e.key==='ContextMenu'){e.preventDefault();const r=header.getBoundingClientRect();this.menu(id,r.left,r.bottom);}else if(e.altKey&&e.key==='F4'){e.preventDefault();this.show(id,false);}});header.addEventListener('contextmenu',e=>{e.preventDefault();this.menu(id,e.clientX,e.clientY);});}
    this.render();return this.model.windows.get(id);
  }
  unregister(id){this.returnToIDE(id);this.panels.get(id)?.panel.remove();this.panels.delete(id);this.model.unregister(id);this.render();}
  returnToIDE(id){const group=this.group(id);if(group)this.browserWindows?.attach('dock:'+group.id,'layout');}
  title(id){return this.panels.get(id)?.title||id;}
  group(id){return this.model.groups.get(this.model.windows.get(id)?.group);}
  show(id,value=true,focus=false){if(!this.model.windows.has(id))return;this.model.show(id,value);this.render();if(value&&focus)this.focus(id);this.changed();}
  focus(id){const g=this.group(id);if(g)this.browserWindows?.focus('dock:'+g.id);const p=this.panels.get(id)?.panel;if(!p)return;const target=p.querySelector('input:not([disabled]),textarea:not([disabled]),[role=tree],.tool-list,[tabindex="0"],button:not([disabled])');target?.focus({preventScroll:true});}
  activate(id,focus=false){this.model.activate(id);this.render();if(focus)this.focus(id);this.changed();}
  toggleFloat(id){this.returnToIDE(id);const group=this.group(id);if(group?.edge==='float'&&this.model.windows.get(id).dockable)this.model.redock(id);else this.float(id,false);this.render();this.changed();this.panels.get(id)?.panel.querySelector('.tool-caption')?.focus();}
  float(id,render=true){this.returnToIDE(id);const panel=this.panels.get(id)?.panel;if(!panel)return;const r=panel.getBoundingClientRect(),base=this.root.getBoundingClientRect();this.model.float(id,constrainDockRect({x:r.left-base.left-30,y:r.top-base.top+20,width:Math.max(210,r.width),height:Math.max(150,r.height)},base.width,base.height));if(render){this.render();this.changed();}}
  dock(id,edge,target=null){this.returnToIDE(id);if(this.model.dock(id,edge,target)){this.render();this.changed();return true;}return false;}
  menu(id,x,y){const window=this.model.windows.get(id),g=this.group(id),others=[...this.model.groups.values()].filter(n=>n.id!==g.id&&n.edge!=='float'&&this.model.visible(n).length);showMenu([
    {label:this.browserWindows?.has('dock:'+g.id)?'Return to IDE':'Float in Browser Window',enabled:this.browserWindows?.enabled!==false,action:()=>this.browserWindows?.has('dock:'+g.id)?this.returnToIDE(id):this.detach?.(id)},null,
    {label:'Dockable',checked:window.dockable,action:()=>{this.returnToIDE(id);this.model.setDockable(id,!window.dockable);this.render();this.changed();}},
    {label:g.edge==='float'?'Dock to Previous Position':'Float',enabled:g.edge!=='float'||window.dockable,action:()=>this.toggleFloat(id)},
    {label:'Dock to',enabled:window.dockable,items:DOCK_EDGES.map(edge=>({label:edge[0].toUpperCase()+edge.slice(1),checked:g.edge===edge,action:()=>this.dock(id,edge)}))},
    {label:'Tab with',enabled:window.dockable&&!!others.length,items:others.map(group=>({label:this.model.visible(group).map(n=>this.title(n)).join(' / '),action:()=>this.dock(id,group.edge,group.id)}))},null,
    {label:'Move',enabled:g.edge==='float',action:()=>this.keyboardBounds(id,false)},
    {label:'Size',enabled:g.edge==='float',action:()=>this.keyboardBounds(id,true)},null,
    {label:'Hide',action:()=>this.show(id,false)}
  ],x,y);}
  createView(group){
    const view=el('section',{class:'dock-group','data-dock-group':group.id}),body=el('div',{class:'dock-group-body'}),tabs=el('div',{class:'dock-tabbar',role:'tablist','aria-label':'Docked windows'});view.append(body,tabs);view._body=body;view._tabs=tabs;
    for(const edge of ['n','s','e','w','ne','nw','se','sw']){const handle=el('div',{class:'dock-resize dock-resize-'+edge,'data-size-edge':edge});handle.addEventListener('pointerdown',e=>this.resizeFloating(group.id,edge,e));view.append(handle);}
    this.views.set(group.id,view);return view;
  }
  render(){
    const focused=uiDocument().activeElement,focusTab=focused?.closest('[role=tab]')?.dataset.windowId;let selection;if(focused&&typeof focused.selectionStart==='number')selection=[focused.selectionStart,focused.selectionEnd,focused.selectionDirection];
    // Remove orphan groups only after their live tool bodies have moved elsewhere.
    for(const g of this.model.groups.values()){
      const ids=this.model.visible(g),view=this.views.get(g.id)||this.createView(g);view.hidden=!ids.length;if(!ids.length){this.browserWindows?.attach('dock:'+g.id,'hidden');continue;}
      const parent=this.browserWindows?.mount('dock:'+g.id)||(g.edge==='float'?this.root:this.zones.get(g.edge));if(view.parentNode!==parent)parent.append(view);
      view.classList.toggle('dock-floating',g.edge==='float');view.classList.toggle('dock-sideways',['top','bottom'].includes(g.edge));view.dataset.edge=g.edge;view.style.flex=String(g.weight||1)+' 1 0px';
      const active=ids.includes(g.active)?g.active:ids[0];g.active=active;
      for(const id of g.tabs){const panel=this.panels.get(id)?.panel;if(!panel)continue;if(panel.parentNode!==view._body)view._body.append(panel);panel.hidden=id!==active;panel.classList.toggle('panel-floating',g.edge==='float');panel.style.cssText='';panel.setAttribute('aria-hidden',String(id!==active));}
      view._tabs.hidden=ids.length<2;view._tabs.replaceChildren(...ids.map(id=>{const tab=el('button',{role:'tab','data-window-id':id,'aria-selected':String(id===active),tabindex:id===active?0:-1,onclick:()=>this.activate(id,true)},this.title(id));tab.addEventListener('pointerdown',e=>this.drag(id,e));tab.addEventListener('contextmenu',e=>{e.preventDefault();this.menu(id,e.clientX,e.clientY);});tab.addEventListener('keydown',e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const index=ids.indexOf(id),next=e.key==='Home'?0:e.key==='End'?ids.length-1:(index+(e.key==='ArrowRight'?1:-1)+ids.length)%ids.length;this.activate(ids[next]);this.views.get(g.id)?._tabs.querySelector('[aria-selected="true"]')?.focus();}});return tab;}));
      if(g.edge==='float')this.placeFloating(g,view);else {for(const key of ['left','top','width','height','zIndex'])view.style[key]='';}
    }
    for(const [id,view]of this.views)if(!this.model.groups.has(id)){this.browserWindows?.attach('dock:'+id,'remove');this.browserWindows?.pending.delete('dock:'+id);view.remove();this.views.delete(id);}
    for(const [id,{panel}]of this.panels){const w=this.model.windows.get(id);if(w.hidden)panel.hidden=true;}
    this.groupSplitters();this.reflow();
    if(focusTab){for(const view of this.views.values()){const tab=[...view._tabs.children].find(n=>n.dataset.windowId===focusTab);if(tab&&!view.hidden&&!view._tabs.hidden){tab.focus({preventScroll:true});break;}}}
    else if(focused?.isConnected&&!focused.closest('[hidden]')){focused.focus({preventScroll:true});if(selection)try{focused.setSelectionRange(...selection);}catch{}}
  }
  groupSplitters(){for(const [edge,zone]of this.zones){for(const splitter of zone.querySelectorAll(':scope > .dock-group-splitter'))splitter.remove();const groups=[...zone.children].filter(n=>!n.hidden&&n.classList.contains('dock-group'));groups.forEach((view,i)=>{if(i===groups.length-1)return;const next=groups[i+1],splitter=el('div',{class:'dock-group-splitter',role:'separator',tabindex:0,'aria-orientation':['top','bottom'].includes(edge)?'vertical':'horizontal','aria-label':'Resize adjacent dock groups'});view.after(splitter);const update=delta=>{const a=this.model.groups.get(view.dataset.dockGroup),b=this.model.groups.get(next.dataset.dockGroup),sum=a.weight+b.weight;const r=view.getBoundingClientRect(),r2=next.getBoundingClientRect(),pixels=['top','bottom'].includes(edge)?r.width+r2.width:r.height+r2.height;const change=delta/Math.max(1,pixels)*sum;a.weight=Math.max(.1,Math.min(sum-.1,a.weight+change));b.weight=sum-a.weight;view.style.flex=a.weight+' 1 0px';next.style.flex=b.weight+' 1 0px';};splitter.addEventListener('keydown',e=>{if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key))return;e.preventDefault();update((['ArrowRight','ArrowDown'].includes(e.key)?1:-1)*(e.ctrlKey?1:8));this.changed();});splitter.addEventListener('pointerdown',e=>{const axis=['top','bottom'].includes(edge)?'clientX':'clientY';let last=e[axis];this.track(e,move=>{const delta=move[axis]-last;last=move[axis];update(delta);},()=>this.changed());});});}}
  placeFloating(g,view){if(this.browserWindows?.has('dock:'+g.id))return;const r=constrainDockRect(g.bounds,this.root.clientWidth,this.root.clientHeight);Object.assign(view.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});if(!view.style.zIndex)view.style.zIndex=String(++this.order);}
  reflow(){
    const width=this.root.clientWidth,height=this.root.clientHeight;if(!width||!height)return;
    const visible=Object.fromEntries(DOCK_EDGES.map(edge=>[edge,[...this.model.groups.values()].some(g=>g.edge===edge&&!this.browserWindows?.has('dock:'+g.id)&&this.model.visible(g).length)]));
    // Keep a usable document surface while preserving preferred widths on resize.
    let left=visible.left?this.model.sizes.left:0,right=visible.right?this.model.sizes.right:0,top=visible.top?this.model.sizes.top:0,bottom=visible.bottom?this.model.sizes.bottom:0;
    const maxSides=Math.max(80,width-Math.min(260,width*.48)-10),sideRatio=Math.min(1,maxSides/Math.max(1,left+right));left*=sideRatio;right*=sideRatio;
    const maxVertical=Math.max(70,height-Math.min(160,height*.42)-10),verticalRatio=Math.min(1,maxVertical/Math.max(1,top+bottom));top*=verticalRatio;bottom*=verticalRatio;
    for(const [edge,size]of Object.entries({left,right,top,bottom})){this.root.style.setProperty('--dock-'+edge,size+'px');this.root.style.setProperty('--dock-gap-'+edge,visible[edge]?'4px':'0px');this.zones.get(edge).hidden=!visible[edge];const split=this.root.querySelector('.dock-edge-splitter-'+edge);split.hidden=!visible[edge];split.setAttribute('aria-valuenow',String(Math.round(size)));split.setAttribute('aria-valuemin','40');split.setAttribute('aria-valuemax','1400');}
    for(const g of this.model.groups.values())if(g.edge==='float'&&this.views.get(g.id))this.placeFloating(g,this.views.get(g.id));
  }
  changed(){this.ide.autosave();}
  track(start,move,end,cancel=end){
    if(start.button!==0)return;this.cancelInteraction?.();start.preventDefault();const pid=start.pointerId;let done=false;
    const cleanup=()=>{if(done)return false;done=true;window.removeEventListener('pointermove',moved);window.removeEventListener('pointerup',finish);window.removeEventListener('pointercancel',abort);window.removeEventListener('keydown',abort,true);window.removeEventListener('blur',abort);if(this.cancelInteraction===abort)this.cancelInteraction=null;return true;};
    const moved=e=>{if(e.pointerId===pid)move(e);},finish=e=>{if(e.pointerId===pid&&cleanup())end(e);},abort=e=>{if(e?.type==='keydown'&&e.key!=='Escape'||e?.type==='pointercancel'&&e.pointerId!==pid)return;e?.preventDefault?.();if(e?.type==='keydown')e.stopImmediatePropagation();if(cleanup())cancel(e);};
    this.cancelInteraction=abort;window.addEventListener('pointermove',moved);window.addEventListener('pointerup',finish);window.addEventListener('pointercancel',abort);window.addEventListener('keydown',abort,true);window.addEventListener('blur',abort);
  }
  resizeEdge(edge,event){const value=this.model.sizes[edge],horizontal=['left','right'].includes(edge),start=horizontal?event.clientX:event.clientY,sign=['right','bottom'].includes(edge)?-1:1;this.track(event,e=>{this.model.sizes[edge]=Math.max(40,Math.min(1400,value+((horizontal?e.clientX:e.clientY)-start)*sign));this.reflow();},()=>this.changed(),()=>{this.model.sizes[edge]=value;this.reflow();});}
  resizeFloating(id,edge,event){const g=this.model.groups.get(id);if(!g||g.edge!=='float')return;event.stopPropagation();const old={...g.bounds},x=event.clientX,y=event.clientY;this.track(event,e=>{const dx=e.clientX-x,dy=e.clientY-y,r={...old};if(edge.includes('e'))r.width=Math.max(120,old.width+dx);if(edge.includes('s'))r.height=Math.max(80,old.height+dy);if(edge.includes('w')){r.width=Math.max(120,old.width-dx);r.x=old.x+old.width-r.width;}if(edge.includes('n')){r.height=Math.max(80,old.height-dy);r.y=old.y+old.height-r.height;}g.bounds=constrainDockRect(r,this.root.clientWidth,this.root.clientHeight);this.placeFloating(g,this.views.get(id));},()=>this.changed(),()=>{g.bounds=old;this.placeFloating(g,this.views.get(id));});}
  keyboardBounds(id,size){const g=this.group(id);if(g?.edge!=='float')return;const old={...g.bounds},header=this.panels.get(id).panel.querySelector('.tool-caption');header.focus();this.ide.status((size?'Size':'Move')+': arrow keys; Ctrl for one pixel; Enter to accept; Escape to cancel.');
    const finish=()=>{if(this.views.has(g.id))this.placeFloating(g,this.views.get(g.id));this.changed();this.ide.status('Ready');};
    keyboardTransaction(this,{step:(dx,dy)=>{g.bounds=constrainDockRect({...g.bounds,[size?'width':'x']:g.bounds[size?'width':'x']+dx,[size?'height':'y']:g.bounds[size?'height':'y']+dy},this.root.clientWidth,this.root.clientHeight);this.placeFloating(g,this.views.get(g.id));},commit:finish,cancel:()=>{g.bounds=old;finish();}});
  }
  drag(id,event){if(this.browserWindows?.has('dock:'+this.group(id)?.id))return;if(event.button!==0)return;const before=this.model.snapshot(),start={x:event.clientX,y:event.clientY},r=this.panels.get(id).panel.getBoundingClientRect(),base=this.root.getBoundingClientRect();let moved=false,target=null,g;this.track(event,e=>{
      if(!moved&&Math.hypot(e.clientX-start.x,e.clientY-start.y)<5)return;
      if(!moved){moved=true;this.model.float(id,{x:r.left-base.left,y:r.top-base.top,width:Math.max(210,r.width),height:Math.max(150,r.height)});this.render();g=this.group(id);}
      g.bounds=constrainDockRect({...g.bounds,x:r.left-base.left+e.clientX-start.x,y:r.top-base.top+e.clientY-start.y},this.root.clientWidth,this.root.clientHeight);this.placeFloating(g,this.views.get(g.id));
      target=null;if(!e.ctrlKey&&this.model.windows.get(id).dockable){const x=e.clientX-base.left,y=e.clientY-base.top,margin=30;if(x<margin)target={edge:'left'};else if(x>base.width-margin)target={edge:'right'};else if(y<margin)target={edge:'top'};else if(y>base.height-margin)target={edge:'bottom'};else for(const other of this.model.groups.values()){if(other.id===g.id||other.edge==='float'||!this.model.visible(other).length)continue;const rect=this.views.get(other.id).getBoundingClientRect();if(e.clientX>=rect.left&&e.clientX<=rect.right&&e.clientY>=rect.top&&e.clientY<=rect.bottom){target={edge:other.edge,group:other.id};break;}}}
      this.showPreview(target);
    },()=>{this.preview.hidden=true;if(moved){if(target)this.model.dock(id,target.edge,target.group);this.render();this.changed();}},()=>{this.preview.hidden=true;if(moved){this.model.restore(before);this.render();}});
  }
  showPreview(target){this.preview.hidden=!target;if(!target)return;const base=this.root.getBoundingClientRect();let r;if(target.group){const rect=this.views.get(target.group).getBoundingClientRect();r={x:rect.left-base.left,y:rect.top-base.top,width:rect.width,height:rect.height};}else{const side=['left','right'].includes(target.edge),width=side?Math.min(this.model.sizes[target.edge],base.width*.4):base.width,height=side?base.height:Math.min(this.model.sizes[target.edge],base.height*.4);r={x:target.edge==='right'?base.width-width:0,y:target.edge==='bottom'?base.height-height:0,width,height};}Object.assign(this.preview.style,{left:r.x+'px',top:r.y+'px',width:r.width+'px',height:r.height+'px'});this.preview.textContent=target.group?'Tab group':'Dock '+target.edge;}
  snapshot(){return this.model.snapshot();}
  restore(value){this.model.restore(value);this.render();}
  dispose(){this.cancelInteraction?.();this.observer.disconnect();}
}

export function installDocking(ide){
  const manager=ide.docking=new DockManager(ide);
  manager.register('toolbox',ide.toolbox,{edge:'left',title:'Toolbox'});
  manager.register('project',ide.projectPanel,{edge:'right',title:'Project Explorer',weight:1});
  manager.register('properties',ide.propertiesPanel,{edge:'right',title:'Properties',weight:2.1});
  manager.register('layout',ide.layoutPanel,{edge:'right',title:'Form Layout',weight:.65});
  manager.register('debug',ide.debugDock,{edge:'bottom',title:'Debug',hidden:true});
  ide.right.hidden=true;
  const oldSnapshot=ide.layoutSnapshot.bind(ide),oldRestore=ide.restoreLayout.bind(ide),oldToggle=ide.togglePanel.bind(ide),oldMenu=ide.menu.bind(ide),oldCommand=ide.command.bind(ide);
  ide.namedLayouts=Object.create(null);
  ide.layoutSnapshot=()=>({...oldSnapshot(),docking:manager.snapshot(),namedLayouts:ide.namedLayouts});
  ide.restoreLayout=layout=>{if(!layout)return;oldRestore(layout);if(layout.docking)try{manager.restore(layout.docking);}catch(error){ide.status('Invalid saved layout ignored: '+error.message);}else{for(const [id,key]of [['toolbox','hideToolbox'],['project','hideProject'],['properties','hideProperties'],['layout','hideLayout'],['debug','hideDebug']])manager.model.show(id,id==='debug'?layout[key]===false:!layout[key]);manager.render();}if(layout.namedLayouts&&typeof layout.namedLayouts==='object'){ide.namedLayouts=Object.create(null);for(const [key,value]of Object.entries(layout.namedLayouts).slice(0,20))if(key.length<=64&&value?.version===1)Object.defineProperty(ide.namedLayouts,key,{value,enumerable:true,writable:true,configurable:true});}};
  ide.togglePanel=(id,show)=>{if(manager.model.windows.has(id)){const window=manager.model.windows.get(id),visible=show===undefined?window.hidden:!!show;ide.root.classList.toggle('hidden-'+id,!visible);manager.show(id,visible);return;}return oldToggle(id,show);};
  ide.updateDockVisibility=()=>manager.reflow();
  ide.menu=name=>{const items=oldMenu(name);if(name==='Window')items.splice(items.findIndex(x=>x?.id==='resetLayout'),0,{id:'saveWindowLayout',label:'Save Window Layout…'},{label:'Restore Window Layout',enabled:!!Object.keys(ide.namedLayouts).length,items:Object.keys(ide.namedLayouts).map(key=>({label:key,action:()=>{ide.applyWindowLayout?ide.applyWindowLayout(ide.namedLayouts[key]):manager.restore(ide.namedLayouts[key]);manager.changed();}}))},{id:'manageWindowLayouts',label:'Manage Window Layouts…'},null);if(name==='View')items.push(null,{label:'Dock Windows',items:[...manager.panels].map(([id,p])=>({label:p.title,checked:!manager.model.windows.get(id).hidden,action:()=>manager.show(id,manager.model.windows.get(id).hidden,true)}))});return items;};
  ide.command=async(id,...args)=>{if(id==='resetLayout'){manager.model=new DockLayout();for(const [key]of manager.panels){const edge=key==='toolbox'?'left':['project','properties','layout'].includes(key)?'right':'bottom';manager.model.register(key,{edge,hidden:edge==='bottom',group:edge==='bottom'?'debug-windows':key,weight:key==='properties'?2.1:key==='layout'?.65:1});}manager.render();ide.documents.mdi.arrange('cascade');ide.applyAppearance();manager.changed();return;}
    if(id==='saveWindowLayout'){const name=await promptDialog('Save Window Layout','Layout name:','My Layout');if(name?.trim()){const key=name.trim().slice(0,64);if(!Object.hasOwn(ide.namedLayouts,key)&&Object.keys(ide.namedLayouts).length>=20)return alertDialog('At most 20 named layouts can be saved.','Save Window Layout');Object.defineProperty(ide.namedLayouts,key,{value:ide.captureWindowLayout?.()||manager.snapshot(),enumerable:true,configurable:true,writable:true});manager.changed();}return;}
    if(id==='manageWindowLayouts'){const content=el('div',{class:'layout-manager'}),list=el('select',{size:8,'aria-label':'Saved layouts',style:{width:'100%'}}),refresh=()=>list.replaceChildren(...Object.keys(ide.namedLayouts).map(name=>el('option',{value:name},name)));refresh();content.append(list);await modal('Window Layouts',{content,width:400,buttons:[{label:'Restore',action:()=>{if(list.value){manager.restore(ide.namedLayouts[list.value]);manager.changed();}}},{label:'Delete',action:()=>{delete ide.namedLayouts[list.value];refresh();manager.changed();return false;}},{label:'Export…',action:()=>{download('VB6-window-layouts.json',JSON.stringify({version:1,layouts:ide.namedLayouts},null,2),'application/json');return false;}},{label:'Close',value:false}]});return;}
    return oldCommand(id,...args);
  };
  return manager;
}
