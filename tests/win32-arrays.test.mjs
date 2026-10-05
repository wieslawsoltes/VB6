import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {storageLayout} from '../src/native/storage.js';
import {newProject} from '../src/project/model.js';
import {win32ArrayFixtures} from '../tools/win32-array-fixtures.mjs';
const fail={fail(message){throw new Error(message);}};
function build(code) {
  const p=newProject('ArrayContract');p.startup='Sub Main';p.modules=[{id:'m',name:'ArrayModule',kind:'module',code}];return compileWin32(p);
}
for(const type of ['Byte','Integer','Long','Boolean','String']) {
  test('dynamic '+type+' arrays have an owned, initially empty descriptor slot',()=>{
    const v=storageLayout(fail,{name:'a',type,bounds:[]},{optionBase:0});
    assert.equal(v.nativeArray,true);assert.equal(v.nativeDynamic,true);assert.equal(v.nativeBytes,4);
    assert.equal(v.nativeCount,0);assert.equal(v.nativeDataBytes,0);assert.deepEqual(v.nativeBounds,[]);
    assert.ok(build('Public Sub Main()\nDim a() As '+type+'\nReDim a(-3 To 7)\nReDim Preserve a(-3 To 10)\nErase a\nEnd Sub').bytes.length);
  });
}
for(const [name,code] of [
  ['array/scalar mismatch','Dim a() As Long\nDim n As Long\na=n'],
  ['distinct element types','Dim a() As Long\nDim b() As Integer\na=b'],
  ['fixed destination','Dim a(2) As Long\nDim b() As Long\na=b'],
  ['resizing a scalar','Dim a As Long\nReDim a(2)'],
  ['resizing a fixed array','Dim a(2) As Long\nReDim Preserve a(3)'],
  ['undeclared ReDim','ReDim missing(3) As Long'],
  ['changing declared type','Dim a() As Long\nReDim a(2) As Byte'],
  ['excess rank','Dim a() As Long\nReDim a(1,1,1,1,1,1,1,1,1)'],
  ['unsupported object elements','Dim a() As Object'],
  ['unsupported Variant elements','Dim a() As Variant'],
  ['different fixed String lengths','Dim a() As String * 3\nDim b() As String * 4\na=b'],
])test('native arrays diagnose '+name,()=>assert.throws(()=>build('Public Sub Main()\n'+code+'\nEnd Sub')));
for(const [name,param,arg,decl] of [
  ['ByVal arrays','ByVal a() As Long','values','Dim values() As Long'],
  ['element-type mismatch','ByRef a() As Long','values','Dim values() As Integer'],
  ['scalar argument','ByRef a() As Long','value','Dim value As Long'],
  ['indexed argument','ByRef a() As Long','values(1)','Dim values() As Long'],
  ['fixed String whole-array parameter','ByRef a() As String','values','Dim values() As String * 3'],
])test('native array call rejects '+name,()=>assert.throws(()=>build('Private Sub Accept('+param+')\nEnd Sub\nPublic Sub Main()\n'+decl+'\nAccept '+arg+'\nEnd Sub')));
test('whole-array ByRef accepts fixed and dynamic arrays and forwards borrowed slots',()=>{
  const out=build('Private Sub Inner(ByRef a() As Long)\na(LBound(a))=42\nEnd Sub\nPrivate Sub Outer(ByRef a() As Long)\nInner a\nEnd Sub\nPublic Sub Main()\nDim d() As Long\nDim f(1) As Long\nReDim d(1)\nOuter d()\nOuter f\nEnd Sub');
  assert.ok(out.report.sourceMap.some(v=>v.procedure==='Inner'));
});
test('dynamic array lowering imports checked Automation lifetime, copy and locking APIs',()=>{
  const p=win32ArrayFixtures()[0],original=JSON.stringify(p),a=compileWin32(p),b=compileWin32(p);
  const names=new Set(a.report.imports.map(i=>i.symbol));
  for(const name of ['SafeArrayCreate','SafeArrayRedim','SafeArrayDestroy','SafeArrayCopy','SafeArrayLock','SafeArrayUnlock','SafeArrayPtrOfIndex','SafeArrayGetDim','SafeArrayGetLBound','SafeArrayGetUBound'])assert.ok(names.has(name),name);
  assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(p),original);assert.equal(a.report.extraction,false);
  assert.ok(a.report.sourceMap.some(v=>v.procedure==='PinValue'));
  assert.ok(a.report.sourceMap.some(v=>v.procedure==='RecursiveArray'));
  assert.ok(a.bytes.length<100*1024);
});
