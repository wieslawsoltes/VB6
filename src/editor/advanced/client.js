import {JsonRpcPeer,RpcError,RPC_CONTENT_MODIFIED} from './rpc.js';
import {LspTextDocument} from './text-document.js';

/** Methods with a Monaco presentation. Unknown/custom requests remain available
 * through request(), but are never falsely advertised as editor features. */
export const LSP_PROVIDERS = Object.freeze({
  'textDocument/completion':'completionProvider', 'textDocument/hover':'hoverProvider',
  'textDocument/signatureHelp':'signatureHelpProvider', 'textDocument/declaration':'declarationProvider',
  'textDocument/definition':'definitionProvider', 'textDocument/typeDefinition':'typeDefinitionProvider',
  'textDocument/implementation':'implementationProvider', 'textDocument/references':'referencesProvider',
  'textDocument/documentHighlight':'documentHighlightProvider', 'textDocument/documentSymbol':'documentSymbolProvider',
  'workspace/symbol':'workspaceSymbolProvider', 'textDocument/codeAction':'codeActionProvider',
  'textDocument/codeLens':'codeLensProvider', 'textDocument/documentLink':'documentLinkProvider',
  'textDocument/documentColor':'colorProvider', 'textDocument/formatting':'documentFormattingProvider',
  'textDocument/rangeFormatting':'documentRangeFormattingProvider', 'textDocument/onTypeFormatting':'documentOnTypeFormattingProvider',
  'textDocument/rename':'renameProvider', 'textDocument/foldingRange':'foldingRangeProvider',
  'textDocument/selectionRange':'selectionRangeProvider', 'textDocument/linkedEditingRange':'linkedEditingRangeProvider',
  'textDocument/semanticTokens':'semanticTokensProvider', 'textDocument/inlayHint':'inlayHintProvider',
  'textDocument/prepareCallHierarchy':'callHierarchyProvider', 'textDocument/prepareTypeHierarchy':'typeHierarchyProvider',
  'textDocument/inlineValue':'inlineValueProvider', 'textDocument/diagnostic':'diagnosticProvider',
});
const tokenTypes = ['namespace','type','class','enum','interface','struct','typeParameter','parameter','variable','property','enumMember','event','function','method','macro','keyword','modifier','comment','string','number','regexp','operator','decorator'];
const tokenModifiers = ['declaration','definition','readonly','static','deprecated','abstract','async','modification','documentation','defaultLibrary'];

export function languageClientCapabilities() {
  const dynamic = { dynamicRegistration:true };
  return {
    general:{positionEncodings:['utf-16']},
    workspace:{applyEdit:true,workspaceEdit:{documentChanges:true,failureHandling:'transactional',changeAnnotationSupport:{groupsOnLabel:true}},workspaceFolders:true,configuration:true,
      symbol:{...dynamic,symbolKind:{valueSet:Array.from({length:26},(_,i)=>i+1)}},
      semanticTokens:{refreshSupport:true},inlayHint:{refreshSupport:true},codeLens:{refreshSupport:true},diagnostics:{refreshSupport:true}},
    textDocument:{
      synchronization:{...dynamic,willSave:true,didSave:true,willSaveWaitUntil:false},
      completion:{...dynamic,contextSupport:true,completionItem:{snippetSupport:true,commitCharactersSupport:true,documentationFormat:['markdown','plaintext'],deprecatedSupport:true,preselectSupport:true,tagSupport:{valueSet:[1]},insertReplaceSupport:true,resolveSupport:{properties:['documentation','detail','additionalTextEdits','command']},insertTextModeSupport:{valueSet:[1,2]},labelDetailsSupport:true}},
      hover:{...dynamic,contentFormat:['markdown','plaintext']},
      signatureHelp:{...dynamic,contextSupport:true,signatureInformation:{documentationFormat:['markdown','plaintext'],parameterInformation:{labelOffsetSupport:true},activeParameterSupport:true}},
      declaration:{...dynamic,linkSupport:true},definition:{...dynamic,linkSupport:true},typeDefinition:{...dynamic,linkSupport:true},implementation:{...dynamic,linkSupport:true},
      references:dynamic,documentHighlight:dynamic,
      documentSymbol:{...dynamic,hierarchicalDocumentSymbolSupport:true,labelSupport:true,tagSupport:{valueSet:[1]}},
      codeAction:{...dynamic,isPreferredSupport:true,disabledSupport:true,dataSupport:true,resolveSupport:{properties:['edit','command']},codeActionLiteralSupport:{codeActionKind:{valueSet:['','quickfix','refactor','refactor.extract','refactor.inline','refactor.rewrite','source','source.organizeImports','source.fixAll']}}},
      codeLens:dynamic,documentLink:{...dynamic,tooltipSupport:true},colorProvider:dynamic,
      formatting:dynamic,rangeFormatting:dynamic,onTypeFormatting:dynamic,
      rename:{...dynamic,prepareSupport:true,prepareSupportDefaultBehavior:1,honorsChangeAnnotations:true},
      foldingRange:{...dynamic,lineFoldingOnly:true,foldingRangeKind:{valueSet:['comment','imports','region']}},
      selectionRange:dynamic,linkedEditingRange:dynamic,callHierarchy:dynamic,typeHierarchy:dynamic,inlineValue:dynamic,
      semanticTokens:{...dynamic,requests:{range:true,full:{delta:true}},tokenTypes,tokenModifiers,formats:['relative'],overlappingTokenSupport:false,multilineTokenSupport:false,serverCancelSupport:true,augmentsSyntaxTokens:true},
      inlayHint:{...dynamic,resolveSupport:{properties:['tooltip','textEdits','label.tooltip','label.location','label.command']}},
      publishDiagnostics:{relatedInformation:true,versionSupport:true,tagSupport:{valueSet:[1,2]},codeDescriptionSupport:true,dataSupport:true},
      diagnostic:{...dynamic,relatedDocumentSupport:true},
    },
    window:{workDoneProgress:true,showMessage:{messageActionItem:{additionalPropertiesSupport:false}},showDocument:{support:false}},
  };
}

function providerMethod(method) {
  if (method.startsWith('textDocument/semanticTokens/')) return 'textDocument/semanticTokens';
  const alias = {'textDocument/prepareRename':'textDocument/rename','textDocument/colorPresentation':'textDocument/documentColor',
    'completionItem/resolve':'textDocument/completion','codeAction/resolve':'textDocument/codeAction','codeLens/resolve':'textDocument/codeLens',
    'documentLink/resolve':'textDocument/documentLink','inlayHint/resolve':'textDocument/inlayHint','workspaceSymbol/resolve':'workspace/symbol',
    'callHierarchy/incomingCalls':'textDocument/prepareCallHierarchy','callHierarchy/outgoingCalls':'textDocument/prepareCallHierarchy',
    'typeHierarchy/supertypes':'textDocument/prepareTypeHierarchy','typeHierarchy/subtypes':'textDocument/prepareTypeHierarchy'};
  return alias[method] || method;
}

/** LSP document selectors support language, URI scheme and glob paths. */
export function matchesDocumentSelector(selector,document) {
  if(!selector)return true;
  const uri=new URL(document.uri),path=decodeURIComponent(uri.pathname);
  const globMatch=(glob,value)=>{
    if(typeof glob!=='string')return false;
    let regex='^';
    for(let i=0;i<glob.length;i++) {
      const c=glob[i];
      if(c==='*'){if(glob[i+1]==='*'){i++;if(glob[i+1]==='/'){i++;regex+='(?:.*/)?';}else regex+='.*';}else regex+='[^/]*';}
      else if(c==='?')regex+='[^/]';
      else if(c==='{')regex+='(?:';else if(c==='}')regex+=')';else if(c===',')regex+='|';
      else regex+=c.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
    }
    try{return new RegExp(regex+'$').test(value);}catch{return false;}
  };
  return selector.some(filter=>{
    if(typeof filter==='string')return filter===document.languageId;
    if(filter.language&&filter.language!==document.languageId||filter.scheme&&filter.scheme!==uri.protocol.slice(0,-1))return false;
    if(!filter.pattern)return true;
    if(typeof filter.pattern==='string')return globMatch(filter.pattern,path);
    const base=typeof filter.pattern.baseUri==='string'?filter.pattern.baseUri:filter.pattern.baseUri?.uri;
    if(!base)return false;
    const prefix=new URL(base).href.replace(/\/$/,'')+'/';
    return document.uri.startsWith(prefix)&&globMatch(filter.pattern.pattern,decodeURIComponent(document.uri.slice(prefix.length)));
  });
}

/** An explicitly owned session. The caller owns source documents, consent to
 * connect externally and the transaction that applies workspace edits. */
export class LanguageClient {
  constructor(transport, {rootUri=null,folders=[],configuration={},applyEdit=async()=>({applied:false,failureReason:'Workspace edits are not enabled.'}),showMessage=()=>null,onError=()=>{}}={}) {
    this.peer=new JsonRpcPeer(transport,{onError,onClose:reason=>{if(this.state!=='closed'){this.state='closed';this.emit('closed',reason);}}});this.rootUri=rootUri;this.folders=folders;this.configuration=configuration;
    this.documents=new Map();this.opened=new Set();this.registrations=new Map();this.listeners=new Map();this.capabilities={};this.state='new';
    this.peer.onRequest('workspace/configuration',p=>(p.items||[]).map(item=>item.section?item.section.split('.').reduce((v,k)=>v&&Object.hasOwn(v,k)?v[k]:undefined,this.configuration)??null:this.configuration));
    this.peer.onRequest('workspace/workspaceFolders',()=>this.folders.length?this.folders:null);
    this.peer.onRequest('workspace/applyEdit',async p=>{
      try { return await applyEdit(p.edit,p.label); } catch(error) { return {applied:false,failureReason:error.message}; }
    });
    this.peer.onRequest('window/showMessageRequest',p=>showMessage(p));
    this.peer.onRequest('window/workDoneProgress/create',()=>null);
    this.peer.onRequest('client/registerCapability',p=>{
      for(const registration of p.registrations||[])this.registrations.set(registration.id,registration);
      if(this.state==='ready')for(const document of this.documents.values())this.syncOpen(document);
      this.emit('capabilities',this.capabilities);return null;
    });
    this.peer.onRequest('client/unregisterCapability',p=>{
      for(const registration of p.unregisterations||p.unregistrations||[])this.registrations.delete(registration.id);
      this.emit('capabilities',this.capabilities);return null;
    });
    for(const name of ['semanticTokens','inlayHint','codeLens','diagnostic'])this.peer.onRequest('workspace/'+name+'/refresh',()=>{this.emit('refresh',name);return null;});
    this.peer.onNotification('textDocument/publishDiagnostics',p=>{
      const document=this.documents.get(p.uri);
      if(!document||p.version!==undefined&&p.version!==document.version)return;
      this.emit('diagnostics',p);
    });
    for(const method of ['window/logMessage','window/showMessage','$/progress'])this.peer.onNotification(method,p=>this.emit(method,p));
  }
  on(name,listener) { let set=this.listeners.get(name);if(!set)this.listeners.set(name,set=new Set());set.add(listener);return ()=>set.delete(listener); }
  emit(name,value) { for(const listener of this.listeners.get(name)||[])listener(value); }
  async initialize(initializationOptions={}) {
    if(this.state!=='new')throw new Error('Language client was already initialized.');this.state='initializing';
    try {
      const result=await this.peer.request('initialize',{processId:null,clientInfo:{name:'VB6 Studio Web advanced editor',version:'1'},rootUri:this.rootUri,
        workspaceFolders:this.folders.length?this.folders:null,capabilities:languageClientCapabilities(),initializationOptions});
      if(result?.capabilities?.positionEncoding && result.capabilities.positionEncoding!=='utf-16')throw new Error('The language server selected an unsupported position encoding; UTF-16 is required.');
      if(!result?.capabilities)throw new Error('The language server did not return capabilities.');
      this.capabilities=result.capabilities;this.serverInfo=result.serverInfo;this.peer.notify('initialized',{});this.state='ready';
      this.peer.notify('workspace/didChangeConfiguration',{settings:this.configuration});this.emit('capabilities',this.capabilities);return this;
    }catch(error){this.dispose();throw error;}
  }
  capability(method,document=null) {
    method=providerMethod(method);
    const registered=[...this.registrations.values()].filter(r=>r.method===method);
    for(const r of registered) {
      const selector=r.registerOptions?.documentSelector;
      if(!document||matchesDocumentSelector(selector,document))return r.registerOptions||true;
    }
    return this.capabilities[LSP_PROVIDERS[method]]||false;
  }
  syncOpen(document) {
    const sync=this.capabilities.textDocumentSync;
    if(!this.opened.has(document.uri)&&(typeof sync==='number'||sync?.openClose||this.capability('textDocument/didOpen',document))) {
      this.peer.notify('textDocument/didOpen',{textDocument:{uri:document.uri,languageId:document.languageId,text:document.text,version:document.version}});this.opened.add(document.uri);
    }
  }
  requireReady() {if(this.state!=='ready'||this.peer.closed)throw new Error('Language server is not ready.');}
  open(uri,languageId,text,version=1) {
    this.requireReady();if(this.documents.has(uri))throw new Error('Document is already open: '+uri);
    const document=new LspTextDocument(uri,languageId,text,version);this.documents.set(uri,document);
    this.syncOpen(document);
    return document;
  }
  change(uri,changes,version) {
    this.requireReady();const document=this.documents.get(uri);if(!document)throw new Error('Document is not open: '+uri);
    document.applyChanges(changes,version);
    const sync=this.capabilities.textDocumentSync,kind=this.capability('textDocument/didChange',document)?.syncKind??(typeof sync==='number'?sync:sync?.change);
    if(kind===1||kind===2)this.peer.notify('textDocument/didChange',{textDocument:{uri,version},contentChanges:kind===1?[{text:document.text}]:changes});
    return document;
  }
  willSave(uri,reason=1) {
    const document=this.documents.get(uri);if(!document||this.state!=='ready')return;
    if(this.capabilities.textDocumentSync?.willSave)this.peer.notify('textDocument/willSave',{textDocument:{uri},reason});
  }
  save(uri) {
    const document=this.documents.get(uri);if(!document||this.state!=='ready')return;
    const sync=this.capabilities.textDocumentSync;
    if(sync?.save)this.peer.notify('textDocument/didSave',{textDocument:{uri},...(sync.save.includeText?{text:document.text}:{})});
  }
  close(uri) {
    const document=this.documents.get(uri);if(!document)return;this.documents.delete(uri);
    const wasOpen=this.opened.delete(uri),sync=this.capabilities.textDocumentSync;
    if(this.state==='ready'&&!this.peer.closed&&(wasOpen||typeof sync==='number'||sync?.openClose||this.capability('textDocument/didClose',document)))this.peer.notify('textDocument/didClose',{textDocument:{uri}});
    this.emit('diagnostics',{uri,diagnostics:[]});
  }
  async request(method,params,{signal,allowStale=false,...options}={}) {
    this.requireReady();const uri=params?.textDocument?.uri,document=uri?this.documents.get(uri):null,version=document?.version;
    const value=await this.peer.request(method,params,{signal,...options});
    if(!allowStale&&uri&&(!this.documents.has(uri)||this.documents.get(uri).version!==version))throw new RpcError(RPC_CONTENT_MODIFIED,'The document changed while the language server was processing the request.');
    return value;
  }
  notify(method,params) {this.requireReady();this.peer.notify(method,params);}
  async shutdown() {
    if(this.state!=='ready'){this.dispose();return;}
    for(const uri of [...this.documents.keys()])this.close(uri);
    this.state='stopping';
    try {await this.peer.request('shutdown',null,{timeout:1500});this.peer.notify('exit');}finally{this.dispose();}
  }
  dispose() {if(this.state==='closed')return;this.state='closed';this.peer.close();this.documents.clear();this.opened.clear();this.registrations.clear();this.emit('closed');this.listeners.clear();}
}
