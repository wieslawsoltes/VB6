import test from 'node:test';
import assert from 'node:assert/strict';
import {executeIdeVimCommand, executeWindowKey} from '../src/editor/input-modes/ide-commands.js';

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
