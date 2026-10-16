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
