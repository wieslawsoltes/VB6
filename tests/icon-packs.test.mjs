import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
import {ICON_PACKS,iconPackForTheme,iconPackBody,captionPackSVG} from '../src/theme/icon-packs.js';
import {ICON_NAMES,CONTROL_ICON_TYPES,iconSVG} from '../src/theme/icons.js';
import {THEMES} from '../src/theme/theme.js';import {iconPackTokens} from '../tools/icon-pack-css.mjs';
for(const [id,pack] of Object.entries(ICON_PACKS)){
 test(id+' has an owned glyph for every command and control, with no generic fallbacks',()=>{
  assert.deepEqual(Object.keys(pack.icons).sort(),[...ICON_NAMES].sort());assert.deepEqual(Object.keys(pack.controls).sort(),[...CONTROL_ICON_TYPES].sort());assert.ok(Object.isFrozen(pack.icons));assert.ok(Object.isFrozen(pack.controls));
  assert.equal(new Set(Object.values(pack.icons)).size,ICON_NAMES.length-1,'only documented step/step-into alias');assert.equal(new Set(Object.values(pack.controls)).size,CONTROL_ICON_TYPES.length);
  for(const [name,body] of Object.entries({...pack.icons,...pack.controls})){assert.ok(body.length>50,name);assert.doesNotMatch(body,/<(?:text|image|script|use|foreignObject)|href=|url\(|https?:\/\//i);assert.ok((body.match(/<(?:path|rect|circle)\b/g)||[]).length<80);}
  for(const name of ['close','maximize','minimize','restore','detach','help'])assert.match(captionPackSVG(name,id),/^<svg /);
 });
 test(id+' resolves both appearances, adapts caption masks and has distinct styled geometry',()=>{
  for(const theme of [id,id+'-dark']){assert.equal(iconPackForTheme(theme),id);const css=iconPackTokens(THEMES[theme]);assert.match(css,new RegExp('--vb-icon-'+id+'-display: inline'));assert.match(css,/--vb-icon-classic-display: none/);assert.match(css,/--vb-pack-caption-close: url\("data:image\/svg\+xml,/);}
  for(const other of Object.values(ICON_PACKS).filter(p=>p!==pack))for(const name of ICON_NAMES)assert.notEqual(pack.icons[name],other.icons[name],name+' '+id+' vs '+other.id);
 });
}
test('Classic output retains the original pixel serializer; auto output exposes complete CSS-selected layers',()=>{
 for(const name of ICON_NAMES){const old=iconSVG(name);assert.match(old,/shape-rendering="crispEdges"/);assert.doesNotMatch(old,/theme-icon-layer/);const auto=iconSVG(name,16,false,'auto');assert.equal((auto.match(/class="theme-icon-layer"/g)||[]).length,3);assert.match(auto,/--vb-icon-classic-display,inline/);}
 for(const theme of ['classic','standard','contrast']){assert.equal(iconPackForTheme(theme),'classic');const css=iconPackTokens(THEMES[theme]);assert.match(css,/--vb-icon-classic-display: inline/);assert.match(css,/--vb-pack-caption-close: initial/);}
});
test('unsafe and missing icon names never enter markup or masquerade as another command',()=>{
 for(const name of ['__proto__','constructor','toString','<script>',{},null])for(const pack of Object.keys(ICON_PACKS)){assert.equal(iconPackBody(name,false,pack),ICON_PACKS[pack].icons.missing);assert.doesNotMatch(iconSVG(name,16,false,pack),/<script>/);}
 for(const pack of ['__proto__','unknown',{},null]){assert.throws(()=>iconSVG('save',16,false,pack),/Unknown icon pack/);assert.throws(()=>captionPackSVG('close',pack),/Unknown caption glyph/);}
 for(const size of [-1,0,7,65,Infinity,NaN,'16'])assert.throws(()=>iconSVG('save',size),RangeError);
});
test('packs are offline and do not install fonts or recolor arbitrary authored artwork',()=>{
 const css=fs.readFileSync(new URL('../src/theme/icon-packs.css',import.meta.url),'utf8');assert.doesNotMatch(css,/@font-face|@import|filter:\s*(invert|grayscale)|\.vb-image/);assert.match(css,/forced-colors/);assert.match(css,/GrayText/);
});
