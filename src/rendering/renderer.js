import {renderingEnvironment} from './diagnostics.js';
import {normalizeRendering, renderingCandidates} from './policy.js';
import {CanvasPainter} from './canvas2d.js';
import {WebGPUPainter} from './webgpu.js';
import {WebGLPainter} from './webgl2.js';
import {TextAtlas} from './atlas.js';
import {DOMScene} from './dom-scene.js';
import {RetainedScene} from './retained-scene.js';
import {subscribeStyleActivity} from './style-activity.js';
import {canReuseTextStyles, redundantPointerOver} from './mutations.js';
const sessions = new WeakMap();
export async function createPainter(name, canvas, options = {}) {
  if (name === 'webgpu') return WebGPUPainter.create(canvas, options);
  if (name === 'webgl2') return new WebGLPainter(canvas, options);
  if (name === 'canvas2d') return new CanvasPainter(canvas, options);
  if (name === 'html') return null;
  throw new TypeError('Unknown rendering backend: ' + name);
}
/** One demand-rendered visual layer per Document. The semantic DOM never moves,
 * becomes inert, or loses its hit targets, selection, IME, forms or accessibility.
 */
export class UIRenderer {
  constructor(document, policy = {}, {factory = createPainter, sceneFactory} = {}) {
    this.document = document; this.view = document.defaultView; this.factory = factory; this.generation = 0; this.disposed = false;
    this.atlas = new TextAtlas(document); this.adapter = new DOMScene(document, this.atlas); this.sceneFactory = sceneFactory || (p => this.adapter.build(p));
    this.policy = normalizeRendering(policy); this.backend = 'html'; this.attempts = []; this.metrics = {frames: 0, invalidations: 0, builds: [], submissions: [], last: null}; this.listeners = [];
    this.retained = new RetainedScene(); this.observedElements = new Set(); this.pointerTargets = new Map();
    this.resizeTargetsTask = null; this.pendingResizeTargets = null;
    this.frame = null; this.metrics.textStyleReuses = 0;
    this.metrics.unchangedFrames = 0; this.metrics.sceneBuilds = 0;
    this.observe(); this.ready = this.setOptions(policy, {force: true});
  }
  listen(target, type, listener, options) { target?.addEventListener(type, listener, options); this.listeners.push(() => target?.removeEventListener(type, listener, options)); }
  observe() {
    const invalidate = event => {
      if (!this.driver) return; // HTML-only mode does not build/measure a GPU scene.
      if (redundantPointerOver(event, this.pointerTargets)) {
        this.metrics.redundantPointerOvers = (this.metrics.redundantPointerOvers || 0) + 1; return;
      }
      // Resource completion and form validity/checked/active/popover pseudo
      // classes can change styles without an attribute mutation. Scroll and
      // selection alone reuse style snapshots; every other wake-up resamples.
      if (event && !['scroll', 'selectionchange'].includes(event.type)) this.stylesDirty = true;
      this.invalidate();
    };
    this.observer = new this.view.MutationObserver(records => {
      if (!this.driver) return;
      let changed = false;
      for (const r of records) {
        const node = r.target.nodeType === 1 ? r.target : r.target.parentElement;
        if (node?.closest('[data-vb-render-layer]')) continue;
        if (r.type === 'childList' && [...r.addedNodes, ...r.removedNodes].every(n => n.nodeType === 1 && n.hasAttribute('data-vb-render-layer'))) continue;
        changed = true;
        if (canReuseTextStyles(r, node)) {
          // textContent replaces a Text node; do not keep the removed child in
          // cached paint order. CharacterData keeps the existing node identity.
          if (r.type === 'childList') this.adapter.invalidateChildren(node);
          this.metrics.textStyleReuses++;
        } else this.stylesDirty = true;
      }
      if (changed) this.invalidate();
    });
    // Connected only while a canvas backend is active; native HTML incurs no
    // mutation scanning. Include <head> so dynamic stylesheet edits invalidate.
    for (const event of ['load', 'error', 'input', 'change', 'focusin', 'focusout', 'pointerover', 'pointerout', 'pointerdown', 'pointerup', 'pointercancel', 'pointerleave', 'gotpointercapture', 'lostpointercapture', 'keydown', 'keyup', 'toggle', 'beforetoggle', 'selectionchange', 'vb-theme-change']) this.listen(this.document, event, invalidate, true);
    // ResizeObserver catches layout changes which have no DOM mutation (for
    // example intrinsic image sizing or a container resized by a stylesheet).
    // Source: https://www.w3.org/TR/resize-observer/
    this.resizeObserver = typeof this.view.ResizeObserver === 'function' ? new this.view.ResizeObserver(() => {
      if (!this.driver) return;
      this.stylesDirty = true; this.invalidate();
    }) : null;
    for (const event of ['animationstart','animationiteration','animationend','animationcancel','transitionrun','transitionstart','transitionend','transitioncancel']) this.listen(this.document, event, invalidate, true);
    this.listen(this.document, 'scroll', invalidate, true);
    this.listen(this.view, 'resize', invalidate);
    this.listen(this.view, 'blur', () => { this.pointerTargets.clear(); invalidate(); });
    this.listen(this.view.visualViewport, 'resize', invalidate);
    this.listen(this.view.visualViewport, 'scroll', invalidate);
    this.listen(this.document, 'visibilitychange', () => { if (this.document.hidden) this.cancelFrame(); else invalidate(); });
    this.listen(this.view, 'pagehide', event => {
      if (event.persisted) this.cancelFrame(); else this.dispose();
    });
    this.listen(this.view, 'pageshow', event => {
      if (event.persisted && !this.disposed) this.ready = this.setOptions(this.policy, {force: true});
    });
    this.listen(this.view, 'beforeprint', () => { this.printing = true; this.cancelFrame(); if (this.canvas) this.canvas.style.visibility = 'hidden'; });
    this.listen(this.view, 'afterprint', () => { this.printing = false; this.stylesDirty = true; this.retained.clear(); invalidate(); });
    this.listen(this.document.fonts, 'loadingdone', () => { this.atlas.reset(); this.stylesDirty = true; invalidate(); });
    this.forcedColors = this.view.matchMedia('(forced-colors: active)');
    this.listen(this.forcedColors, 'change', () => { this.ready = this.setOptions(this.policy, {force: true}); });
    for (const media of ['(prefers-color-scheme: dark)','(prefers-reduced-motion: reduce)','(prefers-contrast: more)']) {
      this.listen(this.view.matchMedia(media),'change',()=>this.invalidateStyles());
    }
    this.armDPR();
  }
  armDPR() {
    this.dprCleanup?.();
    const query = this.view.matchMedia(`(resolution: ${this.view.devicePixelRatio || 1}dppx)`);
    const changed = () => { this.atlas.reset(); this.stylesDirty = true; this.armDPR(); this.invalidate(); };
    query.addEventListener('change', changed); this.dprCleanup = () => query.removeEventListener('change', changed);
  }
  canvasForBackend() {
    const canvas = this.document.createElement('canvas'); canvas.dataset.vbRenderLayer = ''; canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;margin:0;padding:0;border:0;pointer-events:none;z-index:2147483000;visibility:hidden;contain:strict';
    this.document.documentElement.append(canvas); return canvas;
  }
  /** Re-probe the saved policy, including a previously failed preferred GPU. */
  retry() { this.ready = this.setOptions(this.policy, {force: true}); return this.ready; }
  async setOptions(value, {force = false} = {}) {
    if (this.disposed) return this.getStats();
    const next = normalizeRendering(value), old = this.policy;
    this.policy = next;
    this.document.dispatchEvent(new this.view.CustomEvent('vb-rendering-policy', {detail: {...next, fallbacks: [...next.fallbacks]}}));
    if (!force && old.backend === next.backend && JSON.stringify(old.fallbacks) === JSON.stringify(next.fallbacks) && this.driver) {
      // An unchanged Options apply must not evict atlas textures or queue work.
      // A changed paint policy must be submitted before this promise resolves,
      // just like a backend change; callers must not observe old snapped/text
      // output after awaiting setOptions(). The device itself is retained.
      if (old.text === next.text && old.pixelSnap === next.pixelSnap) return this.getStats();
      if (old.text !== next.text) this.atlas.reset();
      try { this.renderNow(); this.publish(); }
      catch (error) { this.fallback(error.message || String(error)); await this.ready; }
      return this.getStats();
    }
    const generation = ++this.generation; this.cancelFrame(); this.releaseDriver(); this.attempts = [];
    const candidates = this.forcedColors.matches ? ['html'] : renderingCandidates(next);
    this.candidates = candidates; this.candidateIndex = -1; this.initializing = true; this.publish();
    return this.activate(candidates, 0, generation);
  }
  async activate(candidates, start, generation) {
    for (let index = start; index < candidates.length; index++) {
      if (this.disposed || generation !== this.generation) return this.getStats();
      const name = candidates[index]; this.candidateIndex = index;
      if (name === 'html') { this.backend = 'html'; this.initializing = false; this.publish(); return this.getStats(); }
      const canvas = this.canvasForBackend(); let painter;
      try {
        // Retained document layers skip unchanged frames. Preserve their WebGL
        // drawing buffer across browser compositing; an ephemeral backbuffer
        // can otherwise publish the preceding workspace colors in WebKit.
        // This is a context-creation contract, not a GPU fence/readback or an
        // idle repaint loop. Low-level/benchmark painters keep their default.
        // https://registry.khronos.org/webgl/specs/latest/1.0/#2.2
        // The retained Canvas2D layer also needs reliable presentation between
        // submissions. WebKit can retain stale composited tiles despite correct
        // bitmap pixels; the readback-optimized context avoided this in repeated
        // HTTP/file trials. Request it at creation, never through readback fences
        // or repaint loops. GPU backends and standalone painters are unchanged.
        // This standard hint may select a software bitmap; it is not a guarantee
        // of CPU storage or an assertion that a frame has reached the display.
        // https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently
        const contextOptions = name === 'webgl2' ? {preserveDrawingBuffer: true}
          : name === 'canvas2d' ? {willReadFrequently: true} : {};
        painter = await this.factory(name, canvas, {...contextOptions, onLost: reason => {
          if (!this.disposed && this.generation === generation && this.driver === painter) this.fallback(reason);
        }});
        if (this.disposed || generation !== this.generation) { painter?.dispose(); canvas.remove(); return this.getStats(); }
        this.canvas = canvas; this.driver = painter; this.backend = name; this.stylesDirty = true;
        this.observer.observe(this.document.documentElement, {childList: true, subtree: true, attributes: true, characterData: true, characterDataOldValue: true});
        this.releaseStyleActivity = subscribeStyleActivity(this.view, () => { this.stylesDirty = true; this.invalidate(); });
        this.renderNow();
        if (this.driver === painter) { this.initializing = false; this.publish(); }
        return this.getStats();
      } catch (error) {
        painter?.dispose(); canvas.remove();
        if (this.disposed || generation !== this.generation) return this.getStats();
        // The first frame can fail after observe() connected. HTML fallback
        // must not retain an observer (or a queued frame) from the failed driver.
        this.cancelFrame(); this.releaseStyleActivity?.(); this.releaseStyleActivity = null; this.observer.disconnect(); this.disconnectResizeTargets();
        this.observedElements.clear(); this.pointerTargets?.clear(); this.retained.clear(); this.adapter?.clear?.(); this.atlas?.reset?.(); this.animating = false;
        this.driver = null; this.canvas = null; this.backend = 'html';
        this.attempts.push({backend: name, reason: error.message || String(error), ...(typeof error.code === 'string' ? {code: error.code} : {}), ...(error.attempts?.length ? {details: error.attempts} : {})});
      }
    }
    this.backend = 'html'; this.initializing = false; this.publish(); return this.getStats();
  }
  fallback(reason) {
    if (this.disposed) return;
    this.attempts.push({backend: this.backend, reason}); this.cancelFrame(); this.releaseDriver();
    const generation = ++this.generation; this.initializing = true; this.publish();
    this.ready = this.activate(this.candidates || ['html'], this.candidateIndex + 1, generation);
  }
  /** Explicit integration hook for pre-captured native methods or custom paint. */
  invalidateStyles() { this.stylesDirty = true; this.invalidate(); }
  invalidate() {
    if (this.disposed || this.printing || this.document.hidden || !this.driver) return;
    this.metrics.invalidations++;
    if (this.frame != null) return;
    this.frame = this.view.requestAnimationFrame(() => { this.frame = null; try { this.renderNow(); } catch (error) { this.fallback(error.message || String(error)); } });
  }
  syncResizeTargets() {
    if (!this.resizeObserver || !this.driver || this.disposed) return;
    const next = this.adapter.elements || new Set([this.document.body]);
    const same = next.size === this.observedElements.size && [...next].every(node => this.observedElements.has(node));
    // A caller can render synchronously from its own ResizeObserver callback.
    // Adding a shallower target during that delivery creates skipped observations
    // and a resize-loop error, despite this renderer never changing layout.
    // Defer target registration to a task, NOT a microtask in the delivery loop.
    // Sources: https://www.w3.org/TR/resize-observer/#broadcast-active-observations
    //          https://www.w3.org/TR/resize-observer/#deliver-resize-loop-error
    if (same && !this.resizeTargetsTask) return;
    this.pendingResizeTargets = new Set(next);
    if (this.resizeTargetsTask) return;
    const task = {generation: this.generation, handle: null};
    this.resizeTargetsTask = task;
    task.handle = this.view.setTimeout(() => {
      if (this.resizeTargetsTask !== task) return;
      this.resizeTargetsTask = null;
      const targets = this.pendingResizeTargets; this.pendingResizeTargets = null;
      if (this.disposed || !this.driver || task.generation !== this.generation || !targets) return;
      for (const node of this.observedElements) if (!targets.has(node)) this.resizeObserver.unobserve(node);
      for (const node of targets) if (!this.observedElements.has(node)) this.resizeObserver.observe(node);
      this.observedElements = targets;
    }, 0);
  }
  disconnectResizeTargets() {
    if (this.resizeTargetsTask) this.view.clearTimeout(this.resizeTargetsTask.handle);
    this.resizeTargetsTask = null; this.pendingResizeTargets = null;
    this.resizeObserver?.disconnect(); this.observedElements.clear();
  }
  renderNow({force = false} = {}) {
    if (this.disposed || !this.driver || this.printing || this.document.hidden) return;
    this.cancelFrame();
    const start = this.view.performance.now();
    // Sample active CSS/Web Animations on demand; once they finish or pause,
    // no perpetual RAF loop remains. Animation events invalidate the first frame.
    // Source: https://www.w3.org/TR/web-animations-1/#dom-document-getanimations
    const animations = this.document.getAnimations?.() || [];
    const animating = animations.some(a => (a.playState === 'running' || a.pending) && !a.effect?.target?.closest?.('[data-vb-render-layer]'));
    if (this.stylesDirty || this.animating || animating) { this.adapter.invalidateStyles(); this.stylesDirty = false; }
    this.animating = animating;
    const scene = this.sceneFactory(this.policy);
    const plan = this.retained.update(scene);
    this.syncResizeTargets();
    const built = this.view.performance.now();
    const resized = this.canvas.width !== Math.round(scene.width * scene.dpr) || this.canvas.height !== Math.round(scene.height * scene.dpr);
    const painted = force || resized || plan.changed;
    if (painted) {
      try { this.driver.render(plan.scene); }
      catch (error) {
        // Direct callers may catch an error without invoking fallback(). Never
        // skip their retry because RetainedScene already recorded this plan.
        this.retained.clear(); this.canvas.style.visibility = 'hidden';
        throw error;
      }
      this.metrics.frames++;
    } else this.metrics.unchangedFrames++;
    const submitted = this.view.performance.now();
    this.metrics.sceneBuilds++;
    if (this.canvas.style.visibility !== 'visible') this.canvas.style.visibility = 'visible';
    this.metrics.builds.push(built - start); this.metrics.submissions.push(submitted - built);
    if (this.metrics.builds.length > 120) { this.metrics.builds.shift(); this.metrics.submissions.shift(); }
    this.metrics.last = {buildMs: built - start, submitCpuMs: submitted - built, submitted: painted, commands: scene.commands.length, dpr: scene.dpr, width: this.canvas.width, height: this.canvas.height, ...scene.stats};
    if (animating || this.atlas.needsCompaction) this.invalidate();
  }
  cancelFrame() { if (this.frame != null) this.view.cancelAnimationFrame(this.frame); this.frame = null; }
  publish() {
    this.document.dispatchEvent(new this.view.CustomEvent('vb-rendering-status', {detail: this.getStats()}));
  }
  getStats() {
    const percentile = (array, quantile) => { if (!array.length) return 0; const sorted = [...array].sort((a, b) => a - b); return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * quantile))]; };
    return {policy: normalizeRendering(this.policy), candidates: renderingCandidates(this.policy), countersScope: 'renderer-lifetime', timingsScope: 'active-backend', initializing: !!this.initializing, environment: renderingEnvironment(this.view), styleObservation: this.releaseStyleActivity?.capabilities || null, requested: this.policy.backend, active: this.backend, text: this.policy.text, atlas: this.atlas?.getStats?.() || null, forcedColors: this.forcedColors?.matches || false, attempts: JSON.parse(JSON.stringify(this.attempts)), adapter: this.driver?.adapterInfo ? JSON.parse(JSON.stringify(this.driver.adapterInfo)) : null,
      frames: this.metrics.frames, redundantPointerOvers: this.metrics.redundantPointerOvers || 0, textStyleReuses: this.metrics.textStyleReuses || 0, sceneBuilds: this.metrics.sceneBuilds, unchangedFrames: this.metrics.unchangedFrames, invalidations: this.metrics.invalidations, buildP50Ms: this.driver ? percentile(this.metrics.builds, .5) : 0, buildP95Ms: this.driver ? percentile(this.metrics.builds, .95) : 0, submitCpuP50Ms: this.driver ? percentile(this.metrics.submissions, .5) : 0, submitCpuP95Ms: this.driver ? percentile(this.metrics.submissions, .95) : 0, last: this.driver && this.metrics.last ? JSON.parse(JSON.stringify(this.metrics.last)) : null, driver: this.driver ? {...this.driver.stats} : null};
  }
  releaseDriver() { this.metrics.builds.length = 0; this.metrics.submissions.length = 0; this.metrics.last = null; this.releaseStyleActivity?.(); this.releaseStyleActivity = null; this.observer?.disconnect(); this.disconnectResizeTargets(); this.observedElements.clear(); this.pointerTargets?.clear(); this.retained.clear(); this.adapter?.clear?.(); this.atlas?.reset?.(); this.animating = false; this.stylesDirty = true; this.driver?.dispose(); this.driver = null; this.canvas?.remove(); this.canvas = null; this.backend = 'html'; }
  dispose() {
    if (this.disposed) return; this.disposed = true; this.generation++; this.cancelFrame(); this.observer.disconnect(); this.dprCleanup?.();
    for (const remove of this.listeners.splice(0)) remove(); this.releaseDriver(); this.atlas.dispose();
  }
}
/** Reference-counted integration: multiple runtime hosts can share one document. */
export function retainRenderer(document, policy = {}) {
  let session = sessions.get(document);
  if (!session || session.renderer.disposed) { session = {renderer: new UIRenderer(document, policy), count: 0}; sessions.set(document, session); }
  session.count++;
  let released = false;
  return {renderer: session.renderer, release() {
    if (released) return; released = true;
    if (--session.count === 0) { session.renderer.dispose(); if (sessions.get(document) === session) sessions.delete(document); }
  }};
}
export function rendererForDocument(document) { return sessions.get(document)?.renderer || null; }
