import test from 'node:test';
import assert from 'node:assert/strict';
import {acquireWebGLContext} from '../src/rendering/context.js';
import {UIRenderer} from '../src/rendering/renderer.js';

function canvasFixture(succeedsAt = 1) {
  const attempts = [], listeners = new Map(), gl = {};
  const canvas = {
    addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type, callback) { assert.equal(listeners.get(type), callback); listeners.delete(type); },
    getContext(type, options) { attempts.push({type, options}); return attempts.length === succeedsAt ? gl : null; }
  };
  return {canvas, gl, attempts, listeners};
}

test('standalone WebGL context keeps the non-preserved default for continuously drawn consumers', () => {
  const f = canvasFixture();
  assert.equal(acquireWebGLContext(f.canvas).gl, f.gl);
  assert.equal(f.attempts[0].options.preserveDrawingBuffer, false);
  assert.equal(f.listeners.size, 0);
});
test('retained WebGL buffer contract survives all power-preference retries', () => {
  const f = canvasFixture(3);
  assert.equal(acquireWebGLContext(f.canvas, {preserveDrawingBuffer: true}).gl, f.gl);
  assert.deepEqual(f.attempts.map(a => a.options.powerPreference), ['high-performance', 'default', 'low-power']);
  for (const {type, options} of f.attempts) {
    assert.equal(type, 'webgl2');
    assert.equal(options.preserveDrawingBuffer, true);
    assert.equal(options.alpha, true); assert.equal(options.premultipliedAlpha, true);
    assert.equal(options.antialias, false); assert.equal(options.depth, false); assert.equal(options.stencil, false);
  }
  assert.equal(f.listeners.size, 0);
});
test('failed retained context creation releases listeners and preserves failure evidence', () => {
  const f = canvasFixture(4);
  assert.throws(() => acquireWebGLContext(f.canvas, {preserveDrawingBuffer: true}), error => {
    assert.equal(error.code, 'WEBGL2_CONTEXT_UNAVAILABLE'); assert.equal(error.attempts.length, 3); return true;
  });
  assert.equal(f.listeners.size, 0);
});
test('retained document renderer requests preserved WebGL only and keeps the ordinary fallback order', async () => {
  const attempts = [], canvas = {remove() {}}, renderer = Object.assign(Object.create(UIRenderer.prototype), {
    disposed: false, generation: 1, policy: {}, attempts: [], view: {}, document: {},
    observedElements: new Set(), retained: {clear() {}}, observer: {disconnect() {}},
    canvasForBackend() { return canvas; }, cancelFrame() {}, disconnectResizeTargets() {}, publish() {}, getStats() { return {active: this.backend}; },
    factory: async (name, target, options) => { attempts.push({name, target, options}); throw new Error(name + ' unavailable'); }
  });
  const result = await renderer.activate(['webgpu', 'webgl2', 'canvas2d', 'html'], 0, 1);
  assert.deepEqual(attempts.map(a => a.name), ['webgpu', 'webgl2', 'canvas2d']);
  assert.equal(attempts[1].options.preserveDrawingBuffer, true);
  assert.equal(attempts[2].options.willReadFrequently, true);
  assert.equal(Object.hasOwn(attempts[0].options, 'willReadFrequently'), false);
  assert.equal(Object.hasOwn(attempts[1].options, 'willReadFrequently'), false);
  assert.equal(Object.hasOwn(attempts[0].options, 'preserveDrawingBuffer'), false);
  assert.equal(Object.hasOwn(attempts[2].options, 'preserveDrawingBuffer'), false);
  for (const a of attempts) { assert.equal(a.target, canvas); assert.equal(typeof a.options.onLost, 'function'); }
  assert.equal(result.active, 'html'); assert.equal(renderer.attempts.length, 3);
});
