import {displayParameter} from './signature-syntax.js';
import {normalizeTypeLibrary,referenceSnapshot} from './reference-metadata.js';
import {typeCompletionContext,typeCandidates} from './type-completion.js';
import {parseExpression} from '../language/expression.js';
import {KEYWORDS} from './language-service.js';
import {IDENTIFIER,TYPE_NAME,symbolKey,maskSource,splitArguments,statementBefore,expressionBefore,completionSpan,wordAt,completionKey,completionMatches,mapParameterType} from './source-context.js';
import {scanDeclarations,parameterSymbol} from './declaration-index.js';
import {PRIMITIVE_TYPES,CONSTANT_SYMBOLS,BUILTIN_SYMBOLS,GLOBAL_OBJECTS,TYPE_CATALOG,ENUM_TYPES,builtinType,member,runtimeType,builtinGroup} from './type-catalog.js';
export {maskSource,splitArguments,wordAt,scanDeclarations};

const eq=(a,b)=>symbolKey(a)===symbolKey(b);
const visible=s=>!s.hidden&&!s.restricted;
const find=(items,name)=>items.find(s=>String(s.name).toLowerCase()===String(name).toLowerCase())||items.find(s=>eq(s.name,name));
function coalesce(items) {
  const groups=new Map();
  for(const s of items){const key=symbolKey(s.name),old=groups.get(key);if(!old)groups.set(key,s);else if(s.accessor==='get'&&old.accessor!=='get')groups.set(key,s);}
  return [...groups.values()].map(s=>{
    if(!s.accessor)return s;
    const params=s.accessor==='get'?s.params:s.params.slice(0,-1);
    return {...s,kind:'property',accessors:items.filter(m=>eq(m.name,s.name)&&m.accessor),params,parameters:s.parameters?.slice(0,params.length)||params.map(p=>parameterSymbol(p)).filter(Boolean)};
  });
}

/** Nested and statement-form call contexts; named/omitted arguments retain
 * their source position. Parenthesized grouping is not mistaken for a call. */
export function callContext(text,offset,{outer=false}={}) {
  const st=statementBefore(text,offset),masked=st.masked;
  if(st.state==='comment'||masked.length>65536||/^\s*(?:(?:Public|Private|Friend|Static)\s+)*(?:Declare\s+)?(?:Sub|Function|Property|Event|Type|Enum)\b/i.test(masked))return null;
  const stack=[];
  const head=masked.match(new RegExp('^\\s*(?:(?:Call|RaiseEvent)\\s+)?(\\.?'+IDENTIFIER+')','i'));
  if(head){
    let end=head[0].length,nameStart=end-head[1].length;
    // Consume complete index/call groups only when they qualify a following
    // member; an incomplete argument group is handled by the stack below.
    while(end<masked.length){
      const dot=masked.slice(end).match(new RegExp('^\\s*\\.\\s*'+IDENTIFIER,'i'));
      if(dot){end+=dot[0].length;continue;}
      let i=end;while(/[ \t]/.test(masked[i]||'!'))i++;
      if(masked[i]!=='(')break;
      let depth=1,j=i+1,bracket=false;
      for(;j<masked.length&&depth;j++){const c=masked[j];if(c==='[')bracket=true;else if(c===']')bracket=false;if(bracket)continue;if(c==='(')depth++;else if(c===')')depth--;}
      if(depth||!/^\s*\./.test(masked.slice(j)))break;end=j;
    }
    const name=st.text.slice(nameStart,end).trim(),tail=masked.slice(end);
    if(/^[ \t]+/.test(tail)&&!/^\s*[=(]/.test(tail)&&(!KEYWORDS.some(k=>eq(k,name))||BUILTIN_SYMBOLS.some(s=>eq(s.name,name)))){
      const argumentStart=end+tail.match(/^[ \t]+/)[0].length;
      stack.push({name,start:st.start+argumentStart,comma:0,last:argumentStart,argumentStart,statement:true});
    }
  }
  let bracket=false;
  for(let i=0;i<masked.length;i++){
    const c=masked[i];if(c==='[')bracket=true;else if(c===']')bracket=false;if(bracket)continue;
    if(c==='('){
      if(stack.length>=64)return null;
      const name=expressionBefore(st.text,i).text;
      stack.push({name:/^[\w\u0080-\uffff[.(]/.test(name)&&!KEYWORDS.some(k=>eq(k,name)&&!BUILTIN_SYMBOLS.some(s=>eq(s.name,name)))?name:'',start:st.start+i+1,comma:0,last:i+1,argumentStart:i+1});
    }else if(c===')'){if(stack.length&&!stack.at(-1).statement)stack.pop();}
    else if(c===','&&stack.length){stack.at(-1).comma++;stack.at(-1).last=i+1;}
  }
  const calls=stack.filter(c=>c.name),found=outer?calls[0]:calls.at(-1);if(!found)return null;
  const last=masked.slice(found.last).replace(/_\s*\r?\n/g,' '),argumentName=last.match(new RegExp('^\\s*('+IDENTIFIER+')\\s*:=','i'))?.[1]||null;
  return {...found,named:argumentName,args:splitArguments(st.text.slice(found.argumentStart),true),last:st.start+found.last};
}

/** Standalone, synchronous, side-effect-free language service. The only mutable
 * state is bounded declaration/AST metadata caches, not a live VB runtime. */
export class EditorIntelligence {
  constructor(){this.cache=new Map();this.scanCount=0;this.expressionCache=new Map();this.libraries=new Map();this.libraryRevision=0;}
  index(module,project=null){
    const condition=project?.settings?.conditionalConstants||module.conditionalConstants||{},conditionalKey=JSON.stringify(condition);
    const formKey=JSON.stringify([module.form?.controls?.map(c=>[c.name,c.type,c.properties?.Index]),module.form?.menus,module.attributes]);
    const cached=this.cache.get(module.id);
    if(cached&&cached.code===module.code&&cached.name===module.name&&cached.kind===module.kind&&cached.formKey===formKey&&cached.conditionalKey===conditionalKey)return cached.index;
    const index=scanDeclarations({...module,conditionalConstants:condition});this.scanCount++;
    this.cache.set(module.id,{code:module.code,name:module.name,kind:module.kind,formKey,conditionalKey,index});return index;
  }
  prune(project){const ids=new Set(project.modules.map(m=>m.id));for(const id of this.cache.keys())if(!ids.has(id))this.cache.delete(id);}
  scope(project,module,line,offset=null){
    this.prune(project);const idx=this.index(module,project),proc=idx.procedures.find(p=>offset===null?line>=p.line&&line<=p.end:offset>=p.offset&&offset<=p.endOffset);
    let local=idx.symbols.filter(s=>s.ownerId&&s.ownerId===proc?.id);
    if(local.some(s=>s.implicitRedim)){
      const shared=new Set();
      for(const other of project.modules){
        if(other.id===module.id||other.kind!=='module')continue;
        for(const symbol of this.index(other,project).symbols)if(!symbol.owner&&symbol.scope!=='private')shared.add(symbolKey(symbol.name));
      }
      local=local.filter(s=>!s.implicitRedim||!shared.has(symbolKey(s.name)));
    }
    const global=idx.symbols.filter(s=>!s.owner);
    return {idx,proc,symbols:[...local,...coalesce(global)]};
  }
  /** Explicit portable type-library descriptors. No registry lookup, fetching,
   * getters, method invocation or native library loading is performed. */
  registerTypeLibrary(name,types){
    const normalized=normalizeTypeLibrary(name,types),key=symbolKey(name);
    this.libraries.set(key,normalized);this.libraryRevision++;
    // A disposer from an older registration must not remove its replacement.
    return ()=>this.libraries.get(key)===normalized&&this.unregisterTypeLibrary(name);
  }
  unregisterTypeLibrary(name){const changed=this.libraries.delete(symbolKey(name));if(changed)this.libraryRevision++;return changed;}
  referenceTypes(project){
    // Projects can persist the same JSON descriptor beside their native
    // reference identity. Check serialized contents to observe in-place edits.
    const {descriptors,key}=referenceSnapshot(project);
    if(key!==this.referenceKey){const service=new EditorIntelligence();for(const d of descriptors)try{service.registerTypeLibrary(d.name,d.types);}catch{}this.referenceCache=[...service.libraries.values()].flat();this.referenceKey=key;}
    return [...this.libraries.values()].flat().concat(this.referenceCache||[]);
  }
  type(project,module,type,seen=new Set()){
    if(seen.has(symbolKey(type))||seen.size>=32)return null;seen.add(symbolKey(type));
    type=String(type||'Variant').replace(/\s*\.\s*/g,'.').trim().replace(/\[([^\]]+)\]/g,'$1');
    if(project.name&&type.toLowerCase().startsWith(project.name.toLowerCase()+'.'))type=type.slice(project.name.length+1);
    const target=eq(module.name,type)?module:project.modules.find(m=>eq(m.name,type));
    if(target)return {name:target.name,type:target.name,kind:target.kind,moduleId:target.id,members:coalesce(this.index(target,project).symbols.filter(s=>!s.owner&&(target.id===module.id||s.scope!=='private'))).concat(target.form?builtinType(target.form.type||'Form')?.members||[]:[])};
    const pieces=type.split('.'),qualifier=pieces.length>1?pieces.slice(0,-1).join('.'):null,recordName=pieces.at(-1);
    for(const m of [module,...project.modules.filter(m=>m.id!==module.id)]){
      if(qualifier&&!eq(m.name,qualifier))continue;
      const record=this.index(m,project).records.find(r=>eq(r.name,recordName)&&(m.id===module.id||r.scope!=='private'));
      if(record)return record;
    }
    const references=this.referenceTypes(project),ref=references.find(t=>eq(t.name,type)||(t.aliases||[]).some(a=>eq(a,type)))||references.find(t=>eq(t.name.split('.').at(-1),type));
    return ref?.kind==='alias'?this.type(project,module,ref.target,seen):(ref?{...ref,members:coalesce(ref.members)}:null)||runtimeType(project,type)||builtinType(type);
  }
  declared(project,module,symbol){
    if(!symbol?.moduleId)return symbol;
    const owner=symbol.moduleId===module.id?module:project.modules.find(m=>m.id===symbol.moduleId);
    if(!owner)return symbol;
    const qualify=type=>this.index(owner,project).records.some(r=>eq(r.name,type))?owner.name+'.'+type:type;
    const params=symbol.params?.map(p=>mapParameterType(p,qualify));
    const parameters=params?.map((text,i)=>{
      const value=symbol.parameters?.[i]||parameterSymbol(text,this.index(owner,project).defaults);
      return value?{...value,type:qualify(value.type),signature:text}:null;
    }).filter(Boolean);
    return {...symbol,type:qualify(symbol.type),...(params?{params,parameters}:{})};
  }
  referenceGlobals(project){
    return this.referenceTypes(project).filter(t=>visible(t)&&(t.kind==='enum'||t.kind==='module'||t.global)).flatMap(t=>t.members.filter(visible));
  }
  members(project,module,type){return (this.type(project,module,type)?.members||[]).filter(visible);}
  objectMembers(project,module,symbol){
    if(!symbol)return [];
    if(symbol.namespace){
      if(eq(symbol.namespace,project.name))return project.modules.map(m=>({name:m.name,type:m.name,kind:m.kind==='class'&&!this.index(m,project).predeclared?'class':'module',moduleId:m.id,line:1}));
      if(eq(symbol.namespace,'VBA'))return [...BUILTIN_SYMBOLS,...CONSTANT_SYMBOLS,...PRIMITIVE_TYPES.map(name=>({name,type:name,kind:'type'})),...new Set(BUILTIN_SYMBOLS.map(s=>builtinGroup(s.name)))].map(s=>typeof s==='string'?{name:s,namespace:'VBA.'+s,kind:'module'}:s);
      if(symbol.namespace.startsWith('VBA.'))return BUILTIN_SYMBOLS.filter(s=>eq('VBA.'+builtinGroup(s.name),symbol.namespace));
      const types=[...TYPE_CATALOG.values(),...ENUM_TYPES.values(),...this.referenceTypes(project)];
      const matching=types.filter(t=>visible(t)&&(t.name.toLowerCase().startsWith(symbol.namespace.toLowerCase()+'.')||eq(symbol.namespace,'VB')&&(t.aliases||[]).some(a=>a.startsWith('VB.'))));
      return matching.flatMap(t=>{
        const relative=t.name.toLowerCase().startsWith(symbol.namespace.toLowerCase()+'.')?t.name.slice(symbol.namespace.length+1):t.name;
        if(relative.includes('.'))return [{name:relative.split('.')[0],namespace:symbol.namespace+'.'+relative.split('.')[0],kind:'module'}];
        const named={name:relative,type:t.name,kind:t.predeclared?'object':t.kind};
        return [named,...(t.kind==='enum'||t.kind==='module'||t.global?t.members.filter(visible):[])];
      });
    }
    if(symbol.controlArray)return [member('Count','Long'),member('LBound','Long'),member('UBound','Long'),member('Item',symbol.type,'Index As Integer')];
    if(symbol.array)return [];
    if(symbol.kind==='class'&&!symbol.instance)return [];
    const declared=this.declared(project,module,symbol);
    if(this.type(project,module,declared.type)?.kind==='enum'&&symbol.kind!=='enum')return [];
    return this.members(project,module,declared.type||declared.name).filter(s=>s.kind!=='event');
  }
  root(project,module,line,name,offset=null){
    const {symbols}=this.scope(project,module,line,offset);
    if(eq(name,'Me'))return module.kind==='module'?null:{name:'Me',type:module.name,kind:'object',moduleId:module.id};
    let result=find(symbols,name);if(result)return result;
    const target=project.modules.find(m=>eq(m.name,name));
    if(target){const index=this.index(target,project);return {name:target.name,type:target.name,moduleId:target.id,kind:target.kind==='class'&&!index.predeclared?'class':'module',line:1};}
    for(const other of project.modules){if(other.kind!=='module'||other.id===module.id)continue;result=find(coalesce(this.index(other,project).symbols.filter(s=>!s.owner&&s.scope!=='private')),name);if(result)return result;}
    if(module.form){result=find(builtinType(module.form.type||'Form')?.members||[],name);if(result)return result;}
    result=find(GLOBAL_OBJECTS,name)||find(BUILTIN_SYMBOLS,name)||find(CONSTANT_SYMBOLS,name)||find(this.referenceGlobals(project),name);if(result)return result;
    if(eq(name,'Forms'))return {name:'Forms',type:'Forms',kind:'object'};
    const namespace=[project.name,'VBA','VB','ADODB','DAO','Scripting',...this.referenceTypes(project).map(t=>t.library)].find(n=>n&&eq(n,name));
    if(namespace)return {name:namespace,namespace,kind:'module'};
    const type=this.type(project,module,name);if(type)return {name:type.name,type:type.name,kind:type.predeclared?'object':type.kind||'class'};
    return null;
  }
  withObject(project,module,line,offset=null,block=null,depth=0){
    if(depth>32)return null;
    const idx=this.index(module,project);
    block ||= idx.withBlocks.filter(b=>offset===null?line>b.line&&line<b.endLine:offset>=b.start&&offset<=b.end).at(-1);
    if(!block)return null;
    return this.resolve(project,module,block.line,block.expression,{withBlock:block.parent,depth:depth+1,withoutImplicitWith:true,offset:block.start});
  }
  resolve(project,module,line,expression,options={}){
    expression=String(expression||'').trim().replace(/\s+_\s*\r?\n/g,' ');
    if(!expression||expression.length>4096||(options.depth||0)>64)return null;
    let ast=this.expressionCache.get(expression);
    if(!ast){try{ast=parseExpression(expression);}catch{return null;}if(this.expressionCache.size>=128)this.expressionCache.delete(this.expressionCache.keys().next().value);this.expressionCache.set(expression,ast);}
    const visit=(node,depth=0)=>{
      if(depth>64)return null;
      if(node.kind==='id')return this.root(project,module,line,node.name,options.offset??null);
      if(node.kind==='with')return options.withBlock?this.withObject(project,module,line,null,options.withBlock,(options.depth||0)+1):options.withoutImplicitWith?null:this.withObject(project,module,line,options.offset??null);
      if(node.kind==='group')return visit(node.expr,depth+1);
      if(node.kind==='new'){const type=this.type(project,module,node.name);return type?{name:node.name,type:type.name,kind:'object',instance:true}:null;}
      if(node.kind==='member')return this.declared(project,module,find(this.objectMembers(project,module,visit(node.object,depth+1)),node.name))||null;
      if(node.kind==='call'){
        const target=visit(node.callee,depth+1);if(!target)return null;
        if(target.params){
          if(target.kind==='event'||eq(target.type,'Void'))return null;
          if(target.kind==='property'&&!target.params.length){
            if(target.array)return {...target,kind:'value',params:undefined,array:false,instance:true};
            const propertyType=this.type(project,module,target.type),name=propertyType?.defaultMember||propertyType?.members?.find(m=>m.defaultMember)?.name;
            const defaultSymbol=name?find(this.objectMembers(project,module,target),name):null;
            return defaultSymbol?{...defaultSymbol,kind:'value',params:undefined,instance:true}:null;
          }
          return {...target,kind:'value',params:undefined,instance:true};
        }
        if(target.array||target.controlArray)return {...target,array:false,controlArray:false};
        const type=this.type(project,module,target.type||target.name),defaultMember=type?.defaultMember||type?.members?.find(s=>s.defaultMember)?.name;
        const item=defaultMember?find(this.objectMembers(project,module,target),defaultMember):null;
        return item?{...item,kind:'value',params:undefined,instance:true}:null;
      }
      return null;
    };
    return this.declared(project,module,visit(ast));
  }
  parameterInfo(project,module,line,text,offset,options={}){
    const context=callContext(text,offset,options);if(!context)return null;
    let symbol=this.resolve(project,module,line,context.name,{offset:text===module.code?offset:null});
    if(symbol?.array&&(!symbol.params||symbol.kind==='property'&&!symbol.params.length)){symbol={...symbol,kind:'array',params:Array.from({length:Math.min(60,symbol.rank||1)},(_,i)=>'Index'+(i+1)+' As Long'),parameters:undefined};}
    if(symbol&&(!symbol.params||symbol.kind==='property'&&!symbol.params.length)){const type=this.type(project,module,symbol.type),name=type?.defaultMember||type?.members?.find(m=>m.defaultMember)?.name;symbol=name?find(this.objectMembers(project,module,symbol),name):null;}
    if(!symbol?.params)return null;
    const declared=this.declared(project,module,symbol);symbol=declared;
    const parameters=symbol.parameters||symbol.params.map(p=>parameterSymbol(p)).filter(Boolean);
    const used=new Set();let next=0;
    for(const arg of context.args.slice(0,-1)){
      const named=maskSource(arg).match(new RegExp('^\\s*('+IDENTIFIER+')\\s*:=','i'))?.[1];
      if(named){const slot=parameters.findIndex(p=>eq(p.name,named));if(slot>=0)used.add(slot);}
      else{while(used.has(next))next++;used.add(next++);}
    }
    while(used.has(next))next++;
    let active=next;
    if(context.named){active=parameters.findIndex(p=>eq(p.name,context.named));}
    else if(active>=parameters.length){active=parameters.at(-1)?.paramArray?parameters.length-1:-1;}
    return {...symbol,parameters,displayParams:symbol.params.map((p,i)=>displayParameter(p,parameters[i])),active,context};
  }
  definition(project,module,line,text,offset,expression=wordAt(text,offset).text){
    if(statementBefore(text,offset).state!=='code')return null;
    const scope=this.scope(project,module,line,text===module.code?offset:null);
    const label=scope.idx.labels.find(l=>l.ownerId===scope.proc?.id&&eq(l.name,expression));
    return label||this.resolve(project,module,line,expression,{offset:text===module.code?offset:undefined});
  }
  expectedType(project,module,line,text,offset){
    const st=statementBefore(text,offset),masked=st.masked;
    if(/^\s*Case\s+/i.test(masked)){
      const block=this.index(module,project).selectBlocks.filter(b=>text===module.code?offset>=b.start&&offset<=b.end:line>b.line&&line<b.endLine).at(-1);
      if(block)return this.resolve(project,module,block.line,block.expression,{offset:block.start})?.type||null;
    }
    let depth=0,bracket=false,assignment=-1;
    for(let i=0;i<masked.length;i++){
      const c=masked[i];if(c==='[')bracket=true;else if(c===']')bracket=false;if(bracket)continue;
      if(c==='(')depth++;else if(c===')')depth--;
      else if(c==='='&&!depth&&!/[:<>]/.test(masked[i-1]||''))assignment=i;
    }
    const info=this.parameterInfo(project,module,line,text,offset);
    // An open call on the RHS supplies a more specific expectation than its LHS.
    if(info&&info.context.start>st.start+assignment&&info.parameters[info.active])return info.parameters[info.active].type;
    if(assignment>=0){
      const access=expressionBefore(st.text,assignment),symbol=this.resolve(project,module,line,access.text,{offset:text===module.code?offset:null});
      if(symbol)return symbol.type;
    }
    return info?.parameters[info.active]?.type||null;
  }
  completions(project,module,line,text,offset,{constants=false,unfiltered=false,contextual=false}={}){
    const span=completionSpan(text,offset),st=statementBefore(text,offset),empty={...span,items:[],context:'none'};
    if(st.state!=='code'||/^\s*(?:Attribute\b|Rem\b|#)/i.test(st.masked))return empty;
    const before=text.slice(0,span.start),memberAccess=/\.\s*$/.test(before),left=memberAccess?expressionBefore(before,before.trimEnd().length-1):null;
    const scope=this.scope(project,module,line,text===module.code?offset:null),prefix=symbolKey(span.prefix),filter=items=>{
      const unique=new Map();for(const s of items){const key=completionKey(s.name);if(visible(s)&&(unfiltered||completionMatches(s.name,span.prefix))&&!unique.has(key))unique.set(key,s);}
      return [...unique.values()].sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    };
    const typeContext=typeCompletionContext(st.masked.slice(0,Math.max(0,span.start-st.start)));
    const labelContext=/\b(?:GoTo|GoSub|Resume)\s+[^\s]*$/i.test(st.masked);
    if(labelContext&&!constants){return {...span,items:filter([...scope.idx.labels.filter(l=>l.ownerId===scope.proc?.id),...(/\bResume\s+/i.test(st.masked)?[{name:'Next',kind:'keyword'}]:/\bOn\s+Error\s+GoTo\s+/i.test(st.masked)?[{name:'0',kind:'constant'}]:[])]),context:'labels'};}
    if(typeContext&&!constants){
      return {...span,items:filter(typeCandidates(this,project,module,typeContext)),context:'types'};
    }
    let items=[],context='global';
    if(memberAccess&&!constants){
      const object=left?.text?this.resolve(project,module,line,left.text,{offset:text===module.code?offset:null}):this.withObject(project,module,line,text===module.code?offset:null);
      items=this.objectMembers(project,module,object);context='members';
    }else {
      const expected=this.expectedType(project,module,line,text,offset),enumType=this.type(project,module,expected);
      if(expected&&(enumType?.kind==='enum'||eq(expected,'Boolean'))){items=(enumType?.members||[]).filter(s=>s.kind==='constant');context='constants';}
      else if(constants){items=[...scope.symbols.filter(s=>s.kind==='constant'),...project.modules.filter(m=>m.id!==module.id&&m.kind==='module').flatMap(m=>this.index(m,project).symbols.filter(s=>!s.owner&&s.scope!=='private'&&s.kind==='constant')),...CONSTANT_SYMBOLS,...this.referenceGlobals(project).filter(s=>s.kind==='constant')];context='constants';}
      else if(/^\s*RaiseEvent\s+/i.test(st.masked)){items=scope.symbols.filter(s=>s.kind==='event');context='events';}
      else if(contextual)return empty;
      else {
        items=scope.symbols.filter(s=>s.kind!=='event');
        for(const other of project.modules){if(other.kind==='module'||this.index(other,project).predeclared)items.push({name:other.name,kind:'module',type:other.name,moduleId:other.id,line:1});if(other.kind==='module'&&other.id!==module.id)items.push(...coalesce(this.index(other,project).symbols.filter(s=>!s.owner&&s.scope!=='private'&&s.kind!=='event')));}
        if(module.kind!=='module')items.push({name:'Me',type:module.name,kind:'object'});
        if(module.form)items.push(...this.members(project,module,module.form.type||'Form'));
        items.push(...GLOBAL_OBJECTS,{name:'Forms',type:'Forms',kind:'object'},...BUILTIN_SYMBOLS,...CONSTANT_SYMBOLS,...this.referenceGlobals(project),...KEYWORDS.filter(name=>!eq(name,'Me')||module.kind!=='module').map(name=>({name,kind:'keyword'})));
        const info=this.parameterInfo(project,module,line,text,offset);
        if(info&&!['event','array'].includes(info.kind)){const used=new Set(info.context.args.slice(0,-1).map(a=>a.match(/^\s*([\w\[\]]+)\s*:=/)?.[1]).filter(Boolean).map(symbolKey));items.unshift(...info.parameters.filter(p=>!p.paramArray&&!used.has(symbolKey(p.name))).map(p=>({...p,name:p.name+':=',insertText:p.name+':=',kind:'parameter'})));}
      }
    }
    return {...span,items:filter(items),context};
  }
}
