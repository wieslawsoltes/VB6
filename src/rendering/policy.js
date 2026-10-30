/** Serializable, dependency-free rendering policy. HTML is always the final safety net. */
export const BACKENDS = Object.freeze(['webgpu', 'webgl2', 'canvas2d', 'html']);
export const DEFAULT_RENDERING = Object.freeze({backend: 'webgpu', fallbacks: Object.freeze(['webgl2', 'html']), text: 'native', pixelSnap: true});
export const RENDERING_STORAGE_KEY = 'vb6-studio-web.rendering.v1';
export function normalizeRendering(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) value = {};
  const backend = BACKENDS.includes(value.backend) ? value.backend : 'webgpu';
  const input = Array.isArray(value.fallbacks) ? value.fallbacks : DEFAULT_RENDERING.fallbacks;
  const fallbacks = [...new Set(input.filter(item => BACKENDS.includes(item) && item !== backend))];
  // A missing GPU must never turn a working IDE into an invisible or unusable UI.
  if (backend !== 'html' && !fallbacks.includes('html')) fallbacks.push('html');
  return {backend, fallbacks: backend === 'html' ? [] : fallbacks, text: value.text === 'gpu' ? 'gpu' : 'native', pixelSnap: value.pixelSnap !== false};
}
export function renderingCandidates(value) {
  const policy = normalizeRendering(value);
  return [policy.backend, ...policy.fallbacks].slice(0, [policy.backend, ...policy.fallbacks].indexOf('html') + 1 || undefined);
}
export function readRendering(storage) {
  try { return normalizeRendering(JSON.parse(storage?.getItem(RENDERING_STORAGE_KEY) || '{}')); }
  catch { return normalizeRendering(); }
}
export function writeRendering(storage, value) {
  const policy = normalizeRendering(value);
  try { storage?.setItem(RENDERING_STORAGE_KEY, JSON.stringify(policy)); return true; }
  catch { return false; }
}
export function physicalSize(width, height, dpr = 1, limit = 16384, maxPixels = 32 * 1024 * 1024) {
  if (![width, height, dpr].every(Number.isFinite) || width <= 0 || height <= 0 || dpr <= 0) throw new RangeError('Invalid rendering dimensions.');
  const w = Math.max(1, Math.round(width * dpr)), h = Math.max(1, Math.round(height * dpr));
  if (w > limit || h > limit || w * h > maxPixels) throw new RangeError('Native-resolution rendering exceeds the device or memory limit; using the next configured backend.');
  return {width: w, height: h, scaleX: w / width, scaleY: h / height};
}
export function intersect(a, b) {
  const x = Math.max(a[0], b[0]), y = Math.max(a[1], b[1]);
  return [x, y, Math.max(0, Math.min(a[0] + a[2], b[0] + b[2]) - x), Math.max(0, Math.min(a[1] + a[3], b[1] + b[3]) - y)];
}
export function snapRect(rect, dpr = 1) {
  const x = Math.round(rect[0] * dpr) / dpr, y = Math.round(rect[1] * dpr) / dpr;
  return [x, y, Math.round((rect[0] + rect[2]) * dpr) / dpr - x, Math.round((rect[1] + rect[3]) * dpr) / dpr - y];
}
