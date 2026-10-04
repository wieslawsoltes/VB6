import test from 'node:test';
import assert from 'node:assert/strict';
import {browserBounds, normalizeBrowserWindows} from '../src/ide/browser-window-state.js';
import {normalizeWindowProfile, parseWindowProfiles} from '../src/ide/window-profile.js';
import {DockLayout} from '../src/ide/dock-layout.js';
import {CommandBarLayout} from '../src/ide/command-bar-model.js';

const descriptor = (key = 'document:main:code') => ({key, bounds: {left: -1920, top: -20, width: 900, height: 700}});
const profile = () => {
  const dock = new DockLayout(); dock.register('properties');
  return {version: 2, projectId: 'project', docking: dock.snapshot(), commandBars: new CommandBarLayout().snapshot(), docs: [], windows: [], editorViews: {}};
};

test('browser window bounds preserve secondary-display negative coordinates', () => {
  assert.deepEqual(browserBounds({left: -1919.7, top: -199.6, width: 1024.4, height: 700.2}), {left: -1920, top: -200, width: 1024, height: 700});
});
test('browser window bounds clamp pathological size and non-finite values', () => {
  assert.deepEqual(browserBounds({left: -Infinity, top: NaN, width: 0, height: 1e9}), {left: 80, top: 80, width: 240, height: 10000});
  assert.deepEqual(browserBounds(), {left: 80, top: 80, width: 640, height: 480});
});
test('descriptors support all three host kinds, copy input and strip unrelated data', () => {
  const input = ['dock:tools', 'document:tool:resources', 'toolbar:standard'].map(descriptor);
  input[0].bounds.extra = 'not geometry'; input[1].url = 'https://untrusted.invalid/';
  const result = normalizeBrowserWindows(input);
  assert.deepEqual(Object.keys(result[1]), ['key', 'bounds']);
  assert.equal(result[0].bounds.extra, undefined);
  result[0].bounds.left = 300;
  assert.equal(input[0].bounds.left, -1920);
});
test('malformed, duplicate and unbounded descriptor collections fail as a whole', () => {
  for (const value of [null, {}, '', [descriptor(), descriptor()], Array.from({length: 129}, (_, i) => descriptor('dock:' + i)),
    [{key: '__proto__', bounds: descriptor().bounds}], [{key: 'dock:', bounds: descriptor().bounds}],
    [{key: 'document:' + 'a'.repeat(240), bounds: descriptor().bounds}],
    [{key: 'dock:test', bounds: {left: 0, top: 0, width: '500', height: 200}}],
    [{key: 'dock:test', bounds: {...descriptor().bounds, top: Infinity}}], [null]]) {
    assert.throws(() => normalizeBrowserWindows(value), /browser window/);
  }
});
test('128 distinct descriptors are accepted without sharing geometry objects', () => {
  const result = normalizeBrowserWindows(Array.from({length: 128}, (_, i) => descriptor('dock:' + i)));
  assert.equal(result.length, 128);
  assert.notEqual(result[0].bounds, result[1].bounds);
});
test('older version 2 layouts without browser windows remain readable', () => {
  const value = normalizeWindowProfile(profile(), ['properties']);
  assert.deepEqual(value.browserWindows, []);
});
test('named window profiles round-trip browser geometry without opening windows', () => {
  const value = {...profile(), browserWindows: [descriptor()]};
  const parsed = parseWindowProfiles(JSON.stringify({version: 2, layouts: {MultiMonitor: value}}), ['properties']);
  assert.deepEqual(parsed.MultiMonitor.browserWindows, [descriptor()]);
});
test('invalid browser geometry invalidates an entire named-layout import', () => {
  const valid = {...profile(), browserWindows: [descriptor()]};
  const invalid = {...profile(), browserWindows: [{...descriptor(), bounds: {}}]};
  assert.throws(() => parseWindowProfiles(JSON.stringify({version: 2, layouts: {Valid: valid, Invalid: invalid}}), ['properties']), /browser window/);
  assert.deepEqual(valid.browserWindows, [descriptor()]);
});
test('legacy version 1 dock layouts still normalize', () => {
  const dock = new DockLayout(); dock.register('properties');
  assert.equal(normalizeWindowProfile(dock.snapshot(), ['properties']).version, 1);
});
test('browser host module is side-effect-free without a DOM', async () => {
  const module = await import('../src/ide/browser-window-host.js');
  assert.equal(typeof module.BrowserWindowHost, 'function');
});

test('window mode defaults preserve in-page MDI with optional detachment', async () => {
  const {normalizeAppearance, DEFAULT_APPEARANCE} = await import('../src/theme/theme.js');
  assert.equal(DEFAULT_APPEARANCE.windowMode, 'hybrid');
  for (const value of [undefined, {}, {windowMode: 'invalid'}, {windowMode: false}]) {
    assert.equal(normalizeAppearance(value).windowMode, 'hybrid');
  }
  const appearance = normalizeAppearance({windowMode: 'mdi', theme: 'contrast'});
  assert.equal(appearance.windowMode, 'mdi');
  assert.equal(appearance.theme, 'contrast');
  assert.equal(normalizeAppearance(JSON.parse(JSON.stringify(appearance))).windowMode, 'mdi');
});

test('disabled host refuses detachment before accessing a node or opening a window', async () => {
  const {BrowserWindowHost} = await import('../src/ide/browser-window-host.js');
  const host = Object.assign(Object.create(BrowserWindowHost.prototype), {disposed: false, enabled: false});
  const node = {get parentNode() { throw new Error('Must not inspect DOM while disabled'); }};
  assert.equal(host.detach('document:test', node), false);
});

test('switching host to MDI saves geometry, disables first and returns all live panes', async () => {
  const {BrowserWindowHost} = await import('../src/ide/browser-window-host.js');
  const saved = [descriptor(), descriptor('toolbar:standard')];
  let calls = 0;
  const host = Object.assign(Object.create(BrowserWindowHost.prototype), {
    enabled: true, disposed: false, snapshot: () => saved,
    attachAll(reason) { assert.equal(reason, 'mode'); assert.equal(this.enabled, false); calls++; }
  });
  host.setEnabled(false);
  assert.equal(calls, 1);
  assert.deepEqual([...host.pending.keys()], ['document:main:code', 'toolbar:standard']);
  host.setEnabled(false);
  assert.equal(calls, 1);
  host.setEnabled(true);
  assert.equal(host.enabled, true);
  assert.equal(calls, 1, 'Enabling must never automatically open or transfer windows');
  assert.equal(host.pending.size, 2);
});

test('disposed browser hosts ignore mode changes', async () => {
  const {BrowserWindowHost} = await import('../src/ide/browser-window-host.js');
  const host = Object.assign(Object.create(BrowserWindowHost.prototype), {disposed: true, enabled: true});
  host.setEnabled(false);
  assert.equal(host.enabled, true);
});
