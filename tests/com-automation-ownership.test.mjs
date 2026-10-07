import test from 'node:test';
import assert from 'node:assert/strict';
import {AutomationRegistry,automationInvoke} from '../src/runtime/automation.js';
import {registerComClass} from '../src/runtime/com-automation.js';
import {DispatchObject,IID} from '../packages/com-ole/src/com.js';
import {Cell,VBArray} from '../src/runtime/values.js';
function fixture(){let native;const registry=registerComClass(new AutomationRegistry(),'Test.Object',()=>native=new DispatchObject([
  {name:'Value',dispid:1,params:[],get:()=>17},
  {name:'Keep',dispid:2,params:[{name:'value',byRef:true}],method:()=>{}},
  {name:'Echo',dispid:3,params:[{name:'value'}],method:([v])=>v},
  {name:'Replace',dispid:4,params:[{name:'value',byRef:true}],method:([v])=>{v.value=v.value.QueryInterface(IID.IDispatch);}},
  {name:'Retain',dispid:5,params:[{name:'value'}],method:([v])=>{v.AddRef();return v;}},
  {name:'Owned',dispid:6,params:[{name:'value'}],method:([v])=>v.QueryInterface(IID.IDispatch)},
  {name:'Misuse',dispid:7,params:[{name:'value'}],method:([v])=>v.Release()}
]));return {session:registry.createSession(),get native(){return native;}};}
for(const name of ['Keep','Replace'])test('ByRef '+name+' preserves the session-owned interface',async()=>{
  const f=fixture(),o=await f.session.create('Test.Object'),cell=new Cell('Object',o);
  try{for(let i=0;i<20;i++){await automationInvoke(o,name,1,[{ref:cell}]);assert.equal(await cell.get(),o);assert.equal(await automationInvoke(o,'Value',2),17);assert.equal(f.native.referenceCount,1);}}
  finally{await f.session.close();}assert(f.native.disposed);
});
for(const name of ['Echo','Retain','Owned'])test('object result '+name+' uses one owned return reference',async()=>{
  const f=fixture(),o=await f.session.create('Test.Object');try{for(let i=0;i<20;i++){assert.equal(await automationInvoke(o,name,1,[o]),o);assert.equal(f.native.referenceCount,1);}}
  finally{await f.session.close();}assert(f.native.disposed);
});
test('ByRef object arrays and echoed object arrays preserve every borrowed reference',async()=>{
  const f=fixture(),o=await f.session.create('Test.Object'),array=VBArray.from([o,o],-2),cell=new Cell('Variant',array);
  try{for(let i=0;i<20;i++){await automationInvoke(o,'Keep',1,[{ref:cell}]);const copied=await automationInvoke(o,'Echo',1,[await cell.get()]);assert.deepEqual(copied.data,[o,o]);assert.deepEqual(copied.bounds,[[-2,-1]]);assert.equal(f.native.referenceCount,1);}}
  finally{await f.session.close();}assert(f.native.disposed);
});
test('releasing a borrowed argument cannot invalidate its owner',async()=>{
  const f=fixture(),o=await f.session.create('Test.Object');try{await assert.rejects(automationInvoke(o,'Misuse',1,[o]),e=>e.number===440);assert.equal(await automationInvoke(o,'Value',2),17);assert.equal(f.native.referenceCount,1);}finally{await f.session.close();}
});
