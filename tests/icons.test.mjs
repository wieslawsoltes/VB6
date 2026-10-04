import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {ICON_ART,CONTROL_ART,ICON_PALETTE} from '../src/theme/icon-art.js';
import {ICON_NAMES,CONTROL_ICON_TYPES,hasIcon,hasControlIcon,iconSVG} from '../src/theme/icons.js';
import {COMMANDS,COMMAND_ICONS,DEFAULT_BARS,decorateCommandItems} from '../src/ide/command-bar-model.js';
import {BASIC_CONTROL_TYPES,EXTENDED_CONTROL_TYPES} from '../src/project/model.js';

test('all command catalog entries and saved default bars resolve real artwork',()=>{
 assert.equal(COMMANDS.length,86);
 for(const c of COMMANDS){assert.ok(hasIcon(c.icon),`${c.id}: ${c.icon}`);assert.notEqual(c.icon,'missing');}
 for(const bar of DEFAULT_BARS)for(const id of bar.items)if(id!=='|')assert.ok(hasIcon(COMMAND_ICONS[id]),`${bar.id}: ${id}`);
 for(const [id,name] of Object.entries(COMMAND_ICONS))assert.ok(hasIcon(name),id);
});
test('all 39 toolbox icons exist and each has distinct artwork',()=>{
 assert.equal(CONTROL_ICON_TYPES.length,39);
 for(const t of [...BASIC_CONTROL_TYPES,...EXTENDED_CONTROL_TYPES])assert.ok(hasControlIcon(t),t);
 assert.equal(new Set(Object.values(CONTROL_ART)).size,CONTROL_ICON_TYPES.length);
});
test('111 named IDE glyphs, with only the documented step compatibility alias',()=>{
 assert.equal(ICON_NAMES.length,111);
 assert.equal(ICON_ART.step,ICON_ART['step-into']);
 assert.equal(new Set(Object.entries(ICON_ART).filter(([id])=>id!=='step').map(([,v])=>v)).size,110);
 assert.ok(Object.isFrozen(ICON_ART)&&Object.isFrozen(CONTROL_ART)&&Object.isFrozen(ICON_NAMES));
});
test('every art cell is an integer pixel in the documented fixed palette',()=>{
 for(const [id,pixels] of [...Object.entries(ICON_ART),...Object.entries(CONTROL_ART)]){
  assert.equal(pixels.length,256,id);assert.ok(pixels.replaceAll('.','').length>0,id);
  for(const c of pixels)assert.ok(c==='.'||Object.hasOwn(ICON_PALETTE,c),`${id}: ${c}`);
 }
});
test('alignment, sizing, debugger and bookmark commands cannot regress to aliases',()=>{
 for(const ids of [
  ['align:left','align:right','align:top','align:bottom','align:centerHorizontal','align:centerVertical'],
  ['align:sameWidth','align:sameHeight','align:sameSize','align:distributeHorizontal','align:distributeVertical'],
  ['align:front','align:back','align:snap','showGrid','lockControls','tabOrder','menuEditor'],
  ['stepInto','stepOver','stepOut','runToCursor','showNextStatement'],
  ['toggleBookmark','nextBookmark','previousBookmark'],['addWatch','quickWatch','watch','locals','immediate','callStack'],
  ['listMembers','listConstants','quickInfo','parameterInfo','completeWord','comment','uncomment'],
 ])assert.equal(new Set(ids.map(id=>ICON_ART[COMMAND_ICONS[id]])).size,ids.length,ids.join(', '));
});
test('every static icon call in the source is registered',()=>{
 const root=new URL('../src/',import.meta.url);
 const walk=dir=>fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):e.name.endsWith('.js')&&!e.name.endsWith('-payload.js')?[path.join(dir,e.name)]:[]);
 for(const file of walk(root.pathname))for(const match of fs.readFileSync(file,'utf8').matchAll(/\bicon\(\s*['"]([^'"]+)['"]/g))assert.ok(hasIcon(match[1]),`${file}: ${match[1]}`);
});
test('SVG has no fonts, resources, scripts or per-pixel DOM nodes',()=>{
 for(const [control,table] of [[false,ICON_ART],[true,CONTROL_ART]])for(const id of Object.keys(table)){
  const svg=iconSVG(id,16,control);
  assert.match(svg,/shape-rendering="crispEdges"/);assert.match(svg,/focusable="false"/);
  assert.match(svg,/class="icon-art"/);assert.match(svg,/class="icon-disabled"/);
  assert.doesNotMatch(svg,/<(?:text|image|use|script)|\b(?:href|onload|onclick)=|url\(/i);
  assert.ok((svg.match(/<path /g)||[]).length<=Object.keys(ICON_PALETTE).length+2,id);
 }
});
test('missing and hostile names do not silently become a form or inherit prototype properties',()=>{
 for(const name of ['absent','toString','constructor','__proto__','<img src=x onerror=alert(1)>',null,undefined,{toString(){throw new Error('Do not coerce');}}]){
  assert.equal(hasIcon(name),false);assert.equal(hasControlIcon(name),false);
  assert.equal(iconSVG(name),iconSVG('missing'));assert.doesNotMatch(iconSVG(name),/onerror/);
 }
 assert.notEqual(iconSVG('absent'),iconSVG('form'));
});
test('icon size validation cannot inject SVG attributes',()=>{
 for(const size of [NaN,Infinity,-1,0,7,65,'16','16" onload="alert(1)'])assert.throws(()=>iconSVG('save',size),RangeError);
 for(const size of [8,12,16,20,24,32,64])assert.match(iconSVG('save',size),new RegExp(`width="${size}" height="${size}"`));
 assert.match(iconSVG('save',15.8),/width="16"/);
});
test('IDE menus get the same glyph as toolbars without mutating descriptors',()=>{
 const action=()=>42;let calls=0;
 const input=[{id:'stepInto',icon:'step',enabled:false,action},null,{label:'lazy',items(){calls++;return [{id:'align:left',checked:true}];}},{id:'custom',icon:'help'}];
 const result=decorateCommandItems(input);
 assert.equal(result[0].icon,'step-into');assert.equal(result[0].action,action);assert.equal(result[0].enabled,false);assert.equal(input[0].icon,'step');assert.equal(result[1],null);
 assert.equal(calls,0);assert.equal(result[2].items()[0].icon,'align-left');assert.equal(calls,1);assert.equal(result[3].icon,'help');
 assert.equal(decorateCommandItems([{id:'toString'}])[0].icon,undefined);
});
test('generated themes reset icon colors at each theme boundary rather than invert descendants',()=>{
 const css=fs.readFileSync(new URL('../src/theme/palette.css',import.meta.url),'utf8');
 assert.doesNotMatch(css,/filter:\s*(invert|grayscale)/);assert.match(css,/icon-disabled/);
 for(const color of Object.keys(ICON_PALETTE))assert.equal(css.split('--vb-icon-'+color+':').length-1,3,color);
});
