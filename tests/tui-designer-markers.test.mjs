import test from 'node:test';
import assert from 'node:assert/strict';
import {CellBuffer, TUI_PROFILES} from '../src/tui/cells.js';
import {paintDesignerGrid} from '../src/tui/designer-grid.js';
import {leaseDesignerGrid} from '../src/rendering/designer-grid.js';
import {serializeB800} from '../src/tui/screen.js';

for (const profile of Object.keys(TUI_PROFILES)) test(profile + ': designer cell markers survive logical CP437 capture', () => {
  const node = {}, lease = leaseDesignerGrid(node, {columnWidth: 8, rowHeight: 16}), cells = new CellBuffer(8, 4);
  assert.equal(paintDesignerGrid(cells, node, {grid: 8, commands: []}, profile), true);
  assert.ok(cells.glyphs.every(value => value === '·'.codePointAt(0)));
  assert.ok(cells.colors.every(value => (value & 15) !== (value >> 4)));
  assert.equal(serializeB800(cells, {unmappable: 'error'}).length, 64);
  lease.dispose();
});

test('pictures, drawing commands, disabled grid and unowned forms keep their actual raster content', () => {
  const node = {}, cells = new CellBuffer(8, 4); cells.text(0, 0, 'Original');
  const before = cells.snapshot();
  assert.equal(paintDesignerGrid(cells, node, {grid: 8}, 'turbo'), false);
  const lease = leaseDesignerGrid(node, {columnWidth: 8, rowHeight: 16});
  for (const graphics of [null, {grid: 0}, {grid: 8, picture: {}}, {grid: 8, pictureTask: {}}, {grid: 8, commands: [{kind: 'pixel'}]}]) {
    assert.equal(paintDesignerGrid(cells, node, graphics, 'turbo'), false);
    assert.deepEqual(cells.snapshot(), before);
  }
  lease.dispose(); assert.equal(paintDesignerGrid(cells, node, {grid: 8}, 'turbo'), false);
});
