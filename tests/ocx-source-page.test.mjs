import test from 'node:test';
import assert from 'node:assert/strict';
import {SourcePropertyPage} from '../src/controls/ocx-source-page.js';
import {ControlAdapterRegistry} from '../src/controls/adapters.js';
import {scalarType,unbox} from '../src/runtime/values.js';
const code=`Option Explicit
Private Sub PropertyPage_Initialize()
 Debug.Print "initialize:" & SelectedControls.Count
End Sub
Private Sub PropertyPage_SelectionChanged()
 If SelectedControls.Count > 0 Then Input.Text = CStr(SelectedControls(0).Value)
 Changed = False
End Sub
Private Sub Input_Change()
 Changed = True
End Sub
Private Sub Input_KeyPress(ByRef KeyAscii As Integer)
 KeyAscii = 0
End Sub
Private Sub PropertyPage_ApplyChanges()
 Dim Obj As Object
 For Each Obj In SelectedControls
  Obj.Value = CLng(Input.Text)
 Next
 If Fault.Value Then Err.Raise 5, , "apply rejected"
End Sub
Private Sub PropertyPage_EditProperty(ByVal PropertyName As String)
 Input.Text = PropertyName
End Sub
Private Sub PropertyPage_Terminate()
 Debug.Print "terminate"
End Sub`;
const project=(source=code)=>({name:'Pages',startup:'Sub Main',modules:[{name:'General',kind:'form',form:{name:'General',type:'PropertyPage',properties:{Caption:'General settings'},controls:[]},code:source},{name:'Startup',kind:'module',code:'Sub Main()\n Err.Raise 5, , "startup executed"\nEnd Sub'}]});
function options(extra={}){return {allowDesignCode:true,registry:new ControlAdapterRegistry().register('Acme.Gauge',{runtime(){},metadata:{properties:[{name:'Value',default:0},{name:'Serial',default:'fixed',readOnly:true},{name:'Mode',default:0,choices:[{value:0,label:'A'},{value:1,label:'B'}]}]}}),models:[{id:'a',type:'Acme.Gauge',properties:{Value:4}},{id:'b',type:'Acme.Gauge',properties:{Value:9}}],controls:{Input:{Text:''},Fault:{Value:false}},...extra};}
async function open(o=options(),source=code){return SourcePropertyPage.create(project(source),'General',o);}
test('source .pag requires explicit design consent and a PropertyPage module',()=>{
 assert.throws(()=>new SourcePropertyPage(project(),'General',{...options(),allowDesignCode:false}),/consent/);
 const p=project();p.modules[0].form.type='UserControl';assert.throws(()=>new SourcePropertyPage(p,'General',options()),/PropertyPage/);
});
test('property-page Initialize runs before selection, then actual VB reads zero-based SelectedControls',async()=>{
 const log=[],o=options({host:{debugPrint:text=>log.push(text),createForm(){throw Error('form construction');}}}),p=await open(o);
 try{assert.equal(o.controls.Input.Text,'4');assert.equal(p.SelectionCount,2);assert.equal(p.Caption,'General settings');assert.equal(p.IsPageDirty,false);assert.equal(await p.apply(),false);}finally{await p.close();}
});
test('actual VB edits all selected controls in one synchronous undo transaction',async()=>{
 const commits=[],o=options({onApply:entries=>commits.push(entries)}),p=await open(o);
 try{o.controls.Input.Text='42';await p.dispatchControlEvent('input','change');assert.equal(p.IsPageDirty,true);assert.equal(o.models[0].properties.Value,4);
 assert.equal(await p.apply(),true);assert.deepEqual(o.models.map(m=>m.properties.Value),[42,42]);assert.equal(p.IsPageDirty,false);assert.equal(commits.length,1);assert.equal(commits[0].length,2);assert.deepEqual(commits[0].map(e=>e.previous.Value),[4,9]);
 assert.equal(await p.apply(),false);assert.equal(commits.length,1);}finally{await p.close();}
});
test('ApplyChanges failure rolls back the entire selection and remains dirty for retry',async()=>{
 const o=options(),p=await open(o);try{o.controls.Input.Text='18';o.controls.Fault.Value=true;await p.dispatchControlEvent('Input','Change');await assert.rejects(p.apply(),/apply rejected/);assert.deepEqual(o.models.map(m=>m.properties.Value),[4,9]);assert.equal(p.IsPageDirty,true);o.controls.Fault.Value=false;await p.apply();assert.deepEqual(o.models.map(m=>m.properties.Value),[18,18]);}finally{await p.close();}
});
test('commit rejection and async commit both restore original property references',async()=>{
 for(const onApply of [()=>{throw Error('undo unavailable');},async()=>{}]){
 const o=options({onApply}),original=o.models.map(m=>m.properties),p=await open(o);try{await p.dispatchControlEvent('Input','Change');await assert.rejects(p.apply(),/undo unavailable|synchronous/);o.models.forEach((m,i)=>assert.equal(m.properties,original[i]));assert.equal(p.IsPageDirty,true);}finally{await p.close();}}
});
test('property-page stale model edits are rejected before events or commit',async()=>{
 const o=options(),p=await open(o);try{await p.dispatchControlEvent('Input','Change');o.models[1].properties.Value=70;await assert.rejects(p.apply(),/selection has changed/);await assert.rejects(p.editProperty('Value'),/selection has changed/);assert.equal(o.models[0].properties.Value,4);}finally{await p.close();}
});
test('per-object staged getters see earlier writes in the same ApplyChanges transaction',async()=>{
 const o=options(),p=await open(o,code.replace('Obj.Value = CLng(Input.Text)','Obj.Value = Obj.Value + 1\n  Obj.Value = Obj.Value + 2'));try{await p.dispatchControlEvent('Input','Change');await p.apply();assert.deepEqual(o.models.map(m=>m.properties.Value),[7,12]);}finally{await p.close();}
});
test('readonly and enum validation reject all staged edits atomically',async()=>{
 for(const assignment of ['Obj.Serial = "bad"','Obj.Mode = 55']){const o=options(),p=await open(o,code.replace('Obj.Value = CLng(Input.Text)',assignment));try{await p.dispatchControlEvent('Input','Change');await assert.rejects(p.apply(),/read-only|choice/);assert.deepEqual(o.models.map(m=>m.properties),[{Value:4},{Value:9}]);}finally{await p.close();}}
});
test('selection replacement raises SelectionChanged and resets unapplied dirty state',async()=>{
 const o=options(),p=await open(o);try{o.controls.Input.Text='50';await p.dispatchControlEvent('Input','Change');await p.setObjects([o.models[1]]);assert.equal(p.IsPageDirty,false);assert.equal(p.SelectionCount,1);assert.equal(o.controls.Input.Text,'9');await p.setObjects([]);assert.equal(p.SelectionCount,0);await p.dispatchControlEvent('Input','Change');await assert.rejects(p.apply(),/Select controls/);}finally{await p.close();}
});
test('source property pages dispatch typed ByRef keyboard events and edit-property requests',async()=>{
 const o=options(),p=await open(o);try{const event=await p.dispatchControlEvent('Input','KeyPress',[65]);assert.equal(scalarType(event.args[0]),'integer');assert.equal(unbox(event.args[0]),0);await p.editProperty('Value');assert.equal(o.controls.Input.Text,'Value');await assert.rejects(p.editProperty('__proto__'),/Invalid/);await assert.rejects(p.dispatchControlEvent('Input','Terminate'),/Invalid/);await assert.rejects(p.dispatchControlEvent('Unknown','Change'),/Invalid/);}finally{await p.close();}
});
test('writes outside ApplyChanges cannot silently mutate project selection',async()=>{
 const o=options();await assert.rejects(open(o,code.replace('Changed = False','SelectedControls(0).Value = 99')),/only be changed during/);assert.equal(o.models[0].properties.Value,4);
});
test('source page initialization failures clean up and invalid configuration is diagnosed',async()=>{
 await assert.rejects(open(options(),code.replace('Debug.Print "initialize:" & SelectedControls.Count','Err.Raise 5, , "initialization failed"')),/initialization failed/);
 assert.throws(()=>new SourcePropertyPage(project(),'General',options({instructionLimit:0})),/budget/);
 assert.throws(()=>new SourcePropertyPage(project(),'General',options({controls:{Changed:{}}})),/child map/);
 assert.throws(()=>new SourcePropertyPage(project(),'General',options({models:[{}]})),/selection/);
});
test('page close is idempotent, discards edits, and rejects subsequent operations',async()=>{
 const o=options(),p=await open(o);await p.dispatchControlEvent('Input','Change');await Promise.all([p.close(),p.close()]);assert.equal(p.Closed,true);assert.equal(o.models[0].properties.Value,4);await assert.rejects(p.apply(),/closed/);await assert.rejects(p.setObjects(o.models),/closed/);
});
test('VB dirty notification raised during ApplyChanges is not silently cleared afterwards',async()=>{
 const o=options(),p=await open(o,code.replace('If Fault.Value Then','Changed = True\n If Fault.Value Then'));try{await p.dispatchControlEvent('Input','Change');await p.apply();assert.equal(p.IsPageDirty,true);}finally{await p.close();}
});
test('retained SelectedControls facade cannot mutate a replacement selection',async()=>{
 const altered=code.replace('Private Sub PropertyPage_Initialize()','Private Previous As Object\nPrivate Sub PropertyPage_Initialize()').replace('Changed = False','If Previous Is Nothing Then Set Previous = SelectedControls(0)\n Changed = False').replace('Obj.Value = CLng(Input.Text)','Previous.Value = 99');
 const o=options(),p=await open(o,altered);try{await p.setObjects([o.models[1]]);await p.dispatchControlEvent('Input','Change');await assert.rejects(p.apply(),/reference has expired/);assert.deepEqual(o.models.map(m=>m.properties.Value),[4,9]);}finally{await p.close();}
});


test('original .pag example parses and executes without altering the imported source',async()=>{
 const {readFile}=await import('node:fs/promises'),{parseFRM}=await import('../src/project/formats.js');
 const text=await readFile(new URL('../examples/ocx-source/GaugePage.pag',import.meta.url),'utf8'),{module}=parseFRM(text,'GaugePage.pag');
 assert.equal(module.form.type,'PropertyPage');assert.equal(module.form.controls[0].name,'txtValue');
 const imported={name:'Example',modules:[module]},snapshot=JSON.stringify(imported),o=options({controls:{txtValue:{Text:''}}});
 const page=await SourcePropertyPage.create(imported,'GaugePage',o);
 try{assert.equal(page.Caption,'Gauge settings');assert.equal(o.controls.txtValue.Text,'4');o.controls.txtValue.Text='73';await page.dispatchControlEvent('txtValue','Change');assert.equal(await page.apply(),true);assert.deepEqual(o.models.map(m=>m.properties.Value),[73,73]);assert.equal(JSON.stringify(imported),snapshot);}finally{await page.close();}
});


test('VB SelectedControls property lookup preserves case-insensitive metadata names',async()=>{
 const registry=new ControlAdapterRegistry().register('Lab.Lower',{runtime(){},metadata:{properties:[{name:'value',default:1}]}}),models=[{type:'Lab.Lower',properties:{value:7}}];
 const o=options({registry,models}),p=await open(o);
 try{assert.equal(o.controls.Input.Text,'7');o.controls.Input.Text='28';await p.dispatchControlEvent('Input','Change');await p.apply();assert.equal(models[0].properties.value,28);assert.equal(Object.hasOwn(models[0].properties,'Value'),false);}finally{await p.close();}
});
