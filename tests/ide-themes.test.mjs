import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {IDE_THEMES,OPTIONAL_IDE_THEMES,IDE_THEME_ATTRIBUTES,ideThemeId,normalizeIdeAppearance,resolveIdeTheme,IdeThemeController,copyIdeThemeAttributes} from '../src/theme/ide-appearance.js';
import {CLASSIC_THEMES,THEMES,SYSTEM_ROLES,themeId,colorValue} from '../src/theme/theme.js';
import {renderIdeThemePalettes} from '../tools/ide-theme-css.mjs';
const ids=['fluent','fluent-dark','macos26','macos26-dark','x11','x11-dark','x11-cde','x11-cde-dark'];
const luminance=hex=>hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4).reduce((a,v,i)=>a+v*[.2126,.7152,.0722][i],0);
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
class Root extends EventTarget {constructor(){super();this.attributes=new Map();this.writes=0;}getAttribute(n){return this.attributes.get(n)??null;}setAttribute(n,v){this.writes++;this.attributes.set(n,v);}removeAttribute(n){this.attributes.delete(n);}}
function environment() {const view=new EventTarget(),media=new EventTarget();media.matches=false;view.CustomEvent=CustomEvent;view.matchMedia=()=>media;return {documentElement:new Root(),defaultView:view,media};}

test('optional IDE profiles share complete immutable application palettes, not settings',()=>{
 assert.deepEqual(Object.keys(OPTIONAL_IDE_THEMES),ids);
 assert.deepEqual(Object.keys(CLASSIC_THEMES),['classic','standard','contrast']);
 assert.deepEqual(Object.keys(THEMES),[...Object.keys(CLASSIC_THEMES),...ids]);
 assert.equal(Object.keys(IDE_THEMES).length,11);
 for(const [id,profile] of Object.entries(OPTIONAL_IDE_THEMES)){
  assert.equal(id,profile.id);assert.ok(Object.isFrozen(profile));assert.ok(Object.isFrozen(profile.colors));assert.ok(Object.isFrozen(profile.tokens));
  assert.deepEqual(Object.keys(profile.colors),Object.keys(THEMES.classic.colors));
  for(const color of Object.values(profile.colors)) assert.match(color,/^#[a-f0-9]{6}$/i);
  for(const role of SYSTEM_ROLES) assert.ok(profile.colors[role]);
  assert.equal(themeId(id),id);assert.equal(THEMES[id],profile);
  assert.equal(colorValue(0x8000000f,'#000000',id),profile.colors.face);
 }
});
for(const id of ids) test(`theme ${id} has readable normal, selected, caption, syntax and status text`,()=>{
 const {colors:c,tokens:t}=IDE_THEMES[id];
 for(const [fg,bg,label] of [[c.text,c.face,'chrome'],[c.windowText,c.window,'content'],[c.selectionText,c.selection,'selection'],[c.titleText,c.title,'caption'],[c.inactiveText,c.inactive,'inactive caption'],[c.infoText,c.info,'tooltip'],[c.keyword,c.window,'keyword'],[c.comment,c.window,'comment'],[t.string,c.window,'string'],[t.error,c.window,'error'],[t.gutterText,t.gutter,'gutter']]){
  const ratio=contrast(fg,bg);assert.ok(ratio>=4.5,`${id} ${label}: ${ratio.toFixed(2)} (${fg}/${bg})`);
 }
});
test('appearance validation preserves valid user choices and rejects malformed input',()=>{
 for(const value of [null,undefined,0,false,[],new Date()]) assert.equal(normalizeIdeAppearance(value).theme,'classic');
 for(const theme of ['__proto__','constructor','toString','fluent;url(x)',{},['fluent'],'FLUENT','']) assert.equal(ideThemeId(theme),'classic');
 for(const id of Object.keys(IDE_THEMES)){
  const input={theme:id,followSystemTheme:true,reduceTransparency:true,reduceMotion:true,editorFont:'Consolas',editorSize:16,codeColors:{keyword:'#123456',invalid:'#ffffff'}};
  const normalized=normalizeIdeAppearance(input);assert.equal(normalized.theme,id);assert.equal(normalized.editorFont,'Consolas');assert.equal(normalized.editorSize,16);
  assert.deepEqual(normalized.codeColors,{keyword:'#123456'});assert.deepEqual(normalizeIdeAppearance(JSON.parse(JSON.stringify(normalized))),normalized);
  assert.equal(input.codeColors.invalid,'#ffffff');
 }
 assert.equal(normalizeIdeAppearance({followSystemTheme:'true',reduceTransparency:1,reduceMotion:'yes'}).followSystemTheme,false);
 assert.equal(normalizeIdeAppearance().theme,'classic');assert.equal(normalizeIdeAppearance().followSystemTheme,false);
});
test('system appearance resolves all light/dark pairs without changing the saved choice',()=>{
 for(const theme of ids){
  const input={theme,followSystemTheme:true},base=theme.replace(/-dark$/,'');
  assert.equal(resolveIdeTheme(input,false).id,base);assert.equal(resolveIdeTheme(input,true).id,base+'-dark');assert.equal(input.theme,theme);
  assert.equal(resolveIdeTheme({theme},true).id,theme);
 }
 for(const theme of Object.keys(CLASSIC_THEMES)) assert.equal(resolveIdeTheme({theme,followSystemTheme:true},true).id,theme);
});
test('root controller makes bounded changes, dispatches events, follows the OS and handles bfcache',()=>{
 const doc=environment(),controller=new IdeThemeController(doc),events=[],legacy=[];
 doc.documentElement.addEventListener('vb-ide-theme-change',e=>events.push(e.detail));
 doc.documentElement.addEventListener('vb-theme-change',e=>legacy.push(e.detail));
 controller.apply({theme:'macos26',followSystemTheme:true});
 assert.equal(doc.documentElement.getAttribute('data-ide-theme'),'macos26');assert.equal(doc.documentElement.getAttribute('data-vb-theme'),'classic');
 const writes=doc.documentElement.writes;controller.apply({theme:'macos26',followSystemTheme:true});assert.equal(doc.documentElement.writes,writes);assert.equal(events.length,1);
 const hide=new Event('pagehide');Object.defineProperty(hide,'persisted',{value:true});doc.defaultView.dispatchEvent(hide);
 doc.media.matches=true;doc.media.dispatchEvent(new Event('change'));assert.equal(doc.documentElement.getAttribute('data-ide-theme'),'macos26-dark');assert.equal(events.at(-1).requestedTheme,'macos26');
 assert.equal(legacy.length,1,'optional changes must not invalidate application drawing surfaces');
 doc.media.matches=false;const show=new Event('pageshow');Object.defineProperty(show,'persisted',{value:true});doc.defaultView.dispatchEvent(show);
 assert.equal(doc.documentElement.getAttribute('data-ide-theme'),'macos26','bfcache restores current OS preference');
 controller.apply({theme:'contrast'});assert.equal(doc.documentElement.getAttribute('data-vb-theme'),'contrast');assert.equal(doc.documentElement.getAttribute('data-ide-theme-family'),'classic');
 controller.apply({theme:'fluent',followSystemTheme:true,reduceTransparency:true,reduceMotion:true});
 assert.equal(doc.documentElement.getAttribute('data-ide-reduce-transparency'),'true');assert.equal(doc.documentElement.getAttribute('data-ide-reduce-motion'),'true');
 doc.defaultView.dispatchEvent(new Event('pagehide'));const count=events.length;doc.media.matches=false;doc.media.dispatchEvent(new Event('change'));assert.equal(events.length,count);
 controller.dispose();
});
test('detached windows copy all theme attributes and remove obsolete values',()=>{
 const doc=environment(),controller=new IdeThemeController(doc),target=new Root();
 controller.apply({theme:'x11-cde-dark',reduceMotion:true});copyIdeThemeAttributes(doc.documentElement,target);
 for(const name of IDE_THEME_ATTRIBUTES) assert.equal(target.getAttribute(name),doc.documentElement.getAttribute(name));
 const writes=target.writes;copyIdeThemeAttributes(doc.documentElement,target);assert.equal(target.writes,writes);
 doc.documentElement.removeAttribute('data-ide-theme');copyIdeThemeAttributes(doc.documentElement,target);assert.equal(target.getAttribute('data-ide-theme'),null);
 controller.dispose();
});
test('generated palette is deterministic, locally rebound and never included in exported runtime CSS',()=>{
 const css=renderIdeThemePalettes();assert.equal(css,renderIdeThemePalettes());assert.equal(fs.readFileSync(new URL('../src/theme/ide-palettes.css',import.meta.url),'utf8'),css);
 assert.equal((css.match(/--vb-sys-30:/g)||[]).length,ids.length);
 assert.ok(css.includes('.classic-menu:not(.runtime-popup)'));
 const runtime=fs.readFileSync(new URL('../dist/vb6-controls.css',import.meta.url),'utf8');assert.ok(!runtime.includes('data-ide-theme'));
 const runtimeJS=fs.readFileSync(new URL('../dist/vb6-runtime.js',import.meta.url),'utf8');assert.ok(!runtimeJS.includes('IdeThemeController'));
 const bundle=fs.readFileSync(new URL('../dist/studio.css',import.meta.url),'utf8');assert.ok(bundle.includes(css));
});
