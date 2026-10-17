import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMacOS} from '../packages/macos-native/src/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {createForm,createControl} from '../src/project/model.js';
import {MACOS26_RESOURCE_NAMES} from '../src/theme/macos26-resources.js';

function project(type='CommandButton',properties={},formProperties={}) {
  const form=createForm('NativeAppearance');
  Object.assign(form.form.properties,formProperties);
  form.form.controls=[Object.assign(createControl(type,'Subject'),{properties:{...createControl(type,'Subject').properties,...properties}})];
  return {schema:1,name:'NativeAppearance',startup:'NativeAppearance',modules:[form]};
}

for(const compile of [compileMacOS,compileMacOSAOT]) {
  test(compile.name+' validates every native style and reports material availability',()=>{
    for(const style of ['automatic','push','default','destructive','borderless','inline','circular','help'])
      assert.doesNotThrow(()=>compile(project('CommandButton',{MacOSControlStyle:style})));
    assert.equal(compile(project('CheckBox',{MacOSControlStyle:'switch'})).report.appearance.controls[0].widget,'NSSwitch');
    assert.equal(compile(project('TextBox',{MacOSControlStyle:'search',PlaceholderText:'Find',MacOSAccessibilityLabel:'Find records'})).report.appearance.controls[0].widget,'NSSearchField');
    const result=compile(project('PictureBox',{MacOSMaterial:'sidebar'}));
    assert.ok(result.report.diagnostics.some(d=>d.code==='MAC264'));
    assert.ok(!compile(project('PictureBox',{MacOSMaterial:'sidebar'}),{minimumVersion:'26.0'}).report.diagnostics.length);
  });

  test(compile.name+' rejects unsupported appearance instead of serializing ignored metadata',()=>{
    for(const [type,properties,code] of [
      ['CommandButton',{MacOSControlSize:'extraLarge'},'MAC262'],
      ['PictureBox',{MacOSControlSize:'small'},'MAC261'],
      ['ProgressBar',{MacOSForegroundRole:'controlAccentColor'},'MAC261'],
      ['CommandButton',{MacOSControlStyle:'borderless',MacOSBackgroundRole:'windowBackgroundColor'},'MAC261'],
      ['CheckBox',{MacOSControlStyle:'switch',Value:2},380],
      ['CheckBox',{MacOSControlStyle:'switch',Value:0.5},380],
      ['TabStrip',{MacOSMaterial:'sidebar'},'MAC261'],
      ['TextBox',{MacOSControlStyle:'search',MultiLine:-1},'MAC260'],
      ['TextBox',{MacOSControlStyle:'search',PasswordChar:'*'},'MAC260'],
      ['TextBox',{MacOSControlSize:'mini',MultiLine:-1},'MAC261'],
      ['Label',{MacOSIndeterminate:-1},'MAC260'],
      ['Label',{MacOSForegroundRole:'unknown'},'MAC260'],
      ['Label',{MacOSUnknownStyle:'invented'},'MAC260']
    ]) assert.throws(()=>compile(project(type,properties)),e=>code===380
      ? e.number===380&&/Switches require the binary CheckBox Value 0 or 1/.test(e.message)
      : e.diagnostics?.some(d=>d.code===code)||code==='MAC260'&&e.number===380,JSON.stringify(properties));
    assert.doesNotThrow(()=>compile(project('CommandButton',{MacOSControlSize:'extraLarge'}),{minimumVersion:'26.0'}));
  });

  test(compile.name+' accepts all native semantic color roles and neutral defaults',()=>{
    for(const role of MACOS26_RESOURCE_NAMES) assert.doesNotThrow(()=>compile(project('TextBox',{MacOSForegroundRole:role,MacOSBackgroundRole:role})));
    assert.doesNotThrow(()=>compile(project('PictureBox',{MacOSControlSize:'regular',MacOSControlStyle:'automatic',MacOSMaterial:'none'})));
    assert.doesNotThrow(()=>compile(project('ProgressBar',{MacOSIndeterminate:-1})));
    assert.doesNotThrow(()=>compile(project('CheckBox',{MacOSControlStyle:'switch',MacOSForegroundRole:'labelColor',Caption:'Sync'})));
    assert.doesNotThrow(()=>compile(project('TextBox',{MultiLine:-1,PlaceholderText:'Multiple lines'})));
  });
}

test('native source and direct AOT preserve authored appearance scalars',()=>{
  const input=project('TextBox',{MacOSControlStyle:'search',MacOSForegroundRole:'labelColor',PlaceholderText:'Search Ω',MacOSAccessibilityIdentifier:'query'});
  const source=compileMacOS(input),aot=compileMacOSAOT(input),control=aot.metadata.modules.find(m=>m.controls)?.controls[0];
  assert.match(source.files['main.cpp'],/macoscontrolstyle/);
  assert.ok(control.properties.some(([name])=>name==='placeholdertext'));
  assert.deepEqual(source.report.appearance,aot.report.appearance);
  assert.equal(input.modules[0].form.controls[0].properties.MacOSControlStyle,'search');
});
