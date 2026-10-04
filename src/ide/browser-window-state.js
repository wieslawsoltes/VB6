const finite = (n, fallback) => Number.isFinite(n) ? n : fallback;
/** Negative screen coordinates are valid on secondary displays. */
export function browserBounds(value = {}) {
  return {
    left: Math.round(Math.max(-100000, Math.min(100000, finite(value.left, 80)))),
    top: Math.round(Math.max(-100000, Math.min(100000, finite(value.top, 80)))),
    width: Math.round(Math.max(240, Math.min(10000, finite(value.width, 640)))),
    height: Math.round(Math.max(160, Math.min(10000, finite(value.height, 480))))
  };
}
export function normalizeBrowserWindows(value = []) {
  if (!Array.isArray(value) || value.length > 128) throw new Error('Invalid browser window layout.');
  const seen = new Set();
  return value.map(item => {
    if (!item || typeof item.key !== 'string' || item.key.length > 240 ||
        !/^(dock|document|toolbar):.+$/.test(item.key) || seen.has(item.key) ||
        !item.bounds || !['left', 'top', 'width', 'height'].every(k => Number.isFinite(item.bounds[k]))) {
      throw new Error('Invalid or duplicate browser window descriptor.');
    }
    seen.add(item.key);
    return {key: item.key, bounds: browserBounds(item.bounds)};
  });
}
