import test from 'node:test';
import assert from 'node:assert/strict';
import {macOS26Example,MACOS26_PREFERENCES_XAML} from '../src/project/macos26-example.js';
import {normalizeProject} from '../src/project/model.js';
import {compileProject} from '../src/language/compiler.js';
import {compileFormXaml,synchronizeFormXaml} from '../src/xaml/forms.js';
import {xamlBuildDiagnostics,formStamp} from '../src/xaml/contract.js';
import {tabPagePlan} from '../src/controls/tab-model.js';
import {compileMacOS} from '../packages/macos-native/src/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';

test('built-in macOS preferences remains an editable, compilable XAML application',()=>{
  const input=macOS26Example(),project=normalizeProject(input),module=project.modules[0];
  assert.deepEqual(xamlBuildDiagnostics(project),[]);
  assert.deepEqual(compileProject(project).diagnostics,[]);
  assert.equal(project.settings.theme,'macos26');
  assert.equal(module.xaml.text,MACOS26_PREFERENCES_XAML);
  assert.equal(module.xaml.base,formStamp(module.form));
  const result=compileFormXaml(module.xaml.text,{form:module.form,settings:project.settings});
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));
  assert.deepEqual(result.form,module.form);
  const controls=new Map(module.form.controls.map(control=>[control.name,control]));
  assert.deepEqual(controls.get('LayoutMode').properties.Buttons.map(button=>[button.Style,button.Value]),[[2,0],[2,1],[2,0]]);
  assert.deepEqual(controls.get('Options').properties.Buttons.map(button=>[button.Style,button.Value]),[[1,1],[1,1],[1,0]]);
  assert.deepEqual(controls.get('Actions').properties.Buttons.map(button=>[button.Style,button.Value]),[[0,0],[0,0]]);
  assert.equal(controls.get('Search').properties.MacOSControlStyle,'search');
  assert.equal(controls.get('Notifications').properties.MacOSControlStyle,'switch');
  assert.equal(controls.get('Notes').properties.MultiLine,-1);
  assert.equal(controls.get('Pages').properties.MacOSControlStyle,'segmented');
  for(const name of ['LayoutMode','Options','Actions']) {
    const row=controls.get(name).properties,pages=controls.get('Pages').properties;
    assert.equal(row.Width,350*15);
    assert.ok(row.Left+row.Width<=pages.Left-10*15,'Segment captions fit without overlapping the page column');
  }
  const plan=tabPagePlan(module.form,{strict:true});
  assert.deepEqual([...plan.bindings.values()].map(binding=>binding.page),[0,1]);
  assert.deepEqual(input,project);
});

test('editing the sample selection preserves its resources, comments and Mac vocabulary',()=>{
  const project=macOS26Example(),module=project.modules[0],after=structuredClone(module.form);
  const buttons=after.controls.find(control=>control.name==='LayoutMode').properties.Buttons;
  buttons[0].Value=1;buttons[1].Value=0;
  const result=synchronizeFormXaml(module.xaml.text,module.form,after,{settings:project.settings});
  assert.equal(result.regenerated,false);
  assert.match(result.text,/SelectedIndex="0"/);
  assert.match(result.text,/<!-- Each segment is a real Toolbar button/);
  assert.match(result.text,/<mac:Window.Resources>/);
  assert.doesNotMatch(result.text,/Designer.Properties/);
  const recompiled=compileFormXaml(result.text,{form:after,settings:project.settings});
  assert.equal(recompiled.success,true,JSON.stringify(recompiled.diagnostics));
  assert.deepEqual(recompiled.form,after);
});

for(const compile of [compileMacOS,compileMacOSAOT]) {
  test(compile.name+' lowers the XAML sample without changing authored state',()=>{
    const project=macOS26Example(),before=structuredClone(project),result=compile(project);
    const appearance=result.report.appearance.controls;
    for(const name of ['LayoutMode','Options','Actions'])
      assert.equal(appearance.find(control=>control.control===name)?.widget,'NSSegmentedControl');
    assert.ok(appearance.some(control=>control.control==='Pages'&&control.material));
    assert.deepEqual(project,before);
    assert.deepEqual(xamlBuildDiagnostics(project),[]);
  });

  test(compile.name+' retains the original XAML conflict and stale-form gates',()=>{
    for(const edit of [
      module=>{module.xaml.conflict=true;},
      module=>{module.xaml.text+=' ';},
      module=>{module.form.controls.find(control=>control.name==='Pages').properties.Tab=1;}
    ]) {
      const project=macOS26Example();edit(project.modules[0]);const before=structuredClone(project);
      assert.throws(()=>compile(project),error=>error.diagnostics?.some(diagnostic=>diagnostic.code==='VBXAML2201'));
      assert.deepEqual(project,before);
    }
  });
}
