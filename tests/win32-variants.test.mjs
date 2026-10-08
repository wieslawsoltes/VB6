import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {storageLayout} from '../src/native/storage.js';
import {nativeCallMethods} from '../src/native/calls.js';
import {nativeVariantFixture} from '../tools/win32-variant-fixtures.mjs';
const project=(body,procedures='')=>({...newProject('VariantRegression'),startup:'Sub Main',modules:[{id:'m',name:'Entry',kind:'module',code:`Option Explicit\nSub Main()\n${body}\nEnd Sub\n${procedures}`}]});
for(const optimization of [0,1,2])test('complete Variant fixture links deterministically at O'+optimization,()=>{
 const {project:p,checks}=nativeVariantFixture(),before=JSON.stringify(p),r=compileWin32(p,{optimization});
 assert.equal(checks.length,194);assert.deepEqual(r.bytes,compileWin32(p,{optimization}).bytes);assert.equal(JSON.stringify(p),before);
 assert.equal(r.report.architecture,'x86');assert.equal(r.report.extraction,false);
 for(const name of ['VariantCopyInd','VariantClear','VariantChangeTypeEx','VarAdd','VarCmp','SafeArrayCreate','SafeArrayCopy'])assert.ok(JSON.stringify(r.report.imports).includes(name),name);
});
test('Variant function caller-owned result survives reachability pruning',()=>{
 const {project:p}=nativeVariantFixture(),r=compileWin32(p,{optimization:2,pruneUnusedProcedures:true});
 assert.ok(r.report.optimization.removedProcedures.includes('proc:Entry:NeverCalled'));
 for(const name of ['Echo','Factorial','DefaultMissing'])assert.ok(r.report.sourceMap.some(s=>s.procedure===name)||!r.report.optimization.removedProcedures.includes('proc:Entry:'+name));
});
for(const [type,bytes]of [['Variant',16],['Long',4],['Double',8],['String',4]])test('native storage width '+type,()=>{
 const c={fail:m=>{throw Error(m);}},v=storageLayout(c,{name:'value',type},{optionBase:0});assert.equal(v.nativeBytes,bytes);
});
test('Variant fixed array quotas account for sixteen-byte elements',()=>{
 const c={maxArrayBytes:64,fail:m=>{throw Error(m);}},m={optionBase:0};
 const d=upper=>({name:'values',type:'Variant',bounds:[[{kind:'literal',value:0},{kind:'literal',value:upper}]]});
 const v=storageLayout(c,d(3),m);assert.equal(v.nativeElementBytes,16);assert.equal(v.nativeDataBytes,64);assert.equal(v.nativeBytes,4);assert.equal(c.nativeVariantArraysUsed,true);
 assert.throws(()=>storageLayout(c,d(4),m),/budget/);
});
test('typed programs omit unused Variant helper imports',()=>{
 const r=compileWin32(project('Dim n As Long\nn=42'));assert.ok(!JSON.stringify(r.report.imports).includes('VariantCopyInd'));
});
for(const code of ['Dim value\nvalue=Null','Dim value As Variant\nvalue=CDec("0.1")','Dim a() As Variant\nReDim a(1 To 4)\na(1)="managed"\nErase a','Dim value As Variant\nvalue=OptionalValue()'])test('newly supported native source: '+code.split('\n').at(-1),()=>{
 assert.ok(compileWin32(project(code,'Function OptionalValue(Optional v As Variant) As Variant\nOptionalValue=v\nEnd Function')).bytes.length);
});
for(const [source,pattern]of [
 ['Dim v As Variant\nDim n As Long\nTakesLong v',/exact declared type/],
 ['Dim v As Variant\nDim a() As Long\nv=a',/array inside a Variant/],
 ['Dim v As Object',/Native storage/],
 ['Dim v As Variant\nv=New Collection',/expression|procedure|storage/]
])test('unsupported Variant boundary remains explicit: '+source.split('\n').at(-1),()=>assert.throws(()=>compileWin32(project(source,'Sub TakesLong(ByRef n As Long)\nEnd Sub')),pattern));
test('Variant hidden result counts against the stdcall argument byte limit',()=>{
 const c={fail:m=>{throw Error(m);}},context={proc:{kind:'function',returnType:'Variant',params:Array.from({length:16383},(_,i)=>({name:'p'+i,type:'Long',byRef:true}))}};
 assert.throws(()=>nativeCallMethods.prepareNativeParameters.call(c,context),/stdcall return limit/);
});
