/** Transport-independent MCP primitives. No browser globals, dependencies, or dynamic code. */
export const MCP_VERSION = '2026-07-28';
export const MCP_LEGACY_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
export const MCP_VERSIONS = [MCP_VERSION, ...MCP_LEGACY_VERSIONS];
export const MCP_META = 'io.modelcontextprotocol/';
export const MCP_LIMIT = 8 * 1024 * 1024;
export class McpError extends Error {
  constructor(code, message, data) { super(message); this.name = 'McpError'; this.code = code; if (data !== undefined) this.data = data; }
  toJSON() { return {code: this.code, message: this.message, ...(this.data === undefined ? {} : {data: this.data})}; }
}
export function isRecord(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
export function rpcId(value) { return typeof value === 'string' || typeof value === 'number' && Number.isSafeInteger(value); }
export function checkMessage(value) {
  if (!isRecord(value) || value.jsonrpc !== '2.0') throw new McpError(-32600, 'Expected one JSON-RPC 2.0 message (batches are not supported).');
  const hasError = Object.hasOwn(value, 'error');
  if (Object.hasOwn(value, 'id') && !rpcId(value.id) && !(value.id === null && hasError)) throw new McpError(-32600, 'Invalid request ID.');
  if (typeof value.method === 'string' && value.method.length && !Object.hasOwn(value, 'result') && !Object.hasOwn(value, 'error')) {
    if (value.params !== undefined && !isRecord(value.params)) throw new McpError(-32602, 'Parameters must be an object.');
    return Object.hasOwn(value, 'id') ? 'request' : 'notification';
  }
  if (value.method === undefined && (Object.hasOwn(value, 'id') || hasError) && Object.hasOwn(value, 'result') !== Object.hasOwn(value, 'error')) {
    if (hasError && (!isRecord(value.error) || !Number.isInteger(value.error.code) || typeof value.error.message !== 'string')) throw new McpError(-32600, 'Invalid error response.');
    return 'response';
  }
  throw new McpError(-32600, 'Malformed JSON-RPC message.');
}
export function parseMessage(text, limit = MCP_LIMIT) {
  if (typeof text !== 'string' || text.length > limit) throw new McpError(-32600, 'MCP message exceeds size limit.');
  let value; try { value = JSON.parse(text); } catch { throw new McpError(-32700, 'Invalid JSON.'); }
  checkMessage(value); return value;
}
export function errorResponse(id, error) {
  return {jsonrpc: '2.0', id: rpcId(id) ? id : null, error: error instanceof McpError ? error.toJSON() : {code: -32603, message: 'Internal MCP error.'}};
}
export function checkAbort(signal) { if (signal?.aborted) throw new McpError(-32800, 'Request cancelled.'); }
/** Bound uncooperative host callbacks to the request lifetime. */
export function awaitAbort(value, signal) {
  checkAbort(signal);
  if (!signal) return Promise.resolve(value);
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new McpError(-32800, 'Request cancelled.')); };
    signal.addEventListener('abort', abort, {once: true});
    Promise.resolve(value).then(result => { signal.removeEventListener('abort', abort); resolve(result); }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
export function randomToken(bytes = 32) {
  if (!globalThis.crypto?.getRandomValues) throw new Error('A secure random number generator is required.');
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), b => b.toString(16).padStart(2, '0')).join('');
}
export function encodeHeader(value) {
  const text = String(value);
  if (/^[\x20-\x7e]*$/.test(text) && text === text.trim() && !/^=\?base64\?.*\?=$/.test(text)) return text;
  let bytes = ''; for (const byte of new TextEncoder().encode(text)) bytes += String.fromCharCode(byte);
  return '=?base64?' + btoa(bytes) + '?=';
}
export function decodeHeader(value) {
  if (value == null) return null;
  if (!/^[\x20-\x7e]*$/.test(value) || value !== value.trim()) throw new McpError(-32020, 'Invalid MCP header value.');
  if (!value.startsWith('=?base64?') || !value.endsWith('?=')) return value;
  try { return new TextDecoder('utf-8', {fatal: true}).decode(Uint8Array.from(atob(value.slice(9, -2)), c => c.charCodeAt(0))); }
  catch { throw new McpError(-32020, 'Invalid Base64 MCP header value.'); }
}
/** Validate every x-mcp-header, including forbidden locations. Returns exact property paths. */
export function headerAnnotations(schema) {
  const entries = [], names = new Set(); let count = 0;
  function walk(node, path, reachable, depth) {
    if (!isRecord(node) && !Array.isArray(node)) return;
    if (++count > 20000 || depth > 64) throw new McpError(-32602, 'Tool schema is too complex.');
    if (Object.hasOwn(node, 'x-mcp-header')) {
      const name = node['x-mcp-header'];
      if (!reachable || !path.length || typeof name !== 'string' || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || !['string','integer','boolean'].includes(node.type) || names.has(name.toLowerCase())) throw new McpError(-32602, 'Invalid or duplicate x-mcp-header annotation.');
      names.add(name.toLowerCase()); entries.push({name, path, type: node.type});
    }
    for (const [key, child] of Object.entries(node)) {
      if (key === 'properties' && isRecord(child)) for (const [property, nested] of Object.entries(child)) walk(nested, [...path, property], reachable, depth + 1);
      else if (isRecord(child) || Array.isArray(child)) walk(child, path, false, depth + 1);
    }
  }
  walk(schema, [], true, 0); return entries;
}
export function requestHeaders(message, version, schema) {
  const headers = {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream'};
  if (version) headers['MCP-Protocol-Version'] = version;
  if (version !== MCP_VERSION || !message.method || !Object.hasOwn(message, 'id')) return headers;
  if (!/^[A-Za-z0-9_./-]+$/.test(message.method)) throw new McpError(-32600, 'Invalid method name.');
  headers['Mcp-Method'] = message.method;
  const name = message.method === 'resources/read' ? message.params?.uri : ['tools/call','prompts/get'].includes(message.method) ? message.params?.name : undefined;
  if (name !== undefined) headers['Mcp-Name'] = encodeHeader(name);
  if (message.method === 'tools/call' && schema) for (const entry of headerAnnotations(schema)) {
    let value = message.params?.arguments;
    for (const key of entry.path) value = isRecord(value) && Object.hasOwn(value, key) ? value[key] : undefined;
    if (value == null) continue;
    if (entry.type === 'integer' ? !Number.isSafeInteger(value) : typeof value !== entry.type) throw new McpError(-32602, 'Invalid header parameter: ' + entry.path.join('.'));
    headers['Mcp-Param-' + entry.name] = encodeHeader(value);
  }
  return headers;
}
export function validateHeaders(message, headers, schema) {
  const actual = new Headers(headers), version = message.params?._meta?.[MCP_META + 'protocolVersion'];
  const headerVersion = actual.get('MCP-Protocol-Version');
  if ((version !== undefined || headerVersion === MCP_VERSION) && headerVersion !== version) throw new McpError(-32020, 'Missing or mismatched MCP-Protocol-Version header.');
  if (headerVersion && !MCP_VERSIONS.includes(headerVersion)) throw new McpError(-32022, 'Unsupported protocol version.', {supported: MCP_VERSIONS, requested: headerVersion});
  if (version !== MCP_VERSION) return;
  const expected = requestHeaders(message, version, schema);
  const recognized = ['Mcp-Name', ...(schema && message.method === 'tools/call' ? headerAnnotations(schema).map(entry => 'Mcp-Param-' + entry.name) : [])];
  for (const name of recognized) if (actual.has(name) && !Object.hasOwn(expected, name)) throw new McpError(-32020, 'Header has no corresponding body value: ' + name);
  for (const [name, value] of Object.entries(expected)) {
    if (!name.toLowerCase().startsWith('mcp')) continue;
    if (decodeHeader(actual.get(name)) !== decodeHeader(value)) throw new McpError(-32020, 'Missing or mismatched ' + name + ' header.');
  }
}
export function httpURL(value, {base, allowHTTP = false} = {}) {
  let url; try { url = new URL(value, base); } catch { throw new McpError(-32602, 'Enter an absolute MCP HTTP(S) URL.'); }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash || url.protocol === 'http:' && !loopback && !allowHTTP) throw new McpError(-32602, 'Use HTTPS, or HTTP on localhost. Credentials and fragments are not allowed in endpoint URLs.');
  return url;
}
/** Bounded validator for the JSON Schema subset used by this server's tool definitions. */
export function validateArguments(value, schema, path = 'arguments', depth = 0) {
  if (depth > 32) throw new McpError(-32602, 'Arguments are too deeply nested.');
  const fail = text => { throw new McpError(-32602, path + ': ' + text); };
  const type = schema.type;
  if (type === 'object' && !isRecord(value) || type === 'array' && !Array.isArray(value) || type === 'string' && typeof value !== 'string' || type === 'boolean' && typeof value !== 'boolean' || type === 'integer' && !Number.isSafeInteger(value) || type === 'number' && (typeof value !== 'number' || !Number.isFinite(value))) fail('expected ' + type);
  if (schema.enum && !schema.enum.includes(value)) fail('unsupported value');
  if (typeof value === 'string' && (value.length > (schema.maxLength ?? MCP_LIMIT) || value.length < (schema.minLength ?? 0))) fail('invalid length');
  if (typeof value === 'number' && (value < (schema.minimum ?? -Infinity) || value > (schema.maximum ?? Infinity))) fail('out of range');
  if (isRecord(value)) {
    for (const name of schema.required || []) if (!Object.hasOwn(value, name)) fail('missing ' + name);
    for (const [key, child] of Object.entries(value)) {
      if (['__proto__','prototype','constructor'].includes(key)) fail('unsafe key');
      if (schema.properties && Object.hasOwn(schema.properties, key)) validateArguments(child, schema.properties[key], path + '.' + key, depth + 1);
      else if (schema.additionalProperties === false) fail('unexpected ' + key);
      else validateArguments(child, {}, path + '.' + key, depth + 1);
    }
  }
  if (Array.isArray(value)) {
    if (value.length > (schema.maxItems ?? 10000)) fail('too many items');
    value.forEach((child, i) => validateArguments(child, schema.items || {}, path + '[' + i + ']', depth + 1));
  }
}
export function pageItems(items, cursor, size = 100) {
  let offset = 0;
  if (cursor !== undefined) {
    if (typeof cursor !== 'string' || !/^page:\d+$/.test(cursor)) throw new McpError(-32602, 'Invalid pagination cursor.');
    offset = Number(cursor.slice(5));
    if (!Number.isSafeInteger(offset) || offset > items.length) throw new McpError(-32602, 'Expired pagination cursor; refresh the list.');
  }
  return {items: items.slice(offset, offset + size), ...(offset + size < items.length ? {nextCursor: 'page:' + (offset + size)} : {})};
}
