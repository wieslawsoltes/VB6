import test from 'node:test';
import assert from 'node:assert/strict';
import {CanvasPainter} from '../src/rendering/canvas2d.js';
import {createPainter} from '../src/rendering/renderer.js';
import {PaintScene} from '../src/rendering/scene.js';

function fixture() {
  const requests = [], events = new Map(), draws = [];
  const context = {
    setTransform() {}, clearRect(...rect) { draws.push(['clear', ...rect]); },
    save() {}, restore() {}, beginPath() {}, rect() {}, clip() {},
    fillRect(...rect) { draws.push(['fill', ...rect]); },
    // Presentation must not be repaired with a synchronous pixel readback.
    getImageData() { throw new Error('Unexpected rendering readback'); }
  };
  const canvas = {
    width: 100, height: 100,
    getContext(type, options) { requests.push({type, options}); return context; },
    addEventListener(type, callback) { events.set(type, callback); },
    removeEventListener(type, callback) { assert.equal(events.get(type), callback); events.delete(type); },
    toDataURL() { throw new Error('Unexpected canvas serialization'); }
  };
  return {canvas, context, requests, events, draws};
}

test('standalone Canvas2D keeps the browser-selected storage default', () => {
  const f = fixture(), painter = new CanvasPainter(f.canvas);
  assert.deepEqual(f.requests, [{type: '2d', options: {alpha: true, willReadFrequently: false}}]);
  assert.equal(painter.stats.readbackRequested, false);
  painter.dispose();
  assert.equal(f.events.size, 0);
});

test('Canvas2D factory requests retained storage on its first and only context acquisition', async () => {
  const f = fixture(), notices = [];
  const painter = await createPainter('canvas2d', f.canvas, {
    willReadFrequently: true, onLost: reason => notices.push(reason), onRestored: () => notices.push('restored')
  });
  assert.deepEqual(f.requests, [{type: '2d', options: {alpha: true, willReadFrequently: true}}]);
  assert.equal(painter.stats.readbackRequested, true, 'Report the request, not an unverified GPU/CPU storage claim');
  const lost = f.events.get('contextlost'), restored = f.events.get('contextrestored');
  lost(); lost(); restored(); restored();
  assert.deepEqual(notices, ['Canvas2D context lost', 'restored']);
  assert.equal(f.requests.length, 1);
  painter.dispose();
  assert.equal(f.events.size, 0);
});

for (const willReadFrequently of [false, true]) {
  test(`Canvas2D readback hint ${willReadFrequently} preserves batching without bitmap resets or readbacks`, () => {
    const f = fixture(), painter = new CanvasPainter(f.canvas, {willReadFrequently});
    const scene = new PaintScene(100, 100);
    for (let i = 0; i < 10000; i++) scene.add([i % 100, Math.floor(i / 100), 1, 1], [.2, .4, .8, 1]);
    scene.seal();
    // Same-sized frames must retain the allocation and never reset the bitmap.
    for (const dimension of ['width', 'height']) Object.defineProperty(f.canvas, dimension, {
      configurable: true, get: () => 100, set: () => { throw new Error('Unexpected bitmap reset'); }
    });
    for (let i = 0; i < 2; i++) painter.render(scene);
    assert.equal(painter.stats.frames, 2);
    assert.equal(painter.stats.drawCalls, 10000);
    assert.equal(painter.stats.clipChanges, 1);
    assert.equal(painter.stats.fillStyleChanges, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.draws.filter(draw => draw[0] === 'fill').length, 20000);
    for (const dimension of ['width', 'height']) Object.defineProperty(f.canvas, dimension, {value: 100, writable: true});
    painter.dispose();
  });
}

test('unavailable retained Canvas2D is rejected instead of silently reacquiring different settings', async () => {
  const requests = [];
  const canvas = {getContext(type, options) { requests.push({type, options}); return null; }};
  await assert.rejects(createPainter('canvas2d', canvas, {willReadFrequently: true}), /Canvas2D context unavailable/);
  assert.deepEqual(requests, [{type: '2d', options: {alpha: true, willReadFrequently: true}}]);
});
