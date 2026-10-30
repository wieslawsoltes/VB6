import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {ProjectDiagnosticCache,diagnosticSnapshot} from '../src/language/diagnostics.js';
import {VirtualMachine} from '../src/runtime/vm.js';
import {ControlArray} from '../src/controls/collections.js';
import {compileWin32} from '../src/native/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {compileLinuxAOT} from '../packages/linux-native/src/compiler.js';

function project(body='Buttons[2].Caption := \'two\'; Buttons(7).Caption := \'seven\'; ReportBounds') {
  return {schema:1,name:'PascalArrays',language:'pascal',startup:'MainForm',settings:{},modules:[{
    name:'MainForm',id:'form',kind:'form',language:'pascal',
    code:`unit MainForm; interface implementation
procedure ReportBounds; begin WriteLn(Low(Buttons), ':', High(Buttons)) end;
procedure Form_Load; begin ${body} end;
end.`,
    form:{name:'MainForm',type:'Form',properties:{Caption:'Arrays',ClientWidth:4500,ClientHeight:2400},
      controls:[2,7].map(index=>({name:'Buttons',type:'CommandButton',properties:{Index:index,Caption:'Button',Left:300,Top:300+index*120,Width:1500,Height:420,Visible:-1,Enabled:-1}})),menus:[]},
  }]};
}
function host() {
  const array=new ControlArray(),output=[];
  array.items.set(2,{Caption:''});array.items.set(7,{Caption:''});
  return {array,output,adapter:{print:value=>output.push(value),createForm:()=>({controlMap:new Map([['Buttons',array]]),Show(){}})}};
}

test('Pascal sparse control arrays share the host through bracket and call indexing',async()=>{
  const source=project(),compiled=compileProject(source),h=host();assert.deepEqual(compiled.diagnostics,[]);
  const vm=new VirtualMachine(compiled,h.adapter);await vm.start();
  assert.equal(h.array.Item(2).Caption,'two');assert.equal(h.array.Item(7).Caption,'seven');assert.deepEqual(h.output,['2:7']);
  h.array.items.set(11,{Caption:''});await vm.dispatch('MainForm','ReportBounds');assert.deepEqual(h.output,['2:7','2:11']);
});

test('Pascal sparse control array holes retain the shared host error',async()=>{
  const compiled=compileProject(project('Buttons[3].Caption := \'missing\'')),h=host();assert.deepEqual(compiled.diagnostics,[]);
  await assert.rejects(new VirtualMachine(compiled,h.adapter).start(),error=>error.number===340);
});

test('Pascal rejects nonordinal or wrong-rank control array indexes',()=>{
  for(const expression of ['Buttons[2,7]','Buttons(2,7)','Buttons[\'two\']','Buttons(1.5)']) {
    const compiled=compileProject(project(expression+'.Caption := \'bad\''));
    assert.equal(compiled.valid,false,expression);assert.match(compiled.diagnostics.map(d=>d.message).join('\n'),/index|indices|ordinal/i);
  }
});

test('Pascal form declarations include nested menus and diagnostic workers retain them',()=>{
  const source=project('OpenMenu.Caption := \'Open file\''),form=source.modules[0].form;
  form.menus=[{name:'FileMenu',type:'Menu',properties:{Caption:'File'},items:[{name:'OpenMenu',properties:{Caption:'Open'}}]}];
  assert.equal(compileProject(source).valid,true);
  const cache=new ProjectDiagnosticCache();assert.equal(cache.check(diagnosticSnapshot(source)).valid,true);
  form.menus[0].items[0].name='RenamedMenu';const result=cache.check(diagnosticSnapshot(source));assert.equal(result.valid,false);
  assert.match(result.diagnostics[0].message,/OpenMenu/);
});

test('Pascal control groups reject incompatible scalar, type, or duplicate index declarations',()=>{
  for(const change of [form=>delete form.controls[1].properties.Index,form=>form.controls[1].type='TextBox',form=>form.controls[1].properties.Index=2]) {
    const source=project();change(source.modules[0].form);
    const compiled=compileProject(source);assert.equal(compiled.valid,false);assert.match(compiled.diagnostics.map(d=>d.message).join('\n'),/control array declaration/);
  }
});

for(const [target,compile] of [['win32',compileWin32],['macos',compileMacOSAOT],['linux-x64',compileLinuxAOT],['linux-arm64',source=>compileLinuxAOT(source,{architecture:'arm64'})]])
  test('Pascal indexed controls retain '+target+' shared AOT lowering',()=>{
    const source=project('Buttons[2].Caption := \'two\'; Buttons(7).Caption := \'seven\''),result=compile(source);
    assert.ok(result.bytes?.length||result.section.length);
  });
