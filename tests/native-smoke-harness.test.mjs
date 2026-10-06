import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
const {withDeadline, until, createSmokeProbe} = createRequire(import.meta.url)('../desktop/smoke.cjs');

test('native smoke: deadlines preserve successful results and original failures', async () => {
  assert.equal(await withDeadline(() => 42, 'value'), 42);
  assert.equal(await withDeadline(async () => 'async value', 'async'), 'async value');
  const error = new Error('original failure');
  await assert.rejects(withDeadline(() => { throw error; }, 'failure'), value => value === error);
  await assert.rejects(withDeadline(() => Promise.reject(error), 'failure'), value => value === error);
});
test('native smoke: an unresolved renderer evaluation cannot disable the deadline', {timeout: 2000}, async () => {
  await assert.rejects(withDeadline(() => new Promise(() => {}), 'stalled renderer', 15), /Timed out: stalled renderer/);
  await assert.rejects(until(() => new Promise(() => {}), 'stalled predicate', 15), /Timed out: stalled predicate/);
});
test('native smoke: late predicate completion never retries after deadline failure', {timeout: 2000}, async () => {
  let resolve, calls = 0;
  const result = until(() => { calls++; return new Promise(done => { resolve = done; }); }, 'late predicate', 15);
  await assert.rejects(result, /Timed out: late predicate/);
  resolve(false);
  await new Promise(done => setImmediate(done));
  assert.equal(calls, 1);
});
test('native smoke: polling waits for a genuine result and reports false predicates', {timeout: 2000}, async () => {
  let count = 0;
  await until(() => ++count === 2, 'real result', 200);
  assert.equal(count, 2);
  await assert.rejects(until(() => false, 'false predicate', 10), /Timed out: false predicate/);
});
test('native smoke: invalid deadlines cannot create unbounded validation', async () => {
  for (const timeout of [0, -1, NaN, Infinity, 1.5, 30001]) {
    await assert.rejects(withDeadline(() => true, 'invalid', timeout), /Invalid smoke deadline/);
    await assert.rejects(until(() => true, 'invalid', timeout), /Invalid smoke deadline/);
  }
});
function fixture(reportPath) {
  const app = new EventEmitter(), wc = new EventEmitter(), calls = [], lines = [];
  wc.mainFrame = {framesInSubtree: [{url: 'vb6://app/index.html', name: '', detached: false}]};
  wc.executeJavaScript = async (text, gesture) => { calls.push({text, gesture}); return 7; };
  const report = {ok: false, checks: []};
  const probe = createSmokeProbe({app, root: {webContents: wc}, records: new Map(), report, reportPath, log: text => lines.push(text)});
  return {app, wc, report, probe, calls, lines};
}
test('native smoke: incomplete progress is durable and cannot be mistaken for a pass', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'vb6-smoke-probe-'));
  const file = path.join(directory, 'progress.json'), f = fixture(file);
  try {
    f.report.checks.push('actual completed check');
    f.probe.checkpoint('Waiting for preview frame');
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(report.ok, false);
    assert.deepEqual(report.checks, ['actual completed check']);
    assert.equal(report.phase, 'Waiting for preview frame');
    assert.equal(report.frames[0].url, 'vb6://app/index.html');
    assert.equal(await f.probe.evaluate(f.wc, 'test expression', true), 7);
    assert.deepEqual(f.calls, [{text: 'test expression', gesture: true}]);
  } finally { f.probe.dispose(); fs.rmSync(directory, {recursive: true, force: true}); }
});
test('native smoke: diagnostics bound events and dispose all listeners', () => {
  const f = fixture();
  f.probe.checkpoint('same phase'); f.probe.checkpoint('same phase');
  assert.equal(f.lines.length, 1);
  for (let i = 0; i < 100; i++) f.wc.emit('console-message', {message: 'x'.repeat(3000)});
  assert.equal(f.report.events.length, 64);
  assert.ok(f.report.events.every(event => event.details.length === 2000));
  const child = new EventEmitter(); child.mainFrame = f.wc.mainFrame;
  f.app.emit('web-contents-created', {}, child);
  child.emit('did-fail-load', {}, -2, 'failed', 'vb6://app/preview/fixture', false);
  assert.equal(f.report.events.at(-1).type, 'load-failed');
  f.probe.dispose();
  assert.equal(f.app.eventNames().length, 0);
  assert.equal(f.wc.eventNames().length, 0);
  assert.equal(child.eventNames().length, 0);
  assert.equal(f.report.ok, false);
});
test('native smoke: destroyed-frame diagnostics do not replace an original test failure', async () => {
  const f = fixture();
  try {
    Object.defineProperty(f.wc, 'mainFrame', {get() { throw new Error('frame destroyed'); }});
    f.probe.checkpoint('Awaiting child');
    assert.match(f.report.frames[0].error, /frame destroyed/);
    f.wc.executeJavaScript = () => Promise.reject(new Error('actual failure'));
    await assert.rejects(f.probe.evaluate(f.wc, 'child check'), /actual failure/);
    assert.equal(f.report.ok, false);
  } finally { f.probe.dispose(); }
});
