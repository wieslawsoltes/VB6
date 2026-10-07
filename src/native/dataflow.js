/** Conservative basic-block constant propagation for unaliased local Longs.
 * No instruction, label, checkpoint, call, overflow or eager operand is deleted.
 * All control-flow joins and unknown effects are barriers. */
import {foldNativeInteger} from './optimizer.js';
const key=v=>String(v).toLowerCase();
const integral=new Set(['byte','integer','long','boolean']);
const flow=new Set(['branch','jump','computedJump','gosub','gosubReturn','return','end','forInit','forNext','eachInit','eachNext','case']);
function walk(node,visit){
  if(!node||typeof node!=='object')return;
  if(Array.isArray(node)){for(const n of node)walk(n,visit);return;}
  if(node.kind)visit(node);
  for(const [name,value]of Object.entries(node))if(name!=='kind')walk(value,visit);
}
export function propagateNativeConstants(code,locals,resolve=()=>null) {
  const stats={constantsPropagated:0};
  if(code.some(i=>['onError','resume','raiseError','gosub','gosubReturn','computedJump','withPush'].includes(i.op)))return {code,stats};
  const candidates=new Set([...locals].filter(([,v])=>key(v.type)==='long'&&!v.parameter&&!v.label&&!v.nativeArray&&!v.nativeRecord).map(([name])=>key(name)));
  // Even an earlier ByRef call can retain a local address. Exclude every local
  // mentioned in an argument tree rather than guessing a callee's alias effects.
  for(const ins of code)walk(ins,node=>{
    if(node.kind==='call'||node.kind==='addressOf')walk(node.kind==='call'?node.args:node,n=>{if(n.kind==='id')candidates.delete(key(n.name));});
  });
  if(!candidates.size)return {code,stats};
  const leaders=new Set([0]);
  code.forEach((ins,i)=>{if(flow.has(ins.op)){leaders.add(i+1);if(Number.isInteger(ins.target))leaders.add(ins.target);for(const target of ins.targets||[])leaders.add(target);}});
  const facts=new Map();
  const pure=node=>{
    if(!node)return false;
    if(node.kind==='literal')return foldNativeInteger(node)!==null;
    if(node.kind==='group')return pure(node.expr);
    if(node.kind==='unary')return ['+','-','not'].includes(key(node.op))&&pure(node.expr);
    if(node.kind==='binary')return ['+','-','*','\\','mod','and','or','xor','eqv','imp','=','<>','<','<=','>','>='].includes(key(node.op))&&pure(node.left)&&pure(node.right);
    if(node.kind==='id'){
      const local=locals.get(key(node.name));
      if(local)return integral.has(key(local.type))&&!local.nativeArray&&!local.nativeRecord;
    }
    const binding=resolve(node);return !!binding&&integral.has(binding.type);
  };
  const substitute=node=>{
    if(node.kind==='id'&&facts.has(key(node.name))){stats.constantsPropagated++;return {kind:'literal',value:facts.get(key(node.name)),valueType:'long'};}
    if(node.kind==='group'||node.kind==='unary'){const expr=substitute(node.expr);return expr===node.expr?node:{...node,expr};}
    if(node.kind==='binary'){const left=substitute(node.left),right=substitute(node.right);return left===node.left&&right===node.right?node:{...node,left,right};}
    return node;
  };
  const result=code.map((ins,index)=>{
    if(leaders.has(index))facts.clear();
    if(ins.op==='lineNumber')return ins;
    if(ins.op==='assign'&&!ins.objectSet&&ins.target.kind==='id'&&pure(ins.expr)){
      const expr=substitute(ins.expr),name=key(ins.target.name),value=foldNativeInteger(expr,resolve);
      if(candidates.has(name)&&value)facts.set(name,value.value);else facts.delete(name);
      // Unknown/form/global targets may execute an initializer while storing.
      if(!locals.has(name))facts.clear();
      return expr===ins.expr?ins:{...ins,expr};
    }
    if(ins.op==='branch'&&pure(ins.test)){
      const test=substitute(ins.test);facts.clear();return test===ins.test?ins:{...ins,test};
    }
    facts.clear();return ins;
  });
  return {code:stats.constantsPropagated?result:code,stats};
}
