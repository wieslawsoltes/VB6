import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {iconSVG} from '../src/theme/icons.js';
const read=p=>fs.readFileSync(new URL('../'+p,import.meta.url),'utf8');
const css=read('src/theme/fidelity.css');
const reference=JSON.parse(read('tests/fixtures/caption-glyphs.json'));
for(const [name,rows] of Object.entries(reference))test(`caption ${name} uses the exact integer-cell mask contract`,()=>{
 const encoded=css.match(new RegExp(`--vb-caption-${name}:url\\("data:image/svg\\+xml,([^"\\n]+)"\\)`))?.[1];
 assert.ok(encoded,'Missing embedded mask');const svg=decodeURIComponent(encoded);
 assert.match(svg,/width="10" height="10" viewBox="0 0 10 10"/);
 assert.doesNotMatch(svg,/<(?:text|image|use|script)|\b(?:href|onload|onclick)=|stroke=/i);
 const actual=Array.from({length:10},()=>Array(10).fill('.'));
 const d=svg.match(/<path d="([^"]+)"/)?.[1];assert.ok(d);
 let parsed='';for(const m of d.matchAll(/M(\d+) (\d+)h(\d+)v1h-(\d+)z/g)){
  parsed+=m[0];const [x,y,w,reverse]=m.slice(1).map(Number);assert.equal(w,reverse);assert.ok(w>0&&x+w<=10&&y<10);
  for(let i=0;i<w;i++){assert.equal(actual[y][x+i],'.');actual[y][x+i]='#';}
 }
 assert.equal(parsed,d,'Non-integer drawing instruction');assert.deepEqual(actual.map(r=>r.join('')),rows);
});
test('caption commands retain the public 16px atlas',()=>{
 for(const name of ['close','maximize','minimize','restore'])assert.match(iconSVG(name,16),/viewBox="0 0 16 16"/);
 assert.doesNotMatch(css,/@font-face|url\(["']?https?:\/\//);
});
test('same local fidelity rules are built into IDE, reusable controls and exported applications',()=>{
 for(const name of ['dist/studio.css','dist/vb6-controls.css','dist/VB6-Studio-Web.html','dist/examples/calculator.html']){
  const text=read(name);assert.ok(text.includes(css),name);
  if(name.endsWith('.css'))assert.equal(text.split(css).length-1,1);
 }
});
test('caption art is scoped, unscaled and respects native forced-color focus paths',()=>{
 assert.match(css,/> \.icon:is\(\[data-icon=close\]/);assert.match(css,/width:10px!important;height:10px!important/);
 assert.match(css,/@media \(forced-colors:active\)/);assert.match(css,/background:ButtonText/);
 assert.match(css,/disabled::before/);assert.doesNotMatch(css,/outline:none|outline:0!important/);
 assert.match(css,/command-bar:not\(\.command-bar-vertical\):not\(\.command-bar-floating\)/);
});

test('classic selectors retain native elements while replacing engine-specific chrome',()=>{
 assert.match(css,/appearance:none;-webkit-appearance:none/);
 assert.match(css,/background-image:linear-gradient\(var\(--vb-text\)/);
 assert.match(css,/right 6px top 8px/);
});
test('horizontal toolbar grip width agrees with its flex basis',()=>{
 assert.match(css,/command-bar:not\(\.command-bar-vertical\):not\(\.command-bar-floating\) > \.toolbar-grip \{width:6px\}/);
 assert.match(read('src/ide/command-bars.css'),/flex:0 0 6px/);
});
