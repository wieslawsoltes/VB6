// Registration is private to trusted library objects; a forged __type never grants a default property.
const values = new WeakSet();
const types = new WeakMap();
export function dataDefault(object, scalarType) { values.add(object); if (typeof scalarType === 'function') types.set(object, scalarType); return object; }
// Type resolvers are registered only by trusted field/parameter constructors.
export function dataDefaultType(object) { return types.get(object)?.(); }
export function hasDataDefault(object) { return object != null && (typeof object === 'object' || typeof object === 'function') && values.has(object); }
