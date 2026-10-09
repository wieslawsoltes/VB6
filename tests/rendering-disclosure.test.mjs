import test from 'node:test';
import assert from 'node:assert/strict';
import {DOMScene} from '../src/rendering/dom-scene.js';
import {PaintScene} from '../src/rendering/scene.js';

// Closed <details> descendants can retain nonzero layout boxes in Chromium.
// These tests deliberately give hidden content geometry rather than relying on
// a display:none mock, which would conceal the real coding-agent regression.
function element(tag, children = [], rect = [20, 20, 100, 20], extra = {}) {
  const node = {nodeType: 1, tagName: tag.toUpperCase(), childNodes: children,
    hidden: false, open: false, style: {}, hasAttribute: () => false,
    getBoundingClientRect() { node.measured = (node.measured || 0) + 1; return {left: rect[0], top: rect[1], width: rect[2], height: rect[3], right: rect[0] + rect[2], bottom: rect[1] + rect[3]}; },
    querySelectorAll() { return children.filter(n => n.nodeType === 1).flatMap(n => [n, ...n.querySelectorAll('*')]); },
    ...extra};
  Object.defineProperty(node, 'children', {get: () => node.childNodes.filter(n => n.nodeType === 1)});
  for (const child of children) child.parentElement = node;
  return node;
}
const text = value => ({nodeType: 3, textContent: value});
function adapter() {
  const scene = Object.create(DOMScene.prototype);
  scene.order = new WeakMap(); scene.boxes = new WeakMap();
  scene.scene = new PaintScene(1000, 800);
  scene.style = node => ({display: 'block', visibility: 'visible', position: 'static', zIndex: 'auto',
    overflowX: 'visible', overflowY: 'visible', contentVisibility: 'visible', boxShadow: 'none', outlineWidth: '0px', ...node.style});
  return scene;
}
function visited(scene, node) {
  const seen = [];
  scene.element = child => seen.push(child); scene.text = child => seen.push(child);
  scene.children(node, scene.scene.clip, 0);
  return seen;
}

test('a collapsed disclosure traverses only its first direct summary', () => {
  const summary = element('summary'), otherSummary = element('summary'), body = element('div');
  const node = element('details', [text('hidden leading text'), body, summary, otherSummary, text('hidden tail')]);
  assert.deepEqual(visited(adapter(), node), [summary]);
});
test('a nested summary is not the disclosure summary', () => {
  const node = element('details', [element('div', [element('summary')]), text('hidden')]);
  assert.deepEqual(visited(adapter(), node), []);
});
test('opening, closing and reopening cannot reuse the wrong cached paint order', () => {
  const summary = element('summary'), body = element('div'), tail = text('tail');
  const node = element('details', [summary, body, tail], undefined, {open: true}), scene = adapter();
  assert.deepEqual(visited(scene, node), [summary, body, tail]);
  // Synchronous rendering before MutationObserver delivery must also be safe.
  node.open = false; assert.deepEqual(visited(scene, node), [summary]);
  node.open = true; assert.deepEqual(visited(scene, node), [summary, body, tail]);
});
test('closed summary replacement is read live, not retained from the old children', () => {
  const first = element('summary'), second = element('summary'), node = element('details', [first, second]), scene = adapter();
  assert.deepEqual(visited(scene, node), [first]);
  node.childNodes = [second]; assert.deepEqual(visited(scene, node), [second]);
});
test('a CSS-hidden disclosure content subtree is not traversed', () => {
  const node = element('div', [element('strong'), text('hidden content')]); node.style.contentVisibility = 'hidden';
  assert.deepEqual(visited(adapter(), node), []);
});
test('ordinary containers and open disclosures retain all text and children', () => {
  for (const tag of ['div', 'details']) {
    const nodes = [text('leading'), element('summary'), element('div'), text('tail')];
    assert.deepEqual(visited(adapter(), element(tag, nodes, undefined, {open: true})), nodes);
  }
});
test('native bounds do not measure or punch holes for hidden disclosure bodies', () => {
  const summary = element('summary'), body = element('div', [element('pre')], [0, 0, 900, 700]);
  const node = element('details', [summary, body]), scene = adapter();
  scene.native(node, [20, 20, 100, 20], scene.scene.clip, 'rounded border');
  assert.equal(body.measured || 0, 0); assert.equal(body.children[0].measured || 0, 0);
  assert.deepEqual(scene.scene.commands.at(-1).rect, [19, 19, 102, 22]);
});
test('native bounds prune nested closed disclosures, including a large tool result', () => {
  const hidden = element('pre', Array.from({length: 2100}, () => element('span')), [0, 0, 900, 700]);
  const disclosure = element('details', [element('summary'), hidden]);
  const scene = adapter(), root = element('article', [disclosure]);
  scene.native(root, [20, 20, 100, 20], scene.scene.clip, 'native compositing');
  assert.equal(hidden.measured || 0, 0);
  assert.deepEqual(scene.scene.commands.at(-1).rect, [19, 19, 102, 22]);
});
test('native bounds still include overflow from an opened result', () => {
  const body = element('pre', [], [10, 10, 300, 200]);
  const node = element('details', [element('summary'), body], undefined, {open: true}), scene = adapter();
  scene.native(node, [20, 20, 100, 20], scene.scene.clip, 'rounded border');
  assert.equal(body.measured, 1);
  assert.deepEqual(scene.scene.commands.at(-1).rect, [9, 9, 302, 202]);
});
test('native bounds do not inspect display:none or content-visibility:hidden descendants', () => {
  const hidden = element('div', [element('pre', [], [0, 0, 900, 700])]); hidden.style.display = 'none';
  const skipped = element('div', [element('pre', [], [0, 0, 900, 700])]); skipped.style.contentVisibility = 'hidden';
  const scene = adapter(), root = element('article', [hidden, skipped]);
  scene.native(root, [20, 20, 100, 20], scene.scene.clip, 'native compositing');
  assert.equal(hidden.measured || 0, 0); assert.equal(skipped.children[0].measured || 0, 0);
  assert.deepEqual(scene.scene.commands.at(-1).rect, [19, 19, 102, 22]);
});
test('the real summary and synthesized default disclosure keep their native marker', () => {
  const scene = adapter(), summary = element('summary'), details = element('details', [summary]);
  assert.equal(scene.unsupported(summary, scene.style(summary)), 'native disclosure summary');
  assert.equal(scene.unsupported(element('details'), {}), 'native disclosure summary');
  assert.equal(details.children[0], summary);
});
