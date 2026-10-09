import {fromPosition,toPosition,fromRange,toRange,fromTextEdit,safeMarkdown,safeDocumentLink,semanticTokenResult,fromDiagnostic,fromCompletion,fromSymbol} from './protocol-converters.js';

const noop=()=>{};
function emitter() {const listeners=new Set();return {event:fn=>{listeners.add(fn);return {dispose:()=>listeners.delete(fn)};},fire:()=>{for(const fn of listeners)fn();},dispose:()=>listeners.clear()};}

/** Monaco providers are installed per language/session, never globally redirected
 * to whichever editor happens to have focus. Every request captures its model. */
export function installLanguageProviders(monaco,language,client,host) {
  const disposables=[],resolved=new WeakMap(),refresh=emitter();
  const selector={language,scheme:'vb6-editor'},owner='vb6-lsp-'+language;
  const doc=model=>client.documents.get(model.uri.toString());
  const available=(method,model)=>!model.isDisposed()&&!!doc(model)&&!!client.capability(method,doc(model));
  async function request(method,model,params,token) {
    if(!available(method,model))return null;
    const version=model.getVersionId(),abort=new AbortController();
    const subscription=token?.onCancellationRequested(()=>abort.abort());if(token?.isCancellationRequested)abort.abort();
    try {
      const result=await client.request(method,{textDocument:{uri:model.uri.toString()},...params},{signal:abort.signal});
      return !model.isDisposed()&&version===model.getVersionId()?result:null;
    }catch(error){if(![-32800,-32801,-32802].includes(error.code))host.report(error);return null;}
    finally{subscription?.dispose();}
  }
  async function resolve(method,value,token) {
    const source=resolved.get(value);if(!source||source.model.isDisposed()||source.version!==source.model.getVersionId())return null;
    const abort=new AbortController(),subscription=token?.onCancellationRequested(()=>abort.abort());if(token?.isCancellationRequested)abort.abort();
    try{const result=await client.request(method,source.raw,{signal:abort.signal});return !source.model.isDisposed()&&source.version===source.model.getVersionId()?{...source,raw:result}:null;}
    catch(error){if(![-32800,-32801,-32802].includes(error.code))host.report(error);return null;}finally{subscription?.dispose();}
  }
  const remember=(result,raw,model)=>{resolved.set(result,{raw,model,version:model.getVersionId()});return result;};
  const command=c=>host.command(client,c);
  const list=value=>value===null||value===undefined?[]:Array.isArray(value)?value:[value];
  const location=r=>r.targetUri?{uri:monaco.Uri.parse(r.targetUri),range:fromRange(r.targetRange),targetSelectionRange:fromRange(r.targetSelectionRange),originSelectionRange:r.originSelectionRange?fromRange(r.originSelectionRange):undefined}:{uri:monaco.Uri.parse(r.uri),range:fromRange(r.range)};
  const register=(api,method,provider)=>{if(client.capability(method)&&monaco.languages[api])disposables.push(monaco.languages[api](selector,provider));};
  const base=model=>({textDocument:{uri:model.uri.toString()}});
  function completion(item,model,range) {return remember(fromCompletion(monaco,item,range,command),item,model);}
  register('registerCompletionItemProvider','textDocument/completion',{
    triggerCharacters:client.capability('textDocument/completion').triggerCharacters||[],
    provideCompletionItems:async(model,position,context,token)=>{
      const result=await request('textDocument/completion',model,{position:toPosition(position),context:{triggerKind:context.triggerKind+1,triggerCharacter:context.triggerCharacter}},token);
      if(!result)return {suggestions:[]};const word=model.getWordUntilPosition(position),range={startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn};
      return {suggestions:(result.items||result).map(i=>completion(i,model,range)),incomplete:!!result.isIncomplete};
    },
    resolveCompletionItem:async(item,token)=>{if(!client.capability('textDocument/completion').resolveProvider)return item;const s=await resolve('completionItem/resolve',item,token);return s?completion(s.raw,s.model,item.range):item;},
  });
  register('registerHoverProvider','textDocument/hover',{provideHover:async(model,position,token)=>{
    const result=await request('textDocument/hover',model,{position:toPosition(position)},token);
    return result?{range:result.range?fromRange(result.range):undefined,contents:list(result.contents).map(safeMarkdown).filter(Boolean)}:null;
  }});
  register('registerSignatureHelpProvider','textDocument/signatureHelp',{
    signatureHelpTriggerCharacters:client.capability('textDocument/signatureHelp').triggerCharacters||[],signatureHelpRetriggerCharacters:client.capability('textDocument/signatureHelp').retriggerCharacters||[],
    provideSignatureHelp:async(model,position,token,context)=>{
      const result=await request('textDocument/signatureHelp',model,{position:toPosition(position),context:{triggerKind:context.triggerKind,triggerCharacter:context.triggerCharacter,isRetrigger:context.isRetrigger}},token);
      return result?{value:{...result,activeSignature:result.activeSignature||0,activeParameter:result.activeParameter||0,signatures:result.signatures.map(s=>({...s,documentation:safeMarkdown(s.documentation),parameters:(s.parameters||[]).map(p=>({...p,documentation:safeMarkdown(p.documentation)}))}))},dispose:noop}:null;
    },
  });
  for(const [name,method]of [['Definition','definition'],['Declaration','declaration'],['TypeDefinition','typeDefinition'],['Implementation','implementation']]){
    register('register'+name+'Provider','textDocument/'+method,{['provide'+name]:async(model,position,token)=>list(await request('textDocument/'+method,model,{position:toPosition(position)},token)).map(location)});
  }
  register('registerReferenceProvider','textDocument/references',{provideReferences:async(model,position,context,token)=>list(await request('textDocument/references',model,{position:toPosition(position),context},token)).map(location)});
  register('registerDocumentHighlightProvider','textDocument/documentHighlight',{provideDocumentHighlights:async(model,position,token)=>list(await request('textDocument/documentHighlight',model,{position:toPosition(position)},token)).map(r=>({range:fromRange(r.range),kind:r.kind||1}))});
  register('registerDocumentSymbolProvider','textDocument/documentSymbol',{displayName:'VB6 Studio LSP',provideDocumentSymbols:async(model,token)=>list(await request('textDocument/documentSymbol',model,{},token)).map(s=>fromSymbol(monaco,s))});
  register('registerDocumentFormattingEditProvider','textDocument/formatting',{provideDocumentFormattingEdits:async(model,options,token)=>list(await request('textDocument/formatting',model,{options},token)).map(fromTextEdit)});
  register('registerDocumentRangeFormattingEditProvider','textDocument/rangeFormatting',{provideDocumentRangeFormattingEdits:async(model,range,options,token)=>list(await request('textDocument/rangeFormatting',model,{range:toRange(range),options},token)).map(fromTextEdit)});
  const onType=client.capability('textDocument/onTypeFormatting');
  register('registerOnTypeFormattingEditProvider','textDocument/onTypeFormatting',{autoFormatTriggerCharacters:[onType.firstTriggerCharacter,...onType.moreTriggerCharacter||[]].filter(Boolean),provideOnTypeFormattingEdits:async(model,position,ch,options,token)=>list(await request('textDocument/onTypeFormatting',model,{position:toPosition(position),ch,options},token)).map(fromTextEdit)});
  register('registerFoldingRangeProvider','textDocument/foldingRange',{provideFoldingRanges:async(model,context,token)=>list(await request('textDocument/foldingRange',model,{},token)).filter(r=>r.endLine>r.startLine).map(r=>({start:r.startLine+1,end:r.endLine+1,kind:monaco.languages.FoldingRangeKind[r.kind==='comment'?'Comment':r.kind==='imports'?'Imports':'Region']}))});
  function selection(value){return {range:fromRange(value.range),...(value.parent?{parent:selection(value.parent)}:{})};}
  register('registerSelectionRangeProvider','textDocument/selectionRange',{provideSelectionRanges:async(model,positions,token)=>list(await request('textDocument/selectionRange',model,{positions:positions.map(toPosition)},token)).map(value=>{const chain=[];for(let node=selection(value);node;node=node.parent)chain.push({range:node.range});return chain;})});
  register('registerLinkedEditingRangeProvider','textDocument/linkedEditingRange',{provideLinkedEditingRanges:async(model,position,token)=>{const result=await request('textDocument/linkedEditingRange',model,{position:toPosition(position)},token);return result?{ranges:result.ranges.map(fromRange)}:null;}});
  register('registerRenameProvider','textDocument/rename',{
    resolveRenameLocation:async(model,position,token)=>{
      if(!client.capability('textDocument/rename').prepareProvider){const word=model.getWordAtPosition(position);return word?{range:{startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn},text:word.word}:null;}
      const value=await request('textDocument/prepareRename',model,{position:toPosition(position)},token);
      if(!value)return {rejectReason:'This symbol cannot be safely renamed in source.'};
      if(value.defaultBehavior){const word=model.getWordAtPosition(position);return word?{range:{startLineNumber:position.lineNumber,endLineNumber:position.lineNumber,startColumn:word.startColumn,endColumn:word.endColumn},text:word.word}:null;}
      const range=fromRange(value.range||value);return {range,text:value.placeholder||model.getValueInRange(range)};
    },
    provideRenameEdits:async(model,position,newName,token)=>{
      const edit=await request('textDocument/rename',model,{position:toPosition(position),newName},token);if(!edit)return {edits:[],rejectReason:'Rename failed or the document changed.'};
      // The IDE owns a single atomic undo transaction (including XAML designer
      // changes). Never let Monaco independently apply a multi-file rename.
      const result=await host.applyEdit(client,edit,'Rename '+newName,false);
      return result.applied?{edits:[]}:{edits:[],rejectReason:result.failureReason||'Rename was not applied.'};
    },
  });
  const semantics=client.capability('textDocument/semanticTokens');
  if(semantics?.legend){
    if(semantics.full)register('registerDocumentSemanticTokensProvider','textDocument/semanticTokens',{
      getLegend:()=>semantics.legend,onDidChange:refresh.event,
      provideDocumentSemanticTokens:async(model,lastResultId,token)=>semanticTokenResult(await request(lastResultId&&semantics.full.delta?'textDocument/semanticTokens/full/delta':'textDocument/semanticTokens/full',model,lastResultId&&semantics.full.delta?{previousResultId:lastResultId}:{},token)),releaseDocumentSemanticTokens:noop,
    });
    if(semantics.range)register('registerDocumentRangeSemanticTokensProvider','textDocument/semanticTokens',{
      getLegend:()=>semantics.legend,provideDocumentRangeSemanticTokens:async(model,range,token)=>semanticTokenResult(await request('textDocument/semanticTokens/range',model,{range:toRange(range)},token)),
    });
  }
  function lens(value,model){return remember({range:fromRange(value.range),command:value.command?command(value.command):undefined},value,model);}
  register('registerCodeLensProvider','textDocument/codeLens',{onDidChange:refresh.event,
    provideCodeLenses:async(model,token)=>({lenses:list(await request('textDocument/codeLens',model,{},token)).map(v=>lens(v,model)),dispose:noop}),
    resolveCodeLens:async(model,value,token)=>{if(!client.capability('textDocument/codeLens').resolveProvider)return value;const s=await resolve('codeLens/resolve',value,token);return s?lens(s.raw,model):value;},
  });
  function hint(value,model){return remember({position:fromPosition(value.position),label:typeof value.label==='string'?value.label:value.label.map(l=>({label:l.value,tooltip:safeMarkdown(l.tooltip),command:l.command?command(l.command):undefined,location:l.location?location(l.location):undefined})),kind:value.kind===1?monaco.languages.InlayHintKind.Type:monaco.languages.InlayHintKind.Parameter,tooltip:safeMarkdown(value.tooltip),paddingLeft:value.paddingLeft,paddingRight:value.paddingRight,textEdits:value.textEdits?.map(fromTextEdit)},value,model);}
  register('registerInlayHintsProvider','textDocument/inlayHint',{onDidChangeInlayHints:refresh.event,
    provideInlayHints:async(model,range,token)=>({hints:list(await request('textDocument/inlayHint',model,{range:toRange(range)},token)).map(v=>hint(v,model)),dispose:noop}),
    resolveInlayHint:async(value,token)=>{if(!client.capability('textDocument/inlayHint').resolveProvider)return value;const s=await resolve('inlayHint/resolve',value,token);return s?hint(s.raw,s.model):value;},
  });
  function action(value,model){
    const raw=typeof value.command==='string'?{title:value.title,command:value}:value;
    return remember({title:raw.title,kind:raw.kind,isPreferred:raw.isPreferred,disabled:raw.disabled?.reason,
      command:host.command(client,{title:raw.title,command:'vb6.applyCodeAction',arguments:[raw,model.uri.toString(),model.getVersionId()]}),
    },raw,model);
  }
  register('registerCodeActionProvider','textDocument/codeAction',{
    providedCodeActionKinds:client.capability('textDocument/codeAction').codeActionKinds,
    provideCodeActions:async(model,range,context,token)=>({actions:list(await request('textDocument/codeAction',model,{range:toRange(range),context:{only:context.only?[context.only]:undefined,triggerKind:context.trigger===1?1:2,diagnostics:host.diagnostics(client,model.uri.toString())}},token)).map(v=>action(v,model)),dispose:noop}),
    resolveCodeAction:async(value,token)=>{if(!client.capability('textDocument/codeAction').resolveProvider)return value;const s=await resolve('codeAction/resolve',value,token);return s?action(s.raw,s.model):value;},
  });
  function link(value,model){return remember({range:fromRange(value.range),url:safeDocumentLink(value.target,host.hasUri),tooltip:value.tooltip},value,model);}
  register('registerLinkProvider','textDocument/documentLink',{
    provideLinks:async(model,token)=>({links:list(await request('textDocument/documentLink',model,{},token)).map(v=>link(v,model)),dispose:noop}),
    resolveLink:async(value,token)=>{if(!client.capability('textDocument/documentLink').resolveProvider)return value;const s=await resolve('documentLink/resolve',value,token);return s?link(s.raw,s.model):value;},
  });
  register('registerColorProvider','textDocument/documentColor',{
    provideDocumentColors:async(model,token)=>list(await request('textDocument/documentColor',model,{},token)).map(c=>({range:fromRange(c.range),color:c.color})),
    provideColorPresentations:async(model,info,token)=>list(await request('textDocument/colorPresentation',model,{range:toRange(info.range),color:info.color},token)).map(c=>({label:c.label,textEdit:c.textEdit?fromTextEdit(c.textEdit):undefined,additionalTextEdits:c.additionalTextEdits?.map(fromTextEdit)})),
  });
  register('registerInlineValuesProvider','textDocument/inlineValue',{provideInlineValues:async(model,range,context,token)=>list(await request('textDocument/inlineValue',model,{range:toRange(range),context:{frameId:context.frameId,stoppedLocation:toRange(context.stoppedLocation)}},token)).map(v=>({...v,range:fromRange(v.range)}))});
  disposables.push({dispose:client.on('refresh',()=>refresh.fire())});
  disposables.push({dispose:client.on('diagnostics',p=>{
    const model=monaco.editor.getModel(monaco.Uri.parse(p.uri));if(model&&!model.isDisposed()&&model.getLanguageId()===language){try{monaco.editor.setModelMarkers(model,owner,(p.diagnostics||[]).map(d=>fromDiagnostic(monaco,d)));}catch(error){host.report(error);}}
  })});
  return {dispose(){for(const item of disposables)item.dispose();refresh.dispose();for(const model of monaco.editor.getModels())if(model.getLanguageId()===language)monaco.editor.setModelMarkers(model,owner,[]);}};
}
