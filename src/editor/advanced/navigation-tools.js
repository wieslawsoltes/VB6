import {fromRange} from './protocol-converters.js';
import {PeekPanel} from './navigation.js';

const ignored=error=>[-32800,-32801,-32802].includes(error.code);
function node(doc,tag,className,text) {const value=doc.createElement(tag);if(className)value.className=className;if(text!==undefined)value.textContent=text;return value;}

/** Modeless, windowed navigation tools. All source stays in project models;
 * server items/data are passed through unchanged, never interpreted as code. */
export class NavigationTools {
  constructor(runtime) {this.runtime=runtime;this.tools=new Map();}
  open(kind,surface=this.runtime.active()) {
    let tool=this.tools.get(kind);
    if(!tool){tool=new NavigationTool(this,kind);this.tools.set(kind,tool);}
    tool.surface=surface||tool.surface;this.runtime.ide.documents.openTool(tool);tool.start();return tool;
  }
  dispose() {
    for(const tool of [...this.tools.values()]){
      tool.dispose();this.runtime.ide.documents.tools.delete(tool.key);this.runtime.ide.documents.mdi.remove(tool.key);
    }
    this.tools.clear();
  }
}

class NavigationTool {
  constructor(owner,kind) {
    this.owner=owner;this.runtime=owner.runtime;this.kind=kind;this.key='tool:advanced:'+kind;this.title=kind==='symbols'?'Go to Symbol':kind==='call'?'Call Hierarchy':'Type Hierarchy';this.width=650;this.height=460;this.glyph='code';this.generation=0;this.roots=[];this.selected=0;this.rowHeight=32;this.listeners=[];
    const doc=this.runtime.ide.root.ownerDocument;this.root=node(doc,'section','advanced-navigation-tool');this.root.setAttribute('aria-label',this.title);
    const bar=node(doc,'div','advanced-navigation-toolbar');
    const button=(label,action)=>{const value=node(doc,'button','',label);value.type='button';value.addEventListener('click',action);bar.append(value);return value;};
    if(kind==='symbols'){
      this.query=node(doc,'input');this.query.type='search';this.query.placeholder='Search project symbols';this.query.setAttribute('aria-label','Search project symbols');this.query.maxLength=256;bar.append(this.query);
      this.query.addEventListener('input',()=>{this.cancel();this.stale=true;this.roots=[];this.status.textContent='Searching…';this.render();clearTimeout(this.timer);this.timer=setTimeout(()=>this.start(),180);});
      this.query.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.start();}else if(event.key==='ArrowDown'){event.preventDefault();this.list.focus();}});
    }else{
      this.direction=node(doc,'select');this.direction.setAttribute('aria-label','Hierarchy direction');
      for(const [value,label]of kind==='call'?[['incoming','Calls to'],['outgoing','Calls from']]:[['sub','Implementations / subtypes'],['super','Interfaces / supertypes']]){const option=node(doc,'option','',label);option.value=value;this.direction.append(option);}
      bar.append(this.direction);this.direction.addEventListener('change',()=>this.start());
    }
    button('Refresh',()=>this.start());button('Open',()=>this.openSelected());
    if(kind==='call')button('Call sites',()=>this.callSites());
    this.status=node(doc,'div','advanced-navigation-status');this.status.setAttribute('role','status');this.status.setAttribute('aria-live','polite');
    this.list=node(doc,'div','advanced-navigation-list');this.list.tabIndex=0;this.list.setAttribute('role',kind==='symbols'?'listbox':'tree');this.list.setAttribute('aria-label',this.title+' results');
    this.rows=node(doc,'div','advanced-navigation-rows');this.list.append(this.rows);this.root.append(bar,this.status,this.list);
    this.list.addEventListener('scroll',()=>this.render());this.root.addEventListener('keydown',event=>event.stopPropagation());
    this.list.addEventListener('keydown',event=>{
      if(!['ArrowDown','ArrowUp','ArrowLeft','ArrowRight','Home','End','Enter',' '].includes(event.key))return;event.preventDefault();
      const values=this.visible(),selected=values[this.selected];
      if(event.key==='ArrowDown')this.select(this.selected+1);else if(event.key==='ArrowUp')this.select(this.selected-1);
      else if(event.key==='Home')this.select(0);else if(event.key==='End')this.select(values.length-1);
      else if(event.key==='Enter')this.openSelected();else if(event.key==='ArrowRight')this.expand(selected);
      else if(event.key==='ArrowLeft'){if(selected?.expanded){selected.expanded=false;this.render();}else if(selected?.parent)this.select(values.indexOf(selected.parent));}
      else if(selected)this.toggle(selected);
    });
    const Observer=doc.defaultView.ResizeObserver;if(Observer){this.observer=new Observer(()=>this.render());this.observer.observe(this.list);}
    for(const client of new Set(Object.values(this.runtime.clients)))this.listeners.push(client.on('document',()=>this.invalidate()),client.on('closed',()=>this.invalidate()));
  }
  cancel(){this.abort?.abort();this.abort=null;++this.generation;}
  invalidate(){this.cancel();this.stale=true;this.status.textContent='The workspace changed. Refresh to update these results.';this.render();}
  visible(){const result=[];const visit=rows=>{for(const row of rows){result.push(row);if(row.expanded)visit(row.children||[]);}};visit(this.roots);return result;}
  select(index){const length=this.visible().length;this.selected=Math.max(0,Math.min(length-1,index));const top=this.selected*this.rowHeight;if(top<this.list.scrollTop)this.list.scrollTop=top;else if(top+this.rowHeight>this.list.scrollTop+this.list.clientHeight)this.list.scrollTop=top+this.rowHeight-this.list.clientHeight;this.render();}
  render() {
    if(this.disposed)return;const values=this.visible();this.rows.style.height=values.length*this.rowHeight+'px';this.rows.replaceChildren();this.selected=Math.max(0,Math.min(values.length-1,this.selected));
    const first=Math.max(0,Math.floor(this.list.scrollTop/this.rowHeight)-2),last=Math.min(values.length,first+Math.ceil((this.list.clientHeight||400)/this.rowHeight)+4),doc=this.root.ownerDocument;
    this.list.removeAttribute('aria-activedescendant');
    for(let i=first;i<last;i++){
      const row=values[i],value=node(doc,'div','advanced-navigation-row');value.id=this.key.replace(/:/g,'-')+'-'+i;value.style.top=i*this.rowHeight+'px';value.style.paddingLeft=8+row.depth*18+'px';value.setAttribute('role',this.kind==='symbols'?'option':'treeitem');value.setAttribute('aria-selected',String(i===this.selected));value.setAttribute('aria-disabled',String(!!this.stale));
      if(this.kind!=='symbols'){value.setAttribute('aria-level',String(row.depth+1));if(!row.cycle)value.setAttribute('aria-expanded',String(!!row.expanded));}
      const label=node(doc,'span','advanced-navigation-name',(this.kind==='symbols'?'':row.cycle?'↻ ':row.expanded?'▾ ':'▸ ')+String(row.item.name||'Unnamed'));
      const detail=node(doc,'span','advanced-navigation-detail',String(row.item.detail||row.item.containerName||'')+(row.edge?' · '+row.edge.fromRanges.length+' call site(s)':'')+(row.cycle?' · cycle':''));value.append(label,detail);
      value.title=[row.item.name,row.item.detail,row.item.location?.uri||row.item.uri].filter(Boolean).join('\n');
      value.addEventListener('click',()=>{this.select(i);this.list.focus();});value.addEventListener('dblclick',()=>{this.select(i);if(this.kind==='symbols')this.openSelected();else this.toggle(row);});this.rows.append(value);
      if(i===this.selected)this.list.setAttribute('aria-activedescendant',value.id);
    }
  }
  async start() {
    clearTimeout(this.timer);this.cancel();this.stale=false;const generation=this.generation,abort=new AbortController();this.abort=abort;this.roots=[];this.selected=0;this.status.textContent='Loading…';this.render();
    try {
      if(this.kind==='symbols'){
        const clients=[...new Set(Object.values(this.runtime.clients))].filter(c=>c.state==='ready'&&c.capability('workspace/symbol'));
        if(!clients.length)throw new Error('The connected servers do not provide workspace symbols.');
        const results=await Promise.all(clients.map(async client=>({client,items:await client.request('workspace/symbol',{query:this.query.value},{signal:abort.signal,workspace:true})})));
        if(this.disposed||generation!==this.generation)return;
        for(const {client,items}of results)for(const item of items||[]){if(this.roots.length>=5000)break;const uri=item.location?.uri;if(this.runtime.records.has(uri))this.roots.push({client,item,depth:0});}
        this.status.textContent=this.roots.length+' symbol(s)'+(this.roots.length>=5000?' · first 5,000; narrow the search':'');
      }else{
        const surface=this.surface;if(!surface?.view||surface.disposed)throw new Error('Open a source document and choose a symbol first.');
        const record=surface.record,client=record.client,method='textDocument/prepare'+(this.kind==='call'?'Call':'Type')+'Hierarchy';
        if(client.state!=='ready'||!client.capability(method,client.documents.get(record.uri)))throw new Error('This language server does not provide '+this.title.toLowerCase()+'.');
        const position=surface.view.getPosition(),items=await client.request(method,{textDocument:{uri:record.uri},position:{line:position.lineNumber-1,character:position.column-1}},{signal:abort.signal,workspace:true});
        if(this.disposed||generation!==this.generation)return;
        this.roots=(items||[]).filter(item=>this.runtime.records.has(item.uri)).map(item=>({client,item,depth:0,revision:client.revision}));
        this.status.textContent=this.roots.length?'Select a row; Right/Space expands, Enter opens source.':'No source hierarchy at this position.';
        if(this.roots.length===1)await this.expand(this.roots[0]);
      }
      this.render();if(this.kind==='symbols')this.query.focus();else this.list.focus();
    }catch(error){if(this.disposed||generation!==this.generation)return;this.status.textContent=error.message||String(error);if(!ignored(error))this.runtime.report(error);}
  }
  async expand(row) {
    if(!row||this.kind==='symbols'||this.stale||row.cycle||row.loading||this.disposed)return;
    if(row.children){row.expanded=true;this.render();return;}
    if(row.depth>=32){this.status.textContent='Maximum hierarchy depth reached (32). Open a nested symbol to start a new hierarchy.';return;}
    const generation=this.generation,direction=this.direction.value,method=this.kind==='call'?'callHierarchy/'+(direction==='incoming'?'incomingCalls':'outgoingCalls'):'typeHierarchy/'+(direction==='sub'?'subtypes':'supertypes');row.loading=true;
    try {
      const values=await row.client.request(method,{item:row.item},{signal:this.abort?.signal,workspace:true});
      if(this.disposed||generation!==this.generation||row.revision!==row.client.revision)return;
      const remaining=Math.max(0,5000-this.visible().length);
      row.children=(values||[]).slice(0,remaining).map(value=>{
        const item=this.kind==='call'?(direction==='incoming'?value.from:value.to):value;
        if(!this.runtime.records.has(item.uri))return null;
        let cycle=false;for(let ancestor=row;ancestor;ancestor=ancestor.parent)if(ancestor.item.uri===item.uri&&JSON.stringify(ancestor.item.selectionRange)===JSON.stringify(item.selectionRange)&&ancestor.item.name===item.name){cycle=true;break;}
        return {client:row.client,item,parent:row,depth:row.depth+1,edge:this.kind==='call'?value:null,direction,revision:row.revision,cycle};
      }).filter(Boolean);row.expanded=true;
      this.status.textContent=row.children.length?'Right expands; Left collapses; Enter opens source.': 'No '+this.direction.selectedOptions[0].textContent.toLowerCase()+' found.';
      if((values||[]).length>remaining)this.status.textContent+=' Result limit reached; open a nested symbol to narrow the search.';
      this.render();
    }catch(error){if(!this.disposed&&generation===this.generation){this.status.textContent=error.message;if(error.code===-32801)this.invalidate();else if(!ignored(error))this.runtime.report(error);}}
    finally{row.loading=false;}
  }
  toggle(row){if(row.expanded){row.expanded=false;this.render();}else this.expand(row);}
  async openSelected() {
    const row=this.visible()[this.selected];if(!row||this.stale||this.disposed)return;const generation=this.generation;
    try {
      let item=row.item;
      if(this.kind==='symbols'&&!item.location?.range){if(!row.client.capability('workspace/symbol')?.resolveProvider)throw new Error('The server supplied no source range for this symbol.');item=await row.client.request('workspaceSymbol/resolve',item,{signal:this.abort?.signal,workspace:true});}
      if(this.disposed||generation!==this.generation)return;
      const uri=item.location?.uri||item.uri,range=item.location?.range||item.selectionRange||item.range;
      if(!this.runtime.records.has(uri)||!range)throw new Error('The symbol is outside the current project.');this.runtime.open(uri,fromRange(range));
    }catch(error){if(!ignored(error))this.runtime.report(error);}
  }
  callSites() {
    const row=this.visible()[this.selected],surface=this.surface;if(!row?.edge||!surface?.view||surface.disposed||this.stale)return;
    const uri=row.direction==='incoming'?row.item.uri:row.parent.item.uri,locations=row.edge.fromRanges.map(range=>({uri,range}));
    if(!locations.length)return;this.runtime.open(surface.record.uri);surface.peek?.dispose(false);surface.peek=new PeekPanel(surface,locations,'Call sites');
  }
  dispose(){if(this.disposed)return;this.disposed=true;this.cancel();clearTimeout(this.timer);this.observer?.disconnect();for(const unlisten of this.listeners)unlisten();this.owner.tools.delete(this.kind);this.root.remove();}
}
