import test from 'node:test';
import assert from 'node:assert/strict';
import {InputModeRegistry, INPUT_MODE_SETTINGS_KEY, loadInputModeSettings, normalizeInputModeSettings, saveInputModeSettings} from '../src/editor/input-modes/registry.js';
import {vimKeyFromEvent, isIdeReservedKey} from '../src/editor/input-modes/keys.js';

const mode = (id = 'vim') => ({id, label: id === 'vim' ? 'Vim' : id, createSession: () => ({dispose() {}})});
test('fresh, corrupt, unavailable and unknown preferences preserve default editing', () => {
  const registry = new InputModeRegistry(); registry.register(mode());
  for (const json of [null, '{', 'false', '[]', '{"mode":"vim"}', '{"version":2,"mode":"vim"}', '{"version":1,"mode":"missing"}', '{"version":1,"mode":true}']) {
    assert.equal(loadInputModeSettings({getItem: () => json}, registry).mode, 'default');
  }
  assert.equal(loadInputModeSettings({getItem() { throw new Error('Storage denied'); }}, registry).mode, 'default');
  assert.equal(loadInputModeSettings(undefined, registry).mode, 'default');
  assert.equal(normalizeInputModeSettings({mode: 'vim', project: 'ignored'}, registry).mode, 'vim');
});

test('mode settings round-trip without modifying projects or accepting unknown settings', () => {
  const registry = new InputModeRegistry(); registry.register(mode());
  const entries = new Map(), storage = {getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value)};
  saveInputModeSettings(storage, {mode: 'vim', project: 'not stored'});
  assert.deepEqual(JSON.parse(entries.get(INPUT_MODE_SETTINGS_KEY)), {version: 1, mode: 'vim'});
  assert.deepEqual(loadInputModeSettings(storage, registry), {mode: 'vim'});
  assert.ok(Object.isFrozen(loadInputModeSettings(storage, registry)));
});

test('third-party mode factories are lazy, validated, observable and unregisterable', () => {
  const registry = new InputModeRegistry(), events = []; let created = 0;
  registry.on('change', event => events.push(event));
  const remove = registry.register({...mode('emacs'), createSession: () => { created++; return {}; }});
  assert.equal(created, 0);
  assert.deepEqual(registry.list().map(item => item.id), ['default', 'emacs']);
  assert.ok(Object.isFrozen(registry.get('emacs')));
  assert.equal(remove(), true); assert.equal(remove(), false); assert.equal(registry.has('emacs'), false);
  assert.deepEqual(events, [{type: 'register', id: 'emacs'}, {type: 'unregister', id: 'emacs'}]);
  assert.throws(() => registry.register(mode('Default')), /lowercase/);
  assert.throws(() => registry.register(mode('__proto__')), /lowercase/);
  assert.throws(() => registry.register(mode('default')), /already registered/);
  assert.throws(() => registry.register({id: 'new', label: 'New'}), /session factory/);
  assert.throws(() => registry.register({...mode('new'), label: ''}), /label/);
});

test('keyboard conversion respects layouts, named keys, Ctrl, IME and platform modifiers', () => {
  const key = (value, flags = {}) => vimKeyFromEvent({key: value, ...flags});
  assert.equal(key('D', {shiftKey: true}), 'D');
  assert.equal(key('[' , {ctrlKey: true}), '<C-[>');
  assert.equal(key('r', {ctrlKey: true}), '<C-r>');
  assert.equal(key('ArrowLeft'), '<Left>'); assert.equal(key('Enter'), '<CR>');
  assert.equal(key(' ', {ctrlKey: true}), '<C-Space>'); assert.equal(key('Tab', {shiftKey: true}), '<S-Tab>');
  assert.equal(key('ą'), 'ą'); assert.equal(key('😀'), '😀');
  for (const value of ['Dead', 'Process', 'Unidentified', 'Shift']) assert.equal(key(value), null);
  for (const flags of [{isComposing: true}, {keyCode: 229}, {metaKey: true}, {altKey: true}, {getModifierState: () => true}]) assert.equal(key('v', flags), null);
  assert.equal(isIdeReservedKey({key: 'F5'}), true);
  assert.equal(isIdeReservedKey({key: 's', ctrlKey: true}), true);
  assert.equal(isIdeReservedKey({key: 'r', ctrlKey: true}), false);
});
