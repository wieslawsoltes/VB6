import {RDO_CONSTANTS} from '../data/rdo-contract.js';
import {RecordTypeIndex} from './record-resolution.js';
import {lower} from '../core/core.js';
import {BUILTIN_SYMBOLS,GLOBAL_OBJECTS,CONSTANT_SYMBOLS,builtinType} from './type-catalog.js';
import {LAYOUT_CONSTANTS,LAYOUT_ENUMS} from '../layout/contract.js';
import {moduleSymbolSnapshot} from './symbol-snapshot.js';

const dynamic=Object.freeze({kind:'dynamic',type:'Variant'});
const failed=Object.freeze({kind:'failed',type:'Variant'});
const expressionKinds=new Set(['literal','date','currency','empty','nothing','id','group','unary','binary','member','with','call','missing','named','byval','typeof','new','addressOf']);
const variable=(d,owner)=>({kind:'variable',owner,type:d.type,array:d.bounds!==undefined&&d.bounds!==null,declaration:d});
const metadata=s=>({kind:'metadata',type:s.type||'Variant',array:!!s.array,constant:s.kind==='constant',symbol:s});
const intrinsic=new Map([...BUILTIN_SYMBOLS,...GLOBAL_OBJECTS,...CONSTANT_SYMBOLS,...Object.keys(RDO_CONSTANTS).map(name=>({name,type:'Long',kind:'constant'})),{name:'VBA',type:'Object'},{name:'Forms',type:'Forms'},{name:'rdoEngine',type:'RDO.rdoEngine'},...['vbGeneralDate','vbLongDate','vbShortDate','vbLongTime','vbShortTime'].map(name=>({name,type:'Long',kind:'constant'})),...['CVDate','Shell','VarPtr','StrPtr','ObjPtr','LoadPicture','Tab','Spc'].map(name=>({name,kind:'function'}))].map(s=>[lower(s.name),metadata(s)]));

/** Resolve declarations without executing a property, evaluating an argument or
 * reflecting on a host object. The caller supplies the current binder indexes;
 * descriptors and references are pass-local, so syntax caches retain no links
 * to another module's old declarations. Unknown Object/Variant and host members
 * deliberately remain late-bound. Only source signatures are checked here. */
export function validateReferences(modules,scopes,settings={},symbols={}) {
  const diagnostics=[],own=new Map(),forms=new Map(),exports=new Map(),types=new Map(),records=new RecordTypeIndex(modules),reported=new Set();
  const globals=new Map(intrinsic);
  for(const symbol of symbols.globals||[])globals.set(lower(symbol.name),metadata(symbol));
  if(settings.anchoring===true){
    for(const name of Object.keys(LAYOUT_CONSTANTS))globals.set(lower(name),dynamic);
    for(const name of Object.keys(LAYOUT_ENUMS))globals.set(lower(name),dynamic);
  }
  for(const type of symbols.types||[]){types.set(lower(type.name),type);for(const alias of type.aliases||[])types.set(lower(alias),type);}
  const append=(name,value)=>{let list=exports.get(name);if(!list)exports.set(name,list=[]);list.push(value);};
  function report(m,ins,code,message){
    const line=ins.line||1,key=m.name+'\0'+line+'\0'+code+'\0'+message;if(reported.has(key))return;
    reported.add(key);diagnostics.push({severity:'error',number:1002,code,message,source:m.name,line,column:ins.column||1});
  }
  for(const m of modules.values()){
    const map=new Map([...scopes.get(m).globals].map(([name,entry])=>[name,variable(entry.d,m)]));own.set(m,map);
    for(const p of m.procedures.values()){
      const key=lower(p.name);
      if(p.kind==='property'){
        let property=map.get(key);if(property?.kind!=='property')map.set(key,property={kind:'property',owner:m,name:p.name});
        property[p.accessor]=p;
      }else if(!map.has(key))map.set(key,{kind:'procedure',owner:m,procedure:p,type:p.returnType,array:!!p.returnArray});
    }
    for(const [name,value] of map){
      const declaration=value.declaration||value.procedure||value.get||value.let||value.set;
      const visible=value.kind==='property'?[value.get,value.let,value.set].some(p=>p&&p.scope!=='private'):declaration?.scope!=='private';
      if(visible&&(m.kind==='module'||declaration?.enumName))append(name,value);
    }
    const snapshot=moduleSymbolSnapshot(m),members=new Map();forms.set(m,members);
    if(snapshot){
      for(const member of builtinType(snapshot.type)?.members||[])members.set(lower(member.name),metadata(member));
      for(const name of ['ScaleWidth','ScaleHeight','ScaleLeft','ScaleTop','ScaleMode'])members.set(lower(name),metadata({name,type:'Single'}));
      for(const symbol of [...snapshot.items,...snapshot.globals])members.set(lower(symbol.name),metadata(symbol));
    }
  }
  function namedType(type,context){
    const key=lower(type||'Variant');
    const record=records.resolve(type,context);
    if(record)return {kind:'record',record:record.fields,owner:record.owner};
    const source=modules.get(key);if(source)return {kind:'instance',owner:source,type:source.name};
    return {kind:'metadataType',definition:types.get(key)||builtinType(type),type};
  }
  for(const m of modules.values())for(const p of m.procedures.values()){
    if(p.external)continue;
    const locals=scopes.get(m).locals.get(p),withs=new Map();let ins;
    const fail=(code,message)=>{report(m,ins,code,message);return failed;};
    function selectProperty(value,role){
      if(value?.kind!=='property')return value;
      const procedure=role==='set'?value.set:role==='write'?value.let:value.get;
      if(!procedure)return fail('VB_PROPERTY_ACCESS','Property '+value.name+' does not have a '+(role==='set'?'Set':role==='write'?'Let':'Get')+' accessor');
      if(value.owner!==m&&procedure.scope==='private')return fail('VB_MEMBER_ACCESS','Method or data member not accessible: '+value.name);
      return {kind:'procedure',owner:value.owner,procedure,type:procedure.returnType,array:!!procedure.returnArray};
    }
    function simple(name,role){
      const key=lower(name),local=locals.get(key);
      if(local)return variable(local.d,m);
      if(key===lower(p.name)&&(p.kind==='function'||p.kind==='property'&&p.accessor==='get')&&role!=='callee')return {kind:'result',owner:m,type:p.returnType,array:!!p.returnArray};
      const member=own.get(m).get(key);if(member)return selectProperty(member,role);
      if(key==='me')return {kind:'instance',owner:m,type:m.name};
      const enumeration=m.enumBindings?.get(key);
      if(enumeration){if(enumeration.ambiguous)return fail('VB_AMBIGUOUS_NAME','Ambiguous enum name: '+name);return {kind:'enum',enumeration};}
      // A String-returning intrinsic explicitly selected with $ is not the
      // identically named ambient form member (Left$, Scale$, etc.).
      const formMember=forms.get(m).get(key);if(formMember&&!(name.endsWith('$')&&intrinsic.has(key)))return formMember;
      const module=modules.get(key);if(module)return {kind:'instance',owner:module,type:module.name};
      const imported=exports.get(key);
      if(imported?.length>1)return fail('VB_AMBIGUOUS_NAME','Ambiguous name: '+name);
      if(imported?.length)return selectProperty(imported[0],role);
      if(globals.has(key))return globals.get(key);
      return m.optionExplicit?fail('VB_UNDEFINED_NAME','Variable not defined: '+name):dynamic;
    }
    function asObject(value){
      if(!value||value===failed||value===dynamic||value.array)return value||dynamic;
      if(['instance','record','enum','metadataType'].includes(value.kind))return value;
      return namedType(value.type,value.owner||m);
    }
    function member(receiver,name,role){
      const object=asObject(receiver),key=lower(name);
      if(object?.kind==='instance'){
        const value=own.get(object.owner).get(key),declaration=value?.declaration||value?.procedure;
        if(value){
          if(object.owner!==m&&(declaration?.scope==='private'||value.kind==='property'&&[value.get,value.let,value.set].filter(Boolean).every(p=>p.scope==='private')))return fail('VB_MEMBER_ACCESS','Method or data member not accessible: '+name);
          const selected=selectProperty(value,role);
          if(object.owner!==m&&selected?.procedure?.scope==='private')return fail('VB_MEMBER_ACCESS','Method or data member not accessible: '+name);
          return selected;
        }
        const form=forms.get(object.owner).get(key);if(form)return form;
        const enumeration=object.owner.enumBindings?.get(key);if(enumeration?.owner===object.owner.name)return {kind:'enum',enumeration};
        if(object.owner.symbolBindings)return dynamic; // Ambient/native form surfaces are open schemas.
        return fail('VB_UNKNOWN_MEMBER','Method or data member not found: '+name);
      }
      if(object?.kind==='record'){
        const field=object.record.find(d=>lower(d.name)===key);
        return field?variable(field,object.owner):fail('VB_UNKNOWN_MEMBER','User-defined type member not found: '+name);
      }
      if(object?.kind==='enum'){
        return object.enumeration.values&&Object.hasOwn(object.enumeration.values,key)?{kind:'value',type:'Long',constant:true}:fail('VB_UNKNOWN_MEMBER','Enum member not found: '+name);
      }
      if(object?.kind==='metadataType'){
        const definition=object.definition,match=definition?.members?.find(s=>lower(s.name)===key);
        if(match)return metadata(match);
        // Metadata often describes a subset of a native control/provider. Its
        // absence must not claim that a late-bound extension cannot exist.
        return dynamic;
      }
      return object===failed?failed:dynamic;
    }
    function checkCall(target,args,role='read'){
      if(target?.kind!=='procedure')return target;
      const proc=target.procedure,parameters=role==='write'||role==='set'?proc.params.slice(0,-1):proc.params;
      const assigned=new Set(),names=new Map(parameters.map((arg,i)=>[lower(arg.name),i]));let position=0,named=false,invalid=false;
      const error=(code,message)=>{invalid=true;fail(code,message+': '+proc.name);};
      for(const arg of args){
        let index;
        if(arg.kind==='named'){
          named=true;index=names.get(lower(arg.name));
          if(index===undefined){error('VB_NAMED_ARGUMENT','Named argument not found ('+arg.name+')');continue;}
          if(parameters.some(p=>p.paramArray)){error('VB_NAMED_ARGUMENT','Named arguments are not allowed for a ParamArray procedure');continue;}
        }else{
          if(named){error('VB_ARGUMENT_ORDER','Positional argument cannot follow a named argument');continue;}
          index=position++;
        }
        const parameter=parameters[index],rest=parameters.at(-1)?.paramArray;
        if(!parameter){if(!rest)error('VB_ARGUMENT_COUNT','Too many arguments');continue;}
        if(assigned.has(index)){error('VB_DUPLICATE_ARGUMENT','Argument supplied more than once ('+parameter.name+')');continue;}
        assigned.add(index);
        if(arg.kind==='missing'&&!parameter.optional&&!parameter.paramArray)error('VB_ARGUMENT_REQUIRED','Argument not optional ('+parameter.name+')');
        if(arg.kind==='byval'&&!proc.external)error('VB_BYVAL_ARGUMENT','Call-site ByVal requires a Declare procedure');
      }
      for(let i=0;i<parameters.length;i++)if(!assigned.has(i)&&!parameters[i].optional&&!parameters[i].paramArray)error('VB_ARGUMENT_REQUIRED','Argument not optional ('+parameters[i].name+')');
      if(role==='read'&&proc.kind==='sub')error('VB_SUB_VALUE','Sub procedure cannot be used as a value');
      return invalid?failed:{kind:'value',owner:target.owner||m,type:proc.returnType,array:!!proc.returnArray};
    }
    function expression(node,role='read',invoke=true){
      if(!node)return dynamic;
      switch(node.kind){
        case 'id':{
          const value=simple(node.name,role);
          if((role==='write'||role==='set')&&(value.declaration?.constant||value.constant))return fail('VB_CONSTANT_ASSIGNMENT','Cannot assign to constant: '+node.name);
          if((role==='write'||role==='set')&&value.kind==='procedure'&&value.procedure.kind!=='property')return fail('VB_ASSIGNABLE_TARGET','Procedure is not an assignable target: '+node.name);
          if(value.kind==='procedure'&&role!=='callee'&&invoke)return checkCall(value,[],role);
          return value;
        }
        case 'group':case 'named':case 'byval':return expression(node.expr);
        case 'member':{
          const value=member(expression(node.object),node.name,role);
          if((role==='write'||role==='set')&&(value?.declaration?.constant||value?.constant))return fail('VB_CONSTANT_ASSIGNMENT','Cannot assign to constant: '+node.name);
          if((role==='write'||role==='set')&&value?.kind==='procedure'&&value.procedure.kind!=='property')return fail('VB_ASSIGNABLE_TARGET','Procedure is not an assignable target: '+node.name);
          return value?.kind==='procedure'&&role!=='callee'&&invoke?checkCall(value,[],role):value;
        }
        case 'call':{
          let target=expression(node.callee,role==='write'||role==='set'?role:'callee',false);
          for(const arg of node.args)expression(arg);
          // An array variable is indexed; a parameterized array-returning
          // procedure must bind its call before a following pair of subscripts.
          if(target?.array&&(target.kind!=='procedure'||target.procedure.params.length===0))return {...target,kind:'value',array:node.args.length===0};
          if(target?.kind!=='procedure'&&target!==dynamic&&target!==failed){const object=asObject(target);if(object?.kind==='instance'&&object.owner.defaultMember)target=member(object,object.owner.defaultMember,role);}
          return checkCall(target,node.args,role);
        }
        case 'with':return withs.get(ins.withId)||dynamic;
        case 'new':return namedType(node.name,m);
        case 'typeof':expression(node.expr);return dynamic;
        case 'addressOf':{
          const parts=node.name.split('.');let target=simple(parts[0],'callee');
          for(const name of parts.slice(1))target=member(target,name,'callee');
          if(target===failed)return failed;
          if(target.kind!=='procedure'||target.owner?.kind!=='module'||target.procedure.external) return fail('VB_ADDRESSOF_TARGET','AddressOf requires a procedure in a standard module: '+node.name);
          return dynamic;
        }
        case 'unary':expression(node.expr);return dynamic;
        case 'binary':expression(node.left);expression(node.right);return dynamic;
        default:return dynamic;
      }
    }
    function walk(value){
      if(!value||typeof value!=='object')return;
      if(expressionKinds.has(value.kind)){expression(value);return;}
      for(const item of Object.values(value))if(Array.isArray(item)){for(const child of item)walk(child);}else walk(item);
    }
    for(ins of p.code){
      if(ins.op==='assign'){
        // Resolve a property setter using the assignment context without
        // treating its value parameter as a missing indexed argument.
        expression(ins.target,ins.objectSet?'set':'write');expression(ins.expr);
      }else if(ins.op==='expr')expression(ins.expr,'statement');
      else if(ins.op==='raiseEvent'){
        const event=m.events?.get(lower(ins.expr.callee.name));
        if(event)checkCall({kind:'procedure',procedure:{...event,kind:'event'}},ins.expr.args,'statement');
        else fail('VB_EVENT_NAME','Event not declared: '+ins.expr.callee.name);
        for(const arg of ins.expr.args)expression(arg);
      }else if(ins.op==='withPush'){
        const receiver=expression(ins.expr);withs.set(ins.id,asObject(receiver));
      }else if(ins.op==='dim'){
        // Constants and fixed dimensions have a stricter binder of their own.
        for(const d of ins.decls)if(!d.constant)expression(d.initial);
      }else if(ins.op==='redim'){
        for(const d of ins.decls)for(const bound of d.bounds)for(const endpoint of bound)expression(endpoint);
      }else walk(ins);
    }
  }
  return diagnostics;
}
