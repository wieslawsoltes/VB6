import {el} from '../core/core.js';
import {ToolList} from './virtual-list.js';
import {buildObjectCatalog,searchCatalog} from './object-catalog.js';
import {resizeHandle,icon} from './ui.js';

/** Modeless, live-source browser; never advertises unavailable native type libraries. */
export class ObjectBrowser {
  constructor(ide){
    this.ide=ide;this.key='tool:object-browser';this.title='Object Browser';this.width=800;this.height=530;this.glyph='object';this.history=[];this.historyIndex=-1;
    this.root=el('div',{class:'classic-object-browser'});
    this.library=el('select',{'aria-label':'Object Browser library'});this.back=el('button',{title:'Back','aria-label':'Object Browser Back',onclick:()=>this.travel(-1)},icon('undo'));this.forward=el('button',{title:'Forward','aria-label':'Object Browser Forward',onclick:()=>this.travel(1)},icon('redo'));
    this.view=el('button',{'aria-label':'View definition',onclick:()=>this.viewDefinition()},icon('code'),' View Definition');
    this.copy=el('button',{'aria-label':'Copy member signature',onclick:()=>this.copySignature()},icon('copy'));
    this.root.append(el('div',{class:'object-toolbar'},this.library,this.back,this.forward,this.copy,this.view,el('button',{'aria-label':'Refresh Object Browser',title:'Refresh',onclick:()=>this.refresh(true)},icon('refresh'))));
    this.query=el('input',{'aria-label':'Object Browser search',placeholder:'Search members'});this.private=el('input',{type:'checkbox',checked:true});
    this.root.append(el('div',{class:'object-search'},this.query,el('button',{onclick:()=>this.search()},icon('find'),' Search'),el('label',{},this.private,'Private members')));
    this.resultList=new ToolList('Object Browser search results',item=>{if(item)this.chooseResult(item);},()=>this.viewDefinition());
    this.resultBox=el('section',{class:'object-search-results',hidden:true},el('div',{class:'tool-section-label'},'Search Results',el('button',{title:'Hide search results',onclick:()=>this.resultBox.hidden=true},'×')),this.resultList.root);
    this.classList=new ToolList('Object Browser classes',item=>this.selectClass(item),()=>this.viewDefinition());this.memberList=new ToolList('Object Browser members',item=>this.selectMember(item),()=>this.viewDefinition());
    this.classCaption=el('div',{class:'tool-section-label'},'Classes');this.memberCaption=el('div',{class:'tool-section-label'},'Members');
    const splitter=el('div',{class:'object-splitter',role:'separator',tabindex:0,'aria-label':'Object Browser column splitter','aria-orientation':'vertical'});
    this.columns=el('div',{class:'object-columns'},el('section',{},this.classCaption,this.classList.root),splitter,el('section',{},this.memberCaption,this.memberList.root));
    let width=230;const resize=delta=>{width=Math.max(110,Math.min(this.columns.clientWidth-130,width+delta));this.columns.style.setProperty('--object-class-width',width+'px');};resizeHandle(splitter,'x',resize,{label:'Object Browser column splitter',value:()=>width,min:110,max:1000});
    this.definition=el('pre',{class:'object-definition',tabindex:0,'aria-label':'Member definition'});this.status=el('div',{class:'tool-status',role:'status'});
    this.root.append(this.resultBox,this.columns,this.definition,this.status);
    this.library.addEventListener('change',()=>{this.resultBox.hidden=true;this.renderClasses();});this.private.addEventListener('change',()=>{this.renderMembers(this.member?.key);if(!this.resultBox.hidden)this.search();});
    this.query.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.search();}});
    this.root.addEventListener('keydown',e=>{if(e.altKey&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();e.stopPropagation();this.travel(e.key==='ArrowLeft'?-1:1);}if(e.key==='F5'){e.preventDefault();e.stopPropagation();this.refresh(true);}});
  }
  refresh(force=false){
    const references=JSON.stringify([this.ide.project.references,this.ide.project.typeLibraries,this.ide.project.dataSources]);
    const source=this.ide.project.modules.map(m=>[m.id,m.name,m.code,JSON.stringify(m.form?.controls.map(c=>[c.name,c.type,c.properties.Index])||[])]);
    if(!force&&this.references===references&&this.source&&this.projectName===this.ide.project.name&&source.length===this.source.length&&source.every((a,i)=>a.every((v,j)=>v===this.source[i][j])))return;
    this.references=references;this.source=source;this.projectName=this.ide.project.name;this.catalog=buildObjectCatalog(this.ide.project);
    const selected=this.state(),libraries=[...new Set(this.catalog.map(c=>c.library))];this.library.replaceChildren(el('option',{value:'*'},'<All Libraries>'),...libraries.map(name=>el('option',{value:name},name)));this.library.value=libraries.includes(selected.library)?selected.library:'*';
    this.suppress=true;this.renderClasses(selected.classKey,selected.memberKey);this.suppress=false;this.remember();this.status.textContent=this.catalog.length+' classes/modules · Browser adapters and project source; native COM libraries are not loaded.';
  }
  state(){return {library:this.library.value||'*',classKey:this.currentClass?.key,memberKey:this.member?.key};}
  renderClasses(key=this.currentClass?.key,memberKey=this.member?.key){const old=this.suppress;this.suppress=true;const classes=this.catalog.filter(c=>this.library.value==='*'||c.library===this.library.value).map(c=>({...c,glyph:c.moduleId?'▤':'▣'}));this.classList.set(classes,key);this.suppress=old;if(memberKey)this.renderMembers(memberKey);if(!old)this.remember();}
  selectClass(item){this.currentClass=item;this.memberCaption.textContent='Members of '+(item?.name||'');this.renderMembers();}
  renderMembers(key){const members=(this.currentClass?.members||[]).filter(m=>this.private.checked||m.scope!=='private').sort((a,b)=>a.label.localeCompare(b.label));this.memberList.set(members,key);if(!members.length)this.selectMember(null);}
  selectMember(item){this.member=item;const c=this.currentClass;
    this.definition.textContent=item?(item.signature||item.name)+'\n\nMember of '+item.library+'.'+item.className+(item.scope?' · '+item.scope:'')+(item.line?' · line '+item.line:'')+(item.incomplete?'\nSource is incomplete; navigation is provisional.':'')+'\n'+(item.description||c.description):c?c.name+'\n\n'+c.description:'No matching members.';
    this.view.disabled=!item?.moduleId&&!c?.moduleId;this.copy.disabled=!item;if(!this.suppress)this.remember();
  }
  remember(){if(this.suppress)return;const state=this.state(),last=this.history[this.historyIndex];if(!last||JSON.stringify(last)!==JSON.stringify(state)){this.history.splice(this.historyIndex+1);this.history.push(state);if(this.history.length>100)this.history.shift();this.historyIndex=this.history.length-1;}this.back.disabled=this.historyIndex<=0;this.forward.disabled=this.historyIndex>=this.history.length-1;}
  travel(delta){const index=this.historyIndex+delta;if(index<0||index>=this.history.length)return;this.historyIndex=index;const state=this.history[index];this.suppress=true;this.library.value=state.library;this.renderClasses(state.classKey,state.memberKey);this.suppress=false;this.back.disabled=index===0;this.forward.disabled=index===this.history.length-1;}
  search(){this.refresh();const query=this.query.value.trim();if(!query){this.status.textContent='Enter a member or class name.';return;}
    const found=searchCatalog(this.catalog,query,this.library.value,this.private.checked);this.resultBox.hidden=false;this.resultList.set(found);this.status.textContent=found.length+' matching members.';
  }
  chooseResult(item){this.suppress=true;this.renderClasses(item.classKey,item.key);this.suppress=false;this.remember();}
  viewDefinition(){const id=this.member?.moduleId||this.currentClass?.moduleId;if(!id)return;if(this.member?.kind==='control'){const module=this.ide.project.modules.find(m=>m.id===id),control=module?.form?.controls.find(c=>c.name===this.member.name);if(control){this.ide.openDocument(id,'form');this.ide.designer.select([control.id]);return;}}this.ide.openDocument(id,'code',this.member?.line||1);}
  async copySignature(){if(!this.member)return;const text=this.member.signature||this.member.name;this.lastCopiedSignature=text;try{await navigator.clipboard.writeText(text);this.status.textContent='Signature copied.';}catch{const doc=this.definition.ownerDocument,selection=doc.defaultView.getSelection(),range=doc.createRange();range.selectNodeContents(this.definition);selection.removeAllRanges();selection.addRange(range);this.status.textContent='Clipboard access unavailable. Definition selected; use Copy.';}}
  dispose(){this.classList.dispose();this.memberList.dispose();this.resultList.dispose();}
}
