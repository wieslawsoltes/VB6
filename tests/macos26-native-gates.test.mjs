import test from 'node:test';
import assert from 'node:assert/strict';
import {macOS26Example,MACOS26_PREFERENCES_XAML} from '../src/project/macos26-example.js';
import {xamlBuildDiagnostics,formStamp} from '../src/xaml/contract.js';
import {compileMacOS} from '../packages/macos-native/src/compiler.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
import {macOS26NativeSampleProject,MACOS26_NATIVE_SAMPLE_MARKER} from '../tools/macos26-native-sample.mjs';
import {requireMacOS26NativeVerification} from '../tools/embed-macos-aot-runtime.mjs';

test('native acceptance extends the built-in sample without rewriting its XAML or input',()=>{
  const input=macOS26Example(),before=structuredClone(input),project=macOS26NativeSampleProject(input);
  const original=input.modules[0],form=project.modules[0],entry=project.modules.find(module=>module.name==='Entry');
  assert.deepEqual(input,before);
  assert.notEqual(form.form,original.form);
  assert.deepEqual(form.form,original.form);
  assert.deepEqual(form.xaml,original.xaml);
  assert.equal(form.xaml.text,MACOS26_PREFERENCES_XAML);
  assert.equal(form.xaml.base,formStamp(form.form));
  assert.deepEqual(xamlBuildDiagnostics(project),[]);
  assert.ok(form.code.startsWith(original.code));
  assert.equal(project.startup,'Sub Main');
  assert.match(entry.code,new RegExp('Load Form1\\s+Unload Form1\\s+Debug\\.Print "'+MACOS26_NATIVE_SAMPLE_MARKER+'"'));
});

for(const [name,compile,options] of [
  ['source',compileMacOS,{}],
  ...[0,1,2,3].map(optimization=>['AOT O'+optimization,compileMacOSAOT,{optimization}])
])test('macOS 26 native acceptance compiles '+name+' and retains authored state',()=>{
  const project=macOS26NativeSampleProject(),before=structuredClone(project),result=compile(project,options);
  assert.deepEqual(project,before);
  assert.deepEqual(xamlBuildDiagnostics(project),[]);
  const appearances=new Map(result.report.appearance.controls.map(control=>[control.control,control]));
  for(const [name,tracking] of [['LayoutMode','single'],['Options','multiple'],['Actions','momentary']]) {
    assert.equal(appearances.get(name)?.widget,'NSSegmentedControl');
    assert.equal(appearances.get(name)?.tracking,tracking);
  }
  assert.equal(appearances.get('Pages')?.widget,'NSSegmentedControl');
});

test('macOS runtime verification rejects missing and non-Boolean native evidence',()=>{
  const flags=['appearanceControlsVerified','segmentedControlsVerified','macOS26SampleVerified'];
  assert.throws(()=>requireMacOS26NativeVerification(),/native appearance, segmented controls and sample execution proof/);
  // Exercise only rejection paths. These incomplete records never authorize
  // payload generation or manufacture a successful native execution report.
  for(const flag of flags)for(const value of [undefined,false,0,1,'true']) {
    assert.throws(()=>requireMacOS26NativeVerification({[flag]:value}),error=>error.message.includes(flag));
  }
});
