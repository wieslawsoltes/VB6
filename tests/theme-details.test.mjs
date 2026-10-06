import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {THEMES,themeId,colorValue} from '../src/theme/theme.js';
import {PLATFORM_THEMES,canonicalPlatformThemeId} from '../src/theme/platform-themes.js';
import {IDE_THEMES,normalizeIdeAppearance,resolveIdeTheme} from '../src/theme/ide-appearance.js';
import {normalizeApplicationAppearance,resolveApplicationTheme} from '../src/theme/application-appearance.js';
import {iconPackForTheme,iconPackBody,captionPackSVG,ICON_PACKS} from '../src/theme/icon-packs.js';
import {iconSVG} from '../src/theme/icons.js';
import {newProject,normalizeProject} from '../src/project/model.js';
import {exportApplication} from '../src/exporter/exporter.js';
import {themeDetailTokens} from '../tools/theme-detail-css.mjs';
import {renderApplicationThemeTokens} from '../tools/application-theme-css.mjs';
import {renderIdeThemePalettes} from '../tools/ide-theme-css.mjs';
const read=path=>fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('one X11 family is selectable, with light/dark and no duplicate CDE packs',()=>{
 assert.deepEqual(Object.keys(PLATFORM_THEMES),['fluent','fluent-dark','macos26','macos26-dark','x11','x11-dark']);
 assert.deepEqual(Object.keys(IDE_THEMES),Object.keys(THEMES));
 assert.deepEqual(Object.keys(ICON_PACKS),['fluent','macos26','x11']);
 assert.equal(THEMES.x11.name,'X11 — Light');
});
for(const [legacy,id] of [['x11-cde','x11'],['x11-cde-dark','x11-dark']])test('legacy '+legacy+' migrates across preferences, system colors, exports and icons',()=>{
 assert.equal(canonicalPlatformThemeId(legacy),id);assert.equal(themeId(legacy),id);
 const ide=normalizeIdeAppearance({theme:legacy,followSystemTheme:true,reduceMotion:true});
 assert.equal(ide.theme,id);assert.equal(ide.reduceMotion,true);assert.equal(resolveIdeTheme(ide,true).id,'x11-dark');
 const options={followSystemTheme:true,reduceTransparency:true,reduceMotion:true};
 const app=normalizeApplicationAppearance({theme:legacy,themeOptions:options});
 assert.equal(app.theme,id);assert.deepEqual(app.themeOptions,options);assert.equal(resolveApplicationTheme(app,false).id,'x11');
 for(let index=0;index<31;index++)assert.equal(colorValue(0x80000000+index,'',legacy),colorValue(0x80000000+index,'',id));
 const project=newProject();project.settings.theme=legacy;project.settings.themeOptions=options;
 const normalized=normalizeProject(project);assert.equal(normalized.settings.theme,id);assert.deepEqual(normalized.settings.themeOptions,options);
 const html=exportApplication(normalized);assert.match(html,new RegExp('data-vb-theme="'+id+'"'));assert.doesNotMatch(html,/\[data-vb-theme="x11-cde/);
 assert.equal(iconPackForTheme(legacy),'x11');
});
test('old explicit CDE icon pack identifiers map to the single X11 drawing',()=>{
 assert.equal(iconPackBody('close',false,'x11-cde'),iconPackBody('close',false,'x11'));
 assert.equal(captionPackSVG('minimize','x11-cde'),captionPackSVG('minimize','x11'));
 assert.equal(iconSVG('close',16,{pack:'x11-cde'}),iconSVG('close',16,{pack:'x11'}));
});
test('canonicalization does not coerce hostile or inherited identifiers',()=>{
 for(const value of [null,undefined,[],{},'constructor','__proto__','toString',{toString(){throw Error('coercion');}}]){
  assert.equal(themeId(value),'classic');assert.equal(normalizeIdeAppearance({theme:value}).theme,'classic');
 }
});
test('every appearance boundary explicitly resets the same complete detail token set',()=>{
 const names=text=>[...text.matchAll(/--detail-([\w-]+):/g)].map(m=>m[1]);
 const expected=names(themeDetailTokens(THEMES.classic));assert.ok(expected.length>45);
 for(const theme of Object.values(THEMES)){
  const css=themeDetailTokens(theme);assert.deepEqual(names(css),expected);assert.doesNotMatch(css,/undefined|null|url\(/);
  assert.ok(renderApplicationThemeTokens().includes(css));
  if(theme.family)assert.ok(renderIdeThemePalettes().includes(css));
 }
});
test('classic pixel caption artwork remains unmodified and modern glyphs have native identities',()=>{
 const css=read('src/theme/fidelity.css');assert.match(css,/--vb-caption-close:/);assert.match(css,/--vb-caption-restore:/);
 assert.notEqual(captionPackSVG('maximize','macos26'),captionPackSVG('restore','macos26'));
 assert.match(captionPackSVG('maximize','macos26'),/fill="black"/);
 assert.match(captionPackSVG('minimize','x11'),/width="4" height="4"/);
 assert.match(read('src/controls/controls.js'),/'data-caption-action':'minimize'/);
 assert.match(read('src/ide/mdi.js'),/'data-caption-action':'maximize'/);
});
test('shared fidelity sheet is standalone, scoped to owned chrome and accessible without OS fonts',()=>{
 const css=read('src/theme/details.css');assert.doesNotMatch(css,/data-ide-theme|@import|https?:|Segoe MDL2|Wingdings/);
 assert.match(css,/@media\(forced-colors:active\)/);assert.match(css,/GrayText/);assert.match(css,/focus-visible/);
 assert.match(css,/\[hidden\].*display:none!important/);assert.match(css,/data-caption-action="minimize"/);
 assert.match(read('dist/vb6-controls.css'),/Shared fidelity refinements/);
});
