import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject} from '../src/project/model.js';
import {parseExpression} from '../src/language/expression.js';
import {foldNativeInteger} from '../src/native/optimizer.js';
import {nativeIntegerBinaryType,nativeIntegerUnaryType,nativeSignedIntegerLiteral} from '../src/native/integers.js';
import {scalarBinary,scalarUnary,tagScalar,unbox,scalarType} from '../src/runtime/values.js';
import {compileWin32} from '../src/native/compiler.js';
const values={byte:[0,1,127,255],integer:[-32768,-1,0,1,32767],long:[-2147483648,-65536,-1,0,1,2147483647],boolean:[-1,0]};
const id=name=>({kind:'id',name});
test('typed integer folds agree with independently implemented runtime scalar operators',()=>{
 let vectors=0;
 for(const [aType,aValues]of Object.entries(values))for(const [bType,bValues]of Object.entries(values))for(const a of aValues)for(const b of bValues)for(const op of ['+','-','*','\\','mod','and','or','xor','eqv','imp','=','<>','<','<=','>','>=']){
  const label=`${aType}(${a}) ${op} ${bType}(${b})`,node={kind:'binary',op,left:id('a'),right:id('b')};let expected;
  try{expected=scalarBinary(op,tagScalar(a,aType),tagScalar(b,bType));}catch(e){assert.ok([6,11].includes(e.number),label);}
  const actual=foldNativeInteger(node,n=>n.name==='a'?{type:aType,value:a}:{type:bType,value:b});
  if(expected===undefined)assert.equal(actual,null,label);
  else{assert.ok(actual,label);assert.equal(actual.value,Object.is(unbox(expected),-0)?0:unbox(expected),label);assert.equal(nativeIntegerBinaryType(op,aType,bType),scalarType(expected),label);}
  vectors++;
 }
 assert.equal(vectors,4624);
});
test('typed unary folds preserve Byte masking and Integer overflow',()=>{
 for(const [type,inputs]of Object.entries(values))for(const input of inputs)for(const op of ['+','-','not']){
  let expected;try{expected=scalarUnary(op,tagScalar(input,type));}catch(e){assert.equal(e.number,6);}
  const actual=foldNativeInteger({kind:'unary',op,expr:id('a')},()=>({type,value:input}));
  if(expected===undefined)assert.equal(actual,null);else{assert.equal(actual.value,unbox(expected));assert.equal(nativeIntegerUnaryType(op,type),scalarType(expected));}
 }
});
for(const source of ['2000 * 365','(32767 + 1) - 1','-(-32768%)','32768%'])test('typed overflow is not folded away: '+source,()=>assert.equal(foldNativeInteger(parseExpression(source)),null));
for(const [source,value]of [['2000&*365',730000],['-32768',-32768],['-32768%',-32768],['-2147483648',-2147483648],['Not &HFFFF',0]])test('typed literal boundaries: '+source,()=>assert.equal(foldNativeInteger(parseExpression(source))?.value,value));
test('an explicit Double endpoint stays Double',()=>assert.equal(nativeSignedIntegerLiteral(parseExpression('-2147483648#')),null));
test('long expression trees compile with bounded type-cache work',()=>{
 const p={...newProject('Types'),startup:'Sub Main',modules:[{id:'m',name:'M',kind:'module',code:'Sub Main()\nDim n As Long\nn='+Array.from({length:180},(_,i)=>i+'&').join('+')+'\nEnd Sub'}]};
 const r=compileWin32(p,{optimization:2});assert.ok(r.report.optimization.constantsFolded>0);
});
