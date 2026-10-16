import {Signal} from '../../core/signal.js';

export const INPUT_MODE_SETTINGS_KEY = 'vb6-studio-web.input-mode.v1';
export const DEFAULT_INPUT_MODE = 'default';

/** A mode owns keyboard interpretation, never a project or an editor backend.
 * Factories are lazy: default editing allocates no modal engine session.
 */
export class InputModeRegistry extends Signal {
  constructor() {
    super();
    this.definitions = new Map();
    this.register({id: DEFAULT_INPUT_MODE, label: 'Default', description: 'The existing IDE and editor keyboard shortcuts.', createSession: () => null});
  }

  register(definition) {
    if (!definition || !/^[a-z][a-z0-9-]{0,63}$/.test(definition.id || '')) throw new TypeError('Input mode IDs must be lowercase names.');
    if (typeof definition.label !== 'string' || !definition.label.trim()) throw new TypeError('An input mode needs a label.');
    if (typeof definition.createSession !== 'function') throw new TypeError('An input mode needs a session factory.');
    if (this.definitions.has(definition.id)) throw new Error('Input mode already registered: ' + definition.id);
    const record = Object.freeze({id: definition.id, label: definition.label.trim(), description: String(definition.description || ''), createSession: definition.createSession});
    this.definitions.set(record.id, record);
    this.emit('change', {type: 'register', id: record.id});
    let active = true;
    return () => {
      if (!active || record.id === DEFAULT_INPUT_MODE) return false;
      active = false;
      if (this.definitions.get(record.id) !== record) return false;
      this.definitions.delete(record.id);
      this.emit('change', {type: 'unregister', id: record.id});
      return true;
    };
  }

  get(id) { return this.definitions.get(id); }
  has(id) { return this.definitions.has(id); }
  list() { return [...this.definitions.values()].map(({id, label, description}) => ({id, label, description})); }
}

export function normalizeInputModeSettings(value, registry) {
  const mode = value && typeof value === 'object' && typeof value.mode === 'string' && registry.has(value.mode) ? value.mode : DEFAULT_INPUT_MODE;
  return Object.freeze({mode});
}

export function loadInputModeSettings(storage, registry) {
  try {
    const value = JSON.parse(storage?.getItem(INPUT_MODE_SETTINGS_KEY) || 'null');
    return normalizeInputModeSettings(value?.version === 1 ? value : null, registry);
  } catch { return normalizeInputModeSettings(null, registry); }
}

export function saveInputModeSettings(storage, settings) {
  storage?.setItem(INPUT_MODE_SETTINGS_KEY, JSON.stringify({version: 1, mode: settings.mode}));
}
