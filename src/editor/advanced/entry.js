import {LanguageClient} from './client.js';
import {PullDiagnostics} from './pull-diagnostics.js';
import {messagePortTransport,connectWebSocket} from './rpc.js';
import {planWorkspaceEdit} from './text-document.js';
import {prepareProjectEdits} from './workspace.js';
import {registerAdvancedLanguages,applyAdvancedTheme} from './languages.js';
import {installLanguageProviders} from './providers.js';
import {AdvancedSurface} from './surface.js';
import {toRange,fromRange,fromPosition,fromDiagnostic} from './protocol-converters.js';
import {readXamlDocument} from '../../xaml/documents.js';
import {el} from '../../core/core.js';
import {modal} from '../../ide/ui.js';

let sequence=0;
const extension=m=>m.form?'frm':m.kind==='class'?'cls':'bas';
const uriFor=(project,module,language)=>'vb6-editor://workspace/'+encodeURIComponent(project.id)+'/'+encodeURIComponent(module.id)+'/'+encodeURIComponent(module.name)+'.'+(language==='xaml'?'xaml':extension(module));

export class AdvancedEditorRuntime {
  constructor(ide,settings,assets) {
    this.ide=ide;this.settings=settings;this.assets=assets;this.monaco=assets.monaco;this.records=new Map();this.clients={};this.sessions=new Set();this.providers=new Map();this.surfaces=new Map();this.disposables=[];this.diagnosticValues=new Map();this.abort=new AbortController();
    this.commandId='vb6.advanced.lsp.'+(++sequence);
  }
  report(error) {if(!this.disposed)this.ide.status('Language service: '+(error.message||error));}
  checkActive(){if(this.disposed)throw new Error('Advanced editor initialization cancelled.');}
  async initialize() {
    this.checkActive();const options={applyEdit:(edit,label)=>this.applyEdit(this.builtin,edit,label,true),onError:error=>this.report(error),showMessage:p=>this.message(p)};
    if(!this.settings.vb6Endpoint||!this.settings.xamlEndpoint){
      this.builtin=new LanguageClient(messagePortTransport(this.assets.worker(),{terminate:true}),options);this.sessions.add(this.builtin);await this.builtin.initialize();this.checkActive();
    }
    for(const language of ['vb6','xaml']) {
      const endpoint=this.settings[language+'Endpoint'];
      if(endpoint){const transport=await connectWebSocket(endpoint,{signal:this.abort.signal});
        if(this.disposed){transport.close();this.checkActive();}
        const client=new LanguageClient(transport,{...options,rootUri:'vb6-editor://workspace/'+encodeURIComponent(this.ide.project.id)+'/',applyEdit:(edit,label)=>this.applyEdit(client,edit,label,true)});
        this.clients[language]=client;this.sessions.add(client);await client.initialize();this.checkActive();
      }else this.clients[language]=this.builtin;
    }
    this.disposables.push(registerAdvancedLanguages(this.monaco));
    this.disposables.push(this.monaco.editor.registerCommand(this.commandId,(_accessor,language,raw)=>this.executeCommand(this.clients[language],raw)));
    const host={report:error=>this.report(error),command:(client,raw)=>({id:this.commandId,title:raw.title||raw.command,arguments:[this.clients.vb6===client?'vb6':'xaml',raw]}),
      applyEdit:(...args)=>this.applyEdit(...args),hasUri:uri=>this.records.has(uri),diagnostics:(client,uri)=>this.diagnosticValues.get(client)?.get(uri)||[]};
    for(const language of ['vb6','xaml']) {
      const client=this.clients[language],install=()=>{this.providers.get(language)?.dispose();if(!this.disposed)this.providers.set(language,installLanguageProviders(this.monaco,language,client,host));};
      install();this.disposables.push({dispose:client.on('capabilities',install)});
    }
    for(const client of this.sessions){
      this.diagnosticValues.set(client,new Map());
      this.disposables.push({dispose:client.on('diagnostics',p=>{const values=this.diagnosticValues.get(client);if(client.documents.has(p.uri))values?.set(p.uri,p.diagnostics||[]);else values?.delete(p.uri);})});
      // The local worker already pushes diagnostics; external pull-only servers
      // need an owned scheduler, including refresh and dynamic registration.
      if(client!==this.builtin)this.disposables.push(new PullDiagnostics(client,{onError:error=>this.report(error)}));
      this.disposables.push({dispose:client.on('closed',()=>{this.diagnosticValues.get(client)?.clear();if(!this.disposed){this.report(new Error('Language server disconnected. Source remains editable; reapply Advanced Editor Options to reconnect.'));for(const language of ['vb6','xaml'])if(this.clients[language]===client)this.providers.get(language)?.dispose();}})});
      this.disposables.push({dispose:client.on('window/logMessage',p=>this.report(p.message))});
    }
    this.sync();this.installHooks();this.appearance();return this;
  }
  installHooks() {
    const wrap=(object,name,handler)=>{const original=object[name],wrapped=function(...args){return handler(original.bind(this),...args);};object[name]=wrapped;this.disposables.push({dispose:()=>{if(object[name]===wrapped)object[name]=original;}});};
    wrap(this.ide.documents,'editor',(original,module)=>{const editor=original(module);if(!this.syncing)this.attachSource(editor,module);return editor;});
    wrap(this.ide.documents,'reset',(original,...args)=>{for(const surface of [...this.surfaces.values()])surface.dispose();for(const record of [...this.records.values()])this.removeRecord(record);this.metadataKey=null;return original(...args);});
    if(this.ide.xaml)wrap(this.ide.xaml,'open',(original,...args)=>{const tool=original(...args);this.sync();if(tool){this.attachXaml(tool);this.surfaces.get(tool.editor)?.focus();}return tool;});
    // Definitions/Peek may open any model from the current project, not arbitrary URLs.
    this.disposables.push(this.monaco.editor.registerEditorOpener({openCodeEditor:async(_editor,uri,selection)=>{
      if(!this.records.has(uri.toString()))return false;this.open(uri.toString(),selection);return true;
    }}));
    for(const [id,editor]of this.ide.documents.editors){const module=this.ide.project.modules.find(m=>m.id===id);if(module)this.attachSource(editor,module);}
    for(const tool of this.ide.xaml?.tools.values()||[])this.attachXaml(tool);
  }
  metadata() {
    const p=this.ide.project;
    // No assets, gateway credentials, native handles, or runtime state are sent.
    return {id:p.id,name:p.name,startup:p.startup,settings:{tabWidth:p.settings.tabWidth,conditionalConstants:p.settings.conditionalConstants,anchoring:p.settings.anchoring},
      references:(p.references||[]).map(r=>({name:r.name,guid:r.guid,major:r.major,minor:r.minor,metadata:r.metadata})),
      modules:p.modules.map(m=>({id:m.id,name:m.name,kind:m.kind,attributes:m.attributes,code:m.code,
        ...(m.form?{form:{id:m.form.id,name:m.form.name,type:m.form.type,properties:{Name:m.form.name},controls:(m.form.controls||[]).map(c=>({id:c.id,name:c.name,type:c.type,properties:{Index:c.properties?.Index}}))}}:{})}))};
  }
  scheduleSync(){if(this.disposed||this.scheduled||this.syncing)return;this.scheduled=true;queueMicrotask(()=>{this.scheduled=false;try{this.sync();}catch(error){this.report(error);}});}
  sync() {
    if(this.disposed||this.syncing)return;this.syncing=true;
    try {
      const p=this.ide.project,key=p.id+':'+this.ide.visualRevision,metadataChanged=this.metadataKey!==key;
      const targets=[];
      for(const module of p.modules){targets.push({uri:uriFor(p,module,'vb6'),moduleId:module.id,language:'vb6',text:String(module.code||'')});
        if(p.settings.xaml===true&&module.form){const uri=uriFor(p,module,'xaml'),old=this.records.get(uri);targets.push({uri,moduleId:module.id,language:'xaml',text:metadataChanged||!old?readXamlDocument(module,{schema:this.ide.xaml?.schema}).text:old.lastText});}
      }
      const active=new Set(targets.map(t=>t.uri));for(const record of [...this.records.values()])if(!active.has(record.uri))this.removeRecord(record);
      if(metadataChanged&&this.builtin?.state==='ready'){this.builtin.notify('vb6/project',{project:this.metadata(),documents:targets.map(t=>({uri:t.uri,moduleId:t.moduleId,languageId:t.language}))});this.metadataKey=key;}
      for(const target of targets){let record=this.records.get(target.uri);if(!record)record=this.addRecord(target);else if(target.text!==record.model.getValue()&&!this.surfaces.get(record.legacy)?.composing)this.setText(record,target.text);}
      for(const [id,editor]of this.ide.documents.editors){const module=p.modules.find(m=>m.id===id);if(module)this.attachSource(editor,module);}
      for(const tool of this.ide.xaml?.tools.values()||[])this.attachXaml(tool);
      for(const surface of this.surfaces.values())surface.updateReadOnly();
    } finally {this.syncing=false;}
  }
  addRecord(target) {
    const record={...target,lastText:target.text,version:1,syncing:false};
    record.client=this.clients[target.language];record.model=this.monaco.editor.createModel(target.text,target.language,this.monaco.Uri.parse(target.uri));this.records.set(target.uri,record);
    if(record.client.state==='ready')record.client.open(target.uri,target.language,target.text,1);
    // Both native context-menu Undo and keyboard Undo use the IDE's transaction
    // history, including edits made by the form designer and other documents.
    record.model.undo=()=>this.ide.command('undo');record.model.redo=()=>this.ide.command('redo');
    record.model.canUndo=()=>this.ide.history.undoStack.length>0;record.model.canRedo=()=>this.ide.history.redoStack.length>0;
    record.listener=record.model.onDidChangeContent(event=>{
      const oldText=record.lastText,newText=record.model.getValue();record.lastText=newText;++record.version;
      if(record.client.state==='ready')try{
        const changes=event.isFlush||event.isEolChange?[{text:newText}]:[...event.changes].sort((a,b)=>b.rangeOffset-a.rangeOffset).map(c=>({range:toRange(c.range),rangeLength:c.rangeLength,text:c.text}));
        record.client.change(record.uri,changes,record.version);
      }catch(error){this.report(error);}
      if(!record.syncing){const surface=this.surfaces.get(record.legacy);try{surface?.changed(oldText,newText,event);}catch(error){this.report(error);this.setText(record,oldText);}}
    });return record;
  }
  setText(record,text) {
    if(record.model.getValue()===text)return;
    record.syncing=true;try {
      const before=record.model.getValue();let a=0,b=before.length,c=text.length;
      while(a<b&&a<c&&before[a]===text[a])a++;while(b>a&&c>a&&before[b-1]===text[c-1]){b--;c--;}
      const start=record.model.getPositionAt(a),end=record.model.getPositionAt(b);
      record.model.applyEdits([{range:new this.monaco.Range(start.lineNumber,start.column,end.lineNumber,end.column),text:text.slice(a,c)}]);
    }finally{record.syncing=false;}
  }
  removeRecord(record) {
    this.surfaces.get(record.legacy)?.dispose();record.listener?.dispose();if(record.client?.state==='ready')record.client.close(record.uri);record.model.dispose();this.records.delete(record.uri);
  }
  attachSource(editor,module) {
    if(editor.disposed||!module)return;
    const record=this.records.get(uriFor(this.ide.project,module,'vb6'));if(!record)return;
    const old=this.surfaces.get(editor);if(old?.record===record)return;old?.dispose();
    if(editor.module!==module||editor.text!==record.lastText)editor.setDocument(module,this.ide.project);
    record.legacy=editor;this.surfaces.set(editor,new AdvancedSurface(this,record,editor));
  }
  attachXaml(tool) {
    const module=this.ide.project.modules.find(m=>m.id===tool.moduleId);if(!module)return;
    const record=this.records.get(uriFor(this.ide.project,module,'xaml'));if(!record)return;
    const old=this.surfaces.get(tool.editor);if(old?.record===record)return;old?.dispose();record.legacy=tool.editor;this.surfaces.set(tool.editor,new AdvancedSurface(this,record,tool.editor));
  }
  active() {return [...this.surfaces.values()].find(s=>s.view?.hasTextFocus()||s.view?.hasWidgetFocus())||this.surfaces.get(this.ide.editor);}
  action(id){const surface=this.active();if(!surface)return;return surface.run(id);}
  handleCommand(id) {
    const active=this.active();if(!active||!active.root.isConnected)return null;
    // Do not redirect form/Properties commands simply because a code window exists.
    const mdi=this.ide.documents.mdi.active,isActive=active.view?.hasWidgetFocus()||mdi===active.record.moduleId+':code'||mdi==='tool:xaml:'+active.record.moduleId;
    if(!isActive)return null;
    const map={find:'actions.find',replace:'editor.action.startFindReplaceAction',findNext:'editor.action.nextMatchFindAction',findPrevious:'editor.action.previousMatchFindAction',
      listMembers:'editor.action.triggerSuggest',listConstants:'editor.action.triggerSuggest',completeWord:'editor.action.triggerSuggest',quickInfo:'editor.action.showHover',parameterInfo:'editor.action.triggerParameterHints',
      goToDefinition:'editor.action.revealDefinition',renameSymbol:'editor.action.rename',comment:'editor.action.addCommentLine',uncomment:'editor.action.removeCommentLine',formatCode:'editor.action.formatDocument',indent:'editor.action.indentLines',outdent:'editor.action.outdentLines',selectAll:'editor.action.selectAll',cut:'editor.action.clipboardCutAction',copy:'editor.action.clipboardCopyAction',paste:'editor.action.clipboardPasteAction'};
    if(map[id])return {handled:true,value:this.action(map[id])};return null;
  }
  open(uri,range) {
    const record=this.records.get(uri);if(!record)return false;
    const current=this.active();if(current&&!current.xaml)this.ide.definitionHistory.push({id:current.record.moduleId,offset:current.selection().start});if(this.ide.definitionHistory.length>100)this.ide.definitionHistory.shift();
    if(record.language==='xaml')this.ide.xaml.open(record.moduleId);else this.ide.openDocument(record.moduleId,'code');
    const surface=this.surfaces.get(record.legacy);if(!surface)return false;
    if(range){if(range.startLineNumber)surface.view.setSelection(range);else if(range.lineNumber)surface.view.setPosition(range);surface.view.revealPositionInCenter(surface.view.getPosition());}surface.focus();return true;
  }
  appearance(){if(this.disposed)return;applyAdvancedTheme(this.monaco,this.ide);for(const surface of this.surfaces.values())surface.appearance();}
  async message(p){const actions=(p.actions||[]).slice(0,8);return modal('Language Server',{content:el('p',{},String(p.message||'')),buttons:[...actions.map(a=>({label:a.title,value:a})),{label:'Close',value:null}]});}
  async applyEdit(client,edit,label='Language server edit',confirm=true) {
    try {
      if(this.disposed||!client||client.state!=='ready')throw new Error('Language server is no longer connected.');
      if(!client.responseIsCurrent(edit))throw new Error('Workspace edit is stale. Request it again.');
      this.sync();const plans=planWorkspaceEdit(edit,client.documents);
      if(!plans.length)return {applied:true};
      const snapshots=plans.map(p=>{const r=this.records.get(p.uri);if(!r)throw new Error('Unknown document.');return {record:r,version:r.model.getVersionId()};});
      if(confirm||plans.some(p=>p.annotations.some(a=>a.needsConfirmation))){
        const body=el('div',{},el('p',{},String(label||'Apply language-server changes')+' to '+plans.length+' document(s)?'),...plans.map(p=>el('p',{},decodeURIComponent(new URL(p.uri).pathname))));
        if(!await modal('Apply Workspace Edit',{content:body,buttons:[{label:'Apply',value:true,primary:true},{label:'Cancel',value:false}]}))return {applied:false,failureReason:'Cancelled.'};
      }
      for(const s of snapshots)if(s.record.model.isDisposed()||s.record.model.getVersionId()!==s.version||this.surfaces.get(s.record.legacy)?.composing)throw new Error('The document changed or an input composition is in progress.');
      const before=this.ide.project,next=prepareProjectEdits(before,plans,this.records,{schema:this.ide.xaml?.schema,runState:this.ide.runState,isLocked:id=>!!this.ide.documents.designers.get(id)?.locked});
      this.ide.project=next;
      if(this.ide.runState==='paused'){this.ide.pendingEdits=true;this.ide.editRevision=(this.ide.editRevision||0)+1;}
      this.ide.record(before,label||'Language server edit');this.sync();return {applied:true};
    }catch(error){return {applied:false,failureReason:error.message||String(error)};}
  }
  async executeCommand(client,raw) {
    if(this.disposed)return;
    try {
      if(raw.command==='vb6.applyCodeAction'){
        const [action,uri,version]=raw.arguments||[],record=this.records.get(uri);
        if(!record||record.model.getVersionId()!==version||!client.responseIsCurrent(action))throw new Error('Code action is stale. Request it again.');
        if(action.edit){const result=await this.applyEdit(client,action.edit,action.title,false);if(!result.applied)throw new Error(result.failureReason);}
        if(action.command)return this.executeCommand(client,action.command);return;
      }
      if(raw.command==='vb6.showReferences'){
        const [uri,position,references]=raw.arguments||[];const body=el('div',{},el('p',{},references.length+' reference(s).'));
        let selected=null;for(const location of references.slice(0,2000))body.append(el('button',{type:'button',style:{display:'block'},onclick:()=>{selected=location;finish?.(true);}},decodeURIComponent(new URL(location.uri).pathname.split('/').pop())+':'+(location.range.start.line+1)));
        let finish;await modal('Find References',{content:body,onReady:context=>finish=context.finish,buttons:[{label:'Close',value:false}]});if(selected)this.open(selected.uri,fromRange(selected.range));return;
      }
      const allowed=[...(client.capabilities.executeCommandProvider?.commands||[]),...[...client.registrations.values()].filter(r=>r.method==='workspace/executeCommand').flatMap(r=>r.registerOptions?.commands||[])];
      if(!allowed.includes(raw.command))throw new Error('The language server did not advertise this command: '+raw.command);
      if(!await modal('Run Language Server Command',{content:el('p',{},'Run '+raw.command+' on the configured language server?'),buttons:[{label:'Run',value:true,primary:true},{label:'Cancel',value:false}]}))return;
      return await client.request('workspace/executeCommand',{command:raw.command,arguments:raw.arguments});
    }catch(error){this.report(error);}
  }
  willSave(){const values=[];for(const record of this.records.values()){if(record.client.state==='ready')record.client.willSave(record.uri);values.push({record,version:record.version});}return values;}
  didSave(values=[]){for(const {record,version}of values)if(this.records.get(record.uri)===record&&record.version===version&&record.client.state==='ready')record.client.save(record.uri);}
  dispose(){if(this.disposed)return;this.disposed=true;this.abort.abort();for(const surface of [...this.surfaces.values()])surface.dispose();for(const record of [...this.records.values()])this.removeRecord(record);for(const provider of this.providers.values())provider.dispose();this.providers.clear();for(const item of [...this.disposables].reverse())item.dispose();for(const client of this.sessions)client.dispose();this.sessions.clear();this.diagnosticValues.clear();}
}

export async function createAdvancedEditorRuntime(ide,settings,assets,{signal}={}) {
  const runtime=new AdvancedEditorRuntime(ide,settings,assets),cancel=()=>runtime.dispose();
  signal?.addEventListener('abort',cancel,{once:true});
  runtime.disposables.push({dispose:()=>signal?.removeEventListener('abort',cancel)});
  if(signal?.aborted)cancel();
  try{return await runtime.initialize();}catch(error){runtime.dispose();throw error;}
}
