import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {THEMES} from '../src/theme/theme.js';
import {MACOS_REFERENCE} from '../src/theme/macos-reference-metrics.js';
import {MACOS26_RESOURCE_NAMES,MACOS26_RESOURCES} from '../src/theme/macos26-resources.js';
import {MACOS26_TOKEN_NAMES,macos26ThemeTokens,macos26AccessibilityCss} from '../tools/macos26-theme-css.mjs';
import {renderApplicationThemeTokens} from '../tools/application-theme-css.mjs';
import {renderIdeThemePalettes} from '../tools/ide-theme-css.mjs';

const read = path => fs.readFileSync(new URL('../' + path,import.meta.url),'utf8');
const properties = css => new Map([...css.matchAll(/--macos26-([\w-]+):\s*([^;]+);/g)].map(([,name,value]) => [name,value]));

test('every application palette binds or invalidates the complete macOS semantic namespace', () => {
  assert.equal(MACOS26_TOKEN_NAMES.length,new Set(MACOS26_TOKEN_NAMES).size);
  for (const theme of Object.values(THEMES)) {
    const css = macos26ThemeTokens(theme), values = properties(css);
    assert.deepEqual([...values.keys()],MACOS26_TOKEN_NAMES,theme.id);
    assert.equal([...css.matchAll(/--macos26-[\w-]+:/g)].length,values.size,'No duplicate local declaration');
    if (theme.family !== 'macos26') assert.ok([...values.values()].every(value => value === 'initial'),theme.id);
    else for (const role of MACOS26_RESOURCE_NAMES) assert.equal(values.get(role),MACOS26_RESOURCES[theme.scheme][role],theme.id + ':' + role);
    assert.doesNotMatch(css,/undefined|NaN|Infinity/);
    assert.equal(css,macos26ThemeTokens(theme));
  }
});

test('regular compatibility painter keeps recorded corners, padding, accent and window-role separation', () => {
  for (const id of ['macos26','macos26-dark']) {
    const theme = THEMES[id], values = properties(macos26ThemeTokens(theme));
    assert.equal(values.get('RegularControlRadius'),'6px / 8px');
    assert.equal(values.get('RegularControlPadding'),'4px 9px');
    assert.equal(values.get('LargeControlRadius'),'999px');
    assert.equal(values.get('ExtraLargeControlRadius'),'999px');
    assert.equal(values.get('ButtonBackground'),MACOS_REFERENCE[theme.scheme].neutral);
    assert.equal(values.get('controlAccentColor'),'#007aff');
    assert.notEqual(values.get('controlAccentColor'),values.get('selectedContentBackgroundColor'));
    assert.equal(values.get('AccentButtonBackground'),'var(--macos26-controlAccentColor)');
    assert.equal(values.get('AccentButtonForeground'),'var(--macos26-selectedTextColor)');
    assert.match(values.get('DestructiveButtonBackground'),/10%, transparent/,'Destructive tint is secondary to the default action');
  }
});

test('all derived resources resolve locally without a URL, foreign palette or unbound token', () => {
  for (const theme of Object.values(THEMES)) {
    const css = macos26ThemeTokens(theme);
    for (const [,name] of css.matchAll(/var\(--macos26-([\w-]+)\)/g)) assert.ok(MACOS26_TOKEN_NAMES.includes(name),name);
    assert.doesNotMatch(css,/https?:|url\(|@import|--winui-/);
  }
  for (const source of ['src/theme/macos26-controls.css','src/theme/macos26-ide.css']) {
    const css = read(source);
    assert.doesNotMatch(css,/https?:|@import|@font-face|will-change:/);
    for (const [,name] of css.matchAll(/var\(--macos26-([\w-]+)/g)) assert.ok(MACOS26_TOKEN_NAMES.includes(name),source + ': ' + name);
  }
  assert.doesNotMatch(read('src/theme/macos26-controls.css'),/data-ide-theme|data-vb-theme-family/,'Runtime behavior is token-scoped, not inherited from an IDE ancestor');
});

test('accessibility is rebound on local roots and IDE portal palettes', () => {
  const app = macos26AccessibilityCss('application'), ide = macos26AccessibilityCss('ide');
  assert.doesNotMatch(app,/data-ide-|\.designer|\.source-/);
  assert.match(app,/data-vb-reduce-transparency="true"/);
  assert.match(app,/data-vb-increase-contrast="true"/);
  assert.match(ide,/data-ide-increase-contrast="true"/);
  assert.match(ide,/\.classic-menu:not\(\.runtime-popup\)/);
  assert.match(ide,/\.classic-tooltip:not\(\.runtime-tooltip\)/);
  for (const css of [app,ide]) {
    for (const condition of ['prefers-reduced-transparency:reduce','prefers-reduced-motion:reduce','prefers-contrast:more','forced-colors:active','@supports not']) assert.ok(css.includes(condition),condition);
    for (const name of ['Sidebar','Inspector','Titlebar','Toolbar','Menu','Popover','Sheet','Hud']) assert.ok(css.includes(`--macos26-${name}Material: var(--macos26-${name}Opaque);`),name);
    assert.ok(css.includes('--macos26-IndeterminateAnimation: none;'));
    assert.ok(css.includes('--macos26-SwitchTrackShadow: inset 0 0 0 1px ButtonText;'));
    for (const key of properties(css).keys()) assert.ok(MACOS26_TOKEN_NAMES.includes(key),key);
  }
  assert.throws(() => macos26AccessibilityCss('inherited'),TypeError);
});

test('indeterminate paint is bounded and its reduced-motion frame cannot look complete', () => {
  for (const id of ['macos26','macos26-dark']) {
    const values = properties(macos26ThemeTokens(THEMES[id]));
    assert.equal(values.get('IndeterminateWidth'),'30%');
    assert.equal(values.get('IndeterminateRestTransform'),'translateX(116.6667%)');
    const width = parseFloat(values.get('IndeterminateWidth'));
    assert.ok(width > 0 && width < 100);
    assert.ok(Math.abs((116.6667 / 100 * width) - (100 - width) / 2) < .001);
  }
  assert.match(read('src/theme/macos26-controls.css'),/@keyframes macos26-progress/);
  assert.match(read('src/theme/macos26-controls.css'),/\.vb-control\[data-macos-indeterminate="true"\]>\.vb-progress>\.vb-progress-fill/,'State belongs to the runtime control host, not the inner progress track');
});

test('palette generators include semantic roles in application and IDE outputs independently', () => {
  const app = renderApplicationThemeTokens(), ide = renderIdeThemePalettes();
  assert.doesNotMatch(app,/data-ide-/);
  for (const role of MACOS26_RESOURCE_NAMES) {
    assert.ok(app.includes(`--macos26-${role}:`),role);
    assert.ok(ide.includes(`--macos26-${role}:`),role);
  }
  assert.ok(app.endsWith(macos26AccessibilityCss('application')));
  assert.ok(ide.endsWith(macos26AccessibilityCss('ide')));
});

test('every IDE tooltip painter and generated palette respects runtime portal ownership', () => {
  for (const source of ['src/theme/ide-themes.css','src/theme/winui-ide.css','src/theme/macos26-ide.css']) {
    const css=read(source);
    assert.match(css,/\.classic-tooltip:not\(\.runtime-tooltip\)/,source);
    assert.doesNotMatch(css,/\.classic-tooltip(?!:not\(\.runtime-tooltip\))/,source);
  }
  assert.doesNotMatch(renderIdeThemePalettes(),/\.classic-tooltip(?!:not\(\.runtime-tooltip\))/);
});
