import {letterformMask} from './letterforms.js';
/** Independently authored integer-pixel line/block primitives on an 8x16 grid.
 * These are drawing algorithms, not an IBM/vendor font or a copied ROM atlas.
 * Letterforms outside this set deliberately use the browser text rasterizer. */
const masks = new Map();
const H = (x, y, end) => [x, y, end - x + 1, 1];
const V = (x, y, end) => [x, y, 1, end - y + 1];
const define = (glyph, rectangles) => {
  const mask = new Uint8Array(128);
  for (const [x, y, width, height] of rectangles) {
    for (let row = y; row < y + height; row++) for (let col = x; col < x + width; col++) mask[row * 8 + col] = 1;
  }
  masks.set(glyph.codePointAt(0), mask);
};
const single = {
  '─': [H(0, 7, 7)], '│': [V(3, 0, 15)],
  '┌': [H(3, 7, 7), V(3, 7, 15)], '┐': [H(0, 7, 3), V(3, 7, 15)],
  '└': [H(3, 7, 7), V(3, 0, 7)], '┘': [H(0, 7, 3), V(3, 0, 7)],
  '├': [V(3, 0, 15), H(3, 7, 7)], '┤': [V(3, 0, 15), H(0, 7, 3)],
  '┬': [H(0, 7, 7), V(3, 7, 15)], '┴': [H(0, 7, 7), V(3, 0, 7)],
  '┼': [H(0, 7, 7), V(3, 0, 15)]
};
for (const [glyph, rectangles] of Object.entries(single)) define(glyph, rectangles);
const doubles = {
  '═': [H(0, 5, 7), H(0, 10, 7)], '║': [V(2, 0, 15), V(5, 0, 15)],
  '╔': [H(2, 5, 7), V(2, 5, 15), H(5, 10, 7), V(5, 10, 15)],
  '╗': [H(0, 5, 5), V(5, 5, 15), H(0, 10, 2), V(2, 10, 15)],
  '╚': [H(2, 10, 7), V(2, 0, 10), H(5, 5, 7), V(5, 0, 5)],
  '╝': [H(0, 10, 5), V(5, 0, 10), H(0, 5, 2), V(2, 0, 5)],
  '╠': [V(2, 0, 15), V(5, 0, 5), V(5, 10, 15), H(5, 5, 7), H(5, 10, 7)],
  '╣': [V(5, 0, 15), V(2, 0, 5), V(2, 10, 15), H(0, 5, 2), H(0, 10, 2)],
  '╦': [H(0, 5, 7), H(0, 10, 2), H(5, 10, 7), V(2, 10, 15), V(5, 10, 15)],
  '╩': [H(0, 10, 7), H(0, 5, 2), H(5, 5, 7), V(2, 0, 5), V(5, 0, 5)],
  '╬': [H(0, 5, 2), H(5, 5, 7), H(0, 10, 2), H(5, 10, 7), V(2, 0, 5), V(5, 0, 5), V(2, 10, 15), V(5, 10, 15)]
};
for (const [glyph, rectangles] of Object.entries(doubles)) define(glyph, rectangles);
// Mixed single/double junctions used by CP437-style text interfaces.
const mixed = {
  '╒': [V(3, 5, 15), H(3, 5, 7), H(3, 10, 7)], '╕': [V(3, 5, 15), H(0, 5, 3), H(0, 10, 3)],
  '╘': [V(3, 0, 10), H(3, 5, 7), H(3, 10, 7)], '╛': [V(3, 0, 10), H(0, 5, 3), H(0, 10, 3)],
  '╞': [V(3, 0, 15), H(3, 5, 7), H(3, 10, 7)], '╡': [V(3, 0, 15), H(0, 5, 3), H(0, 10, 3)],
  '╤': [H(0, 5, 7), H(0, 10, 7), V(3, 10, 15)], '╧': [H(0, 5, 7), H(0, 10, 7), V(3, 0, 5)],
  '╪': [H(0, 5, 7), H(0, 10, 7), V(3, 0, 15)],
  '╓': [H(2, 7, 7), V(2, 7, 15), V(5, 7, 15)], '╖': [H(0, 7, 5), V(2, 7, 15), V(5, 7, 15)],
  '╙': [H(2, 7, 7), V(2, 0, 7), V(5, 0, 7)], '╜': [H(0, 7, 5), V(2, 0, 7), V(5, 0, 7)],
  '╟': [V(2, 0, 15), V(5, 0, 15), H(5, 7, 7)], '╢': [V(2, 0, 15), V(5, 0, 15), H(0, 7, 2)],
  '╥': [H(0, 7, 7), V(2, 7, 15), V(5, 7, 15)], '╨': [H(0, 7, 7), V(2, 0, 7), V(5, 0, 7)],
  '╫': [H(0, 7, 7), V(2, 0, 15), V(5, 0, 15)]
};
for (const [glyph, rectangles] of Object.entries(mixed)) define(glyph, rectangles);
for (const [glyph, rect] of Object.entries({'█': [0, 0, 8, 16], '▀': [0, 0, 8, 8], '▄': [0, 8, 8, 8], '▌': [0, 0, 4, 16], '▐': [4, 0, 4, 16], '■': [1, 4, 6, 8], '•': [3, 6, 2, 3]})) define(glyph, [rect]);
for (const [glyph, density] of [['░', 1], ['▒', 2], ['▓', 3]]) {
  const mask = new Uint8Array(128);
  for (let y = 0; y < 16; y++) for (let x = 0; x < 8; x++) {
    mask[y * 8 + x] = density === 2 ? Number((x + y) % 2 === 0) : Number((x + 2 * (y % 2)) % 4 < density);
  }
  masks.set(glyph.codePointAt(0), mask);
}
for (const [glyph, direction] of [['▲', 0], ['▼', 1], ['◄', 2], ['►', 3], ['◀', 2], ['▶', 3]]) {
  const rects = [];
  for (let i = 0; i < 4; i++) {
    if (direction < 2) rects.push([3 - i, direction === 0 ? 5 + i : 9 - i, i * 2 + 1, 1]);
    else rects.push([direction === 2 ? 2 + i : 5 - i, 7 - i, 1, i * 2 + 1]);
  }
  define(glyph, rects);
}

export const TUI_PRIMITIVE_GLYPHS = Object.freeze([...masks.keys()]);
export function tuiGlyphMask(code) {
  return masks.get(typeof code === 'string' ? code.codePointAt(0) : code)?.slice() ?? null;
}

/** Paint runs at integer device-pixel boundaries; no antialiasing, interpolation
 * or platform font fallback is involved in line and block cells. */
export function paintTuiGlyph(context, code, width, height, style=0) {
  const mask = masks.get(code) || letterformMask(code);
  if (!mask) return false;
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 8;) {
      if (!mask[y * 8 + x]) { x++; continue; }
      const start = x;
      while (x < 8 && mask[y * 8 + x]) x++;
      const left = Math.round(start * width / 8), top = Math.round(y * height / 16);
      const right = Math.round(x * width / 8), bottom = Math.round((y + 1) * height / 16);
      // Transform both edges before clipping. Clamping only the left edge
      // shifts clipped ink back into the cell and can spill a bold/italic run
      // across the right edge. Geometric recipes use this same bounded path.
      const shift=style&2?Math.round((8-y)*width/64):0;
      const inkLeft=Math.max(0,left+shift),inkRight=Math.min(width,right+shift+(style&1?1:0));
      if (inkRight > inkLeft && bottom > top) context.fillRect(inkLeft,top,inkRight-inkLeft,bottom-top);
    }
  }
  return true;
}
