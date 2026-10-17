import {escapeHTML} from '../../core/core.js';
import {tokenizePascal} from './lexer.js';

export const PASCAL_KEYWORDS=Object.freeze('absolute and array asm assembler begin case const constructor destructor div do downto else end external far file for forward function goto if implementation in inherited inline interface interrupt label mod near nil not object of or packed procedure program record repeat set shl shr string then to type unit until uses var virtual while with xor'.split(' '));
export const PASCAL_BUILTINS=Object.freeze('Abs Addr Append ArcTan Assign BlockRead BlockWrite ChDir Chr Close ClrScr Concat Copy Cos Dec Delete Dispose EOF EOLn Erase Exclude Exit Exp FilePos FileSize FillChar Flush Frac GetDir Halt Hi High Inc Include Insert Int IOResult Length Ln Lo Low MaxAvail MemAvail Move New Odd Ord ParamCount ParamStr Pi Pos Pred Random Randomize Read ReadLn Rename Reset Rewrite Round RunError Seek SeekEof SeekEoln SetTextBuf Sin SizeOf Sqr Sqrt Str Succ Swap Trunc UpCase Val Write WriteLn'.split(' '));
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
function parameterInfo(text){
  const result=[];
  for(const group of text.split(';')){
    const match=group.trim().match(/^(?:(var|const)\s+)?([A-Za-z_]\w*(?:\s*,\s*[A-Za-z_]\w*)*)\s*:\s*(.+)$/i);if(!match)continue;
    for(const name of match[2].split(',').map(s=>s.trim()))result.push({name,type:match[3].trim(),byRef:match[1]?.toLowerCase()==='var',optional:false,paramArray:false,array:/^array\b/i.test(match[3]),rank:/^array\b/i.test(match[3])?1:0,signature:(match[1]?match[1]+' ':'')+name+': '+match[3].trim(),insertText:name});
  }return result;
}
/** Tolerant declarations use the real lexer and keep original UTF-16 ranges.
 * Parsing bodies is unnecessary: balanced compound statements provide scopes,
 * while nested declarations are scanned recursively before each body. */
export function scanPascalDeclarations(module){
  const source=String(module.code||''),tokens=lexical(source),symbols=[],procedures=[],records=[],lineCount=source.split('\n').length,exported=new Set();let unitInterface=false,bodyStart=source.length;
  const t=i=>tokens[i],is=(i,value)=>lower(t(i))===value;
  const statementEnd=start=>{let depth=0;for(let i=start;i<tokens.length;i++){if(['(','['].includes(lower(t(i))))depth++;else if([')',']'].includes(lower(t(i))))depth--;if(depth<=0&&is(i,';'))return i;if(t(i).type==='eof')return i;}return tokens.length-1;};
  const symbol=(token,extra,parent=null)=>({name:token.value,insertText:token.value,line:token.line,offset:token.start,moduleId:module.id,scope:unitInterface||exported.has(lower(token))?'public':'private',owner:parent?.name||null,ownerId:parent?.id||null,...extra});
  function declarationSection(i,section,parent){
    for(i++;i<tokens.length;){
      if(t(i).type!=='id'||keywords.has(lower(t(i))))return i;
      const end=statementEnd(i),list=tokens.slice(i,end),separator=list.findIndex(token=>lower(token)===(section==='var'?':':'='));if(separator<0)return i;
      const nameTokens=list.slice(0,separator).filter(token=>token.type==='id'),value=source.slice(list[separator].end,t(end).start).trim();
      for(const name of nameTokens){
        const item=symbol(name,{kind:section==='const'?'constant':section==='type'?'type':'variable',type:section==='var'?value:section==='type'?name.value:/^'/.test(value)?'String':/^(true|false)$/i.test(value)?'Boolean':'Integer',signature:source.slice(t(i).start,t(end).end),...(section==='const'?{defaultValue:value}:{}),array:/^array\b/i.test(value),rank:/^array\b/i.test(value)?1:0},parent);
        symbols.push(item);if(unitInterface)exported.add(lower(name));if(section==='type')records.push({...item,members:[]});
      }
      i=end+1;
    }return i;
  }
  function compound(i){let depth=0;
    for(;i<tokens.length;i++){
      const word=lower(t(i));if(['begin','case','record','object','asm','repeat'].includes(word))depth++;else if(['end','until'].includes(word))depth--;
      if(depth===0){if(word==='until')i=statementEnd(i);return is(i+1,';')?i+2:i+1;}
    }return i;
  }
  function procedure(i,parent=null){
    const first=i,name=t(i+1);if(name?.type!=='id')return i+1;
    const end=statementEnd(i),header=source.slice(t(i).start,t(end).end),open=header.indexOf('('),close=header.lastIndexOf(')'),params=parameterInfo(open<0?'':header.slice(open+1,close<open?undefined:close));
    const kind=is(i,'function')?'function':'sub',type=kind==='sub'?'Void':(close>=0?header.slice(close+1):header.slice(header.indexOf(String(name.value))+String(name.value).length)).match(/:\s*([^;]+)/)?.[1].trim()||'Variant';
    const proc=symbol(name,{kind,type,id:t(first).start+':'+kind,line:t(first).line,offset:t(first).start,end:lineCount,endOffset:source.length,signature:header.trim(),params:params.map(p=>(p.byRef?'ByRef ':'ByVal ')+p.name+' As '+p.type),parameters:params,accessor:null},parent);
    if(unitInterface){exported.add(lower(name));proc.scope='public';symbols.push(proc);return end+1;}
    if(is(end+1,'forward')||is(end+1,'external')){proc.external=true;symbols.push(proc);return statementEnd(end+1)+1;}
    // The implementation provides the one navigable declaration for a unit's
    // exported name. Prototype signatures do not create duplicate procedures.
    const previous=symbols.findIndex(item=>!item.owner&&item.kind===kind&&String(item.name).toLowerCase()===lower(name));if(previous>=0)symbols.splice(previous,1);
    symbols.push(proc);procedures.push(proc);for(const parameter of params)symbols.push({...symbol(name,{kind:'parameter',scope:'private'},proc),...parameter});
    i=end+1;
    while(i<tokens.length&&!is(i,'begin')&&!is(i,'asm')&&t(i).type!=='eof'){
      if(['procedure','function','constructor','destructor'].includes(lower(t(i))))i=procedure(i,proc);
      else if(['var','const','type'].includes(lower(t(i))))i=declarationSection(i,lower(t(i)),proc);
      else if(is(i,'end')||is(i,'implementation'))break;else i++;
    }
    if(is(i,'begin')||is(i,'asm')){i=compound(i);const last=t(Math.min(tokens.length-1,i-1));proc.end=last.endLine??last.line;proc.endOffset=last.end;}
    return i;
  }
  for(let i=0;i<tokens.length;){
    const word=lower(t(i));if(word==='interface'){unitInterface=true;i++;}else if(word==='implementation'){unitInterface=false;i++;}
    else if(['procedure','function','constructor','destructor'].includes(word))i=procedure(i);
    else if(['var','const','type'].includes(word))i=declarationSection(i,word,null);
    else if(word==='begin'){bodyStart=t(i).start;i=compound(i);}
    else if(word==='end'&&is(i+1,'.')){bodyStart=Math.min(bodyStart,t(i).start);i++;}else i++;
  }
  for(const control of module.form?.controls||[])symbols.push({name:control.name,type:control.type,kind:'control',scope:'public',moduleId:module.id,line:1,owner:null,array:control.properties?.Index!==undefined,controlArray:control.properties?.Index!==undefined,signature:control.name+': '+control.type});
  for(const menu of module.form?.menus||[])symbols.push({name:menu.name,type:'Menu',kind:'control',scope:'public',moduleId:module.id,line:1,owner:null});
  const masked=pascalMasked(source,tokens),maskedLines=masked.split('\n'),statements=[];let offset=0;for(const [index,line]of source.split('\n').entries()){statements.push({text:line,clean:maskedLines[index],line:index+1,endLine:index+1,start:offset,end:offset+line.length});offset+=line.length+1;}
  return {moduleId:module.id,name:module.name,language:'pascal',symbols,procedures:procedures.sort((a,b)=>a.offset-b.offset),records,withBlocks:[],selectBlocks:[],labels:[],interfaces:[],defaults:{},conditionalError:null,masked,statements,privateModule:false,predeclared:!!module.form,bodyStart};
}
export function pascalProcedureEdit(module,{name,parameters='',returnType=null,tabWidth=4}={}){
  const source=String(module.code||''),index=scanPascalDeclarations(module),eol=source.includes('\r\n')?'\r\n':'\n',start=index.bodyStart,indent=' '.repeat(Math.max(1,Math.min(32,tabWidth)));
  const header=(returnType?'function ':'procedure ')+name+(parameters?'('+parameters+')':'')+(returnType?': '+returnType:'')+';',prefix=start===0?'':source.slice(0,start).endsWith(eol+eol)?'':source.slice(0,start).endsWith(eol)?eol:eol+eol;
  return {name,start,end:start,text:prefix+header+eol+'begin'+eol+indent+eol+'end;'+eol+eol,caret:start+prefix.length+header.length+eol.length+'begin'.length+eol.length+indent.length};
}
export function pascalCallContext(source,offset,{outer=false}={}){
  const masked=pascalMasked(source),stack=[];
  for(let i=0;i<offset;i++){
    if(masked[i]==='('||masked[i]==='['){const expression=masked.slice(0,i).match(/([A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*)\s*$/)?.[1]||'';stack.push({name:expression.replace(/\s+/g,''),start:i+1,argumentStart:i+1,last:i+1,comma:0,args:[]});}
    else if(masked[i]===')'||masked[i]===']')stack.pop();
    else if(masked[i]===','&&stack.length){const item=stack.at(-1);item.args.push(source.slice(item.last,i));item.comma++;item.last=i+1;}
  }
  const calls=stack.filter(item=>item.name&&!keywords.has(item.name.toLowerCase())),context=outer?calls[0]:calls.at(-1);
  return context?{...context,named:null,args:[...context.args,source.slice(context.last,offset)]}:null;
}
export function pascalWordAt(source,offset){
  source=String(source);offset=Math.max(0,Math.min(source.length,offset));const tokens=lexical(source);let low=0,high=tokens.length;
  while(low<high){const mid=(low+high)>>>1;if(tokens[mid].start<offset)low=mid+1;else high=mid;}
  let at=tokens[low]?.start===offset?low:low-1,token=tokens[at];if(!token||token.type!=='id'||token.end<offset)return {text:'',start:offset,end:offset};
  const end=token.end;while(at>=2&&lower(tokens[at-1])==='.'&&tokens[at-2].type==='id')at-=2;
  const start=tokens[at].start;return {text:source.slice(start,end).replace(/\s*\.\s*/g,'.'),start,end};
}
export function pascalFoldingRanges(source,{maxRanges=10000}={}){
  const tokens=lexical(source),stack=[],ranges=[];
  for(const token of tokens){const word=lower(token);if(['begin','record','object','case','repeat','asm'].includes(word))stack.push(token);else if(['end','until'].includes(word)&&stack.length){const start=stack.pop();if(token.line>start.line)ranges.push({startLine:start.line-1,endLine:token.line-1,kind:'region'});}}
  for(const comment of tokens.comments||[])if(comment.endLine>comment.line)ranges.push({startLine:comment.line-1,endLine:comment.endLine-1,kind:'comment'});
  for(const procedure of scanPascalDeclarations({code:source}).procedures)if(procedure.end>procedure.line)ranges.push({startLine:procedure.line-1,endLine:procedure.end-1,kind:'region'});
  const seen=new Set();return ranges.sort((a,b)=>a.startLine-b.startLine||b.endLine-a.endLine).filter(item=>{if(seen.has(item.startLine))return false;seen.add(item.startLine);return true;}).slice(0,maxRanges);
}
