import {parseColor} from './scene.js';
/** A canvas overlay cannot alpha-blend a CSS paint over its already painted
 * DOM equivalent: that would apply its opacity twice. Opaque colors and fully
 * transparent no-ops are safe. All partial alpha stays browser-native.
 * https://www.w3.org/TR/compositing-1/#simplealphacompositing
 */
export function hasPartialAlpha(paint) {
  const partial = color => color && color[3] > 0 && color[3] < 1;
  return partial(paint.background) || (paint.gradient && (paint.gradient.start[3] < 1 || paint.gradient.end[3] < 1) && (paint.gradient.start[3] > 0 || paint.gradient.end[3] > 0)) ||
    paint.borders.some(edge => edge.width > 0 && partial(edge.color)) ||
    paint.shadows.some(shadow => partial(shadow.color)) ||
    (paint.layers || []).some(layer => partial(layer.color));
}

/** Root/background propagation uses used paint, not blindly the body's
 * computed background. A nontransparent root background prevents propagation.
 * Unknown/partial-alpha canvas paint stays transparent to the native backdrop.
 * https://www.w3.org/TR/css-backgrounds-3/#special-backgrounds
 */
export function canvasBackground(root, body) {
  const rootColor = parseColor(root.backgroundColor);
  const propagated = rootColor[3] === 0 && root.backgroundImage === 'none';
  const style = propagated ? body : root;
  const color = parseColor(style.backgroundColor);
  return {propagated, color, native: color[3] !== 1 || style.backgroundImage !== 'none'};
}

/** Native overflow clips and Canvas/GPU clips need not cover the same fraction
 * of a boundary device pixel. Painting that partial pixel over the already
 * clipped DOM blends the row/background twice. Preserve only a narrow coverage
 * strip AFTER descendants: their opaque fills can otherwise refill an earlier
 * parent-border hole. The interior remains retained canvas/GPU paint.
 * https://www.w3.org/TR/css-overflow-3/#overflow-properties
 * https://www.w3.org/TR/compositing-1/#simplealphacompositing
 */
export function preserveOverflowEdges(scene, bounds, clip, clipX, clipY) {
  const [x, y, width, height] = bounds, dpr = scene.dpr;
  if (width <= 0 || height <= 0) return;
  const edge = (coordinate, start, extent, vertical) => {
    const pixel = coordinate * dpr;
    if (Math.abs(pixel - Math.round(pixel)) < 1e-6) return;
    // clientWidth/clientHeight are integral layout metrics; their transformed
    // clip can straddle the browser's snapped padding edge. Retain the coverage
    // pixel and a one-device-pixel halo, not a full native scroll container.
    const low = (Math.floor(pixel) - 1) / dpr;
    scene.native(vertical ? [low, start, 3 / dpr, extent] : [start, low, extent, 3 / dpr],
      clip, 'fractional overflow clip');
  };
  if (clipX) { edge(x, y, height, true); edge(x + width, y, height, true); }
  if (clipY) { edge(y, x, width, false); edge(y + height, x, width, false); }
}
