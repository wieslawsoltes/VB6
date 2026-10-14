import test from 'node:test';
import assert from 'node:assert/strict';
import {commandPaint,groupPaint,rangeProgress} from '../src/theme/control-paint.js';
import {THEMES,cssColor} from '../src/theme/theme.js';
import {themeDetailTokens} from '../tools/theme-detail-css.mjs';

const face=-2147483633,windowText=-2147483640,buttonText=-2147483630;
for(const [name,back,fore] of [
  ['signed system pair',face,windowText],['button text role',face,buttonText],
  ['unsigned system pair',face>>>0,windowText>>>0],['numeric VB values',String(face),String(buttonText)],
])test(`macOS command paint: ${name} follows local state variables`,()=>{
  assert.deepEqual(commandPaint(back,fore),{
    background:`var(--command-fill, ${cssColor(back)})`,color:`var(--command-ink, ${cssColor(fore,'#000000')})`,
  });
});
for(const [name,back,fore] of [
  ['authored RGB pair',0x336699,0xffffff],['RGB matching a system color',0xc0c0c0,0],
  ['authored foreground',face,0xff00],['authored background',0x336699,windowText],
  ['different background role',-2147483643,windowText],['different foreground role',face,-2147483646],
  ['overflow is not a system-color alias',0x18000000f,windowText],['fractional value',face+.5,windowText],
  ['missing background',undefined,windowText],['missing foreground',face,undefined],
])test(`macOS command paint preserves ${name}`,()=>{
  assert.deepEqual(commandPaint(back,fore),{background:cssColor(back),color:cssColor(fore,'#000000')});
});

for(const [minimum,maximum,value,expected] of [
  [0,100,35,'35%'],[-100,100,0,'50%'],[10,30,20,'50%'],[0,100,-1,'0%'],[0,100,101,'100%'],
  [5,5,5,'0%'],[10,0,5,'0%'],[0,1,.125,'12.5%'],['0','20','5','25%'],
  [NaN,100,35,'0%'],[0,Infinity,35,'0%'],[0,100,NaN,'0%'],[0,100,Infinity,'0%'],
  [-Number.MAX_VALUE,Number.MAX_VALUE,0,'50%'],[0,Number.MIN_VALUE,Number.MIN_VALUE,'100%'],
])test(`range paint ${minimum}..${maximum} at ${value} is ${expected}`,()=>assert.equal(rangeProgress(minimum,maximum,value),expected));

test('range paint remains finite, bounded and monotonic across representable scales',()=>{
  for(const scale of [Number.MIN_VALUE,1e-200,1e-10,1,1e10,1e200,Number.MAX_VALUE/2]){
    let previous=-1;
    for(let step=0;step<=100;step++){
      const percentage=parseFloat(rangeProgress(-scale,scale,(-1+step/50)*scale));
      assert.ok(Number.isFinite(percentage)&&percentage>=0&&percentage<=100);
      assert.ok(percentage>=previous);previous=percentage;
    }
  }
});

const macOnly=['command-fill','command-hover','command-pressed','command-disabled','command-ink',
  'default-fill','default-ink','default-pressed','default-outline-width','default-focus-ink','command-focus-inset','command-focus-width',
  'check-size','check-fill','check-border-width','check-gap','check-mark-width','check-mark-height','check-mark-left','check-mark-top','radio-dot-inset','check-disabled-fill','check-disabled-mark',
  'frame-fill','frame-legend-fill','frame-border','command-pointer-focus-display','frame-radius','inactive-selection','inactive-selection-ink','segment-fill','segment-active','segment-ink',
  'range-thumb-height','range-track-height','progress-padding','progress-border-width','tab-active-ink',
  'combo-arrow-radius','combo-arrow-inset','combo-arrow-width','combo-padding-right','stepper-fill','stepper-radius','stepper-border',
  'tree-row-selection','tree-row-selection-ink','tree-label-selection','tree-label-selection-ink',
  'check-radius','check-border','check-shadow','mixed-width','mixed-height','mixed-left','mixed-top',
  'composite-border-width','composite-padding','richtext-padding','field-overflow','control-focus-width','field-border','field-focus-shadow',
  'frame-shadow','status-border','menu-material','menu-backdrop','popup-radius','popup-padding','popup-item-radius','range-radius',
  'range-thumb','range-thumb-size','range-thumb-offset','range-thumb-border','range-thumb-shadow','range-track-border',
  'range-track','range-accent','progress-radius','progress-border','progress-align','progress-height','progress-track',
  'tab-radius','tab-active-fill','tab-border','tab-idle-fill','tab-header-fill','calendar-collapse','calendar-spacing','calendar-header','calendar-header-ink',
  'calendar-day-radius','grid-border','grid-focus-style','menu-check-background','scroll-arrow-display','scroll-border','scroll-thumb-border','scroll-thumb-shadow','scroll-thumb-radius','scroll-thumb-cross','scroll-thumb-inset',
  'tree-toggle-size','tree-toggle-border','tree-toggle-fill','tree-disclosure','tree-disclosure-ink',
  'mnemonic-decoration','toolbar-fill','toolbar-border','combo-fill','combo-ink','dialog-actions'];
for(const theme of Object.values(THEMES))test(`${theme.id} locally binds or resets every macOS component token`,()=>{
  const css=themeDetailTokens(theme);
  const tokens=new Map([...css.matchAll(/--detail-([\w-]+): ([^\n]+);/g)].map(([,name,value])=>[name,value]));
  assert.equal([...css.matchAll(/--detail-/g)].length,tokens.size,'no duplicate token declarations');
  for(const key of macOnly){
    assert.ok(tokens.has(key),key);
    if(theme.family==='macos26')assert.notEqual(tokens.get(key),'initial',key);
    else assert.equal(tokens.get(key),'initial',`${key} must not leak across nested palettes`);
  }
  assert.doesNotMatch(css,/undefined|NaN|Infinity/);
  assert.equal(css,themeDetailTokens(theme));
});

test('macOS uses distinct component shapes rather than a universal window radius',()=>{
  for(const id of ['macos26','macos26-dark']){
    const css=themeDetailTokens(THEMES[id]);
    for(const [key,value] of [['button-width','12px'],['button-height','12px'],['controls-gap','8px'],
      ['check-radius','5px'],['mixed-height','2px'],['range-thumb-size','20px'],['range-radius','999px'],
      ['progress-height','8px'],['composite-border-width','1px'],['composite-padding','1px'],['richtext-padding','4px']])
      assert.ok(css.includes(`--detail-${key}: ${value};`),`${id}: ${key}`);
    assert.ok(Object.isFrozen(THEMES[id])&&Object.isFrozen(THEMES[id].colors)&&Object.isFrozen(THEMES[id].tokens));
  }
});

test('group paint adapts only ordinary system colors, including its legend',()=>{
 assert.deepEqual(groupPaint(face,windowText),{
  background:`var(--detail-frame-fill, ${cssColor(face)})`,
  legendBackground:`var(--detail-frame-legend-fill, ${cssColor(face)})`
 });
 for(const [back,fore] of [[0xffffff,0],[face,0x112233],[0xc0c0c0,windowText],[-2147483643,windowText]]){
  assert.deepEqual(groupPaint(back,fore),{background:cssColor(back),legendBackground:cssColor(back)});
 }
});

import fs from 'node:fs';
import {MACOS_REFERENCE,macosSystemColors} from '../src/theme/macos-reference-metrics.js';
import {fontFamily} from '../src/theme/theme.js';
import {comboPaint} from '../src/theme/control-paint.js';
const nativeMeasurements=JSON.parse(fs.readFileSync(new URL('./fixtures/macos26-native-measurements.json',import.meta.url),'utf8'));
const rgbaHex=value=>'#'+value.slice(0,3).map(v=>Math.round(v*255).toString(16).padStart(2,'0')).join('');
test('macOS semantic colors agree with recorded active AppKit sRGB measurements',()=>{
  assert.equal(MACOS_REFERENCE.revision,nativeMeasurements.captureRevision);
  assert.deepEqual(nativeMeasurements.operatingSystemVersion,[26,6,2]);
  assert.ok(nativeMeasurements.environment.every(v=>v.applicationActive&&v.keyWindow));
  for(const scheme of ['light','dark']){
    const measured=nativeMeasurements.colorsSRGB[scheme],m=MACOS_REFERENCE[scheme],c=macosSystemColors(scheme);
    assert.equal(m.background,rgbaHex(measured.windowBackground));
    assert.equal(m.accent,rgbaHex(measured.accent));
    assert.equal(m.selectedContent,rgbaHex(measured.selection));
    assert.equal(c.selection,m.selectedContent);assert.notEqual(c.selection,m.accent,'content selection is not command accent');
    assert.equal(THEMES[scheme==='dark'?'macos26-dark':'macos26'].colors.face,m.background);
  }
  assert.throws(()=>macosSystemColors('invalid'),RangeError);
});
test('macOS reference metrics and all descendant records are immutable',()=>{
  function verify(value){if(value&&typeof value==='object'){assert.ok(Object.isFrozen(value));for(const child of Object.values(value))verify(child);}}
  verify(MACOS_REFERENCE);
  assert.throws(()=>{MACOS_REFERENCE.light.accent='#ff0000';},TypeError);
});
test('explicit system font aliases resolve without embedding a font or rewriting authored family names',()=>{
  assert.match(fontFamily('-apple-system'),/^-apple-system, BlinkMacSystemFont/);
  assert.equal(fontFamily('system-ui'),'system-ui');assert.equal(fontFamily('MONOSPACE'),'monospace');
  assert.match(fontFamily('Helvetica Neue'),/"Helvetica Neue"/);
  assert.doesNotMatch(fontFamily('a";color:red'),/";color:red/);
});
test('list-only popup material follows standard OLE roles without recoloring authored values',()=>{
  const window=-2147483643;
  assert.equal(comboPaint(window,windowText,2),`var(--detail-popup-button-fill, ${cssColor(window)})`);
  assert.equal(comboPaint(window,buttonText,'2'),`var(--detail-popup-button-fill, ${cssColor(window)})`);
  for(const [back,fore,style] of [[window,windowText,0],[window,windowText,1],[0xffffff,windowText,2],[window,0,2],[face,windowText,2]])assert.equal(comboPaint(back,fore,style),cssColor(back));
});
test('native paint layer corrections and inner sizes reset outside macOS',()=>{
  const names=['composite-radius','label-padding','mnemonic-image','check-edge-image','field-shadow','command-border-block','command-background-clip','command-corner-radius',
    'combo-arrow-position','combo-arrow-top','combo-arrow-transform','combo-arrow-height','popup-button-fill',
    'combo-chevron-size','combo-chevron-edge','combo-chevron-zero','combo-chevron-transform','stepper-flex','stepper-width',
    'stepper-align','stepper-justify','stepper-horizontal-width','stepper-horizontal-height'];
  for(const p of Object.values(THEMES))for(const name of names){
    const value=new RegExp(`--detail-${name}: ([^;]+);`).exec(themeDetailTokens(p))?.[1];
    assert.ok(value,name);if(p.family==='macos26')assert.notEqual(value,'initial');else assert.equal(value,'initial');
  }
});
