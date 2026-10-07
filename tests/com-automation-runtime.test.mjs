import test from 'node:test';
import assert from 'node:assert/strict';
import {AutomationRegistry,automationInvoke,isAutomationObject} from '../src/runtime/automation.js';
import {registerComClass,createComAutomationRegistry} from '../src/runtime/com-automation.js';
import {ComObject,DispatchObject,ComClassFactory,ComClassRegistry,ComEnumerator,RunningObjectTable,DisplayNameMoniker,IID} from '../packages/com-ole/src/com.js';
import {MISSING,VBArray,tagScalar} from '../src/runtime/values.js';
import {compileProject} from '../src/language/compiler.js';
import {VirtualMachine} from '../src/runtime/vm.js';
const adapter=value=>({metadata:{members:[{name:'Value',params:[],modes:[2]}]},invoke(){return {value};},release(){}});
async function run(code,registry){const program=compileProject({name:'COM',startup:'Sub Main',modules:[{name:'M',kind:'module',code:`Option Explicit\nSub Main()\n${code}\nEnd Sub`}]});assert.deepEqual(program.diagnostics,[]);const output=[],vm=new VirtualMachine(program,{automation:registry,print:s=>output.push(s)});try{await vm.start();return output;}finally{vm.stop();await vm.automationClose;}}
test('compiled GetObject distinguishes omitted pathname, empty pathname, and named exact binding',async()=>{
  const registry=new AutomationRegistry().register('Acme.Component',()=>adapter('new')).registerActive('Acme.Component',()=>adapter('active')).registerMoniker('Doc:One',()=>adapter('document'),{className:'Acme.Component'});
  assert.deepEqual(await run(`Dim o As Object
Set o = GetObject(, "Acme.Component")
Debug.Print o.Value
Set o = GetObject("", "Acme.Component")
Debug.Print o.Value
Set o = GetObject(class:="Acme.Component")
Debug.Print o.Value
Set o = GetObject("Doc:One")
Debug.Print o.Value
Set o = GetObject(class:="Acme.Component", pathname:="Doc:One")
Debug.Print o.Value`,registry),['active','new','active','document','document']);
});
test('GetObject empty path retains portable builtin CreateObject behavior',async()=>assert.deepEqual(await run('Dim d As Object\nSet d = GetObject("", "Scripting.Dictionary")\nd.Add "key", 7\nDebug.Print d("key")'),['7']));
test('GetObject missing and empty are not inferred from Empty, Null or arbitrary strings',async()=>{
  const r=new AutomationRegistry().register('A.Object',()=>adapter(1)).registerActive('A.Object',()=>adapter(2)),s=r.createSession();
  await assert.rejects(s.getObject(MISSING,MISSING),e=>e.number===429);await assert.rejects(s.getObject('file://not-granted','A.Object'),e=>e.number===429);await assert.rejects(s.getObject(null,'A.Object'),e=>e.number===5);await s.close();
  assert.deepEqual(await run('Dim d As Object\nOn Error Resume Next\nSet d = GetObject(Null, "A.Object")\nDebug.Print Err.Number',r),['94']);
});
test('registered monikers are case-sensitive and optional class is checked',async()=>{
  const s=new AutomationRegistry().registerMoniker('Doc:One',()=>adapter(1),{className:'A.Object'}).createSession();
  const o=await s.getObject('Doc:One','a.object');assert.equal((await automationInvoke(o,'Value',2)),1);
  await assert.rejects(s.getObject('doc:one'),e=>e.number===429);await assert.rejects(s.getObject('Doc:One','Other.Class'),e=>e.number===429);await s.close();
});
test('factory registries are snapshotted per session, including active and moniker grants',async()=>{
  const r=new AutomationRegistry(),s=r.createSession();r.registerActive('A.Object',()=>adapter(1)).registerMoniker('Doc',()=>adapter(2));
  await assert.rejects(s.getObject(MISSING,'A.Object'),e=>e.number===429);await assert.rejects(s.getObject('Doc'),e=>e.number===429);await s.close();
});
test('close waits for a late factory and asynchronous orphan Release',async()=>{
  let finish,release,started=false,released=false;const a=adapter(1);a.release=()=>new Promise(r=>release=()=>{released=true;r();});
  const s=new AutomationRegistry().registerActive('A.Object',()=>new Promise(r=>{started=true;finish=r;})).createSession();
  const pending=s.getObject(MISSING,'A.Object');const rejected=assert.rejects(pending,e=>e.number===91);await new Promise(r=>setImmediate(r));assert(started);
  let closed=false;const closing=s.close().then(()=>closed=true);finish(a);await new Promise(r=>setImmediate(r));assert(!closed);assert(!released);release();await Promise.all([rejected,closing]);assert(released);assert(closed);
});
test('close before queued activation starts avoids activation side effects',async()=>{
  let calls=0;const s=new AutomationRegistry().register('A.Object',()=>{calls++;return adapter(1);}).createSession();const task=s.create('A.Object'),failure=assert.rejects(task,e=>e.number===91);await s.close();await failure;assert.equal(calls,0);
});
test('portable COM class executes compiled methods ByRef and preserves scalar subtype',async()=>{
  let instance;const r=registerComClass(new AutomationRegistry(),'A.Counter',()=>instance=new DispatchObject([
    {name:'Bump',dispid:1,params:[{name:'value',byRef:true}],method:([v])=>{v.value=tagScalar(Number(v.value)+1,'integer');}},
    {name:'Echo',dispid:2,params:[{name:'value'}],method:([v])=>v}
  ]));
  assert.deepEqual(await run('Dim o As Object, n As Integer\nSet o = CreateObject("A.Counter")\nn = 4\no.Bump n\nDebug.Print n\nDebug.Print VarType(o.Echo(CByte(255))), VarType(o.Echo(CInt(7))), VarType(o.Echo(CSng(1.6)))',r),['5','17 2 4']);assert(instance.disposed);
});
test('portable COM bridge preserves nested object identity and owns returned references',async()=>{
  let instance;const r=registerComClass(new AutomationRegistry(),'A.Self',()=>instance=new DispatchObject([{name:'Self',dispid:1,params:[],get:()=>instance.QueryInterface(IID.IDispatch)}]));
  assert.deepEqual(await run('Dim a As Object, b As Object\nSet a = CreateObject("A.Self")\nSet b = a.Self\nDebug.Print a Is b\nSet b = a.Self.Self\nDebug.Print a Is b',r),['True','True']);assert(instance.disposed);
});
test('portable COM bridge preserves nonzero multidimensional array bounds and element type',async()=>{
  const r=registerComClass(new AutomationRegistry(),'A.Array',()=>new DispatchObject([{name:'Echo',dispid:1,params:[{name:'a'}],method:([a])=>a}]));
  assert.deepEqual(await run('Dim o As Object, a(-2 To -1, 3 To 4) As Integer, v As Variant\nSet o = CreateObject("A.Array")\na(-2, 3) = 17\nv = o.Echo(a)\nDebug.Print LBound(v, 1), UBound(v, 2), v(-2, 3), VarType(v)',r),['-2 4 17 8194']);
});
test('portable COM bridge exposes NEWENUM without exposing hidden member to VB dispatch',async()=>{
  const r=registerComClass(new AutomationRegistry(),'A.Items',()=>new DispatchObject([{name:'_NewEnum',dispid:-4,params:[],get:()=>new ComEnumerator(['one','two'])}]));
  assert.deepEqual(await run('Dim o As Object, v As Variant\nSet o = CreateObject("A.Items")\nFor Each v In o\nDebug.Print v\nNext v',r),['one','two']);
});
test('COM registry and ROT grants integrate GetObject and share identities',async()=>{
  const classes=new ComClassRegistry(),factory=new ComClassFactory(()=>new DispatchObject([{name:'Value',dispid:1,params:[],get:()=>41}])),clsid='11111111-1111-1111-1111-111111111111';classes.RegisterClass(clsid,factory,{progIds:['A.Object']});factory.Release();
  const rot=new RunningObjectTable(),object=classes.CreateInstance('A.Object',IID.IDispatch),moniker=new DisplayNameMoniker('active:object');rot.Register(1,object,moniker);object.Release();moniker.Release();
  const registry=createComAutomationRegistry({classes,progIds:['A.Object'],runningObjects:rot,active:[{className:'A.Object',moniker:'active:object'}],monikers:[{name:'Doc',moniker:'active:object'}]});
  assert.deepEqual(await run('Dim a As Object, b As Object\nSet a = GetObject(, "A.Object")\nSet b = GetObject("Doc")\nDebug.Print a Is b, a.Value',registry),['True 41']);
  rot.Release();classes.close();assert(object.disposed);
});
test('portable factory failures map HRESULT to VB errors and release owned unsupported objects',async()=>{
  let object;const r=registerComClass(new AutomationRegistry(),'A.NoDispatch',()=>object=new ComObject()),s=r.createSession();await assert.rejects(s.create('A.NoDispatch'),e=>e.number===440&&Number.isInteger(e.hresult));assert(object.disposed);await s.close();
});
