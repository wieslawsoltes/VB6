import {nativeControlCollectionMethods} from '../src/native/control-collections.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {newProject,createControl} from '../src/project/model.js';
import {compileWin32} from '../src/native/compiler.js';
import {nativeControlEvents} from '../src/native/control-plan.js';
import {nativeEventItemStorage} from '../src/native/control-items.js';
const gallery=()=>JSON.parse(fs.readFileSync(new URL('../examples/controls.vb6web',import.meta.url)));
function source(type,event,parameter,body,extra=''){
  const p=newProject('ItemABI'),m=p.modules[0],c=createControl(type,'View');
  c.properties[type==='TreeView'?'Nodes':'Items']=[{Key:'first',Text:'Live item'}];
  m.form.controls=[c];m.code=`Option Explicit\n${extra}\nPrivate Sub View_${event}(${parameter})\n${body}\nEnd Sub`;
  return p;
}
for(const optimization of [0,1,2])test(`original ControlGallery exports a deterministic freestanding PE32 at O${optimization}`,()=>{
  const p=gallery(),before=JSON.stringify(p),a=compileWin32(p,{optimization}),b=compileWin32(p,{optimization});
  assert.deepEqual(a.bytes,b.bytes);assert.equal(JSON.stringify(p),before);
  assert.equal(a.report.target,'win32-aot');assert.equal(a.report.extraction,false);
  const v=new DataView(a.bytes.buffer,a.bytes.byteOffset,a.bytes.byteLength),pe=v.getUint32(0x3c,true);
  assert.equal(v.getUint32(pe,true),0x4550);assert.equal(v.getUint16(pe+4,true),0x14c);
  for(const api of ['SendMessageW','GetMessagePos','ScreenToClient','IsWindow','SysReAllocStringLen'])assert.ok(a.report.imports.some(i=>i.symbol===api),api);
});
for(const [type,event,itemType] of [['TreeView','NodeClick','Node'],['ListView','ItemClick','ListItem']]){
  test(`${event} is routed only for the matching native control`,()=>{
    assert.ok(nativeControlEvents(type).includes(event.toLowerCase()));
    assert.ok(!nativeControlEvents('CommandButton').includes(event.toLowerCase()));
  });
  for(const spelling of ['Object',itemType,'MSComctlLib.'+itemType,'ComctlLib.'+itemType])for(const mode of ['ByVal','ByRef'])test(`${type} ${mode} ${spelling} borrows an activation-local item`,()=>{
    const p=source(type,event,`${mode} Item As ${spelling}`,'Dim s As String, n As Long\ns=Item.Text\ns=Item.Key\nn=Item.Index\nWith Item\ns=.Text\nEnd With');
    assert.ok(compileWin32(p).bytes.length);
    const c=p.modules[0].form.controls[0];c.properties.Index=7;
    p.modules[0].code=p.modules[0].code.replace(`(${mode} Item`, `(Index As Integer, ${mode} Item`);
    assert.ok(compileWin32(p).bytes.length);
  });
  for(const parameter of ['',`ByVal Item As Long`,`Optional Item As Object`,`Item() As Object`,`Item As Object, Other As Long`])test(`${event} rejects an incompatible event signature: ${parameter||'empty'}`,()=>{
    assert.throws(()=>compileWin32(source(type,event,parameter,'')),/requires|storage|array|argument|optional|param/i);
  });
  for(const body of ['Dim n As Long\nn=Item','Item=0','Item.Text="modified"','Item.SetFocus','Dim v As Variant\nv=Item','Dim n As Long\nn=VarPtr(Item)'])test(`${event} never exposes a borrowed descriptor as a scalar/pointer: ${body}`,()=>{
    assert.throws(()=>compileWin32(source(type,event,'ByVal Item As Object',body)),/Borrowed|read-only|not lowered|not available|object/i);
  });
}
test('recognition does not mutate shared source declarations or silently accept arbitrary Object variables',()=>{
  const decl={name:'Item',parameter:true,type:'Object',byRef:false},module={form:{controls:[{name:'Tree',type:'TreeView',properties:{}}]}},proc={name:'Tree_NodeClick',params:[decl]};
  const result=nativeEventItemStorage({fail:m=>{throw new Error(m);}},decl,module,proc);
  assert.equal(decl.type,'Object');assert.equal(result.nativeItem.kind,'node');
  assert.equal(nativeEventItemStorage({},decl,module,{...proc,name:'Unrelated'}),null);
  const p=newProject('UnknownObject');p.modules[0].code='Private value As Object';
  assert.throws(()=>compileWin32(p),/Native storage/);
});
test('With SelectedItem is lowered and selected item access is not an HWND caption read',()=>{
  const p=gallery();p.modules[0].code='Private Sub Form_Load()\nDim s As String\nWith TabStrip1.SelectedItem\n s=.Caption\nEnd With\nEnd Sub';
  const result=compileWin32(p);assert.ok(result.report.imports.some(i=>i.symbol==='SysReAllocStringLen'));
});

test('tree item handle identities exist before procedures are emitted, not only during form creation',()=>{
  const allocated=[],c={slot:name=>{allocated.push(name);return name;},fail:m=>{throw new Error(m);}};
  const owner={model:{name:'Tree',type:'TreeView',properties:{Nodes:[{Key:'child',Parent:'root',Text:'Child'},{Key:'root',Text:'Root'}]}},module:{name:'Form1'},key:'tree'};
  nativeControlCollectionMethods.prepareNativeControlCollections.call(c,owner);
  assert.deepEqual(owner.treePlan.map(n=>[n.index,n.handle]),[[1,'tree-item:Form1:tree:1'],[0,'tree-item:Form1:tree:0']]);
  assert.equal(new Set(allocated).size,3);
  for(const item of owner.treePlan)assert.ok(allocated.includes(item.handle));
});
