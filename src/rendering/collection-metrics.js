/** A trusted presentation lease for canonical virtualized collection geometry.
 * No rows, selection, VB properties or input dispatch cross this boundary.
 * The control owns virtualization; a presentation can request its row pitch.
 */
const bindings = new WeakMap();

function rowPitch(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 512)
    throw new RangeError('Collection row pitch must be between 1 and 512 pixels');
  return value;
}

function apply(binding) {
  if (binding.retired) return;
  const next = binding.leases.at(-1)?.rowHeight ?? null;
  if (next === binding.current) return;
  binding.configure(next);
  binding.current = next;
}

export function bindCollectionMetrics(node, configure) {
  if (!node || typeof node !== 'object' || typeof configure !== 'function')
    throw new TypeError('A collection node and metric configurator are required');
  const previous = bindings.get(node);
  if (previous) { previous.retired = true; previous.leases.length = 0; }
  const binding = {configure, leases: [], current: null, retired: false};
  bindings.set(node, binding);
  return () => {
    if (bindings.get(node) !== binding) return;
    bindings.delete(node); binding.retired = true; binding.leases.length = 0;
    if (binding.current !== null) { binding.current = null; configure(null); }
  };
}

/** Returns null for controls which have no canonical virtualized row provider.
 * Independent leases restore the next active presentation, then native pitch.
 */
export function leaseCollectionMetrics(node, rowHeight) {
  rowPitch(rowHeight);
  const binding = bindings.get(node);
  if (!binding) return null;
  const lease = {rowHeight};
  binding.leases.push(lease);
  try { apply(binding); }
  catch (error) { binding.leases.pop(); throw error; }
  let released = false;
  return {
    update(value) {
      rowPitch(value);
      if (released || binding.retired || value === lease.rowHeight) return;
      const previous = lease.rowHeight; lease.rowHeight = value;
      try { apply(binding); }
      catch (error) { lease.rowHeight = previous; throw error; }
    },
    dispose() {
      if (released) return;
      released = true;
      const index = binding.leases.indexOf(lease);
      if (index >= 0) binding.leases.splice(index, 1);
      apply(binding);
    }
  };
}
