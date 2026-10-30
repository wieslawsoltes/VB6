import {physicalSize} from './policy.js';
import {rgbaCSS} from './scene.js';
const same4 = (a, b) => a === b || !!(a && b && a[0] === b[0] && a[1] === b[1] && a[2] === b[2] && a[3] === b[3]);
export class CanvasPainter {
  constructor(canvas, {onLost = () => {}, onRestored = () => {}, willReadFrequently = false} = {}) {
    this.canvas = canvas; this.context = canvas.getContext('2d', {alpha: true, willReadFrequently: !!willReadFrequently});
    if (!this.context) throw new Error('Canvas2D context unavailable');
    this.lost = false; this.disposed = false;
    this.contextLost = () => { if (!this.disposed && !this.lost) { this.lost = true; onLost('Canvas2D context lost'); } };
    this.contextRestored = () => { if (!this.disposed && this.lost) { this.lost = false; onRestored(); } };
    canvas.addEventListener?.('contextlost', this.contextLost); canvas.addEventListener?.('contextrestored', this.contextRestored);
    this.name = 'canvas2d'; this.stats = {readbackRequested: !!willReadFrequently, frames: 0, drawCalls: 0, uploadedBytes: 0, clipChanges: 0, fillStyleChanges: 0};
  }
  render(scene) {
    if (!this.context || this.disposed) throw new Error('Renderer disposed');
    if (this.lost || this.context.isContextLost?.()) throw new Error('Canvas2D context lost');
    const size = physicalSize(scene.width, scene.height, scene.dpr);
    if (this.canvas.width !== size.width) this.canvas.width = size.width;
    if (this.canvas.height !== size.height) this.canvas.height = size.height;
    const ctx = this.context; ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, size.width, size.height); ctx.setTransform(size.scaleX, 0, 0, size.scaleY, 0, 0);
    ctx.imageSmoothingEnabled = false;
    let clip = null, color = null, saved = false, clipChanges = 0, fillStyleChanges = 0;
    // Reuse only adjacent clip runs. Never reorder primitives or combine paths:
    // transparent holes, overlapping alpha and texture updates retain their order.
    // https://html.spec.whatwg.org/multipage/canvas.html#the-canvas-state
    try {
      for (const c of scene.commands) {
        if (!same4(clip, c.clip)) {
          if (saved) { ctx.restore(); saved = false; }
          ctx.save(); saved = true; ctx.beginPath(); ctx.rect(...c.clip); ctx.clip();
          clip = c.clip; color = null; clipChanges++;
        }
        if (c.hole) ctx.clearRect(...c.rect);
        else if (c.page) ctx.drawImage(c.page.canvas, c.uv[0] * c.page.width, c.uv[1] * c.page.height, c.uv[2] * c.page.width, c.uv[3] * c.page.height, ...c.rect);
        else {
          // Keep explicitly authored gradients, even with equal endpoints:
          // Canvas gradient alpha quantization can differ from a solid fill.
          if (c.color !== c.color2) {
            const [x, y, w, h] = c.rect, g = ctx.createLinearGradient(x, y, c.vertical ? x : x + w, c.vertical ? y + h : y);
            g.addColorStop(0, rgbaCSS(c.color)); g.addColorStop(1, rgbaCSS(c.color2)); ctx.fillStyle = g;
            color = null; fillStyleChanges++;
          } else if (!same4(color, c.color)) {
            ctx.fillStyle = rgbaCSS(c.color); color = c.color; fillStyleChanges++;
          }
          ctx.fillRect(...c.rect);
        }
      }
    } finally { if (saved) ctx.restore(); }
    this.stats.frames++; this.stats.drawCalls = scene.commands.length;
    this.stats.clipChanges = clipChanges; this.stats.fillStyleChanges = fillStyleChanges;
  }
  dispose() {
    if (this.disposed) return; this.disposed = true;
    this.canvas.removeEventListener?.('contextlost', this.contextLost); this.canvas.removeEventListener?.('contextrestored', this.contextRestored);
    this.canvas.width = this.canvas.height = 1; this.context = null;
  }
}
