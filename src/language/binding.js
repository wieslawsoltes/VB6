import {VBError} from './errors.js';
import {lower} from '../core/core.js';
import {VB_CONSTANTS} from '../runtime/constants.js';
import {VBCurrency,coerce,unary,binary} from '../runtime/values.js';

/** Side-effect-free project constant binding. Cached parsed modules keep their
 * ASTs: binding maps are rebuilt on every cross-module validation, so editing a
 * dependency cannot leave worker diagnostics or execution with old values. */
export function bindConstants(modules) {
  const diagnostics=[], scopes=new Map(), cache=new Map(), active=new Set();
  const intrinsic=new Map(Object.entries(VB_CONSTANTS).map(([k,v])=>[lower(k),v]));
  let steps=0;
  const report=(e,m,line)=>diagnostics.push({severity:'error',number:e.number||1002,message:e.message,source:e.source||m.name,line:e.line||line||1,column:1});
  const fail=message=>{throw new VBError(message,1002);};
  for(const m of modules.values()){
    const globals=new Map(),locals=new Map();scopes.set(m,{globals,locals});
    m.constantBindings=new Map();m.enumBindings=new Map();m.globalEnumMembers=new Map();m.importedConstantBindings=new Map();
    for(const d of m.declarations){const key=lower(d.name);if(globals.has(key))report(new VBError('Ambiguous name detected: '+d.name,1002),m,d.line);else globals.set(key,{m,d});
      if(d.constant&&!d.enumName&&d.scope!=='private'&&m.kind!=='module')report(new VBError('Public constants are not permitted in object modules',1002),m,d.line);
    }
    for(const p of m.procedures.values()){
      const names=new Map(p.params.map(d=>[lower(d.name),{m,p,d}]));locals.set(p,names);p.constantBindings=new Map();p.defaultBindings=new Map();
      for(const ins of p.code)if(ins.op==='dim')for(const d of ins.decls){const key=lower(d.name);if(names.has(key))report(new VBError('Duplicate declaration: '+d.name,1002),m,ins.line);else names.set(key,{m,p,d,line:ins.line});}
    }
  }
  function resolve(name,m,p){
    const key=lower(name),scope=scopes.get(m),local=scope.locals.get(p)?.get(key)||scope.globals.get(key);
    if(local){if(!local.d.constant)fail('Constant expression required: '+name);return bind(local);}
    const publicMatches=[];
    for(const other of modules.values())if(other!==m){const entry=scopes.get(other).globals.get(key);if(entry?.d.constant&&entry.d.scope!=='private'&&(other.kind==='module'||entry.d.enumName))publicMatches.push(entry);}
    if(publicMatches.length>1)fail('Ambiguous constant: '+name);
    if(publicMatches.length)return bind(publicMatches[0]);
    if(intrinsic.has(key))return intrinsic.get(key);
    fail('Constant not defined: '+name);
  }
  function enumDefinition(name,m){
    const key=lower(name),own=Object.values(m.enums).find(e=>lower(e.name)===key);
    if(own)return {m,e:own};
    const matches=[];for(const other of modules.values())if(other!==m)for(const e of Object.values(other.enums))if(e.scope!=='private'&&lower(e.name)===key)matches.push({m:other,e});
    if(matches.length>1)fail('Ambiguous enum type: '+name);return matches[0];
  }
  function evaluate(node,m,p,depth=0){
    if(!node||++steps>100000||depth>256)fail('Constant expression complexity limit exceeded');
    const ev=n=>evaluate(n,m,p,depth+1);
    switch(node.kind){
      case 'literal':if(node.value===null)fail('Invalid use of Null in constant expression');return node.value;
      case 'date':return new Date(node.value);
      case 'currency':return new VBCurrency(node.value);
      case 'group':return ev(node.expr);
      case 'id':return resolve(node.name,m,p);
      case 'unary':if(node.op==='-'&&node.expr.kind==='currency')return new VBCurrency('-'+node.expr.value);return unary(node.op,ev(node.expr));
      case 'binary':if(node.op==='is')fail('Object identity is not a constant expression');{const value=binary(node.op,ev(node.left),ev(node.right),m.optionCompare);if(typeof value==='string'&&value.length>1048576)fail('Constant string exceeds 1 MiB compiler limit');return value;}
      case 'member':{
        if(node.object.kind!=='id')fail('Constant expression required');
        const owner=modules.get(lower(node.object.name));
        if(owner){const entry=scopes.get(owner).globals.get(lower(node.name));if(!entry?.d.constant||owner!==m&&entry.d.scope==='private')fail('Constant is not accessible: '+node.name);return bind(entry);}
        const type=enumDefinition(node.object.name,m);
        if(type&&type.e.members.some(n=>lower(n)===lower(node.name)))return bind(scopes.get(type.m).globals.get(lower(node.name)));
        fail('Constant member not defined: '+node.name);break;
      }
      default:fail('Constant expression cannot invoke functions, allocate objects, or read variables');
    }
  }
  function bind(entry){
    if(cache.has(entry))return cache.get(entry);
    if(active.size>=256)fail('Constant dependency depth limit exceeded');
    if(active.has(entry))fail('Circular constant dependency: '+entry.d.name);
    active.add(entry);
    try{
      const {m,p,d}=entry;let value=evaluate(d.initial,m,p);
      const type=d.explicitType||lower(d.type)!=='variant'?d.type:value instanceof VBCurrency?'Currency':value instanceof Date?'Date':typeof value==='string'?'String':Number.isInteger(value)&&value>=-32768&&value<=32767?'Integer':Number.isInteger(value)&&value>=-2147483648&&value<=2147483647?'Long':'Double';
      if(!['byte','integer','long','single','double','currency','date','string','boolean','variant'].includes(lower(type)))fail('Invalid constant type: '+type);
      value=coerce(value,type);cache.set(entry,value);(p?p.constantBindings:m.constantBindings).set(lower(d.name),value);return value;
    }finally{active.delete(entry);}
  }
  for(const m of modules.values()){
    const scope=scopes.get(m);
    for(const entry of [...scope.globals.values(),...[...scope.locals.values()].flatMap(v=>[...v.values()])])if(entry.d.constant)try{bind(entry);}catch(e){report(e,m,entry.line||entry.d.line);}
    for(const p of m.procedures.values())for(const param of p.params)if(param.initial)try{p.defaultBindings.set(lower(param.name),evaluate(param.initial,m,null));}catch(e){report(e,m,p.line);}
  }
  // Public constant values exist before runtime field initialization. Preserve
  // ambiguity rather than selecting whichever module happens to be first.
  for(const m of modules.values())for(const owner of modules.values())if(owner!==m)
    for(const d of owner.declarations)if(d.constant&&d.scope!=='private'&&(owner.kind==='module'||d.enumName)){
      const key=lower(d.name);m.importedConstantBindings.set(key,m.importedConstantBindings.has(key)?{ambiguous:true}:{value:owner.constantBindings.get(key)});
    }
  // Resolved enum namespaces are immutable and never expose host reflection.
  for(const m of modules.values()){
    for(const owner of modules.values())for(const e of Object.values(owner.enums))if(owner===m||e.scope!=='private'){
      if(owner!==m&&e.scope!=='private')for(const n of e.members){const k=lower(n);m.globalEnumMembers.set(k,m.globalEnumMembers.has(k)?{ambiguous:true}:{value:owner.constantBindings.get(k)});}
      const key=lower(e.name),existing=m.enumBindings.get(key);
      if(existing&&existing.owner!==m.name&&owner!==m){m.enumBindings.set(key,{ambiguous:true});continue;}
      if(existing&&existing.owner===m.name)continue;
      const values=Object.create(null);for(const n of e.members)values[lower(n)]=owner.constantBindings.get(lower(n));
      m.enumBindings.set(key,Object.freeze({__vbEnum:true,owner:owner.name,values:Object.freeze(values)}));
    }
    const storage=d=>{delete d.storageType;try{if(enumDefinition(d.type,m))d.storageType='Long';}catch(e){report(e,m,d.line);}};
    for(const d of m.declarations)storage(d);
    for(const fields of Object.values(m.types))for(const d of fields)storage(d);
    for(const p of m.procedures.values()){
      delete p.storageReturnType;try{if(enumDefinition(p.returnType,m))p.storageReturnType='Long';}catch(e){report(e,m,p.line);}
      for(const d of p.params){storage(d);if(d.storageType&&p.defaultBindings.has(lower(d.name)))try{p.defaultBindings.set(lower(d.name),coerce(p.defaultBindings.get(lower(d.name)),d.storageType));}catch(e){report(e,m,p.line);}}
      for(const ins of p.code)if(ins.op==='dim'||ins.op==='redim')for(const d of ins.decls)storage(d);
    }
  }
  return diagnostics;
}
