import {parseExpression} from '../language/expression.js';
import {KEYWORDS} from './language-service.js';
import {IDENTIFIER,TYPE_NAME,symbolKey,maskSource,splitArguments,statementBefore,expressionBefore,completionSpan,wordAt} from './source-context.js';
import {scanDeclarations,parameterSymbol} from './declaration-index.js';
import {PRIMITIVE_TYPES,CONSTANT_SYMBOLS,BUILTIN_SYMBOLS,GLOBAL_OBJECTS,TYPE_CATALOG,ENUM_TYPES,builtinType,member,runtimeType} from './type-catalog.js';
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
    return {...s,kind:'property',params,parameters:params.map(p=>parameterSymbol(p)).filter(Boolean)};
  });
}

/** Nested and statement-form call contexts; named/omitted arguments retain
 * their source position. Parenthesized grouping is not mistaken for a call. */
export function callContext(text,offset,{outer=false}={}) {
  const st=statementBefore(text,offset),masked=st.masked;
  if(st.state==='comment'||/^\s*(?:(?:Public|Private|Friend|Static)\s+)*(?:Declare\s+)?(?:Sub|Function|Property|Event|Type|Enum)\b/i.test(masked))return null;
  const stack=[],contexts=[];
  const plain=masked.match(new RegExp('^\\s*(?:(?:Call|RaiseEvent)\\s+)?(\\.?'+IDENTIFIER+'(?:\\s*\\.\\s*'+IDENTIFIER+')*)[ \\t]+','i'));
  if(plain&&!/^[ \t]*[=]/.test(masked.slice(plain[0].length))&&(!KEYWORDS.some(k=>eq(k,plain[1]))||BUILTIN_SYMBOLS.some(s=>eq(s.name,plain[1]))||plain[1].includes('.'))){
    const root={name:st.text.slice(plain[0].lastIndexOf(plain[1]),plain[0].lastIndexOf(plain[1])+plain[1].length).trim(),start:st.start+plain[0].length,comma:0,last:plain[0].length,argumentStart:plain[0].length,statement:true};
    // The zero-length remainder is a valid first argument position.
    contexts.push(root);stack.push(root);
  }
  let bracket=false;
  for(let i=0;i<masked.length;i++){
    const c=masked[i];if(c==='[')bracket=true;else if(c===']')bracket=false;if(bracket)continue;
    if(c==='('){const access=expressionBefore(st.text,i),name=access.text;const frame={name:/^[\w\u0080-\uffff[.(]/.test(name)&&!KEYWORDS.some(k=>eq(k,name)&&!BUILTIN_SYMBOLS.some(s=>eq(s.name,name)))?name:'',start:st.start+i+1,comma:0,last:i+1,argumentStart:i+1};stack.push(frame);}
    else if(c===')'){if(stack.length&&!stack.at(-1).statement)stack.pop();}
    else if(c===','&&stack.length){stack.at(-1).comma++;stack.at(-1).last=i+1;}
  }
  const named=stack.filter(c=>c.name),found=outer?named[0]:named.at(-1);if(!found)return null;
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
    if(cached?.code===module.code&&cached.name===module.name&&cached.kind===module.kind&&cached.formKey===formKey&&cached.conditionalKey===conditionalKey)return cached.index;
    const index=scanDeclarations({...module,conditionalConstants:condition});this.scanCount++;
    this.cache.set(module.id,{code:module.code,name:module.name,kind:module.kind,formKey,conditionalKey,index});return index;
  }
  prune(project){const ids=new Set(project.modules.map(m=>m.id));for(const id of this.cache.keys())if(!ids.has(id))this.cache.delete(id);}
  scope(project,module,line){
    this.prune(project);const idx=this.index(module,project),proc=idx.procedures.find(p=>line>=p.line&&line<=p.end);
    const local=idx.symbols.filter(s=>s.ownerId&&s.ownerId===proc?.id),global=idx.symbols.filter(s=>!s.owner);
    return {idx,proc,symbols:[...local,...coalesce(global)]};
  }
  /** Explicit portable type-library descriptors. No registry lookup, fetching,
   * getters, method invocation or native library loading is performed. */
  registerTypeLibrary(name,types){
    if(typeof name!=='string'||!name.trim()||!Array.isArray(types)||types.length>4096)throw new TypeError('Expected a named type library with at most 4096 types');
    const copy=JSON.parse(JSON.stringify(types));
    for(const type of copy){if(typeof type.name!=='string'||!Array.isArray(type.members)||type.members.length>10000)throw new TypeError('Invalid type-library descriptor');for(const m of type.members){if(typeof m.name!=='string'||m.params!==undefined&&(!Array.isArray(m.params)||m.params.some(p=>typeof p!=='string')))throw new TypeError('Invalid member descriptor');}}
    this.libraries.set(symbolKey(name),copy.map(t=>({...t,name:t.name.includes('.')?t.name:name+'.'+t.name,library:name,kind:t.kind||'class',members:t.members.map(m=>({...member(m.name,m.type||'Variant',m.params??null),...m}))})));this.libraryRevision++;return ()=>this.unregisterTypeLibrary(name);
  }
  unregisterTypeLibrary(name){const changed=this.libraries.delete(symbolKey(name));if(changed)this.libraryRevision++;return changed;}
  referenceTypes(project){
    // Projects can persist the same JSON descriptor beside their native
    // reference identity. Check serialized contents to observe in-place edits.
    const descriptors=(project.references||[]).filter(r=>r&&typeof r==='object'&&r.typeLibrary&&!r.missing).map(r=>r.typeLibrary).concat(project.typeLibraries||[]);
    const key=JSON.stringify(descriptors);
    if(key!==this.referenceKey){const service=new EditorIntelligence();for(const d of descriptors)try{service.registerTypeLibrary(d.name,d.types);}catch{}this.referenceCache=[...service.libraries.values()].flat();this.referenceKey=key;}
    return [...this.libraries.values()].flat().concat(this.referenceCache||[]);
  }
  type(project,module,type){
    type=String(type||'Variant').replace(/\[([^\]]+)\]/g,'$1').replace(/\s+/g,'');
    if(project.name&&type.toLowerCase().startsWith(project.name.toLowerCase()+'.'))type=type.slice(project.name.length+1);
    const target=eq(module.name,type)?module:project.modules.find(m=>eq(m.name,type));
    if(target)return {name:target.name,type:target.name,kind:target.kind,moduleId:target.id,members:coalesce(this.index(target,project).symbols.filter(s=>!s.owner&&(target.id===module.id||s.scope!=='private'))).concat(target.form?builtinType(target.form.type||'Form')?.members||[]:[])};
    const pieces=type.split('.'),qualifier=pieces.length>1?pieces.slice(0,-1).join('.'):null,recordName=pieces.at(-1);
    for(const m of [module,...project.modules.filter(m=>m.id!==module.id)]){
      if(qualifier&&!eq(m.name,qualifier))continue;
      const record=this.index(m,project).records.find(r=>eq(r.name,recordName)&&(m.id===module.id||r.scope!=='private'));
      if(record)return record;
    }
    const references=this.referenceTypes(project),ref=references.find(t=>eq(t.name,type))||references.find(t=>eq(t.name.split('.').at(-1),type));
    return ref||runtimeType(project,type)||builtinType(type);
  }
  members(project,module,type){return (this.type(project,module,type)?.members||[]).filter(visible);}
  objectMembers(project,module,symbol){
    if(!symbol)return [];
    if(symbol.namespace){
      if(eq(symbol.namespace,project.name))return project.modules.map(m=>({name:m.name,type:m.name,kind:'module',moduleId:m.id,line:1}));
      if(eq(symbol.namespace,'VBA'))return [...BUILTIN_SYMBOLS,...CONSTANT_SYMBOLS,...['Strings','Math','Conversion','DateTime','Interaction','Information','FileSystem'].map(name=>({name,namespace:'VBA',kind:'module'}))];
      return [...TYPE_CATALOG.values(),...ENUM_TYPES.values(),...this.referenceTypes(project)].filter(t=>t.name.toLowerCase().startsWith(symbol.namespace.toLowerCase()+'.')||eq(symbol.namespace,'VB')&&(t.aliases||[]).some(a=>a.startsWith('VB.'))).map(t=>({name:t.name.split('.').at(-1),type:t.name,kind:t.kind==='enum'?'enum':'class'}));
    }
    if(symbol.controlArray)return [member('Count','Long'),member('LBound','Long'),member('UBound','Long'),member('Item',symbol.type,'Index As Integer')];
    if(symbol.array)return [];
    if(symbol.kind==='class'&&!symbol.instance)return [];
    return this.members(project,module,symbol.type||symbol.name);
  }
  root(project,module,line,name){
    const {symbols}=this.scope(project,module,line);
    if(eq(name,'Me'))return module.kind==='module'?null:{name:'Me',type:module.name,kind:'object',moduleId:module.id};
    let result=find(symbols,name);if(result)return result;
    const target=project.modules.find(m=>eq(m.name,name));
    if(target){const index=this.index(target,project);return {name:target.name,type:target.name,moduleId:target.id,kind:target.kind==='class'&&!index.predeclared?'class':'module',line:1};}
    for(const other of project.modules){if(other.kind!=='module'||other.id===module.id)continue;result=find(coalesce(this.index(other,project).symbols.filter(s=>!s.owner&&s.scope!=='private')),name);if(result)return result;}
    if(module.form){result=find(builtinType(module.form.type||'Form')?.members||[],name);if(result)return result;}
    result=find(GLOBAL_OBJECTS,name)||find(BUILTIN_SYMBOLS,name)||find(CONSTANT_SYMBOLS,name);if(result)return result;
    if(eq(name,'Forms'))return {name:'Forms',type:'Forms',kind:'object'};
    const namespace=[project.name,'VBA','VB','ADODB','DAO','Scripting',...this.referenceTypes(project).map(t=>t.library)].find(n=>n&&eq(n,name));
    if(namespace)return {name:namespace,namespace,kind:'module'};
    const type=this.type(project,module,name);if(type)return {name:type.name,type:type.name,kind:type.kind||'class'};
    return null;
  }
  withObject(project,module,line,offset=null,block=null,depth=0){
    if(depth>32)return null;
    const idx=this.index(module,project);
    block ||= idx.withBlocks.filter(b=>offset===null?line>b.line&&line<b.endLine:offset>=b.start&&offset<=b.end).at(-1);
    if(!block)return null;
    return this.resolve(project,module,block.line,block.expression,{withBlock:block.parent,depth:depth+1,withoutImplicitWith:true});
  }
  resolve(project,module,line,expression,options={}){
    expression=String(expression||'').trim().replace(/\s+_\s*\r?\n/g,' ');
    if(!expression||expression.length>4096||(options.depth||0)>64)return null;
    let ast=this.expressionCache.get(expression);
    if(!ast){try{ast=parseExpression(expression);}catch{return null;}if(this.expressionCache.size>=128)this.expressionCache.delete(this.expressionCache.keys().next().value);this.expressionCache.set(expression,ast);}
    const visit=(node,depth=0)=>{
      if(depth>64)return null;
      if(node.kind==='id')return this.root(project,module,line,node.name);
      if(node.kind==='with')return options.withBlock?this.withObject(project,module,line,null,options.withBlock,(options.depth||0)+1):options.withoutImplicitWith?null:this.withObject(project,module,line,options.offset??null);
      if(node.kind==='group')return visit(node.expr,depth+1);
      if(node.kind==='new'){const type=this.type(project,module,node.name);return type?{name:node.name,type:type.name,kind:'object',instance:true}:null;}
      if(node.kind==='member')return find(this.objectMembers(project,module,visit(node.object,depth+1)),node.name)||null;
      if(node.kind==='call'){
        const target=visit(node.callee,depth+1);if(!target)return null;
        if(target.params)return {...target,kind:'value',params:undefined,instance:true};
        if(target.array||target.controlArray)return {...target,array:false,controlArray:false};
        const type=this.type(project,module,target.type||target.name),defaultMember=type?.defaultMember||type?.members?.find(s=>s.defaultMember)?.name;
        const item=defaultMember?find(this.objectMembers(project,module,target),defaultMember):null;
        return item?{...item,kind:'value',params:undefined,instance:true}:null;
      }
      return null;
    };
    return visit(ast);
  }
  parameterInfo(project,module,line,text,offset,options={}){
    const context=callContext(text,offset,options);if(!context)return null;
    let symbol=this.resolve(project,module,line,context.name,{offset});
    if(symbol&&!symbol.params){const type=this.type(project,module,symbol.type),name=type?.defaultMember||type?.members?.find(m=>m.defaultMember)?.name;symbol=name?find(this.objectMembers(project,module,symbol),name):null;}
    if(!symbol?.params)return null;
    const parameters=symbol.parameters||symbol.params.map(p=>parameterSymbol(p)).filter(Boolean);
    let active=context.comma;
    if(context.named){active=parameters.findIndex(p=>eq(p.name,context.named));}
    else if(active>=parameters.length){active=parameters.at(-1)?.paramArray?parameters.length-1:-1;}
    return {...symbol,parameters,active,context};
  }
  expectedType(project,module,line,text,offset){
    const st=statementBefore(text,offset),span=completionSpan(st.text,st.text.length),left=st.text.slice(0,span.start);
    const assign=maskSource(left).match(/(?<![:<>])=\s*$/);
    if(assign){const access=expressionBefore(st.text,assign.index),symbol=this.resolve(project,module,line,access.text,{offset});if(symbol)return symbol.type;}
    const info=this.parameterInfo(project,module,line,text,offset);return info?.parameters[info.active]?.type||null;
  }
  completions(project,module,line,text,offset,{constants=false,unfiltered=false,contextual=false}={}){
    const span=completionSpan(text,offset),st=statementBefore(text,offset),empty={...span,items:[],context:'none'};
    if(st.state!=='code'||/^\s*(?:Attribute|Rem|#)/i.test(st.masked))return empty;
    const before=text.slice(0,span.start),memberAccess=/\.\s*$/.test(before),left=memberAccess?expressionBefore(before,before.trimEnd().length-1):null;
    const scope=this.scope(project,module,line),prefix=symbolKey(span.prefix),filter=items=>{
      const unique=new Map();for(const s of items){const key=symbolKey(s.name);if(visible(s)&&(unfiltered||key.startsWith(prefix))&&!unique.has(key))unique.set(key,s);}
      return [...unique.values()].sort((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    };
    const typeContext=st.masked.slice(0,Math.max(0,span.start-st.start)).match(/\b(As\s+(?:New\s+)?|New\s+|Implements\s+)([\w.\[\]]*)$/i);
    if(typeContext&&!constants){
      const construct=/New/i.test(typeContext[1]),implementsType=/Implements/i.test(typeContext[1]),qualifier=typeContext[2].replace(/\.$/,'');
      let types=[...PRIMITIVE_TYPES.map(name=>({name,kind:'type',type:name})),...project.modules.filter(m=>m.kind!=='module').map(m=>({name:m.name,kind:'class',type:m.name,moduleId:m.id,line:1})),...project.modules.flatMap(m=>this.index(m,project).records.filter(r=>m.id===module.id||r.scope!=='private')),...TYPE_CATALOG.values(),...ENUM_TYPES.values(),...this.referenceTypes(project)].map(t=>({...t,type:t.type||t.name}));
      if(construct||implementsType)types=types.filter(t=>['class','form'].includes(t.kind));
      if(qualifier){if(eq(qualifier,project.name))types=types.filter(t=>t.moduleId);else types=types.filter(t=>t.name.toLowerCase().startsWith(qualifier.toLowerCase()+'.')||(t.aliases||[]).some(a=>a.toLowerCase().startsWith(qualifier.toLowerCase()+'.')));types=types.map(t=>({...t,name:t.name.split('.').at(-1)}));}
      else types.push(...['VB','VBA','ADODB','DAO','Scripting',project.name,...this.referenceTypes(project).map(t=>t.library)].filter(Boolean).map(name=>({name,kind:'module'})));
      return {...span,items:filter(types),context:'types'};
    }
    let items=[],context='global';
    if(memberAccess&&!constants){
      const object=left?.text?this.resolve(project,module,line,left.text,{offset}):this.withObject(project,module,line,offset);
      items=this.objectMembers(project,module,object);context='members';
    }else {
      const expected=this.expectedType(project,module,line,text,offset),enumType=this.type(project,module,expected);
      if(expected&&(enumType?.kind==='enum'||eq(expected,'Boolean'))){items=(enumType?.members||[]).filter(s=>s.kind==='constant');context='constants';}
      else if(constants){items=[...scope.symbols.filter(s=>s.kind==='constant'),...project.modules.filter(m=>m.id!==module.id&&m.kind==='module').flatMap(m=>this.index(m,project).symbols.filter(s=>!s.owner&&s.scope!=='private'&&s.kind==='constant')),...CONSTANT_SYMBOLS];context='constants';}
      else if(/^\s*RaiseEvent\s+/i.test(st.masked)){items=scope.symbols.filter(s=>s.kind==='event');context='events';}
      else if(contextual)return empty;
      else {
        items=scope.symbols.filter(s=>s.kind!=='event');
        for(const other of project.modules){if(other.kind==='module'||this.index(other,project).predeclared)items.push({name:other.name,kind:'module',type:other.name,moduleId:other.id,line:1});if(other.kind==='module'&&other.id!==module.id)items.push(...coalesce(this.index(other,project).symbols.filter(s=>!s.owner&&s.scope!=='private'&&s.kind!=='event')));}
        if(module.kind!=='module')items.push({name:'Me',type:module.name,kind:'object'});
        if(module.form)items.push(...this.members(project,module,module.form.type||'Form'));
        items.push(...GLOBAL_OBJECTS,{name:'Forms',type:'Forms',kind:'object'},...BUILTIN_SYMBOLS,...CONSTANT_SYMBOLS,...KEYWORDS.filter(name=>!eq(name,'Me')||module.kind!=='module').map(name=>({name,kind:'keyword'})));
        const info=this.parameterInfo(project,module,line,text,offset);
        if(info){const used=new Set(info.context.args.slice(0,-1).map(a=>a.match(/^\s*([\w\[\]]+)\s*:=/)?.[1]).filter(Boolean).map(symbolKey));items.unshift(...info.parameters.filter(p=>!p.paramArray&&!used.has(symbolKey(p.name))).map(p=>({...p,name:p.name+':=',insertText:p.name+':=',kind:'parameter'})));}
      }
    }
    return {...span,items:filter(items),context};
  }
}
