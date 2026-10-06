import {referenceSnapshot} from './reference-metadata.js';
import {declarationTargets} from './event-completion.js';
import {FindIndex,replaceMatches} from './find-index.js';
import {VirtualTextInput} from './virtual-input.js';
import {updateSourceIndex,replacementChange,inputChange,HighlightCache} from './incremental.js';
import {EditorIntelligence,wordAt} from './intelligence.js';
import {completionSpan,statementBefore,completionMatches} from './source-context.js';
let completionSerial=0;
import {tokenize} from '../language/lexer.js';
import {DEFAULT_EVENTS,CONTROL_EVENTS} from '../controls/controls.js';
import {Signal,el,lower} from '../core/core.js';
import {icon} from '../theme/icons.js';
import {normalizeAppearance} from '../theme/theme.js';
import {indexSource,positionAt,offsetAt,sourceRange,replaceRange,textChange,mapOffset} from './projection.js';
import {KEYWORDS,BUILTINS,MEMBERS,highlightLine,procedures,formatCode} from './language-service.js';

/** Live, bounded-DOM code panes over a single full-module source buffer. */
export class SourceEditor extends Signal {
  constructor(container){
    super();this.findIndex=new FindIndex();this.intelligence=new EditorIntelligence();this.highlightCache=new HighlightCache();this.metrics={paints:0,domUpdates:0,indexedLines:0};this.overwrite=false;this.breakpoints=[];this.diagnostics=[];this.execution=null;this.lineHeight=17;this.characterWidth=7.8;this.appearance=normalizeAppearance();this.showLineNumbers=false;this.text='';this.index=indexSource('');this.lines=this.index.lines;this.lineStarts=this.index.starts;this.procedureIndex=[];this.panes=[];
    this.root=el('div',{class:'source-editor'});this.objects=el('select',{'aria-label':'Object'});this.procedures=el('select',{'aria-label':'Procedure'});this.selectors=el('div',{class:'code-selectors'},this.objects,this.procedures);this.findBar=this.buildFind();this.area=el('div',{class:'code-split-area'});this.root.append(this.selectors,this.findBar,this.area);container.append(this.root);
    this.primary=this.createPane();this.activePane=this.primary;this.area.append(this.primary.node);
    this.splitGrip=el('div',{class:'code-split-grip',role:'separator',tabindex:0,'aria-label':'Split code window','aria-orientation':'horizontal',title:'Split code window'});this.area.append(this.splitGrip);this.bindSplitter(this.splitGrip,true);this.splitGrip.addEventListener('dblclick',()=>this.toggleSplit());this.splitGrip.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();this.toggleSplit();}});
    this.procedures.addEventListener('change',()=>this.activateProcedure());this.procedures.addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();this.activateProcedure();}});this.objects.addEventListener('change',()=>{this.selectedObject=this.objects.value;this.updateSelectors(false,true);});
  }
  activateProcedure(){
    if(this.procedures.selectedIndex<0){
      // A Timer has one event: Enter must work without a prior selection change.
      if(this.objects.value==='(General)'||this.procedures.options.length!==1)return;
      this.procedures.selectedIndex=0;
    }
    const value=this.procedures.value;
    if(value.startsWith('event:')){
      if(!this.readOnly)this.emit('event',{object:this.objects.value,event:value.slice(6)});
      return;
    }
    if(!value&&this.activePane.mode==='procedure'){
      this.activePane.explicitDeclarations=true;this.syncPane(this.activePane,0);this.input.focus();this.cursorChanged();
    }else this.goToLine(Number(value)||1);
  }
  get input(){return this.activePane.input;} get viewport(){return this.activePane.viewport;} get syntax(){return this.activePane.syntax;} get gutter(){return this.activePane.gutter;}
  createPane(){
    const pane={mode:'module',range:{start:0,end:0,firstLine:0},lines:['']},viewport=el('div',{class:'code-viewport'}),gutter=el('div',{class:'code-gutter','aria-label':'Breakpoint margin'}),syntax=el('div',{class:'syntax-layer','aria-hidden':'true'}),input=el('textarea',{class:'source-input',spellcheck:'false',autocapitalize:'off',autocomplete:'off',autocorrect:'off','aria-label':this.panes.length?'Visual Basic source code, lower pane':'Visual Basic source code',wrap:'off'}),node=el('div',{class:'code-pane-view','data-code-pane':this.panes.length?'lower':'upper'}),views=el('div',{class:'code-view-buttons','aria-label':'Code view'});
    Object.assign(pane,{node,viewport,gutter,syntax,input,views});pane.procedureButton=el('button',{type:'button',title:'Procedure View','aria-label':'Procedure View','aria-pressed':'false',onclick:()=>{this.activatePane(pane);this.setViewMode('procedure');}},icon('procedure'));pane.moduleButton=el('button',{type:'button',title:'Full Module View','aria-label':'Full Module View','aria-pressed':'true',onclick:()=>{this.activatePane(pane);this.setViewMode('module');}},icon('full-module'));views.append(pane.procedureButton,pane.moduleButton);viewport.append(gutter,syntax,input);node.append(viewport,views);this.panes.push(pane);
    input.addEventListener('focus',()=>this.activatePane(pane));input.addEventListener('blur',()=>{this.paint();setTimeout(()=>{if(!this.root.contains(this.root.ownerDocument.activeElement)){this.closeCompletion();this.closeInfo();}},0);});input.addEventListener('input',()=>{this.activatePane(pane);this.changed();});input.addEventListener('scroll',()=>this.schedulePaint());input.addEventListener('keydown',e=>{this.activatePane(pane);this.keydown(e);});for(const event of ['click','keyup','select'])input.addEventListener(event,()=>{if(this.root.ownerDocument.activeElement===input){this.activatePane(pane);this.cursorChanged();}});
    gutter.addEventListener('click',e=>{this.activatePane(pane);const line=Number(e.target.closest('[data-line]')?.dataset.line);if(line&&this.module)this.emit(e.ctrlKey||e.metaKey?'bookmark':'breakpoint',{module:this.module.name,line});});pane.observer=new ResizeObserver(()=>this.schedulePaint());pane.observer.observe(viewport);input.readOnly=!!this.readOnly;this.bindAdvancedInput(pane);pane.virtualizer=new VirtualTextInput(this,pane);return pane;
  }
  activatePane(pane){if(this.activePane===pane)return;const active=this.panes.some(p=>p.input.dataset.activeEditor==='true');this.closeCompletion();this.closeInfo();this.activePane=pane;for(const p of this.panes){delete p.input.dataset.activeEditor;p.node.classList.toggle('active-code-pane',p===pane);}if(active)pane.input.dataset.activeEditor='true';this.cursorChanged();}
  setAppearance(value){this.appearance=normalizeAppearance(value);this.root.dataset.margin=String(this.appearance.margin);for(const [key,css]of Object.entries({text:'--vb-window-text',background:'--vb-window',keyword:'--vb-keyword',comment:'--vb-comment',selection:'--vb-selection',selectionText:'--vb-selection-text',breakpoint:'--vb-breakpoint',execution:'--vb-execution'})){const color=this.appearance.codeColors?.[key];if(color)this.root.style.setProperty(css,color);else this.root.style.removeProperty(css);}this.lineHeight=this.appearance.editorSize+4;this.root.style.setProperty('--editor-line-height',this.lineHeight+'px');const font='"'+this.appearance.editorFont+'",monospace';this.root.style.setProperty('--code-font',this.appearance.editorSize+'px/'+this.lineHeight+'px '+font);this.root.style.setProperty('--editor-tab-width',String(this.project?.settings.tabWidth||4));const ctx=this.root.ownerDocument.createElement('canvas').getContext('2d');ctx.font=this.appearance.editorSize+'px '+font;this.characterWidth=ctx.measureText('M').width;this.paint();}
  syncPane(pane,start,end=start,{scroll=true}={}){
    const oldRange=pane.range,position=positionAt(this.index,start),fullRange=sourceRange(this.index,pane.explicitDeclarations?0:position.line,pane.mode),range=pane.virtualizer?.project(fullRange,start,end)||fullRange,value=this.text.slice(range.start,range.end),top=pane.input.scrollTop,left=pane.input.scrollLeft;pane.range=range;pane.lines=pane.mode==='module'&&!pane.virtualizer?.active?this.index.lines:value.split('\n');if(pane.input.value!==value)pane.input.value=value;
    const a=Math.max(0,Math.min(value.length,start-range.start)),b=Math.max(a,Math.min(value.length,end-range.start));if(pane.input.selectionStart!==a||pane.input.selectionEnd!==b)pane.input.setSelectionRange(a,b);if(scroll&&oldRange?.start===range.start){pane.input.scrollTop=top;pane.input.scrollLeft=left;}else {pane.input.scrollTop=0;pane.input.scrollLeft=0;}
    pane.procedureButton.setAttribute('aria-pressed',String(pane.mode==='procedure'));pane.moduleButton.setAttribute('aria-pressed',String(pane.mode==='module'));pane.node.dataset.viewMode=pane.mode;
  }
  assignSource(value,selection=null,hint=null){
    const next=String(value),change=hint||textChange(this.text,next),states=this.panes.map(p=>({pane:p,start:mapOffset(change,this.selectionBounds(p).start),end:mapOffset(change,this.selectionBounds(p).end)}));const indexed=updateSourceIndex(this.index,next,change);this.metrics.indexedLines+=indexed.scannedLines;this.selectorDirty ||= indexed.changedProcedures||/\b(?:WithEvents|Implements)\b/i.test(this.text.slice(this.text.lastIndexOf('\n',Math.max(0,change.start-1))+1,this.text.indexOf('\n',change.oldEnd)<0?this.text.length:this.text.indexOf('\n',change.oldEnd))+next.slice(next.lastIndexOf('\n',Math.max(0,change.start-1))+1,next.indexOf('\n',change.newEnd)<0?next.length:next.indexOf('\n',change.newEnd)));this.text=next;this.lastValue=next;this.index=indexed.index;this.lines=this.index.lines;this.lineStarts=this.index.starts;this.procedureIndex=this.index.procedures;
    for(const state of states){if(selection&&state.pane===this.activePane)Object.assign(state,selection);this.syncPane(state.pane,state.start,state.end);}
  }
  setDocument(module,project){this.cancelCompositionAssistance();this.closeCompletion();this.closeInfo();const changed=this.module?.id!==module.id;this.module=module;this.project=project;this.root.style.setProperty('--editor-tab-width',String(project.settings.tabWidth||4));if(changed&&!this.appearance.fullModule)this.primary.mode='procedure';if(changed){this.selectedObject='(General)';this.objectEntries=null;this.objectSignature=null;}this.assignSource(module.code||'',changed?{start:0,end:0}:null);if(changed)for(const pane of this.panes){pane.input.scrollTop=pane.input.scrollLeft=0;}this.updateSelectors();this.paint();this.cursorChanged();}
  // Keep current main's identity-preserving designer refresh; typed declarations
  // add event/interface targets without resetting source, selection or split panes.
  refreshObjects(refreshEvents=true){
    if(!this.module)return false;
    const live={...this.module,code:this.text},targets=declarationTargets(this.project,live,this.intelligence,this.controlRegistry);
    const entries=[{id:'$general',name:'(General)',type:''},...targets.map(t=>({id:t.id||t.kind+':'+t.name,name:t.name,type:t.type||t.kind,members:t.members}))];
    this.declarationTargets=targets;
    const signature=JSON.stringify(entries);if(signature===this.objectSignature){this.objects.value=this.selectedObject||'(General)';return false;}
    const selected=this.selectedObject||'(General)',previous=this.objectEntries?.find(entry=>lower(entry.name)===lower(selected));
    const current=entries.find(entry=>entry.id===previous?.id)||entries.find(entry=>lower(entry.name)===lower(selected));
    this.selectedObject=current?.name||'(General)';this.objectEntries=entries;this.objectSignature=signature;
    this.objects.replaceChildren(...entries.map(entry=>el('option',{value:entry.name},entry.name)));
    this.objects.value=this.selectedObject;
    if(refreshEvents)this.updateSelectors(false,true);
    return true;
  }
  activateProcedureSelection(){return this.activateProcedure();}
  updateSelectors(includeObjects=true,force=false){
    if(!this.module)return;
    if(includeObjects||force||this.selectorDirty)this.refreshObjects(false);
    const selected=this.selectedObject||'(General)';
    if(selected!=='(General)'){
      if(!force&&!includeObjects&&!this.selectorDirty)return;
      const target=this.declarationTargets?.find(t=>lower(t.name)===lower(selected)),previousEvent=this.eventObject===selected?this.procedures.selectedOptions[0]?.dataset.event:null;
      const idx=this.intelligence.index({...this.module,code:this.text},this.project);
      const options=(target?.members||[]).map(member=>{
        const key=member.key||member.name;
        const existing=idx.procedures.find(p=>lower(p.name)===lower(selected+'_'+member.name)&&p.accessor===(member.accessor||null));
        return el('option',{value:existing?existing.line:'event:'+key,'data-event':key,...(existing?{'data-offset':existing.offset}:{})},member.label||member.name);
      }).sort((a,b)=>a.textContent.localeCompare(b.textContent));
      this.procedures.replaceChildren(...options);this.eventObject=selected;
      // Missing sole events must remain unselected so both selection and Enter
      // can explicitly create them; never create code while populating a list.
      this.procedures.selectedIndex=previousEvent?options.findIndex(option=>option.dataset.event===previousEvent&&!option.value.startsWith('event:')):-1;
      this.selectorDirty=false;return;
    }
    if(!force&&!includeObjects&&!this.selectorDirty)return;
    this.selectorDirty=false;const previous=this.procedures.value;this.procedures.replaceChildren(el('option',{value:''},'(Declarations)'),...[...this.procedureIndex].sort((a,b)=>a.name.localeCompare(b.name)).map(p=>el('option',{value:p.line},p.name+(p.kind==='Sub'?'':` [${p.kind}]`))));this.procedures.value=previous;
  }
  changed(){if(!this.module)return;this.changingSource=true;
    const oldText=this.text,pane=this.activePane,oldValue=oldText.slice(pane.range.start,pane.range.end),nextValue=pane.input.value,newText=replaceRange(oldText,pane.range,nextValue),start=pane.range.start+pane.input.selectionStart,end=pane.range.start+pane.input.selectionEnd;
    const kind=pane.editKind||(/^insertFrom|^deleteBy|^history/.test(pane.beforeInput?.type||'')?'command':'typing');pane.editKind=null;const local=pane.editHint||inputChange(oldValue,nextValue,pane.beforeInput,pane.input.selectionStart);pane.editHint=pane.beforeInput=null;
    const hint=local?{...local,start:local.start+pane.range.start,oldEnd:local.oldEnd+pane.range.start,newEnd:local.newEnd+pane.range.start}:null;
    this.assignSource(newText,{start,end},hint);this.emit('change',{module:this.module,oldText,newText,change:hint,kind});this.updateSelectors(false);this.cursorChanged();
    this.refreshAssistance();
  }
  refreshAssistance(){
    const start=this.cursor().offset;
    if(!this.composing&&!this.acceptingCompletion){
      if(this.completion)this.complete(this.completionMode,true);
      else if(this.appearance.autoListMembers&&this.selectionBounds().start===this.selectionBounds().end&&/[.=,( \t]$/.test(this.text.slice(Math.max(0,start-1),start)))this.complete('auto');
    }
    this.changingSource=false;
    clearTimeout(this.infoTimer);if(this.appearance.autoQuickInfo&&!this.composing&&!this.acceptingCompletion)this.infoTimer=setTimeout(()=>this.showInfo('parameter',true),160);
  }
  prepareDocumentTransfer(){
    if(this.disposed||this.transferState)return;this.cancelCompositionAssistance();this.closeCompletion();this.closeInfo();
    this.transferState={text:this.text,panes:this.panes.map(p=>({pane:p,selection:{...this.selectionBounds(p)},direction:p.input.selectionDirection,first:p.virtualizer.first,top:p.input.scrollTop,left:p.input.scrollLeft,rail:p.virtualizer.rail.scrollTop}))};
    // Adoption and unstyled layout can emit scroll/select events with zero geometry.
    for(const pane of this.panes)pane.virtualizer.syncing=true;
  }
  restoreDocumentTransfer(){
    const state=this.transferState;if(!state)return;this.transferState=null;
    const change=textChange(state.text,this.text);
    for(const saved of state.panes){
      const p=saved.pane,v=p.virtualizer;if(!this.panes.includes(p))continue;
      const start=mapOffset(change,saved.selection.start),end=mapOffset(change,saved.selection.end);
      v.direction=saved.direction;v.forceFirst=saved.first;
      this.syncPane(p,start,end);
      p.input.setSelectionRange(Math.max(0,start-p.range.start),Math.max(0,end-p.range.start),saved.direction);
      p.input.scrollTop=saved.top;p.input.scrollLeft=saved.left;v.rail.scrollTop=saved.rail;
      v.syncing=false;
    }
  }
  transferDocument(){if(this.disposed)return;this.restoreDocumentTransfer();(this.paintWindow||this.root.ownerDocument.defaultView).cancelAnimationFrame(this.paintFrame);this.paintFrame=0;for(const pane of this.panes){pane.observer.disconnect();pane.observer=new this.root.ownerDocument.defaultView.ResizeObserver(()=>this.schedulePaint());pane.observer.observe(pane.viewport);}this.paint();this.schedulePaint();}
  schedulePaint(){if(this.paintFrame||this.disposed)return;this.paintWindow=this.root.ownerDocument.defaultView;this.paintFrame=this.paintWindow.requestAnimationFrame(()=>{this.paintFrame=0;this.paint();});}
  paint(){if(!this.module||this.disposed)return;this.metrics.paints++;this.root.style.setProperty('--editor-gutter',this.appearance.margin===false?'0px':this.showLineNumbers?'32px':'18px');const breakpoints=new Set(this.breakpoints.filter(b=>lower(b.module)===lower(this.module.name)).map(b=>b.line)),separators=new Set(this.procedureIndex.map(p=>p.line)),bookmarks=new Set(this.module.bookmarks||[]);
    for(const pane of this.panes){const {input,viewport,syntax,gutter,lines,range}=pane,top=input.scrollTop,left=input.scrollLeft,first=Math.max(0,Math.floor((top-4)/this.lineHeight)),count=Math.ceil(viewport.clientHeight/this.lineHeight)+3,last=Math.min(lines.length,first+count),selection=this.selectionBounds(pane),select=this.root.ownerDocument.activeElement===input&&selection.start!==selection.end,selectionStart=selection.start-range.start,selectionEnd=selection.end-range.start;
      syntax.style.transform=`translate(${-left}px,${first*this.lineHeight-top}px)`;const html=lines.slice(first,last).map((line,i)=>{const n=range.firstLine+i+first+1,bp=breakpoints.has(n),exec=this.execution?.module===this.module.name&&this.execution.line===n,execStart=exec&&this.execution.column?this.execution.column-1:-1,execEnd=exec&&this.execution.endColumn?this.execution.endColumn-1:-1,separator=this.appearance.procedureSeparators&&separators.has(n)&&n>1,start=this.lineStarts[n-1]-range.start;return `<div class="syntax-line${bp?' breakpoint-line':''}${exec?' execution-line'+(execStart>=0?' execution-range':''):''}${separator?' procedure-start':''}">${this.highlightCache.get(line+'\0'+(select?Math.max(-1,selectionStart-start):-1)+':'+(select?Math.min(line.length+1,selectionEnd-start):-1)+':'+execStart+':'+execEnd,()=>highlightLine(line,select?selectionStart-start:-1,select?selectionEnd-start:-1,execStart,execEnd))}</div>`;}).join('');if(pane.lastHTML!==html){syntax.innerHTML=html;pane.lastHTML=html;this.metrics.domUpdates++;}const gutterKey=[first,last,this.showLineNumbers,[...breakpoints].join(','),[...bookmarks].join(','),this.execution?.line,this.execution?.module,this.diagnosticRevision].join('|');if(pane.gutterKey===gutterKey){for(const child of gutter.children)child.style.top=(4+(Number(child.dataset.line)-range.firstLine-1)*this.lineHeight-top)+'px';continue;}pane.gutterKey=gutterKey;gutter.replaceChildren();this.metrics.domUpdates++;for(let i=first;i<last;i++){const line=range.firstLine+i+1,bp=breakpoints.has(line),error=this.diagnosticMap?.get(lower(this.module.name)+':'+line),exec=this.execution?.module===this.module.name&&this.execution.line===line;gutter.append(el('div',{class:'gutter-line'+(bp?' has-breakpoint':'')+(error?' has-error':'')+(exec?' has-execution':'')+(bookmarks.has(line)?' has-bookmark':''),'data-line':line,title:error?.message||(bp?'Remove breakpoint':'Set breakpoint'),style:{top:(4+i*this.lineHeight-top)+'px'}},exec?icon('arrow-right',12):bp?el('span',{class:'breakpoint-dot'}):bookmarks.has(line)?el('span',{class:'bookmark-symbol',title:'Bookmark — Ctrl+click to remove'}):this.showLineNumbers?String(line):''));}}
  }
  selectionBounds(pane=this.activePane){return pane.virtualizer?.selection()||{start:pane.range.start+pane.input.selectionStart,end:pane.range.start+pane.input.selectionEnd};}
  cursor(){return positionAt(this.index,this.selectionBounds().start);}
  cursorChanged(){if(!this.module)return;const pendingInput=this.input.value!==this.text.slice(this.activePane.range.start,this.activePane.range.end),cursor=this.cursor();if(!pendingInput&&!this.changingSource&&this.completion&&cursor.offset!==this.completionCaret)this.closeCompletion();if(!pendingInput&&!this.changingSource&&this.info&&cursor.offset!==this.infoOffset)this.closeInfo();this.emit('cursor',cursor);let p=null;for(const value of this.procedureIndex){if(value.line>cursor.line)break;p=value;}if(!this.selectedObject||this.selectedObject==='(General)')this.procedures.value=p&&!this.activePane.explicitDeclarations?String(p.line):'';else if(p&&lower(p.name).startsWith(lower(this.selectedObject)+'_'))this.procedures.value=String(p.line);this.paint();}
  goToLine(line,column=1){const offset=offsetAt(this.index,line,column),pane=this.activePane;pane.explicitDeclarations=false;this.syncPane(pane,offset);this.input.focus();const y=(positionAt(this.index,offset).line-1-pane.range.firstLine)*this.lineHeight;if(y<this.input.scrollTop||y>this.input.scrollTop+this.viewport.clientHeight-50)this.input.scrollTop=Math.max(0,y-this.viewport.clientHeight*.35);this.cursorChanged();}
  setViewMode(mode){const cursor=this.cursor();this.activePane.mode=mode==='procedure'?'procedure':'module';this.syncPane(this.activePane,cursor.offset,cursor.offset,{scroll:false});this.goToLine(cursor.line,cursor.column);}
  setValue(value){if(this.readOnly||String(value)===this.text)return;this.closeCompletion();this.closeInfo();const oldText=this.text;this.assignSource(value);this.emit('change',{module:this.module,oldText,newText:this.text,kind:'command'});this.updateSelectors(false);this.cursorChanged();}
  setReadOnly(value){if(value){this.closeCompletion();this.closeInfo();}this.readOnly=!!value;for(const pane of this.panes)pane.input.readOnly=this.readOnly;this.root.classList.toggle('read-only',this.readOnly);}
  setBreakpoints(values){this.breakpoints=values;this.paint();}setDiagnostics(values){this.diagnostics=values;this.diagnosticRevision=(this.diagnosticRevision||0)+1;this.diagnosticMap=new Map();for(const d of values){const key=lower(d.source)+':'+d.line;if(!this.diagnosticMap.has(key))this.diagnosticMap.set(key,d);}this.paint();}setExecution(value){this.execution=value;this.paint();}
  replaceSelection(text,start=undefined,end=undefined,kind='command'){if(this.input.readOnly)return;if(this.activePane.virtualizer?.active){const bounds=this.selectionBounds();return this.replaceGlobal(text,start===undefined?bounds.start:this.activePane.range.start+start,end===undefined?bounds.end:this.activePane.range.start+end,kind);}start??=this.input.selectionStart;end??=this.input.selectionEnd;this.input.focus();this.activePane.editKind=kind;this.activePane.editHint=replacementChange(start,end,String(text).length);this.input.setRangeText(text,start,end,'end');this.changed();}
  replaceGlobal(text,start,end,kind='command'){
    if(this.readOnly)return;this.changingSource=true;
    try{
      const oldText=this.text,newText=oldText.slice(0,start)+text+oldText.slice(end),change=replacementChange(start,end,text.length),cursor=start+text.length;
      this.assignSource(newText,{start:cursor,end:cursor},change);this.emit('change',{module:this.module,oldText,newText,change,kind});this.updateSelectors(false);
      this.goToLine(positionAt(this.index,cursor).line,positionAt(this.index,cursor).column);this.refreshAssistance();
    }finally{this.changingSource=false;}
  }
  toggleSplit(value=!this.secondary,ratio=.5){
    if(value&&!this.secondary){this.secondary=this.createPane();this.secondary.mode=this.activePane.mode;this.secondary.explicitDeclarations=this.activePane.explicitDeclarations;this.syncPane(this.secondary,this.cursor().offset);this.splitBar=el('div',{class:'code-pane-splitter',tabindex:0,role:'separator','aria-label':'Code pane splitter','aria-orientation':'horizontal','aria-valuemin':5,'aria-valuemax':95});this.area.insertBefore(this.splitBar,this.splitGrip);this.area.insertBefore(this.secondary.node,this.splitGrip);this.bindSplitter(this.splitBar);this.splitBar.addEventListener('dblclick',()=>this.toggleSplit(false));this.splitBar.addEventListener('keydown',e=>{if(e.key==='ArrowUp'||e.key==='ArrowDown'){e.preventDefault();this.setSplitRatio(this.splitRatio+(e.key==='ArrowUp'?-.02:.02));}else if(['Home','End','Enter'].includes(e.key)){e.preventDefault();this.toggleSplit(false);this.input.focus();}});this.setSplitRatio(ratio);}
    else if(!value&&this.secondary){const cursor=this.cursor(),end=this.selectionBounds().end,top=this.input.scrollTop,mode=this.activePane.mode,wasActive=this.panes.some(p=>p.input.dataset.activeEditor==='true');this.secondary.observer.disconnect();this.secondary.virtualizer?.dispose();this.secondary.node.remove();this.panes=this.panes.filter(p=>p!==this.secondary);this.secondary=null;this.splitBar.remove();this.splitBar=null;this.activePane=this.primary;this.primary.node.classList.add('active-code-pane');if(wasActive)this.primary.input.dataset.activeEditor='true';this.primary.mode=mode;this.syncPane(this.primary,cursor.offset,end);this.input.scrollTop=top;this.area.style.gridTemplateRows='minmax(0,1fr)';}
    this.root.classList.toggle('code-is-split',!!this.secondary);this.paint();
  }
  setSplitRatio(value){this.splitRatio=Math.max(.05,Math.min(.95,value));this.area.style.gridTemplateRows=`minmax(0,${this.splitRatio}fr) 4px minmax(0,${1-this.splitRatio}fr)`;this.splitBar?.setAttribute('aria-valuenow',String(Math.round(this.splitRatio*100)));this.paint();}
  bindSplitter(handle,grip=false){handle.style.touchAction='none';handle.addEventListener('pointerdown',e=>{if(e.button!==0)return;e.preventDefault();handle.setPointerCapture(e.pointerId);const before=!!this.secondary,oldRatio=this.splitRatio||.5,start=e.clientY;let moved=false,finished=false;const move=event=>{if(!moved&&Math.abs(event.clientY-start)<4)return;moved=true;const r=this.area.getBoundingClientRect(),ratio=(event.clientY-r.top)/r.height;if(!this.secondary)this.toggleSplit(true,ratio);else this.setSplitRatio(ratio);};const end=event=>{if(finished)return;finished=true;handle.removeEventListener('pointermove',move);handle.removeEventListener('pointerup',end);handle.removeEventListener('pointercancel',end);handle.removeEventListener('lostpointercapture',end);if(event.type==='pointercancel'){this.toggleSplit(before);if(before)this.setSplitRatio(oldRatio);}else if(moved&&(this.splitRatio<=.06||this.splitRatio>=.94))this.toggleSplit(false);};handle.addEventListener('pointermove',move);handle.addEventListener('pointerup',end);handle.addEventListener('pointercancel',end);handle.addEventListener('lostpointercapture',end);});}
  rememberClipboard(text){this.clipboard=String(text);if(this.clipboardStore)this.clipboardStore.text=this.clipboard;try{navigator.clipboard?.writeText(this.clipboard)?.catch(()=>{});}catch{}}
  async pasteClipboard(){if(this.readOnly)return;const source=this.text,module=this.module,selection=this.selectionBounds(),pane=this.activePane;let text=this.clipboardStore?.text??this.clipboard??'';
    try{if(navigator.clipboard?.readText)text=await navigator.clipboard.readText();}catch{}
    const current=this.selectionBounds();if(this.disposed||this.readOnly||this.module!==module||this.text!==source||this.activePane!==pane||current.start!==selection.start||current.end!==selection.end){this.emit('status','Paste cancelled because the source or selection changed.');return;}
    if(text)this.replaceGlobal(String(text).replace(/\r\n?/g,'\n'),selection.start,selection.end);
  }
  selectGlobal(start,end=start){if(this.activePane.virtualizer?.active)this.activePane.virtualizer.select(start,end);else{this.syncPane(this.activePane,start,end);this.input.focus();this.cursorChanged();}}
  cutLine(){if(this.readOnly)return;const pos=this.cursor(),start=offsetAt(this.index,pos.line),end=pos.line<this.lines.length?offsetAt(this.index,pos.line+1):this.text.length;this.rememberClipboard(this.text.slice(start,end));this.replaceGlobal('',start,end);}
  edit(command){this.input.focus();const bounds=this.selectionBounds();
    if(command==='selectAll'){const range=this.activePane.virtualizer?.full||this.activePane.range;this.selectGlobal(range.start,range.end);return;}
    if(command==='copy'||command==='cut'){this.rememberClipboard(this.text.slice(bounds.start,bounds.end));if(command==='cut')this.replaceGlobal('',bounds.start,bounds.end);return;}
    if(command==='paste')return this.pasteClipboard();
    if(command==='delete'){this.replaceGlobal('',bounds.start,bounds.end===bounds.start?this.activePane.virtualizer.next(bounds.end):bounds.end);return;}
    if(command==='format'){const offset=this.cursor().offset;this.setValue(formatCode(this.text,this.project.settings.tabWidth||4));const position=positionAt(this.index,Math.min(offset,this.text.length));this.goToLine(position.line,position.column);return;}
    if(command==='comment'||command==='uncomment')this.transformBlock(line=>command==='comment'?"'"+line:line.replace(/^(\s*)' ?/,'$1'));
  }
  keydown(e){if(e.isComposing||this.composing)return;this.resumeCompositionAssistance();const ctrl=e.ctrlKey||e.metaKey;
    if(this.completion&&!ctrl&&!e.altKey){
      if(['ArrowDown','ArrowUp','PageDown','PageUp','Home','End','Enter','Tab','Escape'].includes(e.key)){
        e.preventDefault();
        if(e.key==='Escape'){this.closeCompletion();this.closeInfo();}
        else if(e.key==='Enter'||e.key==='Tab')this.acceptCompletion(e.key==='Enter'?'\n':'');
        else {const count=this.completionItems.length;this.completionIndex=e.key==='Home'?0:e.key==='End'?count-1:Math.max(0,Math.min(count-1,this.completionIndex+({ArrowDown:1,ArrowUp:-1,PageDown:9,PageUp:-9}[e.key])));this.scrollCompletion();}
        return;
      }
      if(['.','(',',',' ',')'].includes(e.key)&&!this.input.readOnly){e.preventDefault();this.acceptCompletion(e.key);return;}
      if(['ArrowLeft','ArrowRight'].includes(e.key))this.closeCompletion();
    }
    if(ctrl&&['ArrowUp','ArrowDown'].includes(e.key)){e.preventDefault();const line=this.cursor().line,proc=e.key==='ArrowDown'?this.procedureIndex.find(p=>p.line>line):[...this.procedureIndex].reverse().find(p=>p.line<line);if(proc)this.goToLine(proc.line);return;}if(ctrl&&e.key.toLowerCase()==='y'&&!this.input.readOnly){e.preventDefault();this.cutLine();return;}if(ctrl&&e.code==='Space'){e.preventDefault();this.completeWord();return;}if(ctrl&&!e.shiftKey&&['f','h'].includes(e.key.toLowerCase())){e.preventDefault();this.showFind(e.key.toLowerCase()==='h');return;}if(e.key==='F3'||e.key==='F4'&&e.shiftKey){e.preventDefault();this.find(e.key==='F4'?1:e.shiftKey?-1:1);return;}if(e.key==='Escape'){this.findBar.hidden=true;this.closeCompletion();this.closeInfo();}
    if(e.key==='Tab'&&!this.input.readOnly){e.preventDefault();const bounds=this.selectionBounds();if(bounds.start!==bounds.end||e.shiftKey)this.indentBlock(e.shiftKey);else this.replaceSelection(' '.repeat(this.project.settings.tabWidth||4));return;}
    if(e.key==='Enter'&&!this.input.readOnly){e.preventDefault();const previous=this.input.value.slice(0,this.input.selectionStart).split('\n').at(-1),indent=this.appearance.autoIndent?previous.match(/^\s*/)[0]:'';this.replaceSelection('\n'+indent,undefined,undefined,'typing');return;}
  }
  completionSnapshot(){return {project:this.project,module:this.module.id,library:this.intelligence.libraryRevision,references:referenceSnapshot(this.project).key,dataSources:JSON.stringify(this.project.dataSources||{}),modules:this.project.modules.map(m=>({id:m.id,name:m.name,kind:m.kind,code:m.id===this.module.id?null:m.code,metadata:JSON.stringify([m.form?.controls?.map(c=>[c.name,c.type,c.properties?.Index]),m.form?.menus,m.attributes])})),conditions:JSON.stringify(this.project.settings?.conditionalConstants||{})};}
  sameCompletionSnapshot(a,b){return a&&a.project===b.project&&a.module===b.module&&a.library===b.library&&a.references===b.references&&a.dataSources===b.dataSources&&a.conditions===b.conditions&&a.modules.length===b.modules.length&&a.modules.every((m,i)=>Object.keys(m).every(k=>m[k]===b.modules[i][k]));}
  complete(mode='members',reuse=false){
    if(!this.module||this.composing||this.input.readOnly)return;
    const cursor=this.cursor(),span=completionSpan(this.text,cursor.offset),seed=this.text.slice(0,span.start),suffix=this.text.slice(span.end),snapshot=this.completionSnapshot();
    const previous=this.completionDetails?.[this.completionIndex]?.name;
    if(!reuse||this.completionSeed!==seed||this.completionSuffix!==suffix||this.completionMode!==mode||!this.sameCompletionSnapshot(this.completionState,snapshot)){
      const result=this.intelligence.completions(this.project,{...this.module,code:this.text},cursor.line,this.text,cursor.offset,{constants:mode==='constants',contextual:mode==='auto',unfiltered:true});
      this.completionCandidates=result.items;this.completionContext=result.context;this.completionSeed=seed;this.completionSuffix=suffix;this.completionState=snapshot;
    }
    this.completionStart=span.start;this.completionEnd=span.end;this.completionCaret=cursor.offset;this.completionMode=mode;
    const prefix=span.prefix.replace(/^\[/,'').toLowerCase();
    this.completionDetails=this.completionCandidates.filter(s=>completionMatches(s.name,span.prefix));
    this.completionItems=this.completionDetails.map(s=>s.name);if(!this.completionItems.length){this.closeCompletion();return;}
    this.completionIndex=Math.max(0,reuse?this.completionItems.indexOf(previous):0);
    if(!this.completion){
      this.completion=el('div',{id:'vb6-completion-'+(++completionSerial),class:'completion-list',role:'listbox','aria-label':this.completionContext==='constants'?'List Constants':'List Members'});
      this.completion.style.height='180px';this.completion.addEventListener('scroll',()=>this.renderCompletion());this.viewport.append(this.completion);
    }
    this.completion.dataset.context=this.completionContext;this.input.setAttribute('aria-expanded','true');this.input.setAttribute('aria-controls',this.completion.id);this.input.setAttribute('aria-autocomplete','list');this.positionPopup(this.completion);this.scrollCompletion();
  }
  completeWord(){this.complete();if(this.completion&&this.completionItems.length===1)this.acceptCompletion();}
  positionPopup(node){
    node.style.maxWidth=Math.max(1,this.viewport.clientWidth-4)+'px';node.style.boxSizing='border-box';
    if(node.classList.contains('source-info')){node.style.width='max-content';node.style.overflowWrap='anywhere';}
    node.style.left='0px';
    const bounds=node.getBoundingClientRect(),cursor=this.cursor(),height=Math.ceil(bounds.height)||(node.classList.contains('completion-list')?180:50),width=Math.ceil(bounds.width)||240;
    const y=(cursor.line-this.activePane.range.firstLine)*this.lineHeight+4-this.input.scrollTop;
    let top=y;if(node===this.info&&this.completion)top=y-height-this.lineHeight-2;
    if(top<0)top=this.completion?y+this.completion.offsetHeight+2:y;
    node.style.left=Math.max(0,Math.min(this.viewport.clientWidth-width-2,(cursor.column-1)*this.characterWidth+(this.appearance.margin===false?0:this.showLineNumbers?32:18)-this.input.scrollLeft))+'px';
    node.style.top=Math.max(0,Math.min(this.viewport.clientHeight-height,top))+'px';
  }
  renderCompletion(){if(!this.completion)return;const rowHeight=19,count=this.completionItems.length,start=Math.max(0,Math.floor(this.completion.scrollTop/rowHeight)-1),end=Math.min(count,start+13);const spacer=el('div',{'aria-hidden':'true',style:{height:count*rowHeight+'px',pointerEvents:'none'}}),rows=[];
    for(let i=start;i<end;i++){
      const item=this.completionDetails[i],name=item.name;
      rows.push(el('div',{id:this.completion.id+'-'+i,class:'completion-item'+(i===this.completionIndex?' selected':''),role:'option','aria-selected':i===this.completionIndex,'aria-posinset':i+1,'aria-setsize':count,title:[item.signature||name,item.description].filter(Boolean).join(' — '),style:{position:'absolute',top:i*rowHeight+'px',height:rowHeight+'px',left:0,right:0},ondblclick:e=>{e.preventDefault();this.completionIndex=i;this.acceptCompletion();},onpointerdown:e=>{e.preventDefault();this.completionIndex=i;{for(const row of this.completion.querySelectorAll('[role=option]')){const active=row.id===this.completion.id+'-'+i;row.classList.toggle('selected',active);row.setAttribute('aria-selected',String(active));}this.input.setAttribute('aria-activedescendant',this.completion.id+'-'+i);}}},el('span',{class:'completion-icon'},icon(['function','method','sub'].includes(item.kind)?'code':'properties',12)),name));
    }
    this.completion.replaceChildren(spacer,...rows);this.input.setAttribute('aria-activedescendant',this.completion.id+'-'+this.completionIndex);
  }
  scrollCompletion(){if(!this.completion)return;const top=this.completionIndex*19;if(top<this.completion.scrollTop)this.completion.scrollTop=top;else if(top+19>this.completion.scrollTop+180)this.completion.scrollTop=top-161;this.renderCompletion();}
  acceptCompletion(commit=''){
    const item=this.completionDetails?.[this.completionIndex];if(!this.completion||!item||this.input.readOnly)return;
    const cursor=this.cursor(),span=completionSpan(this.text,cursor.offset),snapshot=this.completionSnapshot();
    if(this.text.slice(0,span.start)!==this.completionSeed||this.text.slice(span.end)!==this.completionSuffix||!this.sameCompletionSnapshot(this.completionState,snapshot)){this.closeCompletion();return;}
    let name=item.insertText||item.name;
    if(this.text[span.start]==='['&&!name.startsWith('['))name='['+name+']';
    const indent=commit==='\n'&&this.appearance.autoIndent?this.text.slice(this.text.lastIndexOf('\n',cursor.offset-1)+1,cursor.offset).match(/^[ \t]*/)[0]:'';
    this.closeCompletion();this.closeInfo();this.acceptingCompletion=true;
    try{this.replaceGlobal(name+commit+indent,span.start,span.end);}finally{this.acceptingCompletion=false;}
    if(commit&&commit!=='\n'){
      if(this.appearance.autoListMembers)this.complete('auto');
      if(this.appearance.autoQuickInfo)this.showInfo('parameter',true);
    }
  }
  closeCompletion(){this.completion?.remove();this.completion=null;for(const name of ['aria-expanded','aria-controls','aria-activedescendant','aria-autocomplete'])this.input?.removeAttribute(name);}
  showInfo(mode='quick',automatic=false){
    if(!this.module||this.composing)return;const cursor=this.cursor(),module={...this.module,code:this.text},selection=this.selectionBounds(),selected=this.text.slice(selection.start,selection.end);
    let info=this.intelligence.parameterInfo(this.project,module,cursor.line,this.text,cursor.offset,{outer:mode==='parameter'&&!automatic});
    if(mode==='quick'&&(!info||selected)){
      const st=statementBefore(this.text,cursor.offset),word=selected||wordAt(this.text,cursor.offset).text;
      info=st.state==='code'?this.intelligence.resolve(this.project,module,cursor.line,word,{offset:cursor.offset}):null;
    }
    if(!info){this.closeInfo();if(!automatic)this.emit('status','No declaration information at this position.');return;}
    if(!this.info){this.info=el('div',{class:'source-info',role:'tooltip','aria-label':'Code information'});this.viewport.append(this.info);}
    const doc=this.root.ownerDocument;
    if(info.params){
      this.info.replaceChildren(doc.createTextNode(info.name+'('),...(info.displayParams||info.params).flatMap((p,i)=>[i?', ':'',el(i===info.active?'strong':'span',{},/^Optional\s+/i.test(p)?'['+p.replace(/^Optional\s+/i,'')+']':p.endsWith('?')?'['+p.slice(0,-1)+']':p)]),doc.createTextNode(')'+(info.type&&info.type!=='Void'?' As '+info.type:'')));
      this.info.dataset.parameter=String(info.active??-1);
    }else{this.info.textContent=info.signature||info.name+' As '+(info.type||'Variant');delete this.info.dataset.parameter;}
    if(info.description)this.info.append(el('div',{class:'source-info-description'},info.description));
    this.infoOffset=cursor.offset;this.positionPopup(this.info);this.lastInfo=info;
  }
  closeInfo(){this.info?.remove();this.info=null;clearTimeout(this.infoTimer);}
  definition(){const c=this.cursor(),text=this.input.value.slice(this.input.selectionStart,this.input.selectionEnd)||wordAt(this.text,c.offset).text;return this.intelligence.definition(this.project,{...this.module,code:this.text},c.line,this.text,c.offset,text);}
  cancelCompositionAssistance(){clearTimeout(this.compositionTimer);this.compositionTimer=0;this.compositionResume=null;}
  resumeCompositionAssistance(){
    const pending=this.compositionResume;if(!pending)return;
    this.cancelCompositionAssistance();
    const {input,mode,module,project}=pending;
    if(this.disposed||this.composing||this.module!==module||this.project!==project||this.input!==input||input.readOnly||input.ownerDocument.activeElement!==input)return;
    if(mode)this.complete(mode);
    if(this.appearance.autoQuickInfo)this.showInfo('parameter',true);
  }
  bindAdvancedInput(pane){
    const input=pane.input;
    input.addEventListener('beforeinput',e=>{pane.beforeInput={start:input.selectionStart,end:input.selectionEnd,type:e.inputType,composing:e.isComposing};if(this.overwrite&&!e.isComposing&&e.inputType==='insertText'&&e.data&&input.selectionStart===input.selectionEnd&&!input.readOnly){const start=input.selectionStart,lineEnd=input.value.indexOf('\n',start),limit=lineEnd<0?input.value.length:lineEnd;const end=Math.min(limit,start+[...e.data].reduce((n,c)=>n+(input.value.codePointAt(start+n)>65535?2:1),0));e.preventDefault();this.activatePane(pane);this.replaceSelection(e.data,start,end);}});
    input.addEventListener('compositionstart',()=>{this.cancelCompositionAssistance();this.compositionMode=this.completion?this.completionMode:null;this.composing=true;this.closeCompletion();this.closeInfo();});input.addEventListener('compositionend',()=>{
      this.composing=false;const mode=this.compositionMode||(this.appearance.autoListMembers?'auto':null);this.compositionMode=null;this.cursorChanged();
      // Usually resume after the committed input event. A following key can
      // arrive before this timer (Firefox/IME): keydown drains the same task
      // first so Tab commits and Escape cancels, without reopening afterward.
      this.compositionResume={input,mode,module:this.module,project:this.project};
      this.compositionTimer=setTimeout(()=>this.resumeCompositionAssistance(),0);
    });
    input.addEventListener('keydown',e=>{
      if(e.defaultPrevented||e.isComposing)return;const ctrl=e.ctrlKey||e.metaKey;
      if(ctrl&&e.key.toLowerCase()==='j'){e.preventDefault();this.complete(e.shiftKey?'constants':'members');}
      else if(ctrl&&e.key.toLowerCase()==='i'){e.preventDefault();this.showInfo(e.shiftKey?'parameter':'quick');}
      else if(ctrl&&e.key.toLowerCase()==='m'){e.preventDefault();this.indentBlock(e.shiftKey);}
      else if(e.key==='Insert'&&!ctrl&&!e.shiftKey){e.preventDefault();this.overwrite=!this.overwrite;this.root.classList.toggle('overwrite-mode',this.overwrite);this.emit('status',this.overwrite?'Overtype':'Insert');}
      else if(e.key==='Home'&&!ctrl){e.preventDefault();const backward=input.selectionDirection==='backward',focus=backward?input.selectionStart:input.selectionEnd,anchor=backward?input.selectionEnd:input.selectionStart,a=input.value.lastIndexOf('\n',Math.max(0,focus-1))+1,indent=input.value.slice(a).match(/^[ \t]*/)[0].length,target=focus===a+indent?a:a+indent,begin=e.shiftKey?anchor:target;input.setSelectionRange(Math.min(begin,target),Math.max(begin,target),target<begin?'backward':'forward');this.cursorChanged();}
      else if(ctrl&&(e.key==='PageUp'||e.key==='PageDown')){e.preventDefault();input.scrollTop+=this.viewport.clientHeight*(e.key==='PageDown'?1:-1);}
      else if(e.key==='F2'&&e.shiftKey&&!ctrl){e.preventDefault();this.emit('definition',this.definition());}
      else if(e.key==='F2'&&e.shiftKey&&ctrl&&!e.altKey){e.preventDefault();this.emit('last-position');}
      else if(e.key==='F10'&&e.shiftKey){e.preventDefault();const r=input.getBoundingClientRect();this.emit('contextmenu',{x:r.left+35,y:r.top+35});}
    });
    for(const type of ['copy','cut'])input.addEventListener(type,()=>{const bounds=this.selectionBounds(pane),text=this.text.slice(bounds.start,bounds.end);this.clipboard=text;if(this.clipboardStore)this.clipboardStore.text=text;},true);
    input.addEventListener('paste',event=>{const text=event.clipboardData?.getData('text/plain');if(typeof text==='string'){this.clipboard=text;if(this.clipboardStore)this.clipboardStore.text=text;}},true);
    input.addEventListener('contextmenu',e=>{e.preventDefault();this.activatePane(pane);this.emit('contextmenu',{x:e.clientX,y:e.clientY});});
  }
  indentBlock(outdent=false){if(this.readOnly)return;const width=this.project.settings.tabWidth||4;this.transformBlock(line=>outdent?line.replace(new RegExp('^ {1,'+width+'}|^\\t'),''):' '.repeat(width)+line);}
  transformBlock(transform){if(this.readOnly)return;const selection=this.selectionBounds(),startLine=positionAt(this.index,selection.start).line,endLine=positionAt(this.index,Math.max(selection.start,selection.end-(selection.end>selection.start&&this.text[selection.end-1]==='\n'?1:0))).line,start=offsetAt(this.index,startLine),end=offsetAt(this.index,endLine,1e9),text=this.text.slice(start,end).split('\n').map(transform).join('\n');this.replaceGlobal(text,start,end);this.selectGlobal(start,start+text.length);}
  buildFind(){const box=el('div',{class:'editor-find',hidden:true});this.findInput=el('input',{placeholder:'Find what','aria-label':'Find what'});this.replaceInput=el('input',{placeholder:'Replace with','aria-label':'Replace with'});this.caseBox=el('input',{type:'checkbox'});this.wholeBox=el('input',{type:'checkbox'});this.findResult=el('span',{class:'find-result'});box.append(this.findInput,el('button',{onclick:()=>this.find(-1),title:'Find previous'},'↑'),el('button',{onclick:()=>this.find(1),title:'Find next'},'↓'),this.replaceInput,el('button',{class:'replace-command',onclick:()=>this.replace(false)},'Replace'),el('button',{class:'replace-command',onclick:()=>this.replace(true)},'All'),el('label',{},this.caseBox,'Aa'),el('label',{},this.wholeBox,'Word'),this.findResult,el('button',{onclick:()=>{box.hidden=true;this.input.focus();},title:'Close find'},'×'));this.findInput.addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();this.find(e.shiftKey?-1:1);}if(e.key==='Escape'){box.hidden=true;this.input.focus();}});return box;}
  showFind(replace=false){this.findBar.hidden=false;this.findBar.classList.toggle('replace-visible',replace);const selected=this.input.value.slice(this.input.selectionStart,this.input.selectionEnd);if(selected&&!selected.includes('\n'))this.findInput.value=selected;this.findInput.focus();this.findInput.select();}
  matches(){return this.findIndex.search(this.text,this.findInput.value,{matchCase:this.caseBox.checked,wholeWord:this.wholeBox.checked});}
  find(direction=1){this.matches();const bounds=this.selectionBounds(),match=this.findIndex.next(direction>0?bounds.end:bounds.start,direction);if(!match){this.findResult.textContent='No matches';return;}const pos=positionAt(this.index,match.start);this.goToLine(pos.line,pos.column);if(match.end>this.activePane.range.end&&!this.activePane.virtualizer?.active){this.setViewMode('module');this.goToLine(pos.line,pos.column);}this.selectGlobal(match.start,match.end);this.paint();this.findResult.textContent=(match.index+1)+' of '+match.count;}
  replace(all){if(this.input.readOnly)return;const matches=this.matches();if(all){this.setValue(replaceMatches(this.text,matches,this.replaceInput.value));this.findResult.textContent=matches.length+' replaced';}else{const bounds=this.selectionBounds(),selected=matches.find(m=>m.start===bounds.start&&m.end===bounds.end);if(selected)this.replaceGlobal(this.replaceInput.value,bounds.start,bounds.end);this.find();}}
  dispose(){this.disposed=true;this.cancelCompositionAssistance();this.assistance?.dispose();this.findIndex.clear();(this.paintWindow||this.root.ownerDocument.defaultView).cancelAnimationFrame(this.paintFrame);this.closeInfo();this.highlightCache.clear();for(const pane of this.panes){pane.observer.disconnect();pane.virtualizer?.dispose();}this.closeCompletion();this.root.remove();}
}
