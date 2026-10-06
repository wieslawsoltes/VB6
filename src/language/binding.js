import {LAYOUT_CONSTANTS,LAYOUT_ENUMS} from '../layout/contract.js';
import {VBError} from './errors.js';
import {lower} from '../core/core.js';
import {VB_CONSTANTS} from '../runtime/constants.js';
import {NOTHING,VBCurrency,coerce,unary,binary,unbox,tagScalar,literalScalar,scalarType,storageScalar,signedLiteralScalar} from '../runtime/values.js';

/** Side-effect-free project constant binding. Cached parsed modules keep their
 * ASTs: binding maps are rebuilt on every cross-module validation, so editing a
 * dependency cannot leave worker diagnostics or execution with old values. */
export function bindConstants(modules,settings={}) {
  const diagnostics=[], scopes=new Map(), cache=new Map(), active=new Set();
  const publicConstants=new Map(),publicEnums=new Map();
  const recordTypes=new Set([...modules.values()].flatMap(m=>Object.keys(m.types).flatMap(n=>[lower(n),lower(m.name)+'.'+lower(n)])));
  const scalarTypes=new Set(['byte','integer','long','single','double','currency','date','string','boolean','variant','decimal','any']);
  const append=(map,key,value)=>{const list=map.get(key);if(list)list.push(value);else map.set(key,[value]);};
  const intrinsic=new Map(Object.entries({...VB_CONSTANTS,...(settings.anchoring===true?LAYOUT_CONSTANTS:{})}).map(([k,v])=>[lower(k),typeof v==='number'?tagScalar(v,v>=-32768&&v<=32767?'integer':'long'):tagScalar(v)]));
  let steps=0;
  const report=(e,m,line)=>diagnostics.push({severity:'error',number:e.number||1002,message:e.message,source:e.source||m.name,line:e.line||line||1,column:1});
  const fail=message=>{throw new VBError(message,1002);};
  for(const m of modules.values()){
    const globals=new Map(),locals=new Map(),enums=new Map();scopes.set(m,{globals,locals,enums});
    for(const e of Object.values(m.enums)){const entry={m,e};enums.set(lower(e.name),entry);if(e.scope!=='private')append(publicEnums,lower(e.name),entry);}
    m.constantBindings=new Map();m.constantScalars=new Map();m.enumBindings=new Map();m.globalEnumMembers=new Map();m.importedConstantBindings=new Map();
    for(const d of m.declarations){const key=lower(d.name);if(globals.has(key))report(new VBError('Ambiguous name detected: '+d.name,1002),m,d.line);else globals.set(key,{m,d});
      if(d.constant&&!d.enumName&&d.scope!=='private'&&m.kind!=='module')report(new VBError('Public constants are not permitted in object modules',1002),m,d.line);
    }
    for(const p of m.procedures.values()){
      const names=new Map(p.params.map(d=>[lower(d.name),{m,p,d}]));locals.set(p,names);p.constantBindings=new Map();p.defaultBindings=new Map();p.constantScalars=new Map();p.defaultScalars=new Map();
      for(const ins of p.code)if(ins.op==='dim')for(const d of ins.decls){const key=lower(d.name);if(names.has(key))report(new VBError('Duplicate declaration: '+d.name,1002),m,ins.line);else names.set(key,{m,p,d,line:ins.line});}
    }
  }
  // Build once per validation, not once for each expression/declaration.
  for(const [m,scope] of scopes)for(const [key,entry] of scope.globals)if(entry.d.constant&&entry.d.scope!=='private'&&(m.kind==='module'||entry.d.enumName))append(publicConstants,key,entry);
  function resolve(name,m,p){
    const key=lower(name),scope=scopes.get(m),local=scope.locals.get(p)?.get(key)||scope.globals.get(key);
    if(local){if(!local.d.constant)fail('Constant expression required: '+name);return bind(local);}
    const publicMatches=publicConstants.get(key)||[];
    if(publicMatches.length>1)fail('Ambiguous constant: '+name);
    if(publicMatches.length)return bind(publicMatches[0]);
    if(intrinsic.has(key))return intrinsic.get(key);
    fail('Constant not defined: '+name);
  }
  function enumDefinition(name,m){
    const key=lower(name),own=scopes.get(m).enums.get(key);if(own)return own;
    const dot=key.indexOf('.');
    if(dot>=0){const owner=modules.get(key.slice(0,dot)),entry=owner&&scopes.get(owner).enums.get(key.slice(dot+1));if(entry){if(owner!==m&&entry.e.scope==='private')fail('Enum type is not accessible: '+name);return entry;}return;}
    const matches=publicEnums.get(key)||[];
    if(matches.length>1)fail('Ambiguous enum type: '+name);if(matches.length)return matches[0];
    if(settings.anchoring===true&&Object.hasOwn(LAYOUT_ENUMS,key)&&!modules.has(key))return {m,e:{name,members:Object.keys(LAYOUT_ENUMS[key])},layout:true};
  }
  function evaluate(node,m,p,depth=0){
    if(!node||++steps>100000||depth>256)fail('Constant expression complexity limit exceeded');
    const ev=n=>evaluate(n,m,p,depth+1);
    switch(node.kind){
      case 'literal':if(node.value===null)fail('Invalid use of Null in constant expression');return literalScalar(node);
      case 'date':return literalScalar(node);
      case 'currency':return literalScalar(node);
      case 'group':return ev(node.expr);
      case 'id':return resolve(node.name,m,p);
      case 'unary':{const literal=signedLiteralScalar(node);if(literal)return literal;}return unary(node.op,ev(node.expr));
      case 'binary':if(node.op==='is')fail('Object identity is not a constant expression');{const value=binary(node.op,ev(node.left),ev(node.right),m.optionCompare);if(typeof unbox(value)==='string'&&unbox(value).length>1048576)fail('Constant string exceeds 1 MiB compiler limit');return value;}
      case 'member':{
        if(node.object.kind!=='id')fail('Constant expression required');
        const owner=modules.get(lower(node.object.name));
        if(owner){const entry=scopes.get(owner).globals.get(lower(node.name));if(!entry?.d.constant||owner!==m&&entry.d.scope==='private')fail('Constant is not accessible: '+node.name);return bind(entry);}
        const type=enumDefinition(node.object.name,m);
        if(type&&type.e.members.some(n=>lower(n)===lower(node.name)))return type.layout?intrinsic.get(lower(node.name)):bind(scopes.get(type.m).globals.get(lower(node.name)));
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
      let type=d.explicitType||lower(d.type)!=='variant'?d.type:scalarType(value)||'Double';if(enumDefinition(type,m))type='Long';
      if(!['byte','integer','long','single','double','currency','date','string','boolean','variant'].includes(lower(type)))fail('Invalid constant type: '+type);
      value=storageScalar(value,type);d.constantType=type;cache.set(entry,value);
      (p?p.constantBindings:m.constantBindings).set(lower(d.name),unbox(value));
      (p?p.constantScalars:m.constantScalars).set(lower(d.name),value);return value;
    }finally{active.delete(entry);}
  }
  for(const m of modules.values()){
    const scope=scopes.get(m);
    for(const entry of [...scope.globals.values(),...[...scope.locals.values()].flatMap(v=>[...v.values()])])if(entry.d.constant)try{bind(entry);}catch(e){report(e,m,entry.line||entry.d.line);}
    for(const p of m.procedures.values())for(const param of p.params)if(param.initial)try{
      const type=lower(param.type),isObject=type==='object'||!scalarTypes.has(type)&&!recordTypes.has(type)&&!enumDefinition(type,m);
      if(isObject&&param.initial.kind!=='nothing')fail('An Optional object default must be Nothing');
      if(param.initial.kind==='nothing'&&!isObject)fail('Nothing requires an Optional object parameter');
      let value=isObject?NOTHING:evaluate(param.initial,m,null);
      if(['byte','integer','long','single','double','currency','date','string','boolean','variant'].includes(type))value=storageScalar(value,type);
      p.defaultBindings.set(lower(param.name),unbox(value));p.defaultScalars.set(lower(param.name),value);
    }catch(e){report(e,m,p.line);}
  }
  // Public constant values exist before runtime field initialization. Preserve
  // ambiguity rather than selecting whichever module happens to be first.
  const publicValues=new Map();
  for(const [key,entries] of publicConstants)publicValues.set(key,entries.length>1?{ambiguous:true}:{value:entries[0].m.constantBindings.get(key),scalar:entries[0].m.constantScalars.get(key)});
  const enumNamespaces=new Map();
  for(const scope of scopes.values())for(const entry of scope.enums.values()){
    const values=Object.create(null);for(const n of entry.e.members)values[lower(n)]=entry.m.constantBindings.get(lower(n));
    enumNamespaces.set(entry,Object.freeze({__vbEnum:true,owner:entry.m.name,values:Object.freeze(values)}));
  }
  for(const m of modules.values()){
    m.importedConstantBindings=new Map(publicValues);
    for(const [key,entry] of scopes.get(m).globals)if(entry.d.constant){
      const matches=publicConstants.get(key)?.filter(e=>e.m!==m)||[];
      if(!matches.length)m.importedConstantBindings.delete(key);
      else if(matches.length===1)m.importedConstantBindings.set(key,{value:matches[0].m.constantBindings.get(key),scalar:matches[0].m.constantScalars.get(key)});
    }
    // Resolve each enum namespace once; local definitions shadow public ones.
    for(const [key,entries] of publicEnums){
      const own=scopes.get(m).enums.get(key);
      m.enumBindings.set(key,own?enumNamespaces.get(own):entries.length>1?{ambiguous:true}:enumNamespaces.get(entries[0]));
      for(const entry of entries)if(entry.m!==m)for(const n of entry.e.members){const k=lower(n);m.globalEnumMembers.set(k,m.globalEnumMembers.has(k)?{ambiguous:true}:{value:entry.m.constantBindings.get(k),scalar:entry.m.constantScalars.get(k)});}
    }
    for(const [key,entry] of scopes.get(m).enums)m.enumBindings.set(key,enumNamespaces.get(entry));
    if(settings.anchoring===true)for(const [key,entries]of Object.entries(LAYOUT_ENUMS))if(!m.enumBindings.has(key)&&!modules.has(key))m.enumBindings.set(key,Object.freeze({__vbEnum:true,owner:'VB6.Layout',values:Object.freeze(Object.fromEntries(Object.entries(entries).map(([k,v])=>[lower(k),v])))}));
    const storage=(d,p=null,line=d.line)=>{delete d.storageType;try{
      if(enumDefinition(d.type,m))d.storageType='Long';
      if(d.fixedLengthExpression){d.fixedLength=null;const length=unbox(evaluate(d.fixedLengthExpression,m,p));if(typeof length!=='number'||!Number.isInteger(length)||length<1||length>65535)fail('Fixed string length must be an integer from 1 to 65535');d.fixedLength=length;}
    }catch(e){report(e,m,line);}};
    for(const d of m.declarations)storage(d);
    for(const fields of Object.values(m.types))for(const d of fields)storage(d);
    for(const p of m.procedures.values()){
      delete p.storageReturnType;try{if(enumDefinition(p.returnType,m))p.storageReturnType='Long';}catch(e){report(e,m,p.line);}
      for(const d of p.params){storage(d);if(d.storageType&&p.defaultBindings.has(lower(d.name)))try{const value=storageScalar(p.defaultScalars.get(lower(d.name)),d.storageType);p.defaultBindings.set(lower(d.name),unbox(value));p.defaultScalars.set(lower(d.name),value);}catch(e){report(e,m,p.line);}}
      for(const ins of p.code)if(ins.op==='dim'||ins.op==='redim')for(const d of ins.decls)storage(d,p,ins.line);
    }
  }
  return diagnostics;
}
