import test from 'node:test';
import assert from 'node:assert/strict';
import {commandPaint,rangeProgress} from '../src/theme/control-paint.js';
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
      ['check-radius','3px'],['mixed-height','2px'],['range-thumb-size','14px'],['range-radius','999px'],
      ['progress-height','6px'],['composite-border-width','1px'],['composite-padding','1px'],['richtext-padding','4px']])
      assert.ok(css.includes(`--detail-${key}: ${value};`),`${id}: ${key}`);
    assert.ok(Object.isFrozen(THEMES[id])&&Object.isFrozen(THEMES[id].colors)&&Object.isFrozen(THEMES[id].tokens));
  }
});
