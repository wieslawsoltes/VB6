import test from 'node:test';
import assert from 'node:assert/strict';
import {DiagnosticsScheduler, createDiagnosticWorker} from '../src/editor/diagnostics-scheduler.js';

const project = {name: 'Lifecycle', modules: [{id: 'm', name: 'Module1', kind: 'module', code: 'Public Sub Main()\nEnd Sub'}], settings: {}};
const reply = (revision) => ({data: {type: 'diagnostics-result', revision, result: {valid: true, diagnostics: [], stats: {}}}});
function fixture(t, onState) {
  const workers = [], results = [];
  const scheduler = new DiagnosticsScheduler({delay: 60000, onState, onResult: r => results.push(r), workerFactory: () => {
    const worker = {messages: [], stopped: 0, released: 0,
      postMessage(m) { this.messages.push(m); }, terminate() { this.stopped++; }, releaseSource() { this.released++; }};
    workers.push(worker); return worker;
  }});
  t.after(() => { scheduler.onState = () => {}; scheduler.cancel(); scheduler.dispose(); });
  const start = () => { scheduler.schedule(project); scheduler.start(); return workers.at(-1); };
  return {scheduler, workers, results, start};
}

test('diagnostic worker: a late cancelled-worker error cannot terminate its replacement', t => {
  const f = fixture(t), old = f.start(); f.scheduler.cancel();
  const current = f.start(); let handled = 0;
  old.onerror({preventDefault() { handled++; }});
  assert.equal(handled, 1, 'The old error is handled, not an unhandled page error.');
  assert.equal(current.stopped, 0, 'A stale callback cannot kill the current worker.');
  assert.equal(f.scheduler.worker, current);
  current.onmessage(reply(current.messages[0].revision));
  assert.equal(f.results.length, 1); assert.equal(f.results[0].mode, 'worker');
});

test('diagnostic worker: a late cancelled-worker message cannot complete a replacement job', t => {
  const f = fixture(t), old = f.start(); f.scheduler.cancel(); const current = f.start();
  old.onmessage(reply(current.messages[0].revision));
  assert.equal(f.results.length, 0, 'Worker identity is checked in addition to a revision number.');
  current.onmessage(reply(current.messages[0].revision)); assert.equal(f.results.length, 1);
});

test('diagnostic worker: detach identity before termination can synchronously report an error', t => {
  const f = fixture(t), worker = f.start(); let nested = 0;
  worker.terminate = () => { worker.stopped++; if (++nested === 1) worker.onerror({preventDefault() {}}); };
  f.scheduler.cancel();
  assert.equal(worker.stopped, 1); assert.equal(worker.released, 1);
  assert.equal(f.scheduler.metrics.fallbackRuns, 0); assert.equal(f.scheduler.worker, null);
});

test('diagnostics disposal rejects work scheduled reentrantly by an observer', t => {
  let scheduler, reenter = false;
  const f = fixture(t, () => { if (reenter) { reenter = false; scheduler.schedule(project); } });
  scheduler = f.scheduler; f.start(); reenter = true; scheduler.dispose();
  assert.equal(scheduler.target, null); assert.equal(scheduler.timer, null); assert.equal(scheduler.pending, false);
});

test('pagehide suspension rejects late work and pageshow can resume current-source checks', t => {
  const f = fixture(t); f.start(); f.scheduler.suspend();
  const revision = f.scheduler.revision;
  f.scheduler.schedule(project); f.scheduler.start();
  assert.equal(f.scheduler.revision, revision); assert.equal(f.scheduler.worker, null); assert.equal(f.scheduler.timer, null);
  f.scheduler.resume(); const worker = f.start(); worker.onmessage(reply(worker.messages[0].revision));
  assert.equal(f.results.length, 1); assert.equal(f.scheduler.mode, 'worker');
  f.scheduler.dispose(); f.scheduler.resume(); f.scheduler.schedule(project);
  assert.equal(f.scheduler.target, null, 'pageshow cannot resurrect a disposed scheduler');
});

test('worker source has one document-owned URL, not a revoke-during-startup race per cancellation', t => {
  const originalWorker = globalThis.Worker, create = URL.createObjectURL, revoke = URL.revokeObjectURL;
  const urls = [], revoked = [];
  t.after(() => { globalThis.Worker = originalWorker; URL.createObjectURL = create; URL.revokeObjectURL = revoke; });
  URL.createObjectURL = () => { const url = 'blob:diagnostic-source-' + urls.length; urls.push(url); return url; };
  URL.revokeObjectURL = url => revoked.push(url);
  globalThis.Worker = class { constructor(url) { this.url = url; } terminate() {} };
  for (let i = 0; i < 25; i++) { const worker = createDiagnosticWorker(); worker.terminate(); worker.releaseSource?.(); }
  assert.equal(urls.length, 1, 'One immutable source allocation per document, bounded independently of edit count.');
  assert.deepEqual(revoked, [], 'The document, not a cancelled worker, owns the shared source URL.');
});
