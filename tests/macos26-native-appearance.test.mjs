import test from 'node:test';
import assert from 'node:assert/strict';
import {compileMacOS} from '../packages/macos-native/src/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {createForm,createControl} from '../src/project/model.js';
import {MACOS26_RESOURCE_NAMES} from '../src/theme/macos26-resources.js';
import {macOS26Example} from '../src/project/macos26-example.js';

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

  test(compile.name+' lowers segmented tracking and transparent native tab navigation',()=>{
    for(const [style,tracking] of [[0,'momentary'],[1,'multiple'],[2,'single']]) {
      const input=project('Toolbar',{MacOSControlStyle:'segmented',Buttons:[{Key:'one',Caption:'One',Style:style,Value:style===0?0:1},{Key:'two',Caption:'Two',Style:style,Value:0}]});
      const result=compile(input);assert.equal(result.report.appearance.controls[0].widget,'NSSegmentedControl');assert.equal(result.report.appearance.controls[0].tracking,tracking);
    }
    for(const type of ['TabStrip','SSTab'])for(const orientation of [0,1]) {
      const input=project(type,{MacOSControlStyle:'segmented',MacOSMaterial:'sidebar',TabOrientation:orientation,TabsPerRow:1,Tabs:[{Caption:'One'},{Caption:'Hidden',Visible:0},{Caption:'Disabled',Enabled:0},{Caption:'Four'}],Tab:1});
      const result=compile(input);assert.match(result.report.appearance.controls[0].pages,/retained NSTabViewItems/);assert.equal(result.report.appearance.controls[0].material.structure,'existing-control-container');
    }
  });

  test(compile.name+' diagnoses native collection capabilities before emitting an application',()=>{
    for(const [type,properties,code] of [
      ['SSTab',{Tabs:[{Caption:'Hidden',Visible:0}]},'MAC261'],
      ['Toolbar',{MacOSControlStyle:'segmented',Buttons:[{Caption:'Icon',Image:1}]},'MAC261'],
      ['SSTab',{MacOSControlStyle:'segmented',Tabs:[{Caption:'Icon',Picture:'logo.png'}]},'MAC261'],
      ['Toolbar',{Buttons:[{Caption:'Huge '+ 'x'.repeat(1048576)}]},'MAC265'],
      ['Toolbar',{Buttons:[{Caption:{nested:'unsupported'}}]},'MAC265'],
      ['Toolbar',{Buttons:[{Style:6}]},'MAC265'],
      ['Toolbar',{Buttons:[{Style:1.5}]},'MAC265'],
      ['Toolbar',{Buttons:[{Value:-1}]},'MAC265'],
      ['Toolbar',{Buttons:[{Caption:'One',Text:'Two'}]},'MAC265'],
      ['Toolbar',{Buttons:[{Style:1,style:2}]},'MAC265'],
      ['Toolbar',{MacOSControlStyle:'segmented',Buttons:[{style:1},{style:2}]},'MAC265'],
      ['Toolbar',{MacOSControlStyle:'segmented',Buttons:[{style:1,value:1}]},'MAC265'],
      ['SSTab',{Tabs:[{Caption:'One',caption:'Two'}]},'MAC265'],
      ['SSTab',{Tabs:[null]},'MAC265']
    ])assert.throws(()=>compile(project(type,properties)),e=>e.diagnostics?.some(d=>d.code===code));
    for(const Buttons of [[{Style:0,Value:1}],[{Style:1},{Style:2}],[{Style:2,Value:1},{Style:2,Value:1}],[{Style:3}]])
      assert.throws(()=>compile(project('Toolbar',{MacOSControlStyle:'segmented',Buttons})),e=>e.number===380||e.diagnostics?.some(d=>d.code==='MAC260'));
  });

  test(compile.name+' preserves the XAML authoring gate before collection ABI normalization',()=>{
    const input=macOS26Example(),before=structuredClone(input);assert.doesNotThrow(()=>compile(input));assert.deepEqual(input,before);
    const form=input.modules.find(module=>module.form&&module.xaml);assert.ok(form);form.form.controls[0].properties.Left+=15;
    assert.throws(()=>compile(input),e=>e.diagnostics?.some(d=>d.code==='VBXAML2201'));
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

test('native collection ABI resolves legacy tab ownership without mutating returned or authored forms',()=>{
  const input=project('SSTab',{Tabs:2,Tab:1,'TabCaption(0)':'General','TabCaption(1)':'Advanced','Tab(0).Control(0)':'Child'});
  const child=createControl('TextBox','Child');child.parent='Subject';child.properties.Left=-74700;input.modules[0].form.controls.push(child);
  const before=structuredClone(input),source=compileMacOS(input),aot=compileMacOSAOT(input);
  assert.deepEqual(input,before);assert.equal(source.project.modules[0].form.controls[0].properties.Tabs,2);assert.equal(aot.project.modules[0].form.controls[1].properties.Left,-74700);
  const controls=aot.metadata.modules.find(module=>module.controls)?.controls;
  const property=(control,name)=>aot.metadata.literals[control.properties.find(([key])=>key===name)[1]];
  const tabs=controls.find(control=>control.name==='Subject'),edit=controls.find(control=>control.name==='Child');
  assert.equal(property(tabs,'tabs').type,'array');assert.deepEqual(property(tabs,'tabs').value.map(value=>JSON.parse(value.value).Caption),['General','Advanced']);
  assert.equal(property(tabs,'tab').value,'1');assert.equal(property(edit,'tabpage').value,'0');assert.equal(property(edit,'left').value,'300');
  assert.match(source.files['main.cpp'],/"tabpage"/);
});
