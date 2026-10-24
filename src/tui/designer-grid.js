import {designerGridFor} from '../rendering/designer-grid.js';
import {tuiAttribute} from './appearance.js';

/** A cell marker for the designer's otherwise empty grid surface. Sparse
 * one-pixel dots disappear when a raster is reduced to EGA half-block samples.
 * Reuse the same buffer instead, retaining the native grid/input coordinates.
 * Actual pictures and authored drawing commands keep their graphics projection.
 */
export function paintDesignerGrid(buffer, node, graphics, profile) {
  if (!designerGridFor(node) || !graphics?.grid || graphics.picture || graphics.pictureTask || graphics.commands?.length) return false;
  const panel = tuiAttribute(profile, 'panel'), muted = tuiAttribute(profile, 'disabled');
  const foreground = muted.foreground === panel.background ? panel.foreground : muted.foreground;
  buffer.fill(0, 0, buffer.columns, buffer.rows, '·', foreground, panel.background);
  return true;
}
