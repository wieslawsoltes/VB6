import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { evaluate } = createRequire(import.meta.url)('../desktop/smoke.cjs');

test('native smoke evaluations return values and preserve the user gesture', async () => {
  const calls = [];
  const target = { executeJavaScript(...args) { calls.push(args); return Promise.resolve(42); } };
  assert.equal(await evaluate(target, '6 * 7'), 42);
  assert.deepEqual(calls, [['6 * 7', true]]);
});

test('native smoke evaluations propagate synchronous destruction errors', async () => {
  const target = { executeJavaScript() { throw new Error('Object has been destroyed'); } };
  await assert.rejects(evaluate(target, 'query'), /Object has been destroyed/);
});

test('native smoke evaluations propagate rejected script promises', async () => {
  const target = { executeJavaScript() { return Promise.reject(new Error('script failed')); } };
  await assert.rejects(evaluate(target, 'query'), /script failed/);
});

test('a lost renderer reply cannot stall native smoke validation indefinitely', async () => {
  const target = { executeJavaScript() { return new Promise(() => {}); } };
  await assert.rejects(evaluate(target, 'lost reply', true, 10), /Renderer evaluation timed out: lost reply/);
});

test('a late rejected renderer reply after timeout is handled', async () => {
  let reject;
  const target = { executeJavaScript() { return new Promise((_, fail) => { reject = fail; }); } };
  await assert.rejects(evaluate(target, 'late reply', false, 10), /timed out/);
  reject(new Error('retired renderer'));
  await new Promise(resolve => setTimeout(resolve, 0));
});
