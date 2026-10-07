import {VBError} from './errors.js';
import {DeclarationCursor} from './declaration-cursor.js';
import {parseExpression} from './expression.js';
import {tokenize,splitTop} from './lexer.js';
import {findKeyword,scanSyntax,syntaxTokens,isKeyword} from './source-scanner.js';

const E=parseExpression;
const fail=message=>{throw new VBError(message,1002);};
const specialExpressionNames=new Set(['true','false','null','empty','nothing','not','new','typeof','addressof','byval']);
function identifierSpelling(name,head=true) {
  return /^[A-Za-z_\u0080-\uffff][\w\u0080-\uffff]*[$%&!#@]?$/.test(name)&&(!head||!specialExpressionNames.has(name.toLowerCase()))?name:'['+name+']';
}

/** Preserve escaped keyword variables for the VM, but remove redundant brackets.
 * Identity is structural: a single [a.b] variable is not the member a.b. */
export function loopVariable(text) {
  const node=E(text),parts=[];let current=node;
  while(current.kind==='member'){parts.unshift(current.name);current=current.object;}
  if(current.kind!=='id')fail('For control variable must be a variable, not an array element or expression');
  parts.unshift(current.name);
  return {name:parts.map((name,i)=>identifierSpelling(name,i===0)).join('.'),identity:JSON.stringify(parts.map(n=>n.toLowerCase()))};
}
function topOperator(text,value) {
  let depth=0,result=null;
  scanSyntax(text,t=>{
    if(t.kind!=='op')return;
    if(t.value==='(')depth++;else if(t.value===')')depth--;
    else if(!depth&&t.value===value){result=t;return false;}
  });
  return result;
}
export function parseForHeader(text) {
  const first=/^For\s+(Each\s+)?/i.exec(text);
  if(!first)return null;
  const tail=text.slice(first[0].length);
  if(first[1]){
    const delimiter=findKeyword(tail,'in');if(!delimiter)fail('Expected In in For Each');
    const variable=loopVariable(tail.slice(0,delimiter.start));
    return {kind:'each',...variable,expr:E(tail.slice(delimiter.end))};
  }
  const equal=topOperator(tail,'=');if(!equal)fail('Expected = in For statement');
  const variable=loopVariable(tail.slice(0,equal.start)),rest=tail.slice(equal.end),to=findKeyword(rest,'to');
  if(!to)fail('Expected To in For statement');
  const bound=rest.slice(to.end),step=findKeyword(bound,'step');
  return {kind:'numeric',...variable,start:E(rest.slice(0,to.start)),end:E(step?bound.slice(0,step.start):bound),step:E(step?bound.slice(step.end):'1')};
}

/** Label grammar is separate from expressions, including escaped keywords. */
export function parseLabel(text) {
  const tokens=tokenize(text.trim()),first=tokens[0];
  if(tokens.length!==2||first.type!=='id'&&!(first.type==='number'&&/^\d+$/.test(first.raw)))fail('Expected a line label or line number');
  if(first.type==='id'&&/[$%&!#@]$/.test(first.value))fail('Type-declaration characters are not permitted in labels');
  return first.type==='number'?first.raw:first.value;
}
export function parseComputedBranch(text) {
  const first=/^On\s+/i.exec(text);if(!first)return null;
  const to=findKeyword(text,'goto',first[0].length),sub=findKeyword(text,'gosub',first[0].length);
  const branch=!to?sub:!sub?to:to.start<sub.start?to:sub;
  if(!branch)fail('Expected GoTo or GoSub');
  return {expr:E(text.slice(first[0].length,branch.start)),gosub:isKeyword(branch,'gosub'),labels:splitTop(text.slice(branch.end)).map(parseLabel)};
}
const handle=text=>E(text.trim().replace(/^#\s*/,''));
function access(cursor) {
  if(cursor.match('read'))return cursor.match('write')?'read write':'read';
  if(cursor.match('write'))return 'write';
  cursor.fail('Expected Read or Write');
}
function recordLengthDelimiter(text) {
  const tokens=syntaxTokens(text);let depth=0;
  for(let i=0;i<tokens.length;i++){
    const t=tokens[i];
    if(t.kind==='op'&&t.value==='(')depth++;
    else if(t.kind==='op'&&t.value===')')depth--;
    else if(!depth&&i>0&&isKeyword(t,'len')&&!['.','!'].includes(tokens[i-1].value)&&tokens[i+1]?.value==='=')return {start:t.start,end:tokens[i+1].end};
  }
  return null;
}
function targets(text,whole=false) {
  const nodes=splitTop(text).map(E);
  if(whole&&nodes.length!==1)fail('Line Input requires exactly one variable');
  if(nodes.some(n=>!['id','member','call'].includes(n.kind)))fail('Input requires an assignable variable');
  return nodes;
}

/** Produces the existing VM instructions; delimiter parsing never performs I/O. */
export function parseFileStatement(text) {
  let first;
  if((first=/^Open\s+/i.exec(text))){
    const delimiter=findKeyword(text,'for',first[0].length);if(!delimiter)fail('Expected For in Open statement');
    const path=E(text.slice(first[0].length,delimiter.start)),p=new DeclarationCursor(text.slice(delimiter.end));
    const mode=['input','output','append','binary','random'].find(v=>p.match(v));if(!mode)p.fail('Expected file mode');
    const permission=p.match('access')?access(p):undefined;
    const sharing=p.match('shared')?'shared':p.match('lock')?'lock '+access(p):undefined;
    p.expect('as');const rest=p.rest(),length=recordLengthDelimiter(rest);
    return {op:'fileOpen',path,mode,access:permission,sharing,handle:handle(length?rest.slice(0,length.start):rest),recordLength:length?E(rest.slice(length.end)):null};
  }
  if((first=/^(Get|Put|Seek|Lock|Unlock)\s+/i.exec(text))){
    const kind=first[1].toLowerCase(),parts=splitTop(text.slice(first[0].length));
    if(kind==='get'||kind==='put'){
      if(parts.length!==3)fail('Get/Put requires file number, optional position, and variable');
      const target=E(parts[2]);if(!['id','member','call'].includes(target.kind))fail('Get/Put requires a variable');
      return {op:'fileRecord',action:kind,handle:handle(parts[0]),position:parts[1]?E(parts[1]):null,target};
    }
    if(kind==='seek'){
      if(parts.length!==2)fail('Seek requires file number and position');
      return {op:'fileSeek',handle:handle(parts[0]),position:E(parts[1])};
    }
    if(parts.length>2||parts.length===2&&!parts[1])fail('Invalid Lock/Unlock record range');
    const to=parts.length===2?findKeyword(parts[1],'to'):null;
    return {op:'fileLock',unlock:kind==='unlock',handle:handle(parts[0]),start:parts.length===2?E(to?parts[1].slice(0,to.start):parts[1]):null,end:to?E(parts[1].slice(to.end)):null};
  }
  if((first=/^(Print|Write)\s+#/i.exec(text))){
    const body=text.slice(first[0].length),comma=topOperator(body,','),csv=/^write$/i.test(first[1]);
    const output=comma?body.slice(comma.end).trim():'';
    return {op:'filePrint',handle:handle(comma?body.slice(0,comma.start):body),exprs:splitTop(output,csv?',':';').filter(Boolean).map(E),csv,newline:!output.endsWith(';')};
  }
  if((first=/^(Line\s+Input|Input)\s+#/i.exec(text))){
    const body=text.slice(first[0].length),comma=topOperator(body,',');if(!comma)fail('Input requires file number and variable');
    const whole=/^line/i.test(first[1]);
    return {op:'fileInput',handle:handle(body.slice(0,comma.start)),targets:targets(body.slice(comma.end),whole),whole};
  }
  return null;
}
