import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESENTATION_NS,XAML_NS,MACOS26_NS} from '../packages/xaml-compiler/src/index.js';
import {compileFormXaml,synchronizeFormXaml} from '../src/xaml/forms.js';

const wrap=body=>`<a:Window xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:a="${MACOS26_NS}" x:Name="Form1">${body}</a:Window>`;
const control=(form,name='B')=>form.controls.find(c=>c.name===name);
const load=text=>{const r=compileFormXaml(text);assert.equal(r.success,true,JSON.stringify(r.diagnostics));return r.form;};
const edit=(text,change,{override=false}={})=>{
  const before=load(text),after=structuredClone(before);change(after);
  const r=synchronizeFormXaml(text,before,after);assert.equal(r.regenerated,false,r.text);
  const checked=compileFormXaml(r.text,{form:after});assert.equal(checked.success,true,JSON.stringify(checked.diagnostics));assert.deepEqual(checked.form,after);
  if(!override)assert.doesNotMatch(r.text,/Designer.Properties/);
  return r.text;
};

test('table column title, width and alignment edits retain typed collection syntax and quotes',()=>{
  const text=wrap('<a:Table x:Name="B"><a:Table.Columns><!-- columns --><a:TableColumn x:Key="name" Title=\'Name\' Width="80"/><a:TableColumn Key="kind"><a:TableColumn.Title><!-- label -->Kind</a:TableColumn.Title></a:TableColumn></a:Table.Columns><a:TableRow Key="readme" Text="README"><x:String>Text</x:String></a:TableRow></a:Table>');
  const next=edit(text,form=>{const columns=control(form).properties.Columns;columns[0].Text="File's name";columns[0].Width=1800;columns[1].Text='Type';columns[1].Alignment=2;});
  assert.match(next,/<!-- columns -->/);assert.match(next,/Title='File&apos;s name'/);assert.match(next,/Width="120"/);assert.match(next,/TextAlignment="Center"/);
  assert.match(next,/<a:TableColumn.Title><!-- label -->Type<\/a:TableColumn.Title>/);assert.match(next,/x:Key="name"/);
});

test('row and typed subitem string edits preserve inline comments, CDATA positions and significant whitespace',()=>{
  const text=wrap('<a:Table x:Name="B"><a:Table.Columns><a:TableColumn Title="Name"/><a:TableColumn Title="Kind"/><a:TableColumn Title="State"/></a:Table.Columns><a:TableRow Key="readme" Text="README"><x:String><!-- type -->Text</x:String><x:String><![CDATA[Before]]><!-- state --></x:String></a:TableRow></a:Table>');
  const next=edit(text,form=>{const row=control(form).properties.Items[0];row.Text='Release notes';row.SubItems[0]='  plain  text\n';row.SubItems[1]='{changed} & verified';});
  assert.match(next,/Text="Release notes"/);assert.match(next,/xml:space="preserve"/);assert.match(next,/<!-- type -->  plain  text&#10;/);
  assert.match(next,/\{changed\} &amp; verified<!-- state -->/);assert.doesNotMatch(next,/<!\[CDATA\[/);
});

test('editing a collection resource consumer keeps the shared resource value unchanged',()=>{
  const text=wrap('<a:Window.Resources><x:String x:Key="Shared">Before</x:String></a:Window.Resources><a:Table x:Name="B"><a:TableRow Text="{StaticResource Shared}"/><a:TableRow Text="{StaticResource Shared}"/></a:Table>');
  const next=edit(text,form=>{control(form).properties.Items[0].Text='{literal title}';});
  assert.match(next,/<x:String x:Key="Shared">Before<\/x:String>/);assert.match(next,/Text="\{\}\{literal title\}"/);
  assert.equal((next.match(/Text="\{StaticResource Shared\}"/g)??[]).length,1);
});

test('outline node aliases, nested hierarchy and expansion edits retain original element identity',()=>{
  const text=wrap('<a:Outline x:Name="B"><a:OutlineNode Key="root" Title=\'Workspace\' IsExpanded="False"><!-- child --><a:OutlineNode Key="file"><a:OutlineNode.Text>Before</a:OutlineNode.Text></a:OutlineNode></a:OutlineNode></a:Outline>');
  const next=edit(text,form=>{const nodes=control(form).properties.Nodes;nodes[0].Text='Project';nodes[0].Expanded=-1;nodes[1].Text='After';nodes[1].Expanded=-1;});
  assert.match(next,/Title='Project'/);assert.match(next,/IsExpanded="True"/);assert.match(next,/<!-- child -->/);assert.match(next,/<a:OutlineNode.Text>After<\/a:OutlineNode.Text>/);
});

test('tab page captions and availability edit in place without losing owned child controls',()=>{
  const text=wrap('<a:TabView x:Name="B" SelectedIndex="0"><a:TabItem Title="General"><a:Button x:Name="Apply" Action="Apply_Click"/></a:TabItem><!-- advanced page --><a:TabItem Title=\'Advanced\' IsEnabled="True" Visibility="Visible"><a:Label x:Name="Details" Text="Details"/></a:TabItem></a:TabView>');
  const next=edit(text,form=>Object.assign(control(form).properties,{'TabCaption(1)':"Developer's tools",'TabEnabled(1)':0,'TabVisible(1)':0,'TabEnabled(0)':-1}));
  assert.match(next,/Title='Developer&apos;s tools'/);assert.match(next,/IsEnabled="False"/);assert.match(next,/Visibility="Collapsed"/);assert.match(next,/<!-- advanced page -->/);assert.match(next,/Action="Apply_Click"/);
});

test('tab selection keeps item-authored selection flags in place without introducing a parallel index',()=>{
  const text=wrap('<a:TabView x:Name="B"><a:TabItem Title="General" IsSelected="True"/><!-- choose advanced --><a:TabItem Title="Advanced"/></a:TabView>');
  const next=edit(text,form=>{control(form).properties.Tab=1;});
  assert.doesNotMatch(next,/SelectedIndex/);assert.match(next,/Title="General" IsSelected="False"/);assert.match(next,/<a:TabItem IsSelected="True" Title="Advanced"/);assert.match(next,/<!-- choose advanced -->/);
});

test('tab selection coordinates an explicit owner index with existing item flags',()=>{
  const text=wrap('<a:TabView x:Name="B" SelectedIndex=\'0\'><a:TabItem Title="General" IsSelected="True"/><a:TabItem Title="Advanced" IsSelected="False"/></a:TabView>');
  const next=edit(text,form=>{control(form).properties.Tab=1;});
  assert.match(next,/SelectedIndex='1'/);assert.match(next,/Title="General" IsSelected="False"/);assert.match(next,/Title="Advanced" IsSelected="True"/);
});

test('changing default tab selection adds the public owner property without opaque native metadata',()=>{
  const text=wrap('<a:TabView x:Name="B"><a:TabItem Title="General"/><a:TabItem Title="Advanced"/></a:TabView>');
  const next=edit(text,form=>{control(form).properties.Tab=1;});
  assert.match(next,/SelectedIndex="1"/);assert.doesNotMatch(next,/IsSelected/);
});

test('typed string title property elements preserve nested primitive spelling',()=>{
  const text=wrap('<a:TabView x:Name="B"><a:TabItem><a:TabItem.Title><x:String><!-- title -->Before</x:String></a:TabItem.Title></a:TabItem></a:TabView>');
  const next=edit(text,form=>{control(form).properties['TabCaption(0)']='  After  ';});
  assert.match(next,/<a:TabItem.Title><x:String xml:space="preserve"><!-- title -->  After  <\/x:String><\/a:TabItem.Title>/);
});

test('segment captions, enabled/visible state, tooltips and selection preserve typed items',()=>{
  const text=wrap('<a:SegmentedControl x:Name="B" SelectionMode="Single"><!-- items --><a:Segment Key="icons" Title=\'Icons\' IsSelected="True"/><a:Segment Key="list">List</a:Segment></a:SegmentedControl>');
  const next=edit(text,form=>{const buttons=control(form).properties.Buttons;buttons[0].Caption="Icon's view";buttons[0].Value=0;buttons[0].Enabled=0;buttons[0].ToolTipText='Use icons';buttons[1].Caption='  List  ';buttons[1].Value=1;buttons[1].Visible=0;});
  assert.match(next,/Title='Icon&apos;s view'/);assert.match(next,/ToolTip="Use icons"/);assert.match(next,/IsEnabled="False"/);assert.match(next,/Visibility="Collapsed"/);assert.match(next,/xml:space="preserve"/);assert.match(next,/<!-- items -->/);
});

test('segment selection edits update SelectedIndex and explicit item flags coherently',()=>{
  const text=wrap('<a:SegmentedControl x:Name="B" SelectedIndex=\'0\'><a:Segment Title="Icons" IsSelected="True"/><a:Segment Title="List" IsSelected="False"/></a:SegmentedControl>');
  const next=edit(text,form=>{const buttons=control(form).properties.Buttons;buttons[0].Value=0;buttons[1].Value=1;});
  assert.match(next,/SelectedIndex='1'/);assert.match(next,/Title="Icons" IsSelected="False"/);assert.match(next,/Title="List" IsSelected="True"/);
});

test('switching segment tracking to multiple removes scalar selection and retains every selected item',()=>{
  const text=wrap('<a:SegmentedControl x:Name="B" SelectionMode="Single" SelectedIndex="0"><a:Segment Title="Bold"/><a:Segment Title="Italic"/></a:SegmentedControl>');
  const next=edit(text,form=>{for(const b of control(form).properties.Buttons){b.Style=1;b.Value=1;}});
  assert.match(next,/SelectionMode="Multiple"/);assert.doesNotMatch(next,/SelectedIndex/);assert.equal((next.match(/IsSelected="True"/g)??[]).length,2);
});

test('switching segment tracking to momentary clears retained selection at the consuming fields',()=>{
  const text=wrap('<a:SegmentedControl x:Name="B" SelectionMode="Multiple"><a:Segment Title="Back" IsSelected="True"/><a:Segment Title="Forward" IsSelected="True"/></a:SegmentedControl>');
  const next=edit(text,form=>{for(const b of control(form).properties.Buttons){b.Style=0;b.Value=0;}});
  assert.match(next,/SelectionMode="Momentary"/);assert.equal((next.match(/IsSelected="False"/g)??[]).length,2);
});

test('unsupported row structural edits stage no partial scalar edits before native override fallback',()=>{
  const text=wrap('<a:Table x:Name="B"><a:Table.Columns><a:TableColumn Title="Name"/><a:TableColumn Title="Kind"/><a:TableColumn Title="State"/></a:Table.Columns><a:TableRow Text="Before"><x:String>One</x:String></a:TableRow></a:Table>');
  const next=edit(text,form=>{const row=control(form).properties.Items[0];row.Text='After';row.SubItems.push('Two');},{override:true});
  assert.match(next,/Designer.Properties/);assert.match(next,/<a:TableRow Text="Before">/);assert.match(next,/<x:String>One<\/x:String>/);
});

test('generated collection keys remain stable when unrelated data values are edited',()=>{
  const text=wrap('<a:Outline x:Name="B"><a:OutlineNode Text="Parent"><a:OutlineNode Text="Child"/></a:OutlineNode></a:Outline>');
  const next=edit(text,form=>{control(form).properties.Nodes[1].Text='Renamed child';});
  assert.doesNotMatch(next,/\bKey=/);assert.match(next,/Text="Renamed child"/);
});
