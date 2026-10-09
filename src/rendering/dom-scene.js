import {PaintScene, parseColor, splitCSS} from './scene.js';
import {intersect} from './policy.js';
import {solidBackgroundLayers, paintBackgroundLayers, preserveBackgroundEdges} from './background.js';
import {requiresNativeShadowPaint} from './style-activity.js';
import {hasPartialAlpha, canvasBackground} from './paint-compat.js';
const SKIP = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'NOSCRIPT', 'TEMPLATE', 'HEAD']);
const NATIVE = new Set(['INPUT', 'TEXTAREA', 'SELECT', 'OPTION', 'IFRAME', 'VIDEO', 'AUDIO', 'CANVAS', 'SVG', 'IMG', 'OBJECT', 'EMBED', 'TABLE', 'METER', 'PROGRESS']);
const rectOf = rect => [rect.left, rect.top, rect.width, rect.height];
const number = value => Number.parseFloat(value) || 0;
const STYLE_KEYS = ['color','display','visibility','position','zIndex','overflowX','overflowY','boxShadow','outlineWidth','outlineStyle','opacity','filter','backdropFilter','mixBlendMode','clipPath','maskImage','writingMode','transform','borderImageSource','backgroundColor','backgroundImage','backgroundSize','backgroundPosition','backgroundRepeat','backgroundOrigin','backgroundClip','direction','letterSpacing','textShadow','textDecorationLine','textOverflow','whiteSpace','contentVisibility', ...['Top','Right','Bottom','Left'].flatMap(s=>['Width','Style','Color'].map(p=>'border'+s+p)), ...['TopLeft','TopRight','BottomLeft','BottomRight'].map(s=>'border'+s+'Radius')];
// The first direct summary is the only painted child of closed <details>.
// Hidden disclosure content can still return nonzero DOM/Range rectangles;
// measuring it can even force layout. Never infer paint visibility from those
// rectangles or from computed display alone.
// https://html.spec.whatwg.org/multipage/interactive-elements.html#the-details-element
function summaryOf(node) { return [...node.children].find(child => child.tagName === 'SUMMARY') || null; }
function paintedChildren(node) {
  if (node.tagName === 'DETAILS' && !node.open) { const summary = summaryOf(node); return summary ? [summary] : []; }
  return node.childNodes;
}
function shadowParts(value) {
  if (!value || value === 'none') return [];
  return splitCSS(value).map(part => {
    const color = part.match(/rgba?\([^)]*\)|#[\da-f]+/i)?.[0];
    if (!color) throw new Error('Unsupported shadow color');
    const inset = /\binset\b/.test(part), dims = part.replace(color, '').replace(/\binset\b/, '').trim().split(/\s+/).map(number);
    if (dims[2] || dims[3]) throw new Error('Blurred or spread shadow');
    return {color: parseColor(color), x: dims[0] || 0, y: dims[1] || 0, inset};
  });
}
/** DOM is the layout/input/accessibility authority; this adapter emits GPU paint,
 * not bitmap snapshots of HTML. Unsupported/native subtrees are explicit holes.
 */
export class DOMScene {
  constructor(document, atlas) { this.document = document; this.view = document.defaultView; this.atlas = atlas; this.styles = new WeakMap(); this.order = new WeakMap(); this.range = document.createRange(); }
  clear() {
    this.styles = new WeakMap(); this.order = new WeakMap(); this.boxes = new WeakMap();
    this.elements = new Set(); this.scene = null; this.selection = null;
    this.range = this.document.createRange();
  }
  build(policy) {
    const view = this.view, width = view.innerWidth, height = view.innerHeight;
    const scene = new PaintScene(width, height, {dpr: view.devicePixelRatio || 1, pixelSnap: policy.pixelSnap});
    this.elements = new Set(); this.boxes = new WeakMap();
    this.scene = scene; this.policy = policy; this.selection = this.document.getSelection(); this.atlas.begin();
    let backdrop;
    try { backdrop = canvasBackground(this.style(this.document.documentElement), this.style(this.document.body)); }
    catch { backdrop = {propagated: false, native: true}; }
    this.propagatedBodyBackground = backdrop.propagated;
    if (backdrop.native) scene.native(scene.clip, scene.clip, 'native canvas background');
    else scene.add(scene.clip, backdrop.color);
    this.element(this.document.body, scene.clip, 0);
    return scene;
  }
  // One border-box/layout metric read per element per build. Read all required
  // metrics before painting; never hold geometry across a browser layout change.
  // Source: https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing
  rect(node) {
    let box = this.boxes.get(node);
    if (!box) { box = {rect: rectOf(node.getBoundingClientRect())}; this.boxes.set(node,box); }
    return box.rect;
  }
  box(node) {
    this.rect(node);
    const box = this.boxes.get(node);
    if (!box.measured) {
      box.width = node.offsetWidth; box.height = node.offsetHeight;
      box.clientWidth = node.clientWidth; box.clientHeight = node.clientHeight;
      box.clientLeft = node.clientLeft; box.clientTop = node.clientTop; box.measured = true;
    }
    return box;
  }
  style(node) {
    let style = this.styles.get(node);
    if (!style) {
      const computed = this.view.getComputedStyle(node); style = {};
      for (const key of STYLE_KEYS) style[key] = computed[key];
      this.styles.set(node, style);
    }
    return style;
  }
  fontStyle(node, style) {
    // Native text is drawn by the browser. Reading and serializing the full
    // computed font shorthand for every geometry node was unnecessary work.
    // Only atlas-eligible text needs these properties; cache them with its style.
    if (style.font === undefined) {
      const computed = this.view.getComputedStyle(node);
      for (const key of ['font','fontWeight','fontSize','fontFamily','fontKerning']) style[key] = computed[key];
    }
    return style;
  }
  invalidateChildren(node) { this.order.delete(node); }
  invalidateStyles(node = null) {
    this.order = new WeakMap();
    if (!node || node === this.document.body || node === this.document.documentElement || node === this.document.head) { this.styles = new WeakMap(); return; }
    if (node.nodeType !== 1) node = node.parentElement;
    if (!node) return;
    this.styles.delete(node); for (const child of node.querySelectorAll('*')) this.styles.delete(child);
  }
  native(node, rect, clip, reason) {
    // Shadows/outlines and descendants can extend beyond a native element's border box.
    const style = this.style(node); let [x, y, w, h] = rect, right = x + w, bottom = y + h;
    if (!NATIVE.has(node.tagName.toUpperCase()) && style.contentVisibility !== 'hidden' && (style.overflowX === 'visible' || style.overflowY === 'visible')) {
      // Walk the paint tree, not querySelectorAll: a rounded/themed ancestor
      // must not reveal hidden tool results or clear unrelated GPU text. Keep
      // the existing budget and include visible overflow of opened results.
      let count = 0;
      const pending = [paintedChildren(node)[Symbol.iterator]()];
      while (pending.length) {
        const next = pending.at(-1).next();
        if (next.done) { pending.pop(); continue; }
        const child = next.value;
        if (child.nodeType !== 1) continue;
        if (++count > 2000) { x = 0; y = 0; right = this.scene.width; bottom = this.scene.height; break; }
        if (SKIP.has(child.tagName.toUpperCase()) || child.hasAttribute('data-vb-render-layer') || child.hidden) continue;
        const childStyle = this.style(child);
        if (childStyle.display === 'none') continue;
        const r = this.rect(child);
        if (r[2] && r[3]) { x = Math.min(x, r[0]); y = Math.min(y, r[1]); right = Math.max(right, r[0] + r[2]); bottom = Math.max(bottom, r[1] + r[3]); }
        if (childStyle.contentVisibility !== 'hidden') pending.push(paintedChildren(child)[Symbol.iterator]());
      }
    }
    const pad = style.boxShadow !== 'none' || number(style.outlineWidth) ? 4 : 1;
    this.scene.native([x - pad, y - pad, right - x + pad * 2, bottom - y + pad * 2], clip, reason);
  }
  unsupported(node, style) {
    // Preserve the browser's disclosure marker (including its open state) and
    // the synthesized label when no direct summary is present. Only this
    // small native island is needed; opened result bodies still use GPU paint.
    if ((node.tagName === 'SUMMARY' && node.parentElement?.tagName === 'DETAILS' && summaryOf(node.parentElement) === node) ||
        (node.tagName === 'DETAILS' && !summaryOf(node))) return 'native disclosure summary';
    if (requiresNativeShadowPaint(node) || NATIVE.has(node.tagName.toUpperCase()) || node.isContentEditable || node.matches('[data-vb-native-render],.code-editor,.source-editor,.editor-container,.vb-richtext')) return 'native control, image or editor';
    if (number(style.opacity) !== 1 || style.filter !== 'none' || (style.backdropFilter && style.backdropFilter !== 'none') || style.mixBlendMode !== 'normal') return 'native compositing';
    if (style.clipPath !== 'none' || (style.maskImage && style.maskImage !== 'none') || style.writingMode !== 'horizontal-tb') return 'native clipping or writing mode';
    if (style.transform !== 'none') {
      const m = new this.view.DOMMatrixReadOnly(style.transform);
      if (!m.is2D || m.b || m.c || m.a <= 0 || m.d <= 0) return 'rotated or 3D transform';
    }
    if (['TopLeft', 'TopRight', 'BottomLeft', 'BottomRight'].some(side => number(style['border' + side + 'Radius']) > 0)) return 'rounded border';
    if (style.borderImageSource !== 'none') return 'border image';
    if (style.outlineStyle !== 'none' && number(style.outlineWidth)) return 'native focus outline';
    for (const pseudo of ['::before', '::after']) {
      if (!(pseudo in style)) { const p = this.view.getComputedStyle(node, pseudo); style[pseudo] = p.display !== 'none' && !['none', 'normal', ''].includes(p.content); }
      if (style[pseudo]) return 'generated content';
    }
    return null;
  }
  element(node, clip, depth) {
    if (depth > 160 || this.scene.stats.elements > 20000) throw new Error('UI scene traversal budget exceeded');
    if (SKIP.has(node.tagName.toUpperCase()) || node.hasAttribute('data-vb-render-layer')) return;
    const style = this.style(node);
    if (style.display === 'none' || node.hidden) return;
    this.elements.add(node);
    // visibility may be overridden by a descendant, so do not drop the subtree.
    const visible = style.visibility === 'visible', rect = this.rect(node);
    const area = intersect(rect, clip), inView = area[2] > 0 && area[3] > 0;
    if (!inView && style.overflowX !== 'visible' && style.overflowY !== 'visible') return;
    this.scene.stats.elements++;
    if (visible && inView) {
      const reason = this.unsupported(node, style);
      if (reason) { this.native(node, rect, clip, reason); return; }
    }
    const box = this.box(node);
    const scaleX = box.width ? rect[2] / box.width : 1, scaleY = box.height ? rect[3] / box.height : 1;
    let borders, shadows, background, gradient, layers, backgroundRects;
    try {
      if (!style.paint) {
        const sourceBorders = ['Top', 'Right', 'Bottom', 'Left'].map(side => ({width: number(style['border' + side + 'Width']), style: style['border' + side + 'Style'], color: parseColor(style['border' + side + 'Color'])}));
        if (sourceBorders.some(b => b.width && !['solid', 'none', 'hidden'].includes(b.style))) throw new Error('non-solid border');
        if (sourceBorders.some(b => b.width && b.color[3] === 0) && sourceBorders.some(b => b.width && b.color[3] > 0)) throw new Error('CSS border wedge');
        const layered = splitCSS(style.backgroundImage || 'none').length > 1;
        style.paint = {borders: sourceBorders, shadows: shadowParts(style.boxShadow), background: parseColor(style.backgroundColor), gradient: layered ? null : this.gradient(style.backgroundImage), layers: layered ? solidBackgroundLayers(style) : null};
      }
      const paint = node === this.document.body && this.propagatedBodyBackground
        ? {...style.paint, background: [0, 0, 0, 0], gradient: null, layers: null} : style.paint;
      if (hasPartialAlpha(paint)) throw new Error('native alpha compositing');
      borders = scaleX === 1 && scaleY === 1 ? style.paint.borders : style.paint.borders.map((b, i) => ({...b, width: b.width * (i % 2 ? scaleX : scaleY)}));
      ({shadows, background, gradient, layers} = paint);
    } catch (error) { if (visible && inView) this.native(node, rect, clip, error.message); else this.children(node, clip, depth); return; }
    if (visible && inView) {
      for (const s of [...shadows].reverse()) if (!s.inset) this.scene.add([rect[0] + s.x * scaleX, rect[1] + s.y * scaleY, rect[2], rect[3]], s.color, {clip});
      this.scene.add(rect, background, {clip});
      if (gradient) this.scene.add(rect, gradient.start, {clip, color2: gradient.end, vertical: gradient.vertical});
      if (layers) { backgroundRects = paintBackgroundLayers(this.scene, rect, intersect(rect,clip), layers); this.scene.stats.gpuBackgroundLayers = (this.scene.stats.gpuBackgroundLayers || 0) + layers.length; }
      const [t, r, b, l] = borders.map(item => item.width), [x, y, w, h] = rect;
      // CSS solid border corners are split diagonally. Use native corner squares
      // for multicolor bevels; long edges remain native GPU primitives.
      this.scene.add([x + l, y, w - l - r, t], borders[0].color, {clip});
      this.scene.add([x + w - r, y + t, r, h - t - b], borders[1].color, {clip});
      this.scene.add([x + l, y + h - b, w - l - r, b], borders[2].color, {clip});
      this.scene.add([x, y + t, l, h - t - b], borders[3].color, {clip});
      for (const corner of [[x, y, l, t], [x + w - r, y, r, t], [x, y + h - b, l, b], [x + w - r, y + h - b, r, b]]) if (corner[2] && corner[3] && borders.some(edge=>edge.color[3]>0)) this.scene.add(corner, [0, 0, 0, 0], {clip, hole: true});
      const inner = [x + l, y + t, w - l - r, h - t - b];
      for (const s of [...shadows].reverse()) if (s.inset) {
        const sx = s.x * scaleX, sy = s.y * scaleY;
        if (sx) this.scene.add([sx > 0 ? inner[0] : inner[0] + inner[2] + sx, inner[1], Math.abs(sx), inner[3]], s.color, {clip});
        if (sy) this.scene.add([inner[0], sy > 0 ? inner[1] : inner[1] + inner[3] + sy, inner[2], Math.abs(sy)], s.color, {clip});
      }
      // CSS border rasterization rounds widths and antialiases fractional device
      // edges differently from pixel-snapped GPU quads. Preserve only those thin
      // edge strips, not the entire control, so 125%/150% DPI stays faithful.
      const dpr = this.scene.dpr;
      const fractional = rect.some(value => Math.abs(value - Math.round(value)) > .001) || [...rect, ...borders.map(edge => edge.width), ...shadows.flatMap(shadow => [shadow.x * scaleX, shadow.y * scaleY])].some(value => Math.abs(value * dpr - Math.round(value * dpr)) > .001);
      if (fractional) {
        const pad = 1 / dpr;
        const sx = Math.max(0, ...shadows.map(shadow => Math.abs(shadow.x * scaleX)));
        const sy = Math.max(0, ...shadows.map(shadow => Math.abs(shadow.y * scaleY)));
        for (const edge of [
          [x - sx - pad, y - sy - pad, w + 2 * (sx + pad), t + 2 * (sy + pad)],
          [x - sx - pad, y + h - b - sy - pad, w + 2 * (sx + pad), b + 2 * (sy + pad)],
          [x - sx - pad, y - sy - pad, l + 2 * (sx + pad), h + 2 * (sy + pad)],
          [x + w - r - sx - pad, y - sy - pad, r + 2 * (sx + pad), h + 2 * (sy + pad)]
        ]) this.scene.native(edge, clip, 'fractional CSS edge');
      }
      if (backgroundRects) preserveBackgroundEdges(this.scene, backgroundRects, intersect(rect,clip));
    }
    let childClip = clip;
    if (style.overflowX !== 'visible' || style.overflowY !== 'visible') {
      const own = [rect[0] + box.clientLeft * scaleX, rect[1] + box.clientTop * scaleY, box.clientWidth * scaleX, box.clientHeight * scaleY];
      childClip = intersect(clip, [style.overflowX === 'visible' ? clip[0] : own[0], style.overflowY === 'visible' ? clip[1] : own[1], style.overflowX === 'visible' ? clip[2] : own[2], style.overflowY === 'visible' ? clip[3] : own[3]]);
    }
    this.children(node, childClip, depth);
    // Native scrollbar thumbs/buttons remain interactive and platform accurate.
    if (visible && inView && borders) {
      const [t, r, b, l] = borders.map(item => item.width);
      const sw = rect[2] - box.clientWidth * scaleX - l - r, sh = rect[3] - box.clientHeight * scaleY - t - b;
      if (box.clientWidth && sw > .5) this.scene.native([rect[0] + rect[2] - r - sw, rect[1] + t, sw, rect[3] - t - b], clip, 'scrollbar');
      if (box.clientHeight && sh > .5) this.scene.native([rect[0] + l, rect[1] + rect[3] - b - sh, rect[2] - l - r, sh], clip, 'scrollbar');
    }
  }
  children(node, clip, depth) {
    if (this.style(node).contentVisibility === 'hidden') return;
    // Read disclosure state before using the cached child order. A caller may
    // render synchronously after changing .open, before MutationObserver runs.
    if (node.tagName === 'DETAILS' && !node.open) {
      for (const child of paintedChildren(node)) this.element(child, clip, depth + 1);
      return;
    }
    // Stable order for the classic IDE's local stacking contexts, including MDI z-order.
    let nodes = this.order.get(node);
    if (!nodes) { nodes = [...node.childNodes].map((child, index) => {
      let z = 0, positioned = false;
      if (child.nodeType === 1) { const style = this.style(child); z = Number(style.zIndex) || 0; positioned = style.position !== 'static'; }
      return {child, index, z, group: z < 0 ? -1 : z > 0 ? 2 : positioned ? 1 : 0};
    }).sort((a, b) => a.group - b.group || a.z - b.z || a.index - b.index);
      this.order.set(node, nodes);
    }
    for (const {child} of nodes) {
      if (child.nodeType === 1) this.element(child, clip, depth + 1);
      else if (child.nodeType === 3 && child.textContent.trim()) this.text(child, clip);
    }
  }
  gradient(value) {
    if (!value || value === 'none') return null;
    if (!value.startsWith('linear-gradient(') || !value.endsWith(')')) throw new Error('native background image');
    const parts = splitCSS(value.slice(16, -1));
    if (parts.length !== 3 || !['90deg', '180deg', 'to right', 'to bottom', '270deg', '0deg'].includes(parts[0])) throw new Error('native gradient');
    let start = parseColor(parts[1]), end = parseColor(parts[2]);
    if (parts[0] === '270deg' || parts[0] === '0deg') [start, end] = [end, start];
    return {start, end, vertical: ['180deg', '0deg', 'to bottom'].includes(parts[0])};
  }
  text(node, clip) {
    const style = this.style(node.parentElement); if (style.visibility !== 'visible') return;
    const range = this.range; range.selectNodeContents(node);
    const rectangles = [...range.getClientRects()].map(rectOf).filter(r => r[2] && r[3]);
    if (!rectangles.length) return;
    const native = this.policy.text !== 'gpu' || style.textShadow !== 'none' || style.textDecorationLine !== 'none' || style.direction !== 'ltr' || style.letterSpacing !== 'normal' || Math.abs((this.box(node.parentElement).rect[2] / (this.box(node.parentElement).width || 1)) - 1) > .01 || (this.selection?.rangeCount && this.selection.containsNode(node, true));
    if (native || rectangles.length !== 1 || style.textOverflow === 'ellipsis' || this.style(node.parentElement).transform !== 'none') {
      for (const rect of rectangles) this.scene.native([rect[0] - 1, rect[1] - 1, rect[2] + 2, rect[3] + 2], clip, 'native text');
      this.scene.stats.nativeText++; return;
    }
    const rect = rectangles[0]; let text = node.textContent;
    if (!style.whiteSpace.startsWith('pre')) text = text.replace(/\s+/g, ' ');
    const glyph = this.atlas.text(text, this.fontStyle(node.parentElement, style), rect, this.scene.dpr);
    if (!glyph) { this.scene.native(rect, clip, 'text atlas capacity'); return; }
    this.scene.add(glyph.rect, [1, 1, 1, 1], {clip, page: glyph.page, uv: glyph.uv, snap: false}); this.scene.stats.gpuText++;
  }
}
