import {parseExpression} from './expression.js';
import {defaultIdentifierType} from './default-types.js';

const lower=value=>String(value).toLowerCase();
const numeric=new Set(['byte','integer','long','single','double','currency','date','variant']);
const scalar=new Set([...numeric,'boolean','string','object','decimal','any']);

/** Pure checks over the binder's existing declaration indexes. Reusing those
 * indexes avoids an independent symbol scan per loop. Types are read afresh:
 * cached syntax must not retain a dependency's previous enum classification. */
export function validateLanguageSemantics(modules,scopes,recordTypes) {
  const diagnostics=[],publicNames=new Map(),records=new Map(),ownRecords=new Map();
  const report=(m,line,message)=>diagnostics.push({severity:'error',number:1002,message,source:m.name,line:line||1,column:1});
  for(const m of modules.values()){
    const names=new Map();ownRecords.set(m,names);
    for(const name of Object.keys(m.types)){
      const key=lower(name),identity='record:'+lower(m.name)+'.'+key;names.set(key,identity);
      records.set(key,records.has(key)?null:identity);
    }
    for(const [name,entry] of scopes.get(m).globals)if(entry.d.scope!=='private'&&(m.kind==='module'||entry.d.enumName)){
      const matches=publicNames.get(name);if(matches)matches.push(entry.d);else publicNames.set(name,[entry.d]);
    }
  }
  function typeIdentity(m,type) {
    const name=lower(type);if(scalar.has(name))return name;
    if(ownRecords.get(m).has(name))return ownRecords.get(m).get(name);
    const enumeration=m.enumBindings.get(name);if(enumeration&&!enumeration.ambiguous)return 'enum:'+lower(enumeration.owner)+'.'+name;
    const dot=name.indexOf('.');
    if(dot>=0){const owner=modules.get(name.slice(0,dot)),member=name.slice(dot+1);
      if(owner){if(ownRecords.get(owner).has(member))return ownRecords.get(owner).get(member);if(Object.keys(owner.enums).some(n=>lower(n)===member))return 'enum:'+name;}}
    return records.get(name)||name;
  }
  function sameParameter(m,a,b) {
    return typeIdentity(m,a.type)===typeIdentity(m,b.type)&&a.byRef===b.byRef&&a.optional===b.optional&&a.paramArray===b.paramArray&&(a.bounds!==null)===(b.bounds!==null);
  }
  for(const m of modules.values()){
    const scope=scopes.get(m),members=new Map([...scope.globals].map(([name,entry])=>[name,{kind:'variable',line:entry.d.line}])),properties=new Map();
    for(const p of m.procedures.values()){
      const name=lower(p.name),old=members.get(name);
      if(old&&!(old.kind==='property'&&p.kind==='property'))report(m,p.line,'Ambiguous member name: '+p.name);
      else members.set(name,{kind:p.kind,line:p.line});
      if(p.kind==='property'){let group=properties.get(name);if(!group)properties.set(name,group=[]);group.push(p);}
      const locals=scope.locals.get(p),returns=p.kind==='function'||p.kind==='property'&&p.accessor==='get';
      if(returns&&locals.has(name)){const entry=locals.get(name);report(m,entry.line||p.line,'Declaration conflicts with procedure return variable: '+p.name);}
      for(const ins of p.code){
        if(ins.op!=='forInit'&&ins.op!=='eachInit')continue;
        const target=parseExpression(ins.name);if(target.kind!=='id')continue;
        const name=lower(target.name),entry=locals.get(name)||scope.globals.get(name);
        const imported=publicNames.get(name)||[];
        let declaration=entry?.d;
        if(!declaration&&returns&&name===lower(p.name))declaration={type:p.returnType,storageType:p.storageReturnType,bounds:null};
        if(!declaration){
          if(imported.length>1){report(m,ins.line,'Ambiguous loop control variable: '+target.name);continue;}
          declaration=imported[0];
        }
        if(!declaration){
          if(m.optionExplicit){report(m,ins.line,'Variable not defined: '+target.name);continue;}
          declaration={type:defaultIdentifierType(target.name,m.defaultTypes),bounds:null};
        }
        const type=lower(declaration.storageType||declaration.type);
        if(declaration.constant||declaration.bounds!==null){report(m,ins.line,'For control variable must be a writable scalar variable: '+target.name);continue;}
        if(ins.op==='forInit'){
          if(!numeric.has(type)&&(scalar.has(type)||recordTypes.has(type)||modules.has(type)))report(m,ins.line,'For control variable must be numeric or Variant, not '+declaration.type);
        }else{
          if(scalar.has(type)&&type!=='variant'&&type!=='object'||recordTypes.has(type))report(m,ins.line,'For Each control variable must be Variant or Object');
          else if(type!=='variant'&&ins.expr.kind==='id'){
            const collectionName=lower(ins.expr.name),collection=locals.get(collectionName)?.d||scope.globals.get(collectionName)?.d||(publicNames.get(collectionName)?.length===1?publicNames.get(collectionName)[0]:null);
            if(collection?.bounds!==undefined&&collection.bounds!==null)report(m,ins.line,'For Each control variable must be Variant when iterating an array');
          }
        }
      }
    }
    for(const event of m.events?.values()||[]){const name=lower(event.name);if(members.has(name))report(m,event.line,'Ambiguous member name: '+event.name);}
    for(const group of properties.values()){
      const reference=group.find(p=>p.accessor==='get')||group[0];
      const indexes=p=>p.accessor==='get'?p.params:p.params.slice(0,-1),expected=indexes(reference);
      for(const p of group){
        const value=p.accessor==='get'?null:p.params.at(-1),actual=indexes(p);
        if(p.accessor!=='get'&&(!value||value.optional||value.paramArray)){report(m,p.line,'Property Let/Set requires a final, non-Optional value parameter');continue;}
        if(p!==reference&&(expected.length!==actual.length||expected.some((arg,i)=>!sameParameter(m,arg,actual[i]))))report(m,p.line,'Inconsistent index parameters for property '+p.name);
        if(p.accessor==='let'&&reference.accessor==='get'&&typeIdentity(m,value.type)!==typeIdentity(m,reference.returnType))report(m,p.line,'Property Let value type must match Property Get return type: '+p.name);
        if(p.accessor==='set'){
          const type=lower(value.type);
          if(value.bounds!==null||scalar.has(type)&&!['variant','object'].includes(type)||recordTypes.has(type)||value.storageType)report(m,p.line,'Property Set value must be an object reference or Variant: '+p.name);
        }
      }
    }
  }
  return diagnostics;
}
