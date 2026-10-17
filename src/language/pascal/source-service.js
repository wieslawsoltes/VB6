import {escapeHTML} from '../../core/core.js';
import {tokenizePascal,PASCAL_KEYWORDS as COMPILER_KEYWORDS} from './lexer.js';
import {scanPascalIndex} from './declaration-index.js';

export const PASCAL_KEYWORDS=Object.freeze([...COMPILER_KEYWORDS]);
export const PASCAL_BUILTINS=Object.freeze('Abs Addr Append ArcTan Assign BlockRead BlockWrite ChDir Chr Close ClrScr Concat Copy Cos Dec Delete Dispose EOF EOLn Erase Exclude Exit Exp Fail FilePos FileSize FillChar Flush Frac GetDir Halt Hi High Inc Include Insert Int IOResult Length Ln Lo Low MaxAvail MemAvail Move New Odd Ord ParamCount ParamStr Pi Pos Pred Random Randomize Read ReadLn Rename Reset Rewrite Round RunError Seek SeekEof SeekEoln SetTextBuf Sin SizeOf Sqr Sqrt Str Succ Swap Trunc UpCase Val Write WriteLn'.split(' '));
export const PASCAL_SNIPPETS=Object.freeze([
  {label:'procedure',text:'procedure ${1:Name};\nbegin\n\t$0\nend;'},
  {label:'function',text:'function ${1:Name}: ${2:Integer};\nbegin\n\t${1:Name} := ${3:0};\n\t$0\nend;'},
  {label:'for',text:'for ${1:i} := ${2:0} to ${3:10} do\nbegin\n\t$0\nend;'},
  {label:'if',text:'if ${1:condition} then\nbegin\n\t$0\nend;'},
  {label:'case',text:'case ${1:expression} of\n\t${2:value}: ${3:statement};\nelse\n\t$0\nend;'},
  {label:'while',text:'while ${1:condition} do\nbegin\n\t$0\nend;'},
  {label:'repeat',text:'repeat\n\t$0\nuntil ${1:condition};'},
]);
const keywords=new Set(PASCAL_KEYWORDS),lower=token=>String(token?.value??'').toLowerCase();
let lastSource=null,lastTokens=null;
export function pascalTokens(source){source=String(source);if(source===lastSource)return lastTokens;const tokens=tokenizePascal(source,{tolerant:true});lastSource=source;lastTokens=tokens;return tokens;}
const lexical=pascalTokens;
export function pascalMasked(source,tokens=lexical(source)){
  source=String(source);const chars=source.split('');
  for(const t of [...tokens.filter(t=>t.type==='string'),...(tokens.comments||[]),...(tokens.directives||[])])for(let i=t.start;i<t.end;i++)if(chars[i]!=='\n'&&chars[i]!=='\r')chars[i]=' ';
  return chars.join('');
}
export function renamePascalSymbol(source,oldName,newName,{events=true}={}){
  source=String(source);const target=String(oldName).toLowerCase(),parts=[];let cursor=0;
  for(const token of lexical(source)){
    if(token.type!=='id')continue;const name=String(token.value),key=name.toLowerCase();
    const replacement=key===target?newName:events&&key.startsWith(target+'_')?newName+name.slice(oldName.length):null;
    if(replacement===null)continue;parts.push(source.slice(cursor,token.start),replacement);cursor=token.end;
  }
  parts.push(source.slice(cursor));return parts.join('');
}
/** Tokens are shared with the compiler, including tolerant unterminated input. */
export function pascalHighlightSpans(source){
  const tokens=lexical(source),spans=[];
  for(const t of tokens){const kind=t.type==='string'?'string':['number','charCode'].includes(t.type)?'number':t.type==='id'&&keywords.has(lower(t))?'keyword':'';if(kind)spans.push({start:t.start,end:t.end,kind});}
  for(const t of [...(tokens.comments||[]),...(tokens.directives||[])])spans.push({start:t.start,end:t.end,kind:'comment'});
  return spans.sort((a,b)=>a.start-b.start||b.end-a.end).filter((span,i,array)=>!i||span.start>=array[i-1].end);
}
export function highlightPascalLine(line,selectionStart=-1,selectionEnd=-1,executionStart=-1,executionEnd=-1,spans=null,offset=0){
  spans=spans||pascalHighlightSpans(line);const parts=[],cuts=new Set([0,line.length]);let low=0,high=spans.length;while(low<high){const mid=(low+high)>>>1;if(spans[mid].end<=offset)low=mid+1;else high=mid;}
  for(let i=low;i<spans.length&&spans[i].start<offset+line.length;i++){const span=spans[i];cuts.add(Math.max(0,span.start-offset));cuts.add(Math.min(line.length,span.end-offset));}
  for(const point of [selectionStart,selectionEnd,executionStart,executionEnd])if(point>0&&point<line.length)cuts.add(point);
  const positions=[...cuts].sort((a,b)=>a-b);let j=low;
  for(let i=0;i<positions.length-1;i++){
    const start=positions[i],end=positions[i+1];while(j<spans.length&&spans[j].end<=offset+start)j++;
    const classes=[],span=spans[j];if(span&&span.start<=offset+start&&span.end>offset+start)classes.push('syn-'+span.kind);
    if(start>=selectionStart&&start<selectionEnd)classes.push('code-selection');if(start>=executionStart&&start<executionEnd)classes.push('code-execution');
    const html=escapeHTML(line.slice(start,end));parts.push(classes.length?'<span class="'+classes.join(' ')+'">'+html+'</span>':html);
  }
  if(selectionStart<=line.length&&selectionEnd>line.length)parts.push('<span class="code-selection"> </span>');return parts.join('')||' ';
}
export function formatPascalCode(source,tabWidth=4){
  source=String(source);tabWidth=Math.max(1,Math.min(32,Number(tabWidth)||4));
  const masked=pascalMasked(source).split('\n'),lines=source.split('\n');let depth=0,section=false;
  return lines.map((line,index)=>{
    const clean=masked[index].trim(),text=line.trim();if(!text)return '';
    // Comment continuations retain their whitespace, including significant text
    // in incomplete string literals. Only source-code indentation is rewritten.
    if(!clean)return line;
    if(/^(?:interface|implementation|unit|program|uses)\b/i.test(clean)){depth=0;section=false;}
    if(/^(?:procedure|function|constructor|destructor)\b/i.test(clean)){if(section)depth=Math.max(0,depth-1);section=false;}
    if(/^(?:const|var|type|label)\b/i.test(clean)){if(!section){section=true;depth++;}return ' '.repeat(Math.max(0,depth-1)*tabWidth)+text;}
    if(/^begin\b/i.test(clean)&&section){depth=Math.max(0,depth-1);section=false;}
    const words=clean.match(/\b(?:begin|end|record|object|case|repeat|until|asm)\b/gi)||[],closing=/^(?:end|until)\b/i.test(clean),branch=/^else\b/i.test(clean);
    const indent=Math.max(0,depth-(closing||branch?1:0));
    for(const word of words)depth=Math.max(0,depth+(/^(?:end|until)$/i.test(word)?-1:1));
    return ' '.repeat(Math.min(40,indent)*tabWidth)+text;
  }).join('\n');
}
const typeNames={long:'LongInt',single:'Single',double:'Double',currency:'Currency',date:'Date',object:'Object',variant:'Variant',integer:'Integer',string:'String',boolean:'Boolean',byte:'Byte'};
/** Existing control metadata uses VB signature strings; Pascal keeps its exact
 * value/reference contract, particularly cancellable and mutable key events. */
export function pascalParameters(parameters){
  return (Array.isArray(parameters)?parameters:String(parameters||'').split(',')).filter(p=>String(p).trim()).map(value=>{
    const text=String(value).trim(),match=text.match(/^(?:(ByVal|ByRef)\s+)?([A-Za-z_]\w*)(\(\))?\s+As\s+([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)$/i);
    if(!match)throw new Error('Invalid event parameter signature: '+text);
    const type=typeNames[match[4].toLowerCase()]||match[4];return (match[1]?.toLowerCase()==='byval'?'':'var ')+match[2]+': '+(match[3]?'array of ':'')+type;
  }).join('; ');
}
export function scanPascalDeclarations(module){
  const source=String(module.code||''),tokens=lexical(source);
  return scanPascalIndex(module,tokens,pascalMasked(source,tokens));
}
export function pascalProcedureEdit(module,{name,parameters='',returnType=null,tabWidth=4}={}){
  const source=String(module.code||''),index=scanPascalDeclarations(module),eol=source.includes('\r\n')?'\r\n':'\n',start=index.bodyStart,indent=' '.repeat(Math.max(1,Math.min(32,tabWidth)));
  const header=(returnType?'function ':'procedure ')+name+(parameters?'('+parameters+')':'')+(returnType?': '+returnType:'')+';',prefix=start===0?'':source.slice(0,start).endsWith(eol+eol)?'':source.slice(0,start).endsWith(eol)?eol:eol+eol;
  return {name,start,end:start,text:prefix+header+eol+'begin'+eol+indent+eol+'end;'+eol+eol,caret:start+prefix.length+header.length+eol.length+'begin'.length+eol.length+indent.length};
}
export function pascalCallContext(source,offset,{outer=false}={}){
  const masked=pascalMasked(source),stack=[];
  for(let i=0;i<offset;i++){
    if(masked[i]==='('||masked[i]==='['){const expression=pascalExpressionBefore(source,i).text;stack.push({name:expression,start:i+1,argumentStart:i+1,last:i+1,comma:0,args:[]});}
    else if(masked[i]===')'||masked[i]===']')stack.pop();
    else if(masked[i]===','&&stack.length){const item=stack.at(-1);item.args.push(source.slice(item.last,i));item.comma++;item.last=i+1;}
  }
  const calls=stack.filter(item=>item.name&&!keywords.has(item.name.toLowerCase())),context=outer?calls[0]:calls.at(-1);
  return context?{...context,named:null,args:[...context.args,source.slice(context.last,offset)]}:null;
}
function expressionStart(tokens,index,depth=0){
  if(index<0||depth>64)return index+1;
  let start=index,word=lower(tokens[index]);
  if(word==='^')start=expressionStart(tokens,index-1,depth+1);
  else if(word===')'||word===']'){
    const close=word,open=word===')'?'(':'[';let nesting=1;
    for(start=index-1;start>=0;start--){if(lower(tokens[start])===close)nesting++;else if(lower(tokens[start])===open&&!--nesting)break;}
    if(start<0)return index+1;
    const before=tokens[start-1],previous=lower(before);
    if(before&&(before.type==='id'&&!keywords.has(previous)||[')',']','^'].includes(previous)))start=expressionStart(tokens,start-1,depth+1);
  }else if(tokens[index]?.type!=='id'||keywords.has(word)&&word!=='inherited')return index+1;
  if(start>=2&&lower(tokens[start-1])==='.')start=expressionStart(tokens,start-2,depth+1);
  if(start>0&&lower(tokens[start-1])==='inherited')start--;
  return start;
}
/** Pascal designators include array indexes and pointer dereferences. This
 * scanner consumes their balanced token suffix without executing expressions. */
export function pascalExpressionBefore(source,offset){
  const tokens=lexical(source);let low=0,high=tokens.length;
  while(low<high){const mid=(low+high)>>>1;if(tokens[mid].end<=offset&&tokens[mid].type!=='eof')low=mid+1;else high=mid;}
  const last=low-1,first=expressionStart(tokens,last);
  if(last<0||first>last)return {text:'',start:offset,end:offset};
  const start=tokens[first].start,end=tokens[last].end;return {text:String(source).slice(start,end),start,end};
}
export function pascalWordAt(source,offset){
  source=String(source);offset=Math.max(0,Math.min(source.length,offset));const tokens=lexical(source);let low=0,high=tokens.length;
  while(low<high){const mid=(low+high)>>>1;if(tokens[mid].start<offset)low=mid+1;else high=mid;}
  let at=tokens[low]?.start===offset&&tokens[low]?.type!=='eof'?low:low-1,token=tokens[at];if(!token||token.type!=='id'||token.end<offset)return {text:'',start:offset,end:offset};
  const end=token.end;at=expressionStart(tokens,at);
  if(at>=tokens.length||tokens[at].start>=end)return {text:'',start:offset,end:offset};
  const start=tokens[at].start;return {text:source.slice(start,end).replace(/\s*\.\s*/g,'.'),start,end};
}
export function pascalFoldingRanges(source,{maxRanges=10000}={}){
  const tokens=lexical(source),stack=[],ranges=[];
  for(const token of tokens){const word=lower(token);if(['begin','record','object','case','repeat','asm'].includes(word))stack.push(token);else if(['end','until'].includes(word)&&stack.length){const start=stack.pop();if(token.line>start.line)ranges.push({startLine:start.line-1,endLine:token.line-1,kind:'region'});}}
  for(const comment of tokens.comments||[])if(comment.endLine>comment.line)ranges.push({startLine:comment.line-1,endLine:comment.endLine-1,kind:'comment'});
  for(const procedure of scanPascalDeclarations({code:source}).procedures)if(procedure.end>procedure.line)ranges.push({startLine:procedure.line-1,endLine:procedure.end-1,kind:'region'});
  const seen=new Set();return ranges.sort((a,b)=>a.startLine-b.startLine||b.endLine-a.endLine).filter(item=>{if(seen.has(item.startLine))return false;seen.add(item.startLine);return true;}).slice(0,maxRanges);
}
