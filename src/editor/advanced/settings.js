/** Runtime opt-in. Reading defaults never starts a worker or opens a connection. */
export const ADVANCED_EDITOR_STORAGE_KEY = 'vb6.advancedEditor.v1';
export const ADVANCED_EDITOR_DEFAULTS = Object.freeze({
  enabled: false,
  minimap: true,
  stickyScroll: true,
  wordWrap: false,
  ligatures: false,
  renderWhitespace: 'selection',
  semanticHighlighting: true,
  inlayHints: true,
  codeLens: true,
  vb6Endpoint: '',
  xamlEndpoint: '',
});

export function normalizeAdvancedEditorSettings(value = {}) {
  const result = { ...ADVANCED_EDITOR_DEFAULTS };
  if (!value || typeof value !== 'object') return result;
  for (const key of Object.keys(result)) {
    if (typeof result[key] === 'boolean') result[key] = typeof value[key] === 'boolean' ? value[key] : result[key];
  }
  if (['none', 'boundary', 'selection', 'trailing', 'all'].includes(value.renderWhitespace)) {
    result.renderWhitespace = value.renderWhitespace;
  }
  for (const key of ['vb6Endpoint', 'xamlEndpoint']) {
    if (typeof value[key] === 'string') result[key] = value[key].trim();
  }
  return result;
}

/** Explicitly configured WebSocket servers only; never accept credentials in URLs. */
export function validateLanguageServerEndpoint(value, pageProtocol = 'https:') {
  if (!value) return '';
  let url;
  try { url = new URL(value); } catch { throw new TypeError('Enter an absolute ws:// or wss:// language-server URL.'); }
  if (!['ws:', 'wss:'].includes(url.protocol) || url.username || url.password || url.hash) {
    throw new TypeError('Language-server URLs must use ws:// or wss:// without embedded credentials or fragments.');
  }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (pageProtocol === 'https:' && url.protocol !== 'wss:' && !loopback) {
    throw new TypeError('HTTPS pages require a secure wss:// language server, except on loopback.');
  }
  return url.href;
}

export function loadAdvancedEditorSettings(storage) {
  try { return normalizeAdvancedEditorSettings(JSON.parse(storage?.getItem(ADVANCED_EDITOR_STORAGE_KEY) || '{}')); }
  catch { return normalizeAdvancedEditorSettings(); }
}

export function saveAdvancedEditorSettings(storage, settings) {
  const normalized = normalizeAdvancedEditorSettings(settings);
  storage?.setItem(ADVANCED_EDITOR_STORAGE_KEY, JSON.stringify(normalized));
  return normalized;
}
