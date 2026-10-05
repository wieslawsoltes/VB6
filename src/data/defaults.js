// Registration is private to trusted library objects; a forged __type never grants a default property.
const values = new WeakSet();
export function dataDefault(object) { values.add(object); return object; }
export function hasDataDefault(object) { return object != null && (typeof object === 'object' || typeof object === 'function') && values.has(object); }

// A private allowlist for legacy public lowercase names such as rdoConnections.
const members = new WeakMap();
export function dataMembers(object,names) { members.set(object,new Set(names.map(name=>name.toLowerCase()))); return object; }
export function hasDataMember(object,name) { return members.get(object)?.has(String(name).toLowerCase()) || false; }
