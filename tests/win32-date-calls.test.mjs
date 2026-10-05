import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32,NativeCompileError} from '../src/native/compiler.js';
import {nativeCallMethods} from '../src/native/calls.js';
import {dateCallFixture} from '../tools/win32-date-call-fixtures.mjs';
import {newProject} from '../src/project/model.js';
const project=(body,decl='')=>{
  const p=newProject('DateCalls');p.startup='Sub Main';
  p.modules=[{id:'entry',name:'Entry',kind:'module',code:`Option Explicit\n${decl}\nSub Main()\n${body}\nEnd Sub`}];return p;
};
for(const by of ['ByVal','ByRef'])for(const value of ['','#2024-02-29 06:00:00#','#0100-01-01#','#9999-12-31#']){
 test(`Optional ${by} Date default ${value||'(zero)'} compiles`,()=>{
  const p=project('Dim d As Date\nd = F()\nd = F(value:=#2024-02-29#)',`Function F(Optional ${by} value As Date${value?' = '+value:''}) As Date\nF=value\nEnd Function`);
  const before=JSON.stringify(p),result=compileWin32(p);assert.equal(JSON.stringify(p),before);assert.deepEqual(result.bytes,compileWin32(p).bytes);
 });
}
test('Date ByRef value copy reserves eight bytes, not the size of its pointer',()=>{
 const seen=[],c={...nativeCallMethods,variable:()=>null,
  arrayWorkspace:(bytes,kind)=>{seen.push([bytes,kind]);return {nativeBytes:bytes};},
  storageExpression:(slot,node)=>seen.push(['convert',slot.type,node]),store:slot=>seen.push(['store',slot.nativeBytes]),rawStorageAddress:slot=>seen.push(['address',slot.nativeBytes])};
 const node={kind:'group',expr:{kind:'literal',value:0.5}};
 const result=c.nativeReferenceArgument({type:'Date'},node);
 assert.equal(result.temporary.nativeBytes,8);assert.equal(result.temporary.type,'Date');
 assert.deepEqual(seen,[[8,'byref-value'],['convert','Date',node],['store',8],['address',8]]);
});
for(const [body,pattern]of [
 ['Dim d As Double\nF d',/exact declared type/],
 ['Dim a() As Date\nF a',/scalar of the exact declared type/],
 ['Call F(ByVal 0)',/Call-site ByVal/]
])test('Date integration retains genuine-reference ABI guards: '+body,()=>{
 assert.throws(()=>compileWin32(project(body,'Sub F(ByRef value As Date)\nEnd Sub')),pattern);
});
for(const initial of ['2958466#','-657435#','"invalid"'])test('Date optional default fails at its declaration: '+initial,()=>{
 assert.throws(()=>compileWin32(project('F',`Sub F(Optional value As Date = ${initial})\nEnd Sub`)),e=>e instanceof NativeCompileError&&e.diagnostics[0].source==='Entry'&&e.diagnostics[0].line===2);
});
test('Date optional array parameters remain diagnosed',()=>{
 assert.throws(()=>compileWin32(project('F','Sub F(Optional values() As Date)\nEnd Sub')),/Optional native array/);
});
test('native Date call fixture retains all source and has deterministic output',()=>{
 const {project:p,checks}=dateCallFixture(),before=JSON.stringify(p),result=compileWin32(p);
 assert.equal(checks.length,29);assert.equal(JSON.stringify(p),before);assert.deepEqual(result.bytes,compileWin32(p).bytes);
});
