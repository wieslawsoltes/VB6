import {JsonRpcPeer,RpcError,RPC_CANCELLED,RPC_CONTENT_MODIFIED} from './rpc.js';
import {LspTextDocument} from './text-document.js';
import {EditorIntelligence,wordAt} from '../intelligence.js';
import {KEYWORDS,formatCode} from '../language-service.js';
import {tokenize} from '../../language/lexer.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../../language/diagnostics.js';
import {XamlLanguageService} from '../../../packages/xaml-compiler/src/index.js';
import {createVb6XamlSchema} from '../../xaml/forms.js';

export const BUILTIN_TOKEN_LEGEND = Object.freeze({tokenTypes:['namespace','type','class','enum','parameter','variable','property','enumMember','event','function','method','keyword','modifier','comment','string','number','operator'],tokenModifiers:['declaration','readonly','defaultLibrary']});
const keywords=new Set(KEYWORDS.map(s=>s.toLowerCase()));
const key=s=>String(s||'').replace(/^\[|\]$/g,'').replace(/[$%&!#@]$/,'').toLowerCase();
const kind=s=>({module:2,class:5,type:23,enum:10,constant:14,parameter:13,variable:13,field:8,control:8,event:24,sub:12,function:12,property:7,'property get':7,'property let':7,'property set':7,label:20}[s.kind]||13);
const identity=s=>s?.moduleId&&s.name ? [s.moduleId,s.ownerId||'',s.parentType||'',key(s.name)].join('|'):null;
const completionKind=s=>({module:9,class:7,type:22,enum:13,constant:21,parameter:6,variable:6,field:5,control:6,event:23,sub:3,function:3,property:10,'property get':10,'property let':10,'property set':10,keyword:14}[s.kind]||6);
const yieldTask=()=>new Promise(resolve=>setTimeout(resolve,0));
const checkCancelled=signal=>{if(signal?.aborted)throw new RpcError(RPC_CANCELLED,'Request cancelled.');};
const safeTokenize=line=>{try{return tokenize(line);}catch{return [];}};
const plainDescription=s=>s?.description||s?.signature||`${s?.name||''}${s?.params?'('+s.params.join(', ')+')':''}${s?.type?' As '+s.type:''}`;
const tokenKind=s=>({module:'namespace',class:'class',type:'type',enum:'enum',parameter:'parameter',variable:'variable',field:'property',control:'variable',constant:s.parentType?'enumMember':'variable',event:'event',sub:'function',function:'function',property:'property','property get':'property','property let':'property','property set':'property'}[s.kind]||'variable');

function symbolRange(document,symbol) {
  const line=Math.max(0,Math.min(document.lineStarts.length-1,(symbol.line||1)-1));
  const base=document.lineStarts[line],raw=document.text.slice(base,document.lineEnds[line]);
  const match=safeTokenize(raw).find(t=>t.type==='id'&&key(t.value)===key(symbol.name));
  const start=base+(match?.start||0),end=base+(match?.end||0);
  return document.range(start,end);
}
function tokenAt(document,position) {
  const offset=document.offsetAt(position),base=document.lineStarts[position.line]??document.text.length;
  return safeTokenize(document.text.slice(base,document.lineEnds[position.line])).find(t=>t.type==='id'&&base+t.start<=offset&&offset<=base+t.end);
}
function lspDiagnostic(d,document) {
  const severity=({error:1,warning:2,information:3,hint:4})[d.severity]||1;
  const start=d.range?.start||{line:Math.max(0,(d.line||1)-1),character:Math.max(0,(d.column||1)-1)};
  const at=document.offsetAt(start);return {range:d.range||document.range(at,Math.min(at+1,document.text.length)),severity,code:d.code||d.number,source:'VB6',message:d.message};
}

/** In-process/worker/stdio LSP server over the existing compiler services.
 * Documents are immutable snapshots. No runtime code or COM object is executed. */
export class BuiltinLanguageServer {
  constructor(transport,{diagnosticDelay=200}={}) {
    this.peer=new JsonRpcPeer(transport,{onError:error=>this.log(error.message)});
    this.documents=new Map();this.moduleUris=new Map();this.uriModules=new Map();this.intelligence=new EditorIntelligence();
    this.xaml=new XamlLanguageService({schema:createVb6XamlSchema()});this.diagnosticCache=new ProjectDiagnosticCache();
    this.project={id:'workspace',name:'Workspace',settings:{},modules:[]};this.revision=0;this.initialized=false;this.stopped=false;this.diagnosticDelay=diagnosticDelay;this.tokenCache=new Map();this.occurrenceCache=new Map();this.referenceCache=new Map();this.diagnostics=new Map();
    this.peer.onRequest('initialize',()=>{if(this.initializeRequested)throw new RpcError(-32600,'Already initialized.');this.initializeRequested=true;return ({serverInfo:{name:'VB6 Studio built-in language server',version:'1'},capabilities:{
      positionEncoding:'utf-16',textDocumentSync:{openClose:true,change:2,save:{includeText:false}},
      completionProvider:{triggerCharacters:['.',' ','<',':','{','"'],resolveProvider:false},hoverProvider:true,signatureHelpProvider:{triggerCharacters:['(',','],retriggerCharacters:[',',')']},
      definitionProvider:true,referencesProvider:true,documentHighlightProvider:true,documentSymbolProvider:true,workspaceSymbolProvider:true,
      renameProvider:{prepareProvider:true},documentFormattingProvider:true,documentRangeFormattingProvider:true,
      foldingRangeProvider:true,selectionRangeProvider:true,linkedEditingRangeProvider:true,
      semanticTokensProvider:{legend:BUILTIN_TOKEN_LEGEND,range:true,full:{delta:true}},
      codeActionProvider:{codeActionKinds:['source.fixAll']},
      inlayHintProvider:{resolveProvider:false},codeLensProvider:{resolveProvider:true},
      diagnosticProvider:{identifier:'vb6-studio',interFileDependencies:true,workspaceDiagnostics:false},
    }});});
    this.peer.onNotification('initialized',()=>{this.initialized=true;});
    this.peer.onRequest('shutdown',()=>{this.stopped=true;clearTimeout(this.diagnosticTimer);return null;});
    this.peer.onNotification('exit',()=>this.dispose());
    this.peer.onNotification('workspace/didChangeConfiguration',()=>{});
    this.peer.onNotification('vb6/project',p=>this.setProject(p));
    this.peer.onNotification('textDocument/didOpen',p=>this.open(p.textDocument));
    this.peer.onNotification('textDocument/didChange',p=>this.change(p.textDocument,p.contentChanges));
    this.peer.onNotification('textDocument/didClose',p=>this.close(p.textDocument.uri));
    this.peer.onNotification('textDocument/didSave',()=>this.scheduleDiagnostics());
    const handlers={
      'textDocument/completion':(p,c)=>this.completion(p,c), 'textDocument/hover':p=>this.hover(p),
      'textDocument/signatureHelp':p=>this.signatureHelp(p),'textDocument/definition':p=>this.definition(p),
      'textDocument/references':(p,c)=>this.references(p,c),'textDocument/documentHighlight':async(p,c)=>(await this.references({...p,context:{includeDeclaration:true}},c)).filter(r=>r.uri===p.textDocument.uri).map(r=>({range:r.range,kind:1})),
      'textDocument/documentSymbol':p=>this.symbols(p.textDocument.uri),'workspace/symbol':p=>this.workspaceSymbols(p.query),
      'textDocument/prepareRename':p=>this.prepareRename(p),'textDocument/rename':(p,c)=>this.rename(p,c),
      'textDocument/formatting':p=>this.format(p),'textDocument/rangeFormatting':p=>this.format(p),
      'textDocument/foldingRange':p=>this.folding(p),'textDocument/selectionRange':p=>this.selectionRanges(p),
      'textDocument/linkedEditingRange':p=>this.linkedEditing(p),
      'textDocument/semanticTokens/full':(p,c)=>this.semantic(p,c),
      'textDocument/semanticTokens/full/delta':(p,c)=>this.semantic(p,c),
      'textDocument/semanticTokens/range':(p,c)=>this.semantic(p,c),
      'textDocument/codeAction':p=>this.codeActions(p),
      'textDocument/inlayHint':p=>this.inlayHints(p),
      'textDocument/codeLens':p=>this.codeLenses(p),
      'codeLens/resolve':(p,c)=>this.resolveCodeLens(p,c),
      'textDocument/diagnostic':async(p)=>{await this.computeDiagnostics();return {kind:'full',items:this.diagnostics.get(p.textDocument.uri)||[]};},
    };
    for(const [method,handler]of Object.entries(handlers))this.peer.onRequest(method,async(p,context)=>{
      if(!this.initialized)throw new RpcError(-32002,'Server not initialized.');if(this.stopped)throw new RpcError(-32600,'Server has shut down.');
      const document=p?.textDocument?this.document(p.textDocument.uri):null,revision=this.revision;
      checkCancelled(context.signal);const result=await handler(p,context);checkCancelled(context.signal);
      if(document&&(this.documents.get(document.uri)!==document||revision!==this.revision))throw new RpcError(RPC_CONTENT_MODIFIED,'Workspace changed during the request.');
      return result;
    });
  }
  log(message) {if(!this.peer.closed)this.peer.notify('window/logMessage',{type:2,message:String(message)});}
  document(uri) {const document=this.documents.get(uri);if(!document)throw new RpcError(-32602,'Document is not open.');return document;}
  module(document) {const id=this.uriModules.get(document.uri);return this.project.modules.find(m=>m.id===id);}
  setProject({project,documents=[]}={}) {
    if(!project||!Array.isArray(project.modules)||project.modules.length>2048)throw new RpcError(-32602,'Invalid project metadata.');
    this.moduleUris=new Map(documents.filter(d=>d.languageId==='vb6').map(d=>[d.moduleId,d.uri]));this.uriModules=new Map(documents.map(d=>[d.uri,d.moduleId]));
    this.project={...project,modules:project.modules.map(m=>({...m,code:this.documents.get(this.moduleUris.get(m.id))?.text??String(m.code||'')}))};
    this.revision++;this.intelligence.prune(this.project);this.tokenCache.clear();this.occurrenceCache.clear();this.referenceCache.clear();this.scheduleDiagnostics();
  }
  open({uri,languageId,text,version}) {
    if(!['vb6','xaml'].includes(languageId)||this.documents.has(uri)||this.documents.size>=4096||text?.length>16*1024*1024)throw new RpcError(-32602,'Invalid or oversized document.');
    const document=new LspTextDocument(uri,languageId,text,version);this.documents.set(uri,document);this.updateDocument(document);
  }
  change({uri,version},changes) {
    const previous=this.document(uri),document=previous.fork();
    document.applyChanges(changes,version);if(document.text.length>16*1024*1024)throw new RpcError(-32602,'Document exceeds the size limit.');
    this.documents.set(uri,document);this.updateDocument(document);
  }
  updateDocument(document) {
    if(document.languageId==='xaml')this.xaml.openDocument(document.uri,document.text,document.version);
    else {
      let id=this.uriModules.get(document.uri);
      if(!id){id=document.uri;this.uriModules.set(document.uri,id);this.moduleUris.set(id,document.uri);this.project={...this.project,modules:[...this.project.modules,{id,name:decodeURIComponent(document.uri.split('/').pop()||'Module').replace(/\.[^.]*$/,''),kind:'module',code:document.text}]};}
      else this.project={...this.project,modules:this.project.modules.map(m=>m.id===id?{...m,code:document.text}:m)};
    }
    this.revision++;this.tokenCache.delete(document.uri);this.occurrenceCache.delete(document.uri);this.referenceCache.clear();this.scheduleDiagnostics();
  }
  close(uri) {this.documents.delete(uri);this.xaml.closeDocument(uri);this.tokenCache.delete(uri);this.occurrenceCache.delete(uri);this.referenceCache.clear();this.diagnostics.delete(uri);this.revision++;if(!this.peer.closed)this.peer.notify('textDocument/publishDiagnostics',{uri,diagnostics:[]});}
  target(p) {
    const document=this.document(p.textDocument.uri),module=this.module(document),offset=document.offsetAt(p.position);
    return {document,module,offset,symbol:document.languageId==='vb6'&&module?this.intelligence.definition(this.project,module,p.position.line+1,document.text,offset):null};
  }
  completion(p) {
    const document=this.document(p.textDocument.uri);
    if(document.languageId==='xaml')return {isIncomplete:false,items:this.xaml.completion(document.uri,p.position).map(s=>({label:s.label,kind:({type:7,property:10,event:23,snippet:15,value:12,reference:18})[s.kind]||1,detail:s.detail,textEdit:{range:s.range,newText:s.insertText}}))};
    const module=this.module(document),offset=document.offsetAt(p.position);
    const result=this.intelligence.completions(this.project,module,p.position.line+1,document.text,offset);
    const items=result.items.slice(0,2000).map(s=>({label:s.name,kind:completionKind(s),detail:plainDescription(s),documentation:s.description?{kind:'plaintext',value:s.description}:undefined,
      textEdit:{range:document.range(result.start,result.end),newText:s.insertText||s.name}}));
    if(result.context!=='members')for(const [label,body]of [['sub','Private Sub ${1:Name}()\n\t$0\nEnd Sub'],['function','Private Function ${1:Name}() As ${2:Variant}\n\t$0\nEnd Function'],['for','For ${1:i} = ${2:0} To ${3:10}\n\t$0\nNext ${1:i}'],['if','If ${1:condition} Then\n\t$0\nEnd If'],['select','Select Case ${1:expression}\n\tCase ${2:value}\n\t\t$0\nEnd Select']]) {
      if(!result.prefix||label.startsWith(result.prefix.toLowerCase()))items.push({label,kind:15,detail:'VB6 snippet',insertTextFormat:2,textEdit:{range:document.range(result.start,result.end),newText:body}});
    }
    return {isIncomplete:result.items.length>2000,items};
  }
  hover(p) {
    const {document,symbol}=this.target(p);
    if(document.languageId==='xaml')return this.xaml.hover(document.uri,p.position);
    if(!symbol)return null;
    const at=document.offsetAt(p.position),word=wordAt(document.text,at);
    return {contents:{kind:'plaintext',value:plainDescription(symbol)},range:document.range(word.start,word.end)};
  }
  signatureHelp(p) {
    const {document,module,offset}=this.target(p);if(!module||document.languageId!=='vb6')return null;
    const info=this.intelligence.parameterInfo(this.project,module,p.position.line+1,document.text,offset);if(!info)return null;
    const params=info.displayParams||info.params;
    return {signatures:[{label:info.name+'('+params.join(', ')+')'+(info.type&&info.type!=='Void'?' As '+info.type:''),parameters:params.map(label=>({label})),documentation:info.description?{kind:'plaintext',value:info.description}:undefined}],activeSignature:0,activeParameter:Math.max(0,info.active)};
  }
  definition(p) {
    const {document,symbol}=this.target(p);if(document.languageId==='xaml')return this.xaml.definition(document.uri,p.position).map(r=>({uri:r.uri,range:r.range}));
    const uri=symbol&&this.moduleUris.get(symbol.moduleId),target=this.documents.get(uri);
    return target&&symbol.kind!=='control'?[{uri,range:symbolRange(target,symbol)}]:[];
  }
  async references(p,{signal}={}) {
    const {document,symbol}=this.target(p),include=p.context?.includeDeclaration!==false;
    if(document.languageId==='xaml')return this.xaml.references(document.uri,p.position,include).map(r=>({uri:r.uri,range:r.range}));
    const target=identity(symbol);if(!target)return [];
    const project=this.project,result=[],documents=new Map(this.documents),uris=new Map(this.moduleUris);
    for(const module of project.modules){
      const uri=uris.get(module.id),doc=documents.get(uri);if(!doc)continue;
      const occurrences=await this.occurrences(doc,signal);
      for(const {line,start,end}of occurrences.get(key(symbol.name))||[]) {
        checkCancelled(signal);
        const hit=this.intelligence.definition(project,module,line+1,doc.text,start+Math.min(1,end-start));
        if(identity(hit)!==target)continue;
        const range=doc.range(start,end),declaration=hit.moduleId===module.id&&hit.line===line+1&&JSON.stringify(symbolRange(doc,hit))===JSON.stringify(range);
        if(include||!declaration)result.push({uri,range});
        if(result.length>100000)throw new RpcError(-32602,'More than 100,000 references; narrow the workspace.');
      }
    }
    return result;
  }
  async occurrences(document,signal) {
    const cached=this.occurrenceCache.get(document.uri);if(cached?.document===document)return cached.values;
    const values=new Map();
    for(let line=0;line<document.lineStarts.length;line++) {
      if(line%128===0){checkCancelled(signal);await yieldTask();}
      const base=document.lineStarts[line];
      for(const token of safeTokenize(document.text.slice(base,document.lineEnds[line])))if(token.type==='id') {
        const name=key(token.value);let list=values.get(name);if(!list)values.set(name,list=[]);
        list.push({line,start:base+token.start,end:base+token.end});
      }
    }
    if(this.documents.get(document.uri)===document)this.occurrenceCache.set(document.uri,{document,values});
    return values;
  }
  inlayHints(p) {
    const document=this.document(p.textDocument.uri);if(document.languageId!=='vb6')return [];
    const module=this.module(document),hints=[],seen=new Set();
    for(let line=Math.max(0,p.range.start.line);line<=Math.min(document.lineStarts.length-1,p.range.end.line);line++) {
      const base=document.lineStarts[line],tokens=safeTokenize(document.text.slice(base,document.lineEnds[line]));
      for(let i=1;i<tokens.length;i++) {
        const token=tokens[i],previous=tokens[i-1];
        if(token.type==='eof'||!(['(',','].includes(previous.value)||previous.type==='id'&&previous.end<token.start))continue;
        const info=this.intelligence.parameterInfo(this.project,module,line+1,document.text,base+token.start);
        const parameter=info?.parameters?.[info.active];
        if(!parameter||info.context.named||key(token.value)===key(parameter.name)||seen.has(base+token.start))continue;
        seen.add(base+token.start);hints.push({position:document.positionAt(base+token.start),label:parameter.name+':',kind:2,paddingRight:true,tooltip:{kind:'plaintext',value:parameter.signature||parameter.name+' As '+parameter.type}});
      }
    }
    return hints;
  }
  codeLenses(p) {
    const document=this.document(p.textDocument.uri);if(document.languageId!=='vb6')return [];
    return this.intelligence.index(this.module(document),this.project).procedures.map(symbol=>({range:symbolRange(document,symbol),data:{uri:document.uri,version:document.version,revision:this.revision,position:symbolRange(document,symbol).start}}));
  }
  async resolveCodeLens(lens,context) {
    const data=lens.data,document=this.documents.get(data?.uri);
    if(!document||document.version!==data.version||this.revision!==data.revision)throw new RpcError(RPC_CONTENT_MODIFIED,'Code lens is stale.');
    const id=data.uri+':'+data.position.line+':'+data.position.character;
    let references=this.referenceCache.get(id);
    if(!references){references=await this.references({textDocument:{uri:data.uri},position:data.position,context:{includeDeclaration:false}},context);if(this.revision!==data.revision)throw new RpcError(RPC_CONTENT_MODIFIED,'Code lens is stale.');if(this.referenceCache.size<512)this.referenceCache.set(id,references);}
    return {...lens,command:{title:references.length+' reference'+(references.length===1?'':'s'),command:'vb6.showReferences',arguments:[data.uri,data.position,references]}};
  }
  symbols(uri) {
    const document=this.document(uri);
    if(document.languageId==='xaml')return this.xaml.symbols(uri).map(function convert(s){return {...s,kind:s.kind==='property'?7:19,children:s.children?.map(convert)};});
    const module=this.module(document),index=this.intelligence.index(module,this.project);
    const convert=s=>({name:s.name,detail:plainDescription(s),kind:kind(s),range:document.range(s.offset??0,s.endOffset??document.lineEnds[Math.min(document.lineEnds.length-1,(s.line||1)-1)]),selectionRange:symbolRange(document,s)});
    return index.symbols.filter(s=>!s.owner&&s.kind!=='control'&&!s.parentType).map(s=>({...convert(s),children:[...index.symbols.filter(c=>c.ownerId===s.id&&s.id),...(s.members||[])].map(convert)}));
  }
  workspaceSymbols(query='') {
    const needle=query.toLowerCase(),result=[];
    for(const [uri,doc]of this.documents) {
      if(doc.languageId!=='vb6'&&doc.languageId!=='xaml')continue;
      const visit=(symbols,parent)=>{for(const symbol of symbols){if(symbol.name.toLowerCase().includes(needle))result.push({name:symbol.name,kind:symbol.kind,containerName:parent||'',location:{uri,range:symbol.selectionRange}});if(result.length>=2000)return;if(symbol.children)visit(symbol.children,symbol.name);}};
      visit(this.symbols(uri),'');if(result.length>=2000)break;
    }
    return result.slice(0,2000);
  }
  prepareRename(p) {
    const {document,module,symbol}=this.target(p);
    if(document.languageId==='xaml') {
      const native=this.nativeName(document,p.position);if(native)return {range:document.range(native.attribute.valueStart,native.attribute.valueEnd),placeholder:native.attribute.value};
      const refs=this.xaml.references(document.uri,p.position);return refs.length?{range:refs.find(r=>r.start<=document.offsetAt(p.position)&&document.offsetAt(p.position)<=r.end)?.range||refs[0].range,placeholder:refs[0].name}:null;
    }
    if(!identity(symbol)||['control','module','class','label'].includes(symbol.kind)||symbol.implicitRedim)return null;
    if(!symbol.owner&&module?.form&&new RegExp('^(?:Form|MDIForm|UserControl|'+(module.form.controls||[]).map(c=>c.name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('|')+')_','i').test(symbol.name))return null;
    const token=tokenAt(document,p.position);if(!token)return null;
    const base=document.lineStarts[p.position.line];return {range:document.range(base+token.start,base+token.end),placeholder:token.value};
  }
  nativeName(document,position) {
    const offset=document.offsetAt(position),syntax=this.xaml.analyze(document.uri).syntax;
    for(const element of syntax.elements)if(element.namespaceURI==='urn:vb6:forms') {
      const attribute=element.attributes.find(a=>a.name==='Name'&&a.valueStart<=offset&&offset<=a.valueEnd);
      if(attribute)return {element,attribute,syntax};
    }
    return null;
  }
  async rename(p,context) {
    const prepared=this.prepareRename(p);if(!prepared)throw new RpcError(-32602,'This symbol must be renamed through the designer or is not a safely bound source symbol.');
    const document=this.document(p.textDocument.uri);
    if(document.languageId==='xaml') {
      const native=this.nativeName(document,p.position);let edits;
      if(native){
        if(!/^[A-Za-z_]\w*$/.test(p.newName))throw new RpcError(-32602,'Invalid VB6 control name.');
        const attributes=native.syntax.elements.filter(e=>e.namespaceURI==='urn:vb6:forms').flatMap(e=>e.attributes.filter(a=>a.name==='Name'));
        if(key(native.attribute.value)!==key(p.newName)&&attributes.some(a=>key(a.value)===key(p.newName)))throw new RpcError(-32602,'The control name already exists.');
        edits=attributes.filter(a=>key(a.value)===key(native.attribute.value)).map(a=>({range:document.range(a.valueStart,a.valueEnd),newText:p.newName}));
      }else edits=this.xaml.rename(document.uri,p.position,p.newName).edits.map(e=>({range:e.range,newText:e.text}));
      return {documentChanges:[{textDocument:{uri:document.uri,version:document.version},edits}]};
    }
    if(!/^[\p{L}_][\p{L}\p{N}_]*$/u.test(p.newName)||keywords.has(p.newName.toLowerCase()))throw new RpcError(-32602,'Enter a non-keyword VB6 identifier.');
    const {symbol}=this.target(p),id=identity(symbol),refs=await this.references({...p,context:{includeDeclaration:true}},context),changes=new Map();
    for(const reference of refs) {
      const doc=this.document(reference.uri),module=this.module(doc),line=reference.range.start.line+1,offset=doc.offsetAt(reference.range.start);
      const collision=this.intelligence.resolve(this.project,module,line,p.newName,{offset});
      if(collision&&identity(collision)!==id)throw new RpcError(-32602,'The new name would shadow an existing symbol: '+p.newName);
      let edits=changes.get(reference.uri);if(!edits)changes.set(reference.uri,edits=[]);
      const previous=doc.text.slice(offset,doc.offsetAt(reference.range.end)),suffix=previous.match(/[$%&!#@]$/)?.[0]||'';
      edits.push({range:reference.range,newText:p.newName+suffix});
    }
    return {documentChanges:[...changes].map(([uri,edits])=>({textDocument:{uri,version:this.document(uri).version},edits}))};
  }
  format(p) {
    const document=this.document(p.textDocument.uri),options={...p.options,tabSize:Math.max(1,Math.min(16,p.options?.tabSize||4))};
    if(document.languageId==='xaml') {
      const edits=this.xaml.format(document.uri,options).map(e=>({range:e.range,newText:e.text}));
      // The conservative XAML formatter preserves mixed content; it cannot safely
      // reindent arbitrary fragments without their xml:space/namespace context.
      return p.range&&!(document.offsetAt(p.range.start)===0&&document.offsetAt(p.range.end)===document.text.length)?[]:edits;
    }
    const formatted=formatCode(document.text.replace(/\r\n?|\n/g,'\n'),options.tabSize).split('\n'),edits=[];
    for(let line=0;line<document.lineStarts.length;line++) {
      const start=document.lineStarts[line],end=document.lineEnds[line],range=document.range(start,end);
      if(p.range&&(start<document.offsetAt(p.range.start)||end>document.offsetAt(p.range.end)))continue;
      let newText=formatted[line]??'';if(options.insertSpaces===false)newText=newText.replace(/^ +/,spaces=>'\t'.repeat(Math.floor(spaces.length/options.tabSize))+' '.repeat(spaces.length%options.tabSize));
      if(newText!==document.text.slice(start,end))edits.push({range,newText});
    }
    return edits;
  }
  folding(p) {
    const document=this.document(p.textDocument.uri);if(document.languageId==='xaml')return this.xaml.foldingRanges(document.uri);
    const stack=[],ranges=[];
    for(let line=0;line<document.lineStarts.length;line++) {
      const tokens=safeTokenize(document.text.slice(document.lineStarts[line],document.lineEnds[line])),text=tokens.filter(t=>t.type!=='eof').map(t=>t.type==='string'?'""':t.raw).join(' ');
      const close=/^(?:End (Sub|Function|Property|If|Select|With|Type|Enum)|Next\b|Loop\b|Wend\b)/i.test(text);
      if(close&&stack.length){const startLine=stack.pop();if(line>startLine)ranges.push({startLine,endLine:line,kind:'region'});}
      if(/^(?:(?:Public|Private|Friend|Static)\s+)*(?:Sub|Function|Property (?:Get|Let|Set)|Type|Enum)\b/i.test(text)||/^(?:For\b|Do\b|While\b|With\b|Select Case\b)/i.test(text)||/^If\b.*\bThen\s*$/i.test(text))stack.push(line);
    }
    return ranges;
  }
  selectionRanges(p) {
    const document=this.document(p.textDocument.uri),folds=this.folding(p),whole=document.range(0,document.text.length);
    return p.positions.map(position=>{
      const offset=document.offsetAt(position),line=position.line,base=document.lineStarts[line]||0,token=tokenAt(document,position);
      const candidates=[whole,...folds.filter(f=>f.startLine<=line&&f.endLine>=line).sort((a,b)=>(b.endLine-b.startLine)-(a.endLine-a.startLine)).map(f=>document.range(document.lineStarts[f.startLine],document.lineEnds[f.endLine])),document.range(base,document.lineEnds[line]??base)];
      if(token)candidates.push(document.range(base+token.start,base+token.end));else candidates.push(document.range(offset,offset));
      let parent;for(const range of candidates)if(!parent||JSON.stringify(parent.range)!==JSON.stringify(range))parent={range,...(parent?{parent}:{})};return parent;
    });
  }
  linkedEditing(p) {
    const document=this.document(p.textDocument.uri);if(document.languageId!=='xaml')return null;
    const offset=document.offsetAt(p.position),syntax=this.xaml.analyze(document.uri).syntax;
    for(const e of syntax.elements){
      if(e.selfClosing||e.closeStart===undefined)continue;
      const close=document.text.indexOf(e.name,e.closeStart),inside=e.nameStart<=offset&&offset<=e.nameEnd||close<=offset&&offset<=close+e.name.length;
      if(close>=0&&inside)return {ranges:[document.range(e.nameStart,e.nameEnd),document.range(close,close+e.name.length)]};
    }
    return null;
  }
  async semantic(p,{signal}={}) {
    const document=this.document(p.textDocument.uri),cached=this.tokenCache.get(document.uri),cacheKey=document.version+':'+this.revision;
    let tokens;
    if(cached?.key===cacheKey)tokens=cached.tokens;
    else {
      tokens=[];
      if(document.languageId==='xaml')tokens=this.xaml.semanticTokens(document.uri).map(t=>({line:t.line,character:t.character,length:t.length,type:t.type,modifiers:0}));
      else {
        const module=this.module(document),project=this.project;
        for(let line=0;line<document.lineStarts.length;line++) {
          if(line%128===0){checkCancelled(signal);await yieldTask();}
          const base=document.lineStarts[line],raw=document.text.slice(base,document.lineEnds[line]);
          for(const token of safeTokenize(raw)) {
            if(token.type==='eof')continue;let type,modifiers=0;
            if(token.type==='string'||token.type==='date')type='string';else if(token.type==='number')type='number';else if(token.type==='op')type='operator';
            else if(keywords.has(token.value.toLowerCase())&&!token.raw.startsWith('['))type='keyword';
            else {const symbol=this.intelligence.definition(project,module,line+1,document.text,base+token.start+Math.min(1,token.end-token.start));if(symbol){type=tokenKind(symbol);if(symbol.kind==='constant')modifiers|=2;if(!symbol.moduleId)modifiers|=4;if(symbol.moduleId===module.id&&symbol.line===line+1&&symbolRange(document,symbol).start.character===token.start)modifiers|=1;}}
            if(type)tokens.push({line,character:token.start,length:token.end-token.start,type,modifiers});
          }
        }
      }
      if(tokens.length<200000)this.tokenCache.set(document.uri,{key:cacheKey,tokens});
    }
    const filtered=p.range?tokens.filter(t=>t.line>=p.range.start.line&&t.line<=p.range.end.line):tokens;
    const data=[];let line=0,character=0;
    for(const token of filtered){const type=BUILTIN_TOKEN_LEGEND.tokenTypes.indexOf(token.type);if(type<0||!token.length)continue;data.push(token.line-line,token.line===line?token.character-character:token.character,token.length,type,token.modifiers);line=token.line;character=token.character;}
    // Returning a fresh full result to a delta request is explicitly allowed by LSP.
    return {resultId:cacheKey,data};
  }
  codeActions(p) {
    const document=this.document(p.textDocument.uri),only=p.context?.only;
    if(only&&!only.some(k=>'source.fixAll'.startsWith(k)))return [];
    const edits=[];
    for(let line=0;line<document.lineStarts.length;line++){
      const start=document.lineStarts[line],end=document.lineEnds[line],raw=document.text.slice(start,end),spaces=raw.match(/[ \t]+$/)?.[0];
      if(spaces)edits.push({range:document.range(end-spaces.length,end),newText:''});
    }
    // XAML mixed content can contain meaningful trailing whitespace.
    return document.languageId==='vb6'&&edits.length?[{title:'Remove trailing whitespace',kind:'source.fixAll',edit:{documentChanges:[{textDocument:{uri:document.uri,version:document.version},edits}]}}]:[];
  }
  scheduleDiagnostics() {clearTimeout(this.diagnosticTimer);if(!this.stopped)this.diagnosticTimer=setTimeout(()=>this.computeDiagnostics().catch(error=>this.log(error.message)),this.diagnosticDelay);}
  async computeDiagnostics() {
    const revision=this.revision,project=this.project,documents=new Map(this.documents),results=new Map([...documents].map(([uri])=>[uri,[]]));
    try {
      const steps=this.diagnosticCache.steps(diagnosticSnapshot(project));let step;
      do {step=steps.next();if(!step.done){await yieldTask();if(revision!==this.revision||this.stopped)return;}}while(!step.done);
      for(const d of step.value.diagnostics){const module=project.modules.find(m=>key(m.name)===key(d.source)),uri=module&&this.moduleUris.get(module.id),document=documents.get(uri);if(document)results.get(uri).push(lspDiagnostic(d,document));}
      for(const [uri,document]of documents)if(document.languageId==='xaml')results.set(uri,this.xaml.diagnostics(uri).map(d=>({...lspDiagnostic(d,document),source:'XAML'})));
    }catch(error){this.log('Automatic diagnostics: '+error.message);return;}
    if(revision!==this.revision||this.stopped||this.peer.closed)return;
    this.diagnostics=results;for(const [uri,diagnostics]of results)this.peer.notify('textDocument/publishDiagnostics',{uri,version:documents.get(uri).version,diagnostics});
  }
  dispose() {this.stopped=true;clearTimeout(this.diagnosticTimer);this.peer.close();this.documents.clear();this.xaml.documents.clear();this.tokenCache.clear();this.occurrenceCache.clear();this.referenceCache.clear();this.diagnosticCache.clear();}
}
