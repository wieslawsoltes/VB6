import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {THEMES,CLASSIC_THEMES,themeId,colorValue,applyTheme} from '../src/theme/theme.js';
import {PLATFORM_THEMES} from '../src/theme/platform-themes.js';
import {ApplicationThemeController,APPLICATION_THEME_ATTRIBUTES,normalizeApplicationAppearance,resolveApplicationTheme,copyApplicationTheme,bindApplicationTheme} from '../src/theme/application-appearance.js';
import {normalizeProject,newProject} from '../src/project/model.js';
import {exportApplication} from '../src/exporter/exporter.js';
import {compileWin32} from '../src/native/compiler.js';
import {renderApplicationThemeTokens} from '../tools/application-theme-css.mjs';
import {applicationThemeGallery} from './fixtures/application-theme-gallery.mjs';
class Root extends EventTarget{
 constructor(document){super();this.ownerDocument=document;this.attributes=new Map();this.writes=0;}
 getAttribute(n){return this.attributes.get(n)??null;}setAttribute(n,v){this.writes++;this.attributes.set(n,v);}removeAttribute(n){this.attributes.delete(n);}
 closest(){return this;}
}
function environment(){const view=new EventTarget(),media=new EventTarget();media.matches=false;view.matchMedia=()=>media;view.CustomEvent=CustomEvent;const doc={defaultView:view};doc.documentElement=new Root(doc);return {doc,view,media,root:new Root(doc)};}
const ids=Object.keys(PLATFORM_THEMES);
test('application themes share the immutable complete platform registry, with Classic as default',()=>{
 assert.equal(Object.keys(THEMES).length,9);assert.deepEqual(Object.keys(CLASSIC_THEMES),['classic','standard','contrast']);
 assert.deepEqual(normalizeApplicationAppearance(),{theme:'classic',themeOptions:{followSystemTheme:false,reduceTransparency:false,reduceMotion:false}});
 for(const id of ids){assert.equal(THEMES[id],PLATFORM_THEMES[id]);assert.ok(Object.isFrozen(THEMES[id].colors));assert.equal(themeId(id),id);}
});
test('application preference normalization rejects malformed identifiers and does not import IDE settings',()=>{
 for(const value of [null,undefined,0,false,[],new Date()])assert.equal(normalizeApplicationAppearance(value).theme,'classic');
 for(const theme of ['__proto__','constructor','toString','fluent;url(x)',{},['fluent'],{toString(){throw Error('coercion');}}])assert.equal(normalizeApplicationAppearance({theme}).theme,'classic');
 const input={theme:'macos26',followSystemTheme:true,reduceMotion:true,themeOptions:{followSystemTheme:'true',reduceTransparency:true,reduceMotion:1,unsafe:'x'}};
 assert.deepEqual(normalizeApplicationAppearance(input),{theme:'macos26',themeOptions:{followSystemTheme:false,reduceTransparency:true,reduceMotion:false}});assert.equal(input.themeOptions.unsafe,'x');
});
for(const id of ids)test('application '+id+' preserves authored settings and exports its independent skin',()=>{
 const p=applicationThemeGallery(id);p.settings.themeOptions={followSystemTheme:true,reduceTransparency:true,reduceMotion:true};const before=JSON.stringify(p),copy=normalizeProject(JSON.parse(before));
 assert.equal(copy.settings.theme,id);assert.deepEqual(copy.settings.themeOptions,p.settings.themeOptions);assert.deepEqual(copy.modules,p.modules);
 const html=exportApplication(copy);assert.ok(html.includes('data-vb-theme="'+id+'"'));assert.ok(html.includes('data-vb-theme="'+id.replace(/-dark$/,'')+'"'));
 const embedded=JSON.parse(html.match(/<script id="vb6-project" type="application\/json">([^]*?)<\/script>/)[1]);assert.deepEqual(embedded.settings,p.settings);assert.equal(JSON.stringify(p),before);
 assert.doesNotMatch(html,/data-ide-theme|class IdeThemeController/);assert.match(html,/class ApplicationThemeController/);
 for(let slot=0;slot<31;slot++)assert.match(colorValue(0x80000000+slot,'',id),/^#[0-9a-f]{6}$/i);
 assert.equal(colorValue(0x336699,'',id),'#996633');
 const base=id.replace(/-dark$/,'');assert.equal(resolveApplicationTheme(p.settings,false).id,base);assert.equal(resolveApplicationTheme(p.settings,true).id,base+'-dark');
});
test('old snapshots do not acquire appearance settings merely by loading',()=>{
 const p=newProject();assert.equal(Object.hasOwn(normalizeProject(p).settings,'theme'),false);assert.equal(Object.hasOwn(normalizeProject(p).settings,'themeOptions'),false);
 for(const id of Object.keys(CLASSIC_THEMES))assert.equal(resolveApplicationTheme({theme:id,themeOptions:{followSystemTheme:true}},true).id,id);
});
test('controller is local, bounded, idempotent and follows system appearance without rewriting settings',()=>{
 const e=environment(),a=new ApplicationThemeController(e.root),other=new Root(e.doc),b=new ApplicationThemeController(other),events=[];
 e.root.addEventListener('vb-theme-change',event=>events.push(event.detail));
 const requested={theme:'macos26',themeOptions:{followSystemTheme:true,reduceTransparency:true}};
 a.apply(requested);b.apply({theme:'x11-dark'});const writes=e.root.writes;a.apply(requested);assert.equal(e.root.writes,writes);assert.equal(events.length,1);
 e.media.matches=true;e.media.dispatchEvent(new Event('change'));assert.equal(e.root.getAttribute('data-vb-theme'),'macos26-dark');assert.equal(other.getAttribute('data-vb-theme'),'x11-dark');assert.equal(requested.theme,'macos26');assert.equal(e.doc.documentElement.getAttribute('data-vb-theme'),null);
 a.apply({theme:'macos26-dark',themeOptions:{reduceMotion:true}});assert.equal(e.root.getAttribute('data-vb-reduce-transparency'),'false');assert.equal(e.root.getAttribute('data-vb-reduce-motion'),'true');
 e.media.matches=false;e.view.dispatchEvent(Object.assign(new Event('pagehide'),{persisted:true}));e.view.dispatchEvent(Object.assign(new Event('pageshow'),{persisted:true}));assert.equal(a.disposed,false);
 a.dispose();a.dispose();const stopped=e.root.writes;a.apply(requested);e.media.dispatchEvent(new Event('change'));assert.equal(e.root.writes,stopped);b.dispose();
});
test('transient menu/list binding mirrors the closest host and releases its listener',()=>{
 const e=environment(),a=new ApplicationThemeController(e.root),popup=new Root(e.doc);a.apply({theme:'fluent-dark',themeOptions:{reduceMotion:true}});
 const close=bindApplicationTheme(e.root,popup);for(const key of APPLICATION_THEME_ATTRIBUTES)assert.equal(popup.getAttribute(key),e.root.getAttribute(key));
 a.apply({theme:'x11'});assert.equal(popup.getAttribute('data-vb-theme'),'x11');close();a.apply({theme:'classic'});assert.equal(popup.getAttribute('data-vb-theme'),'x11');
 e.root.removeAttribute('data-vb-reduce-motion');copyApplicationTheme(e.root,popup);assert.equal(popup.getAttribute('data-vb-reduce-motion'),null);a.dispose();
});
test('standalone overrides cannot inject HTML attributes and have consistent initial metadata',()=>{
 const p=newProject();p.settings.theme='macos26-dark';const html=exportApplication(p,{theme:'" onload=alert(1)'});assert.ok(html.startsWith('<!doctype html>\n<html lang="en" data-vb-theme="classic">'));assert.match(html,/<meta name="color-scheme" content="light">/);
 assert.equal(p.settings.theme,'macos26-dark');
});
test('application CSS generation is deterministic and resets every skin token at nested classic boundaries',()=>{
 const css=renderApplicationThemeTokens();assert.equal(css,renderApplicationThemeTokens());assert.equal(fs.readFileSync(new URL('../src/theme/application-palettes.css',import.meta.url),'utf8'),css);
 const classic=css.match(/\[data-vb-theme="classic"\]\s*\{([^}]+)\}/)[1];for(const key of ['radius','window-radius','backdrop','radio-transform','focus-style','window-button-radius'])assert.ok(classic.includes('--app-'+key+': initial;'));
 assert.doesNotMatch(css,/undefined|data-ide-theme|@import|https?:\/\//);
});
test('native AOT explicitly diagnoses a browser-only skin instead of silently dropping it',()=>{
 for(const theme of ids){const p=newProject();p.settings.theme=theme;assert.throws(()=>compileWin32(p),/Optional application theme .* requires the HTML or Electron desktop target/);}
});
