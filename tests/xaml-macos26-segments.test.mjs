import test from 'node:test';
import assert from 'node:assert/strict';
import {MACOS26_NS,PRESENTATION_NS,XAML_NS,compileXaml,createMacOS26Schema,XamlLanguageService} from '../packages/xaml-compiler/src/index.js';
import {compileFormXaml,formToXaml,synchronizeFormXaml} from '../src/xaml/forms.js';

const wrap=body=>`<mac:Window xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:mac="${MACOS26_NS}" x:Name="Form1">${body}</mac:Window>`;
const source=(items,attrs='')=>wrap(`<mac:SegmentedControl x:Name="Modes" ${attrs}>${items}</mac:SegmentedControl>`);
const compile=text=>{const r=compileFormXaml(text);assert.equal(r.success,true,JSON.stringify(r.diagnostics));return r;};
const reject=(text,pattern)=>{const r=compileFormXaml(text);assert.equal(r.success,false);assert.equal(r.form,null);assert.match(r.diagnostics.map(d=>d.message).join('\n'),pattern);};

test('segmented schema exposes typed item data and host-owned construction IR',()=>{
  const text=source('<mac:Segment Key="icons" Title="Icons" IsSelected="True"/>','SelectionMode="Single"');
  const r=compileXaml(text,{schema:createMacOS26Schema()});assert.equal(r.success,true,JSON.stringify(r.diagnostics));
  const node=r.nodes.find(n=>n.name==='Modes');
  assert.equal(node.type.name,'SegmentedControl');
  assert.equal(node.properties.find(p=>p.member.name==='Segments').member.itemNamespaceURI,MACOS26_NS);
  assert.equal(r.nodes.filter(n=>n.type.name==='Segment').length,1);
});

test('single segmented selection lowers to actual Toolbar buttons and native group flags',()=>{
  const r=compile(source('<mac:Segment Key="icons" Title="Icons" ToolTip="Icon view"/><mac:Segment x:Key="list" IsSelected="True">List</mac:Segment><mac:Segment Title="Columns" IsEnabled="False" Visibility="Collapsed"/>','Action="Modes_ButtonClick"'));
  assert.equal(r.form.controls.length,1);const c=r.form.controls[0];assert.equal(c.type,'Toolbar');
  assert.equal(c.properties.MacOSControlStyle,'segmented');
  assert.deepEqual(c.properties.Buttons,[
    {Key:'icons',Caption:'Icons',Style:2,Value:0,Enabled:-1,Visible:-1,ToolTipText:'Icon view'},
    {Key:'list',Caption:'List',Style:2,Value:1,Enabled:-1,Visible:-1,ToolTipText:''},
    {Key:'segment1',Caption:'Columns',Style:2,Value:0,Enabled:0,Visible:0,ToolTipText:''}
  ]);
  assert.equal(Object.hasOwn(c.properties,'SelectedIndex'),false);assert.equal(Object.hasOwn(c.properties,'ListIndex'),false);
});

test('multiple and momentary modes use existing independent check and push semantics',()=>{
  const multiple=compile(source('<mac:Segment Title="Bold" IsSelected="True"/><mac:Segment Title="Italic" IsSelected="True"/>','SelectionMode="Multiple" SelectionChanged="Modes_ButtonClick"'));
  assert.deepEqual(multiple.form.controls[0].properties.Buttons.map(b=>[b.Style,b.Value]),[[1,1],[1,1]]);
  const momentary=compile(source('<mac:Segment Title="Back"/><mac:Segment Title="Forward"/>','SelectionMode="Momentary" SelectedIndex="-1"'));
  assert.deepEqual(momentary.form.controls[0].properties.Buttons.map(b=>[b.Style,b.Value]),[[0,0],[0,0]]);
});

test('SelectedIndex is a validated authoring shorthand and resource values retain typing',()=>{
  const text=wrap('<mac:Window.Resources><x:String x:Key="Mode">single</x:String><x:Int32 x:Key="Selected">1</x:Int32><x:String x:Key="Title">List</x:String></mac:Window.Resources><mac:SegmentedControl x:Name="Modes" SelectedIndex="{StaticResource Selected}" SelectionMode="{StaticResource Mode}"><mac:Segment Title="Icons"/><mac:Segment Title="{StaticResource Title}"/></mac:SegmentedControl>');
  const r=compile(text);assert.deepEqual(r.form.controls[0].properties.Buttons.map(b=>[b.Caption,b.Value]),[['Icons',0],['List',1]]);
  const unset=compile(source('<mac:Segment/>','SelectedIndex="-1"'));assert.equal(unset.form.controls[0].properties.Buttons[0].Value,0);
});

test('segmented defaults and item data survive the complete native canonical round trip',()=>{
  const r=compile(source('<mac:Segment Key="one" Title="One" IsSelected="True"/><mac:Segment Title="Two" IsEnabled="False"/>','ControlSize="small" AccessibilityLabel="View mode"'));
  const canonical=formToXaml(r.form),again=compileFormXaml(canonical);
  assert.equal(again.success,true,JSON.stringify(again.diagnostics));assert.deepEqual(again.form,r.form);
});

test('segmented event identity and unrelated scalar edits preserve authored namespace source',()=>{
  const text=source('<!-- modes --><mac:Segment Title="Icons"/>','Action="Modes_ButtonClick" ControlSize="small"');
  const before=compile(text).form,after=structuredClone(before),control=after.controls[0];
  control.name='Views';Object.assign(control.properties,{Name:'Views',MacOSControlSize:'large'});
  const result=synchronizeFormXaml(text,before,after);assert.equal(result.regenerated,false,result.text);
  assert.match(result.text,/Action="Views_ButtonClick"/);assert.match(result.text,/ControlSize="large"/);assert.match(result.text,/<!-- modes -->/);
  const again=compileFormXaml(result.text,{form:after});assert.equal(again.success,true,JSON.stringify(again.diagnostics));assert.deepEqual(again.form,after);
});

test('language service suggests coherent tracking modes and typed segment item members',()=>{
  const service=new XamlLanguageService({schema:createMacOS26Schema()}),uri='segments.xaml';
  let text=source('<mac:Segment/>','SelectionMode=""');service.openDocument(uri,text,1);
  assert.deepEqual(service.completion(uri,text.indexOf('SelectionMode="')+15).map(c=>c.label).filter(v=>['Single','Multiple','Momentary'].includes(v)).sort(),['Momentary','Multiple','Single']);
  text=source('<mac:Segment IsEnabled=""/>');service.openDocument(uri,text,2);
  assert.ok(service.completion(uri,text.indexOf('IsEnabled="')+11).some(c=>c.label==='True'));
});

for(const [name,text,pattern] of [
  ['empty',source(''),/at least one Segment/],
  ['explicit empty',source('<mac:SegmentedControl.Segments/>'),/at least one Segment/],
  ['wrong item type',source('<mac:Button/>'),/assignable|Segment/],
  ['duplicate key',source('<mac:Segment Key="One"/><mac:Segment Key="one"/>'),/Duplicate native collection key/],
  ['conflicting keys',source('<mac:Segment Key="one" x:Key="two"/>'),/Key and x:Key must agree/],
  ['named data item',source('<mac:Segment x:Name="Phantom"/>'),/static item data/],
  ['multiple radio selection',source('<mac:Segment IsSelected="True"/><mac:Segment IsSelected="True"/>'),/at most one selected/],
  ['momentary selection',source('<mac:Segment IsSelected="True"/>','SelectionMode="Momentary"'),/persistent selection/],
  ['momentary index',source('<mac:Segment/>','SelectionMode="Momentary" SelectedIndex="0"'),/persistent selection/],
  ['multiple index',source('<mac:Segment/>','SelectionMode="Multiple" SelectedIndex="0"'),/uses Segment.IsSelected/],
  ['out-of-range index',source('<mac:Segment/>','SelectedIndex="1"'),/outside the segment collection/],
  ['negative index',source('<mac:Segment/>','SelectedIndex="-2"'),/outside the segment collection/],
  ['conflicting selection',source('<mac:Segment IsSelected="True"/><mac:Segment/>','SelectedIndex="1"'),/conflicts with Segment.IsSelected/],
  ['explicit deselection conflict',source('<mac:Segment IsSelected="False"/>','SelectedIndex="0"'),/conflicts with Segment.IsSelected/],
  ['unimplemented mode',source('<mac:Segment/>','SelectionMode="Accelerator"'),/Expected Single, Multiple, Momentary/],
  ['arbitrary event forwarding',source('<mac:Segment/>','Action="OnSegment"'),/Modes_ButtonClick/]
])test('segmented lowering rejects '+name,()=>reject(text,pattern));

test('segmented expansion is bounded before repeated resource text allocates oversized items',()=>{
  const text=wrap('<mac:Window.Resources><x:String x:Key="Huge">'+'x'.repeat(120000)+'</x:String></mac:Window.Resources><mac:SegmentedControl>'+('<mac:Segment Title="{StaticResource Huge}"/>').repeat(20)+'</mac:SegmentedControl>');
  reject(text,/Expanded macOS SegmentedControl.Segments exceeds the document limit/);
});
