import test from 'node:test';
import assert from 'node:assert/strict';
import {executeIdeVimCommand, executeWindowKey, installIdeVimCommands} from '../src/editor/input-modes/ide-commands.js';
import {createVimSession, Vim, VimPosition} from '../src/editor/input-modes/vim-adapter.js';

// Installation adds engine action mappings. Clear mappings before installation;
// individual scenarios reset registers/options without removing those bindings.
Vim.mapclear();
installIdeVimCommands();

function fixture() {
  const calls = [], editor = {module: {id: 'one'}, toggleSplit(value) { this.secondary = value ? {} : null; calls.push(['split', value]); }, setSplitRatio: value => calls.push(['ratio', value])};
  const host = {editor, moduleId: 'one', focus: () => calls.push(['focus'])}, record = {host};
  const ide = {project: {modules: [{id: 'one', name: 'One'}, {id: 'two', name: 'Two'}]}, editor,
    activeDoc: {key: 'one:code', view: 'code'},
    documents: {tools: new Map(), editors: new Map([['one', editor]]), mdi: {active: 'one:code'}},
    closeDocument: key => calls.push(['close', key]), saveProject: async () => true,
    advancedEditor: {runtime: {surfaces: new Map()}}};
  const service = {ide, records: new Map([[editor, record]]), activate() {}};
  return {calls, editor, host, record, ide, service};
}

test('equalizing an unsplit source is a no-op and existing classic splits return to half size', () => {
  const f = fixture(); executeWindowKey(f.service, f.record, '='); assert.deepEqual(f.calls, []);
  f.editor.secondary = {}; executeWindowKey(f.service, f.record, '='); assert.deepEqual(f.calls, [['ratio', .5]]);
});

test('equalizing Monaco changes the actual split ratio without resetting its orientation', () => {
  const f = fixture(), surface = {views: [{}, {}], setSplitRatio: value => f.calls.push(['advancedRatio', value])};
  f.ide.advancedEditor.runtime.surfaces.set(f.editor, surface);
  executeWindowKey(f.service, f.record, '='); assert.deepEqual(f.calls, [['advancedRatio', 50]]);
});

test('only and quit focus the surviving classic pane before accepting more commands', () => {
  for (const command of ['only', 'close']) {
    const f = fixture(); f.editor.secondary = {};
    executeIdeVimCommand(f.service, f.record, command);
    assert.deepEqual(f.calls, [['split', false], ['focus']]);
  }
});

test('write and quit saves then closes only the active split', async () => {
  const f = fixture(); f.editor.secondary = {};
  f.ide.saveProject = async () => { f.calls.push(['save']); return true; };
  await executeIdeVimCommand(f.service, f.record, 'saveAndClose');
  assert.deepEqual(f.calls, [['save'], ['split', false], ['focus']]);
});

test('write and quit never closes after cancellation, project replacement, disposal, or failure', async () => {
  for (const reason of ['cancel', 'project', 'dispose', 'failure']) {
    const f = fixture();
    f.ide.saveProject = async () => {
      if (reason === 'project') f.ide.project = {modules: []};
      if (reason === 'dispose') f.record.disposed = true;
      if (reason === 'failure') throw new Error('save failed');
      return reason !== 'cancel';
    };
    const result = executeIdeVimCommand(f.service, f.record, 'saveAndClose');
    if (reason === 'failure') await assert.rejects(result, /save failed/); else await result;
    assert.deepEqual(f.calls, []);
  }
});

test('buffer navigation starts from the XAML host module and focuses the destination input host', () => {
  const f = fixture(), destination = {root: {}}, next = {host: {focus: () => f.calls.push(['destinationFocus'])}};
  f.host.xaml = true; f.host.moduleId = 'two';
  f.service.records.set(destination, next);
  f.ide.openDocument = (id, view) => { f.calls.push(['open', id, view]); f.ide.editor = destination; f.ide.activeDoc = {view}; f.ide.documents.mdi.active = id + ':code'; };
  executeIdeVimCommand(f.service, f.record, 'nextBuffer');
  assert.deepEqual(f.calls, [['open', 'one', 'code'], ['destinationFocus']]);
});

function splitFixture(backend, orientation) {
  const f = fixture();
  if (backend === 'monaco') {
    const surface = {views: [], splitOrientation: orientation};
    surface.views = [0, 1].map(index => ({view: {index, focus() { surface.view = this; f.calls.push(['pane', index]); }}}));
    surface.view = surface.views[0].view;
    surface.setSplit = () => { f.retained = surface.view.index; f.calls.push(['collapse']); };
    f.surface = surface;
    f.ide.advancedEditor.runtime.surfaces.set(f.editor, surface);
    f.active = () => surface.view.index;
    f.choose = index => { surface.view = surface.views[index].view; };
  } else {
    Object.assign(f.editor, {primary: {index: 0}, secondary: {index: 1}, splitOrientation: orientation});
    f.editor.activePane = f.editor.primary;
    f.editor.activatePane = pane => { f.editor.activePane = pane; f.calls.push(['pane', pane.index]); };
    f.editor.input = {focus() {}};
    f.editor.toggleSplit = () => { f.retained = f.editor.activePane.index; f.calls.push(['collapse']); };
    f.active = () => f.editor.activePane.index;
    f.choose = index => { f.editor.activePane = index ? f.editor.secondary : f.editor.primary; };
  }
  return f;
}

test('directional window commands respect split orientation and stop at the workspace edge', () => {
  for (const backend of ['classic', 'monaco']) {
    for (const orientation of ['horizontal', 'vertical']) {
      const f = splitFixture(backend, orientation), forward = orientation === 'vertical' ? 'l' : 'j', backward = orientation === 'vertical' ? 'h' : 'k';
      executeWindowKey(f.service, f.record, backward);
      assert.equal(f.active(), 0, `${backend} ${orientation}: backward edge`);
      executeWindowKey(f.service, f.record, forward);
      assert.equal(f.active(), 1, `${backend} ${orientation}: forward neighbor`);
      executeWindowKey(f.service, f.record, forward);
      assert.equal(f.active(), 1, `${backend} ${orientation}: forward edge`);
      for (const key of orientation === 'vertical' ? ['j', '<C-k>', '<Down>'] : ['h', '<C-l>', '<Right>']) {
        executeWindowKey(f.service, f.record, key);
        assert.equal(f.active(), 1, `${backend} ${orientation}: no neighbor for ${key}`);
      }
      executeWindowKey(f.service, f.record, '<C-' + backward + '>');
      assert.equal(f.active(), 0, `${backend} ${orientation}: control chord`);
      executeWindowKey(f.service, f.record, orientation === 'vertical' ? '<Right>' : '<Down>');
      assert.equal(f.active(), 1, `${backend} ${orientation}: arrow neighbor`);
    }
  }
});

test('window cycling wraps while top and bottom commands select the requested pane', () => {
  for (const backend of ['classic', 'monaco']) {
    const f = splitFixture(backend, 'vertical');
    for (const [key, expected] of [['W', 1], ['w', 0], ['<C-w>', 1], ['p', 0], ['b', 1], ['t', 0], ['<C-b>', 1], ['<C-t>', 0]]) {
      executeWindowKey(f.service, f.record, key);
      assert.equal(f.active(), expected, backend + ': ' + key);
    }
  }
});

test('closing a split preserves the other pane while only retains the current pane', async () => {
  for (const backend of ['classic', 'monaco']) {
    for (const active of [0, 1]) {
      for (const command of ['close', 'saveAndClose', 'only']) {
        const f = splitFixture(backend, 'horizontal'); f.choose(active);
        await executeIdeVimCommand(f.service, f.record, command);
        assert.equal(f.retained, command === 'only' ? active : 1 - active, `${backend}: ${command} from ${active}`);
        assert.equal(f.ide.project.modules.length, 2);
      }
    }
  }
});

test('write and quit closes the requested pane even when focus changes while saving', async () => {
  for (const backend of ['classic', 'monaco']) {
    const f = splitFixture(backend, 'vertical'); let finish;
    f.ide.saveProject = () => new Promise(resolve => { finish = resolve; });
    f.choose(0);
    const pending = executeIdeVimCommand(f.service, f.record, 'saveAndClose');
    f.choose(1); finish(true); await pending;
    assert.equal(f.retained, 1, backend + ': the pane selected during save must survive');
  }
});

test('delayed write and quit cannot close a replacement split or the remaining document', async () => {
  for (const backend of ['classic', 'monaco']) {
    for (const recreated of [false, true]) {
      const f = splitFixture(backend, 'vertical'); let finish;
      f.ide.saveProject = () => new Promise(resolve => { finish = resolve; });
      const pending = executeIdeVimCommand(f.service, f.record, 'saveAndClose');
      if (f.surface) {
        f.surface.views = [f.surface.views[0]];
        if (recreated) f.surface.views.push({view: {index: 1}});
      } else f.editor.secondary = recreated ? {index: 1} : null;
      finish(true); await pending;
      assert.deepEqual(f.calls, [], `${backend}: recreated=${recreated}`);
    }
  }
});

test('real Vim quit callbacks retain the surviving split selection through the final adapter flush', () => {
  for (const backend of ['classic', 'monaco']) {
    for (const active of [0, 1]) {
      Vim.resetVimGlobalState_();
      const f = splitFixture(backend, 'horizontal'), text = '0123456789\nabcdefghij', offsets = [2, 12];
      const panes = f.surface ? f.surface.views.map(state => state.view) : [f.editor.primary, f.editor.secondary];
      panes.forEach((pane, index) => { pane.selection = [{anchor: offsets[index], head: offsets[index]}]; });
      const current = () => f.surface ? f.surface.view : f.editor.activePane;
      const collapse = () => {
        panes[0].selection = current().selection;
        if (f.surface) { f.surface.views = [f.surface.views[0]]; f.surface.view = panes[0]; }
        else { f.editor.secondary = null; f.editor.activePane = panes[0]; }
      };
      if (f.surface) f.surface.setSplit = collapse; else f.editor.toggleSplit = collapse;
      Object.assign(f.host, {
        getText: () => text,
        getSelections: () => current().selection.map(value => ({...value})),
        setSelections: values => { current().selection = values.map(value => ({...value})); },
        apply: () => assert.fail('Closing a split must not edit source or history'),
        execute: (command, args) => executeIdeVimCommand(f.service, f.record, command, args)
      });
      f.choose(active);
      const session = createVimSession(f.host);
      try {
        session.executeEx('q');
        assert.deepEqual(f.host.getSelections(), [{anchor: offsets[1 - active], head: offsets[1 - active]}], backend + ': close pane ' + active);
        assert.equal(session.adapter.indexFromPos(session.adapter.getCursor()), offsets[1 - active]);
      } finally { session.dispose(); }
    }
  }
});

test('real gd bindings use the requesting host and preserve each definition destination', () => {
  Vim.resetVimGlobalState_();
  const calls = [], sessions = [], text = '0123456789\nabcdefghij\nklmnopqrst';
  try {
    for (const [id, destination] of [['first', 12], ['second', 24]]) {
      let selections = [{anchor: 2, head: 2}];
      const host = {
        getText: () => text, getSelections: () => selections,
        setSelections: values => { selections = values.map(value => ({...value})); },
        apply: () => assert.fail('Definition navigation must not edit source or history'),
        execute(command) { calls.push({id, command}); selections = [{anchor: destination, head: destination}]; }
      };
      const session = createVimSession(host); sessions.push({session, host, destination});
    }
    for (const {session, host, destination} of sessions) {
      session.handleKey('g'); session.handleKey('d');
      assert.deepEqual(host.getSelections(), [{anchor: destination, head: destination}]);
      assert.equal(session.adapter.indexFromPos(session.adapter.getCursor()), destination);
      assert.equal(session.state.mode, 'normal');
    }
    assert.deepEqual(calls, [{id: 'first', command: 'goToDefinition'}, {id: 'second', command: 'goToDefinition'}]);
    sessions[0].session.handleKey('j');
    assert.deepEqual(sessions[0].session.adapter.getCursor(), new VimPosition(2, 1));
  } finally { for (const {session} of sessions) session.dispose(); }
});
