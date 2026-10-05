// Registration is private to trusted library objects; a forged __type never grants a default property.
const values = new WeakSet();
export function dataDefault(object) { values.add(object); return object; }
export function hasDataDefault(object) { return object != null && (typeof object === 'object' || typeof object === 'function') && values.has(object); }
