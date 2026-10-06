import test from 'node:test';
import assert from 'node:assert/strict';
import {AutomationRegistry,automationSubscribe,automationInvoke} from '../src/runtime/automation.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileProject} from '../src/language/compiler.js';

function fixture(){let fire,unsubscribed=0,released=0;return {
  metadata:{members:[{name:'Fire',params:[],modes:[1]}],events:[{name:'Changing',params:[{name:'Value'},{name:'Cancel',byRef:true}]}]},
  subscribe(handler){fire=handler;return ()=>{unsubscribed++;fire=null;};},
  async invoke(){return {value:(await fire('Changing',[42,0],{reentrant:true})).args[1],args:[]};},
  release(){released++;},fire(...args){return fire(...args);},get counts(){return {unsubscribed,released};}
};}
test('OCX events copy back ByRef values, preserve ByVal and connection order',async()=>{
 const a=fixture(),s=new AutomationRegistry().createSession(),o=s.adopt(a),seen=[];
 automationSubscribe(o,async(name,args)=>{seen.push(name);args[0]=1;await args[1].ref.set(-1);});
 const remove=automationSubscribe(o,async(name,args)=>seen.push(await args[1].ref.get()));
 assert.equal((await automationInvoke(o,'Fire',1)), -1);assert.deepEqual(seen,['Changing',-1]);remove();remove();
 await s.close();assert.deepEqual(a.counts,{unsubscribed:1,released:1});
});
test('WithEvents uses compiled handlers, synchronous cancellation, nested calls and reassignment',async()=>{
 const adapters=[],registry=new AutomationRegistry().register('Test.Ocx',()=>{const a=fixture();adapters.push(a);return a;});
 const code=`Option Explicit
Private WithEvents Widget As Object
Private depth As Long
Public Sub Exercise()
 Set Widget = CreateObject("Test.Ocx")
 Debug.Print Widget.Fire()
 Set Widget = Nothing
End Sub
Private Sub Widget_Changing(ByVal Value As Variant, ByRef Cancel As Variant)
 Debug.Print Value
 If depth = 0 Then
  depth = 1
  Debug.Print Widget.Fire()
 End If
 Cancel = True
End Sub`;
 const program=compileProject({name:'Events',startup:'Sub Main',modules:[{kind:'module',name:'M',code:'Sub Main()\nDim w As Worker\nSet w = New Worker\nw.Exercise\nEnd Sub'},{kind:'class',name:'Worker',code}]});
 assert.deepEqual(program.diagnostics,[]);const output=[],vm=new VirtualMachine(program,{automation:registry,print:v=>output.push(v)});
 try{await vm.start();assert.deepEqual(output,['42','42','-1','-1']);assert.deepEqual(await adapters[0].fire('Changing',[8,0]),{args:[8,0]});}
 finally{vm.stop();await vm.automationClose;}
});
test('event schemas, names and arity are validated without invoking a handler',async()=>{
 const a=fixture(),s=new AutomationRegistry().createSession();s.adopt(a);
 await assert.rejects(()=>a.fire('constructor',[]),e=>e.number===440);
 await assert.rejects(()=>a.fire('Changing',[1]),e=>e.number===440);
 for(const events of [{},[{name:'constructor',params:[]}],[{name:'X',params:[]},{name:'x',params:[]}]] )assert.throws(()=>new AutomationRegistry().createSession().adopt({...fixture(),metadata:{members:[],events}}),e=>e.number===440);
 await s.close();
});
test('disconnect during delivery skips removed handlers and additions wait until next event',async()=>{
 const a=fixture(),s=new AutomationRegistry().createSession(),o=s.adopt(a);let seen=[],remove;
 automationSubscribe(o,()=>{seen.push('first');remove();automationSubscribe(o,()=>seen.push('new'));});
 remove=automationSubscribe(o,()=>seen.push('removed'));
 await a.fire('Changing',[1,0]);assert.deepEqual(seen,['first']);await a.fire('Changing',[1,0]);assert.deepEqual(seen,['first','first','new']);await s.close();
});
test('event subscriptions reject asynchronous cleanup contracts',()=>{
 const a=fixture();a.subscribe=async()=>()=>{};assert.throws(()=>new AutomationRegistry().createSession().adopt(a),e=>e.number===440);
});
