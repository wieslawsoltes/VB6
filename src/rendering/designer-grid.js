/** Presentation-only designer metrics, expressed in untransformed CSS pixels.
 * Providers never write project settings or authored twips. The last live lease
 * owns the metrics; releasing an older lease cannot retire its replacement. */
const grids = new WeakMap();

function metrics(value) {
  if (!value || ![value.columnWidth, value.rowHeight].every(n => Number.isFinite(n) && n >= 1 && n <= 8192)) {
    throw new RangeError('Invalid designer presentation grid');
  }
  return Object.freeze({columnWidth: value.columnWidth, rowHeight: value.rowHeight});
}

function changed(node) {
  const Event = node.ownerDocument?.defaultView?.CustomEvent;
  if (Event) node.dispatchEvent(new Event('vb-presentation-geometry', {bubbles: true}));
}

export function designerGridFor(node) {return grids.get(node)?.at(-1)?.value || null;}

export function leaseDesignerGrid(node, value) {
  if (!node || typeof node !== 'object') throw new TypeError('A designer grid requires an element');
  const entry = {value: metrics(value)};
  let entries = grids.get(node);
  if (!entries) grids.set(node, entries = []);
  entries.push(entry);
  try {changed(node);}
  catch (error) {
    // Registration publishes before synchronous geometry listeners run. If the
    // notification itself fails, no disposer reaches the caller: retire this
    // exact entry without removing a newer lease installed by a listener.
    entries.splice(entries.indexOf(entry), 1);
    if (!entries.length && grids.get(node) === entries) grids.delete(node);
    throw error;
  }
  let disposed = false;
  return {
    update(value) {
      if (disposed) return false;
      const next = metrics(value);
      if (entry.value.columnWidth === next.columnWidth && entry.value.rowHeight === next.rowHeight) return false;
      entry.value = next;
      if (entries.at(-1) === entry) changed(node);
      return true;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      const active = entries.at(-1) === entry;
      entries.splice(entries.indexOf(entry), 1);
      if (!entries.length) grids.delete(node);
      if (active) changed(node);
    }
  };
}
