import test from 'node:test';
import assert from 'node:assert/strict';
import {EXAMPLES} from '../src/project/examples.js';
import {createControl,newProject} from '../src/project/model.js';
import {serializeFRM} from '../src/project/formats.js';
import {formToXaml,compileFormXaml,synchronizeFormXaml,xamlEnabled,createVb6XamlSchema,VB6_XAML_NS} from '../src/xaml/forms.js';
import {formStamp,readXamlDocument,prepareXamlEdit,synchronizeXamlProject,useDesignerXaml} from '../src/xaml/documents.js';
import {PRESENTATION_NS,XAML_NS} from '../packages/xaml-compiler/src/index.js';
const schema=createVb6XamlSchema();
const wrap=content=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:vb="${VB6_XAML_NS}" x:Name="Form1">${content}</Page>`;
const project=()=>{const p=newProject();p.settings.xaml=true;p.modules[0].form.controls.push(createControl('CommandButton','Button1',120,240));return p;};
for(const example of EXAMPLES) test('exact native XAML roundtrip: '+example.id,()=>{
  const p=example.create();
  for(const m of p.modules.filter(m=>m.form)) {
    const before=structuredClone(m.form),text=formToXaml(before,{schema}),result=compileFormXaml(text,{form:before,settings:p.settings,schema});
    assert.equal(result.success,true,JSON.stringify(result.diagnostics));assert.deepEqual(result.form,before);assert.deepEqual(m.form,before);
    assert.equal(serializeFRM({...m,form:result.form}),serializeFRM(m));
  }
});
test('strict project Boolean gate',()=>{for(const v of [undefined,null,false,0,1,'true',{}])assert.equal(xamlEnabled({settings:{xaml:v}}),false);assert.equal(xamlEnabled({settings:{xaml:true}}),true);});
test('native arrays, menus, custom controls and metadata keep exact identities/order',()=>{
  const p=project(),f=p.modules[0].form,a=createControl('Frame','Frame1',0,0),b=createControl('Frame','Frame1',0,0),c=createControl('Acme.Widget','Custom1',10,20);
  a.properties.Index=0;b.properties.Index=1;c.parent='Frame1';c.nativeParentId=b.id;c.originalType='Acme.Widget';c.__xamlOrder='user metadata';c.properties['Vendor.Point']={x:2,y:3};c.propertyGroups=[{name:'Font',raw:'unchanged'}];
  f.controls=[c,b,a];f.menus=[{id:'menu1',name:'FileMenu',type:'Menu',properties:{Caption:'&File'},parent:null},{id:'menu2',name:'OpenMenu',type:'Menu',properties:{Caption:'Open'},parent:'FileMenu'}];
  const r=compileFormXaml(formToXaml(f,{schema}),{form:f,schema});assert.equal(r.success,true,JSON.stringify(r.diagnostics));assert.deepEqual(r.form,f);
});
test('scalar property-grid changes preserve comments and attribute trivia',()=>{
  const f=project().modules[0].form,text=formToXaml(f,{schema}).replace('<vb:CommandButton','<!-- keep this -->\n  <vb:CommandButton'),next=structuredClone(f);next.controls[0].properties.Caption='Changed < & " caption';
  const r=synchronizeFormXaml(text,f,next,{schema});assert.equal(r.regenerated,false);assert.ok(r.text.includes('<!-- keep this -->'));assert.ok(r.text.includes('Changed &lt; &amp; &quot; caption'));assert.deepEqual(compileFormXaml(r.text,{form:next,schema}).form,next);
});
test('native structural additions preserve the original source',()=>{
  const f=project().modules[0].form,text=formToXaml(f,{schema}),next=structuredClone(f);next.controls.push(createControl('TextBox','Text1',0,0));const r=synchronizeFormXaml(text,f,next,{schema});assert.equal(r.regenerated,false);assert.deepEqual(compileFormXaml(r.text,{form:next,schema}).form,next);
});
test('WinUI literals lower to native twips/flags and conventional event handlers',()=>{
  const r=compileFormXaml(wrap('<Canvas><Button x:Name="Button1" Canvas.Left="10" Canvas.Top="20" Width="80" Height="30" Content="Hello" FontSize="16" IsEnabled="False" Click="Button1_Click" /></Canvas>'),{schema});
  assert.equal(r.success,true,JSON.stringify(r.diagnostics));const b=r.form.controls.find(c=>c.name==='Button1');assert.equal(b.type,'CommandButton');assert.equal(b.properties.Left,150);assert.equal(b.properties.Width,1200);assert.equal(b.properties.FontSize,12);assert.equal(b.properties.Enabled,0);assert.equal(b.properties.Caption,'Hello');
});
test('dynamic behavior and arbitrary handlers block conversion instead of falling back',()=>{
  for(const body of ['<TextBox Text="{Binding Name}"/>','<Button Click="Arbitrary"/>','<Button Opacity="2"/>','<Grid/>','<Button Width="Auto"/>']){const r=compileFormXaml(wrap(body),{schema});assert.equal(r.success,false,body);assert.equal(r.form,null);assert.ok(r.diagnostics.some(d=>d.severity==='error'));}
});
test('Grid lowering is opt-in and keeps grid tracks in twips/fractions',()=>{
  const r=compileFormXaml(wrap('<Grid x:Name="Grid1"><Grid.ColumnDefinitions><ColumnDefinition Width="100"/><ColumnDefinition Width="2*"/></Grid.ColumnDefinitions><Button Content="OK" Grid.Column="1"/></Grid>'),{schema,settings:{anchoring:true}});assert.equal(r.success,true,JSON.stringify(r.diagnostics));const grid=r.form.controls.find(c=>c.name==='Grid1');assert.equal(grid.properties.LayoutMode,5);assert.equal(grid.properties.LayoutGridColumns,'1500 2fr');
});
test('unsupported native metadata and duplicate identities are rejected',()=>{
  const p=project(),text=formToXaml(p.modules[0].form,{schema}),id=p.modules[0].form.id;
  assert.equal(compileFormXaml(text.replace(/vb:Designer.Id="[^"]+"/g,`vb:Designer.Id="${id}"`),{schema}).success,false);
  assert.throws(()=>formToXaml({...p.modules[0].form,extra:JSON.parse('{"__proto__":{"polluted":true}}')},{schema}),/Unsafe/);assert.equal({}.polluted,undefined);
});
test('invalid drafts persist without changing model/code and stale edits fail',()=>{
  const p=project(),m=p.modules[0],r=prepareXamlEdit(p,m.id,'<broken>',{schema,expectedRevision:0});assert.equal(r.applied,false);assert.deepEqual(r.module.form,m.form);assert.equal(r.module.code,m.code);assert.equal(r.module.xaml.text,'<broken>');assert.equal(m.xaml,undefined);assert.throws(()=>prepareXamlEdit(r.project,m.id,'<broken/>',{schema,expectedRevision:0}),/changed/);
});
test('source rename shares existing VB6 code rename and never rewrites strings/comments',()=>{
  const p=project(),m=p.modules[0];m.code='Private Sub Button1_Click()\n Button1.Caption = "Button1" \' Button1\nEnd Sub\n';
  const text=readXamlDocument(m,{schema}).text.replace('Name="Button1"','Name="Confirm"'),r=prepareXamlEdit(p,m.id,text,{schema});assert.equal(r.applied,true,JSON.stringify(r.result.diagnostics));assert.ok(r.module.code.includes('Confirm_Click'));assert.ok(r.module.code.includes('Confirm.Caption = "Button1" \' Button1'));assert.equal(r.module.form.controls[0].id,m.form.controls[0].id);
});
test('designer/source conflict preserves invalid draft and supports explicit recovery',()=>{
  const p=project(),m=p.modules[0],draft=prepareXamlEdit(p,m.id,'<invalid>',{schema}).project,next=structuredClone(draft);next.modules[0].form.controls[0].properties.Caption='Designer value';synchronizeXamlProject(draft,next,{schema});
  assert.equal(next.modules[0].xaml.text,'<invalid>');assert.equal(next.modules[0].xaml.conflict,true);assert.ok(next.modules[0].xaml.appliedText.includes('Designer value'));
  const recovered=useDesignerXaml(next,m.id,{schema});assert.equal(recovered.modules[0].xaml.previousText,'<invalid>');assert.equal(recovered.modules[0].xaml.conflict,false);assert.deepEqual(compileFormXaml(recovered.modules[0].xaml.text,{form:recovered.modules[0].form,schema}).form,recovered.modules[0].form);
});
test('property edits synchronize within the same snapshot and dormant off data is untouched',()=>{
  const p=project(),m=p.modules[0],initial=prepareXamlEdit(p,m.id,readXamlDocument(m,{schema}).text,{schema}).project,next=structuredClone(initial);next.modules[0].form.controls[0].properties.Caption='New';synchronizeXamlProject(initial,next,{schema});assert.ok(next.modules[0].xaml.text.includes('Caption="New"'));assert.equal(next.modules[0].xaml.base,formStamp(next.modules[0].form));
  const off=structuredClone(next);off.settings.xaml=false;off.modules[0].form.controls[0].properties.Caption='Dormant';const saved=structuredClone(off.modules[0].xaml);synchronizeXamlProject(next,off,{schema});assert.deepEqual(off.modules[0].xaml,saved);
});
test('common VM/AOT frontend refuses unresolved drafts; disabled authoring preserves classic behavior',async()=>{
  const {compileProject}=await import('../src/language/compiler.js'),p=project(),m=p.modules[0],bad=prepareXamlEdit(p,m.id,'<broken>',{schema}).project;
  assert.equal(compileProject(bad).valid,false);assert.ok(compileProject(bad).diagnostics.some(d=>d.code==='VBXAML2201'));
  bad.settings.xaml=false;assert.equal(compileProject(bad).valid,true);
});
test('HTML export rejects drafts and never includes authoring text or compiler code',async()=>{
  const {createApplicationExporter}=await import('../src/exporter/application-exporter.js'),p=project(),m=p.modules[0],text=readXamlDocument(m,{schema}).text+'<!-- ONLY_AUTHORING_9CABE -->',good=prepareXamlEdit(p,m.id,text,{schema}).project;
  const exporter=createApplicationExporter({runtimeSource:'/* runtime contract test */',runtimeCSS:'',compile:()=>({valid:true})});
  const html=exporter.html(good);assert.ok(!html.includes('ONLY_AUTHORING_9CABE'));assert.ok(good.modules[0].xaml.text.includes('ONLY_AUTHORING_9CABE'));
  const bad=prepareXamlEdit(good,m.id,'<broken>',{schema}).project;assert.throws(()=>exporter.html(bad),/XAML/);
});

test('WinUI lowering retains brush opacity beside the native OLE fallback',()=>{
  const result=compileFormXaml(wrap('<Page.Resources><SolidColorBrush x:Key="Tint" Color="#ff0000" Opacity="0.5" /></Page.Resources><Button Background="{StaticResource Tint}" />'),{schema});
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));
  assert.equal(result.form.controls[0].properties.BackColor,0x0000FF);
  assert.equal(result.form.controls[0].properties.WinUI3.properties.Background,'#80FF0000');
});
test('VB6 lowering applies implicit style setters',()=>{
  const result=compileFormXaml(wrap('<Page.Resources><Style TargetType="Button"><Setter Property="Width" Value="120" /></Style></Page.Resources><Button />'),{schema});
  assert.equal(result.success,true,JSON.stringify(result.diagnostics));assert.equal(result.form.controls[0].properties.Width,1800);
});
test('VB6 lowering rejects external dictionaries even if no key is referenced',()=>{
  const result=compileFormXaml(wrap('<Page.Resources><ResourceDictionary Source="theme.xaml" /></Page.Resources><Button />'),{schema});
  assert.equal(result.success,false);assert.match(result.diagnostics.map(d=>d.message).join('\n'),/external/);
});
test('VB6 lowering does not turn Button object content into illegal child controls',()=>{
  const result=compileFormXaml(wrap('<Button><TextBlock Text="Not a native container" /></Button>'),{schema});
  assert.equal(result.success,false);assert.match(result.diagnostics.map(d=>d.message).join('\n'),/cannot host/);
});
