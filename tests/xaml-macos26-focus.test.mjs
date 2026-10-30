import test from 'node:test';
import assert from 'node:assert/strict';
import {MACOS26_NS,PRESENTATION_NS,XAML_NS} from '../packages/xaml-compiler/src/index.js';
import {compileFormXaml,formToXaml,synchronizeFormXaml} from '../src/xaml/forms.js';
import {formStamp,xamlBuildDiagnostics} from '../src/xaml/contract.js';
import {newProject} from '../src/project/model.js';
import {compileMacOS} from '../packages/macos-native/src/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';

const layouts=['View','Canvas','StackView','Grid'];
const settings={anchoring:true,xaml:true};
const wrap=body=>`<mac:Window xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:mac="${MACOS26_NS}" xmlns:vb="urn:vb6:forms" x:Name="Form1">${body}</mac:Window>`;
const load=(text,form)=>{
  const result=compileFormXaml(text,{settings,form});
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));
  return result.form;
};
const node=(form,name)=>form.controls.find(control=>control.name===name);
const document=wrap(`<mac:View x:Name="Layout"><!-- keep keyboard intent -->${layouts.map(type=>`<mac:${type} x:Name="${type}Layout" Width='200' Height="80"/>`).join('')}<mac:Button x:Name="Apply" Title='Apply'/><mac:SearchField x:Name="Search"/><mac:TextEditor x:Name="Notes"/><mac:Switch x:Name="Notifications"/></mac:View>`);

test('macOS layout containers omit tab navigation while their real controls remain focusable',()=>{
  const form=load(document);
  for(const name of ['Layout',...layouts.map(type=>type+'Layout')]) {
    const control=node(form,name);
    assert.equal(control.type,'PictureBox',name);
    assert.equal(control.properties.BorderStyle,0,name);
    assert.equal(control.properties.TabStop,0,name);
  }
  for(const name of ['Apply','Search','Notes','Notifications'])assert.equal(node(form,name).properties.TabStop,-1,name);
  const unprefixed=load(`<Window xmlns="${MACOS26_NS}" xmlns:x="${XAML_NS}" x:Name="Form1"><View x:Name="Layout"><Button x:Name="Apply"/></View></Window>`);
  assert.equal(node(unprefixed,'Layout').properties.TabStop,0);
  assert.equal(node(unprefixed,'Apply').properties.TabStop,-1);
});

test('ordinary VB and presentation PictureBox defaults retain their existing tab-navigation policy',()=>{
  const form=load(wrap('<mac:View><vb:PictureBox Name="Native"/><Canvas x:Name="PresentationCanvas"/><Grid x:Name="PresentationGrid"/><StackPanel x:Name="PresentationStack"/></mac:View>'));
  for(const name of ['Native','PresentationCanvas','PresentationGrid','PresentationStack'])assert.equal(node(form,name).properties.TabStop,-1,name);
  assert.equal(node(form,'Native').properties.BorderStyle,1);
});

test('explicit native layout overrides and ordinary control IsTabStop properties take precedence',()=>{
  for(const value of [-1,0]) {
    const form=load(wrap(`<mac:View>${layouts.map(type=>`<mac:${type} x:Name="${type}Layout" vb:Designer.Properties='{}{&quot;TabStop&quot;:${value}}'/>`).join('')}<mac:Button x:Name="Apply" IsTabStop="False"/><mac:TextField x:Name="Search" IsTabStop="True"/></mac:View>`));
    for(const type of layouts)assert.equal(node(form,type+'Layout').properties.TabStop,value,type);
    assert.equal(node(form,'Apply').properties.TabStop,0);
    assert.equal(node(form,'Search').properties.TabStop,-1);
    assert.deepEqual(load(formToXaml(form),form),form);
  }
});

test('designer focus edits retain macOS containers, comments and unrelated source spelling',()=>{
  let text=document,before=load(text);
  for(const value of [-1,0]) {
    const after=structuredClone(before);
    for(const type of layouts)node(after,type+'Layout').properties.TabStop=value;
    const result=synchronizeFormXaml(text,before,after,{settings});
    assert.equal(result.regenerated,false,result.text);
    assert.match(result.text,/<!-- keep keyboard intent -->/);
    assert.match(result.text,/Title='Apply'/);
    assert.match(result.text,/Width='200'/);
    for(const type of layouts)assert.match(result.text,new RegExp('<mac:'+type+'\\b[^>]*\\bx:Name="'+type+'Layout"'));
    assert.deepEqual(load(result.text,after),after);
    assert.equal(node(after,'Layout').properties.TabStop,0);
    assert.equal(node(after,'Apply').properties.TabStop,-1);
    text=result.text;before=after;
  }
});

for(const compile of [compileMacOS,compileMacOSAOT])test(compile.name+' emits container defaults and an edited focus override without changing retained XAML',()=>{
  const original=load(document),form=structuredClone(original);
  node(form,'CanvasLayout').properties.TabStop=-1;
  const synchronized=synchronizeFormXaml(document,original,form,{settings});
  assert.equal(synchronized.regenerated,false);
  const project=newProject('MacOSContainerFocus'),module=project.modules[0];
  project.settings={...project.settings,...settings};
  module.form=form;
  module.xaml={version:1,revision:1,text:synchronized.text,appliedText:synchronized.text,base:formStamp(form),conflict:false};
  const before=structuredClone(project),result=compile(project);
  assert.deepEqual(project,before);
  assert.deepEqual(xamlBuildDiagnostics(project),[]);
  assert.deepEqual(result.project.modules[0].form,form);
  assert.deepEqual(result.project.modules[0].xaml,module.xaml);
  const expected={Layout:0,ViewLayout:0,CanvasLayout:-1,StackViewLayout:0,GridLayout:0,Apply:-1,Search:-1,Notes:-1,Notifications:-1};
  for(const [name,value] of Object.entries(expected)) {
    if(result.metadata) {
      const control=result.metadata.modules[0].controls.find(control=>control.name===name);
      const id=control.properties.find(([name])=>name==='tabstop')[1];
      assert.equal(Number(result.metadata.literals[id].value),value,name);
    } else {
      const spec=result.files['main.cpp'].split('ControlSpec{"'+name+'",')[1]?.split('ControlSpec{')[0];
      assert.ok(spec?.includes('Property{"tabstop",Value::integer('+value+','),name);
    }
  }
});
