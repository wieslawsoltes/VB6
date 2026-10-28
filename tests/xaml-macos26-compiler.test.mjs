import test from 'node:test';
import assert from 'node:assert/strict';
import {MACOS26_NS,MACOS26_CONTROLS,MACOS26_SEMANTIC_COLORS,PRESENTATION_NS,XAML_NS,compileXaml,createMacOS26Schema,XamlLanguageService} from '../packages/xaml-compiler/src/index.js';
import {compileFormXaml,createVb6XamlSchema,formToXaml} from '../src/xaml/forms.js';
import {MACOS26_RESOURCE_NAMES,macos26ColorFallback} from '../src/theme/macos26-resources.js';
import {tabEntries,tabPagePlan} from '../src/controls/tab-model.js';

const schema=createVb6XamlSchema();
const wrap=(body,attrs='')=>`<mac:Window xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:mac="${MACOS26_NS}" xmlns:vb="urn:vb6:forms" x:Name="Form1" ${attrs}>${body}</mac:Window>`;
const good=(body,options={})=>{const r=compileFormXaml(wrap(body),{schema,...options});assert.equal(r.success,true,r.diagnostics.map(d=>d.message).join('\n'));return r;};
const bad=(body,pattern,options={})=>{const r=compileFormXaml(wrap(body),{schema,...options});assert.equal(r.success,false,body);assert.equal(r.form,null);assert.match(r.diagnostics.map(d=>d.message).join('\n'),pattern);return r;};
const props=(r,name='B')=>r.form.controls.find(c=>c.name===name).properties;
const resources=content=>'<mac:Window.Resources>'+content+'</mac:Window.Resources>';
const style=(body,key='S',target='mac:Button')=>`<Style x:Key="${key}" TargetType="${target}">${body}</Style>`;

test('versioned optional package schema retains real base types and original source types',()=>{
  const text=wrap('<mac:Button x:Name="B" Title="Save"/>');
  assert.equal(compileXaml(text).success,false);
  const s=createMacOS26Schema(),r=compileXaml(text,{schema:s});
  assert.equal(r.success,true);assert.equal(r.program.root.type.namespaceURI,MACOS26_NS);
  assert.ok(s.isAssignable(s.getType(MACOS26_NS,'Button'),s.getType(PRESENTATION_NS,'Button')));
  assert.equal(r.nodes.find(n=>n.name==='B').properties.find(p=>p.member.name==='Title').member.aliasFor,'Content');
  assert.deepEqual(MACOS26_SEMANTIC_COLORS,MACOS26_RESOURCE_NAMES);
});

test('all registered visual aliases lower to implemented native controls',()=>{
  const additional={TabView:'<mac:TabItem Title="First"><mac:Label Text="Page"/></mac:TabItem>',SegmentedControl:'<mac:Segment Title="First"/>'};
  const body=Object.entries(MACOS26_CONTROLS).filter(([name])=>name!=='Window').map(([name])=>`<mac:${name} x:Name="${name}Control">${additional[name]??''}</mac:${name}>`).join('');
  const r=good('<mac:View>'+body+'</mac:View>',{settings:{anchoring:true}});
  for(const [name,definition] of Object.entries(MACOS26_CONTROLS))if(name!=='Window')assert.equal(r.form.controls.find(c=>c.name===name+'Control').type,definition.nativeType,name);
  assert.equal(props(r,'SecureFieldControl').PasswordChar,'*');
  assert.equal(props(r,'SearchFieldControl').MacOSControlStyle,'search');
  assert.equal(props(r,'SwitchControl').MacOSControlStyle,'switch');
  assert.equal(props(r,'ComboBoxControl').Style,0);assert.equal(props(r,'PopUpButtonControl').Style,2);
  assert.equal(props(r,'TextEditorControl').MultiLine,-1);
});

test('alias scalar values, native events and accessibility lower without generated handlers',()=>{
  const r=good('<mac:View><mac:Button x:Name="B" Title="Apply" IsDefault="True" IsCancel="False" Action="B_Click" mac:Accessibility.Label="Apply preferences" ControlSize="large"/><mac:SecureField x:Name="Password" StringValue="secret" PlaceholderString="Password" PasswordChanged="Password_Change"/><mac:RadioButton x:Name="R" IsOn="True"/><mac:ProgressIndicator x:Name="P" IsIndeterminate="True"/></mac:View>');
  assert.equal(props(r).Caption,'Apply');assert.equal(props(r).Default,-1);assert.equal(props(r).MacOSControlSize,'large');
  assert.equal(props(r).MacOSAccessibilityLabel,'Apply preferences');assert.equal(props(r,'Password').Text,'secret');
  assert.equal(props(r,'Password').PlaceholderText,'Password');assert.equal(props(r,'R').Value,-1);assert.equal(props(r,'P').MacOSIndeterminate,-1);
});

test('check, radio and switch Action aliases use their actual VB6 Click procedure',()=>{
  const r=good('<mac:View><mac:CheckBox x:Name="B" Action="B_Click"/><mac:RadioButton x:Name="Radio" Action="Radio_Click"/><mac:Switch x:Name="Switch" Action="Switch_Click"/></mac:View>');
  assert.deepEqual(r.form.controls.slice(1).map(c=>c.type),['CheckBox','OptionButton','CheckBox']);
  bad('<mac:Switch x:Name="B" Action="B_Change"/>',/B_Click/);
  bad('<mac:CheckBox Action="A" Click="B"/>',/assigned more than once/);
});

test('attached appearance/accessibility works on existing presentation and native controls',()=>{
  const r=good('<mac:View><Button x:Name="B" mac:Appearance.ControlSize="small" mac:Appearance.ForegroundRole="secondaryLabelColor" AutomationProperties.Name="Accept changes" AutomationProperties.HelpText="Save preferences" AutomationProperties.AutomationId="accept"/><vb:TextBox Name="Native" mac:Accessibility.Label="Search documents" mac:Appearance.ControlStyle="search" PlaceholderText="Documents"/></mac:View>');
  assert.equal(props(r).MacOSForegroundRole,'secondaryLabelColor');assert.equal(props(r).ForeColor,macos26ColorFallback('secondaryLabelColor'));
  assert.equal(props(r).MacOSAccessibilityLabel,'Accept changes');assert.equal(props(r).MacOSAccessibilityHelp,'Save preferences');assert.equal(props(r).MacOSAccessibilityIdentifier,'accept');
  assert.equal(props(r,'Native').MacOSControlStyle,'search');assert.equal(props(r,'Native').MacOSAccessibilityLabel,'Search documents');
});

test('native scalar appearance and custom metadata round-trip exactly',()=>{
  const r=good('<mac:View><mac:SearchField x:Name="B" StringValue="Search" PlaceholderString="Filter" ControlSize="mini" mac:Accessibility.Help="Filter names"/><mac:ProgressIndicator x:Name="P" IsIndeterminate="True"/></mac:View>');
  props(r)['Vendor.Record']={purpose:'preserve',nested:[1,2]};
  Object.assign(props(r),{MacOSForegroundRole:'labelColor',ForeColor:0x332211});
  const text=formToXaml(r.form,{schema}),again=compileFormXaml(text,{schema});
  assert.equal(again.success,true,JSON.stringify(again.diagnostics));assert.deepEqual(again.form,r.form);
  assert.match(text,/MacOSControlStyle="search"/);assert.match(text,/PlaceholderText="Filter"/);
});

test('host-owned native JSON cannot impersonate an internal semantic color token',()=>{
  const custom=createVb6XamlSchema(),type=custom.getType('urn:vb6:forms','TextBox');
  custom.registerType('urn:vb6:forms','TextBox',{...type,members:{...type.members,VendorData:'Json'}});
  const value={kind:'MacOS26Color',role:'labelColor',fallback:'user data'};
  const r=good('<vb:TextBox Name="B" VendorData=\'{}'+JSON.stringify(value)+'\'/>',{schema:custom});
  assert.deepEqual(props(r).VendorData,value);
});

test('macOS namespace also works as the default for controls and markup extensions',()=>{
  const text=`<Window xmlns="${MACOS26_NS}" xmlns:x="${XAML_NS}" x:Name="Form1"><Button x:Name="B" Title="Accept" Foreground="{ThemeResource macOS.labelColor}"/></Window>`;
  const r=compileFormXaml(text,{schema});assert.equal(r.success,true,JSON.stringify(r.diagnostics));assert.equal(props(r).MacOSForegroundRole,'labelColor');
});

test('style aliases obey canonical identity, local precedence and lexical resources',()=>{
  const defs=resources('<x:String x:Key="Title">From style</x:String>'+style('<Setter Property="Title" Value="{StaticResource Title}"/><Setter Property="ControlSize" Value="Small"/>'));
  const r=good(defs+'<mac:View><mac:View.Resources><x:String x:Key="Title">Inner shadow</x:String></mac:View.Resources><mac:Button x:Name="B" Style="{StaticResource S}" Content="Local"/><mac:Button x:Name="C" Style="{StaticResource S}"/></mac:View>');
  assert.equal(props(r).Caption,'Local');assert.equal(props(r,'C').Caption,'From style');assert.equal(props(r).MacOSControlSize,'small');
});

test('attached appearance setters and implicit styles resolve macOS type identity',()=>{
  const r=good('<mac:Window.Resources xmlns:a="'+MACOS26_NS+'"><Style TargetType="a:Button"><Setter Property="a:Appearance.ControlStyle" Value="destructive"/><Setter Property="a:Accessibility.Label" Value="Delete file"/></Style></mac:Window.Resources><mac:Button x:Name="B"/>');
  assert.equal(props(r).MacOSControlStyle,'destructive');assert.equal(props(r).MacOSAccessibilityLabel,'Delete file');
});

test('Grid and StackView use inherited typed layout metadata with the existing solver',()=>{
  const r=good(resources('<x:String x:Key="Axis">horizontal</x:String><x:String x:Key="Track">2*</x:String>')+'<mac:Grid x:Name="G" Width="300" Height="120"><mac:Grid.ColumnDefinitions><mac:ColumnDefinition Width="{StaticResource Track}"/><ColumnDefinition Width="*"/></mac:Grid.ColumnDefinitions><mac:StackView x:Name="Stack" mac:Grid.Column="1" Axis="{StaticResource Axis}" Spacing="8"><mac:Button x:Name="B" Width="50" Height="24" VerticalAlignment="Center"/></mac:StackView></mac:Grid>',{settings:{anchoring:true}});
  assert.equal(props(r,'G').LayoutGridColumns,'2fr 1fr');assert.equal(props(r,'Stack').LayoutColumn,1);assert.equal(props(r,'Stack').LayoutMode,1);assert.equal(props(r,'Stack').LayoutGap,120);assert.equal(props(r).LayoutAlign,1);
});

test('static Table columns and rows are the real ListView model',()=>{
  const r=good(resources('<x:String x:Key="Width">120</x:String>')+'<mac:Table x:Name="B" SelectionChanged="B_ItemClick" ColumnClick="B_ColumnClick"><mac:Table.Columns><mac:TableColumn x:Key="name" Title="Name" Width="{StaticResource Width}"/><mac:TableColumn Title="Type" TextAlignment="Right"/></mac:Table.Columns><mac:TableRow Key="first" Text="README"><x:String>Document</x:String></mac:TableRow></mac:Table>');
  assert.equal(r.form.controls.length,1);assert.equal(r.form.controls[0].type,'ListView');
  assert.deepEqual(props(r).Columns,[{Key:'name',Text:'Name',Width:1800,Alignment:0},{Key:'column1',Text:'Type',Width:2400,Alignment:1}]);
  assert.deepEqual(props(r).Items,[{Key:'first',Text:'README',SubItems:['Document']}]);
});

test('Outline flattens typed hierarchy while retaining expansion and parent keys',()=>{
  const r=good('<mac:Outline x:Name="B" SelectionChanged="B_NodeClick"><mac:OutlineNode Key="Root" Title="Workspace" IsExpanded="True"><mac:OutlineNode Text="Untitled"/><mac:OutlineNode Key="node1" Text="Reserved generated name"/></mac:OutlineNode></mac:Outline>');
  assert.equal(r.form.controls.length,1);assert.equal(r.form.controls[0].type,'TreeView');
  assert.deepEqual(props(r).Nodes,[{Key:'Root',Text:'Workspace',Expanded:-1},{Key:'node2',Text:'Untitled',Expanded:0,Parent:'Root'},{Key:'node1',Text:'Reserved generated name',Expanded:0,Parent:'Root'}]);
});

test('TabView pages lower to native SSTab page ownership without phantom page controls',()=>{
  const r=good('<mac:TabView x:Name="B" SelectedIndex="1"><mac:TabItem Title="General"><mac:TextField x:Name="General" StringValue="First"/></mac:TabItem><mac:TabItem Title="Advanced"><mac:Box x:Name="Advanced" Title="Details"><mac:Label x:Name="Detail" Text="Second"/></mac:Box></mac:TabItem></mac:TabView>');
  assert.equal(r.form.controls.length,4);assert.equal(props(r).Tabs,2);assert.equal(props(r).Tab,1);
  assert.deepEqual(tabEntries(r.form.controls[0]).map(t=>t.Caption),['General','Advanced']);
  const plan=tabPagePlan(r.form,{strict:true});
  assert.equal(plan.bindings.get(r.form.controls.find(c=>c.name==='General').id).page,0);
  assert.equal(plan.bindings.get(r.form.controls.find(c=>c.name==='Advanced').id).page,1);
  assert.equal(r.form.controls.find(c=>c.name==='Detail').parent,'Advanced');
});

test('TabItem selection lowers to the sole native Tab value and respects explicit deselection',()=>{
  const selected=good('<mac:TabView x:Name="B"><mac:TabItem Title="General"/><mac:TabItem Title="Advanced" IsSelected="True"/></mac:TabView>');
  assert.equal(props(selected).Tab,1);assert.equal(selected.form.controls.length,1);
  const firstEligible=good('<mac:TabView x:Name="B"><mac:TabItem Title="General" IsSelected="False"/><mac:TabItem Title="Advanced"/></mac:TabView>');
  assert.equal(props(firstEligible).Tab,1);
  const explicit=good(resources('<x:Boolean x:Key="Chosen">True</x:Boolean>')+'<mac:TabView x:Name="B" SelectedIndex="1"><mac:TabItem IsSelected="False"/><mac:TabItem IsSelected="{StaticResource Chosen}"/></mac:TabView>');
  assert.equal(props(explicit).Tab,1);
  for(const [body,message] of [
    ['<mac:TabView><mac:TabItem IsSelected="True"/><mac:TabItem IsSelected="True"/></mac:TabView>',/at most one selected TabItem/],
    ['<mac:TabView SelectedIndex="0"><mac:TabItem/><mac:TabItem IsSelected="True"/></mac:TabView>',/conflicts with TabItem.IsSelected/],
    ['<mac:TabView SelectedIndex="0"><mac:TabItem IsSelected="False"/></mac:TabView>',/conflicts with TabItem.IsSelected/],
    ['<mac:TabView><mac:TabItem IsSelected="False"/><mac:TabItem IsSelected="False"/></mac:TabView>',/requires a selected page/]
  ])bad(body,message);
});

test('lists, popup menus, stepper, date and image use supported native properties',()=>{
  const r=good('<mac:View><mac:PopUpButton x:Name="B" SelectedIndex="1"><mac:MenuItem>One</mac:MenuItem><mac:MenuItem>Two</mac:MenuItem></mac:PopUpButton><mac:List x:Name="List" SelectionMode="Extended"><mac:ListItem IsSelected="True">File</mac:ListItem></mac:List><mac:Stepper x:Name="Step" Minimum="2" Maximum="20" Value="6" Increment="2" Wrap="True" Orientation="Horizontal"/><mac:DatePicker x:Name="Date" Date="2024-02-29" DateChanged="Date_Change"/><mac:Image x:Name="Image" Source="logo" Stretch="None"/></mac:View>');
  assert.deepEqual(props(r).List,['One','Two']);assert.equal(props(r).Text,'Two');assert.equal(props(r,'List').ListIndex,0);
  assert.equal(props(r,'Step').Increment,2);assert.equal(props(r,'Step').Wrap,-1);assert.equal(props(r,'Step').Orientation,1);
  assert.equal(props(r,'Date').Value,'2024-02-29');assert.equal(props(r,'Image').Picture,'logo');assert.equal(props(r,'Image').Stretch,0);
});

test('semantic theme colors survive opaque brush and style chains as role plus OLE fallback',()=>{
  const r=good(resources('<SolidColorBrush x:Key="Brush" Color="{ThemeResource macOS.secondaryLabelColor}" Opacity="1"/>'+style('<Setter Property="Foreground" Value="{StaticResource Brush}"/>'))+'<mac:Button x:Name="B" Style="{StaticResource S}" Background="{ThemeResource macOS.controlBackgroundColor}"/>');
  assert.equal(props(r).MacOSForegroundRole,'secondaryLabelColor');assert.equal(props(r).ForeColor,macos26ColorFallback('secondaryLabelColor'));
  assert.equal(props(r).MacOSBackgroundRole,'controlBackgroundColor');
  assert.ok(r.compilation.references.some(r=>r.name==='macOS.secondaryLabelColor'));
  assert.doesNotMatch(JSON.stringify(r.compilation.program),/MacOS26Color/);
});

test('local and later-merged resources shadow intrinsic theme colors',()=>{
  const merged='<ResourceDictionary><ResourceDictionary.MergedDictionaries><ResourceDictionary><SolidColorBrush x:Key="macOS.labelColor" Color="#123456"/></ResourceDictionary><ResourceDictionary><SolidColorBrush x:Key="macOS.labelColor" Color="#abcdef"/></ResourceDictionary></ResourceDictionary.MergedDictionaries></ResourceDictionary>';
  const r=good(resources(merged)+'<mac:View><mac:Button x:Name="B" Foreground="{ThemeResource macOS.labelColor}"/><mac:Button x:Name="C" Foreground="{ThemeResource macOS.labelColor}"><mac:Button.Resources><SolidColorBrush x:Key="macOS.labelColor" Color="#223344"/></mac:Button.Resources></mac:Button></mac:View>');
  assert.equal(props(r).ForeColor,0xefcdab);assert.equal(props(r).MacOSForegroundRole,undefined);assert.equal(props(r,'C').ForeColor,0x443322);
});

test('theme resource setters retain declaration scope instead of a consumer shadow',()=>{
  const r=good(resources('<SolidColorBrush x:Key="macOS.labelColor" Color="#112233"/>'+style('<Setter Property="Foreground" Value="{ThemeResource macOS.labelColor}"/>'))+'<mac:Button x:Name="B" Style="{StaticResource S}"><mac:Button.Resources><SolidColorBrush x:Key="macOS.labelColor" Color="#ffffff"/></mac:Button.Resources></mac:Button>');
  assert.equal(props(r).ForeColor,0x332211);assert.equal(props(r).MacOSForegroundRole,undefined);
});

test('a local color overrides a styled semantic role and a local role overrides a styled color',()=>{
  let r=good(resources(style('<Setter Property="ForegroundRole" Value="labelColor"/>'))+'<mac:Button x:Name="B" Style="{StaticResource S}" Foreground="#123456"/>');
  assert.equal(props(r).ForeColor,0x563412);assert.equal(props(r).MacOSForegroundRole,undefined);
  r=good(resources(style('<Setter Property="Foreground" Value="#123456"/>'))+'<mac:Button x:Name="B" Style="{StaticResource S}" ForegroundRole="labelColor"/>');
  assert.equal(props(r).ForeColor,macos26ColorFallback('labelColor'));assert.equal(props(r).MacOSForegroundRole,'labelColor');
});

test('collection expansion budgets stop repeated resource text before building an oversized native collection',()=>{
  const defs=resources('<x:String x:Key="Large">'+'a'.repeat(120000)+'</x:String>');
  for(const [owner,item] of [['Table','<mac:TableRow Text="{StaticResource Large}"/>'],['Outline','<mac:OutlineNode Text="{StaticResource Large}"/>'],['TabView','<mac:TabItem Title="{StaticResource Large}"/>']])
    bad(defs+'<mac:'+owner+'>'+item.repeat(20)+'</mac:'+owner+'>',/Expanded macOS .* exceeds the document limit/);
});

test('outline budget accounts for repeated parent-key text after hierarchical flattening',()=>{
  const defs=resources('<x:String x:Key="Key">'+'k'.repeat(250000)+'</x:String>');
  bad(defs+'<mac:Outline><mac:OutlineNode Key="{StaticResource Key}">'+('<mac:OutlineNode Text="Child"/>').repeat(10)+'</mac:OutlineNode></mac:Outline>',/Expanded macOS Outline.Nodes/);
});

test('language service offers alias properties, typed sizes, intrinsic resources and scoped references',()=>{
  const service=new XamlLanguageService({schema:createMacOS26Schema()}),uri='macos.xaml';
  let text=wrap('<mac:Button x:Name="B" ControlSize=""/>');service.openDocument(uri,text,1);
  assert.ok(service.completion(uri,text.indexOf('ControlSize="')+13).some(c=>c.label==='extraLarge'));
  text=wrap('<mac:Button x:Name="B" Foreground="{ThemeResource macOS.}"/>');service.openDocument(uri,text,2);
  assert.ok(service.completion(uri,text.indexOf('macOS.')+6).some(c=>c.label==='macOS.labelColor'));
  text=`<Window xmlns="${MACOS26_NS}" xmlns:x="${XAML_NS}" xmlns:ui="${PRESENTATION_NS}" x:Name="Form1"><Window.Resources><x:String x:Key="Title">Caption</x:String></Window.Resources><Button x:Name="B" Title="{StaticResource Title}"/></Window>`;service.openDocument(uri,text,3);
  assert.equal(service.references(uri,text.indexOf('Resource Title')+10).length,2);
  assert.match(service.hover(uri,text.lastIndexOf('Title="')).contents.value,/alias for Content/);
});

for(const [name,body,pattern,settings] of [
  ['duplicate alias','<mac:Button Title="One" Content="Two"/>',/assigned more than once/],
  ['duplicate attached alias','<mac:Button ControlSize="small" mac:Appearance.ControlSize="large"/>',/assigned more than once/],
  ['invalid size','<mac:Button ControlSize="huge"/>',/Expected mini/],
  ['unsupported style target','<mac:Label ControlStyle="destructive"/>',/not supported/],
  ['unsupported material target','<mac:Button Material="sidebar"/>',/not supported/],
  ['search multiline','<mac:SearchField AcceptsReturn="True"/>',/single-line/],
  ['secure without masking','<mac:SecureField PasswordChar=""/>',/nonempty PasswordChar/],
  ['tri-state switch','<mac:Switch IsChecked="{x:Null}"/>',/on\/off/],
  ['editable popup','<mac:PopUpButton IsEditable="True"/>',/not editable/],
  ['arbitrary forwarding','<mac:Button x:Name="B" Action="SaveEverything"/>',/B_Click/],
  ['disabled automatic layout','<mac:StackView/>',/Enable anchoring/],
  ['invalid range','<mac:Slider Minimum="10" Maximum="1" Value="5"/>',/ordered range/],
  ['zero step','<mac:Stepper Increment="0"/>',/positive/],
  ['invalid leap date','<mac:DatePicker Date="2100-02-29"/>',/valid calendar/],
  ['date includes time','<mac:DatePicker Date="2026-10-16T12:00:00Z"/>',/ISO calendar/],
  ['unsupported image fitting','<mac:Image Stretch="Uniform"/>',/aspect-fit/],
  ['table duplicate keys','<mac:Table><mac:TableRow Key="Item" Text="One"/><mac:TableRow Key="item" Text="Two"/></mac:Table>',/Duplicate native collection key/],
  ['table width overflow','<mac:Table><mac:Table.Columns><mac:TableColumn Width="1e308"/></mac:Table.Columns></mac:Table>',/native geometry limits/],
  ['table overflow columns','<mac:Table><mac:TableRow Text="One"><x:String>Hidden</x:String></mac:TableRow></mac:Table>',/column count/],
  ['outline wrong type','<mac:Outline><mac:Button/></mac:Outline>',/assignable|OutlineNode/],
  ['outline name loss','<mac:Outline><mac:OutlineNode x:Name="InvisibleControl" Text="One"/></mac:Outline>',/static item data/],
  ['empty tabs','<mac:TabView/>',/at least one TabItem/],
  ['tab selection','<mac:TabView SelectedIndex="1"><mac:TabItem Title="One"/></mac:TabView>',/outside the tab collection/],
  ['tab text content','<mac:TabView><mac:TabItem Title="One">Invisible</mac:TabItem></mac:TabView>',/one supported control/],
  ['paint-role conflict','<mac:Button Foreground="#112233" ForegroundRole="labelColor"/>',/either Foreground/],
  ['unknown semantic role','<mac:Button Foreground="{ThemeResource macOS.missingColor}"/>',/ThemeResource.*supported live/],
  ['semantic color as geometry','<mac:Button Width="{ThemeResource macOS.labelColor}"/>',/brush\/color/],
  ['unsupported live paint','<Rectangle Fill="{ThemeResource macOS.controlAccentColor}"/>',/Background or Foreground/],
  ['translucent live brush',resources('<SolidColorBrush x:Key="Brush" Color="{ThemeResource macOS.labelColor}" Opacity="0.5"/>')+'<mac:Button Foreground="{StaticResource Brush}"/>',/opacity/],
  ['dynamic local shadow',resources('<SolidColorBrush x:Key="macOS.labelColor" Color="{Binding Color}"/>')+'<mac:Button Foreground="{ThemeResource macOS.labelColor}"/>',/Binding/],
  ['dynamic user theme',resources('<x:String x:Key="UserColor">#ffffff</x:String>')+'<mac:Button Foreground="{ThemeResource UserColor}"/>',/supported live/],
  ['unimplemented API','<mac:NavigationSplitView/>',/Unknown XAML type/]
])test('macOS diagnostic: '+name,()=>bad(body,pattern,{settings}));
