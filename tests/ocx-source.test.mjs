import test from 'node:test';
import assert from 'node:assert/strict';
import {SourceUserControl} from '../src/controls/ocx-source.js';
import {OcxPropertyBag} from '../src/controls/ocx-site.js';
import {scalarType,tagScalar} from '../src/runtime/values.js';
const code=`Option Explicit
Private mValue As Long
Public Fault As Boolean
Public Trace As String
Public Event Changing(ByVal Proposed As Long, ByRef Cancel As Boolean)
Private Sub UserControl_Initialize()
 Trace = "I"
End Sub
Private Sub UserControl_InitProperties()
 mValue = 4
 Trace = Trace & "N"
End Sub
Private Sub UserControl_ReadProperties(PropBag As PropertyBag)
 mValue = PropBag.ReadProperty("Value", 4&)
 Trace = Trace & "L"
 If Fault Then Err.Raise 5, , "read failure"
End Sub
Private Sub UserControl_WriteProperties(PropBag As PropertyBag)
 PropBag.WriteProperty "Value", mValue, 4&
 PropBag.WriteProperty "Flag", CBool(True)
 If Fault Then Err.Raise 5, , "write failure"
End Sub
Private Sub UserControl_Resize()
 Trace = Trace & "R"
End Sub
Private Sub UserControl_Show()
 Trace = Trace & "S"
End Sub
Private Sub UserControl_Hide()
 Trace = Trace & "H"
End Sub
Private Sub UserControl_AmbientChanged(ByVal PropertyName As String)
 Trace = Trace & ":" & PropertyName
End Sub
Private Sub UserControl_Terminate()
 Debug.Print "terminate"
End Sub
Public Property Get Value() As Long
 Value = mValue
End Property
Public Property Let Value(ByVal Proposed As Long)
 Dim Cancel As Boolean
 RaiseEvent Changing(Proposed, Cancel)
 If Cancel Then Exit Property
 mValue = Proposed
 UserControl.PropertyChanged "Value"
End Property
Public Function Doubled(ByVal Input As Long) As Long
 Doubled = Input * 2
End Function
Private Function Secret() As Long
 Secret = 123
End Function`;
function project(source=code){return {name:'GaugeLibrary',startup:'Sub Main',modules:[{name:'Gauge',kind:'form',form:{name:'Gauge',type:'UserControl',properties:{Width:1500,Height:750}},code:source},{kind:'module',name:'Startup',code:'Sub Main()\n Err.Raise 5, , "must never execute project startup"\nEnd Sub'}]};}
async function source(options={}){return SourceUserControl.create(project(),'Gauge',options);}
test('VB source user control executes lifecycle without executing project startup or constructing forms',async()=>{
  let forms=0;const c=await source({host:{createForm(){forms++;}}});try{assert.equal(await c.get('Trace'),'INRS');assert.equal(await c.get('Value'),4);assert.equal(forms,0);assert.equal(c.Properties.Width,1500);assert.equal(c.Ambient.UserMode,-1);}finally{await c.close();}
});
test('source properties, methods and exact scalar return types use the real interpreter',async()=>{
  const c=await source();try{assert.equal(await c.invoke('Doubled',[8]),16);assert.equal(scalarType(await c.getScalar('Value')),'long');await c.set('Value',23);assert.equal(await c.get('Value'),23);assert.equal(c.Dirty,true);assert.equal(c.Revision,1);await assert.rejects(c.invoke('Secret'),/accessible/);await assert.rejects(c.get('mValue'),/accessible/);await assert.rejects(c.invoke('constructor'),/Invalid/);}finally{await c.close();}
});
test('source outgoing events share declared Boolean cancellation with the property setter',async()=>{
  const c=await source(),events=[];try{const disconnect=c.subscribe((name,args)=>{events.push(name);assert.equal(scalarType(args[0]),'long');assert.equal(scalarType(args[1].ref.getScalar()),'boolean');args[1].ref.set(-1);});await c.set('Value',90);assert.equal(await c.get('Value'),4);assert.equal(c.Dirty,false);disconnect();await c.set('Value',12);assert.equal(await c.get('Value'),12);assert.deepEqual(events,['Changing']);}finally{await c.close();}
});
test('source event context supports reentrant property reads, expires afterwards and blocks deadlocking public calls',async()=>{
  const c=await source();let context;try{c.subscribe(async(n,args,ctx)=>{context=ctx;assert.equal(await ctx.get('Value'),4);assert.equal(await ctx.invoke('Doubled',[3]),6);await assert.rejects(c.get('Value'),/event context/);await assert.rejects(c.close(),/outgoing event/);});await c.set('Value',9);assert.equal(await c.get('Value'),9);assert.throws(()=>context.get('Value'),/expired/);}finally{await c.close();}
});
test('source event freeze nests and does not prevent property setter execution',async()=>{
  const c=await source();let count=0;try{c.subscribe(()=>count++);c.freezeEvents(true);c.freezeEvents(true);await c.set('Value',8);c.freezeEvents(false);await c.set('Value',9);assert.equal(count,0);c.freezeEvents(false);await c.set('Value',10);assert.equal(count,1);assert.equal(await c.get('Value'),10);assert.throws(()=>c.freezeEvents(false),/Unbalanced/);}finally{await c.close();}
});
test('source design-time execution requires explicit consent and suppresses outgoing events',async()=>{
  assert.throws(()=>new SourceUserControl(project(),'Gauge',{design:true}),/consent/);const c=await source({design:true,allowDesignCode:true});let count=0;try{c.subscribe(()=>count++);await c.set('Value',8);assert.equal(count,0);assert.equal(c.Ambient.UserMode,0);await c.setDesignMode(false);await c.set('Value',9);assert.equal(count,1);await assert.rejects(c.setDesignMode(true),/consent/);assert.equal(c.Ambient.UserMode,-1);}finally{await c.close();}
});
test('source persistence preserves numeric subtypes, Boolean tags and default elision',async()=>{
  const c=await source();try{const first=await c.save();assert.equal(first.properties.some(p=>p.name==='Value'),false);assert.deepEqual(first.properties[0],{name:'Flag',value:{t:'boolean',v:true}});await c.set('Value',12);const saved=await c.save();assert.deepEqual(saved.properties.find(p=>p.name==='Value').value,{t:'number',vt:3,v:12});assert.equal(c.Dirty,false);const restored=await source({state:saved});try{assert.equal(await restored.get('Trace'),'ILRS');assert.equal(await restored.get('Value'),12);}finally{await restored.close();}}finally{await c.close();}
});
test('failed source persistence does not clear dirty state and explicit subsequent load uses typed property data',async()=>{
  const c=await source();try{await c.set('Value',19);await c.set('Fault',true);await assert.rejects(c.save(),/write failure/);assert.equal(c.Dirty,true);const bag=new OcxPropertyBag();bag.WriteProperty('Value',tagScalar(30,'long'));await assert.rejects(c.load(bag.Contents),/read failure/);assert.equal(c.Dirty,true);await c.set('Fault',false);await c.load(bag.Contents);assert.equal(await c.get('Value'),30);assert.equal(c.Dirty,false);}finally{await c.close();}
});
test('source layout, visibility and ambient notifications execute the matching VB handlers',async()=>{
  const c=await source();try{await c.resize(3000,1500);await c.resize(3000,1500);await c.show(false);await c.show(true);await c.setAmbient({ForeColor:123});await c.setAmbient({ForeColor:123});assert.equal(await c.get('Trace'),'INRSRHS:ForeColor');assert.equal(await c.get('ScaleWidth'),3000);await assert.rejects(c.resize(-1,20),/Invalid/);assert.equal(c.Properties.Width,3000);await assert.rejects(c.setAmbient({UserMode:0}),/setDesignMode/);}finally{await c.close();}
});
test('source control child map and ambient objects are accessible without exposing DOM or parent prototypes',async()=>{
  const p=project(code+'\nPublic Function ReadChild() As String\n ReadChild = Label1.Caption & CStr(Controls.Count)\nEnd Function\nPublic Function Forbidden() As Variant\n Forbidden = Parent.constructor\nEnd Function');
  const controls={Label1:{Caption:'Child'}},c=await SourceUserControl.create(p,'Gauge',{controls,parent:{Name:'Parent'}});try{controls.Other={};assert.equal(await c.invoke('ReadChild'),'Child1');await assert.rejects(c.invoke('Forbidden'),/not permitted/);}finally{await c.close();}
});
test('source control operations serialize independent callers and close drains preceding work',async()=>{
  const output=[],c=await source({host:{print:t=>output.push(t)}});const first=c.set('Value',10),second=c.set('Value',11);const result=c.get('Value'),closing=c.close();await Promise.all([first,second]);assert.equal(await result,11);await closing;await c.close();assert.deepEqual(output,['terminate']);assert.equal(c.Closed,true);await assert.rejects(c.get('Value'),/closed/);assert.throws(()=>c.subscribe(()=>{}),/closed/);
});
test('source property observer failures are surfaced and layout recursion has a fixed bound',async()=>{
  const c=await source({host:{propertyChanged(){throw Error('owner failed');}}});try{await assert.rejects(c.set('Value',10),/owner failed/);assert.equal(c.Dirty,true);}finally{await c.close();}
  const recursive=project(code.replace('Trace = Trace & "R"','UserControl.Width = UserControl.Width + 1'));await assert.rejects(SourceUserControl.create(recursive,'Gauge'),/did not stabilize/);
});
test('source subscription changes during delivery retain assignment-order semantics',async()=>{
  const c=await source(),calls=[];let second;try{c.subscribe(()=>{calls.push('first');second();c.subscribe(()=>calls.push('new'));});second=c.subscribe(()=>calls.push('old'));await c.set('Value',8);assert.deepEqual(calls,['first']);await c.set('Value',9);assert.deepEqual(calls,['first','first','new']);}finally{await c.close();}
});
test('source execution budgets stop infinite code and ordinary compile errors precede all lifecycle execution',async()=>{
  assert.throws(()=>new SourceUserControl(project('Sub Broken('),'Gauge'),/expected|Expected|Invalid|header|syntax/i);
  const p=project(code+'\nPublic Sub Spin()\n Do\n Loop\nEnd Sub'),c=await SourceUserControl.create(p,'Gauge',{instructionLimit:200});try{await assert.rejects(c.invoke('Spin'),/budget/i);}finally{try{await c.close();}catch(error){assert.match(error.message,/budget/i);}}
});


test('native CTL client dimensions define source-control initial size',async()=>{
 const {parseFRM}=await import('../src/project/formats.js');const {module}=parseFRM('VERSION 5.00\nBegin VB.UserControl Gauge\n ClientWidth = 2100\n ClientHeight = 1200\nEnd\nAttribute VB_Name = "Gauge"\n'+code,'Gauge.ctl');
 const c=await SourceUserControl.create({name:'CtlLibrary',modules:[module]},'Gauge');try{assert.equal(c.Properties.Width,2100);assert.equal(c.Properties.Height,1200);assert.equal(await c.get('Trace'),'INRS');}finally{await c.close();}
});
test('incoming source keyboard events return typed ByRef cancellation and propagate type errors',async()=>{
 const p=project(code+'\nPrivate Sub UserControl_KeyPress(KeyAscii As Integer)\n If KeyAscii = 13 Then KeyAscii = 0\nEnd Sub'),c=await SourceUserControl.create(p,'Gauge');try{
 const result=await c.dispatchControlEvent('KeyPress',[13]);assert.equal(result.handled,true);assert.equal(scalarType(result.args[0]),'integer');assert.equal(result.args[0].value,0);await assert.rejects(c.dispatchControlEvent('KeyPress',[65536]),/Overflow/);await assert.rejects(c.dispatchControlEvent('KeyPress',[]),/count/);await assert.rejects(c.dispatchControlEvent('Terminate'),/input event/);
 }finally{await c.close();}
});
test('source incoming input and paint execute during outgoing freeze but input is suppressed in design mode',async()=>{
 const p=project(code+'\nPrivate Sub UserControl_Click()\n Trace = Trace & "C"\nEnd Sub\nPrivate Sub UserControl_Paint()\n Trace = Trace & "P"\nEnd Sub'),c=await SourceUserControl.create(p,'Gauge');try{
 c.freezeEvents(true);assert.equal((await c.dispatchControlEvent('Click')).handled,true);assert.equal((await c.dispatchControlEvent('Paint')).handled,true);assert.equal(await c.get('Trace'),'INRSCP');c.freezeEvents(false);
 await c.setDesignMode(true,{allowDesignCode:true});assert.equal((await c.dispatchControlEvent('Click')).handled,false);assert.equal((await c.dispatchControlEvent('Paint')).handled,true);assert.equal((await c.get('Trace')).endsWith('UserModeP'),true);
 }finally{await c.close();}
});
test('source control input dispatch and persistence options fail before their side effects',async()=>{
 const c=await source();try{await assert.rejects(c.set('Value',9,{object:'no'}),/options/);await assert.rejects(c.save({clearDirty:'no'}),/Boolean/);assert.equal(await c.get('Value'),4);assert.equal(c.Dirty,false);assert.deepEqual(await c.dispatchControlEvent('MouseMove',[1,0,1,1]),{handled:false,args:[1,0,1,1]});}finally{await c.close();}
});


test('event-context calls serialize concurrent procedures and drain fire-and-forget work before returning',async()=>{
 const c=await source(),seen=[];try{c.subscribe(async(n,args,ctx)=>{const results=await Promise.all([ctx.get('Value'),ctx.invoke('Doubled',[3]),ctx.get('Value')]);seen.push(...results);ctx.invoke('Doubled',[5]).then(value=>seen.push(value));});await c.set('Value',9);assert.deepEqual(seen,[4,6,4,10]);assert.equal(await c.get('Value'),9);}finally{await c.close();}
});
test('unobserved event-context failure is surfaced before a property setter commits',async()=>{
 const c=await source();try{c.subscribe((n,args,ctx)=>{ctx.invoke('Secret');});await assert.rejects(c.set('Value',9),/context calls failed/);assert.equal(await c.get('Value'),4);assert.equal(c.Dirty,false);}finally{await c.close();}
});
