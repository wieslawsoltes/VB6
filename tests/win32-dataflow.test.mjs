import test from 'node:test';
import assert from 'node:assert/strict';
import {propagateNativeConstants} from '../src/native/dataflow.js';
const id=name=>({kind:'id',name}),lit=value=>({kind:'literal',value}),add=(a,b)=>({kind:'binary',op:'+',left:a,right:b});
const assign=(name,expr)=>({op:'assign',target:id(name),expr});
const locals=new Map(['a','b','c'].map(name=>[name,{name,type:'Long'}]));
test('constant propagation is pure and preserves instruction identities',()=>{
  const code=[assign('a',lit(7)),assign('b',add(id('a'),lit(2))),{op:'return'}],before=structuredClone(code);
  const result=propagateNativeConstants(code,locals);assert.equal(result.stats.constantsPropagated,1);
  assert.deepEqual(result.code[1].expr.left,{kind:'literal',value:7,valueType:'long'});assert.deepEqual(code,before);assert.equal(result.code.length,code.length);
});
test('branches, joins and loop headers kill predecessor constants',()=>{
  const code=[assign('a',lit(7)),{op:'branch',test:id('c'),target:4},assign('a',lit(9)),{op:'jump',target:4},assign('b',id('a'))];
  assert.equal(propagateNativeConstants(code,locals).code[4].expr.kind,'id');
  const loop=[assign('a',lit(7)),assign('b',id('a')),assign('a',add(id('a'),lit(1))),{op:'jump',target:1}];
  assert.equal(propagateNativeConstants(loop,locals).code[1].expr.kind,'id');
});
test('escaped, ByRef and static storage never acquire local constant facts',()=>{
  const escaped=[{op:'expr',expr:{kind:'call',callee:id('Remember'),args:[id('a')]}},assign('a',lit(7)),assign('b',id('a'))];
  assert.equal(propagateNativeConstants(escaped,locals).stats.constantsPropagated,0);
  for(const extra of [{parameter:true},{label:'static:a'},{nativeArray:true}]){
    const typed=new Map(locals);typed.set('a',{name:'a',type:'Long',...extra});
    assert.equal(propagateNativeConstants([assign('a',lit(7)),assign('b',id('a'))],typed).stats.constantsPropagated,0);
  }
});
test('unknown effects and error continuations are barriers',()=>{
  const effect={op:'expr',expr:{kind:'call',callee:id('External'),args:[]}};
  assert.equal(propagateNativeConstants([assign('a',lit(7)),effect,assign('b',id('a'))],locals).stats.constantsPropagated,0);
  for(const op of ['onError','resume','raiseError','gosub','gosubReturn','computedJump','withPush']){
    const code=[{op},assign('a',lit(7)),assign('b',id('a'))];assert.equal(propagateNativeConstants(code,locals).code,code);
  }
});
test('overflowing results are not propagated as successful assignments',()=>{
  const code=[assign('a',add(lit(2147483647),lit(1))),assign('b',id('a'))];
  assert.equal(propagateNativeConstants(code,locals).stats.constantsPropagated,0);
});
test('no substitution changes mixed real arithmetic or ByRef argument identity',()=>{
  const code=[assign('a',lit(7)),assign('b',add(id('a'),{kind:'literal',value:1,valueType:'single'}))];
  assert.equal(propagateNativeConstants(code,locals).stats.constantsPropagated,0);
});
