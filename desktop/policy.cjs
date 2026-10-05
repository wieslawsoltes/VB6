'use strict';
const path = require('node:path');
const ORIGIN = 'vb6://app';
const MAX_WINDOWS = 64;
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; media-src 'self' data: blob:; connect-src 'self'; worker-src 'self' blob:; frame-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'none'";
/** Declared fetch origins are capabilities; never accept wildcards or CSP syntax. */
function dataOrigins(values = []) {
  if (!Array.isArray(values) || values.length > 64) throw new TypeError('At most 64 data origins are allowed');
  return [...new Set(values.map(value => {
    if (typeof value !== 'string' || value.length > 2048 || /[\s*'";]/.test(value)) throw new TypeError('Expected an exact HTTP(S) data origin');
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password || u.pathname !== '/' || u.search || u.hash) throw new TypeError('Expected an exact HTTP(S) data origin');
    return u.origin;
  }))].sort();
}
function dataCSP(origins = []) {
  const allowed = dataOrigins(origins);
  return CSP.replace("connect-src 'self'", "connect-src 'self'" + (allowed.length ? ' ' + allowed.join(' ') : ''));
}
function dataRequestAllowed(details, origins = []) {
  // Fetch and XMLHttpRequest use xhr. Scripts, frames, workers and navigation remain denied.
  if (details.resourceType !== 'xhr') return false;
  try {
    const u = new URL(details.url);
    return ['https:', 'http:'].includes(u.protocol) && !u.username && !u.password && origins.includes(u.origin);
  } catch { return false; }
}
function integer(value, fallback, min, max) {
  if (value === undefined) return fallback;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Expected a finite number');
  return Math.max(min, Math.min(max, Math.round(value)));
}
function text(value, fallback = '', max = 512, multiline = false) {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || value.length > max || (multiline ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/ : /[\u0000-\u001f]/).test(value)) throw new TypeError('Invalid text');
  return value;
}
function trustedURL(value) {
  try { const u = new URL(value); return u.protocol === 'vb6:' && u.host === 'app' && !u.username && !u.password; } catch { return false; }
}
function assetPath(root, url, files) {
  if (!trustedURL(url)) throw new Error('Untrusted origin');
  const name = decodeURIComponent(new URL(url).pathname).replace(/^\//, '') || 'index.html';
  if (name.includes('\\') || name.includes('\0') || name.split('/').some(p => p === '.' || p === '..') || !Object.hasOwn(files, name)) throw new Error('Unknown asset');
  const target = path.resolve(root, name), relative = path.relative(root, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Invalid asset path');
  return target;
}
function clampBounds(value = {}, displays = [{ workArea: { x: 0, y: 0, width: 1920, height: 1080 } }]) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !displays.length) throw new TypeError('Invalid window bounds');
  const areas = displays.map(d => d.workArea);
  let x = integer(value.x, areas[0].x + 40, -100000, 100000), y = integer(value.y, areas[0].y + 40, -100000, 100000);
  const area = areas.find(a => x >= a.x && x < a.x + a.width && y >= a.y && y < a.y + a.height) || areas[0];
  const width = integer(value.width, 900, 96, Math.max(96, area.width)), height = integer(value.height, 650, 64, Math.max(64, area.height));
  x = Math.max(area.x, Math.min(x, area.x + area.width - width));
  y = Math.max(area.y, Math.min(y, area.y + area.height - height));
  return { x, y, width, height };
}
function windowOptions(value = {}, displays) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Expected window options');
  const border = integer(value.borderStyle, 2, 0, 5);
  return { ...clampBounds(value, displays), title: text(value.title, 'VB6'), show: false, useContentSize: true,
    frame: border !== 0, resizable: border === 2 || border === 5, minimizable: value.minButton !== false && border < 3,
    maximizable: value.maxButton !== false && border === 2, closable: value.controlBox !== false,
    skipTaskbar: border >= 4, fullscreenable: border === 2, backgroundColor: '#c0c0c0' };
}
function menuTemplate(items, onSelect, budget = { count: 0 }, depth = 0) {
  if (!Array.isArray(items) || depth > 8) throw new TypeError('Invalid menu');
  return items.map(item => {
    if (++budget.count > 256) throw new Error('Menu item limit exceeded');
    if (item === null) return { type: 'separator' };
    const id = text(item.id, '', 128), label = text(item.label, '', 512);
    const entry = { label, enabled: item.enabled !== false };
    if (item.checked !== undefined) Object.assign(entry, { type: 'checkbox', checked: !!item.checked });
    if (item.items) entry.submenu = menuTemplate(item.items, onSelect, budget, depth + 1);
    else entry.click = () => onSelect(id);
    return entry;
  });
}
module.exports = { ORIGIN, MAX_WINDOWS, CSP, dataOrigins, dataCSP, dataRequestAllowed, integer, text, trustedURL, assetPath, clampBounds, windowOptions, menuTemplate };
