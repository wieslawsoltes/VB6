import test from 'node:test';
import assert from 'node:assert/strict';
import {PRESENTATION_NS,XAML_NS,MACOS26_NS} from '../packages/xaml-compiler/src/index.js';
import {compileFormXaml,createVb6XamlSchema,synchronizeFormXaml} from '../src/xaml/forms.js';
import {macos26ColorFallback} from '../src/theme/macos26-resources.js';
import {editDesignerProperties} from '../src/designer/property-model.js';
import {MACOS26_COMPAT_XAML,macos26CompatibilityGallery} from './fixtures/macos26-compat-gallery.mjs';

const schema=createVb6XamlSchema(),wrap=body=>`<a:Window xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:a="${MACOS26_NS}" x:Name="Form1">${body}</a:Window>`;
const load=text=>{const r=compileFormXaml(text,{schema});assert.equal(r.success,true,JSON.stringify(r.diagnostics));return r.form;};
const node=(form,name='B')=>form.controls.find(c=>c.name===name);
const verify=(text,before,after)=>{
  const result=synchronizeFormXaml(text,before,after,{schema});assert.equal(result.regenerated,false,result.text);
  const recompiled=compileFormXaml(result.text,{schema,form:after});assert.equal(recompiled.success,true,JSON.stringify(recompiled.diagnostics));assert.deepEqual(recompiled.form,after);return result.text;
};

test('designer scalar edits preserve macOS tags, namespace spelling, comments and quote delimiters',()=>{
  const text=wrap('<a:View><!-- keep macOS --><a:Button x:Name="B" Title=\'Save\' a:Appearance.ControlSize="small" a:Canvas.Left="10"/><a:TextField x:Name="T" StringValue="Original"/></a:View>'),a=load(text),b=structuredClone(a);
  Object.assign(node(b).properties,{Caption:"Don't discard",MacOSControlSize:'large',Left:300});node(b,'T').properties.Text='Changed';
  const next=verify(text,a,b);assert.match(next,/<!-- keep macOS -->/);assert.match(next,/Title='Don&apos;t discard'/);assert.match(next,/a:Appearance.ControlSize="large"/);assert.match(next,/a:Canvas.Left="20"/);assert.match(next,/StringValue="Changed"/);
});

test('aliased property-element captions remain in place',()=>{
  const text=wrap('<a:Button x:Name="B"><a:Button.Title><!-- title -->Before</a:Button.Title></a:Button>'),a=load(text),b=structuredClone(a);node(b).properties.Caption='After';
  assert.match(verify(text,a,b),/<a:Button.Title><!-- title -->After<\/a:Button.Title>/);
});

test('action and date event identities follow control renaming',()=>{
  const text=wrap('<a:View><a:Button x:Name="B" Action="B_Click"/><a:DatePicker x:Name="Date" Date="2026-10-16" DateChanged="Date_Change"/></a:View>'),a=load(text),b=structuredClone(a);
  for(const [oldName,newName] of [['B','Apply'],['Date','DueDate']]){const n=node(b,oldName);n.name=newName;n.properties.Name=newName;}
  const next=verify(text,a,b);assert.match(next,/Action="Apply_Click"/);assert.match(next,/DateChanged="DueDate_Change"/);assert.match(next,/<a:DatePicker/);
});

test('semantic color role edits update only the consuming expression',()=>{
  const text=wrap('<a:Window.Resources><SolidColorBrush x:Key="Shared" Color="{ThemeResource macOS.labelColor}"/><Style x:Key="S" TargetType="a:Button"><Setter Property="Foreground" Value="{StaticResource Shared}"/></Style></a:Window.Resources><a:View><a:Button x:Name="B" Style="{StaticResource S}"/><a:Button x:Name="C" Style="{StaticResource S}"/></a:View>'),a=load(text),b=structuredClone(a);
  Object.assign(node(b).properties,{MacOSForegroundRole:'secondaryLabelColor',ForeColor:macos26ColorFallback('secondaryLabelColor')});
  const next=verify(text,a,b);assert.match(next,/Color="\{ThemeResource macOS.labelColor\}"/);assert.match(next,/Foreground="\{ThemeResource macOS.secondaryLabelColor\}"/);assert.equal(node(b,'C').properties.MacOSForegroundRole,'labelColor');
});

test('direct semantic role edits preserve attached namespace and recompute fallback',()=>{
  const text=wrap('<a:Button x:Name="B" a:Appearance.ForegroundRole="labelColor"/>'),a=load(text),b=structuredClone(a);
  Object.assign(node(b).properties,{MacOSForegroundRole:'linkColor',ForeColor:macos26ColorFallback('linkColor')});
  const next=verify(text,a,b);assert.match(next,/a:Appearance.ForegroundRole="linkColor"/);assert.doesNotMatch(next,/Designer.Properties/);
});

test('role-only Inspector edits update the consuming expression and preserve its exact OLE fallback',()=>{
  const text=wrap('<a:TextField x:Name="B" Foreground="{ThemeResource macOS.secondaryLabelColor}"/>'),a=load(text);
  const b=editDesignerProperties(a,[node(a).id],{MacOSForegroundRole:'labelColor'});
  const next=verify(text,a,b);assert.match(next,/Foreground="\{ThemeResource macOS.labelColor\}"/);assert.match(next,/Designer.Properties/);
  assert.equal(node(b).properties.ForeColor,macos26ColorFallback('secondaryLabelColor'));
});

test('macOS TabView is already materialized before unrelated Inspector edits so rich alias source stays intact',()=>{
  const settings={anchoring:true},initial=macos26CompatibilityGallery().modules[0].form;
  const loaded=compileFormXaml(MACOS26_COMPAT_XAML,{schema,settings,form:initial});assert.equal(loaded.success,true,JSON.stringify(loaded.diagnostics));
  let a=loaded.form,text=MACOS26_COMPAT_XAML;assert.equal(node(a,'Pages').designerTabPages,true);
  for(const [key,value] of [['PlaceholderText','Find preferences'],['MacOSControlSize','extraLarge'],['MacOSForegroundRole','labelColor']]) {
    const b=editDesignerProperties(a,[node(a,'Search').id],{[key]:value});assert.ok(b);
    const result=synchronizeFormXaml(text,a,b,{schema,settings});assert.equal(result.regenerated,false,key);
    const recompiled=compileFormXaml(result.text,{schema,settings,form:b});assert.equal(recompiled.success,true,JSON.stringify(recompiled.diagnostics));assert.deepEqual(recompiled.form,b);
    a=b;text=result.text;
  }
  assert.match(text,/<mac:TabView/);assert.match(text,/<mac:SearchField/);assert.match(text,/PlaceholderString="Find preferences"/);
  assert.match(text,/ControlSize="extraLarge"/);assert.match(text,/Foreground="\{ThemeResource macOS.labelColor\}"/);
  assert.match(text,/<!-- Keep this authored macOS vocabulary/);
});

for(const [name,color] of [['literal color',0x563412],['same system fallback',macos26ColorFallback('labelColor')]])test('explicit '+name+' removes semantic role without losing the authored source',()=>{
  const text=wrap('<!-- palette remains --><a:Button x:Name="B" Foreground="{ThemeResource macOS.labelColor}"/>'),a=load(text),b=structuredClone(a);
  delete node(b).properties.MacOSForegroundRole;node(b).properties.ForeColor=color;
  const next=verify(text,a,b);assert.match(next,/<!-- palette remains -->/);assert.match(next,/Designer.Properties/);assert.match(next,/<a:Button/);
});

test('removing an attached semantic role preserves source and exact native fallback',()=>{
  const text=wrap('<a:Button x:Name="B" a:Appearance.ForegroundRole="labelColor"/>'),a=load(text),b=structuredClone(a);
  delete node(b).properties.MacOSForegroundRole;
  const next=verify(text,a,b);assert.match(next,/<a:Button/);assert.match(next,/a:Appearance.ForegroundRole="labelColor"/);assert.match(next,/Designer.Properties/);
});

test('default macOS namespace emits valid unprefixed semantic extensions when edited',()=>{
  const text=`<Window xmlns="${MACOS26_NS}" xmlns:x="${XAML_NS}" x:Name="Form1"><Button x:Name="B" Foreground="{ThemeResource macOS.labelColor}"/></Window>`,a=load(text),b=structuredClone(a);
  Object.assign(node(b).properties,{MacOSForegroundRole:'linkColor',ForeColor:macos26ColorFallback('linkColor')});
  assert.match(verify(text,a,b),/Foreground="\{ThemeResource macOS.linkColor\}"/);
});

test('radio, stepper orientation and image-stretch edits reverse to the alias property',()=>{
  const text=wrap('<a:View><a:RadioButton x:Name="B" IsOn="True"/><a:Stepper x:Name="Step" Orientation="Vertical"/><a:Image x:Name="Image" Stretch="Fill"/></a:View>'),a=load(text),b=structuredClone(a);
  node(b).properties.Value=0;node(b,'Step').properties.Orientation=1;node(b,'Image').properties.Stretch=0;
  const next=verify(text,a,b);assert.match(next,/IsOn="False"/);assert.match(next,/Orientation="Horizontal"/);assert.match(next,/Stretch="None"/);
});
