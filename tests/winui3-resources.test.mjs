import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {WINUI_RESOURCES} from '../src/theme/winui-resources.js';
import {WINUI3_REFERENCE, WINUI3_SOURCE_FILES, WINUI3_RESOURCE_KEYS, WINUI3_RESOURCE_DEFINITIONS, WINUI3_DICTIONARY_SOURCES, WINUI3_SYSTEM_RESOURCE_KEYS, winui3Resource, winui3ResourceDefinition, WinUI3ResourceError} from '../src/theme/winui3-resources.js';
import {importWinUI3Dictionary, generateWinUI3Catalog, gitBlobSha, normalizeWinUI3Color} from '../tools/import-winui3-resources.mjs';

const xml = contents => `<ResourceDictionary xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml">${contents}</ResourceDictionary>`;
const errorCode = code => error => error instanceof WinUI3ResourceError && error.code === code;
const systemColors = Object.fromEntries(['ButtonFace','ButtonText','GrayText','Highlight','HighlightText','Hotlight','Window','WindowText'].map((name, index) => ['SystemColor'+name+'Color','#FF'+String(index+1).repeat(6)]));

test('catalog pins every input and preserves full per-file provenance', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../tools/winui3-upstream.json',import.meta.url),'utf8'));
  assert.equal(WINUI3_REFERENCE.commit,'ba3a8d59e6de4e2b86ca4f61c78bc26ccf129afd');
  assert.equal(WINUI3_REFERENCE.sourceCount,84);
  assert.equal(WINUI3_REFERENCE.resourceCount,13724);
  assert.equal(WINUI3_RESOURCE_KEYS.length,3536);
  assert.equal(WINUI3_REFERENCE.nativePixelParityCertified,false);
  assert.equal(WINUI3_SOURCE_FILES.reduce((sum,source)=>sum+source.resourceCount,0),13724);
  assert.deepEqual(WINUI3_SOURCE_FILES.map(({path,sha,size})=>({path,sha,size})),manifest.sources);
  assert.equal(WINUI3_SOURCE_FILES.find(source=>source.path.endsWith('/Common_themeresources_any.xaml')).sha,'ca07acb962a7c018a174bf28dcd0e945b13ddb4d');
  assert.equal(WINUI3_SOURCE_FILES[0].sha,'def26a6152487e366589660cd220509db6d4cf09');
  assert.ok(WINUI3_DICTIONARY_SOURCES.includes('ms-appx:///Microsoft.UI.Xaml/DensityStyles/Compact.xaml'));
  assert.ok(WINUI3_SOURCE_FILES.every(source=>!/perf2026|_v2\.5/.test(source.path)));
});

test('all 83 existing common colors independently match pinned ARGB values', () => {
  for (const [theme, colors] of Object.entries(WINUI_RESOURCES)) {
    assert.equal(Object.keys(colors).length,83);
    for (const [key, css] of Object.entries(colors)) {
      const native = winui3Resource(key,theme);
      assert.equal(native.type,'Color');
      const rgba = '#' + native.value.slice(3) + native.value.slice(1,3);
      assert.equal(rgba.toLowerCase(),(css.length===7?css+'ff':css).toLowerCase(),theme+':'+key);
    }
  }
});

test('modern control resources overlay the core platform dictionary', () => {
  assert.deepEqual(winui3Resource('ButtonBackground','light').value,{color:'#B3FFFFFF',opacity:1});
  assert.deepEqual(winui3Resource('ButtonBackground','dark').value,{color:'#0FFFFFFF',opacity:1});
  assert.equal(winui3ResourceDefinition('ButtonBackground','light').layer,'controls');
  assert.equal(winui3Resource('ControlContentThemeFontSize').value,14);
  assert.equal(winui3Resource('TextControlThemeMinWidth').value,64);
  assert.equal(winui3Resource('ContentControlThemeFontFamily').value,'XamlAutoFontFamily');
  assert.deepEqual(winui3Resource('ControlCornerRadius').value,[4,4,4,4]);
  assert.deepEqual(winui3Resource('ButtonBackground','light',{source:'src/controls/dev/CommonStyles/Button_themeresources.xaml'}).value,{color:'#B3FFFFFF',opacity:1});
});

test('TextBox disabled ink preserves its distinct light and dark source bytes', () => {
  assert.equal(winui3Resource('TextControlForegroundDisabled','light').value,'#5C010101');
  assert.equal(winui3Resource('TextControlForegroundDisabled','dark').value,'#5DFEFEFE');
  assert.notEqual(winui3Resource('TextControlForegroundDisabled','light').value,winui3Resource('TextFillColorDisabled','light').value);
});

test('accent ramps and brush opacity require explicit application color policy', () => {
  assert.ok(WINUI3_SYSTEM_RESOURCE_KEYS.includes('SystemAccentColorDark1'));
  assert.throws(()=>winui3Resource('AccentButtonBackground'),errorCode('WINUI3_SYSTEM_RESOURCE'));
  const accentColors = {SystemAccentColorDark1:'#FF123456',SystemAccentColorLight2:'#FFABCDEF'};
  assert.deepEqual(winui3Resource('AccentButtonBackgroundPointerOver','light',{accentColors}).value,{color:'#FF123456',opacity:0.9});
  assert.deepEqual(winui3Resource('AccentButtonBackgroundPressed','dark',{accentColors}).value,{color:'#FFABCDEF',opacity:0.8});
  assert.throws(()=>winui3Resource('AccentButtonBackground','light',{accentColors:{SystemAccentColorDark1:'url(https://invalid/)'}}),errorCode('WINUI3_INVALID_HOST_RESOURCE'));
});

test('high contrast aliases use the pinned core system-color mapping', () => {
  assert.deepEqual(winui3Resource('ButtonBackground','highcontrast',{systemColors}).value,{color:systemColors.SystemColorButtonFaceColor,opacity:1});
  assert.deepEqual(winui3Resource('AccentButtonBackground','highcontrast',{systemColors}).value,{color:systemColors.SystemColorHighlightColor,opacity:1});
  assert.deepEqual(winui3Resource('AccentButtonForeground','highcontrast',{systemColors}).value,{color:systemColors.SystemColorHighlightTextColor,opacity:1});
  assert.throws(()=>winui3Resource('ButtonBackground','highcontrast'),errorCode('WINUI3_SYSTEM_RESOURCE'));
});

test('compact density overrides only the resources defined by its source dictionaries', () => {
  for (const [key,standard,compact] of [['TextControlThemeMinHeight',32,24],['ComboBoxMinHeight',32,24],['ListViewItemMinHeight',40,32],['TreeViewItemMinHeight',28,24]]) {
    assert.equal(winui3Resource(key).value,standard,key);
    assert.equal(winui3Resource(key,'light',{density:'compact'}).value,compact,key);
  }
  assert.deepEqual(winui3Resource('TextControlThemePadding','light',{density:'compact'}).value,[2,2,6,1]);
  assert.deepEqual(winui3Resource('ButtonBackground','light',{density:'compact'}).value,winui3Resource('ButtonBackground','light').value);
});

test('stock geometry and typography come from native per-control dictionaries', () => {
  for (const [key,value] of [['ProgressBarTrackHeight',1],['ProgressBarMinHeight',3],['SliderInnerThumbHeight',12],['SliderHorizontalHeight',32],['ToggleSwitchThemeMinWidth',154],['CaptionTextBlockFontSize',12],['BodyLargeTextBlockFontSize',18],['TitleTextBlockFontSize',28],['DisplayTextBlockFontSize',68]]) assert.equal(winui3Resource(key).value,value,key);
  for (const key of ['TabViewItemHeaderBackgroundSelected','TreeViewItemBackgroundSelected','ComboBoxItemBackgroundSelected','ToggleSwitchKnobFillOff']) assert.ok(winui3Resource(key).value,key);
});

test('named styles retain exact setter references and explicit template boundaries', () => {
  const accent = winui3Resource('AccentButtonStyle').value;
  assert.equal(accent.targetType,'Button');
  assert.equal(accent.basedOn,null);
  assert.deepEqual(accent.setters.find(setter=>setter.property==='Background').value,{kind:'Resource',key:'AccentButtonBackground',theme:true});
  assert.equal(accent.unsupported.find(item=>item.property==='Template').type,'ControlTemplate');
  const body = winui3Resource('BodyLargeTextBlockStyle').value;
  assert.deepEqual(body.basedOn,{kind:'Resource',key:'BaseTextBlockStyle',theme:false});
  assert.equal(body.unsupported.length,0);
  assert.ok(body.setters.some(setter=>setter.property==='OpticalMarginAlignment'&&setter.value.value==='TrimSideBearings'));
});

test('gradient data preserves absolute endpoints, native offsets and theme reversal', () => {
  const light = winui3Resource('ButtonBorderBrush','light');
  assert.equal(light.type,'LinearGradientBrush');
  assert.deepEqual(light.value.startPoint,[0,0]); assert.deepEqual(light.value.endPoint,[0,3]);
  assert.equal(light.value.mappingMode,'Absolute'); assert.equal(light.value.spreadMethod,'Pad');
  assert.deepEqual(light.value.relativeTransform,{type:'ScaleTransform',scaleX:1,scaleY:-1,centerX:0,centerY:0.5});
  assert.deepEqual(light.value.gradientStops,[{offset:0.33,color:'#29000000'},{offset:1,color:'#0F000000'}]);
  assert.equal(winui3Resource('ButtonBorderBrush','dark').value.relativeTransform,null);
  const edge=winui3Resource('TabViewSelectedItemBorderBrush','light').value;
  assert.deepEqual(edge.gradientStops.map(stop=>stop.offset),[1,1]);
  assert.equal(edge.gradientStops[0].color,'#00FFFFFF');
});

test('unsupported native objects and conflicting upstream keys fail explicitly', () => {
  assert.throws(()=>winui3Resource('AcrylicBackgroundFillColorDefaultBrush'),errorCode('WINUI3_UNSUPPORTED_RESOURCE'));
  assert.throws(()=>winui3Resource('SliderContainerBackgroundDisabled','dark'),errorCode('WINUI3_AMBIGUOUS_RESOURCE'));
  assert.doesNotThrow(()=>winui3Resource('SliderContainerBackgroundDisabled','light'));
  assert.throws(()=>winui3Resource('UnknownResource'),errorCode('WINUI3_RESOURCE_NOT_FOUND'));
  assert.throws(()=>winui3Resource('__proto__'),errorCode('WINUI3_RESOURCE_NOT_FOUND'));
  assert.throws(()=>winui3Resource('ButtonBackground','unknown'),/Unknown WinUI appearance/);
});

test('catalog values are immutable and host values are copied without freezing callers', () => {
  const item=winui3Resource('ButtonBackground');
  assert.ok(Object.isFrozen(item));assert.ok(Object.isFrozen(item.value));
  assert.throws(()=>{item.value.opacity=0;},TypeError);
  assert.ok(Object.isFrozen(WINUI3_RESOURCE_DEFINITIONS));
  const vector=[1,2,3,4],hostResources={ApplicationInset:{type:'Thickness',value:vector}};
  const resolved=winui3Resource('ApplicationInset','light',{hostResources});
  assert.notEqual(resolved.value,vector);assert.ok(!Object.isFrozen(vector));
  vector[0]=7;assert.equal(resolved.value[0],1);
  assert.throws(()=>winui3Resource('Bad','light',{hostResources:{Bad:{type:'Style',value:{}}}}),errorCode('WINUI3_INVALID_HOST_RESOURCE'));
});

test('importer preserves theme branches, local styles and duplicate source diagnostics', () => {
  const source=xml('<ResourceDictionary.ThemeDictionaries><ResourceDictionary x:Key="Default"><Color x:Key="Ink">#80FF0000</Color><Color x:Key="OnlyDefault">White</Color></ResourceDictionary><ResourceDictionary x:Key="Light"><Color x:Key="Ink">Black</Color></ResourceDictionary></ResourceDictionary.ThemeDictionaries><Style x:Key="Own" TargetType="Button"><Setter Property="Background" Value="{ThemeResource Ink}"/><Setter Property="Template"><Setter.Value><ControlTemplate><Grid><Grid.Resources><Color x:Key="Local">White</Color></Grid.Resources></Grid></ControlTemplate></Setter.Value></Setter></Style><x:Double x:Key="N">1</x:Double><x:Double x:Key="N">2</x:Double>');
  const imported=importWinUI3Dictionary(source,{path:'src/controls/dev/Test/Test_themeresources.xaml'});
  assert.deepEqual(imported.themes,['Default','Light']);
  assert.equal(imported.resources.filter(entry=>entry[0]==='Ink').length,2);
  assert.ok(imported.resources.every(entry=>entry[0]!=='Local'));
  assert.equal(imported.resources.find(entry=>entry[0]==='OnlyDefault')[1],'Default');
  assert.equal(imported.diagnostics.find(item=>item.code==='WINUI3_DUPLICATE_RESOURCE').key,'N');
  assert.equal(imported.resources.find(entry=>entry[0]==='Own')[3].unsupported[0].type,'ControlTemplate');
});

test('importer rejects executable/invalid XML and marks unsupported gradient transforms', () => {
  assert.throws(()=>importWinUI3Dictionary('<!DOCTYPE x [<!ENTITY e SYSTEM "file:///secret">]>'+xml('<x:String x:Key="X">&e;</x:String>')),/DTD|entity/);
  assert.throws(()=>importWinUI3Dictionary(xml('<x:Double x:Key="N">NaN</x:Double>')),/numeric resource/);
  assert.throws(()=>importWinUI3Dictionary(xml('<ResourceDictionary.MergedDictionaries><ResourceDictionary Source="https://invalid"/></ResourceDictionary.MergedDictionaries>')),/merged dictionary loading/);
  const gradient=importWinUI3Dictionary(xml('<LinearGradientBrush x:Key="G"><LinearGradientBrush.RelativeTransform><RotateTransform Angle="45"/></LinearGradientBrush.RelativeTransform></LinearGradientBrush>'));
  assert.match(gradient.resources[0][5],/Only a scalar relative ScaleTransform/);
  assert.equal(normalizeWinUI3Color('#1234'),'#11223344');
  assert.equal(normalizeWinUI3Color('Transparent'),'#00FFFFFF');
});

test('regeneration verifies bytes and check mode catches catalog tampering', async t => {
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),'winui3-import-'));
  t.after(()=>fs.rm(directory,{recursive:true,force:true}));
  const relative='src/controls/dev/Test/Test_themeresources.xaml',input='\uFEFF'+xml('<x:Double x:Key="Metric">42</x:Double>')+'\r\n';
  const inputFile=path.join(directory,relative),manifestFile=path.join(directory,'manifest.json'),outputFile=path.join(directory,'generated.js');
  await fs.mkdir(path.dirname(inputFile),{recursive:true});await fs.writeFile(inputFile,input);
  const manifest={format:1,repository:'microsoft/microsoft-ui-xaml',commit:'1'.repeat(40),tag:'fixture',license:'LICENSES/WinUI.txt',scope:'fixture',sources:[{path:relative,sha:gitBlobSha(input),size:Buffer.byteLength(input)}]};
  await fs.writeFile(manifestFile,JSON.stringify(manifest));
  const options={sourceDirectory:directory,manifestFile,outputFile};
  assert.equal((await generateWinUI3Catalog(options)).resources,1);
  const first=await fs.readFile(outputFile,'utf8');
  await generateWinUI3Catalog({...options,check:true});
  await generateWinUI3Catalog(options);assert.equal(await fs.readFile(outputFile,'utf8'),first);
  await fs.writeFile(outputFile,first+'// stale\n');
  await assert.rejects(generateWinUI3Catalog({...options,check:true}),/differs from verified pinned sources/);
  await fs.writeFile(inputFile,input.replace('42','43'));
  await assert.rejects(generateWinUI3Catalog(options),/Pinned source hash or length mismatch/);
});
