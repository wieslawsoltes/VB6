import test from 'node:test';
import assert from 'node:assert/strict';
import {compileXaml,createWinUISchema,PRESENTATION_NS,XAML_NS,WINUI_CONTROLS_NS} from '../packages/xaml-compiler/src/index.js';
const wrap=body=>`<Page xmlns="${PRESENTATION_NS}" xmlns:x="${XAML_NS}" xmlns:muxc="${WINUI_CONTROLS_NS}">${body}</Page>`;
const good=body=>{const result=compileXaml(wrap(body));assert.equal(result.success,true,JSON.stringify(result.diagnostics));return result;};

test('one keyed theme dictionary remains a dictionary entry, not an unwrapped resource wrapper',()=>{
  const result=good('<Page.Resources><ResourceDictionary><ResourceDictionary.ThemeDictionaries><ResourceDictionary x:Key="Dark"><x:String x:Key="Greeting">Dark</x:String></ResourceDictionary></ResourceDictionary.ThemeDictionaries></ResourceDictionary></Page.Resources><Button/>');
  const themes=result.nodes.find(node=>node.type.name==='ResourceDictionary'&&!node.directives.Key).properties.find(p=>p.member.name==='ThemeDictionaries').value;
  assert.equal(themes.kind,'Dictionary');assert.equal(themes.entries.length,1);assert.equal(themes.entries[0].key,'Dark');
});
test('a single keyed ResourceDictionary used as a resource keeps its authored key',()=>{
  const result=good('<Page.Resources><ResourceDictionary x:Key="Nested"><x:String x:Key="Greeting">Hello</x:String></ResourceDictionary></Page.Resources><Button/>');
  assert.equal(result.root.properties.find(p=>p.member.name==='Resources').value.entries[0].key,'Nested');
});
test('public controls namespace aliases retain base identity and dictionary capability',()=>{
  const schema=createWinUISchema();
  assert.ok(schema.isAssignable(schema.getType(WINUI_CONTROLS_NS,'Button'),schema.getType(PRESENTATION_NS,'Button')));
  const result=good('<Page.Resources><ResourceDictionary><ResourceDictionary.MergedDictionaries><muxc:XamlControlsResources/></ResourceDictionary.MergedDictionaries></ResourceDictionary></Page.Resources><muxc:ToggleSwitch IsOn="True" Header="Network" Toggled="Toggle_Click"/>');
  assert.equal(result.nodes.find(node=>node.type.name==='XamlControlsResources').dictionary,true);
  const toggle=result.nodes.find(node=>node.type.name==='ToggleSwitch');
  assert.equal(toggle.type.namespaceURI,WINUI_CONTROLS_NS);assert.equal(toggle.properties.find(p=>p.member.name==='IsOn').value.value,true);
});
test('a foreign namespace local name never acquires a public WinUI control identity',()=>{
  assert.equal(compileXaml(wrap('<foreign:ToggleSwitch xmlns:foreign="urn:foreign"/>')).success,false);
});
