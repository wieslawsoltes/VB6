import {PASCAL_KEYWORDS} from './lexer.js';
import {preprocessPascalTokens} from './preprocessor.js';

const key=value=>String(value??'').toLowerCase();
const routines=new Set(['procedure','function','constructor','destructor']);
const modifiers=new Set(['forward','external','far','near','assembler','interrupt','virtual','inline']);

/** Recover source declarations without requiring a complete executable body.
 * The compiler's lossless tokens supply every UTF-16 location. Structured type
 * declarations have their own nesting, so member semicolons cannot accidentally
 * turn object method headers into top-level procedure implementations.
 */
export function scanPascalIndex(module,scanned,masked){
  const source=String(module.code||''),symbols=[],procedures=[],records=[],withBlocks=[],selectBlocks=[],labels=[],uses=[],exported=new Set(),lineCount=source.split('\n').length;
  let tokens=scanned,conditionalError=null,unitInterface=false,bodyStart=source.length;
  try{tokens=preprocessPascalTokens(scanned,{sourceName:module.name,conditionalConstants:module.conditionalConstants||{}});}catch(error){conditionalError=error.message;}
  if(tokens!==scanned){const active=new Set(tokens.map(token=>token.start)),characters=masked.split('');for(const token of scanned)if(!active.has(token.start))for(let i=token.start;i<token.end;i++)if(!/[\r\n]/.test(characters[i]))characters[i]=' ';masked=characters.join('');}
  const t=i=>tokens[Math.max(0,Math.min(i,tokens.length-1))],word=i=>key(t(i)?.value),is=(i,value)=>word(i)===value,eof=i=>i>=tokens.length||t(i)?.type==='eof';
  const unit=word(0)==='unit',visibility=parent=>parent?'private':!unit||unitInterface?'public':'private';
  const symbol=(token,extra={},parent=null)=>({name:token.value,insertText:token.value,line:token.line,offset:token.start,nameStart:token.start,nameEnd:token.end,moduleId:module.id,scope:visibility(parent),owner:parent?.name||null,ownerId:parent?.id||null,...extra});
  const findToken=(start,end,value)=>{for(let i=start;i<end;i++)if(is(i,value))return i;return -1;};
  function endStatement(start,{structured=false,stopAtEnd=false}={}){
    let depth=0,types=0;
    for(let i=start;!eof(i);i++){
      const value=word(i);
      if(['(','['].includes(value))depth++;
      else if([')',']'].includes(value)){if(depth>0)depth--;else if(stopAtEnd)return i;}
      else if(structured&&['record','object'].includes(value))types++;
      else if(value==='end'){if(types>0)types--;else if(stopAtEnd)return i;}
      if(value===';'&&depth===0&&types===0)return i;
    }
    return tokens.length-1;
  }
  function names(start,end){return tokens.slice(start,end).filter(token=>token.type==='id'&&!PASCAL_KEYWORDS.has(key(token.value)));}
  function split(start,end,separator){
    const groups=[];let last=start,depth=0;
    for(let i=start;i<end;i++){if(['(','['].includes(word(i)))depth++;else if([')',']'].includes(word(i)))depth--;else if(!depth&&is(i,separator)){groups.push([last,i]);last=i+1;}}
    groups.push([last,end]);return groups;
  }
  function typeInfo(start,end){
    let first=start;if(is(first,'packed'))first++;
    const raw=source.slice(t(first).start,t(end).start).trim();
    if(is(first,'array')){
      let depth=0,of=-1,rank=1;
      for(let i=first+1;i<end;i++){if(is(i,'['))depth++;else if(is(i,']'))depth--;else if(is(i,',')&&depth===1)rank++;else if(is(i,'of')&&!depth){of=i;break;}}
      return {type:of<0?'Variant':typeInfo(of+1,end).type,array:true,rank,declaredType:raw};
    }
    if(is(first,'^'))return {type:raw,pointer:true,target:source.slice(t(first+1).start,t(end).start).trim()};
    if(is(first,'string'))return {type:'String',capacity:source.slice(t(first).end,t(end).start).match(/\[\s*(\d+)\s*\]/)?.[1],declaredType:raw};
    return {type:raw||'Variant',array:false,rank:0};
  }
  function parameters(start,end){
    const values=[];
    for(let [first,last] of split(start,end,';')){
      const mode=['var','const'].includes(word(first))?word(first++):'',colon=findToken(first,last,':');
      const nameEnd=colon<0?last:colon,info=colon<0?{type:'Variant',untyped:true}:typeInfo(colon+1,last);
      for(const name of names(first,nameEnd))values.push({...symbol(name),...info,kind:'parameter',scope:'private',byRef:mode==='var',constant:mode==='const',optional:false,paramArray:false,signature:(mode?mode+' ':'')+name.value+': '+(info.declaredType||info.type)});
    }
    return values;
  }
  function routineHeader(start,parent=null,record=null){
    let cursor=start+1;if(t(cursor).type!=='id')return null;
    const nameTokens=[t(cursor++)];while(is(cursor,'.')&&t(cursor+1).type==='id'){nameTokens.push(t(cursor+1));cursor+=2;}
    const name=nameTokens.map(token=>token.value).join('.'),lastName=nameTokens.at(-1),end=endStatement(cursor),open=is(cursor,'(')?cursor:-1;
    let close=open;
    if(open>=0){let depth=0;for(;close<end;close++){if(is(close,'('))depth++;else if(is(close,')')&&!--depth)break;}}
    const params=open<0?[]:parameters(open+1,close),tail=open<0?cursor:close+1,result=is(start,'constructor')?'Boolean':is(start,'function')&&is(tail,':')?typeInfo(tail+1,end).type:is(start,'function')?'Variant':'Void';
    const parentType=record?.name||(nameTokens.length>1?nameTokens.slice(0,-1).map(token=>token.value).join('.'):null);
    const proc=symbol(lastName,{name,insertText:name,kind:result==='Void'?'sub':'function',routineKind:word(start),type:result,id:t(start).start+':'+word(start),line:t(start).line,offset:t(start).start,end:lineCount,endOffset:source.length,headerEnd:t(end).end,signature:source.slice(t(start).start,t(end).end).trim(),parameters:params,params:params.map(parameter=>(parameter.byRef?'ByRef ':'ByVal ')+parameter.name+' As '+parameter.type),accessor:null,...(parentType?{parentType,bindingName:lastName.value,qualifiedName:record?record.name+'.'+lastName.value:name}:{})},parent);
    cursor=end+1;
    while(modifiers.has(word(cursor))){if(is(cursor,'virtual'))proc.virtual=true;if(is(cursor,'forward')||is(cursor,'external'))proc.external=true;cursor=endStatement(cursor)+1;}
    return {proc,next:cursor};
  }
  function structure(record,start,end){
    let cursor=start+1,scope='public';
    if(is(start,'object')&&is(cursor,'(')){let close=cursor+1;while(close<end&&!is(close,')'))close++;record.ancestor=source.slice(t(cursor+1).start,t(close).start).trim();cursor=close+1;}
    while(cursor<end&&!is(cursor,'end')&&!eof(cursor)){
      if(['private','public'].includes(word(cursor))){scope=word(cursor++);continue;}
      if(routines.has(word(cursor))){const header=routineHeader(cursor,null,record);if(!header){cursor++;continue;}const member={...header.proc,name:header.proc.bindingName,insertText:header.proc.bindingName,scope,end:t(header.next-1).endLine,endOffset:t(header.next-1).end};record.members.push(member);cursor=header.next;continue;}
      const last=endStatement(cursor,{structured:true,stopAtEnd:true}),colon=findToken(cursor,last,':');
      if(colon<0){cursor=Math.max(cursor+1,last+(is(last,';')?1:0));continue;}
      const info=typeInfo(colon+1,last);
      for(const name of names(cursor,colon))record.members.push(symbol(name,{...info,kind:'field',scope,parentType:record.name,signature:record.name+'.'+name.value+': '+(info.declaredType||info.type)}));
      cursor=Math.max(cursor+1,last+(is(last,';')?1:0));
    }
  }
  function declarationSection(start,section,parent){
    let cursor=start+1;
    while(!eof(cursor)&&t(cursor).type==='id'&&!PASCAL_KEYWORDS.has(word(cursor))){
      const end=endStatement(cursor,{structured:section==='type'||section==='var',stopAtEnd:true});
      let separator=-1;for(let i=cursor;i<end;i++)if(is(i,section==='var'?':':'=')){separator=i;break;}
      if(separator<0)return cursor;
      const colon=section==='const'?findToken(cursor,separator,':'):-1;
      const nameTokens=section==='var'?names(cursor,separator):[t(cursor)],value=source.slice(t(separator).end,t(end).start).trim(),declared=section==='var'?typeInfo(separator+1,end):colon>=0?typeInfo(colon+1,separator):null;
      for(const name of nameTokens){
        const item=symbol(name,{kind:section==='const'&&colon<0?'constant':section==='type'?'type':'variable',...(declared||{type:section==='type'?name.value:/^'/.test(value)?'String':/^(true|false)$/i.test(value)?'Boolean':'Integer'}),signature:source.slice(t(cursor).start,t(end).end),end:t(end).endLine,endOffset:t(end).end,...(section==='const'?{defaultValue:value,typedConstant:colon>=0}:{})},parent);
        symbols.push(item);if(unitInterface)exported.add(key(name.value));
        if(section==='type'){
          let first=separator+1;if(is(first,'packed'))first++;
          const record={...item,members:[],language:'pascal'};Object.assign(item,record);item.members=record.members;records.push(item);
          if(['record','object'].includes(word(first))){item.isPascalObject=is(first,'object');structure(item,first,end);}
          else if(is(first,'(')){
            item.kind='enum';for(const member of names(first+1,end-1)){const value=symbol(member,{kind:'constant',type:name.value,parentType:name.value,signature:name.value+'.'+member.value,scope:item.scope},parent);item.members.push(value);symbols.push(value);}
          }else if(is(first,'^')){item.kind='pointer';item.target=source.slice(t(first+1).start,t(end).start).trim();}
          else if(is(first,'array')){const info=typeInfo(first,end);item.kind='array';item.target=info.type;item.rank=info.rank;}
          else if(/^[A-Za-z_]\w*(?:\s*\.\s*[A-Za-z_]\w*)*$/.test(value)){item.kind='alias';item.target=value.replace(/\s+/g,'');}
        }
      }
      cursor=end+(is(end,';')?1:0);if(cursor===end&&!is(end,';'))return cursor;
    }
    return cursor;
  }
  function blockEnd(start){
    let depth=0;
    for(let i=start;!eof(i);i++){
      const value=word(i);if(['begin','case','asm','repeat'].includes(value))depth++;else if(['end','until'].includes(value))depth--;
      if(depth===0)return value==='until'?endStatement(i,{stopAtEnd:true})+1:i+1;
    }
    return tokens.length-1;
  }
  function statementAfter(start,depth=0){
    if(depth>64||eof(start))return start;
    if(['begin','case','asm','repeat'].includes(word(start)))return blockEnd(start);
    if(['if','for','while','with'].includes(word(start))){
      const separator=is(start,'if')?'then':'do';let level=0,cursor=start+1;
      for(;!eof(cursor);cursor++){if(['(','['].includes(word(cursor)))level++;else if([')',']'].includes(word(cursor)))level--;else if(!level&&is(cursor,separator))break;else if(!level&&[';','end'].includes(word(cursor)))return cursor;}
      let end=statementAfter(cursor+1,depth+1);if(is(start,'if')&&is(end,'else'))end=statementAfter(end+1,depth+1);return end;
    }
    let level=0;for(let i=start;!eof(i);i++){if(['(','['].includes(word(i)))level++;else if([')',']'].includes(word(i)))level--;if(!level&&[';','end','until','else'].includes(word(i)))return i;}
    return tokens.length-1;
  }
  function body(start,parent){
    const end=blockEnd(start);
    for(let i=start;i<end;i++){
      if(is(i,'with')){
        let cursor=i+1,level=0;for(;cursor<end;cursor++){if(['(','['].includes(word(cursor)))level++;else if([')',']'].includes(word(cursor)))level--;else if(!level&&is(cursor,'do'))break;}
        const after=statementAfter(cursor+1),stop=t(Math.max(cursor+1,after-1));
        let ancestor=withBlocks.findLast(block=>t(i).start>=block.start&&t(i).start<block.end)||null;
        for(const [first,last]of split(i+1,cursor,',')){const block={expression:source.slice(t(first).start,t(last).start).trim(),line:t(i).line,start:t(cursor).end,end:stop.end,endLine:stop.endLine,ownerId:parent?.id||null,parent:ancestor};withBlocks.push(block);ancestor=block;}
      }
      if(is(i,'case')){let cursor=i+1;while(cursor<end&&!is(cursor,'of'))cursor++;const after=blockEnd(i);selectBlocks.push({expression:source.slice(t(i+1).start,t(cursor).start).trim(),line:t(i).line,start:t(cursor).end,end:t(after-1).end,endLine:t(after-1).endLine,ownerId:parent?.id||null});}
      if(parent&&t(i).type==='id'&&is(i+1,':')&&!PASCAL_KEYWORDS.has(word(i)))labels.push(symbol(t(i),{kind:'label'},parent));
    }
    return is(end,';')?end+1:end;
  }
  function procedure(start,parent=null){
    const header=routineHeader(start,parent);if(!header)return start+1;
    let {proc,next:cursor}=header;
    const member=proc.parentType?records.find(record=>key(record.name)===key(proc.parentType))?.members.find(member=>key(member.name)===key(proc.bindingName)):null;
    if(member){proc.scope=member.scope;proc.virtual=member.virtual;member.id=proc.id;member.implementation=proc;if(!proc.parameters.length&&member.parameters.length){proc.parameters=member.parameters;proc.params=member.params;proc.type=member.type;}member.qualifiedName=proc.name;}
    if(unitInterface){exported.add(key(proc.name));proc.scope='public';symbols.push(proc);return cursor;}
    if(exported.has(key(proc.name)))proc.scope='public';
    if(proc.external){symbols.push(proc);return cursor;}
    const previous=symbols.findIndex(item=>item.ownerId===proc.ownerId&&item.kind===proc.kind&&key(item.name)===key(proc.name));if(previous>=0)symbols.splice(previous,1);
    symbols.push(proc);procedures.push(proc);
    for(const parameter of proc.parameters)symbols.push({...parameter,moduleId:module.id,owner:proc.name,ownerId:proc.id});
    while(!eof(cursor)&&!['begin','asm','end','implementation'].includes(word(cursor))){
      if(routines.has(word(cursor)))cursor=procedure(cursor,proc);
      else if(['var','const','type'].includes(word(cursor)))cursor=declarationSection(cursor,word(cursor),proc);
      else cursor++;
    }
    if(['begin','asm'].includes(word(cursor))){proc.bodyStart=t(cursor).start;cursor=body(cursor,proc);const last=t(cursor-1);proc.end=last.endLine;proc.endOffset=last.end;}
    return cursor;
  }
  for(let cursor=0;!eof(cursor);){
    const value=word(cursor);
    if(value==='interface'){unitInterface=true;cursor++;}
    else if(value==='implementation'){unitInterface=false;cursor++;}
    else if(routines.has(value))cursor=procedure(cursor);
    else if(['var','const','type'].includes(value))cursor=declarationSection(cursor,value,null);
    else if(value==='uses'){const end=endStatement(cursor);for(const [first,last]of split(cursor+1,end,',')){const parts=[];for(let i=first;i<last&& !is(i,'in');i++)parts.push(t(i).value);uses.push(parts.join(''));}cursor=end+1;}
    else if(value==='begin'){bodyStart=t(cursor).start;cursor=body(cursor,null);}
    else if(value==='end'&&is(cursor+1,'.')){bodyStart=Math.min(bodyStart,t(cursor).start);cursor++;}
    else cursor++;
  }
  const controls=[...(module.form?.controls||[])];while(controls.length){const control=controls.shift();if(control.name)symbols.push({name:control.name,type:control.type,kind:'control',scope:'public',moduleId:module.id,line:1,owner:null,array:control.properties?.Index!==undefined,controlArray:control.properties?.Index!==undefined,signature:control.name+': '+control.type});controls.push(...(control.controls||[]));}
  const menus=[...(module.form?.menus||[])];while(menus.length){const menu=menus.shift();if(menu.name)symbols.push({name:menu.name,type:'Menu',kind:'control',scope:'public',moduleId:module.id,line:1,owner:null});menus.push(...(menu.items||menu.children||[]));}
  const maskedLines=masked.split('\n'),statements=[];let offset=0;for(const [index,line]of source.split('\n').entries()){statements.push({text:line,clean:maskedLines[index],line:index+1,endLine:index+1,start:offset,end:offset+line.length});offset+=line.length+1;}
  return {moduleId:module.id,name:module.name,language:'pascal',symbols,procedures:procedures.sort((a,b)=>a.offset-b.offset),records,withBlocks,selectBlocks,labels,interfaces:[],uses,defaults:{},conditionalError,masked,statements,privateModule:false,predeclared:!!module.form,bodyStart};
}
