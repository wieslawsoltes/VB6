import {parseExpression} from '../language/expression.js';
import {IDENTIFIER,TYPE_NAME,lexicalContext,splitArguments,symbolKey} from './source-context.js';

// Complete parameter grammar, distinct from the deliberately tolerant source
// index. Metadata may be rendered or copied into a handler, never interpreted
// as a prefix followed by arbitrary statements.
const declaration=new RegExp('^\\s*(?:(Optional)\\s+)?(?:(ByVal|ByRef)\\s+)?(?:(ParamArray)\\s+)?('+IDENTIFIER+')(\\s*\\(\\s*\\))?\\s*(?:As\\s+('+TYPE_NAME+'))?\\s*(?:=\\s*(.+))?$','iu');
function constantSyntax(node,depth=0){
  if(!node||depth>32)return false;
  if(['literal','date','currency','nothing','empty','id'].includes(node.kind))return true;
  if(node.kind==='group'||node.kind==='unary')return constantSyntax(node.expr,depth+1);
  if(node.kind==='member')return node.object.kind==='id'||node.object.kind==='member'&&constantSyntax(node.object,depth+1);
  return node.kind==='binary'&&constantSyntax(node.left,depth+1)&&constantSyntax(node.right,depth+1);
}
export function validParameter(text){
  if(typeof text!=='string'||text.length>8192||/[\r\n\0]/.test(text))return false;
  const context=lexicalContext(text);
  if(context.state!=='code'||context.bracket||splitArguments(text,true).length!==1)return false;
  const m=declaration.exec(text);if(!m)return false;
  const [,optional,mode,paramArray,,array,type,initial]=m;
  if(paramArray&&(optional||mode||!array||type&&symbolKey(type)!=='variant'))return false;
  if(initial!==undefined){
    if(!optional||array||paramArray)return false;
    // VB defaults are constant expressions, not method calls or constructors.
    try{return constantSyntax(parseExpression(initial));}catch{return false;}
  }
  return true;
}
export function validParameterList(params){
  if(!Array.isArray(params)||params.length>255)return false;
  const names=new Set();
  for(let i=0;i<params.length;i++){
    const text=params[i];if(!validParameter(text))return false;
    const m=declaration.exec(text),key=symbolKey(m[4]);
    if(names.has(key)||m[3]&&i!==params.length-1)return false;
    names.add(key);
  }
  return true;
}

/** Display an inferred formal type without changing stored source signatures.
 * The full parameter grammar isolates defaults, including strings with As/=.
 * Incomplete/unrecognized signatures remain verbatim rather than being guessed. */
export function displayParameter(text, parameter) {
  const match = declaration.exec(text);
  if (!match || match[6] || !parameter?.type) return text;
  const initial = match[7];
  const head = initial === undefined ? text : text.slice(0, text.length - initial.length).replace(/\s*=\s*$/, '');
  return head.trimEnd() + ' As ' + parameter.type + (initial === undefined ? '' : ' = ' + initial);
}
