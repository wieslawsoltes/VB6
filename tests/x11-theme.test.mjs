import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {THEMES} from '../src/theme/theme.js';
import {themeDetailTokens} from '../tools/theme-detail-css.mjs';
import {renderApplicationThemeTokens} from '../tools/application-theme-css.mjs';

const reference=Object.freeze({
 x11:{face:'#bdbdb3',light:'#f2f2e8',shadow:'#66665c',dark:'#35352d'},
 'x11-dark':{face:'#343c3e',light:'#858f90',shadow:'#151d20',dark:'#0b1214'}
});
const declarations=css=>Object.fromEntries([...css.matchAll(/--([a-z0-9-]+):\s*([^;]*);/g)].map(m=>[m[1],m[2].trim()]));
const appCSS=renderApplicationThemeTokens();
const app=id=>declarations(appCSS.match(new RegExp(`\\[data-vb-theme="${id}"\\] \\{([^}]+)\\}`))[1]);
const luminance=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((sum,v,i)=>sum+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>(Math.max(luminance(a),luminance(b))+.05)/(Math.min(luminance(a),luminance(b))+.05);

for(const [id,expected] of Object.entries(reference)){
 test(`${id}: physical two-tone relief does not invert in dark appearance`,()=>{
  const {colors:c,tokens:t}=THEMES[id];
  for(const [role,value] of Object.entries(expected))assert.equal(c[role],value,role);
  assert.ok(luminance(c.light)>luminance(c.face));assert.ok(luminance(c.face)>luminance(c.shadow));
  assert.equal(t.controlShadow,`inset 2px 2px ${c.light}, inset -2px -2px ${c.shadow}`);
  assert.equal(t.pressedShadow,`inset 2px 2px ${c.shadow}, inset -2px -2px ${c.light}`);
  assert.equal(t.hover,c.face);assert.equal(t.radius,'0px');assert.equal(t.windowRadius,'0px');
  assert.ok(contrast(c.gray,c.window)>=4.5,'Calendar label ink must not use the dark relief edge');
 });
 test(`${id}: hover, disabled, armed and focused paints retain relief`,()=>{
  const {colors:c,tokens:t}=THEMES[id],a=app(id);
  for(const key of ['app-control-shadow','app-hover-shadow','app-disabled-shadow','app-aux-shadow','app-range-thumb-shadow'])assert.equal(a[key],t.controlShadow,key);
  for(const key of ['app-pressed-shadow','app-input-shadow','app-input-focus-shadow','app-aux-pressed-shadow','app-check-mixed-shadow'])assert.equal(a[key],t.pressedShadow,key);
  assert.equal(a['app-duration'],'0s');assert.equal(a['app-input-focus-outline'],`2px solid ${t.focus}`);
  assert.equal(a['app-calendar-label'],c.gray);assert.equal(a['app-disabled-text-shadow'],'1px 1px var(--vb-light)');
  assert.equal(a['app-composite-border'],`${c.shadow} ${c.light} ${c.light} ${c.shadow}`);
 });
 test(`${id}: default ring is separate from the raised/armed face and focus`,()=>{
  const {colors:c,tokens:t}=THEMES[id],d=declarations(themeDetailTokens(THEMES[id]));
  const ring=`0 0 0 2px ${c.face}, -1px -1px 0 3px ${c.shadow}, 1px 1px 0 3px ${c.light}`;
  assert.equal(d['detail-default-shadow'],`${t.controlShadow}, ${ring}`);
  assert.equal(d['detail-default-pressed-shadow'],`${t.pressedShadow}, ${ring}`);
  assert.equal(d['detail-default-outline-style'],'none');assert.equal(d['detail-default-focus-offset'],'-4px');
  assert.equal(d['detail-command-focus-width'],'2px');
 });
 test(`${id}: indicator and menu roles cannot inherit modern accent fills`,()=>{
  const {colors:c,tokens:t}=THEMES[id],a=app(id),d=declarations(themeDetailTokens(THEMES[id]));
  assert.equal(a['app-check-rest-shadow'],t.controlShadow);assert.equal(a['app-check-rest-image'],'none');assert.equal(a['app-check-width'],'0px');
  assert.equal(a['app-check-background'],c.face);assert.equal(a['app-check-mark'],c.selection);assert.equal(a['app-check-shadow'],t.pressedShadow);
  assert.equal(a['app-radio-transform'],'rotate(45deg)');assert.equal(d['detail-radio-mark-radius'],'0px');
  assert.equal(d['detail-check-clip'],'inset(0)');assert.equal(d['detail-check-mark-inset'],'2px');assert.equal(d['detail-check-mark-width'],'auto');
  assert.match(d['detail-indeterminate-fill'],/^repeating-linear-gradient/);
  assert.equal(d['detail-menu-active-background'],c.face);assert.equal(d['detail-menu-active-ink'],c.text);assert.equal(d['detail-menu-selected-shadow'],t.controlShadow);
 });
 test(`${id}: captions and inactive glyphs retain their own lighting and contrast`,()=>{
  const {colors:c,tokens:t}=THEMES[id],d=declarations(themeDetailTokens(THEMES[id]));
  assert.equal(d['detail-button-background'],c.title);assert.equal(d['detail-button-ink'],c.titleText);
  assert.equal(d['detail-close-background'],c.title);assert.equal(d['detail-title-align'],'center');
  assert.equal(d['detail-controls-gap'],'0px');assert.equal(d['detail-close-gap'],'0px');
  assert.equal(d['detail-inactive-caption-ink'],c.inactiveText);assert.equal(d['detail-inactive-button-shadow'],t.controlShadow);
  assert.ok(contrast(c.inactiveText,c.inactive)>=4.5);
 });
}

test('every application boundary resets the same complete X11 role inventory',()=>{
 const keys=Object.keys(app('x11')).sort();
 for(const id of Object.keys(THEMES))assert.deepEqual(Object.keys(app(id)).sort(),keys,id);
 for(const id of ['classic','standard','contrast','fluent','fluent-dark','macos26','macos26-dark']){
  const a=app(id);
  for(const key of ['app-check-rest-shadow','app-check-rest-image','app-check-width','app-input-focus-outline','app-aux-shadow','app-calendar-label','detail-default-shadow','detail-default-pressed-shadow'])assert.equal(a[key],'initial',`${id}: ${key}`);
  assert.equal(a['detail-check-mark-width'],THEMES[id].family==='macos26'?'10px':'8px');assert.equal(a['detail-radio-mark-radius'],'50%');
 }
 assert.equal(fs.readFileSync(new URL('../src/theme/application-palettes.css',import.meta.url),'utf8'),appCSS);
 assert.doesNotMatch(appCSS,/undefined|data-ide-theme|@import|https?:\/\//);
});

test('X11 edge/state checks are owned by both existing cross-engine browser harnesses',()=>{
 const read=name=>fs.readFileSync(new URL('../tools/'+name,import.meta.url),'utf8');
 assert.match(read('browser-theme-tests.py'),/class Themes\(X11IdeChecks, unittest\.TestCase\)/);
 assert.match(read('browser-application-theme-tests.py'),/class ApplicationThemes\(MacOSCompositeChecks, X11ApplicationChecks, unittest\.TestCase\)/);
 const checks=read('x11_theme_checks.py');
 assert.match(checks,/test_x11_integer_dpr_edge_pixels_and_fractional_metrics/);
 assert.match(checks,/for dpr in \(1, 1\.25, 1\.5, 2\)/);
 assert.match(checks,/image\.getpixel/);
 assert.doesNotMatch(checks,/skipTest|expectedFailure|if False/);
});
