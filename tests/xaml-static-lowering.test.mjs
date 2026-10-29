import test from 'node:test';
import assert from 'node:assert/strict';
import {compileFormXaml,createVb6XamlSchema,VB6_XAML_NS} from '../src/xaml/forms.js';
import {PRESENTATION_NS,XAML_NS} from '../packages/xaml-compiler/src/index.js';
const schema=createVb6XamlSchema();
const wrap=body=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:vb="${VB6_XAML_NS}" x:Name="Form1">${body}</Page>`;
const compile=(body,settings={})=>compileFormXaml(wrap(body),{schema,settings});
const good=(body,settings)=>{const r=compile(body,settings);assert.equal(r.success,true,JSON.stringify(r.diagnostics));return r.form;};
const bad=(body,pattern,settings)=>{const r=compile(body,settings);assert.equal(r.success,false,body);assert.equal(r.form,null);if(pattern)assert.match(r.diagnostics.map(d=>d.message).join('\n'),pattern);};
const button=(form,name='B')=>form.controls.find(c=>c.name===name).properties;
const styles=body=>`<Page.Resources>${body}</Page.Resources>`;
const style=(key,body,type='Button',extra='')=>`<Style ${key?'x:Key="'+key+'"':''} TargetType="${type}" ${extra}>${body}</Style>`;
const setter=(property,value)=>`<Setter Property="${property}" Value="${value}"/>`;

test('style BasedOn inheritance, local precedence and sibling independence',()=>{
 const f=good(styles(style('Base',setter('Width',40)+setter('Height',30))+style('Derived',setter('Width',80),'Button','BasedOn="{StaticResource Base}"'))+'<Canvas><Button x:Name="B" Style="{StaticResource Derived}" Width="100"/><Button x:Name="C" Style="{StaticResource Derived}"/></Canvas>');
 assert.equal(button(f).Width,1500);assert.equal(button(f).Height,450);assert.equal(button(f,'C').Width,1200);
});
test('implicit style exact type and explicit x:Null suppression',()=>{
 const f=good(styles(style('',setter('Width',72)))+'<Canvas><Button x:Name="B"/><Button x:Name="C" Style="{x:Null}"/><CheckBox x:Name="D"/></Canvas>');
 assert.equal(button(f).Width,1080);assert.notEqual(button(f,'C').Width,1080);assert.notEqual(button(f,'D').Width,1080);
});
test('inline explicit style overrides rather than combining an implicit style',()=>{
 const f=good(styles(style('',setter('Width',72)))+'<Button x:Name="B"><Button.Style>'+style('',setter('Height',60))+'</Button.Style></Button>');
 assert.notEqual(button(f).Width,1080);assert.equal(button(f).Height,900);
});
test('base styles can target a base class',()=>{
 const f=good(styles(style('Base',setter('Width',44),'FrameworkElement')+style('D',setter('Height',20),'Button','BasedOn="{StaticResource Base}"'))+'<Button x:Name="B" Style="{StaticResource D}"/>');assert.equal(button(f).Width,660);
});
test('namespace aliases in implicit TargetType use type identity',()=>{
 const f=good('<Page.Resources xmlns:u="'+PRESENTATION_NS+'">'+style('',setter('Width',39),'u:Button')+'</Page.Resources><Button x:Name="B"/>');assert.equal(button(f).Width,585);
});
test('resource values are converted to the consuming property type',()=>{
 const f=good(styles('<x:String x:Key="W">42</x:String><x:String x:Key="Off">False</x:String>')+'<Button x:Name="B" Width="{StaticResource W}" IsEnabled="{StaticResource Off}"/>');assert.equal(button(f).Width,630);assert.equal(button(f).Enabled,0);
});
test('resource-dependent setters retain the declaration lexical scope',()=>{
 const f=good(styles('<x:Double x:Key="W">40</x:Double>'+style('S',setter('Width','{StaticResource W}')))+'<Canvas><Canvas.Resources><x:Double x:Key="W">90</x:Double></Canvas.Resources><Button x:Name="B" Style="{StaticResource S}"/></Canvas>');assert.equal(button(f).Width,600);
});
test('merged dictionaries use last merged then local precedence',()=>{
 const merged='<ResourceDictionary.MergedDictionaries><ResourceDictionary><x:Double x:Key="W">10</x:Double></ResourceDictionary><ResourceDictionary><x:Double x:Key="W">20</x:Double></ResourceDictionary></ResourceDictionary.MergedDictionaries>';
 for(const [own,expected] of [['',300],['<x:Double x:Key="W">30</x:Double>',450]]){const f=good(styles('<ResourceDictionary>'+merged+own+'</ResourceDictionary>')+'<Button x:Name="B" Width="{StaticResource W}"/>');assert.equal(button(f).Width,expected);}
});
test('merged implicit styles participate in scoped lookup',()=>{
 const f=good(styles('<ResourceDictionary><ResourceDictionary.MergedDictionaries><ResourceDictionary>'+style('',setter('Height',22))+'</ResourceDictionary></ResourceDictionary.MergedDictionaries></ResourceDictionary>')+'<Button x:Name="B"/>');assert.equal(button(f).Height,330);
});
test('opaque brush resources with explicit unit opacity lower to OLE color',()=>{
 const f=good(styles('<SolidColorBrush x:Key="Brush" Color="#ff123456" Opacity="1"/>')+'<Button x:Name="B" Background="{StaticResource Brush}"/>');assert.equal(button(f).BackColor,0x563412);
});
for(const [name,resources,usage,pattern] of [
 ['wrong target',style('S',setter('Width',20),'TextBox'),'<Button Style="{StaticResource S}"/>',/assignable/],
 ['incompatible base',style('S',setter('Width',20),'TextBox')+style('D','','Button','BasedOn="{StaticResource S}"'),'<Button Style="{StaticResource D}"/>',/assignable/],
 ['style cycle',style('A','','Button','BasedOn="{StaticResource B}"')+style('B','','Button','BasedOn="{StaticResource A}"'),'<Button Style="{StaticResource A}"/>',/Cyclic/],
 ['duplicate setter',style('S',setter('Width',1)+setter('Width',2)),'<Button Style="{StaticResource S}"/>',/Duplicate/],
 ['unsupported setter',style('S',setter('RenderTransform','matrix')),'<Button Style="{StaticResource S}"/>',/lowering/],
 ['event setter',style('S',setter('Click','B_Click')),'<Button x:Name="B" Style="{StaticResource S}"/>',/setter|event/i],
 ['missing key','','<Button Width="{StaticResource Missing}"/>',/Unknown static resource/],
 ['invalid scalar','<x:String x:Key="W">oops</x:String>','<Button Width="{StaticResource W}"/>',/finite|length|number/i],
 ['theme value','<x:Double x:Key="W">20</x:Double>','<Button Width="{ThemeResource W}"/>',/ThemeResource/],
 ['external nested dictionary','<ResourceDictionary><ResourceDictionary.MergedDictionaries><ResourceDictionary Source="https:\/\/example.invalid\/theme.xaml"/></ResourceDictionary.MergedDictionaries></ResourceDictionary>','<Button/>',/External/],
 ['transformed brush','<SolidColorBrush x:Key="B" Color="#123456" Transform="matrix"/>','<Button Background="{StaticResource B}"/>',/transforms/],
])test('diagnostic: '+name,()=>bad(styles(resources)+usage,pattern));

test('static styles cannot alias a foreign namespace control by local type name',()=>{
 const custom=createVb6XamlSchema();custom.registerType('urn:not-winui','Button',{members:{},assignableTo:[{namespaceURI:PRESENTATION_NS,name:'UIElement'}]});
 const r=compileFormXaml(wrap('<foreign:Button xmlns:foreign="urn:not-winui"/>'),{schema:custom});assert.equal(r.success,false);assert.match(r.diagnostics.map(d=>d.message).join('\n'),/cannot lower/);
});
test('generated names reserve names explicitly declared later',()=>{
 const f=good('<Canvas><Button/><Button x:Name="CommandButton2"/></Canvas>');assert.equal(new Set(f.controls.map(c=>c.name)).size,f.controls.length);
});
test('Grid defaults to one cell and children default to row/column zero',()=>{
 const f=good('<Grid x:Name="G" Width="200" Height="100"><Button x:Name="B"/></Grid>',{anchoring:true});assert.equal(button(f,'G').LayoutGridColumns,'1fr');assert.equal(button(f,'G').LayoutGridRows,'1fr');assert.equal(button(f).LayoutRow,0);assert.equal(button(f).LayoutColumn,0);assert.equal(button(f).LayoutWidthMode,2);assert.equal(button(f).LayoutHeightMode,2);
});
test('StackPanel keeps main-axis natural size and cross-axis fill',()=>{
 for(const orientation of ['Horizontal','Vertical']){const f=good(`<StackPanel x:Name="S" Orientation="${orientation}" Width="300" Height="100"><Button x:Name="B"/></StackPanel>`,{anchoring:true});assert.equal(button(f).LayoutWidthMode,orientation==='Horizontal'?1:2);assert.equal(button(f).LayoutHeightMode,orientation==='Horizontal'?2:1);assert.equal(button(f).LayoutShrink,0);}
});
test('margin/padding thickness and alignment lower all four axes',()=>{
 const f=good('<Grid x:Name="G" Width="200" Height="100" Padding="1,2,3,4"><Button x:Name="B" Width="20" Height="20" Margin="5,6,7,8" HorizontalAlignment="Right" VerticalAlignment="Center"/></Grid>',{anchoring:true});for(const [i,side] of ['Left','Top','Right','Bottom'].entries()){assert.equal(button(f,'G')['LayoutPadding'+side],(i+1)*15);assert.equal(button(f)['LayoutMargin'+side],(i+5)*15);}assert.equal(button(f).LayoutJustifySelf,2);assert.equal(button(f).LayoutAlign,1);
});
test('explicit Auto is allowed only under an automatic layout parent',()=>{
 const f=good('<StackPanel Width="300"><Button x:Name="B" Width="Auto" Height="Auto"/></StackPanel>',{anchoring:true});assert.equal(button(f).LayoutWidthMode,2);assert.equal(button(f).LayoutHeightMode,1);bad('<Canvas><Button Width="Auto"/></Canvas>',/automatic/, {anchoring:true});
});
for(const [name,body,pattern] of [
 ['layout disabled','<Grid><Button Margin="1"/></Grid>',/Enable|automatic/],
 ['negative margin','<Grid><Button Margin="-1"/></Grid>',/Negative/],
 ['negative button padding','<Grid><Button Padding="-2"/></Grid>',/Padding/],
 ['unimplemented alignment parent','<Button VerticalAlignment="Center"/>',/cross axis/],
 ['negative width','<Canvas><Button Width="-5"/></Canvas>',/nonnegative/],
])test('layout diagnostics: '+name,()=>bad(body,pattern,name==='layout disabled'?{}:{anchoring:true}));
test('WinUI scalar opacity, translucent brushes and button padding retain presentation data',()=>{
 const f=good(styles('<SolidColorBrush x:Key="Brush" Color="#123456" Opacity="0.7"/>'+style('S',setter('Opacity',0.2)))+'<Button x:Name="B" Background="{StaticResource Brush}" Style="{StaticResource S}" Padding="2"/>');
 assert.equal(button(f).BackColor,0x563412);assert.equal(button(f).WinUI3.properties.Background,'#B3123456');assert.equal(button(f).WinUI3.properties.Opacity,0.2);assert.deepEqual(button(f).WinUI3.properties.Padding,[2,2,2,2]);
});
test('list strings and simple containers preserve text and selected index',()=>{
 const f=good('<ListBox x:Name="B" SelectionMode="Extended"><x:String>First</x:String><ListBoxItem Content="Second" IsSelected="True"/></ListBox>');assert.deepEqual(button(f).List,['First','Second']);assert.equal(button(f).ListIndex,1);assert.equal(button(f).MultiSelect,2);
});
test('ComboBox defaults to non-editable and selected item populates Text',()=>{
 const f=good('<ComboBox x:Name="B" SelectedIndex="1"><x:String>One</x:String><ComboBoxItem>Two</ComboBoxItem></ComboBox>');assert.equal(button(f).Style,2);assert.equal(button(f).Text,'Two');assert.equal(button(f).ListIndex,1);
});
test('editable ComboBox and vertical ScrollBar/Slider mapping',()=>{
 const f=good('<Canvas><ComboBox x:Name="B" IsEditable="True" Text="Custom"/><ScrollBar x:Name="V" Orientation="Vertical"/><Slider x:Name="S" Orientation="Vertical" StepFrequency="2"/></Canvas>');assert.equal(button(f).Style,0);assert.equal(f.controls.find(c=>c.name==='V').type,'VScrollBar');assert.equal(button(f,'S').Orientation,1);assert.equal(button(f,'S').SmallChange,2);
});
for(const [name,body,pattern] of [
 ['rich items','<ListBox><ListBoxItem><TextBlock Text="rich"/></ListBoxItem></ListBox>',/implement|content/],
 ['styled items','<ListBox><ListBoxItem Width="20" Content="x"/></ListBox>',/flatten/],
 ['out of range','<ListBox SelectedIndex="2"><x:String>one</x:String></ListBox>',/outside/],
 ['conflicting selection','<ListBox SelectedIndex="-1"><ListBoxItem IsSelected="True" Content="one"/></ListBox>',/conflicts/],
 ['multiple initial selection','<ListBox><ListBoxItem IsSelected="True"/><ListBoxItem IsSelected="True"/></ListBox>',/Multiple/],
 ['zero step','<Slider StepFrequency="0"/>',/positive/],
])test('list/range diagnostics: '+name,()=>bad(body,pattern));

test('resource-converted orientation, Auto and cross-axis alignment retain enum semantics',()=>{
 const f=good(styles('<x:String x:Key="Vertical">vertical</x:String><x:String x:Key="AutoSize">Auto</x:String><x:String x:Key="Center">Center</x:String>')+'<StackPanel Width="200"><ScrollBar x:Name="V" Orientation="{StaticResource Vertical}"/><Button x:Name="B" Width="{StaticResource AutoSize}" HorizontalAlignment="{StaticResource Center}"/></StackPanel>',{anchoring:true});assert.equal(f.controls.find(c=>c.name==='V').type,'VScrollBar');assert.equal(button(f).LayoutWidthMode,1);assert.equal(button(f).LayoutAlign,1);
});
test('literal Content style setters lower to captions',()=>{const f=good(styles(style('',setter('Content','Shared caption')))+'<Button x:Name="B"/>');assert.equal(button(f).Caption,'Shared caption');});
test('cyclic brush resource dependencies fail without recursion overflow',()=>bad(styles('<SolidColorBrush x:Key="A" Color="{StaticResource B}"/><SolidColorBrush x:Key="B" Color="{StaticResource A}"/>')+'<Button Background="{StaticResource A}"/>',/Cyclic/));

test('styles cannot silently set native identity/type metadata',()=>bad(styles(style('S',setter('vb:Designer.Type','Timer')))+'<Button Style="{StaticResource S}"/>',/setter/));
