import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormXaml,createVb6XamlSchema,formToXaml} from '../src/xaml/forms.js';
import {PRESENTATION_NS,XAML_NS,WINUI_CONTROLS_NS} from '../packages/xaml-compiler/src/index.js';
import {clearWinUI3Overrides,winui3ThemeValues} from '../src/theme/winui3-compat.js';

const schema=createVb6XamlSchema();
const builtin='<ResourceDictionary.MergedDictionaries><controls:XamlControlsResources/></ResourceDictionary.MergedDictionaries>';
const resources=body=>`<Page.Resources><ResourceDictionary>${body}</ResourceDictionary></Page.Resources>`;
const themes=values=>'<ResourceDictionary.ThemeDictionaries>'+Object.entries(values).map(([theme,value])=>`<ResourceDictionary x:Key="${theme}">${value}</ResourceDictionary>`).join('')+'</ResourceDictionary.ThemeDictionaries>';
const brush=(key,color)=>`<SolidColorBrush x:Key="${key}" Color="${color}"/>`;
const document=body=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:controls="${WINUI_CONTROLS_NS}" x:Name="Form1">${body}</Page>`;
const compile=(body,settings={})=>compileFormXaml(document(body),{schema,settings});
const good=(body,settings)=>{const result=compile(body,settings);assert.equal(result.success,true,JSON.stringify(result.diagnostics));return result.form;};
const properties=(form,name)=>{const control=form.controls.find(c=>c.name===name);assert.ok(control,name);return control.properties;};
const appearance=(form,name)=>properties(form,name).WinUI3;
const commonForeground={Light:'#E4000000',Dark:'#FFFFFFFF',HighContrast:'#FFFFFFFF'};
const fieldBackground={Light:'#B3FFFFFF',Dark:'#0FFFFFFF',HighContrast:'#FF000000'};

test('field theme defaults preserve exact normal brushes and native typography in an opposite theme scope',()=>{
 const types=['TextBox','PasswordBox','RichEditBox','ComboBox'];
 const form=good(resources(builtin)+'<Canvas RequestedTheme="Dark">'+types.map(type=>`<controls:${type} x:Name="${type}"/>`).join('')+'</Canvas>',{theme:'fluent'});
 for(const type of types) {
  const p=properties(form,type),a=p.WinUI3,prefix=type==='ComboBox'?'ComboBox':'TextControl';
  assert.equal(a.properties.Foreground,'#FFFFFFFF',type);assert.equal(a.properties.Background,'#0FFFFFFF',type);
  assert.equal(a.resources.Foreground.key,prefix+'Foreground');assert.equal(a.resources.Background.key,prefix+'Background');
  for(const theme of Object.keys(commonForeground)) {
   const values=winui3ThemeValues(a,theme);
   assert.equal(values.Foreground,commonForeground[theme]);assert.equal(values.Background,fieldBackground[theme]);
   assert.deepEqual(values.BorderThickness,[1,1,1,1]);assert.deepEqual(values.CornerRadius,[4,4,4,4]);
   assert.deepEqual(values.Padding,type==='ComboBox'?[12,5,0,7]:[10,5,6,6]);
  }
  assert.equal(p.FontName,'Segoe UI Variable');assert.equal(p.FontSize,10.5);
  assert.equal(a.style,undefined,'a presentation subset must not claim complete native style support');
 }
});

test('normal field aliases and per-control dictionaries resolve through their real lexical scopes',()=>{
 const foregrounds={Light:'#FF112233',Dark:'#FF445566',HighContrast:'#FF778899'};
 const local=themes(Object.fromEntries(Object.entries(foregrounds).map(([theme,color])=>[theme,brush('TextControlForeground',color)])));
 const form=good(resources(builtin+'<Color x:Key="ControlFillColorDefault">#80102030</Color>')+
  '<Canvas><TextBox x:Name="Plain"/><TextBox x:Name="Scoped" RequestedTheme="Dark"><TextBox.Resources><ResourceDictionary>'+local+'</ResourceDictionary></TextBox.Resources></TextBox>'+
  '<ComboBox x:Name="Choices"><ComboBox.Resources>'+brush('ComboBoxForeground','#FFAB1200')+'</ComboBox.Resources></ComboBox></Canvas>');
 for(const theme of Object.keys(foregrounds)) {
  // The native high-contrast branch uses SystemColorWindowColor, not the
  // normal-theme ControlFillColorDefault dependency shadowed above.
  const background=theme==='HighContrast'?'#FF000000':'#80102030';
  assert.equal(winui3ThemeValues(appearance(form,'Plain'),theme).Background,background);
  assert.equal(winui3ThemeValues(appearance(form,'Scoped'),theme).Background,background);
  assert.equal(winui3ThemeValues(appearance(form,'Scoped'),theme).Foreground,foregrounds[theme]);
  assert.equal(winui3ThemeValues(appearance(form,'Plain'),theme).Foreground,commonForeground[theme]);
  assert.equal(winui3ThemeValues(appearance(form,'Choices'),theme).Foreground,'#FFAB1200');
 }
});

test('authored styles and local values override the presentation projection while x:Null retains theme defaults',()=>{
 const style='<Style x:Key="Field" TargetType="TextBox"><Setter Property="Foreground" Value="#FFAA0000"/><Setter Property="Padding" Value="2,3,4,5"/></Style>';
 const form=good(resources(builtin+style)+'<Canvas RequestedTheme="Dark"><TextBox x:Name="Styled" Style="{StaticResource Field}"/><TextBox x:Name="Local" Style="{StaticResource Field}" Foreground="#FF00AA00" FontSize="22"/><TextBox x:Name="Null" Style="{x:Null}"/></Canvas>');
 assert.equal(appearance(form,'Styled').properties.Foreground,'#FFAA0000');assert.deepEqual(appearance(form,'Styled').properties.Padding,[2,3,4,5]);
 assert.equal(appearance(form,'Styled').resources.Foreground,undefined);assert.ok(appearance(form,'Styled').resources.Background);
 assert.equal(appearance(form,'Local').properties.Foreground,'#FF00AA00');assert.equal(appearance(form,'Local').properties.FontSize,22);
 assert.equal(appearance(form,'Local').resources.FontSize,undefined);
 assert.equal(appearance(form,'Null').properties.Foreground,'#FFFFFFFF');assert.deepEqual(appearance(form,'Null').properties.Padding,[10,5,6,6]);
 for(const type of ['TextBox','PasswordBox','RichEditBox','ComboBox']) {
  const result=compile(resources(builtin)+`<${type} Style="{StaticResource Default${type}Style}"/>`);
  assert.equal(result.success,false,type+' must still diagnose unsupported full-style behavior');
  assert.match(result.diagnostics.map(d=>d.message).join('\n'),/unsupported|requires a supported control template bridge/i);
 }
});

test('Compact native resources override normal field metrics without changing unrelated defaults',()=>{
 const compact='<ResourceDictionary.MergedDictionaries><controls:XamlControlsResources/><ResourceDictionary Source="ms-appx:///Microsoft.UI.Xaml/DensityStyles/Compact.xaml"/></ResourceDictionary.MergedDictionaries>';
 const form=good(resources(compact)+'<Canvas><TextBox x:Name="Text"/><ComboBox x:Name="Choices"/></Canvas>');
 assert.equal(appearance(form,'Text').properties.FontSize,14);assert.equal(appearance(form,'Choices').properties.FontSize,14);
 assert.deepEqual(appearance(form,'Text').properties.Padding,[2,2,6,1]);
 assert.deepEqual(appearance(form,'Choices').properties.Padding,[12,1,0,3]);
 assert.equal(appearance(form,'Text').properties.Foreground,'#E4000000');
});

test('RichEditBox normal, pointer, focused and disabled paints use the shared native TextControl resources',()=>{
 const form=good(resources(builtin+brush('TextControlForegroundFocused','#FF123ABC'))+'<RichEditBox x:Name="Document"/>'),a=appearance(form,'Document');
 assert.equal(a.resources.Foreground.key,'TextControlForeground');assert.equal(a.resources.Background.key,'TextControlBackground');
 assert.equal(a.states.PointerOver.Foreground.key,'TextControlForegroundPointerOver');
 assert.equal(a.states.Focused.Foreground.key,'TextControlForegroundFocused');
 assert.ok(Object.values(a.states.Focused.Foreground.values).every(value=>value==='#FF123ABC'));
 assert.equal(a.states.Disabled.Foreground.values.Light,'#5C010101');
 assert.equal(a.states.Disabled.Foreground.values.Dark,'#5DFEFEFE');
 assert.equal(a.states.Focused.Background.values.Dark,'#B31E1E1E');
});

test('check, radio, switch and list defaults use native normal text without projecting glyph geometry',()=>{
 const form=good(resources(builtin)+'<Canvas RequestedTheme="Dark"><CheckBox x:Name="Check"/><RadioButton x:Name="Radio"/><ToggleSwitch x:Name="Switch"/><ListBox x:Name="List"/></Canvas>');
 for(const [name,key] of [['Check','CheckBoxForegroundUnchecked'],['Radio','RadioButtonForeground'],['Switch','ToggleSwitchContentForeground'],['List','ListBoxForeground']]) {
  const a=appearance(form,name);assert.equal(a.resources.Foreground.key,key);assert.equal(a.properties.Foreground,'#FFFFFFFF');
  assert.equal(a.properties.FontFamily,'Segoe UI Variable');assert.equal(a.properties.FontSize,14);
  if(name!=='List')for(const key of ['Background','BorderBrush','BorderThickness','Padding','CornerRadius'])assert.equal(a.properties[key],undefined,name+'.'+key);
 }
 const a=appearance(form,'Check');
 assert.equal(a.states.PointerOver.Foreground.key,'CheckBoxForegroundUncheckedPointerOver');
 assert.equal(a.states.Checked.Foreground.key,'CheckBoxForegroundChecked');
 assert.equal(a.states.CheckedDisabled.Foreground.key,'CheckBoxForegroundCheckedDisabled');
 assert.equal(a.states.IndeterminatePressed.Foreground.key,'CheckBoxForegroundIndeterminatePressed');
 assert.equal(appearance(form,'Radio').states.PointerOver.Foreground.key,'RadioButtonForegroundPointerOver');
 assert.equal(appearance(form,'Radio').states.Checked,undefined,'radio check state changes the glyph, not the content foreground');
 assert.equal(appearance(form,'Switch').states.Disabled.Foreground.key,'ToggleSwitchContentForegroundDisabled');
 assert.equal(appearance(form,'List').properties.Background,'#FF2B2B2B');
});

test('slider and progress defaults bind source track/value colors and omit unimplemented thumb geometry',()=>{
 const form=good(resources(builtin+brush('SliderTrackValueFillPressed','#FF123456')+'<Color x:Key="ProgressBarBackground">#80443322</Color>')+'<Canvas RequestedTheme="Dark"><Slider x:Name="Range"/><ProgressBar x:Name="Progress"/></Canvas>');
 const range=appearance(form,'Range'),progress=appearance(form,'Progress');
 assert.equal(range.resources.Background.key,'SliderTrackFill');assert.equal(range.resources.Foreground.key,'SliderTrackValueFill');
 assert.equal(range.properties.Background,'#8BFFFFFF');assert.equal(range.properties.Foreground,'#FF80CAFF');
 assert.equal(range.states.Disabled.Background.key,'SliderTrackFillDisabled');assert.equal(range.states.PointerOver.Foreground.key,'SliderTrackValueFillPointerOver');
 assert.ok(Object.values(range.states.Pressed.Foreground.values).every(color=>color==='#FF123456'));
 assert.equal(progress.resources.Background.key,'ProgressBarBackground');assert.equal(progress.resources.Foreground.key,'ProgressBarForeground');
 assert.equal(progress.properties.Background,'#80443322');assert.equal(progress.properties.Foreground,'#FF80CAFF');
 for(const a of [range,progress])for(const key of ['BorderBrush','BorderThickness','CornerRadius'])assert.equal(a.properties[key],undefined,key);
});

test('native FontFamily and FontWeight resource elements retain typed live theme values',()=>{
 const fonts=themes({Light:'<FontFamily x:Key="Family">Arial</FontFamily><FontWeight x:Key="Weight">Normal</FontWeight>',Dark:'<FontFamily x:Key="Family">Georgia</FontFamily><FontWeight x:Key="Weight">SemiBold</FontWeight>',HighContrast:'<FontFamily x:Key="Family">Verdana</FontFamily><FontWeight x:Key="Weight">500</FontWeight>'});
 const form=good(resources(builtin+fonts)+'<RichEditBox x:Name="Document" FontFamily="{ThemeResource Family}" FontWeight="{ThemeResource Weight}"/>');
 const a=appearance(form,'Document');
 assert.deepEqual(a.resources.FontFamily.values,{Default:'Georgia',Light:'Arial',Dark:'Georgia',HighContrast:'Verdana'});
 assert.deepEqual(a.resources.FontWeight.values,{Default:600,Light:400,Dark:600,HighContrast:500});
});

test('same-value native color ownership removes normal and state defaults and persists through serialization',()=>{
 const form=good(resources(builtin)+'<Canvas><TextBox x:Name="Text"/><Slider x:Name="Range"/></Canvas>');
 for(const name of ['Text','Range']) {
  const p=properties(form,name);clearWinUI3Overrides(p,{ForeColor:p.ForeColor});
  assert.equal(p.WinUI3.properties.Foreground,undefined);assert.equal(p.WinUI3.resources.Foreground,undefined);
  for(const state of Object.values(p.WinUI3.states))assert.equal(state.Foreground,undefined);
  assert.ok(p.WinUI3.resources.Background);
 }
 const result=compileFormXaml(formToXaml(form),{schema});assert.equal(result.success,true,JSON.stringify(result.diagnostics));assert.deepEqual(result.form,form);
});
