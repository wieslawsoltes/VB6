import test from 'node:test';
import assert from 'node:assert/strict';
import {EditorInputModeService} from '../src/editor/input-modes/service.js';
import {History} from '../src/core/history.js';
import {INPUT_MODE_SETTINGS_KEY} from '../src/editor/input-modes/registry.js';

function fixture({storedMode} = {}) {
  const document = {defaultView: {}, createElement() { throw new Error('No UI is needed by this fixture'); }};
  const root = () => Object.assign(new EventTarget(), {ownerDocument: document, dataset: {}, contains: () => true, isConnected: true});
  const editor = {root: root(), dispose() { this.disposed = true; }};
  const entries = new Map(), storage = {getItem: key => entries.get(key), setItem: (key, value) => entries.set(key, value)};
  if (storedMode) entries.set(INPUT_MODE_SETTINGS_KEY, JSON.stringify({version: 1, mode: storedMode}));
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

test('an extension cleanup failure still releases keyboard ownership and other resources', () => {
  const f = fixture(); let sync = 0, disposed = 0;
  f.service.registerMode({id: 'faulty', label: 'Faulty', createSession: () => ({handleKey() {},
    sync() { sync++; throw new Error('sync failure'); }, dispose() { disposed++; throw new Error('dispose failure'); }})});
  f.service.configure({mode: 'faulty'});
  assert.doesNotThrow(() => f.service.configure({mode: 'default'}));
  assert.equal(sync, 1); assert.equal(disposed, 1);
  assert.equal(f.service.records.get(f.editor).session, null);
  assert.equal(f.editor.root.dataset.inputMode, undefined);
  assert.equal(f.hosts[0].state, null);
  f.service.dispose();
});

test('a factory failure for a later editor keeps document creation usable and restores Default', () => {
  const f = fixture(); let created = 0, disposed = 0;
  f.service.registerMode({id: 'fragile', label: 'Fragile', createSession: () => {
    if (++created > 1) throw new Error('unsupported surface');
    return {handleKey() {}, dispose() { disposed++; }};
  }});
  f.service.configure({mode: 'fragile'});
  const editor = {root: f.root(), dispose() {}};
  assert.doesNotThrow(() => f.service.attach(editor));
  assert.equal(f.service.settings.mode, 'default'); assert.equal(disposed, 1);
  assert.equal(f.service.records.get(editor).session, null);
  assert.equal(f.service.records.get(f.editor).session, null);
  f.service.dispose();
});

test('late extension registration restores its saved mode until the user makes an explicit selection', () => {
  for (const explicit of [false, true]) {
    const f = fixture({storedMode: 'later'}); let created = 0;
    assert.equal(f.service.settings.mode, 'default');
    if (explicit) f.service.configure({mode: 'default'});
    const unregister = f.service.registerMode({id: 'later', label: 'Later', createSession: () => {
      created++; return {handleKey() {}, dispose() {}};
    }});
    assert.equal(f.service.settings.mode, explicit ? 'default' : 'later');
    assert.equal(created, explicit ? 0 : 1);
    unregister(); assert.equal(f.service.settings.mode, 'default');
    f.service.dispose();
  }
});

test('extensions may publish status without implementing a state getter', () => {
  const f = fixture(); let publishStatus;
  f.service.registerMode({id: 'events', label: 'Events', createSession(host, {onStatus}) {
    publishStatus = onStatus;
    onStatus({mode: 'command', keyBuffer: 'initial', status: 'Ready'});
    return {handleKey() { onStatus({mode: 'insert', keyBuffer: '', status: 'Typing'}); return true; }, dispose() {}};
  }});
  f.service.configure({mode: 'events'});
  assert.deepEqual(f.service.snapshot(), {mode: 'events', label: 'Events', state: 'command', keys: 'initial', message: 'Ready'});
  const record = f.service.records.get(f.editor);
  f.service.keydown(record, {key: 'x', preventDefault() {}, stopImmediatePropagation() {}});
  assert.equal(f.service.snapshot().state, 'insert');
  assert.equal(f.service.snapshot().message, 'Typing');
  publishStatus({mode: 'command', status: 'Finished'});
  assert.equal(f.service.snapshot().state, 'command');
  f.service.dispose();
});

test('a released session cannot publish into Default or a replacement session', () => {
  const f = fixture(), callbacks = [];
  f.service.registerMode({id: 'events', label: 'Events', createSession(host, {onStatus}) {
    callbacks.push(onStatus);
    return {state: {mode: 'command', status: 'Current'}, handleKey() {}, dispose() {}};
  }});
  f.service.configure({mode: 'events'});
  f.service.configure({mode: 'default'});
  callbacks[0]({mode: 'insert', status: 'Stale'});
  assert.equal(f.hosts[0].state, null);
  assert.equal(f.service.snapshot().message, '');
  f.service.configure({mode: 'events'});
  callbacks[0]({mode: 'insert', status: 'Stale'});
  assert.equal(f.hosts[0].state.mode, 'command');
  assert.equal(f.service.snapshot().message, 'Current');
  f.service.dispose();
});

test('an unavailable selection during release cannot retain mode keyboard ownership', () => {
  const f = fixture(); let disposed = 0;
  f.service.registerMode({id: 'custom', label: 'Custom', createSession: () => ({handleKey() {}, dispose() { disposed++; }})});
  f.service.configure({mode: 'custom'});
  f.hosts[0].getSelections = () => { throw new Error('The old editor view has been removed'); };
  assert.doesNotThrow(() => f.service.configure({mode: 'default'}));
  assert.equal(disposed, 1);
  assert.equal(f.service.records.get(f.editor).session, null);
  assert.equal(f.editor.root.dataset.inputMode, undefined);
  f.service.dispose();
});

test('IME composition calls extension hooks without injecting a Vim command', async () => {
  for (const hooks of [false, true]) {
    const f = fixture(), keys = []; let started = 0, ended = 0;
    f.service.registerMode({id: 'custom', label: 'Custom', createSession: () => ({state: {mode: 'command'},
      handleKey(key) { keys.push(key); }, dispose() {},
      ...(hooks ? {beginComposition() { started++; }, endComposition() { ended++; }} : {})
    })});
    f.service.configure({mode: 'custom'});
    f.editor.root.dispatchEvent(new Event('compositionstart'));
    assert.deepEqual(keys, []);
    assert.equal(started, hooks ? 1 : 0);
    assert.equal(f.service.records.get(f.editor).composing, true);
    f.editor.root.dispatchEvent(new Event('compositionend'));
    await Promise.resolve();
    assert.equal(ended, hooks ? 1 : 0);
    assert.equal(f.service.records.get(f.editor).composing, false);
    f.service.dispose();
  }
});

test('composition completion belongs to the original session and composition', async () => {
  const f = fixture(), ended = []; let created = 0;
  f.service.registerMode({id: 'custom', label: 'Custom', createSession: () => {
    const owner = ++created;
    return {handleKey() {}, beginComposition() {}, endComposition() { ended.push(owner); }, dispose() {}};
  }});
  f.service.configure({mode: 'custom'});
  f.editor.root.dispatchEvent(new Event('compositionstart'));
  f.editor.root.dispatchEvent(new Event('compositionend'));
  f.service.configure({mode: 'default'});
  f.service.configure({mode: 'custom'});
  await Promise.resolve();
  assert.deepEqual(ended, []);
  f.editor.root.dispatchEvent(new Event('compositionstart'));
  f.editor.root.dispatchEvent(new Event('compositionend'));
  f.editor.root.dispatchEvent(new Event('compositionstart'));
  await Promise.resolve();
  assert.deepEqual(ended, []);
  f.editor.root.dispatchEvent(new Event('compositionend'));
  await Promise.resolve();
  assert.deepEqual(ended, [2]);
  f.service.dispose();
});

test('Default composition keeps the native input path free of modal presentation', async () => {
  const f = fixture(), record = f.service.records.get(f.editor);
  f.editor.root.dispatchEvent(new Event('compositionstart'));
  assert.equal(record.session, null);
  assert.equal(f.editor.root.dataset.inputComposing, undefined);
  f.editor.root.dispatchEvent(new Event('compositionend'));
  await Promise.resolve();
  assert.equal(f.hosts[0].state, undefined);
  f.service.dispose();
});

test('cancelled native input and paste events retain their existing owner', () => {
  const f = fixture(), edits = [];
  f.hosts[0].undo = () => edits.push('undo');
  f.service.configure({mode: 'vim'});
  const record = f.service.records.get(f.editor);
  record.session.insertText = text => edits.push(text);
  const event = {defaultPrevented: true, preventDefault() {}, stopImmediatePropagation() {}};
  f.service.beforeInput(record, {...event, inputType: 'historyUndo'});
  f.service.paste(record, {...event, clipboardData: {getData: () => 'paste'}});
  assert.deepEqual(edits, []);
  f.service.dispose();
});

test('Normal-mode native input cannot reach a backend that performs its own edit', () => {
  const f = fixture(); let nativeEdits = 0;
  f.service.configure({mode: 'vim'});
  // Classic overwrite and virtualized input handlers perform canonical edits
  // themselves, so cancelling the browser default alone cannot stop them.
  f.editor.root.addEventListener('beforeinput', () => { nativeEdits++; });
  const event = new Event('beforeinput', {cancelable: true});
  Object.defineProperty(event, 'inputType', {value: 'insertText'});
  f.editor.root.dispatchEvent(event);
  assert.equal(event.defaultPrevented, true);
  assert.equal(nativeEdits, 0);
  f.service.dispose();
});
