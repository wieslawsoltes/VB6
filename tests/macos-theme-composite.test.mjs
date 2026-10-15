import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {THEMES} from '../src/theme/theme.js';
import {MACOS_REFERENCE} from '../src/theme/macos-reference-metrics.js';
import {themeDetailTokens} from '../tools/theme-detail-css.mjs';
const read = path => fs.readFileSync(new URL('../'+path,import.meta.url),'utf8');
const measurements=JSON.parse(read('tests/fixtures/macos26-inactive-measurements.json'));
const rgbaHex=rgba=>'#'+rgba.map(x=>x.toString(16).padStart(2,'0')).join('');
const roles=['inactive-command-fill','inactive-command-ink','inactive-check-fill','inactive-range-fill',
  'inactive-progress-fill','inactive-segment-fill','state-check-fill','state-check-ink','state-progress-fill',
  'popup-button-height','popup-button-align','popup-button-shadow','popup-button-padding','popup-button-arrow-fill',
  'popup-button-arrow-right','popup-button-chevron-visibility','popup-button-chevron-content','popup-button-disabled','popup-button-pressed',
  'strip-border','strip-left','strip-top','strip-width','strip-padding','strip-fill','strip-column','strip-radius','strip-separator-content','strip-separator'];
for(const theme of Object.values(THEMES))test(`${theme.id}: inactive/popup/segment roles reset at every boundary`,()=>{
  const css=themeDetailTokens(theme);
  for(const key of roles){
    const matches=[...css.matchAll(new RegExp(`--detail-${key}: ([^;]+);`,'g'))];
    assert.equal(matches.length,1,key);
    if(theme.family==='macos26')assert.notEqual(matches[0][1],'initial');
    else assert.equal(matches[0][1],'initial',key);
  }
});
test('non-key paint agrees with independent AppKit samples, not browser screenshots',()=>{
  assert.equal(measurements.artifact,11954783994);
  assert.ok(measurements.inactiveEnvironment.length===4);
  assert.ok(measurements.inactiveEnvironment.every(e=>e.applicationActive&&!e.keyWindow&&e.otherWindowIsKey));
  for(const scheme of ['light','dark']){
    const m=measurements.measurements[scheme],expected=MACOS_REFERENCE[scheme];
    for(const [name,key] of [['default-button','neutral'],['check-on','inactiveCheck'],['slider','inactiveRange'],['segmented-control','inactiveSegment']]){
      assert.equal(rgbaHex(m[name].rgba),expected[key]);
      assert.match(m[name].sourceSHA256,/^[a-f0-9]{64}$/);assert.ok(m[name].matchingPixels>100);
    }
    assert.deepEqual(m.progress.rgba,[170,170,170,255]);
  }
});
test('state paint applies at the inactive form, not through nested app descendants',()=>{
  const css=read('src/theme/application-themes.css');
  const rule=/\.vb-inactive \{([^}]+)\}/.exec(css)?.[1];assert.ok(rule);
  for(const name of ['default-fill','state-check-fill','range-accent','state-progress-fill','tab-active-fill'])assert.ok(rule.includes('--detail-'+name+':'));
  assert.doesNotMatch(rule,/background:|color:|filter:|opacity:/);
  assert.match(read('src/theme/winui-controls.css'),/var\(--winui-check-fill,var\(--detail-state-check-fill,var\(--app-check-background/);
});
test('segmented geometry uses live custom properties and retains vertical/notebook layout branches',()=>{
  const tabs=read('src/controls/tabs.js');
  assert.ok(tabs.includes("view.type === 'TabStrip' && orientation === 0"));
  assert.ok(tabs.includes('var(--detail-strip-column, minmax(0, 1fr))'));
  assert.ok(tabs.includes('var(--detail-strip-width, 100%)'));
  const css=read('src/theme/application-themes.css');
  assert.match(css,/@media\(forced-colors:active\)\s*\{\s*\[data-vb-theme-family="macos26"\] \{--detail-strip-width:100%;/);
});
test('popup double chevrons do not replace input/selection logic or leak into simple combos',()=>{
  const css=read('src/theme/application-themes.css');
  assert.ok(css.includes('.vb-control.vb-classic-combo:not(.simple)>.vb-combo-field[readonly]'));
  assert.ok(css.includes('content:var(--detail-popup-button-chevron-content,none)'));
  assert.ok(css.includes('pointer-events:none;'));
  assert.ok(read('tools/browser-application-theme-tests.py').includes('class ApplicationThemes(MacOSCompositeChecks,'));
});
