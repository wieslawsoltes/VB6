import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32} from '../src/native/compiler.js';
import {storageLayout} from '../src/native/storage.js';
import {newProject} from '../src/project/model.js';
import {win32StorageFixtures,win32ErrorFixtures} from '../tools/win32-storage-fixtures.mjs';

const literal=value=>({kind:'literal',value});
function build(code){const project=newProject('NativeStorage');project.startup='Sub Main';project.modules=[{id:'main',name:'MainModule',kind:'module',code}];return compileWin32(project);}
const declaration=(type,bounds=null)=>({name:'values',type,bounds});
const compiler={fail(message){throw new Error(message);}};
for(const [type,bytes]of [['Byte',1],['Integer',2],['Boolean',2],['Long',4],['String',4]]){
  test('native '+type+' array has explicit bounds, element width and first-dimension-contiguous strides',()=>{
    const d=storageLayout(compiler,declaration(type,[[literal(-2),literal(2)],[literal(3),literal(5)]]),{optionBase:0});
    assert.equal(d.nativeCount,15);assert.equal(d.nativeElementBytes,bytes);assert.equal(d.nativeBytes,4);assert.equal(d.nativeDataBytes,15*bytes);assert.equal(d.nativeArray,true);
    assert.deepEqual(d.nativeBounds,[{lower:-2,upper:2,stride:bytes},{lower:3,upper:5,stride:5*bytes}]);
  });
}
test('native Option Base applies to omitted lower bounds only',()=>{
  const d=storageLayout(compiler,declaration('Long',[[null,literal(3)],[literal(0),literal(2)]]),{optionBase:1});
  assert.deepEqual(d.nativeBounds,[{lower:1,upper:3,stride:4},{lower:0,upper:2,stride:12}]);assert.equal(d.nativeCount,9);
});
for(const [name,bounds]of [['reversed',[[literal(5),literal(4)]]],['too large',[[literal(0),literal(536870911)]]],['fractional',[[literal(0.5),literal(3)]]],['overflow',[[literal(0),literal(2147483648)]]]]){
  test('native storage rejects '+name+' arrays',()=>assert.throws(()=>storageLayout(compiler,declaration('Long',bounds),{optionBase:0})));
}
for(const [name,code]of [
  ['rank mismatch','Dim a(2,3) As Long\na(1)=0'],
  ['whole-array assignment','Dim a(2) As String\na="bad"'],
  ['dynamic resizing','Dim a(2) As Long\nReDim a(3)'],
  ['string length zero','Dim a As String * 0'],
  ['string length too large','Dim a As String * 65536'],
  ['string length negative','Dim a As String * -1'],
]){
  test('native compiler diagnoses '+name,()=>{
    assert.throws(()=>build('Public Sub Main()\n'+code+'\nEnd Sub'));
  });
}
for(const code of [
  'Private Sub SetValue(ByRef n As Long)\nEnd Sub\nPublic Sub Main()\nDim a(2) As Long\nSetValue a\nEnd Sub',
  'Private Sub SetValue(ByRef n As String)\nEnd Sub\nPublic Sub Main()\nDim a As String * 5\nSetValue a\nEnd Sub',
  'Public Sub Main()\nErr.Raise 5, "custom source"\nEnd Sub',
  'Public Sub Main()\nDim n As Long\nn=Err.HelpContext\nEnd Sub'
])test('unsupported native ABI/error extensions fail closed: '+code.split('\n')[0],()=>assert.throws(()=>build(code)));
test('native String ownership uses Automation allocation and release, not fixed scratch buffers',()=>{
  const result=compileWin32(win32StorageFixtures()[0]);const imports=new Set(result.report.imports.map(i=>i.symbol));
  for(const symbol of ['SysAllocStringLen','SysStringLen','SysFreeString','VarBstrCat'])assert.ok(imports.has(symbol),symbol);
  assert.ok(!imports.has('lstrcatW'));assert.ok(result.report.sourceMap.some(x=>x.procedure==='RecursiveText'));
  assert.equal(result.report.extraction,false);assert.ok(result.bytes.length<100*1024);
});
test('native String BSTR literals preserve explicit length including embedded NUL',()=>{
  const text='A\0Z';const result=build('Public Sub Main()\nDim s As String\ns="'+text+'"\nEnd Sub');
  const bytes=Buffer.from(result.bytes),needle=Buffer.from(text+'\0','utf16le'),index=bytes.indexOf(needle);
  assert.ok(index>4);assert.equal(bytes.readUInt32LE(index-4),text.length*2);
});
test('native error recovery preserves stable source mappings and deterministic bytes',()=>{
  const project=win32ErrorFixtures()[0],before=JSON.stringify(project),a=compileWin32(project),b=compileWin32(project);
  assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(project),before);
  assert.ok(a.report.sourceMap.some(x=>x.procedure==='Leaf'));
  for(const entry of a.report.sourceMap)assert.ok(Number.isInteger(entry.rva));
});
test('native forms support stored strings, arrays and fixed String initialization',()=>{
  const p=newProject();p.modules[0].code='Private names(2) As String\nPrivate title As String * 4\nPrivate Sub Form_Load()\nnames(1)="one"\nCaption=title & names(1)\nEnd Sub';
  assert.ok(compileWin32(p).bytes.length);
});

test('Option Compare Text lowers through length-aware Windows collation',()=>{
  const code='Option Compare Text\nSub Main()\nDim a As String\na="A"\nIf a="a" Then a="b"\nEnd Sub';
  const result=build(code);assert.ok(result.report.imports.some(i=>i.symbol==='CompareStringW'));assert.deepEqual(result.bytes,build(code).bytes);
});

test('native Option Compare Text uses the installed Windows NLS comparison path',()=>{
  const result=build('Option Compare Text\nPublic Sub Main()\nDim a As String\na="A"\nIf a="a" Then a="b"\nEnd Sub');
  assert.ok(result.report.imports.some(i=>i.symbol==='CompareStringW'));
});
