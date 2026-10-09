import {RpcError} from './rpc.js';

const number=value=>{if(!Number.isSafeInteger(value)||value<0)throw new RpcError(-32602,'Invalid language-server position.');return value;};
export function fromPosition(value) {return {lineNumber:number(value.line)+1,column:number(value.character)+1};}
export function toPosition(value) {return {line:number(value.lineNumber-1),character:number(value.column-1)};}
export function fromRange(value) {
  const start=fromPosition(value.start),end=fromPosition(value.end);
  if(end.lineNumber<start.lineNumber||end.lineNumber===start.lineNumber&&end.column<start.column)throw new RpcError(-32602,'Reversed language-server range.');
  return {startLineNumber:start.lineNumber,startColumn:start.column,endLineNumber:end.lineNumber,endColumn:end.column};
}
export function toRange(value) {return {start:toPosition({lineNumber:value.startLineNumber,column:value.startColumn}),end:toPosition({lineNumber:value.endLineNumber,column:value.endColumn})};}
export function fromTextEdit(edit) {
  if(typeof edit.newText!=='string')throw new RpcError(-32602,'Invalid language-server text edit.');
  return {range:fromRange(edit.range),text:edit.newText};
}
const escapeMarkdown=value=>String(value).replace(/[\\`*_{}[\]()#+.!<>|~-]/g,'\\$&');

/** LSP text is untrusted, even from a locally running server. Never enable
 * command URIs/HTML, and never fetch Markdown images as a hover side effect. */
export function safeMarkdown(contents) {
  if(contents===null||contents===undefined)return undefined;
  let value;
  if(typeof contents==='string')value=contents;
  else if(contents.language){const fence='`'.repeat(Math.max(3,...(contents.value.match(/`+/g)||[]).map(s=>s.length+1)));value=fence+String(contents.language).replace(/[^\w+-]/g,'')+'\n'+String(contents.value)+'\n'+fence;}
  else value=contents.kind==='plaintext'?escapeMarkdown(contents.value??''):String(contents.value??'');
  return {value:value.replace(/!\[/g,'&#33;[').replace(/\u0000/g,''),isTrusted:false,supportHtml:false};
}
export function safeDocumentLink(target,knownUri=()=>false) {
  if(typeof target!=='string')return undefined;
  try{const uri=new URL(target);return ['http:','https:'].includes(uri.protocol)||knownUri(target)?target:undefined;}catch{return undefined;}
}
export function semanticTokenResult(value) {
  if(!value)return null;
  const array=(data,full=false)=>{
    if(!Array.isArray(data)||data.some(n=>!Number.isSafeInteger(n)||n<0||n>0xffffffff)||full&&data.length%5!==0)throw new RpcError(-32602,'Invalid semantic token data.');
    return new Uint32Array(data);
  };
  if(value.edits)return {resultId:value.resultId,edits:value.edits.map(edit=>({start:number(edit.start),deleteCount:number(edit.deleteCount),...(edit.data?{data:array(edit.data)}:{})}))};
  return {resultId:value.resultId,data:array(value.data,true)};
}

export function fromDiagnostic(monaco,diagnostic) {
  const severity=({1:monaco.MarkerSeverity.Error,2:monaco.MarkerSeverity.Warning,3:monaco.MarkerSeverity.Info,4:monaco.MarkerSeverity.Hint})[diagnostic.severity]||monaco.MarkerSeverity.Error;
  const link=safeDocumentLink(diagnostic.codeDescription?.href);
  return {...fromRange(diagnostic.range),severity,message:String(diagnostic.message||''),source:diagnostic.source,
    code:diagnostic.code===undefined?undefined:link?{value:String(diagnostic.code),target:monaco.Uri.parse(link)}:String(diagnostic.code),
    tags:diagnostic.tags?.filter(t=>t===1||t===2),
    relatedInformation:diagnostic.relatedInformation?.map(r=>({...fromRange(r.location.range),resource:monaco.Uri.parse(r.location.uri),message:r.message})),
  };
}
export function fromCompletion(monaco,item,defaultRange,command) {
  const kinds=['','Text','Method','Function','Constructor','Field','Variable','Class','Interface','Module','Property','Unit','Value','Enum','Keyword','Snippet','Color','File','Reference','Folder','EnumMember','Constant','Struct','Event','Operator','TypeParameter'];
  const edit=item.textEdit;
  const range=edit?.insert?{insert:fromRange(edit.insert),replace:fromRange(edit.replace)}:edit?.range?fromRange(edit.range):defaultRange;
  return {label:item.labelDetails?{label:item.label,detail:item.labelDetails.detail,description:item.labelDetails.description}:item.label,
    kind:monaco.languages.CompletionItemKind[kinds[item.kind]||'Text'],range,detail:item.detail,documentation:safeMarkdown(item.documentation),
    insertText:edit?.newText??item.insertText??item.label,
    insertTextRules:(item.insertTextFormat===2?monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet:0)|(item.insertTextMode===1?monaco.languages.CompletionItemInsertTextRule.KeepWhitespace:0),
    filterText:item.filterText,sortText:item.sortText,preselect:item.preselect,commitCharacters:item.commitCharacters,
    tags:item.tags?.includes(1)||item.deprecated?[monaco.languages.CompletionItemTag.Deprecated]:undefined,
    additionalTextEdits:item.additionalTextEdits?.map(fromTextEdit),command:item.command?command(item.command):undefined};
}
export function fromSymbol(monaco,symbol) {
  const names=['','File','Module','Namespace','Package','Class','Method','Property','Field','Constructor','Enum','Interface','Function','Variable','Constant','String','Number','Boolean','Array','Object','Key','Null','EnumMember','Struct','Event','Operator','TypeParameter'];
  return {name:symbol.name,detail:symbol.detail||'',kind:monaco.languages.SymbolKind[names[symbol.kind]||'Variable'],tags:symbol.tags||[],
    range:fromRange(symbol.range||symbol.location.range),selectionRange:fromRange(symbol.selectionRange||symbol.location?.range||symbol.range),children:symbol.children?.map(s=>fromSymbol(monaco,s))};
}
