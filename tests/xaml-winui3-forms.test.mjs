import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormXaml,createVb6XamlSchema,formToXaml,synchronizeFormXaml,VB6_XAML_NS} from '../src/xaml/forms.js';
import {PRESENTATION_NS,XAML_NS,WINUI_CONTROLS_NS} from '../packages/xaml-compiler/src/index.js';
import {clearWinUI3Overrides,winui3ThemeValues} from '../src/theme/winui3-compat.js';
import {WINUI3_DICTIONARY_SOURCES} from '../src/theme/winui3-resources.js';
import {winui3HostResourceOptions} from '../src/xaml/winui3-lowering.js';
import {arrangeFormEdit} from '../src/layout/model.js';

const schema=createVb6XamlSchema();
const document=(body,attributes='')=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:controls="${WINUI_CONTROLS_NS}" xmlns:vb="${VB6_XAML_NS}" x:Name="Form1" ${attributes}>${body}</Page>`;
const compile=(body,{settings={},attributes=''}={})=>compileFormXaml(document(body,attributes),{schema,settings});
const good=(body,options)=>{const result=compile(body,options);assert.equal(result.success,true,JSON.stringify(result.diagnostics));return result.form;};
const bad=(body,pattern,options)=>{const result=compile(body,options);assert.equal(result.success,false,body);assert.equal(result.form,null);assert.match(result.diagnostics.map(d=>d.message).join('\n'),pattern);return result;};
const control=(form,name='B')=>{const result=form.controls.find(control=>control.name===name);assert.ok(result,name);return result;};
const appearance=(form,name='B')=>control(form,name).properties.WinUI3;
const resources=body=>`<Page.Resources><ResourceDictionary>${body}</ResourceDictionary></Page.Resources>`;
const merged=body=>`<ResourceDictionary.MergedDictionaries>${body}</ResourceDictionary.MergedDictionaries>`;
const themeDictionaries=entries=>'<ResourceDictionary.ThemeDictionaries>'+Object.entries(entries).map(([name,body])=>`<ResourceDictionary x:Key="${name}">${body}</ResourceDictionary>`).join('')+'</ResourceDictionary.ThemeDictionaries>';
const color=(name,value)=>`<Color x:Key="${name}">${value}</Color>`;
const brush=(name,value)=>`<SolidColorBrush x:Key="${name}" Color="${value}"/>`;
const standard=resources(merged('<controls:XamlControlsResources/>'));
const themeColors={Light:'#FF102030',Dark:'#FF8090A0',HighContrast:'#FFFFFF00'};
const tones=themeDictionaries(Object.fromEntries(Object.entries(themeColors).map(([theme,value])=>[theme,color('Tone',value)])));

test('ThemeResource retains exact live branches while StaticResource captures the selected host theme',()=>{
 const body=resources(tones)+'<Canvas><Button x:Name="B" Background="{ThemeResource Tone}"/><Button x:Name="Static" Background="{StaticResource Tone}"/></Canvas>';
 for(const [theme,expected] of [['fluent',themeColors.Light],['fluent-dark',themeColors.Dark],['contrast',themeColors.HighContrast]]) {
  const form=good(body,{settings:{theme}}),live=appearance(form),fixed=appearance(form,'Static');
  assert.deepEqual(live.resources.Background,{key:'Tone',values:{Default:themeColors.Dark,...themeColors}});
  assert.equal(live.properties.Background,expected);assert.equal(fixed.properties.Background,expected);
  assert.equal(fixed.resources.Background,undefined);
 }
});

test('dictionary lookup searches own entries, reverse merged dictionaries, then the selected theme',()=>{
 const theme=themeDictionaries({Default:color('Tone','#FF010101')}),merges=merged('<ResourceDictionary>'+color('Tone','#FF020202')+'</ResourceDictionary><ResourceDictionary>'+color('Tone','#FF030303')+'</ResourceDictionary>');
 for(const [body,expected] of [[theme,'#FF010101'],[theme+merges,'#FF030303'],[theme+merges+color('Tone','#FF040404'),'#FF040404']]) {
  const form=good(resources(body)+'<Button x:Name="B" Background="{ThemeResource Tone}"/>');
  assert.ok(Object.values(appearance(form).resources.Background.values).every(value=>value===expected));
 }
});

test('Default is a dictionary fallback and does not fill holes in an existing named theme',()=>{
 const body=resources(themeDictionaries({Default:color('OnlyDefault','#FF112233'),Light:color('Other','#FF556677')}))+'<Button x:Name="B" Background="{StaticResource OnlyDefault}"/>';
 bad(body,/Unknown static resource OnlyDefault/);
 assert.equal(appearance(good(body,{settings:{theme:'fluent-dark'}})).properties.Background,'#FF112233');
});

test('nearest RequestedTheme supplies static values, Default inherits, and high contrast overrides requests',()=>{
 const body=resources(tones)+'<Canvas RequestedTheme="Dark"><Button x:Name="B" RequestedTheme="Default" Background="{StaticResource Tone}"/><Canvas RequestedTheme="Light"><Button x:Name="Light" Background="{StaticResource Tone}"/></Canvas></Canvas>';
 const form=good(body,{attributes:'RequestedTheme="Light"'});
 assert.equal(appearance(form).properties.Background,themeColors.Dark);
 assert.equal(appearance(form).requestedTheme,'Default');
 assert.equal(appearance(form,'Light').properties.Background,themeColors.Light);
 const contrast=good(body,{attributes:'RequestedTheme="Dark"',settings:{theme:'contrast'}});
 assert.equal(appearance(contrast).properties.Background,themeColors.HighContrast);
 assert.equal(appearance(contrast,'Light').properties.Background,themeColors.HighContrast);
});

test('StaticResource brush retains a nested ThemeResource color and literal brush opacity',()=>{
 const form=good(resources(tones+'<SolidColorBrush x:Key="LiveBrush" Color="{ThemeResource Tone}" Opacity="0.5"/>')+'<Button x:Name="B" Background="{StaticResource LiveBrush}"/>');
 assert.equal(appearance(form).resources.Background.key,'Tone');
 assert.equal(appearance(form).resources.Background.values.Light,'#80102030');
 assert.equal(appearance(form).resources.Background.values.Dark,'#808090A0');
});

test('source dictionaries are offline allowlisted and Compact overlays only its own declared resources',()=>{
 for(const source of WINUI3_DICTIONARY_SOURCES.filter(source=>source.includes('/Themes/'))) {
  const form=good(resources(merged(`<ResourceDictionary Source="${source}"/>`))+'<Canvas><Button x:Name="B"/></Canvas>');
  assert.equal(appearance(form).style,'DefaultButtonStyle');assert.equal(appearance(form).properties.Background,'#B3FFFFFF');
 }
 const compact=resources(merged('<controls:XamlControlsResources/><ResourceDictionary Source="ms-appx:///Microsoft.UI.Xaml/DensityStyles/Compact.xaml"/>'));
 const form=good(compact+'<Canvas><Button x:Name="B" Padding="{StaticResource TextControlThemePadding}"/><Button x:Name="Other"/></Canvas>');
 assert.deepEqual(appearance(form).properties.Padding,[2,2,6,1]);
 assert.deepEqual(appearance(form,'Other').properties.Padding,[11,5,11,6]);
 bad(resources(merged('<ResourceDictionary Source="https://example.invalid/Generic.xaml"/>'))+'<Button/>',/allowlisted|External/);
 bad(resources(merged('<ResourceDictionary Source="ms-appx:///Microsoft.UI.Xaml/Themes/Generic.xaml"><x:Double x:Key="Extra">1</x:Double></ResourceDictionary>'))+'<Button/>',/inline/);
});

test('XamlControlsResources applies pinned default button typography, geometry and elevation brush',()=>{
 const form=good(standard+'<Canvas><Button x:Name="B" Content="Save"/></Canvas>'),p=control(form).properties,a=appearance(form);
 assert.equal(p.FontName,'Segoe UI Variable');assert.equal(p.FontSize,10.5);
 assert.equal(a.properties.FontSize,14);assert.equal(a.properties.FontWeight,400);
 assert.deepEqual(a.properties.Padding,[11,5,11,6]);assert.deepEqual(a.properties.BorderThickness,[1,1,1,1]);
 assert.deepEqual(a.properties.CornerRadius,[4,4,4,4]);assert.deepEqual(a.properties.FocusVisualMargin,[-3,-3,-3,-3]);
 assert.equal(a.properties.BackgroundSizing,'InnerBorderEdge');
 assert.deepEqual(a.properties.BorderBrush,{kind:'LinearGradientBrush',startPoint:[0,0],endPoint:[0,3],mappingMode:'Absolute',spreadMethod:'Pad',opacity:1,relativeTransform:{type:'ScaleTransform',scaleX:1,scaleY:-1,centerX:0,centerY:0.5},gradientStops:[{offset:0.33,color:'#29000000'},{offset:1,color:'#0F000000'}]});
 assert.equal(a.resources.Background.values.Dark,'#0FFFFFFF');assert.equal(a.resources.Background.values.HighContrast,'#FF000000');
});

test('theme style defaults underlay explicit styles and survive implicit style suppression',()=>{
 const implicit='<Style TargetType="Button"><Setter Property="Padding" Value="20"/><Setter Property="FontWeight" Value="Bold"/></Style>';
 const form=good(resources(merged('<XamlControlsResources/>')+implicit)+'<Canvas><Button x:Name="B" Style="{StaticResource AccentButtonStyle}"/><Button x:Name="Plain" Style="{x:Null}"/><Button x:Name="Implicit"/><Button x:Name="Local" Style="{StaticResource AccentButtonStyle}" Padding="1,2,3,4"/></Canvas>');
 const accent=appearance(form),plain=appearance(form,'Plain');
 assert.equal(accent.style,'AccentButtonStyle');assert.equal(accent.properties.Background,'#FF0067B8');
 assert.deepEqual(accent.properties.Padding,[11,5,11,6]);assert.deepEqual(accent.properties.BorderThickness,[1,1,1,1]);
 assert.equal(accent.properties.FontSize,14);assert.equal(accent.properties.FontWeight,400);
 assert.equal(plain.style,'DefaultButtonStyle');assert.deepEqual(plain.properties.Padding,[11,5,11,6]);assert.equal(plain.properties.FontWeight,400);
 assert.deepEqual(appearance(form,'Implicit').properties.Padding,[20,20,20,20]);assert.equal(appearance(form,'Implicit').properties.FontWeight,700);
 assert.deepEqual(appearance(form,'Local').properties.Padding,[1,2,3,4]);
});

test('presentation and public WinUI namespaces share implicit style type identity in both directions',()=>{
 for(const [target,tag] of [['Button','controls:Button'],['controls:Button','Button']]) {
  const form=good(resources(`<Style TargetType="${target}"><Setter Property="Padding" Value="3,4,5,6"/></Style>`)+`<${tag} x:Name="B"/>`);
  assert.deepEqual(appearance(form).properties.Padding,[3,4,5,6]);
 }
});

test('built-in alias and gradient dependencies obey lexical local shadows in each theme',()=>{
 const definitions=themeDictionaries(Object.fromEntries(Object.entries(themeColors).map(([theme,value])=>[theme,color('ControlFillColorDefault',value)+color('ControlStrokeColorSecondary',value)])));
 const form=good(resources(merged('<XamlControlsResources/><ResourceDictionary>'+definitions+'</ResourceDictionary>'))+'<Canvas><Button x:Name="B"/><Button x:Name="Static" Background="{StaticResource ButtonBackground}"/></Canvas>');
 const live=appearance(form);
 assert.deepEqual(live.resources.Background.values,{Default:themeColors.Dark,...themeColors,HighContrast:'#FF000000'});
 for(const theme of ['Light','Dark'])assert.equal(live.resources.BorderBrush.values[theme].gradientStops[0].color,themeColors[theme]);
 assert.equal(appearance(form,'Static').properties.Background,themeColors.Light);
 assert.equal(appearance(form,'Static').resources.Background,undefined);
 const own=good(resources(merged('<XamlControlsResources/>')+color('ControlFillColorDefault','#FF123456'))+'<Canvas><Button x:Name="B"/></Canvas>');
 assert.equal(appearance(own).properties.Background,'#FF123456');
});

test('visual state brush lookups retain per-control resource overrides and exact focused gradients',()=>{
 const body='<Canvas><Button x:Name="B"><Button.Resources>'+brush('ButtonBackgroundPointerOver','#FF123456')+'</Button.Resources></Button><Button x:Name="Other"/><TextBox x:Name="Field"/><ComboBox x:Name="Combo"/></Canvas>';
 const form=good(standard+body),a=appearance(form),other=appearance(form,'Other'),field=appearance(form,'Field');
 assert.equal(a.states.PointerOver.Background.values.Light,'#FF123456');
 assert.equal(other.states.PointerOver.Background.values.Light,'#80F9F9F9');
 assert.equal(a.states.Pressed.Foreground.values.Light,'#9E000000');
 assert.equal(field.states.Focused.BorderBrush.values.Light.kind,'LinearGradientBrush');
 assert.deepEqual(field.states.Focused.BorderBrush.values.Light.gradientStops,[{offset:1,color:'#FF0067B8'},{offset:1,color:'#0F000000'}]);
 assert.ok(appearance(form,'Combo').states.Focused.Foreground);
});

test('namespace aliases lower functional ToggleSwitch, ToggleButton and HyperlinkButton identities',()=>{
 const form=good(standard+'<Canvas><controls:ToggleSwitch x:Name="Switch" Header="Updates" OnContent="Enabled" OffContent="Paused" IsOn="True" Toggled="Switch_Click"/><controls:ToggleButton x:Name="B" IsChecked="True" Click="B_Click"/><controls:HyperlinkButton x:Name="Link" Content="Details" Click="Link_Click"/></Canvas>');
 const toggle=control(form),sw=control(form,'Switch'),link=control(form,'Link');
 assert.equal(toggle.type,'CheckBox');assert.equal(toggle.properties.Style,1);assert.equal(toggle.properties.Value,1);
 assert.equal(sw.type,'CheckBox');assert.equal(sw.properties.Value,1);
 assert.deepEqual({...sw.properties.WinUI3.properties},{Header:'Updates',OnContent:'Enabled',OffContent:'Paused'});
 assert.equal(link.type,'CommandButton');assert.equal(link.properties.FontUnderline,-1);
 assert.equal(link.properties.WinUI3.sourceType,'HyperlinkButton');
 assert.ok(toggle.properties.WinUI3.states.CheckedPointerOver.Background);assert.ok(toggle.properties.WinUI3.states.IndeterminateDisabled.BorderBrush);
});

test('explicit browser host accent ramp is complete and reproducible',()=>{
 const light=winui3HostResourceOptions('Light'),dark=winui3HostResourceOptions('Dark');
 assert.deepEqual(light.accentColors,{SystemAccentColor:'#FF0067B8',SystemAccentColorDark1:'#FF0067B8',SystemAccentColorDark2:'#FF00589C',SystemAccentColorDark3:'#FF004881',SystemAccentColorLight1:'#FF4099DC',SystemAccentColorLight2:'#FF80CAFF',SystemAccentColorLight3:'#FFACDDFF'});
 assert.equal(dark.accentColors.SystemAccentColor,'#FF80CAFF');
 const form=good(standard+'<Canvas><HyperlinkButton x:Name="B"/></Canvas>');
 assert.equal(appearance(form).properties.Foreground,light.accentColors.SystemAccentColorDark2);
 assert.equal(appearance(form).states.PointerOver.Foreground.values.Light,light.accentColors.SystemAccentColorDark3);
});

test('weights, alpha, nonuniform metrics and indeterminate progress remain typed presentation values',()=>{
 const form=good('<Canvas><Button x:Name="B" FontWeight="SemiLight" Background="#804080C0" Foreground="White" Opacity="0.25" Padding="1,2,3,4" BorderThickness="1,2,3,4" CornerRadius="1,2,3,4" HorizontalContentAlignment="Right" VerticalContentAlignment="Bottom"/><ProgressBar x:Name="P" IsIndeterminate="True"/></Canvas>');
 const p=control(form).properties,a=appearance(form);
 assert.equal(p.FontBold,0);assert.equal(a.properties.FontWeight,350);assert.equal(p.BackColor,0xC08040);
 assert.equal(a.properties.Background,'#804080C0');assert.equal(a.properties.Foreground,'#FFFFFFFF');assert.equal(a.properties.Opacity,0.25);
 assert.deepEqual(a.properties.Padding,[1,2,3,4]);assert.deepEqual(a.properties.CornerRadius,[1,2,3,4]);
 assert.equal(a.properties.HorizontalContentAlignment,'Right');assert.equal(a.properties.VerticalContentAlignment,'Bottom');
 assert.equal(appearance(form,'P').properties.IsIndeterminate,true);
});

test('authored axial gradients retain live stop colors, opacity, duplicate offsets and transform',()=>{
 const form=good(resources(tones)+'<Button x:Name="B"><Button.Background><LinearGradientBrush StartPoint="0,0" EndPoint="0,2" MappingMode="Absolute" Opacity="0.5"><LinearGradientBrush.RelativeTransform><ScaleTransform ScaleY="-1" CenterY="0.5"/></LinearGradientBrush.RelativeTransform><GradientStop Offset="0.5" Color="{ThemeResource Tone}"/><GradientStop Offset="0.5" Color="#40FFFFFF"/></LinearGradientBrush></Button.Background></Button>');
 const a=appearance(form),gradient=a.resources.Background.values.Dark;
 assert.equal(gradient.opacity,0.5);assert.equal(gradient.mappingMode,'Absolute');
 assert.deepEqual(gradient.gradientStops,[{offset:0.5,color:themeColors.Dark},{offset:0.5,color:'#40FFFFFF'}]);
 assert.deepEqual(gradient.relativeTransform,{type:'ScaleTransform',scaleX:1,scaleY:-1,centerX:0,centerY:0.5});
 assert.deepEqual(winui3ThemeValues(a,'HighContrast').Background.gradientStops[0],{offset:0.5,color:themeColors.HighContrast});
});

test('Canvas and StackPanel main-axis alignment follow their native arrangement rules',()=>{
 const canvas=good(standard+'<Canvas><Button x:Name="B" Canvas.Left="5" Canvas.Top="6" HorizontalAlignment="Right" VerticalAlignment="Bottom"/></Canvas>');
 assert.equal(control(canvas).properties.Left,75);assert.equal(control(canvas).properties.Top,90);
 const stack=good(standard+'<StackPanel Width="200"><Button x:Name="B" HorizontalAlignment="Right" VerticalAlignment="Bottom"/></StackPanel>',{settings:{anchoring:true}});
 assert.equal(control(stack).properties.LayoutAlign,2);assert.equal(control(stack).properties.LayoutShrink,0);
});

test('Border arranges its single child in an automatic inner cell with implicit stretch dimensions',()=>{
 const body='<Canvas><Border x:Name="Outer" Width="100" Height="50" Padding="5,7,11,13" BorderThickness="2,3,4,5"><Grid x:Name="B"/></Border></Canvas>';
 const form=good(body,{settings:{anchoring:true}}),outer=control(form,'Outer'),child=control(form);
 assert.equal(outer.properties.LayoutMode,5);assert.equal(outer.properties.LayoutGridColumns,'1fr');assert.equal(outer.properties.LayoutGridRows,'1fr');
 assert.equal(child.properties.LayoutWidthMode,2);assert.equal(child.properties.LayoutHeightMode,2);
 assert.equal(child.properties.LayoutColumn,0);assert.equal(child.properties.LayoutRow,0);
 bad('<Border><Button/></Border>',/Enable anchoring and automatic layout/);
 assert.equal(good('<Border x:Name="B" Width="100" Height="50"/>').controls[0].type,'PictureBox');
});

test('explicit native paint overrides relinquish all matching theme and visual state channels',()=>{
 const form=good(standard+'<Canvas><Button x:Name="B" vb:Designer.Properties="{}{&quot;BackColor&quot;:3351057}"/></Canvas>');
 const a=appearance(form);assert.equal(control(form).properties.BackColor,3351057);
 assert.equal(a.properties.Background,undefined);assert.equal(a.resources.Background,undefined);
 assert.ok(Object.values(a.states).every(state=>state.Background===undefined));
 assert.ok(a.states.PointerOver.Foreground);
});

test('WinUI metadata round-trips exactly through native XAML serialization',()=>{
 const form=good(standard+'<Canvas><Button x:Name="B" Style="{StaticResource AccentButtonStyle}"/><ToggleSwitch x:Name="Switch" Header="Theme" IsOn="True"/></Canvas>');
 const native=formToXaml(form,{schema}),result=compileFormXaml(native,{schema,form});
 assert.equal(result.success,true,JSON.stringify(result.diagnostics));assert.deepEqual(result.form,form);
});

test('source-preserving paint and layout padding edits retain dictionaries and exact model data',()=>{
 const settings={anchoring:true},text=document(resources(tones)+'<!-- keep dictionaries --><Grid x:Name="G" Width="200" Height="100" Padding="1,2,3,4"><Button x:Name="B" Width="80" Height="32" Background="{ThemeResource Tone}"/></Grid>');
 const initial=compileFormXaml(text,{schema,settings});assert.equal(initial.success,true,JSON.stringify(initial.diagnostics));
 const before=initial.form,after=structuredClone(before),button=control(after),grid=control(after,'G');
 clearWinUI3Overrides(button.properties,{BackColor:0x332211});button.properties.BackColor=0x332211;
 clearWinUI3Overrides(grid.properties,{LayoutPaddingLeft:90});grid.properties.LayoutPaddingLeft=90;
 arrangeFormEdit(before,after,[grid.id]);
 const next=synchronizeFormXaml(text,before,after,{schema,settings});
 assert.equal(next.regenerated,false,next.text);assert.match(next.text,/<!-- keep dictionaries -->/);assert.match(next.text,/ResourceDictionary.ThemeDictionaries/);assert.match(next.text,/Designer.Properties/);
 const loaded=compileFormXaml(next.text,{schema,settings,form:after});assert.equal(loaded.success,true,JSON.stringify(loaded.diagnostics));assert.deepEqual(loaded.form,after);
});

for(const [name,body,pattern] of [
 ['non-dictionary theme entry',resources('<ResourceDictionary.ThemeDictionaries><SolidColorBrush x:Key="Light" Color="#112233"/></ResourceDictionary.ThemeDictionaries>')+'<Button/>',/ResourceDictionary/],
 ['unknown theme',resources(themeDictionaries({Night:color('Tone','#112233')}))+'<Button/>',/Unsupported theme dictionary/],
 ['missing dynamic branch',resources(themeDictionaries({Light:color('Tone','#112233')}))+'<Button Background="{ThemeResource Tone}"/>',/Unknown static resource Tone/],
 ['resource cycle',resources('<SolidColorBrush x:Key="Cycle" Color="{ThemeResource Cycle}"/>')+'<Button Background="{ThemeResource Cycle}"/>',/Cyclic/],
 ['live geometry',resources('<x:Double x:Key="Size">20</x:Double>')+'<Button Width="{ThemeResource Size}"/>',/Live ThemeResource Width/],
 ['word ellipsis','<TextBlock TextTrimming="WordEllipsis"/>',/word-aware/],
 ['optical typography','<TextBlock Style="{StaticResource TitleTextBlockStyle}"/>',/glyph-sidebearing/],
 ['arbitrary control template','<Button><Button.Template><ControlTemplate TargetType="Button"><Border/></ControlTemplate></Button.Template></Button>',/No faithful|templates|Object values/],
 ['binding','<Button Content="{Binding Caption}"/>',/Binding/],
 ['nonfunctional control alias','<controls:NumberBox/>',/cannot lower|Unknown XAML type/],
 ['tri-state cycling','<ToggleButton IsThreeState="True"/>',/tri-state interaction/],
 ['checked event','<ToggleButton x:Name="B" Checked="B_Click"/>',/state-filtered routed-event/],
 ['unchecked event','<CheckBox x:Name="B" Unchecked="B_Click"/>',/state-filtered routed-event/],
 ['indeterminate event','<CheckBox x:Name="B" Indeterminate="B_Click"/>',/state-filtered routed-event/],
 ['invalid switch event','<ToggleSwitch x:Name="B" Toggled="ArbitraryHandler"/>',/B_Click/],
 ['unimplemented header','<TextBox Header="Name"/>',/header\/content presenter/],
 ['gradient foreground','<TextBlock><TextBlock.Foreground><LinearGradientBrush StartPoint="0,0" EndPoint="0,1"><GradientStop Offset="0" Color="Black"/><GradientStop Offset="1" Color="White"/></LinearGradientBrush></TextBlock.Foreground></TextBlock>',/glyph-mask/],
 ['diagonal gradient','<Button><Button.Background><LinearGradientBrush><GradientStop Offset="0" Color="Black"/><GradientStop Offset="1" Color="White"/></LinearGradientBrush></Button.Background></Button>',/axis-aligned/],
 ['gradient invalid stop','<Button><Button.Background><LinearGradientBrush EndPoint="0,1"><GradientStop Offset="-0.1" Color="Black"/><GradientStop Offset="1" Color="White"/></LinearGradientBrush></Button.Background></Button>',/offset between 0 and 1/],
 ['gradient repeat spread','<Button><Button.Background><LinearGradientBrush EndPoint="0,1" SpreadMethod="Repeat"><GradientStop Offset="0" Color="Black"/><GradientStop Offset="1" Color="White"/></LinearGradientBrush></Button.Background></Button>',/Pad spread/]
])test('WinUI capability diagnostic: '+name,()=>bad(body,pattern));
