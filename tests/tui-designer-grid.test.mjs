import test from 'node:test';
import assert from 'node:assert/strict';
import {designerGridFor, leaseDesignerGrid} from '../src/rendering/designer-grid.js';
import {FormDesigner} from '../src/designer/designer.js';
import {RetainedGraphics} from '../src/graphics/retained.js';
import {GraphicsSurface} from '../src/graphics/surface.js';
import {RasterCache} from '../src/graphics/raster.js';
import {normalizeDOSSettings} from '../src/tui/cells.js';
import {TuiFormSpace} from '../src/tui/form-space.js';

function element() {
  const events = [];
  return {events, ownerDocument: {defaultView: {CustomEvent: class {constructor(type, options) {this.type = type; Object.assign(this, options);}}}}, dispatchEvent(event) {events.push(event);}};
}
function designer(node = element()) {
  return Object.assign(Object.create(FormDesigner.prototype), {formView: {node}, settings: {gridSize: 120}});
}

test('designer grid preferences are opt-in and unrelated project settings are absent', () => {
  assert.equal(normalizeDOSSettings({mode: 'dos'}).designerGrid, undefined);
  for (const value of ['project', 'cells']) assert.equal(normalizeDOSSettings({designerGrid: value}).designerGrid, value);
  for (const value of ['bad', {}, '__proto__']) assert.equal(normalizeDOSSettings({designerGrid: value}).designerGrid, undefined);
});

test('independent live designer leases restore in order without resurrecting retired owners', () => {
  const a = element(), b = element(), first = leaseDesignerGrid(a, {columnWidth: 8, rowHeight: 16});
  const second = leaseDesignerGrid(a, {columnWidth: 10, rowHeight: 20}), sibling = leaseDesignerGrid(b, {columnWidth: 9, rowHeight: 18});
  first.dispose(); first.dispose();
  assert.deepEqual(designerGridFor(a), {columnWidth: 10, rowHeight: 20});
  assert.equal(a.events.length, 2);
  assert.equal(second.update({columnWidth: 10, rowHeight: 20}), false);
  assert.equal(second.update({columnWidth: 12, rowHeight: 24}), true);
  assert.equal(a.events.length, 3);
  second.dispose(); assert.equal(designerGridFor(a), null);
  assert.deepEqual(designerGridFor(b), {columnWidth: 9, rowHeight: 18});
  sibling.dispose(); assert.equal(designerGridFor(b), null);
  assert.equal(second.update({columnWidth: 8, rowHeight: 16}), false);
});

test('invalid metric updates preserve the previous live grid and event count', () => {
  const node = element(), lease = leaseDesignerGrid(node, {columnWidth: 8, rowHeight: 16});
  for (const value of [null, {}, {columnWidth: 0, rowHeight: 16}, {columnWidth: 8, rowHeight: NaN}, {columnWidth: Infinity, rowHeight: 16}, {columnWidth: 8, rowHeight: 8193}]) {
    assert.throws(() => lease.update(value), RangeError);
    assert.deepEqual(designerGridFor(node), {columnWidth: 8, rowHeight: 16});
    assert.equal(node.events.length, 1);
  }
  lease.dispose();
});

function presentation(onGeometry = () => {}, count = 1) {
  let space, requested = 0;
  const forms = Array.from({length: count}, () => {
    const form = element();
    Object.assign(form, {isConnected: true, matches: selector => ['.vb-form', '.designer-form'].includes(selector), querySelectorAll: () => []});
    form.dispatchEvent = event => {form.events.push(event); onGeometry(space, form);};
    return form;
  });
  const owner = {root: {matches: () => false, querySelectorAll: () => forms}, portals: new Map(), owns: () => true,
    settings: {formLayout: 'authored', designerGrid: 'cells', cellWidth: 8, cellHeight: 16}, requestPaint: () => requested++};
  space = new TuiFormSpace(owner);
  return {space, owner, forms, requested: () => requested};
}

test('reentrant geometry flushes retain dirty work without installing duplicate designer leases', () => {
  let first = true;
  const p = presentation(space => {
    if (!first) return; first = false;
    Object.assign(space.owner.settings, {cellWidth: 9, cellHeight: 18});
    space.configure(); space.flush();
  });
  p.space.flush();
  assert.equal(p.forms[0].events.length, 1); assert.equal(p.space.grids.size, 1);
  assert.equal(p.space.dirty, true); assert.equal(p.requested(), 1);
  p.space.flush();
  assert.deepEqual(designerGridFor(p.forms[0]), {columnWidth: 9, rowHeight: 18});
  assert.equal(p.space.dirty, false); assert.equal(p.space.grids.size, 1);
  p.space.dispose(); assert.equal(designerGridFor(p.forms[0]), null);
});

test('disposal inside designer grid registration retires the unpublished lease and cannot resurrect', () => {
  const p = presentation(space => space.dispose());
  p.space.flush();
  assert.equal(p.space.disposed, true); assert.equal(p.space.grids.size, 0);
  assert.equal(designerGridFor(p.forms[0]), null);
  const events = p.forms[0].events.length;
  p.space.configure(); p.space.flush(); p.space.dispose();
  assert.equal(p.forms[0].events.length, events); assert.equal(p.space.dirty, false);
});

test('disposal during a designer metric update cannot leave an owned lease behind', () => {
  let dispose = false;
  const p = presentation(space => {if (dispose) space.dispose();});
  p.space.flush(); dispose = true; p.owner.settings.cellHeight = 24;
  p.space.configure(); p.space.flush();
  assert.equal(p.space.grids.size, 0); assert.equal(designerGridFor(p.forms[0]), null);
  assert.equal(p.space.disposed, true);
});

test('failed geometry notification rolls registration back and later flushes can recover', () => {
  let fail = true;
  const p = presentation(() => {if (fail) throw Error('notification failed');});
  assert.throws(() => p.space.flush(), /notification failed/);
  assert.equal(designerGridFor(p.forms[0]), null); assert.equal(p.space.grids.size, 0);
  assert.equal(p.space.flushing, false);
  fail = false; p.space.configure(); p.space.flush();
  assert.deepEqual(designerGridFor(p.forms[0]), {columnWidth: 8, rowHeight: 16});
  p.space.dispose(); assert.equal(designerGridFor(p.forms[0]), null);
});

test('failed registration preserves both a prior lease and any newer listener-owned lease', () => {
  const node = element(), first = leaseDesignerGrid(node, {columnWidth: 8, rowHeight: 16});
  const dispatch = node.dispatchEvent; let nested, installing = true;
  node.dispatchEvent = event => {
    if (installing) {
      installing = false; nested = leaseDesignerGrid(node, {columnWidth: 12, rowHeight: 24});
      throw Error('outer notification failed');
    }
    return dispatch.call(node, event);
  };
  assert.throws(() => leaseDesignerGrid(node, {columnWidth: 9, rowHeight: 18}), /outer notification failed/);
  assert.deepEqual(designerGridFor(node), {columnWidth: 12, rowHeight: 24});
  nested.dispose(); assert.deepEqual(designerGridFor(node), {columnWidth: 8, rowHeight: 16});
  first.dispose(); assert.equal(designerGridFor(node), null);
});

test('disposal retires all form grids even when a geometry notification throws', () => {
  let fail = false;
  const p = presentation(() => {if (fail) throw Error('retirement failed');}, 2);
  p.space.flush(); assert.equal(p.space.grids.size, 2); fail = true;
  assert.throws(() => p.space.dispose(), /retirement failed/);
  assert.ok(p.forms.every(form => designerGridFor(form) === null)); assert.equal(p.space.grids.size, 0);
  assert.doesNotThrow(() => {p.space.dispose(); p.space.configure(); p.space.flush();});
});

test('cell snapping uses separate axes while fine movement and project mode retain their contracts', () => {
  const d = designer(), settings = JSON.stringify(d.settings), lease = leaseDesignerGrid(d.formView.node, {columnWidth: 8, rowHeight: 16});
  assert.equal(d.snap(170, 'x'), 120); assert.equal(d.snap(170, 'y'), 240);
  assert.equal(d.nudge(120, 1, 'x'), 240); assert.equal(d.nudge(240, 1, 'y'), 480);
  assert.equal(d.nudge(123, 1, 'y', true), 138); assert.equal(d.nudge(123, 0, 'y'), 123);
  d.settings.snapToGrid = false; assert.equal(d.snap(170, 'y'), 165); delete d.settings.snapToGrid;
  lease.dispose();
  assert.equal(d.snap(170, 'y'), 120); assert.equal(d.nudge(123, 1, 'y'), 243);
  assert.equal(JSON.stringify(d.settings), settings);
});

test('fractional presentation scaling does not accumulate keyboard twip drift', () => {
  const d = designer(), lease = leaseDesignerGrid(d.formView.node, {columnWidth: 8 / 3, rowHeight: 16 / 1.125});
  let y = 0;
  for (let i = 1; i <= 300; i++) {y = d.nudge(y, 1, 'y'); assert.equal(y, Math.round(i * 16 / 1.125 * 15));}
  for (let i = 299; i >= 0; i--) {y = d.nudge(y, -1, 'y'); assert.equal(y, Math.round(i * 16 / 1.125 * 15));}
  lease.dispose();
});

test('the existing graphics surface receives the active grid and restores the project grid', () => {
  const d = designer(), calls = []; d.grid = {setGrid(...args) {calls.push(args);}};
  d.refreshGrid();
  const lease = leaseDesignerGrid(d.formView.node, {columnWidth: 4, rowHeight: 16}); d.refreshGrid();
  d.settings.showGrid = false; d.refreshGrid();
  lease.dispose(); delete d.settings.showGrid; d.refreshGrid();
  assert.deepEqual(calls, [[8, 8], [4, 16], [0, 0], [8, 8]]);
});

test('rectangular graphics grid updates atomically and remains source-compatible with square grids', () => {
  const s = new RetainedGraphics({}); let changes = 0; s.invalidate = () => changes++;
  s.setGrid(8); assert.equal(changes, 1); s.setGrid(8); assert.equal(changes, 1);
  s.setGrid(8, 16); assert.equal(changes, 2);
  for (const values of [[8, 0], [0, 8], [8, .5], [8, NaN], [Infinity, 16]]) assert.throws(() => s.setGrid(...values));
  assert.equal(s.grid, 8); assert.equal(s.gridY, 16); assert.equal(changes, 2);
  s.setGrid(0); assert.equal(s.grid, 0); assert.equal(s.gridY, 0); assert.equal(changes, 3);
});

function surface() {
  return Object.assign(Object.create(GraphicsSurface.prototype), {commands: [], width: 24, height: 48, grid: 8, gridY: 16, theme: 'classic', replayEpoch: 0, dpr: 1, rgba: () => [0, 0, 0, 1], invalidate() {}, background: 0});
}

test('GPU grid vertices use rectangular pitch and invalidate when only the vertical pitch changes', () => {
  const s = surface(), first = s.vertices(); assert.equal(first.length, 9 * 36);
  assert.deepEqual(Array.from({length: 9}, (_, i) => [first[i * 36], first[i * 36 + 1]]), [[0, 0], [8, 0], [16, 0], [0, 16], [8, 16], [16, 16], [0, 32], [8, 32], [16, 32]]);
  assert.strictEqual(s.vertices(), first); s.setGrid(8, 24);
  const next = s.vertices(); assert.notStrictEqual(next, first); assert.equal(next.length, 6 * 36);
  assert.equal(s.canUseTriangles(), true); s.setGrid(8, 16 / 1.125); assert.equal(s.canUseTriangles(), false);
});

test('retained Canvas grid tiles and cache keys use both axes without an area-sized point loop', () => {
  const tiles = [], fills = [], states = [];
  const document = {createElement() {
    const stack = []; states.push(stack);
    const context = {fillStyle: '#000000', globalAlpha: 1, globalCompositeOperation: 'source-over',
      save() {stack.push({fillStyle: this.fillStyle, globalAlpha: this.globalAlpha, globalCompositeOperation: this.globalCompositeOperation});},
      restore() {const state = stack.pop(); if (state) Object.assign(this, state);},
      setTransform() {}, clearRect() {}, fillRect(...args) {fills.push(args);}, createPattern(canvas) {tiles.push([canvas.width, canvas.height]); return {};}};
    return {width: 0, height: 0, getContext() {return context;}};
  }};
  const cache = new RasterCache(document), s = surface();
  cache.render(s); assert.deepEqual(tiles, [[8, 16]]); assert.equal(cache.rebuilds, 1);
  cache.render(s); assert.equal(cache.rebuilds, 1);
  s.setGrid(8, 24); cache.render(s); assert.deepEqual(tiles, [[8, 16], [8, 24]]); assert.equal(cache.rebuilds, 2);
  assert.ok(fills.length < 10); assert.ok(states.every(stack => stack.length === 0)); cache.dispose();
});
