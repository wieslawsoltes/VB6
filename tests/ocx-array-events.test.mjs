import test from 'node:test';
import assert from 'node:assert/strict';
import {OcxEventHub} from '../src/controls/ocx-events.js';
import {SourceUserControl} from '../src/controls/ocx-source.js';
import {decodeAutomationValue} from '../src/runtime/automation-wire.js';
import {VBArray,tagScalar,scalarType} from '../src/runtime/values.js';
import {ControlAdapterRegistry} from '../src/controls/adapters.js';
import {handlerEdit} from '../src/editor/event-completion.js';
import {createControl,newProject} from '../src/project/model.js';
const iid='12345678-1234-1234-1234-123456789abc';
const interfaces=()=>[{iid,events:[{name:'Data',params:[{name:'Values',type:'Long',array:true,byRef:true}]}]}];
const hub=()=>new OcxEventHub(interfaces());
const array=()=>{const a=new VBArray([[-1,0],[3,4]],'Long');a.set([-1,3],tagScalar(7,'long'));return a;};
test('typed array event cells retain multidimensional bounds and scalar element tags',async()=>{
 const h=hub(),input=array();h.advise(iid,(_,args)=>{const a=args[0].ref.get();assert.deepEqual(a.bounds,[[-1,0],[3,4]]);assert.equal(scalarType(a.getScalar(-1,3)),'long');a.set([-1,3],9);});
 const result=await h.dispatch(iid,'Data',[input]);assert.equal(result.args[0].get(-1,3),9);assert.equal(input.get(-1,3),7);h.close();
});
test('typed array event replacement copies back in subscriber order and rejects wrong element storage',async()=>{
 const h=hub();h.advise(iid,(_,args)=>{assert.throws(()=>args[0].ref.set(new VBArray([[1,2]],'String')),/Array type mismatch/);const replacement=new VBArray([[5,6]],'Long');replacement.set([5],99);args[0].ref.set(replacement);});
 h.advise(iid,(_,args)=>assert.equal(args[0].ref.get().get(5),99));const result=await h.dispatch(iid,'Data',[array()]);assert.deepEqual(result.args[0].bounds,[[5,6]]);h.close();
});
test('array event metadata forbids ByVal arrays and invalid array flags',()=>{
 for(const params of [{name:'Values',type:'Long',array:true},{name:'Values',type:'Long',array:'yes',byRef:true}])assert.throws(()=>new OcxEventHub([{iid,events:[{name:'Data',params:[params]}]}]),/ByRef/);
});
test('array payload validation precedes subscribers even when events are frozen',async()=>{
 const h=hub();let calls=0;h.advise(iid,()=>calls++);h.freeze(true);for(const a of [4,[1,2],new VBArray([[0,0]],'Byte')])await assert.rejects(h.dispatch(iid,'Data',[a]),/array type mismatch/);assert.equal(calls,0);assert.deepEqual((await h.dispatch(iid,'Data',[array()])).args[0].bounds,[[-1,0],[3,4]]);h.close();
});
test('empty dynamic and zero-length typed arrays are valid event values',async()=>{
 for(const a of [new VBArray([],'Long'),decodeAutomationValue({t:'array',elementType:3,bounds:[[4,3]],v:[]})]){const h=hub();let seen;h.advise(iid,(_,args)=>seen=args[0].ref.get());await h.dispatch(iid,'Data',[a]);assert.equal(seen.data.length,0);assert.deepEqual(seen.bounds,a.bounds);h.close();}
});
function project(code){return {name:'Arrays',modules:[{name:'ArrayControl',kind:'form',form:{name:'ArrayControl',type:'UserControl',properties:{}},code}]};}
const code=`Option Explicit
Public Event Data(ByRef Values() As Long)
Private Values() As Long
Private Sub UserControl_InitProperties()
 ReDim Values(-1 To 1)
 Values(-1) = 8
End Sub
Public Function Fire() As Long
 RaiseEvent Data(Values)
 Fire = Values(-1)
End Function
Private Sub UserControl_HitTest(ByRef Values() As Long)
 Values(-1) = Values(-1) + 10
End Sub`;
test('actual compiled VB RaiseEvent shares its typed array reference with source host',async()=>{
 const c=await SourceUserControl.create(project(code),'ArrayControl');try{assert.equal(c.Events[0].params[0].array,true);c.subscribe((_,args)=>{assert.deepEqual(args[0].ref.get().bounds,[[-1,1]]);args[0].ref.get().set([-1],42);});assert.equal(await c.invoke('Fire'),42);}finally{await c.close();}
});
test('source input dispatch returns typed array copyback without mutating the caller snapshot',async()=>{
 const c=await SourceUserControl.create(project(code),'ArrayControl'),a=new VBArray([[-1,1]],'Long');a.set([-1],3);try{const result=await c.dispatchControlEvent('HitTest',[a]);assert.equal(result.args[0].get(-1),13);assert.equal(a.get(-1),3);await assert.rejects(c.dispatchControlEvent('HitTest',[new VBArray([[-1,1]],'Byte')]),/array type mismatch/);}finally{await c.close();}
});
test('typed array event source mismatch is rejected before host invocation',async()=>{
 const c=await SourceUserControl.create(project(code.replace('Private Values() As Long','Private Values() As Byte')),'ArrayControl');let calls=0;try{c.subscribe(()=>calls++);await assert.rejects(c.invoke('Fire'),/array type mismatch/);assert.equal(calls,0);}finally{await c.close();}
});
test('control-array event tooling emits both Index and correctly typed array parameters',()=>{
 const p=newProject(),m=p.modules.find(m=>m.form),control=createControl('Acme.Arrays','Array1');control.properties.Index=2;m.form.controls.push(control);
 const registry=new ControlAdapterRegistry().register('Acme.Arrays',{runtime(){},metadata:{events:interfaces()[0].events}});
 const edit=handlerEdit(p,m,{index:()=>({symbols:[],interfaces:[],procedures:[]})},'Array1','Data',registry);assert.match(edit.text,/Index As Integer, ByRef Values\(\) As Long/);
});
