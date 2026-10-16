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
  return {service, ide, editor, hosts, entries, document, root};
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

test('insert coalescing follows source focus and cannot reopen from a background cursor notification', () => {
  const f = fixture(), host = f.hosts[0], record = f.service.records.get(f.editor), input = {};
  host.moduleId = 'source'; host.ownsEvent = event => event.target === input;
  f.document.activeElement = input;
  f.service.registerMode({id: 'custom', label: 'Custom', createSession: () => ({state: {mode: 'insert'}, handleKey() {}, dispose() {}})});
  f.service.configure({mode: 'custom'}); f.service.activate(record);
  assert.equal(record.endCoalescing.active, true);
  const token = record.endCoalescing;
  f.document.activeElement = {};
  const focusout = new Event('focusout');
  Object.defineProperties(focusout, {target: {value: input}, relatedTarget: {value: f.document.activeElement}});
  f.editor.root.dispatchEvent(focusout);
  assert.equal(token.active, false);
  f.service.stateChanged(record, {mode: 'insert'});
  assert.equal(record.endCoalescing, null);
  f.document.activeElement = input; f.service.activate(record);
  assert.equal(record.endCoalescing.active, true);
  f.service.configure({mode: 'default'}); assert.equal(record.endCoalescing, null);
  f.service.dispose();
});

test('programmatic document and XAML activation select the intended Ex command owner', () => {
  const f = fixture(), previous = f.service.records.get(f.editor), other = {root: f.root(), dispose() {}};
  f.service.attach(other); f.ide.documents.editors.set('second', other);
  f.ide.documents.mdi = {active: 'second:code'}; f.ide.docs = [{key: 'second:code', id: 'second', view: 'code'}];
  f.ide.editor = other; f.service.activeRecord = previous;
  assert.equal(f.service.currentRecord().host.editor, other);
  const xaml = {root: f.root(), dispose() {}};
  f.service.attach(xaml); f.ide.documents.tools.set('xaml:source', {editor: xaml});
  f.ide.documents.mdi.active = 'xaml:source';
  assert.equal(f.service.currentRecord().host.editor, xaml);
  f.service.dispose();
});

test('session keyboard mappings apply after IDE and composition exclusions', () => {
  const f = fixture(), received = []; let mapped = 0;
  f.service.registerMode({id: 'custom', label: 'Custom', createSession: () => ({state: {mode: 'normal'},
    keyFromEvent() { mapped++; return 'j'; }, handleKey(key) { received.push(key); return true; }, dispose() {}})});
  f.service.configure({mode: 'custom'});
  const record = f.service.records.get(f.editor), event = key => ({key, preventDefault() {}, stopImmediatePropagation() {}});
  f.service.keydown(record, event('x')); assert.deepEqual(received, ['j']);
  f.service.keydown(record, {...event('s'), ctrlKey: true});
  f.service.keydown(record, {...event('q'), ctrlKey: true, altKey: true, getModifierState: value => value === 'AltGraph'});
  f.service.keydown(record, {...event('x'), isComposing: true});
  assert.equal(mapped, 1); assert.deepEqual(received, ['j']);
  f.service.dispose();
});

test('native browser undo and redo use canonical history and honor read-only source', () => {
  const f = fixture(), host = f.hosts[0], calls = [];
  host.undo = () => calls.push('undo'); host.redo = () => calls.push('redo');
  f.service.configure({mode: 'vim'});
  const record = f.service.records.get(f.editor), event = inputType => ({inputType, preventDefault() { this.prevented = true; }});
  const undo = event('historyUndo'), redo = event('historyRedo');
  f.service.beforeInput(record, undo); f.service.beforeInput(record, redo);
  assert.equal(undo.prevented, true); assert.equal(redo.prevented, true); assert.deepEqual(calls, ['undo', 'redo']);
  host.readOnly = true; const denied = event('historyUndo'); f.service.beforeInput(record, denied);
  assert.equal(denied.prevented, true); assert.deepEqual(calls, ['undo', 'redo']);
  f.service.dispose();
});
