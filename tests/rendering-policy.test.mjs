import test from 'node:test';
import assert from 'node:assert/strict';
import {BACKENDS, DEFAULT_RENDERING, normalizeRendering, renderingCandidates, physicalSize, intersect, snapRect, readRendering, writeRendering} from '../src/rendering/policy.js';
import {PaintScene, parseColor, splitCSS} from '../src/rendering/scene.js';
import {acquireDevice, deadline} from '../src/rendering/device.js';

test('WebGPU is the default and HTML is an unconditional safety net', () => {
  assert.deepEqual(renderingCandidates(), ['webgpu', 'webgl2', 'html']);
  for (const value of [undefined, null, [], false, 'webgpu', {backend: 'unknown'}]) assert.equal(normalizeRendering(value).backend, 'webgpu');
  assert.deepEqual(renderingCandidates({backend: 'webgpu', fallbacks: []}), ['webgpu', 'html']);
  assert.deepEqual(renderingCandidates({backend: 'html', fallbacks: BACKENDS}), ['html']);
  assert.deepEqual(renderingCandidates({backend: 'webgl2', fallbacks: ['webgl2', 'bad', 'canvas2d', 'canvas2d']}), ['webgl2', 'canvas2d', 'html']);
  assert.deepEqual(renderingCandidates({fallbacks: ['html', 'canvas2d']}), ['webgpu', 'html']);
  const p = normalizeRendering(); p.fallbacks.length = 0; assert.equal(DEFAULT_RENDERING.fallbacks.length, 2);
});
test('storage denial and corrupt storage never prevent startup', () => {
  const denied = {getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); }};
  assert.equal(readRendering(denied).backend, 'webgpu'); assert.equal(writeRendering(denied, {}), false);
  assert.equal(readRendering({getItem: () => '{bad json'}).backend, 'webgpu');
  let raw; const memory = {getItem: () => raw, setItem(key, value) { raw = value; }};
  assert.equal(writeRendering(memory, {backend: 'html'}), true); assert.equal(readRendering(memory).backend, 'html');
});
test('native physical pixels are not capped at DPR 2 or 3', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3, 4]) assert.equal(physicalSize(800, 600, dpr).width, Math.round(800 * dpr));
  assert.equal(physicalSize(333, 101, 1.25).width, 416);
  for (const args of [[0, 5], [Infinity, 5], [10, 10, -1], [8193, 1, 1, 8192], [16384, 16384]]) assert.throws(() => physicalSize(...args), RangeError);
});
test('adjacent snapped edges share the same device-pixel boundary', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 4]) {
    const a = snapRect([.2, .3, 5.5, 7.2], dpr), b = snapRect([5.7, .3, 8.2, 7.2], dpr);
    assert.ok(Math.abs(a[0] + a[2] - b[0]) < 1e-10);
  }
  assert.deepEqual(intersect([0, 0, 5, 5], [4, 3, 10, 10]), [4, 3, 1, 2]);
});
test('paint list culls empty primitives, clips safely and preserves ordering', () => {
  const scene = new PaintScene(100, 100, {maxCommands: 2});
  scene.add([200, 0, 1, 1], [1, 0, 0, 1]); scene.add([0, 0, 0, 1], [1, 0, 0, 1]);
  scene.add([NaN, 0, 1, 1], [1, 0, 0, 1]); scene.add([0, 0, 1, 1], [1, 0, 0, 0]);
  assert.equal(scene.commands.length, 0);
  scene.add([0, 0, 10, 10], [1, 0, 0, 1]); scene.native([1.2, 1.2, 2.1, 2.1], scene.clip, 'IME');
  assert.deepEqual(scene.commands[1].rect, [1, 1, 3, 3]); assert.equal(scene.commands[1].hole, true);
  assert.equal(scene.stats.reasons.IME, 1); assert.throws(() => scene.add([0, 0, 1, 1], [1, 0, 0, 1]), RangeError);
});
test('sRGB color parsing and CSS comma grouping', () => {
  assert.deepEqual(parseColor('#ff008080'), [1, 0, 128/255, 128/255]);
  assert.deepEqual(parseColor('rgb(100% 0% 50% / 50%)'), [1, 0, .5, .5]);
  assert.deepEqual(parseColor('#123'), [17/255, 34/255, 51/255, 1]);
  assert.deepEqual(parseColor('transparent'), [0, 0, 0, 0]);
  assert.throws(() => parseColor('color(display-p3 1 0 0)'));
  assert.deepEqual(splitCSS('rgb(0, 0, 0) 1px 1px, inset rgb(255, 0, 0) -1px 0'), ['rgb(0, 0, 0) 1px 1px', 'inset rgb(255, 0, 0) -1px 0']);
});
test('device acquisition is shared by window and invalidated after loss', async () => {
  let calls = 0, lose;
  const view = {navigator: {gpu: {requestAdapter: async () => { calls++; return {info: {description: 'test'}, requestDevice: async () => ({lost: new Promise(resolve => { lose = resolve; })})}; }}}};
  const [a, b] = await Promise.all([acquireDevice(view), acquireDevice(view)]);
  assert.equal(a.device, b.device); assert.equal(calls, 1);
  lose({reason: 'destroyed'}); await Promise.resolve(); await acquireDevice(view); assert.equal(calls, 2);
  await assert.rejects(acquireDevice({navigator: {}}), /unavailable/);
  await assert.rejects(acquireDevice({vb6NativeGPUUnavailable: true}), /disabled/);
});
test('device failure is retryable and pending acquisition has a bounded timeout', async () => {
  let count = 0; const view = {navigator: {gpu: {requestAdapter: async () => { count++; throw Error('adapter failed'); }}}};
  await assert.rejects(acquireDevice(view)); await assert.rejects(acquireDevice(view)); assert.equal(count, 8, 'four bounded adapter options on each independent acquisition');
  await assert.rejects(deadline(new Promise(() => {}), 5), /timed out/);
  assert.equal(await deadline(Promise.resolve(42), 100), 42);
});
