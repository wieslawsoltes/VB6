import test from 'node:test';
import assert from 'node:assert/strict';
import {PaintScene} from '../src/rendering/scene.js';
import {DOMScene} from '../src/rendering/dom-scene.js';
import {preserveOverflowEdges} from '../src/rendering/paint-compat.js';

const white = [1, 1, 1, 1];
for (const dpr of [1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3]) {
  test(`fractional overflow clips retain thin native edges after child paint at DPR ${dpr}`, () => {
    const scene = new PaintScene(400, 320, {dpr});
    const bounds = [33.17, 33.41, 224.13, 239.64];
    scene.add([0, 0, 400, 320], white);
    scene.add([34, 34, 222, 400], white, {clip: bounds});
    preserveOverflowEdges(scene, bounds, scene.clip, true, true);
    assert.equal(scene.commands[0].hole, false);
    assert.equal(scene.commands[1].hole, false);
    assert.equal(scene.commands.length, 6);
    for (const command of scene.commands.slice(2)) {
      assert.equal(command.hole, true);
      assert.ok(Math.min(command.rect[2], command.rect[3]) * dpr <= 3 + 1e-9);
      const [x, y, w, h] = command.rect;
      assert.ok(!(100 >= x && 100 < x + w && 100 >= y && 100 < y + h), 'Opaque interior is not a native fallback');
    }
    assert.equal(scene.stats.reasons['fractional overflow clip'], 4);
  });
}

test('integral device clip edges add no commands, including fractional CSS coordinates', () => {
  for (const dpr of [1, 1.25, 1.5, 2, 3]) {
    const scene = new PaintScene(400, 320, {dpr});
    preserveOverflowEdges(scene, [40 / dpr, 40 / dpr, 200 / dpr, 200 / dpr], scene.clip, true, true);
    assert.equal(scene.commands.length, 0);
  }
});

test('visible axes and empty intersections never erase descendant paint', () => {
  const bounds = [10.25, 20.25, 70, 80];
  for (const [clipX, clipY, count] of [[true, false, 2], [false, true, 2], [false, false, 0]]) {
    const scene = new PaintScene(400, 320);
    preserveOverflowEdges(scene, bounds, scene.clip, clipX, clipY);
    assert.equal(scene.commands.length, count);
    for (const {rect} of scene.commands) assert.equal(rect[clipX ? 2 : 3], 3);
  }
  const scene = new PaintScene(400, 320);
  for (const bounds of [[1.25, 2.5, 0, 30], [1.25, 2.5, 30, 0]]) {
    preserveOverflowEdges(scene, bounds, scene.clip, true, true);
  }
  assert.equal(scene.commands.length, 0);
});

test('native edge holes retain the parent clip instead of clearing unrelated siblings', () => {
  const scene = new PaintScene(400, 320, {dpr: 2});
  preserveOverflowEdges(scene, [10.25, 20.25, 70, 80], [10, 20, 70, 80], true, true);
  for (const command of scene.commands) assert.deepEqual(command.clip, [10, 20, 70, 80]);
});

test('DOM traversal preserves overflow coverage after descendants, not just before them', () => {
  const scene = new PaintScene(400, 320, {dpr: 1.25});
  const style = {display: 'block', visibility: 'visible', overflowX: 'auto', overflowY: 'auto',
    backgroundImage: 'none', boxShadow: 'none', paint: {background: white, gradient: null, layers: null,
      shadows: [], borders: Array.from({length: 4}, () => ({width: 1, color: white, style: 'solid'}))}};
  const node = {tagName: 'DIV', hasAttribute: () => false};
  const adapter = Object.create(DOMScene.prototype);
  Object.assign(adapter, {scene, elements: new Set(), document: {},
    style: () => style, rect: () => [32, 32.40625, 242, 241.640625],
    box: () => ({width: 242, height: 242, clientLeft: 1, clientTop: 1, clientWidth: 224, clientHeight: 240}),
    unsupported: () => null});
  let childIndex;
  adapter.children = (_node, clip) => {
    scene.add([33, 33, 224, 400], white, {clip}); childIndex = scene.commands.length - 1;
  };
  adapter.element(node, scene.clip, 0);
  assert.equal(scene.commands[childIndex].hole, false);
  assert.ok(scene.stats.reasons['fractional overflow clip'] > 0);
  assert.ok(scene.commands.slice(childIndex + 1).some(command => command.hole && command.rect[1] < 274 && command.rect[1] + command.rect[3] > 273),
    'A child must not refill the lower native coverage strip');
});
