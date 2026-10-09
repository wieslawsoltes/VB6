import {nativeListInitialSelection} from '../src/native/control-lists.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
function project(source,type='ListBox',properties={}){
  const p=newProject('Lists'),form=p.modules[0],control=createControl(type,'Items');
  Object.assign(control.properties,properties);form.form.controls=[control];
  form.code=`Option Explicit\nPrivate Sub Form_Load()\n${source}\nEnd Sub`;return p;
}
for(const optimization of [0,1,2])test(`native indexed-list fixture emits deterministic, non-extracting PE32 at O${optimization}`,()=>{
  const {project:p,checks}=nativeControlFixtures().find(f=>f.project.name==='AotControlLists');
  const before=JSON.stringify(p),a=compileWin32(p,{optimization}),b=compileWin32(p,{optimization});
  assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(p),before);
  assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);assert.equal(checks.length,33);
  const v=new DataView(a.bytes.buffer,a.bytes.byteOffset,a.bytes.byteLength),pe=v.getUint32(0x3c,true);
  assert.equal(v.getUint32(pe,true),0x4550);assert.equal(v.getUint16(pe+4,true),0x14c);
  for(const symbol of ['SendMessageW','IsWindow','GetWindowLongW','SysAllocStringLen','SysReAllocStringLen','SysFreeString'])assert.ok(a.report.imports.some(i=>i.symbol===symbol),symbol);
  assert.ok(checks.some(c=>c.includes('ByRef')));assert.ok(checks.some(c=>c.includes('4096')));assert.ok(checks.some(c=>c.includes('signed LONG')));
});
for(const type of ['ListBox','ComboBox'])test(`${type} AddItem, NewIndex, ItemData and List signatures compile without rewriting authored code`,()=>{
  const p=project('Dim n As Long,s As String\nItems.AddItem "first"\nItems.AddItem index:=0,item:="before"\nItems.ItemData(Items.NewIndex)=-1\nn=Items.ItemData(index:=0)\ns=Items.List(index:=0)\nItems.RemoveItem index:=0\nItems.Clear()',type);
  const before=JSON.stringify(p);assert.ok(compileWin32(p).bytes.length);assert.equal(JSON.stringify(p),before);
});
for(const source of ['Items.AddItem','Items.AddItem "x",0,1','Items.AddItem text:="x"','Items.AddItem "x",item:="y"','Items.AddItem item:="x",0',
 'Items.RemoveItem','Items.Clear 0','Dim n As Long\nn=Items.ItemData()','Items.ItemData(0,1)=1','Dim s As String\ns=Items.List(typo:=0)',
 'Items.Selected()=True','Items.NewIndex=1'])test('invalid native list signature is rejected: '+source,()=>{
  assert.throws(()=>compileWin32(project(source)),/Missing|required|Too many|Unknown|Duplicate|Positional|optional|read-only/i);
});
test('native ComboBox does not acquire a fabricated Selected(index) API',()=>{
  assert.throws(()=>compileWin32(project('Items.Selected(0)=True','ComboBox')),/Selected\(index\) requires.*ListBox/);
});
for(const value of [[1.5],[-2147483649],[2147483648],['17'],[1,2],{},null])test('invalid saved ItemData is diagnosed, not silently truncated: '+JSON.stringify(value),()=>{
  assert.throws(()=>compileWin32(project('','ListBox',{List:['item'],ItemData:value})),/ItemData must be signed LONGs/);
});
test('unsupported List assignment is not silently redirected to a get or a global call',()=>{
  assert.throws(()=>compileWin32(project('Items.List(0)="new"')),/List\(index\) assignment is not yet lowered/);
});

test('initial no-selection never emits the native multi-select-all sentinel',()=>{
  for(const MultiSelect of [1,2]){
    assert.deepEqual(nativeListInitialSelection('ListBox',{List:['a','b'],ListIndex:-1,MultiSelect}),[]);
    assert.deepEqual(nativeListInitialSelection('ListBox',{List:['a','b'],ListIndex:1,MultiSelect}),[[0x185,1,1],[0x19e,1,0]]);
  }
  assert.deepEqual(nativeListInitialSelection('ListBox',{List:[],ListIndex:-1,MultiSelect:0}),[[0x186,-1,0]]);
  assert.deepEqual(nativeListInitialSelection('ComboBox',{List:[],ListIndex:-1}),[[0x14e,-1,0]]);
  for(const ListIndex of [-2,2,0.5,NaN])assert.throws(()=>nativeListInitialSelection('ListBox',{List:['a','b'],MultiSelect:2,ListIndex}),/ListIndex/);
});
