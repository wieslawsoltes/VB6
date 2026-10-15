import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {WINUI_RESOURCES,WINUI_REFERENCE,WINUI_METRICS,xamlColorToCss,winuiResources} from '../src/theme/winui-resources.js';
import {THEMES,cssColor} from '../src/theme/theme.js';
import {controlThemeColor} from '../src/theme/control-theme-color.js';
import {WINUI_TOKEN_NAMES,WINUI_ALIASES,winuiThemeTokens,winuiLicenseCss} from '../tools/winui-theme-css.mjs';
import {renderApplicationThemeTokens} from '../tools/application-theme-css.mjs';
import {renderIdeThemePalettes} from '../tools/ide-theme-css.mjs';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');

test('WinUI source identity and both full color dictionaries remain pinned',()=>{
  assert.equal(WINUI_REFERENCE.sdk,'2.5.1');
  assert.equal(WINUI_REFERENCE.blob,'ca07acb962a7c018a174bf28dcd0e945b13ddb4d');
  assert.equal(Object.keys(WINUI_RESOURCES.light).length,83);
  assert.deepEqual(Object.keys(WINUI_RESOURCES.light),Object.keys(WINUI_RESOURCES.dark));
  for(const colors of Object.values(WINUI_RESOURCES)) {
    assert.ok(Object.isFrozen(colors));assert.equal(Object.getPrototypeOf(colors),null);
    for(const value of Object.values(colors))assert.match(value,/^#(?:[a-f\d]{6}|[a-f\d]{8})$/);
  }
  assert.ok(Object.isFrozen(WINUI_RESOURCES));assert.ok(Object.isFrozen(WINUI_METRICS));
});
test('ARGB conversion keeps the alpha byte last, including transparent nonblack colors',()=>{
  for(const [a,b] of [['#B3FFFFFF','#ffffffb3'],['#E4000000','#000000e4'],['#00F3F3F3','#f3f3f300'],['#ABCDef','#abcdef']])assert.equal(xamlColorToCss(a),b);
  for(const bad of ['',null,12,'#abc','#1234567','#GGGGGG','#123456789',' #123456','red','url(a)'])assert.throws(()=>xamlColorToCss(bad),TypeError);
  for(const bad of ['Dark','default','__proto__','constructor',null])assert.throws(()=>winuiResources(bad),RangeError);
});
test('native state-critical resources retain exact source alpha, not approximate RGB',()=>{
  const expected={
    TextFillColorPrimary:['#000000e4','#ffffff'],TextFillColorDisabled:['#0000005c','#ffffff5d'],
    ControlFillColorDefault:['#ffffffb3','#ffffff0f'],ControlFillColorSecondary:['#f9f9f980','#ffffff15'],
    ControlFillColorTertiary:['#f9f9f94d','#ffffff08'],ControlFillColorInputActive:['#ffffff','#1e1e1eb3'],
    ControlStrokeColorDefault:['#0000000f','#ffffff12'],ControlStrokeColorSecondary:['#00000029','#ffffff18'],
    TextOnAccentFillColorPrimary:['#ffffff','#000000'],TextOnAccentFillColorDisabled:['#ffffff','#ffffff87'],
    FocusStrokeColorOuter:['#000000e4','#ffffff'],FocusStrokeColorInner:['#ffffffb3','#000000b3'],
    AccentFillColorDisabled:['#00000037','#ffffff28']
  };
  for(const [key,pair] of Object.entries(expected))assert.deepEqual([WINUI_RESOURCES.light[key],WINUI_RESOURCES.dark[key]],pair,key);
});
test('every native alias resolves to a known immutable semantic color',()=>{
  for(const name of Object.values(WINUI_ALIASES))assert.ok(Object.hasOwn(WINUI_RESOURCES.light,name),name);
  assert.equal(WINUI_TOKEN_NAMES.length,new Set(WINUI_TOKEN_NAMES).size);
});
test('all nine application boundaries declare every token and non-Fluent boundaries invalidate every token',()=>{
  for(const theme of Object.values(THEMES)) {
    const css=winuiThemeTokens(theme);
    assert.equal((css.match(/--winui-/g)||[]).length>=WINUI_TOKEN_NAMES.length,true);
    for(const name of WINUI_TOKEN_NAMES) {
      assert.equal(css.split(`--winui-${name}:`).length,2,theme.id+': '+name);
      if(theme.family!=='fluent')assert.ok(css.includes(`--winui-${name}: initial;`));
    }
    assert.doesNotMatch(css,/undefined|null|NaN/);
  }
});
test('generated palettes are deterministic and include the complete Microsoft license in standalone CSS',()=>{
  assert.equal(read('src/theme/application-palettes.css'),renderApplicationThemeTokens());
  assert.equal(read('src/theme/ide-palettes.css'),renderIdeThemePalettes());
  assert.ok(renderApplicationThemeTokens().includes(read('LICENSES/WinUI.txt').replace(/\r\n?/g,'\n')));
  assert.ok(winuiLicenseCss().includes('Copyright (c) Microsoft Corporation.'));
  assert.doesNotMatch(renderApplicationThemeTokens(),/data-ide-/);
});
test('component paint uses boundary tokens, never a Fluent ancestor selector or third-party assets',()=>{
  const css=read('src/theme/winui-controls.css');
  assert.doesNotMatch(css,/data-vb-theme-family|data-ide-|https?:|@import|@font-face/);
  const declarations=new Set([...css.matchAll(/(--winui-[\w-]+)\s*:/g)].map(m=>m[1]));
  for(const [,name] of css.matchAll(/var\((--winui-[\w-]+)/g))
    assert.ok(WINUI_TOKEN_NAMES.includes(name.slice(8))||declarations.has(name),`Unbound resource: ${name}`);
});
for(const [slot,index] of [['commandBackground',15],['commandForeground',18],['inputBackground',5],['inputForeground',8],['inputHostBackground',5]]) {
  test(`OLE ${slot} indirection supports signed, unsigned and serialized numeric system colors`,()=>{
    const signed=(0x80000000|index),unsigned=signed>>>0;
    for(const value of [signed,unsigned,String(signed),String(unsigned)]){
      const result=controlThemeColor(value,slot);
      assert.match(result,/^var\(--winui-/);assert.ok(result.includes(cssColor(value)));
    }
    for(const value of [0,0x123456,0xffffff,'#f00','#12ab34','rgb(1,2,3)',NaN,Infinity])assert.equal(controlThemeColor(value,slot),cssColor(value));
    assert.equal(controlThemeColor(0x8000000d,slot),cssColor(0x8000000d),'Highlight is not silently remapped to a button state');
  });
}
test('unknown color slots fail closed instead of constructing arbitrary CSS',()=>{
  for(const slot of ['__proto__','other','x);color:red',null])assert.throws(()=>controlThemeColor(-2147483633,slot),RangeError);
});
test('build includes resource-backed controls in both runtime/export and IDE outputs',()=>{
  const script=read('tools/build.mjs');
  assert.ok(script.includes('src/theme/winui-controls.css'));assert.ok(script.includes('src/theme/winui-ide.css'));
  assert.ok(read('dist/vb6-controls.css').includes('Resource-backed WinUI paint.'));
  assert.ok(read('dist/studio.css').includes('WinUI IDE density and resource states.'));
  assert.doesNotMatch(read('dist/vb6-controls.css'),/WinUI IDE density/);
});

// Native RadioButton resources deliberately do not use Checkbox disabled ink.
test('radio ink and two-layer focus resources are distinct, resettable contracts',()=>{
  assert.equal(WINUI_ALIASES.RadioGlyph,'TextOnAccentFillColorPrimary');
  assert.notEqual(WINUI_ALIASES.RadioGlyph,WINUI_ALIASES.CheckGlyphDisabled);
  for(const theme of Object.values(THEMES)) {
    const css=winuiThemeTokens(theme);
    assert.ok(css.includes('--winui-FocusShadow: '+(theme.family==='fluent'?'0 0 0 1px var(--winui-FocusStrokeColorInner)':'initial')+';'));
    assert.ok(css.includes('--winui-RadioGlyph: '+(theme.family==='fluent'?'var(--winui-TextOnAccentFillColorPrimary)':'initial')+';'));
  }
});

// The notice is embedded in runtime CSS and therefore in every exported bundle.
// Reproduce Windows/non-Git line endings without mutating shared test fixtures.
test('WinUI license embedding is byte-identical for LF, CRLF and lone CR inputs',()=>{
  const lf=read('LICENSES/WinUI.txt').replace(/\r\n?/g,'\n');
  const expected=winuiLicenseCss(lf);
  assert.equal(winuiLicenseCss(),expected);
  assert.equal(winuiLicenseCss(lf.replace(/\n/g,'\r\n')),expected);
  assert.equal(winuiLicenseCss(lf.replace(/\n/g,'\r')),expected);
  assert.doesNotMatch(expected,/\r/);
  assert.ok(expected.includes(lf),'Retain the complete notice, not only its header');
  assert.match(read('.gitattributes'),/^\/LICENSES\/WinUI\.txt text eol=lf$/m);
  for(const invalid of [null,0,{},[]])assert.throws(()=>winuiLicenseCss(invalid),TypeError);
});
