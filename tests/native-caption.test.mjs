import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {nativeCaptionMode} from '../src/runtime/native-caption.js';
import {normalizeApplicationAppearance} from '../src/theme/application-appearance.js';
const {windowOptions,windowColor}=createRequire(import.meta.url)('../desktop/policy.cjs');
const bridge={capabilities:{applicationCaptions:true}};
test('desktop captions match applications only with an explicit host capability',()=>{
  assert.equal(nativeCaptionMode({},bridge),'application');
  assert.equal(nativeCaptionMode({themeOptions:{systemCaption:true}},bridge),'system');
  for(const host of [undefined,{}, {capabilities:{applicationCaptions:1}}])assert.equal(nativeCaptionMode({},host),'system');
});
test('OS-caption preference is strictly boolean and optional in project snapshots',()=>{
  const base=normalizeApplicationAppearance();assert.equal(Object.hasOwn(base.themeOptions,'systemCaption'),false);
  for(const value of [false,1,'true',null,{}])assert.deepEqual(normalizeApplicationAppearance({themeOptions:{systemCaption:value}}),base);
  assert.equal(normalizeApplicationAppearance({theme:'macos26',themeOptions:{systemCaption:true}}).themeOptions.systemCaption,true);
});
for(const border of [0,1,2,3,4,5])test(`native caption policy preserves BorderStyle ${border} capabilities`,()=>{
  const app=windowOptions({borderStyle:border,captionMode:'application',backgroundColor:'#202020'});
  const os=windowOptions({borderStyle:border,captionMode:'system'});
  assert.equal(app.frame,false);assert.equal(os.frame,border!==0);assert.equal(app.backgroundColor,'#202020');
  for(const key of ['resizable','minimizable','maximizable','closable','skipTaskbar','fullscreenable'])assert.equal(app[key],os[key]);
});
test('desktop appearance accepts only bounded color/mode values, not CSS or BrowserWindow options',()=>{
  for(const color of ['red','url(https://x)','transparent','#fff','#aabbccff',{},null,9])assert.throws(()=>windowColor(color));
  for(const captionMode of ['hidden','__proto__',{},true])assert.throws(()=>windowOptions({captionMode}));
  const options=windowOptions({captionMode:'application',webPreferences:{nodeIntegration:true},titleBarOverlay:true});
  assert.equal(options.webPreferences,undefined);assert.equal(options.titleBarOverlay,undefined);
});

test('OS-caption choice survives project normalization and standalone export without changing authored forms',async()=>{
  const {newProject,normalizeProject}=await import('../src/project/model.js');
  const {exportApplication}=await import('../src/exporter/exporter.js');
  const p=newProject('Caption settings');p.settings.theme='macos26-dark';p.settings.themeOptions={systemCaption:true,reduceMotion:true};
  const before=JSON.stringify(p),copy=normalizeProject(JSON.parse(before)),html=exportApplication(copy,{persist:false});
  const embedded=JSON.parse(html.match(/<script id="vb6-project" type="application\/json">([^]*?)<\/script>/)[1]);
  assert.equal(embedded.settings.themeOptions.systemCaption,true);
  assert.deepEqual(embedded.modules,p.modules);assert.equal(JSON.stringify(p),before);
});
