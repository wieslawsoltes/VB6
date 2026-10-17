import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,normalizeProject,createControl} from '../src/project/model.js';
import {validateWinUI3Appearance,validateWinUI3Properties,winui3ThemeValues,winui3CssColor,winui3CssThickness,clearWinUI3Overrides} from '../src/theme/winui3-compat.js';

const appearance=()=>({version:1,sourceType:'Button',requestedTheme:'Default',properties:{Padding:[11,5,11,6],CornerRadius:[4,4,4,4],FontWeight:600},resources:{
  Background:{key:'PanelBrush',values:{Light:'#80402010',Dark:'#CC102040',HighContrast:'#FF000000'}},
  Foreground:{key:'PanelText',values:{Default:'#FFFFFFFF'}}
}});
test('theme branches and alpha survive project normalization without mutating authored data',()=>{
  const project=newProject(),button=createControl('CommandButton');button.properties.WinUI3=appearance();project.modules[0].form.controls=[button];
  const snapshot=structuredClone(project),normalized=normalizeProject(project),metadata=normalized.modules[0].form.controls[0].properties.WinUI3;
  assert.deepEqual(project,snapshot);assert.deepEqual(metadata,button.properties.WinUI3);
  assert.equal(winui3CssColor(winui3ThemeValues(metadata,'Light').Background),'#40201080');
  assert.equal(winui3CssColor(winui3ThemeValues(metadata,'Dark').Background),'#102040cc');
  assert.equal(winui3CssColor(winui3ThemeValues(metadata,'HighContrast').Foreground),'#ffffffff');
  assert.deepEqual(winui3ThemeValues(metadata,'Dark').Padding,[11,5,11,6]);
});
test('resource fallback selects Default before either alternate normal theme',()=>{
  const value=appearance();value.resources.Background.values.Default='#FF010203';
  assert.equal(winui3ThemeValues(value,'Default').Background,'#FF010203');
  delete value.resources.Background.values.HighContrast;
  assert.equal(winui3ThemeValues(value,'HighContrast').Background,'#FF010203');
});
test('XAML alpha rotation and thickness ordering do not interchange CSS channels or sides',()=>{
  for(const [xaml,css] of [['#8123','#1238'],['#123','#123'],['#00FF0000','#ff000000'],['#7FAABBCC','#aabbcc7f'],['#AABBCC','#aabbcc']])
    assert.equal(winui3CssColor(xaml),css);
  assert.equal(winui3CssThickness([1,2,3,4]),'2px 3px 4px 1px');
});
test('untrusted presentation input cannot inject CSS, network references or unknown executable metadata',()=>{
  for(const color of ['url(https://example.invalid/image)','red; display:none','#ff','var(--secret)','expression(test)','rgb(1 2 3)']) {
    const value=appearance();value.properties.Background=color;
    assert.throws(()=>validateWinUI3Appearance(value,'CommandButton'),/hexadecimal color/);
  }
  for(const change of [v=>v.version=2,v=>v.sourceType='TextBox',v=>v.requestedTheme='dark',v=>v.template='HTML',
    v=>v.properties.Padding=[1,2,3,Infinity],v=>v.properties.CornerRadius=[1,-1,1,1],v=>v.properties.Opacity=NaN,
    v=>v.properties.FontWeight=1001,v=>v.resources.Background.values.Other='#fff',v=>v.resources.Background.key='a\0b',
    v=>v.properties=JSON.parse('{"__proto__":{"evil":true}}')]) {
    const value=appearance();change(value);assert.throws(()=>validateWinUI3Appearance(value,'CommandButton'));
  }
});
test('same-valued native color edits relinquish corresponding theme branches only',()=>{
  const props={WinUI3:appearance(),BackColor:0,ForeColor:16777215};
  props.WinUI3.properties.Background='#80402010';clearWinUI3Overrides(props,{BackColor:0});
  assert.equal(props.WinUI3.properties.Background,undefined);assert.equal(props.WinUI3.resources.Background,undefined);
  assert.equal(props.WinUI3.resources.Foreground.key,'PanelText');assert.equal(props.WinUI3.properties.FontWeight,600);
  clearWinUI3Overrides(props,{FontBold:0});assert.equal(props.WinUI3.properties.FontWeight,undefined);
});
test('an explicit combined metadata/color transaction retains the new binding',()=>{
  const props={WinUI3:appearance()};clearWinUI3Overrides(props,{BackColor:0,WinUI3:appearance()});
  assert.equal(props.WinUI3.resources.Background.key,'PanelBrush');
});
test('ToggleSwitch and ProgressBar carry truthful binary and indeterminate semantics',()=>{
  const toggle={version:1,sourceType:'ToggleSwitch',properties:{Header:'Network',OnContent:'Connected',OffContent:'Offline'}};
  validateWinUI3Properties({WinUI3:toggle,Value:1},'CheckBox');
  assert.throws(()=>validateWinUI3Properties({WinUI3:toggle,Value:2},'CheckBox'),/binary/);
  validateWinUI3Appearance({version:1,sourceType:'ProgressBar',properties:{IsIndeterminate:true}},'ProgressBar');
  assert.throws(()=>validateWinUI3Appearance({version:1,sourceType:'Button',properties:{IsIndeterminate:true}},'CommandButton'),/ProgressBar/);
  assert.throws(()=>validateWinUI3Appearance({version:1,sourceType:'CheckBox',properties:{Header:'Wrong presenter'}},'CheckBox'),/ToggleSwitch/);
});
