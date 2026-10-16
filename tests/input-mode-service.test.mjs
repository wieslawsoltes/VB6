import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorInputModeService} from '../src/editor/input-modes/service.js';
import {History} from '../src/core/history.js';

function fixture() {
  const document = {defaultView: {}, createElement() { throw new Error('No UI is needed by this fixture'); }};
  const root = () => Object.assign(new EventTarget(), {ownerDocument: document, dataset: {}, contains: () => true, isConnected: true});
  const editor = {root: root(), dispose() { this.disposed = true; }};
  const entries = new Map(), storage = {getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value)};
  const ide = {root: root(), project: {id: 'project', modules: []}, editor, history: new History(), status() {},
    documents: {editors: new Map([['source', editor]]), tools: new Map(), editor: () => editor, openTool: value => value, reset() {}}};
  const hosts = [];
  const hostFactory = value => {
    let selections = [{anchor: 3, head: 9}], text = 'alpha beta';
    const host = {editor: value, root: value.root, getText: () => text, getSelections: () => selections.map(s => ({...s})),
      setSelections: s => { selections = s; }, apply: (value, s) => { text = value; selections = s; },
      subscribe: () => () => {}, setMode(state) { this.state = state; }, ownsEvent: () => true, activateEvent() {},
      dispose() { this.disposed = true; }, focus() {}, options: {}};
    hosts.push(host); return host;
  };
  const service = new EditorInputModeService(ide, {hostFactory, storage});
  return {service, ide, editor, hosts, entries};
}

test('default allocates no engine session and runtime mode registration follows every editor', () => {
  const f = fixture(), originalSelection = f.hosts[0].getSelections(); let created = 0, disposed = 0;
  assert.equal(f.service.records.get(f.editor).session, null);
  const unregister = f.service.registerMode({id: 'custom', label: 'Custom', createSession: () => {
    created++; return {state: {mode: 'command'}, handleKey() { return false; }, dispose() { disposed++; }};
  }});
  assert.equal(created, 0); assert.equal(f.service.configure({mode: 'custom'}), true); assert.equal(created, 1);
  f.service.configure({mode: 'custom'}); assert.equal(created, 1);
  assert.equal(f.service.snapshot().state, 'command');
  f.service.configure({mode: 'default'}); assert.equal(disposed, 1);
  assert.deepEqual(f.hosts[0].getSelections(), originalSelection);
  assert.equal(f.editor.root.dataset.inputMode, undefined);
  f.service.configure({mode: 'custom'}); unregister();
  assert.equal(f.service.settings.mode, 'default'); assert.equal(disposed, 2);
  f.service.dispose(); assert.equal(f.hosts[0].disposed, true); assert.equal(f.service.records.size, 0);
});

test('disposing a stable editor releases its session and wrapping is reversible', () => {
  const f = fixture(); let disposed = 0;
  f.service.registerMode({id: 'custom', label: 'Custom', createSession: () => ({handleKey() {}, dispose() { disposed++; }})});
  f.service.configure({mode: 'custom'});
  f.editor.dispose(); assert.equal(disposed, 1); assert.equal(f.service.records.size, 0); assert.equal(f.editor.disposed, true);
  f.service.dispose(); assert.equal(disposed, 1);
});

test('factory failures return all source owners to default and unknown modes fail closed', () => {
  const f = fixture();
  f.service.registerMode({id: 'broken', label: 'Broken', createSession() { throw new Error('Factory failed'); }});
  assert.throws(() => f.service.configure({mode: 'broken'}), /Factory failed/);
  assert.equal(f.service.settings.mode, 'default'); assert.equal(f.service.records.get(f.editor).session, null);
  assert.equal(f.editor.root.dataset.inputMode, undefined);
  assert.throws(() => f.service.configure({mode: '__proto__'}), /Unknown/);
  assert.throws(() => f.service.configure({mode: true}), /Unknown/);
  f.service.dispose(); assert.equal(f.service.configure({mode: 'vim'}), false);
});
