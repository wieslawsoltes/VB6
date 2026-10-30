import {splitPrintList} from '../language/print-list.js';
import {parseExpression} from '../language/expression.js';
import {compileModule} from '../language/compiler.js';
import {parseDeclarations} from '../language/declarations.js';
import {tokenize} from '../language/lexer.js';
import {stripComment} from '../language/source-scanner.js';
import {symbolKey} from '../language/source-context.js';
import {literalScalar,signedLiteralScalar,unary,binary,scalarType,unbox} from '../runtime/values.js';
import {moduleLanguage} from '../project/language.js';

export const SOURCE_ACTION_KINDS=Object.freeze(['source.fixAll','source.addOptionExplicit','refactor.extract.constant','refactor.inline.constant']);
const types={integer:'Integer',long:'Long',single:'Single',double:'Double',currency:'Currency',date:'Date',string:'String',boolean:'Boolean',byte:'Byte'};
export const includesActionKind=(kind,only)=>only===undefined||Array.isArray(only)&&only.some(value=>typeof value==='string'&&(value===''||value===kind||kind.startsWith(value+'.')));

/** Only scalar literal expressions are evaluated, using the compiler's checked
 * VB operations. No names, calls, allocations, getters or project code run. */
function constantValue(node,compare='binary') {
  let count=0;
  const visit=(node,depth=0)=>{
    if(++count>128||depth>32)throw new Error('Constant expression is too complex.');
    let value;
    if(['literal','date','currency'].includes(node.kind)){
      if(node.kind==='literal'&&node.value===null)throw new Error('Null is not a constant.');
      value=literalScalar(node);
    }else if(node.kind==='group')value=visit(node.expr,depth+1);
    else if(node.kind==='unary')value=signedLiteralScalar(node)||unary(node.op,visit(node.expr,depth+1));
    else if(node.kind==='binary'&&!['is','like'].includes(node.op))value=binary(node.op,visit(node.left,depth+1),visit(node.right,depth+1),compare);
    else throw new Error('A scalar literal expression is required.');
    if(!types[scalarType(value)]||typeof unbox(value)==='string'&&unbox(value).length>65536)throw new Error('Unsupported constant type or size.');
    return value;
  };
  return visit(node);
}
function normalized(value,replaceName=null,replacement=null,onReplace=()=>{}) {
  if(!value||typeof value!=='object')return value;
  if(Array.isArray(value))return value.map(item=>normalized(item,replaceName,replacement,onReplace));
  if(value.kind==='group')return normalized(value.expr,replaceName,replacement,onReplace);
  if(value.kind==='id'&&symbolKey(value.name)===replaceName){onReplace(value);return normalized(replacement);}
  const out={};
  for(const name of Object.keys(value).sort()){
    // Sequence-point metadata is not expression semantics. All operand types,
    // operators, targets and argument/ByRef nodes remain in the comparison.
    if(value.op&&!value.kind&&['line','source','procedure','sequencePoint','column','endColumn'].includes(name))continue;
    if(name==='outputList'&&['print','filePrint'].includes(value.op)){out[name]=splitPrintList(value[name]).parts.map(p=>({separator:p.separator,empty:!p.text}));continue;}
    out[name]=normalized(value[name],replaceName,replacement,onReplace);
  }
  return out;
}
function statementIR(text) {
  let before='',after='';const clean=stripComment(text).trim();
  if(/^ElseIf\b/i.test(clean)){before='If True Then\n';after='\nEnd If';}
  else if(/^If\b[\s\S]*\bThen\s*$/i.test(clean))after='\nEnd If';
  else if(/^For\b/i.test(clean))after='\nNext';
  else if(/^Do(?:\s|$)/i.test(clean))after='\nLoop';
  else if(/^Loop\b/i.test(clean))before='Do\n';
  else if(/^While\b/i.test(clean))after='\nWend';
  else if(/^With\b/i.test(clean))after='\nEnd With';
  else if(/^Select\s+Case\b/i.test(clean))after='\nCase Else\nEnd Select';
  else if(/^Case\b/i.test(clean)){before='Select Case 0\n';after='\nEnd Select';}
  const module=compileModule({name:'RefactorContext',kind:'module',code:'Private Sub RefactorContext()\n'+before+text+after+'\nEnd Sub\n'});
  const code=module.procedures.get('refactorcontext').code;
  if(code.some(ins=>ins.op==='dim'))throw new Error('Declaration refactoring requires a separate binding plan.');
  return code;
}
function signedContextChanged(value,name,replacement,constant) {
  if(!value||typeof value!=='object')return false;
  if(value.kind==='unary'&&value.op==='-'&&value.expr?.kind==='id'&&symbolKey(value.expr.name)===name){
    const signed=signedLiteralScalar({...value,expr:replacement});
    if(signed&&scalarType(signed)!==scalarType(unary('-',constant)))return true;
  }
  return Object.values(value).some(child=>signedContextChanged(child,name,replacement,constant));
}
function freshName(source) {
  const used=new Set();for(const match of source.matchAll(/NewConstant\d*/gi))used.add(match[0].toLowerCase());
  let suffix=0;while(used.has(('NewConstant'+(suffix||'')).toLowerCase()))suffix++;
  return 'NewConstant'+(suffix||'');
}
function expressionContext(source,index,start,end) {
  const procedure=index.procedures.find(p=>start>p.offset&&end<p.endOffset&&!p.external);
  const statement=index.statements.find(s=>s.start<=start&&end<=s.end&&s.line===s.endLine);
  if(!procedure||!statement||statement.end-statement.start>16384||index.conditionalError)return null;
  const header=index.statements.find(s=>s.start===procedure.offset);
  const closing=index.statements.find(s=>s.end===procedure.endOffset&&/^\s*End\s+(?:Sub|Function|Property)\b/i.test(s.clean));
  if(!header||!closing||statement.start<=header.end||statement.start>=closing.start||source[header.end]!=='\n')return null;
  // Hoisting across an in-procedure compiler directive could change which
  // declaration is available in another build configuration.
  if(/^\s*#(?:If|Else|End|Const)\b/im.test(source.slice(header.end,closing.start)))return null;
  const compare=index.statements.some(s=>/^\s*Option\s+Compare\s+Text\b/i.test(s.clean))?'text':'binary';
  return {procedure,statement,header,compare,raw:source.slice(statement.start,statement.end)};
}
function extractConstant(source,index,start,end,tabWidth) {
  if(start===end||end-start>4096)return null;
  const context=expressionContext(source,index,start,end);if(!context)return null;
  const selected=source.slice(start,end),trimmed=selected.trim();if(!trimmed)return null;
  start+=selected.indexOf(trimmed);end=start+trimmed.length;
  const expression=parseExpression(trimmed),value=constantValue(expression,context.compare),name=freshName(source),key=symbolKey(name);
  const a=start-context.statement.start,b=end-context.statement.start;
  const before=statementIR(context.raw),after=statementIR(context.raw.slice(0,a)+name+context.raw.slice(b));let occurrences=0;
  if(signedContextChanged(after,key,expression,value))return null;
  const restored=normalized(after,key,expression,()=>occurrences++);
  if(!occurrences||JSON.stringify(normalized(before))!==JSON.stringify(restored))return null;
  const headerIndent=source.slice(context.header.start,context.header.end).match(/^[ \t]*/)[0];
  const body=index.statements.find(s=>s.start>context.header.end),bodyIndent=body&&source.slice(body.start,body.end).match(/^[ \t]*/)[0];
  const indent=bodyIndent&&bodyIndent.length>headerIndent.length?bodyIndent:headerIndent+' '.repeat(Math.max(1,Math.min(16,tabWidth)));
  const eol=source.includes('\r\n')?'\r\n':'\n',insert=context.header.end+1,type=types[scalarType(value)];
  return {title:'Extract constant '+name,kind:'refactor.extract.constant',edits:[
    {start:insert,end:insert,text:indent+'Const '+name+' As '+type+' = '+trimmed+eol},
    {start,end,text:name}],selection:{start:insert+indent.length+6,end:insert+indent.length+6+name.length}};
}
function inlineConstant(source,index,start,end) {
  const context=expressionContext(source,index,start,end);if(!context)return null;
  const tokens=tokenize(context.raw),at=start-context.statement.start;
  const token=tokens.find(t=>t.type==='id'&&t.start<=at&&at<t.end)||tokens.find(t=>t.type==='id'&&t.end===at);
  if(!token||end>context.statement.start+token.end)return null;
  start=context.statement.start+token.start;end=context.statement.start+token.end;
  const target=symbolKey(token.value),local=index.symbols.find(s=>s.ownerId===context.procedure.id&&symbolKey(s.name)===target);
  const symbol=local||index.symbols.find(s=>!s.owner&&!s.parentType&&s.kind==='constant'&&symbolKey(s.name)===target);
  if(!symbol||symbol.kind!=='constant'||target===symbolKey(context.procedure.name))return null;
  const declarations=parseDeclarations(stripComment(symbol.signature),true,index.defaults);if(declarations.length!==1)return null;
  const declaration=declarations[0],expression=declaration.initial,initializer=stripComment(symbol.defaultValue||'').trim();
  if(!initializer||initializer.length>4096)return null;
  const value=constantValue(expression,context.compare),type=String(declaration.type).toLowerCase();
  if((declaration.explicitType||type!=='variant')&&type!==scalarType(value))return null;
  const text='('+initializer+')',a=start-context.statement.start,b=end-context.statement.start;
  const before=statementIR(context.raw),after=statementIR(context.raw.slice(0,a)+text+context.raw.slice(b));
  const placeholder=freshName(source),stub=statementIR(context.raw.slice(0,a)+placeholder+context.raw.slice(b));let occurrences=0;
  const restored=normalized(stub,symbolKey(placeholder),{kind:'id',name:token.value},()=>occurrences++);
  const expanded=normalized(stub,symbolKey(placeholder),expression);
  // The unique placeholder identifies this reference, not every same-named
  // reference in the statement. Member names, named arguments and lvalues are
  // not constant reads, even when their spelling happens to match.
  if(occurrences!==1||stub.some(ins=>ins.op==='assign'&&ins.target?.kind==='id'&&symbolKey(ins.target.name)===symbolKey(placeholder))||JSON.stringify(restored)!==JSON.stringify(normalized(before))||JSON.stringify(expanded)!==JSON.stringify(normalized(after)))return null;
  return {title:'Inline constant reference '+token.raw,kind:'refactor.inline.constant',edits:[{start,end,text}],selection:{start,end:start+text.length}};
}

/** Source actions use original UTF-16 offsets. Literal extraction/inline are
 * deliberately narrower than general data-flow refactoring; equivalence is
 * checked against compiler IR so token substrings cannot change precedence. */
export function sourceCodeActions(module,index,start=0,end=start,{only,tabWidth=4}={}) {
  const source=String(module.code||'');
  if(![start,end].every(Number.isSafeInteger)||start<0||end<start||end>source.length)throw new RangeError('Invalid code-action selection.');
  const actions=[];
  if(includesActionKind('source.fixAll',only)){
    const edits=[];for(const m of source.matchAll(/[ \t]+(?=\r?$)/gm))edits.push({start:m.index,end:m.index+m[0].length,text:''});
    if(edits.length)actions.push({title:'Remove trailing whitespace',kind:'source.fixAll',edits});
  }
  if(index.language==='pascal'||moduleLanguage(module)==='pascal')return actions.map(action=>({...action,before:source}));
  if(includesActionKind('source.addOptionExplicit',only)&&!index.statements.some(s=>/^\s*Option\s+Explicit\b/i.test(s.clean))){
    const at=source.charCodeAt(0)===0xfeff?1:0;
    actions.push({title:'Add Option Explicit',kind:'source.addOptionExplicit',edits:[{start:at,end:at,text:'Option Explicit'+(source.includes('\r\n')?'\r\n':'\n')}]});
  }
  for(const [kind,create]of [['refactor.extract.constant',()=>extractConstant(source,index,start,end,tabWidth)],['refactor.inline.constant',()=>inlineConstant(source,index,start,end)]]){
    if(!includesActionKind(kind,only))continue;
    try{const action=create();if(action)actions.push(action);}catch{/* An incomplete/unsafe expression has no refactoring, not a guessed edit. */}
  }
  return actions.map(action=>({...action,before:source}));
}
export function applySourceCodeAction(source,action) {
  if(source!==action.before)throw new Error('Code action is stale. Request it again.');
  if(!Array.isArray(action.edits))throw new TypeError('Code action requires text edits.');
  const edits=[...action.edits].sort((a,b)=>a.start-b.start||a.end-b.end),parts=[];let cursor=0;
  for(const edit of edits){
    if(![edit.start,edit.end].every(Number.isSafeInteger)||edit.start<cursor||edit.end<edit.start||edit.end>source.length||typeof edit.text!=='string')throw new RangeError('Invalid or overlapping code-action edit.');
    parts.push(source.slice(cursor,edit.start),edit.text);cursor=edit.end;
  }
  parts.push(source.slice(cursor));return parts.join('');
}
