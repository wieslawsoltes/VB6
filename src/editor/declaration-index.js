import {preprocess} from '../language/conditional.js';
import {addDefaultTypes,defaultIdentifierType} from '../language/default-types.js';
import {IDENTIFIER,TYPE_NAME,sourceStatements,splitArguments,symbolKey,maskSource} from './source-context.js';

const variableName=new RegExp('^('+IDENTIFIER+')','i');
export function parameterSymbol(text, defaults={}) {
  const original=String(text).trim(),clean=original.replace(/^(?:(?:ByVal|ByRef|Optional|ParamArray|WithEvents|Static)\s+)*/i,'');
  const m=clean.match(variableName);if(!m)return null;
  const name=m[1].replace(/^\[|\]$/g,''),afterName=m[0].length;
  let tail=clean.slice(afterName).trimStart(),array=false,rank=0;
  if(tail.startsWith('(')){
    array=true;const close=closingParen(maskSource(tail),0);
    const dimensions=close<0?'':tail.slice(1,close);rank=Math.max(1,splitArguments(dimensions,true).length);
    tail=close<0?tail.slice(1):tail.slice(close+1);
  }
  const type=tail.match(new RegExp('^\\s*As\\s+(?:New\\s+)?('+TYPE_NAME+')','i'))?.[1]?.replace(/\s*\.\s*/g,'.').replace(/\[([^\]]+)\]/g,'$1')||defaultIdentifierType(name,defaults);
  return {name,type,withEvents:/^WithEvents\b/i.test(original),array,rank,signature:original,optional:/^Optional\b/i.test(original),paramArray:/\bParamArray\b/i.test(original),byRef:!/^\s*(?:Optional\s+)?ByVal\b/i.test(original),insertText:m[1],...(original.includes('=')?{defaultValue:original.slice(original.indexOf('=')+1).trim()}:{}),fixedLength:tail.match(/\bAs\s+String\s*\*\s*(\d+)/i)?.[1]};
}

/** Recovers declarations from incomplete procedure bodies without compiling
 * or running them. Retains physical offsets for projected/split code panes. */
function closingParen(text,open){
  if(open<0)return -1;let depth=0,bracket=false;
  for(let i=open;i<text.length;i++){const c=text[i];if(c==='[')bracket=true;else if(c===']')bracket=false;if(bracket)continue;if(c==='(')depth++;else if(c===')'&&!--depth)return i;}
  return -1;
}
export function scanDeclarations(module) {
  const original=String(module.code||'');let source=original,conditionalError=null;
  if (/^\s*#(?:If|Const)\b/im.test(source)) {
    try {
      const enabled=preprocess(source,module.conditionalConstants||{},module.name).split('\n');
      source=source.split('\n').map((line,i)=>enabled[i]?.trim()?line:line.replace(/[^\r]/g,' ')).join('\n');
    } catch(error) { conditionalError=error.message; }
  }
  const lexical=sourceStatements(source),{statements,lineCount}=lexical;
  const symbols=[],procedures=[],records=[],withBlocks=[],selectBlocks=[],labels=[],interfaces=[],redimCandidates=[],defaults={};
  let owner=null,record=null,withStack=[],selectStack=[];
  const variable=(text,statement,kind,scope='private',parent=owner)=>{
    const value=parameterSymbol(text,defaults);if(!value)return null;
    return {...value,kind,scope,moduleId:module.id,line:statement.line,offset:statement.start,owner:parent?.name||null,ownerId:parent?.id||null};
  };
  const endOwner=(line,offset)=>{
    if(owner){owner.end=line;owner.endOffset=offset;}
    for(const block of withStack){block.endLine=line;block.end=offset;}
    withStack=[];for(const block of selectStack){block.endLine=line;block.end=offset;}selectStack=[];owner=null;
  };
  for(const statement of statements) {
    let {text,clean,line,start,end}=statement;
    clean=clean.replace(/^\s*\d+\s+/,'');text=text.slice(text.length-clean.length);
    const numbered=statement.text.match(/^\s*(\d+)\s+/);
    const label=statement.clean.match(new RegExp('^\\s*('+IDENTIFIER+'|\\d+)\\s*$','i'));
    if(owner&&((label&&source[end]===':')||numbered))labels.push({name:label?.[1]||numbered[1],kind:'label',line,offset:start,moduleId:module.id,owner:owner.name,ownerId:owner.id});
    const impl=clean.match(new RegExp('^\\s*Implements\\s+('+TYPE_NAME+')','i'));
    if(impl&&!owner){interfaces.push(impl[1].replace(/\s+/g,''));continue;}
    const def=clean.trim().match(/^Def(?:Bool|Byte|Int|Lng|Cur|Sng|Dbl|Date|Str|Obj|Var)\b/i);
    if(def&&!owner){try{addDefaultTypes(defaults,clean.trim());}catch{}continue;}
    const head=clean.match(new RegExp('^\\s*((?:(?:Public|Private|Friend|Global|Static)\\s+)*)(?:(Declare)\\s+)?(Sub|Function|Property\\s+(?:Get|Let|Set)|Event)\\s+('+IDENTIFIER+')','i'));
    if(head) {
      endOwner(Math.max(1,line-1),start);
      const scope=/\bPrivate\b/i.test(head[1])?'private':/\bFriend\b/i.test(head[1])?'friend':'public';
      const kind=head[3].toLowerCase(),name=head[4].replace(/^\[|\]$/g,''),open=clean.indexOf('(',head[0].length),close=closingParen(clean,open);
      const params=open<0?[]:splitArguments(text.slice(open+1,close>open?close:undefined));
      const tail=close>open&&open>=0?clean.slice(close+1):clean.slice(head[0].length);
      const type=tail.match(new RegExp('^\\s*As\\s+('+TYPE_NAME+')','i'))?.[1]?.replace(/\s*\.\s*/g,'.')||(kind==='sub'||kind==='event'?'Void':defaultIdentifierType(name,defaults));
      const proc={name,insertText:head[4],kind,line,end:lineCount,offset:start,endOffset:source.length,id:start+':'+kind,owner:null,moduleId:module.id,scope,type,array:/\)\s*$/.test(tail)&&/As\s+/i.test(tail),signature:text.trim(),params,parameters:params.map(p=>parameterSymbol(p,defaults)).filter(Boolean),external:!!head[2],accessor:kind.startsWith('property ')?kind.split(' ')[1]:null};
      if(proc.accessor&&proc.accessor!=='get')proc.type=proc.parameters.at(-1)?.type||'Variant';
      symbols.push(proc);
      if(kind==='event'||head[2]){proc.end=line;proc.endOffset=end;continue;}
      owner=proc;procedures.push(proc);
      for(const p of params){const v=variable(p,statement,'parameter','private');if(v)symbols.push(v);}
      continue;
    }
    if(/^\s*End\s+(Sub|Function|Property)\b/i.test(clean)){endOwner(line,end);continue;}
    const rec=clean.match(new RegExp('^\\s*(?:(Public|Private)\\s+)?(Type|Enum)\\s+('+IDENTIFIER+')','i'));
    if(rec){record={name:rec[3].replace(/^\[|\]$/g,''),insertText:rec[3],kind:rec[2].toLowerCase(),scope:(rec[1]||'public').toLowerCase(),line,offset:start,moduleId:module.id,members:[]};record.type=record.name;records.push(record);symbols.push(record);continue;}
    if(/^\s*End\s+(Type|Enum)\b/i.test(clean)){record=null;continue;}
    if(record){const value=variable(text,statement,record.kind==='enum'?'constant':'field',record.scope,null);if(value){value.parentType=record.name;value.signature=record.name+'.'+text.trim();if(record.kind==='enum'){value.type=record.name;symbols.push(value);}record.members.push(value);}continue;}
    const selectMatch=clean.match(/^\s*Select\s+Case\s+/i);
    if(selectMatch&&owner){const block={expression:text.slice(selectMatch[0].length).trim(),line,start:end,end:source.length,endLine:lineCount,ownerId:owner.id};selectBlocks.push(block);selectStack.push(block);continue;}
    if(/^\s*End\s+Select\b/i.test(clean)){const block=selectStack.pop();if(block){block.end=start;block.endLine=line;}continue;}
    const withMatch=clean.match(/^\s*With\s+/i);
    if(withMatch&&owner){const block={expression:text.slice(withMatch[0].length).trim(),line,start:end,end:source.length,endLine:lineCount,ownerId:owner.id,parent:withStack.at(-1)||null};withBlocks.push(block);withStack.push(block);continue;}
    if(/^\s*End\s+With\b/i.test(clean)){const block=withStack.pop();if(block){block.end=start;block.endLine=line;}continue;}
    const redim=clean.match(/^\s*ReDim\s+(?:Preserve\s+)?/i);
    if(redim&&owner){
      for(const part of splitArguments(text.slice(redim[0].length))){
        const candidate=variable(part,statement,'variable');
        if(candidate?.array)redimCandidates.push({...candidate,implicitRedim:true});
      }
      continue;
    }
    const decl=clean.match(/^\s*(Dim|Private|Public|Global|Friend|Static|Const)\s+(?:(Const)\s+)?/i);
    if(decl){const scope=/^(Public|Global|Friend)$/i.test(decl[1])?(decl[1].toLowerCase()==='friend'?'friend':'public'):'private';for(const p of splitArguments(text.slice(decl[0].length))){const v=variable(p,statement,decl[2]||/^Const$/i.test(decl[1])?'constant':'variable',scope);if(v)symbols.push(v);}}
  }
  // Imported .cls/.frm member attributes live outside the editable code buffer.
  for(const raw of [...(module.attributes||[]),...original.split('\n').filter(l=>/^\s*Attribute\b/i.test(l))]) {
    const m=raw.match(new RegExp('^\\s*Attribute\\s+('+IDENTIFIER+')\\.(VB_Description|VB_UserMemId|VB_MemberFlags)\\s*=\\s*(.*)$','i'));if(!m)continue;
    for(const s of symbols.filter(s=>!s.owner&&symbolKey(s.name)===symbolKey(m[1]))){
      if(/Description$/i.test(m[2]))s.description=m[3].replace(/^"|"$/g,'').replace(/""/g,'"');
      else if(/UserMemId$/i.test(m[2]))s.defaultMember=Number(m[3])===0;
      else {const bits=parseInt(m[3].replace(/"/g,''),16)||0;s.hidden=!!(bits&64);s.restricted=!!(bits&1);}
    }
  }
  for(const control of module.form?.controls||[])symbols.push({name:control.name,type:control.type,kind:'control',scope:'public',line:1,moduleId:module.id,array:control.properties?.Index!==undefined,controlArray:control.properties?.Index!==undefined,signature:control.name+' As '+control.type});
  const menus=[...(module.form?.menus||[])];while(menus.length){const menu=menus.shift();if(menu.name)symbols.push({name:menu.name,type:'Menu',kind:'control',scope:'public',moduleId:module.id,line:1});menus.push(...(menu.items||menu.children||[]));}
  // Bind explicit names first, even when declared after the resize. Sets keep
  // large generated modules linear rather than rescanning symbols per ReDim.
  const globals=new Set(),locals=new Map();
  for(const symbol of symbols){
    const key=symbolKey(symbol.name);
    if(!symbol.owner)globals.add(key);
    else{if(!locals.has(symbol.ownerId))locals.set(symbol.ownerId,new Set());locals.get(symbol.ownerId).add(key);}
  }
  for(const candidate of redimCandidates){
    const key=symbolKey(candidate.name),local=locals.get(candidate.ownerId)||new Set();
    if(globals.has(key)||local.has(key))continue;
    symbols.push(candidate);local.add(key);locals.set(candidate.ownerId,local);
  }
  return {moduleId:module.id,name:module.name,symbols,procedures,records,withBlocks,selectBlocks,labels,interfaces,defaults,conditionalError,masked:lexical.masked,statements,privateModule:/^\s*Option\s+Private\s+Module\b/im.test(source),predeclared:!!module.form||/VB_PredeclaredId\s*=\s*True/i.test((module.attributes||[]).join('\n'))};
}
