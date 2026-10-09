/** All model data crosses these bounds. No DOM, network or code evaluation in the core. */
export const LIMITS = Object.freeze({source: 100000, depth: 40, nodes: 2000, steps: 100000, items: 2000, text: 100000, dataBytes: 500000});
export class UIError extends Error {
  constructor(code, message, offset = 0) { super(message); this.name = 'UIError'; this.code = code; this.offset = offset; }
}
export const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
export function safeKey(key) {
  if (typeof key !== 'string' || ['__proto__', 'prototype', 'constructor', '__defineGetter__', '__defineSetter__', '__lookupGetter__', '__lookupSetter__'].includes(key)) throw new UIError('unsafe_key', 'Unsafe property name.');
  return key;
}
export function boundedData(value, limit = LIMITS.dataBytes, {maxText = LIMITS.text} = {}) {
  if (!Number.isSafeInteger(maxText) || maxText < 1 || maxText > 250000) throw new UIError('data_limit', 'Invalid text allowance.');
  let size = 0, nodes = 0; const active = new Set();
  const visit = (value, depth) => {
    if (depth > LIMITS.depth || ++nodes > 20000) throw new UIError('data_limit', 'UI data is too deeply nested or too large.');
    if (value === null || typeof value === 'boolean') { size += 5; return value; }
    if (typeof value === 'number') { if (!Number.isFinite(value)) throw new UIError('data_number', 'UI numbers must be finite.'); size += 24; return value; }
    if (typeof value === 'string') { size += value.length * 2 + 2; if (size > limit || value.length > maxText) throw new UIError('data_limit', 'UI data exceeds its size limit.'); return value; }
    if ((!Array.isArray(value) && !record(value)) || active.has(value)) throw new UIError('data_type', 'UI data must be acyclic JSON, without functions or host objects.');
    active.add(value); const result = Array.isArray(value) ? [] : Object.create(null), keys = Object.keys(value);
    if (keys.length > LIMITS.items) throw new UIError('data_limit', 'UI collection exceeds its item limit.');
    for (const key of keys) { safeKey(key); size += key.length * 2 + 4; if (size > limit) throw new UIError('data_limit', 'UI data exceeds its size limit.'); const descriptor = Object.getOwnPropertyDescriptor(value, key); if (!descriptor || !('value' in descriptor)) throw new UIError('data_type', 'UI data cannot contain accessors.'); result[key] = visit(descriptor.value, depth + 1); }
    active.delete(value); return result;
  };
  const result = visit(value, 0); if (size > limit) throw new UIError('data_limit', 'UI data exceeds its size limit.'); return result;
}
export function safeUrl(value) {
  if (typeof value !== 'string' || value.length > 4096) throw new UIError('unsafe_url', 'Expected a bounded HTTP(S) URL.');
  let url; try { url = new URL(value); } catch { throw new UIError('unsafe_url', 'Invalid URL.'); }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new UIError('unsafe_url', 'Only HTTP(S) URLs without credentials are permitted.');
  return url.href;
}
export function display(value) {
  if (value == null || typeof value === 'function' || typeof value === 'object') return '';
  const text = String(value); if (text.length > LIMITS.text) throw new UIError('text_limit', 'Rendered text is too large.'); return text;
}
export function budget(limit = LIMITS.steps) {
  return {left: limit, depth: 0, tick(amount = 1) { if ((this.left -= amount) < 0) throw new UIError('budget', 'UI evaluation budget exhausted.'); }};
}
