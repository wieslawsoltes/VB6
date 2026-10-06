/** Test-only owned assets. Built into reports, never injected into user projects. */
import fs from 'node:fs';
import {applicationThemeGallery} from '../tests/fixtures/application-theme-gallery.mjs';
import {exportApplication,jsonForHTML} from '../src/exporter/exporter.js';
import {ICON_NAMES,CONTROL_ICON_TYPES,iconSVG} from '../src/theme/icons.js';
import {THEMES} from '../src/theme/theme.js';
const root=new URL('../reports/application-themes/fixtures/',import.meta.url);fs.mkdirSync(root,{recursive:true});
fs.writeFileSync(new URL('gallery.html',root),exportApplication(applicationThemeGallery(),{persist:false}));
fs.writeFileSync(new URL('gallery.json',root),JSON.stringify(applicationThemeGallery()));
fs.writeFileSync(new URL('palettes.json',root),JSON.stringify(THEMES));
const mdi=JSON.parse(fs.readFileSync(new URL('../examples/mdi.vb6web',import.meta.url),'utf8'));mdi.settings.renderer='canvas2d';
fs.writeFileSync(new URL('mdi.html',root),exportApplication(mdi,{persist:false}));
const saved=applicationThemeGallery('macos26-dark');saved.settings.themeOptions={followSystemTheme:false,reduceMotion:true,reduceTransparency:true};
fs.writeFileSync(new URL('saved.html',root),exportApplication(saved,{persist:false}));
const css=fs.readFileSync(new URL('../dist/vb6-controls.css',import.meta.url),'utf8');
const glyphs=[...ICON_NAMES.map(name=>({name,control:false})),...CONTROL_ICON_TYPES.map(name=>({name,control:true}))];
const scales=[12,16,24,32,48,64].flatMap(size=>['save','warning'].map(name=>`<span class="scaled pixel-icon" data-size="${size}">${iconSVG(name,size,false,'auto')}</span>`)).join('');
const sheet=glyphs.map(({name,control})=>`<div class="glyph"><span class="pixel-icon" data-name="${name}">${iconSVG(name,24,control,'auto')}</span><label>${name}</label></div>`).join('');
fs.writeFileSync(new URL('icons.html',root),`<!doctype html><html data-vb-theme="classic"><meta charset="utf-8"><title>Owned theme icon packs</title><style>${css}
body{margin:16px;background:var(--vb-window);color:var(--vb-window-text);font:12px system-ui}main{display:grid;grid-template-columns:repeat(8,1fr);gap:6px}.glyph{display:flex;align-items:center;gap:8px;min-height:36px}.glyph label{overflow-wrap:anywhere}.glyph.selected{background:var(--vb-selection);color:var(--vb-selection-text)}</style><h1>151 command and control glyphs</h1><main>${sheet}</main><h2>Vector sizes: 12, 16, 24, 32, 48, 64 pixels</h2><section style="display:flex;align-items:center;gap:12px">${scales}</section><script>globalThis.palettes=${jsonForHTML(THEMES)};</script></html>`);
