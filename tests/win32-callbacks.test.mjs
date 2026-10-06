import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {callbackFixture,callbackThreadFixture} from '../tools/win32-callback-fixtures.mjs';
function project(body,callback='Private Function Target(ByVal value As Long) As Long\nTarget=value\nEnd Function',parameter='ByVal cb As Long') {
 const p=newProject('Callbacks');p.startup='Sub Main';p.modules=[{id:'entry',name:'Entry',kind:'module',code:`Private Declare Function Invoke Lib "probe.dll" (${parameter}) As Long\n${callback}\nSub Main()\n${body}\nEnd Sub`}];return p;
}
test('AddressOf reuses a static thunk without embedding executable heap allocation',()=>{
 const r=compileWin32(project('Dim n As Long\nn=Invoke(AddressOf Target)\nn=Invoke(AddressOf Target)'));
 assert.equal(r.report.callbacks.length,1);assert.equal(r.report.callbacks[0].argumentBytes,4);
 assert.equal(r.report.callbacks[0].thread,'application');assert.equal(r.report.callbacks[0].convention,'stdcall');
 assert.ok(r.report.callbacks[0].rva>0);
 assert.ok(r.report.imports.some(i=>i.symbol==='GetCurrentThreadId'));
 assert.ok(!r.report.imports.some(i=>/VirtualAlloc|VirtualProtect|LoadLibrary/.test(i.symbol)));
});
for(const type of ['Byte','Integer','Long','Boolean','Single','Double','Currency','Date'])test('numeric callback '+type+' has exact-width public ABI metadata',()=>{
 const r=compileWin32(project('Dim n As Long\nn=Invoke(AddressOf Target)',`Private Function Target(ByVal value As ${type}) As ${type}\nTarget=value\nEnd Function`));
 assert.equal(r.report.callbacks[0].argumentBytes,['Double','Currency','Date'].includes(type)?8:4);
});
test('named ByVal pointer arguments and scoped procedure names resolve callback identity',()=>{
 const p=project('Dim n As Long\nn=Invoke(cb:=AddressOf Other.Target)','');
 p.modules.push({id:'other',name:'Other',kind:'module',code:'Public Function Target() As Long\nTarget=1\nEnd Function'});
 const r=compileWin32(p);assert.equal(r.report.callbacks[0].module,'Other');assert.equal(r.report.callbacks[0].argumentBytes,0);
});
for(const signature of [
 'Private Function Target(Optional x As Long) As Long',
 'Private Function Target(ByRef x() As Long) As Long',
 'Private Function Target(ByVal x As String) As Long',
 'Private Function Target(ByRef x As String) As Long',
 'Private Function Target() As String'
])test('unsupported callback signature is explicitly rejected: '+signature,()=>{
 assert.throws(()=>compileWin32(project('Dim n As Long\nn=Invoke(AddressOf Target)',signature+'\nEnd Function')),/callbacks require fixed/i);
});
test('callback argument cannot be passed as an accidental pointer-to-pointer or floating value',()=>{
 for(const p of ['ByRef cb As Long','ByVal cb As Double','ByVal cb As Integer'])
  assert.throws(()=>compileWin32(project('Dim n As Long\nn=Invoke(AddressOf Target)',undefined,p)),/ByVal Long/);
});
test('AddressOf does not permit taking a foreign DLL function or an unknown address',()=>{
 for(const name of ['Invoke','Missing'])assert.throws(()=>compileWin32(project('Dim n As Long\nn=Invoke(AddressOf '+name+')')),/authored Sub or Function/);
});
test('AddressOf preserves private accessibility',()=>{
 const p=project('Dim n As Long\nn=Invoke(AddressOf Other.Target)','');
 p.modules.push({id:'other',name:'Other',kind:'module',code:'Private Function Target() As Long\nEnd Function'});
 assert.throws(()=>compileWin32(p),/Private native procedure/);
});
test('native callback cannot reference a form method or class instance',()=>{
 const p=project('Dim n As Long\nn=Invoke(AddressOf Form1.Target)','');
 const form=newProject('FormExample').modules[0];form.code='Public Function Target() As Long\nEnd Function';p.modules.push(form);
 assert.throws(()=>compileWin32(p),/standard module/);
});
test('AddressOf remains a call operand, not an arbitrary assignable code value',()=>{
 assert.throws(()=>compileWin32(project('Dim pointer As Long\npointer=AddressOf Target')),/not.*lowered|Unsupported/i);
});
test('callback fixture builds deterministic code without changing the project',()=>{
 const {project:p,checks}=callbackFixture(),before=JSON.stringify(p),r=compileWin32(p);
 assert.equal(JSON.stringify(p),before);assert.deepEqual(r.bytes,compileWin32(p).bytes);
 assert.equal(checks.length,21);assert.equal(r.report.callbacks.length,14);
 assert.ok(r.report.imports.some(i=>i.symbol==='EnumWindows'));
});
test('foreign-thread fixture has its own controlled error exit and no success assumption',()=>{
 const {project:p,expectedExit}=callbackThreadFixture();assert.equal(expectedExit,5);
 const result=compileWin32(p);assert.equal(result.report.callbacks.length,1);
 assert.ok(result.report.imports.some(i=>i.symbol==='InvokeOtherThread'));
});
test('normal projects do not allocate callback state or import thread APIs',()=>{
 const r=compileWin32(project('Dim n As Long\nn=1'));
 assert.deepEqual(r.report.callbacks,[]);assert.ok(!r.report.imports.some(i=>i.symbol==='GetCurrentThreadId'));
});
