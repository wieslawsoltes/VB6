import {exportFailure} from './diagnostics.js';

/** Copy JSON data without invoking getters/toJSON or silently erasing host objects.
 * Undefined object members and array holes retain standard JSON semantics.
 * A shared, non-cyclic object is copied at each occurrence, just as JSON does.
 */
export function snapshotExportValue(value, path = '$') {
  const active = new WeakSet();
  let nodes = 0;
  function copy(input, at, depth) {
    if (++nodes > 1000000 || depth > 128) {
      throw exportFailure('EXPORT_DATA_LIMIT', 'Export data exceeds the nesting or node limit', at);
    }
    if (input === null || typeof input === 'string' || typeof input === 'boolean') return input;
    if (typeof input === 'number' && Number.isFinite(input)) return input;
    if (input === undefined) return undefined;
    if (typeof input !== 'object') {
      throw exportFailure('EXPORT_NON_PORTABLE_VALUE', 'Expected JSON data; non-finite numbers and executable values cannot be exported', at);
    }
    if (active.has(input)) throw exportFailure('EXPORT_CIRCULAR_DATA', 'Circular export data', at);
    const array = Array.isArray(input), prototype = Object.getPrototypeOf(input);
    if (!array && prototype !== Object.prototype && prototype !== null) {
      throw exportFailure('EXPORT_NON_PORTABLE_VALUE', 'Host objects cannot be exported; use the project JSON resource/VFS encoding or a runtime adapter', at);
    }
    const descriptors = Object.getOwnPropertyDescriptors(input);
    const keys = Reflect.ownKeys(descriptors).filter(key => descriptors[key].enumerable);
    if (keys.some(key => typeof key === 'symbol')) {
      throw exportFailure('EXPORT_NON_PORTABLE_VALUE', 'Symbol-keyed export data cannot be represented in JSON', at);
    }
    active.add(input);
    const output = array ? [] : {};
    if (array && input.length > 1000000 - nodes) {
      throw exportFailure('EXPORT_DATA_LIMIT', 'Export array exceeds the node limit', at);
    }
    for (const key of keys) {
      const next = `${at}[${JSON.stringify(key)}]`, descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value')) {
        throw exportFailure('EXPORT_NON_PORTABLE_VALUE', 'Export getters and setters are not executed', next);
      }
      if (array && (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= input.length)) {
        throw exportFailure('EXPORT_NON_PORTABLE_VALUE', 'Named array properties cannot be represented in JSON', next);
      }
      const item = copy(descriptor.value, next, depth + 1);
      if (item !== undefined || array) Object.defineProperty(output, key, {value: item === undefined ? null : item, enumerable: true, writable: true, configurable: true});
    }
    if (array) {
      // JSON array holes become null, including trailing holes.
      for (let i = 0; i < input.length; i++) if (!Object.hasOwn(output, i)) {
        if (++nodes > 1000000) throw exportFailure('EXPORT_DATA_LIMIT', 'Export data exceeds the node limit', at);
        output[i] = null;
      }
    }
    active.delete(input);
    return output;
  }
  return copy(value, path, 0);
}

/** JSON safe in an HTML raw-text script element, including legacy parser states. */
export function jsonForHTML(value) {
  const json = JSON.stringify(value);
  if (json === undefined) throw exportFailure('EXPORT_NON_PORTABLE_VALUE', 'Expected a JSON value', '$');
  return json.replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026')
    .replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}
