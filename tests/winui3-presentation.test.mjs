import test from 'node:test';
import assert from 'node:assert/strict';
import {newProject,normalizeProject,createControl} from '../src/project/model.js';
import {validateWinUI3Appearance,validateWinUI3Properties,validateWinUI3Brush,winui3ThemeValues,winui3StateValues,winui3CssColor,winui3CssBrush,winui3GradientPoints,winui3CssThickness,clearWinUI3Overrides,hasWinUI3Override} from '../src/theme/winui3-compat.js';

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
test('native padding edits release the entire live thickness without removing unrelated appearance',()=>{
  for(const key of ['LayoutPadding','LayoutPaddingLeft','LayoutPaddingTop','LayoutPaddingRight','LayoutPaddingBottom']) {
    const props={WinUI3:appearance()};props.WinUI3.resources.Padding={key:'PanelPadding',values:{Light:[1,2,3,4],Dark:[5,6,7,8]}};
    clearWinUI3Overrides(props,{[key]:0});
    assert.equal(props.WinUI3.properties.Padding,undefined);assert.equal(props.WinUI3.resources.Padding,undefined);
    assert.equal(props.WinUI3.resources.Background.key,'PanelBrush');
  }
});
test('inspector ownership includes fonts, padding and state-only brushes and ends after release',()=>{
  const props={WinUI3:appearance()};
  assert.equal(hasWinUI3Override(props,'FontBold'),true);assert.equal(hasWinUI3Override(props,'LayoutPaddingLeft'),true);
  assert.equal(hasWinUI3Override(props,'Caption'),false);
  delete props.WinUI3.resources.Foreground;props.WinUI3.states={PointerOver:{Foreground:'#FF123456'}};
  assert.equal(hasWinUI3Override(props,'ForeColor'),true);
  clearWinUI3Overrides(props,{ForeColor:0,FontBold:0,LayoutPaddingLeft:0});
  for(const key of ['ForeColor','FontBold','LayoutPaddingLeft'])assert.equal(hasWinUI3Override(props,key),false);
});
test('ToggleSwitch and ProgressBar carry truthful binary and indeterminate semantics',()=>{
  const toggle={version:1,sourceType:'ToggleSwitch',properties:{Header:'Network',OnContent:'Connected',OffContent:'Offline'}};
  validateWinUI3Properties({WinUI3:toggle,Value:1},'CheckBox');
  assert.throws(()=>validateWinUI3Properties({WinUI3:toggle,Value:2},'CheckBox'),/binary/);
  validateWinUI3Appearance({version:1,sourceType:'ProgressBar',properties:{IsIndeterminate:true}},'ProgressBar');
  assert.throws(()=>validateWinUI3Appearance({version:1,sourceType:'Button',properties:{IsIndeterminate:true}},'CommandButton'),/ProgressBar/);
  assert.throws(()=>validateWinUI3Appearance({version:1,sourceType:'CheckBox',properties:{Header:'Wrong presenter'}},'CheckBox'),/ToggleSwitch/);
});

const gradient=()=>({kind:'LinearGradientBrush',startPoint:[0,0],endPoint:[0,3],mappingMode:'Absolute',spreadMethod:'Pad',opacity:1,
  relativeTransform:{type:'ScaleTransform',scaleX:1,scaleY:-1,centerX:0,centerY:.5},
  gradientStops:[{offset:.33,color:'#29000000'},{offset:1,color:'#0F000000'}]});
test('absolute native elevation gradients retain the 0.99 DIP stop and relative reflection at every size',()=>{
  const brush=gradient();validateWinUI3Brush(brush);
  assert.equal(winui3CssBrush(brush),'linear-gradient(to top, #00000029 0.99px, #0000000f 3px)');
  assert.deepEqual(winui3GradientPoints(brush,120,32),[0,32,0,29]);
  assert.deepEqual(winui3GradientPoints(brush,120,48),[0,48,0,45]);
  brush.relativeTransform=null;
  assert.equal(winui3CssBrush(brush),'linear-gradient(to bottom, #00000029 0.99px, #0000000f 3px)');
});
test('relative gradients preserve directional offset, stop ordering and brush opacity',()=>{
  const brush=gradient();Object.assign(brush,{startPoint:[.25,0],endPoint:[.75,0],mappingMode:'RelativeToBoundingBox',opacity:.5,relativeTransform:null,
    gradientStops:[{offset:1,color:'#FFFF0000'},{offset:0,color:'#800000FF'},{offset:1,color:'#FF00FF00'}]});
  validateWinUI3Brush(brush);
  assert.deepEqual(winui3GradientPoints(brush,200,40),[50,0,150,0]);
  assert.equal(winui3CssBrush(brush),'linear-gradient(to right, rgba(0, 0, 255, 0.25098039) 25%, rgba(255, 0, 0, 0.5) 75%, rgba(0, 255, 0, 0.5) 75%)');
  assert.equal(brush.gradientStops[0].offset,1,'rendering does not mutate authored stop order');
});
test('unsupported gradient geometry and executable brush payloads fail before rendering',()=>{
  for(const change of [b=>b.kind='ImageBrush',b=>b.endPoint=[3,3],b=>b.endPoint=[0,0],b=>b.spreadMethod='Repeat',
    b=>b.opacity=Infinity,b=>b.relativeTransform.type='MatrixTransform',b=>b.relativeTransform.scaleY=0,
    b=>b.gradientStops[0].color='url(https://example.invalid)',b=>b.gradientStops[0].offset=2,b=>b.source='https://example.invalid']) {
    const brush=gradient();change(brush);assert.throws(()=>validateWinUI3Brush(brush));
  }
  assert.throws(()=>validateWinUI3Brush(gradient(),{foreground:true}),/Background and BorderBrush/);
});
test('state resources stay scoped by theme and explicit native color edits release every matching state',()=>{
  const value=appearance();value.states={PointerOver:{Background:{key:'Hover',values:{Light:'#80402010',Dark:'#80001020'}},Foreground:'#FF000000'},
    Pressed:{BorderBrush:gradient()},Disabled:{Background:'#00FFFFFF'}};
  validateWinUI3Appearance(value,'CommandButton');
  assert.equal(winui3StateValues(value,'Dark').PointerOver.Background,'#80001020');
  assert.equal(winui3StateValues(value,'Light').PointerOver.Foreground,'#FF000000');
  clearWinUI3Overrides({WinUI3:value},{BackColor:0});
  assert.equal(value.states.PointerOver.Background,undefined);assert.equal(value.states.Disabled.Background,undefined);
  assert.equal(value.states.PointerOver.Foreground,'#FF000000');assert.equal(value.states.Pressed.BorderBrush.kind,'LinearGradientBrush');
  value.states.PointerOver.Padding=[1,1,1,1];assert.throws(()=>validateWinUI3Appearance(value,'CommandButton'),/state target/);
});
