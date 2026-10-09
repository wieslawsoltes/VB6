import test from 'node:test';
import assert from 'node:assert/strict';
import {compileWin32,extractNativeDeclarations} from '../src/native/compiler.js';
import {newProject} from '../src/project/model.js';
import {NativeRecordLayouts} from '../src/native/records.js';
import {compileProject} from '../src/language/compiler.js';
function project(source){const p=newProject('NativeRecords');p.modules=[{id:'m',name:'Module1',kind:'module',code:source}];p.startup='Sub Main';return p;}
const compile=(source,options)=>compileWin32(project(source),options);
const point='Private Type POINTAPI\n x As Long\n y As Long\nEnd Type\n';
const main='Public Sub Main()\nEnd Sub';
test('POD record layout uses real field widths, padding and distinct Len/LenB sizes',()=>{
 const r=compile('Private Type Mixed\n tag As Byte\n code As Integer\n value As Double\n flag As Byte\nEnd Type\nDim item As Mixed\n'+main).report.records[0];
 assert.equal(r.size,16);assert.equal(r.fileSize,12);assert.deepEqual(r.fields.map(f=>[f.name,f.offset,f.bytes]),[['tag',0,1],['code',2,2],['value',4,8],['flag',12,1]]);
});
test('record locals, globals, field stores, whole-record snapshot copies and ByRef calls lower',()=>{
 const p=project(point+'Private saved As POINTAPI\nPrivate Sub Change(p As POINTAPI)\n p.x=p.x+1\nEnd Sub\nPublic Sub Main()\n Dim p As POINTAPI, q As POINTAPI\n p.x=12\n p.y=-7\n q=p\n Change q\n Change (p)\n saved=q\n Dim n As Long\n n=Len(p)+LenB(p)+VarPtr(p)\nEnd Sub');
 const before=JSON.stringify(p);for(const optimization of [0,1,2]){const result=compileWin32(p,{optimization});assert.ok(result.bytes.length);assert.equal(result.report.records[0].size,8);}assert.equal(JSON.stringify(p),before);
});
test('nested records and fixed numeric/record array fields use inline storage',()=>{
 const source=point+'Private Type BOX\n first As POINTAPI\n samples(-1 To 2, 3 To 4) As Integer\n corners(0 To 1) As POINTAPI\nEnd Type\n'+
 'Public Sub Main()\n Dim box As BOX, p As POINTAPI\n box.first.x=2\n box.samples(-1,3)=42\n box.corners(1).y=box.samples(-1,3)\n p=box.corners(1)\nEnd Sub';
 const result=compile(source);const box=result.report.records.find(r=>r.name==='module1.box');assert.equal(box.size,40);assert.deepEqual(box.fields.map(f=>f.offset),[0,8,24]);
});
test('Win32 declares accept typed ByRef records and explicit As Any storage',()=>{
 const source=point+'Private Declare Function GetCursorPos Lib "user32" (p As POINTAPI) As Long\n'+
 'Private Declare Sub CopyMemory Lib "kernel32" Alias "RtlMoveMemory" (dst As Any, src As Any, ByVal length As Long)\n'+
 'Public Sub Main()\n Dim p As POINTAPI, q As POINTAPI, n As Long\n n=GetCursorPos(p)\n CopyMemory q,p,LenB(p)\n CopyMemory ByVal VarPtr(q),ByVal VarPtr(p),LenB(p)\nEnd Sub';
 const result=compile(source);assert.ok(result.report.imports.some(i=>i.symbol==='GetCursorPos'));assert.ok(result.report.imports.some(i=>i.symbol==='RtlMoveMemory'));
});
test('numeric Len and LenB use physical storage widths rather than padded stack slots',()=>{
 compile('Public Sub Main()\n Dim b As Byte, i As Integer, l As Long, d As Double, n As Long\n n=Len(b)+LenB(i)+Len(l)+LenB(d)\nEnd Sub');
});
for(const [name,body,pattern]of [
 ['managed String','Private Type T\n text As String\nEnd Type\nDim v As T',/managed|String/],
 ['recursive record','Private Type T\n self As T\nEnd Type\nDim v As T',/Recursive/],
 ['dynamic array field','Private Type T\n values() As Long\nEnd Type\nDim v As T',/fixed-size/],
 ['record array',point+'Dim values() As POINTAPI',/arrays of records/],
 ['ByVal record',point+'Private Sub F(ByVal p As POINTAPI)\nEnd Sub',/ByRef|ByVal/],
 ['unknown external record','Private Declare Sub F Lib "x" (p As Missing)',/known ByRef/],
 ['external ByVal Any','Private Declare Sub F Lib "x" (ByVal p As Any)',/Declare/],
 ['too large','Private Type T\n data(0 To 524288) As Byte\nEnd Type\nDim v As T',/512 KiB/]
])test('record ABI fails closed: '+name,()=>assert.throws(()=>compile(body+'\n'+main),pattern));
test('mismatched record and scalar ByRef calls are diagnosed',()=>{
 for(const parameter of ['Long','OTHER'])assert.throws(()=>compile(point+'Private Type OTHER\n x As Long\n y As Long\nEnd Type\nPrivate Sub F(p As '+parameter+')\nEnd Sub\nPublic Sub Main()\nDim p As POINTAPI\nF p\nEnd Sub'),/exact/);
});
test('As Any refuses ambiguous String ownership, expressions and whole arrays',()=>{
 for(const [decl,value]of [['Dim s As String','s'],['Dim n As Long','(n)'],['Dim a(0 To 2) As Long','a'],['Dim n As Long','1+2']])assert.throws(()=>compile('Private Declare Sub F Lib "x" (p As Any)\nPublic Sub Main()\n'+decl+'\nF '+value+'\nEnd Sub'),/As Any/);
});
test('unknown fields, omitted subscripts and wrong ranks remain diagnostics',()=>{
 for(const expr of ['p.missing=1','p.data=1','p.data(1,2)=1'])assert.throws(()=>compile('Private Type T\n data(0 To 2) As Long\nEnd Type\nPublic Sub Main()\nDim p As T\n'+expr+'\nEnd Sub'),/field|rank/);
});
test('private record visibility and same-name record identity are distinct',()=>{
 const p=project('Public Sub Main()\nDim p As POINTAPI\nEnd Sub');p.modules.push({id:'other',name:'Other',kind:'module',code:point});assert.throws(()=>compileWin32(p),/storage/);
 const program=compileProject(project(point+main)),layouts=new NativeRecordLayouts(program);const module=program.modules.get('module1');assert.equal(layouts.resolve('POINTAPI',module).size,8);
});

test('Enum fields retain their Long storage identity for Len and ByRef calls',()=>{
 const result=compile('Private Enum E\n First=1\nEnd Enum\nPrivate Type T\n value As E\nEnd Type\nPrivate Sub F(n As Long)\n n=n+1\nEnd Sub\nSub Main()\n Dim t As T, n As Long\n t.value=First\n F t.value\n n=Len(t.value)\nEnd Sub');
 assert.equal(result.report.records[0].fields[0].type,'Long');assert.equal(result.report.records[0].fields[0].bytes,4);
});
