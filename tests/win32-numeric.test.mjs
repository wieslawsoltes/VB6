import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {compileWin32,extractNativeDeclarations} from '../src/native/compiler.js';
import {nativeParameterBytes} from '../src/native/numeric.js';
import {storageLayout} from '../src/native/storage.js';
import {numericFixture,controlArrayFixture} from '../tools/win32-numeric-fixtures.mjs';
const calculator=()=>JSON.parse(fs.readFileSync(new URL('../examples/calculator.vb6web',import.meta.url),'utf8'));
function code(source){const p=calculator();p.modules[0].code=source;return compileWin32(p);}

test('unchanged shipped Calculator compiles with native numbers and indexed controls',()=>{
  const p=calculator(),before=JSON.stringify(p),r=compileWin32(p);
  assert.equal(JSON.stringify(p),before);
  assert.equal(r.report.extraction,false);assert.equal(r.report.architecture,'x86');
  const names=r.report.imports.map(i=>i.symbol);
  for(const name of ['VarR8FromStr','VarBstrFromR8','CreateWindowExW','CreateFontW','GetDeviceCaps'])assert.ok(names.includes(name),name);
  assert.ok(r.report.sourceMap.some(s=>s.procedure==='cmdDigit_Click'));
  assert.ok(r.report.sourceMap.some(s=>s.procedure==='cmdOperator_Click'));
  assert.deepEqual(r.bytes,compileWin32(calculator()).bytes);
});
for(const project of [numericFixture(),controlArrayFixture()])test('links numeric execution fixture '+project.name,()=>{
  const r=compileWin32(project);assert.equal(r.bytes[0],77);assert.equal(r.bytes[1],90);
  assert.deepEqual(r.bytes,compileWin32(project).bytes);
});
test('native floating storage widths and stdcall argument slots are distinct',()=>{
  for(const [type,width]of [['Byte',1],['Integer',2],['Boolean',2],['Long',4],['Single',4],['Double',8]]){
    const d={name:'n',type,bounds:null};storageLayout({fail:message=>{throw Error(message);}},d,{});assert.equal(d.nativeElementBytes,width);assert.equal(d.nativeBytes,Math.max(width,4));
  }
  assert.equal(nativeParameterBytes({type:'Double',byRef:false}),8);
  assert.equal(nativeParameterBytes({type:'Single',byRef:false}),4);
  assert.equal(nativeParameterBytes({type:'Double',byRef:true}),4);
  assert.equal(nativeParameterBytes({type:'Double',byRef:true,bounds:[]}),4);
});
test('Declare retains mixed double/single/narrow stdcall types',()=>{
  const d=extractNativeDeclarations({name:'M',code:'Private Declare Function Number Lib "test.dll" (ByVal x As Double, ByVal y As Single, z As Double, ByVal n As Integer) As Double'}).declarations.get('number');
  assert.deepEqual(d.params.map(p=>[p.type,p.byRef]),[['Double',false],['Single',false],['Double',true],['Integer',false]]);
  assert.equal(d.returnType,'Double');
});
for(const type of ['Single','Double'])test(type+' storage, arrays, calls and floating return compile',()=>{
  code(`Private a() As ${type}\nPrivate Function Identity(ByVal x As ${type}) As ${type}\n Identity=x\nEnd Function\nPrivate Sub Form_Load()\n Dim n As ${type}\n ReDim a(-2 To 4)\n n=Identity(1.25)\n a(-2)=n\n ReDim Preserve a(-2 To 8)\n n=a(-2)\nEnd Sub`);
});
test('numeric conversions retain error recovery rather than truncating division',()=>{
  code('Private Sub Form_Load()\nOn Error Resume Next\nDim d As Double, n As Long\nd=1/2\nIf d Then n=CLng(2.5)\nd=Sqr(-1)\nd=Round(1.25,1)\nEnd Sub');
});
test('native array ByRef calls require exact floating storage types',()=>{
  for(const decl of ['Dim d As Single','Dim d() As Single']){
    const array=decl.includes('()');
    assert.throws(()=>code(`Private Sub F(d${array?'()':''} As Double)\nEnd Sub\nPrivate Sub Form_Load()\n${decl}\nF d\nEnd Sub`),/exact/);
  }
});
test('nonfinite literal is rejected and no valid EXE is returned',()=>{
  assert.throws(()=>code('Private Sub Form_Load()\nDim d As Double\nd=1E999\nEnd Sub'),/finite|literal|constant|Invalid/i);
});
for(const expression of ['CDbl()','CSng(1,2)','Val()','Round(1,2,3)','Sqr()','InStr(1)','InStr(1,2,3,4,5)'])test('builtin arity diagnosed: '+expression,()=>{
  assert.throws(()=>code(`Private Sub Form_Load()\nDim d As Double\nd=${expression}\nEnd Sub`),/expects/);
});
test('control array groups expose bounds, Index and independent native handles',()=>{
  code('Private Sub Form_Load()\nDim i As Integer, h As Long\nFor i=cmdDigit.LBound To cmdDigit.UBound\nh=cmdDigit(i).hWnd\ncmdDigit(i).Caption=CStr(cmdDigit(i).Index)\nNext\nEnd Sub');
});
for(const mutation of [
 p=>p.modules[0].form.controls.push(structuredClone(p.modules[0].form.controls.find(c=>c.name==='cmdDigit'))),
 p=>p.modules[0].form.controls.find(c=>c.name==='cmdDigit').properties.Index=-1,
 p=>p.modules[0].form.controls.find(c=>c.name==='cmdDigit').properties.Index=32768,
 p=>delete p.modules[0].form.controls.find(c=>c.name==='cmdDigit').properties.Index,
 p=>p.modules[0].form.controls.find(c=>c.name==='cmdDigit').type='CheckBox'
])test('invalid control array shape is rejected atomically '+mutation.toString(),()=>{
  const p=calculator();mutation(p);assert.throws(()=>compileWin32(p),/control|Index|array/i);
});
for(const expression of ['cmdDigit.Caption','cmdDigit().Caption','cmdDigit(1,2).Caption'])test('indexed control access validated: '+expression,()=>{
  assert.throws(()=>code(`Private Sub Form_Load()\ntxtDisplay.Text=${expression}\nEnd Sub`),/Index/i);
});
test('unsupported Variant is still rejected instead of inventing native storage',()=>{
  assert.throws(()=>code('Dim v As Variant'),/storage/);
});
