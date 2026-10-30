import test from 'node:test';
import assert from 'node:assert/strict';
import {compileXaml,instantiateXaml,createObjectHost,PRESENTATION_NS,XAML_NS} from '../packages/xaml-compiler/src/index.js';
const wrap=body=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}">${body}</Page>`;
const program=body=>{const c=compileXaml(wrap(body));assert.equal(c.success,true,JSON.stringify(c.diagnostics));return c.program;};
const resource=(key,value)=>`<x:String x:Key="${key}">${value}</x:String>`;
const dictionary=(key,value)=>`<ResourceDictionary x:Key="${key}">${resource('Caption',value)}</ResourceDictionary>`;
const themes='<ResourceDictionary.ThemeDictionaries>'+dictionary('Default','fallback')+dictionary('Light','light')+dictionary('Dark','dark')+dictionary('HighContrast','contrast')+'</ResourceDictionary.ThemeDictionaries>';
const doc=resources=>program('<Page.Resources><ResourceDictionary>'+resources+'</ResourceDictionary></Page.Resources><Button Content="{StaticResource Caption}"/>');

test('object writer selects one theme dictionary while StaticResource snapshots its selected value',()=>{
  for(const [theme,expected] of [['Light','light'],['Dark','dark'],['HighContrast','contrast']]) {
    const {root}=instantiateXaml(doc(themes),createObjectHost(),{theme});assert.equal(root.properties.Content.properties.Content,expected);
  }
});
test('object writer native precedence is current, reverse merged, then selected theme dictionary',()=>{
  const merged='<ResourceDictionary.MergedDictionaries><ResourceDictionary>'+resource('Caption','first')+'</ResourceDictionary><ResourceDictionary>'+resource('Caption','last')+'</ResourceDictionary></ResourceDictionary.MergedDictionaries>';
  assert.equal(instantiateXaml(doc(themes+merged),createObjectHost()).root.properties.Content.properties.Content,'last');
  assert.equal(instantiateXaml(doc(themes+merged+resource('Caption','own')),createObjectHost()).root.properties.Content.properties.Content,'own');
});
test('object writer Default fallback applies to the dictionary and never fills missing selected-theme keys',()=>{
  const fallback='<ResourceDictionary.ThemeDictionaries>'+dictionary('Default','fallback')+'</ResourceDictionary.ThemeDictionaries>';
  assert.equal(instantiateXaml(doc(fallback),createObjectHost(),{theme:'Dark'}).root.properties.Content.properties.Content,'fallback');
  const incomplete='<ResourceDictionary.ThemeDictionaries>'+dictionary('Default','fallback')+'<ResourceDictionary x:Key="Light">'+resource('Different','irrelevant')+'</ResourceDictionary></ResourceDictionary.ThemeDictionaries>';
  assert.throws(()=>instantiateXaml(doc(incomplete),createObjectHost(),{theme:'Light'}),/Missing XAML resource Caption/);
});
test('merged dictionary resources resolve dependencies in their declaration closure',()=>{
  const source=program('<Page.Resources><ResourceDictionary><ResourceDictionary.MergedDictionaries><ResourceDictionary>'+resource('Local','declaration')+'<SolidColorBrush x:Key="Brush" Color="{StaticResource Local}"/></ResourceDictionary></ResourceDictionary.MergedDictionaries></ResourceDictionary></Page.Resources><Canvas><Canvas.Resources>'+resource('Local','consumer shadow')+'</Canvas.Resources><Button Background="{StaticResource Brush}"/></Canvas>');
  const {root}=instantiateXaml(source,createObjectHost());assert.equal(root.properties.Content.properties.Children[0].properties.Background.properties.Color,'declaration');
});
test('ThemeResource delegates to the explicit host with an accurate scoped resolver',()=>{
  const source=program('<Page.Resources><ResourceDictionary>'+themes+'</ResourceDictionary></Page.Resources><Button Content="{ThemeResource Caption}"/>');
  const calls=[],host={...createObjectHost(),resource(key,context){calls.push([key,context.theme,context.effectiveTheme]);return context.lookup();}};
  const {root}=instantiateXaml(source,host,{theme:'Dark'});
  assert.equal(root.properties.Content.properties.Content,'dark');assert.deepEqual(calls,[['Caption',true,'Dark']]);
  assert.throws(()=>instantiateXaml(source,createObjectHost(),{theme:'Dark'}),/requires host.resource/);
});
test('external source dictionaries require preprocessing and cannot trigger I/O from object writer',()=>{
  const source=program('<Page.Resources><ResourceDictionary Source="https://example.invalid/resources.xaml"/></Page.Resources><Button/>');
  assert.throws(()=>instantiateXaml(source,createObjectHost()),/explicit host preprocessing/);
});

test('template factories capture merged and selected theme resources with declaration precedence',()=>{
  const source=program('<Page.Resources><ResourceDictionary><ResourceDictionary.MergedDictionaries><ResourceDictionary>'+resource('Merged','merged value')+'<SolidColorBrush x:Key="SharedBrush" Color="#112233"/></ResourceDictionary></ResourceDictionary.MergedDictionaries>'+themes+'<DataTemplate x:Key="Template"><Button Content="{StaticResource Caption}" Tag="{StaticResource Merged}" Background="{StaticResource SharedBrush}"/></DataTemplate></ResourceDictionary></Page.Resources><Button Content="{StaticResource Template}"/>');
  const host={...createObjectHost(),template(node,create){return create;}};
  const loaded=instantiateXaml(source,host,{theme:'Dark'}),factory=loaded.root.properties.Content.properties.Content;
  const first=factory(),second=factory();
  assert.equal(first.root.properties.Content,'dark');assert.equal(first.root.properties.Tag,'merged value');
  assert.equal(first.root.properties.Background,second.root.properties.Background);
  assert.notEqual(first.root,second.root);
  first.dispose();second.dispose();loaded.dispose();
});
