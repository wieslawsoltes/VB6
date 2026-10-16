import {Signal} from '../../core/signal.js';
import {hasUIDialog} from '../../core/window-context.js';
import {InputModeRegistry, DEFAULT_INPUT_MODE, readStoredInputMode, loadInputModeSettings, saveInputModeSettings} from './registry.js';
import {vimKeyFromEvent, isIdeReservedKey} from './keys.js';
import {createEditorHost} from './editor-host.js';
import {createVimSession} from './vim-adapter.js';
import {openInputModePrompt, openInputModeNotification} from './prompts.js';
import {installIdeVimCommands, executeIdeVimCommand, executeWindowKey} from './ide-commands.js';

const emptyState = Object.freeze({mode: 'normal', keyBuffer: '', status: ''});
function listen(target, type, callback, capture = false) {
  target.addEventListener(type, callback, capture);
  return () => target.removeEventListener(type, callback, capture);
}

/** One mode selection per IDE; one modal session per stable source owner.
 * Backends and presentation may change while the owner and registers survive.
 * All listeners are scoped to editor roots, before native projection handlers.
 */
export class EditorInputModeService extends Signal {
  constructor(ide, {registry, hostFactory = createEditorHost, storage} = {}) {
    super();
    this.ide = ide; this.records = new Map(); this.disposables = [];
    this.registry = registry || new InputModeRegistry(); this.hostFactory = hostFactory;
    this.settings = Object.freeze({mode: DEFAULT_INPUT_MODE}); this.activeRecord = null;
    this.disposed = false; this.generation = 0;
    this.document = ide.root.ownerDocument;
    if (storage === undefined) { try { storage = this.document.defaultView.localStorage; } catch {} }
    this.storage = storage;
    if (!this.registry.has('vim')) this.registry.register({id: 'vim', label: 'Vim', description: 'Modal editing with motions, operators, Visual selection, registers, macros and Ex commands.', createSession: createVimSession});
    const preferred = readStoredInputMode(storage);
    this.pendingMode = this.registry.has(preferred) ? null : preferred;
    installIdeVimCommands();
    this.disposables.push(this.registry.on('change', () => {
      if (this.pendingMode && this.registry.has(this.pendingMode)) {
        try { this.configure({mode: this.pendingMode}, {persist: false}); }
        catch (error) { this.ide.status('Input mode disabled: ' + (error?.message || String(error))); }
      } else if (!this.registry.has(this.settings.mode)) this.configure({mode: DEFAULT_INPUT_MODE});
      else this.publish();
    }));
    this.installLifecycle();
    this.attachExisting();
    this.configure(loadInputModeSettings(storage, this.registry), {persist: false, restore: true});
  }

  listModes() { return this.registry.list(); }
  registerMode(definition) {
    if (this.disposed) throw new Error('The input mode service is disposed.');
    return this.registry.register(definition);
  }
  snapshot() {
    const record = this.currentRecord(), state = record?.session?.state || emptyState;
    const label = this.registry.get(this.settings.mode)?.label || 'Default';
    const suffix = state.subMode === 'blockwise' ? 'block' : state.subMode === 'linewise' ? 'line' : '';
    return {
      mode: this.settings.mode, label,
      state: this.settings.mode === DEFAULT_INPUT_MODE ? '' : record?.closePrompt ? 'command' : record?.windowPrefix ? 'window' : [state.mode || 'normal', suffix].filter(Boolean).join('-'),
      keys: record?.windowPrefix ? 'Ctrl+W' : state.keyBuffer || '',
      message: [state.recording ? 'recording @' + state.recording : '', record?.message || state.status || ''].filter(Boolean).join(' · ')
    };
  }
  publish() {
    if (this.disposed) return;
    this.emit('change', this.snapshot());
  }
  currentRecord() {
    const documents = this.ide.documents, key = documents.mdi?.active;
    const tool = documents.tools.get(key), doc = this.ide.docs?.find(value => value.key === key);
    const current = this.records.get(tool?.editor || documents.editors.get(doc?.id) || this.ide.editor);
    // A programmatic tab activation can leave focus in the previous MDI child.
    // Detached windows own their focus independently of the main document.
    for (const record of this.records.values()) {
      if (this.hasTextFocus(record) && (!current || current === record || record.host.root.ownerDocument !== this.document)) return record;
    }
    if (current) return current;
    if (this.activeRecord && this.records.has(this.activeRecord.host.editor)) return this.activeRecord;
    return this.records.values().next().value;
  }
  hasTextFocus(record) {
    const document = record.host.root.ownerDocument;
    return record.host.ownsEvent({target: document.activeElement}) && (document.hasFocus?.() ?? true);
  }
  configure(value, {persist = true, restore = false} = {}) {
    if (this.disposed) return false;
    const mode = value?.mode;
    if (typeof mode !== 'string' || !this.registry.has(mode)) throw new RangeError('Unknown editor input mode: ' + String(mode));
    if (!restore) this.pendingMode = null;
    if (this.settings.mode !== mode) {
      this.generation++;
      for (const record of this.records.values()) this.releaseSession(record);
      this.settings = Object.freeze({mode});
      try { for (const record of this.records.values()) this.startSession(record); }
      catch (error) {
        // A third-party factory can fail. Return every editor to the existing
        // default input path; never leave only part of the workspace captured.
        for (const record of this.records.values()) this.releaseSession(record);
        this.settings = Object.freeze({mode: DEFAULT_INPUT_MODE}); this.publish();
        throw error;
      }
    }
    if (persist) {
      try { saveInputModeSettings(this.storage, this.settings); }
      catch { this.ide.status('Input mode applies to this session; browser storage is unavailable.'); }
    }
    this.publish(); return true;
  }
  startSession(record) {
    if (this.settings.mode === DEFAULT_INPUT_MODE || record.session) return;
    const definition = this.registry.get(this.settings.mode);
    record.host.root.dataset.inputMode = this.settings.mode;
    record.busy++;
    try {
      const session = definition.createSession(record.host, {onStatus: state => this.stateChanged(record, state)});
      if (!session || typeof session.handleKey !== 'function' || typeof session.dispose !== 'function') {
        session?.dispose?.();
        throw new TypeError('An input mode session must implement handleKey and dispose.');
      }
      record.session = session;
      this.stateChanged(record, session.state || emptyState);
    } finally { record.busy--; }
  }
  releaseSession(record) {
    const selections = record.host.getSelections();
    const errors = [], cleanup = action => { try { action(); } catch (error) { errors.push(error); } };
    record.busy++; record.releasing = true;
    try {
      cleanup(() => record.endCoalescing?.()); record.endCoalescing = null;
      cleanup(() => record.closePrompt?.()); record.closePrompt = null;
      for (const close of [...record.notifications]) cleanup(close);
      const session = record.session; record.session = null;
      cleanup(() => session?.sync?.()); cleanup(() => session?.dispose());
      cleanup(() => record.host.setMode?.(null));
      cleanup(() => record.host.setSelections(selections));
      record.windowPrefix = false; record.message = ''; record.lastMode = null;
      delete record.host.root.dataset.inputMode; delete record.host.root.dataset.vimMode;
      delete record.host.root.dataset.inputComposing;
    } finally { record.busy--; record.releasing = false; }
    this.ide.history?.stopMerging();
    if (errors.length) this.ide.status('Input mode released: ' + (errors[0]?.message || String(errors[0])));
  }
  stateChanged(record, state) {
    if (record.disposed || record.releasing || this.disposed) return;
    const mode = state?.mode || 'normal';
    if (record.lastMode && mode !== record.lastMode) {
      record.endCoalescing?.(); record.endCoalescing = null;
      this.ide.history?.stopMerging();
      this.ide.lastTyped = 0; this.ide.lastTypingModule = null;
      if (mode !== 'insert' && mode !== 'replace') {
        record.host.editor.closeCompletion?.(); record.host.editor.closeInfo?.(); record.host.editor.hideCompletion?.();
      }
    }
    record.lastMode = mode;
    if (mode === 'insert' || mode === 'replace') this.ensureCoalescing(record);
    if (this.settings.mode === 'vim') record.host.root.dataset.vimMode = mode;
    record.host.setMode?.(state);
    this.publish();
  }
  ensureCoalescing(record) {
    if (this.activeRecord !== record || !this.hasTextFocus(record) || record.releasing || record.endCoalescing?.active || !this.ide.history?.beginCoalescing) return;
    const host = record.host, id = host.moduleId;
    if (id == null || host.readOnly) return;
    const key = host.xaml ? 'xaml:' + this.ide.project.id + ':' + id : id;
    record.endCoalescing = this.ide.history.beginCoalescing(key, 'Vim insert');
  }
  activate(record) {
    if (this.activeRecord !== record) {
      this.activeRecord?.endCoalescing?.();
      if (this.activeRecord) this.activeRecord.endCoalescing = null;
      this.activeRecord = record;
    }
    if (['insert', 'replace'].includes(record.session?.state?.mode)) this.ensureCoalescing(record);
  }
  run(record, action) {
    if (record.disposed || this.disposed) return;
    record.busy++;
    try { return action(); }
    catch (error) { this.report(record, error); return false; }
    finally {
      record.busy--;
      if (!record.busy && record.session) {
        try { record.session.sync?.(); this.stateChanged(record, record.session.state || emptyState); }
        catch (error) { this.report(record, error); }
      }
    }
  }
  report(record, error) {
    this.notify(record, error?.message || String(error));
    this.ide.status('Input mode: ' + (error?.message || String(error)));
  }
  notify(record, text) { return openInputModeNotification(record, text, {duration: 5000}, () => this.publish()); }
  executeEx(command, editor) {
    const record = editor ? this.records.get(editor) : this.currentRecord();
    if (!record?.session?.executeEx) throw new Error('Enable Vim input in a source editor before using Ex commands.');
    return this.run(record, () => record.session.executeEx(command));
  }

  attach(editor) {
    if (this.disposed || !editor?.root || editor.disposed || editor.closed) return null;
    if (this.records.has(editor)) return this.records.get(editor);
    const host = this.hostFactory(editor, this.ide);
    const record = {host, session: null, busy: 0, composing: false, disposed: false, windowPrefix: false, notifications: new Set(), cleanup: [], lastMode: null};
    this.records.set(editor, record);
    record.run = action => this.run(record, action);
    host.openDialog = (template, callback, options = {}) => openInputModePrompt(record, template, callback, options, () => this.publish());
    host.openNotification = (template, options = {}) => openInputModeNotification(record, template, options, () => this.publish());
    host.readClipboard = () => {
      const clipboard = host.root.ownerDocument.defaultView?.navigator?.clipboard;
      if (!clipboard?.readText) throw new Error('System clipboard is unavailable; using the Vim clipboard register.');
      return clipboard.readText();
    };
    host.writeClipboard = text => {
      const clipboard = host.root.ownerDocument.defaultView?.navigator?.clipboard;
      if (!clipboard?.writeText) throw new Error('System clipboard is unavailable; text remains in the Vim clipboard register.');
      return clipboard.writeText(text);
    };
    host.isActive = () => !record.disposed && !this.disposed && this.currentRecord() === record && this.hasTextFocus(record) && !!record.session && !!host.root.isConnected;
    host.execute = (command, args) => {
      const result = executeIdeVimCommand(this, record, command, args);
      if (result?.then) result.catch(error => this.report(record, error));
      return result;
    };
    const owns = event => host.ownsEvent(event);
    record.cleanup.push(listen(host.root, 'focusin', event => {
      if (!owns(event)) return;
      this.activate(record); host.activateEvent(event);
      if (!record.busy) this.run(record, () => record.session?.sync?.());
      this.publish();
    }, true));
    record.cleanup.push(listen(host.root, 'focusout', event => {
      if (owns(event) && !owns({target: event.relatedTarget})) { record.endCoalescing?.(); record.endCoalescing = null; }
    }, true));
    record.cleanup.push(listen(host.root, 'keydown', event => this.keydown(record, event), true));
    record.cleanup.push(listen(host.root, 'beforeinput', event => this.beforeInput(record, event), true));
    record.cleanup.push(listen(host.root, 'paste', event => this.paste(record, event), true));
    record.cleanup.push(listen(host.root, 'compositionstart', event => {
      if (!owns(event)) return;
      // Native composition is owned by the existing editor. An IME start in
      // Normal mode enters Insert, so preedit text is never mistaken for keys.
      if (record.session && !['insert', 'replace'].includes(record.session.state?.mode)) this.run(record, () => record.session.handleKey('i'));
      if (record.session?.beginComposition) this.run(record, () => record.session.beginComposition());
      record.composing = true; host.root.dataset.inputComposing = 'true';
    }, true));
    record.cleanup.push(listen(host.root, 'compositionend', event => {
      if (!owns(event)) return;
      record.composing = false; delete host.root.dataset.inputComposing;
      queueMicrotask(() => { if (!record.disposed) this.run(record, () => record.session?.endComposition ? record.session.endComposition() : record.session?.sync?.()); });
    }, true));
    record.cleanup.push(host.subscribe(event => {
      if (record.disposed || record.busy || record.composing || !record.session) return;
      this.run(record, () => record.session.sync?.(event));
    }));
    const originalDispose = editor.dispose;
    if (typeof originalDispose === 'function') {
      const dispose = (...args) => { this.detach(editor); return originalDispose.apply(editor, args); };
      editor.dispose = dispose;
      record.cleanup.push(() => { if (editor.dispose === dispose) editor.dispose = originalDispose; });
    }
    try { this.startSession(record); }
    catch (error) {
      // A newly opened editor can expose a factory failure after the mode was
      // selected. Keep document creation usable and release every input owner.
      for (const item of this.records.values()) this.releaseSession(item);
      this.settings = Object.freeze({mode: DEFAULT_INPUT_MODE});
      this.ide.status('Input mode disabled: ' + (error?.message || String(error)));
      this.publish();
    }
    return record;
  }
  detach(editor) {
    const record = this.records.get(editor); if (!record || record.disposed) return;
    this.releaseSession(record); record.disposed = true;
    for (const cleanup of record.cleanup.reverse()) cleanup?.();
    record.host.dispose(); this.records.delete(editor);
    if (this.activeRecord === record) this.activeRecord = null;
    this.publish();
  }
  attachExisting() {
    for (const editor of this.ide.documents.editors.values()) this.attach(editor);
    for (const tool of this.ide.documents.tools.values()) if (tool.editor) this.attach(tool.editor);
  }
  installLifecycle() {
    const documents = this.ide.documents;
    const wrap = (object, name, handler) => {
      const original = object[name];
      if (typeof original !== 'function') return;
      const wrapped = (...args) => handler(original.bind(object), ...args);
      object[name] = wrapped;
      this.disposables.push(() => { if (object[name] === wrapped) object[name] = original; });
    };
    wrap(documents, 'editor', (original, ...args) => { const editor = original(...args); this.attach(editor); return editor; });
    wrap(documents, 'openTool', (original, tool) => { if (tool.editor) this.attach(tool.editor); return original(tool); });
    wrap(documents, 'reset', (original, ...args) => { for (const editor of [...this.records.keys()]) this.detach(editor); return original(...args); });
  }

  keydown(record, event) {
    if (event.defaultPrevented || !record.session || !record.host.ownsEvent(event) || record.composing || event.isComposing || event.keyCode === 229 || hasUIDialog()) return;
    record.host.activateEvent(event); this.activate(record);
    // Window commands have priority only after an explicit Normal-mode prefix.
    const rawKey = vimKeyFromEvent(event);
    if (!rawKey) return;
    if (this.settings.mode === 'vim' && record.windowPrefix) {
      event.preventDefault(); event.stopImmediatePropagation(); record.windowPrefix = false;
      this.run(record, () => executeWindowKey(this, record, rawKey)); this.publish(); return;
    }
    if (isIdeReservedKey(event)) { record.endCoalescing?.(); record.endCoalescing = null; return; }
    const key = record.session.keyFromEvent?.(event) || rawKey;
    const before = record.session.state || emptyState;
    if (this.settings.mode === 'vim' && key === '<C-w>' && !['insert', 'replace'].includes(before.mode)) {
      event.preventDefault(); event.stopImmediatePropagation(); record.windowPrefix = true; this.publish(); return;
    }
    const handled = this.run(record, () => record.session.handleKey(key, event));
    // In a modal command state, unsupported text must not fall through and
    // change source. Insert mode delegates its ordinary input to the editor.
    if (handled || this.settings.mode === 'vim' && !['insert', 'replace'].includes(before.mode)) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  }
  beforeInput(record, event) {
    if (!record.session || !record.host.ownsEvent(event) || record.composing || event.isComposing || record.busy) return;
    if (this.settings.mode === 'vim' && ['historyUndo', 'historyRedo'].includes(event.inputType)) {
      // Browser edit menus and touch input must use the project history too;
      // the textarea's private undo stack cannot represent modal operations.
      event.preventDefault();
      record.endCoalescing?.(); record.endCoalescing = null;
      if (!record.host.readOnly) this.run(record, () => event.inputType === 'historyUndo' ? record.host.undo() : record.host.redo());
      return;
    }
    const state = record.session.state || emptyState;
    if (['insert', 'replace'].includes(state.mode)) this.ensureCoalescing(record);
    if (this.settings.mode === 'vim' && !['insert', 'replace'].includes(state.mode)) {
      // Native paste/drop/spellcheck must not bypass Normal mode. A paste event
      // is handled separately using the shared engine operation/undo protocol.
      event.preventDefault();
    }
  }
  paste(record, event) {
    if (!record.session || !record.host.ownsEvent(event) || record.composing || this.settings.mode !== 'vim') return;
    const text = event.clipboardData?.getData('text/plain');
    if (text == null || !record.session.insertText) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (record.host.readOnly) return;
    this.run(record, () => record.session.insertText(text.replace(/\r\n?/g, '\n'), {origin: 'paste'}));
  }
  dispose() {
    if (this.disposed) return;
    this.generation++;
    for (const editor of [...this.records.keys()]) this.detach(editor);
    this.disposed = true;
    for (const dispose of this.disposables.reverse()) dispose();
    this.disposables = []; this.activeRecord = null; this.clear();
  }
}
