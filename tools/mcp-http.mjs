// Node-side transport for the external agent's stdio relay. Never bundled into the IDE.
import {companionURL} from '../src/mcp/companion-url.js';
import {MCP_VERSION, MCP_LIMIT, McpError, parseMessage, checkMessage, requestHeaders, checkAbort} from '../src/mcp/protocol.js';

/** Incremental SSE parser: UTF-8 is decoded by the reader; CR/LF may split across chunks. */
export class SseParser {
  constructor(onEvent, limit = MCP_LIMIT) { this.onEvent = onEvent; this.limit = limit; this.line = ''; this.data = []; this.size = 0; this.event = ''; this.id = undefined; this.retry = undefined; this.cr = false; this.first = true; }
  feed(text) {
    if (this.first && text) { this.first = false; if (text.charCodeAt(0) === 0xfeff) text = text.slice(1); }
    for (const character of text) {
      if (this.cr) { this.cr = false; if (character === '\n') continue; }
      if (character === '\r' || character === '\n') { this.consume(this.line); this.line = ''; this.cr = character === '\r'; }
      else { this.line += character; if (this.line.length + this.size > this.limit) throw new McpError(-32600, 'SSE event exceeds size limit.'); }
    }
  }
  consume(line) {
    if (!line) {
      if (this.data.length || this.id !== undefined || this.retry !== undefined) this.onEvent({event: this.event || 'message', data: this.data.join('\n'), ...(this.id === undefined ? {} : {id: this.id}), ...(this.retry === undefined ? {} : {retry: this.retry})});
      this.data = []; this.size = 0; this.event = ''; this.id = undefined; this.retry = undefined; return;
    }
    if (line[0] === ':') return;
    const colon = line.indexOf(':'), field = colon < 0 ? line : line.slice(0, colon); let value = colon < 0 ? '' : line.slice(colon + 1); if (value[0] === ' ') value = value.slice(1);
    if (field === 'data') { this.data.push(value); this.size += value.length + 1; if (this.size > this.limit) throw new McpError(-32600, 'SSE event exceeds size limit.'); }
    else if (field === 'event') this.event = value;
    else if (field === 'id' && !value.includes('\0')) this.id = value;
    else if (field === 'retry' && /^\d+$/.test(value) && Number.isSafeInteger(Number(value))) this.retry = Number(value);
  }
}
export async function readJsonResponse(response, limit = MCP_LIMIT) {
  if (!response.body) throw new McpError(-32600, 'Empty MCP response.');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true}); let text = '', size = 0;
  try { for (;;) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > limit) throw new McpError(-32600, 'MCP response exceeds size limit.'); text += decoder.decode(value, {stream: true}); } text += decoder.decode(); return parseMessage(text, limit); }
  finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export async function readSseResponse(response, onEvent, signal, limit = MCP_LIMIT) {
  if (!response.body) throw new McpError(-32600, 'Missing SSE body.');
  const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', {fatal: true}), queue = [];
  const parser = new SseParser(event => queue.push(event), limit), abort = () => reader.cancel().catch(() => {});
  signal?.addEventListener('abort', abort, {once: true});
  try {
    for (;;) {
      checkAbort(signal); const {value, done} = await reader.read(); if (done) break;
      parser.feed(decoder.decode(value, {stream: true}));
      while (queue.length) if (await onEvent(queue.shift()) === false) return;
    }
    parser.feed(decoder.decode());
    while (queue.length) if (await onEvent(queue.shift()) === false) return;
  } finally { signal?.removeEventListener('abort', abort); await reader.cancel().catch(() => {}); reader.releaseLock(); }
}
export class McpHttpError extends McpError {
  constructor(status, message, {rpcError, challenge} = {}) { super(rpcError?.code ?? -32000, message, rpcError?.data); this.status = status; this.challenge = challenge; this.rpcError = rpcError; }
}
async function responseError(response) {
  let rpcError; try { const body = await readJsonResponse(response); rpcError = body.error; } catch {}
  return new McpHttpError(response.status, rpcError?.message || ('MCP HTTP ' + response.status + (response.status === 401 ? ': authorization required.' : response.status === 403 ? ': access or origin denied.' : '.')), {rpcError, challenge: response.headers.get('WWW-Authenticate')});
}
function pause(ms, signal) {
  return new Promise((resolve, reject) => { const done = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); resolve(); }, abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new McpError(-32800, 'Request cancelled.')); }, timer = setTimeout(done, Math.min(ms, 2147483647)); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort(); });
}
export class IdeRelayTransport {
  constructor(url, {fetch: fetchFn = globalThis.fetch?.bind(globalThis), token = '', maxBytes = MCP_LIMIT, headers = {}} = {}) {
    this.url = companionURL(url, {endpoint: true}).href; this.fetch = fetchFn; this.token = token; this.maxBytes = maxBytes; this.sessionId = null; this.extraHeaders = headers;
    if (!this.fetch) throw new Error('Fetch is not available.');
  }
  async headers(message, version, schema) {
    const headers = new Headers(this.extraHeaders); for (const [key, value] of Object.entries(requestHeaders(message, version, schema))) headers.set(key, value);
    const token = typeof this.token === 'function' ? await this.token() : this.token;
    if (token) headers.set('Authorization', 'Bearer ' + token); else headers.delete('Authorization');
    if (this.sessionId && version !== MCP_VERSION) headers.set('MCP-Session-Id', this.sessionId); else headers.delete('MCP-Session-Id');
    return headers;
  }
  async fetchSafe(url, options) {
    try { return await this.fetch(url, {...options, credentials: 'omit', redirect: 'error', mode: 'cors', cache: 'no-store', referrerPolicy: 'no-referrer'}); }
    catch (error) { if (options.signal?.aborted) throw new McpError(-32800, 'Request cancelled.'); throw new McpError(-32000, 'MCP network request failed. Check that the local IDE companion is running and attached. Redirects are not followed.'); }
  }
  async exchange(message, {version, signal, onMessage = () => {}, schema} = {}) {
    checkAbort(signal);
    let response = await this.fetchSafe(this.url, {method: 'POST', headers: await this.headers(message, version, schema), body: JSON.stringify(message), signal});
    if (!response.ok) {
      const error = await responseError(response); if (response.status === 404 && this.sessionId) { this.sessionId = null; error.sessionExpired = true; } throw error;
    }
    if (message.method === 'initialize') {
      const id = response.headers.get('MCP-Session-Id'); if (id && !/^[\x21-\x7e]+$/.test(id)) throw new McpError(-32600, 'Invalid MCP session ID.'); this.sessionId = id;
    }
    const expectsReply = checkMessage(message) === 'request';
    if (!expectsReply) { if (response.status !== 202) throw new McpError(-32600, 'Expected HTTP 202 for a notification or response.'); return undefined; }
    if (response.status === 202) throw new McpError(-32600, 'Request was accepted without a response.');
    let lastId, retry = 1000, reply;
    for (let attempt = 0; attempt < 4; attempt++) {
      const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      if (type === 'application/json') {
        const value = await readJsonResponse(response, this.maxBytes);
        if (checkMessage(value) !== 'response' || value.id !== message.id) throw new McpError(-32600, 'Mismatched MCP response ID.'); return value;
      }
      if (type !== 'text/event-stream') throw new McpError(-32600, 'Expected JSON or an SSE response.');
      await readSseResponse(response, async event => {
        if (event.id !== undefined) lastId = event.id;
        if (event.retry !== undefined) retry = event.retry;
        if (!event.data || event.event !== 'message') return;
        const value = parseMessage(event.data, this.maxBytes), kind = checkMessage(value);
        if (kind === 'response') { if (value.id !== message.id) throw new McpError(-32600, 'Mismatched streamed response ID.'); reply = value; return false; }
        if (kind === 'request' && version === MCP_VERSION) throw new McpError(-32600, 'Modern MCP uses input_required results, not server requests.');
        const answer = await onMessage(value);
        if (kind === 'request' && answer) await this.exchange(answer, {version, signal});
      }, signal, this.maxBytes);
      if (reply) return reply;
      checkAbort(signal);
      if (version === MCP_VERSION || !lastId || attempt === 3) throw new McpError(-32000, 'MCP stream ended before its response; the operation was not replayed.');
      await pause(retry, signal);
      const headers = await this.headers({}, version); headers.set('Accept', 'text/event-stream'); headers.set('Last-Event-ID', lastId);
      response = await this.fetchSafe(this.url, {method: 'GET', headers, signal}); if (!response.ok) throw await responseError(response);
    }
  }
  async listen(onMessage, {version, signal, onError = () => {}} = {}) {
    let lastId, retry = 1000;
    while (!signal?.aborted) {
      try {
        const headers = await this.headers({}, version); headers.set('Accept', 'text/event-stream'); if (lastId) headers.set('Last-Event-ID', lastId);
        const response = await this.fetchSafe(this.url, {method: 'GET', headers, signal});
        if (response.status === 405) return;
        if (!response.ok) throw await responseError(response);
        if (!response.headers.get('Content-Type')?.startsWith('text/event-stream')) throw new McpError(-32600, 'Expected notification SSE stream.');
        await readSseResponse(response, async event => {
          if (event.id !== undefined) lastId = event.id; if (event.retry !== undefined) retry = event.retry;
          if (!event.data || event.event !== 'message') return;
          const value = parseMessage(event.data, this.maxBytes), answer = await onMessage(value);
          if (checkMessage(value) === 'request' && answer) await this.exchange(answer, {version, signal});
        }, signal, this.maxBytes);
        await pause(retry, signal);
      } catch (error) { if (!signal?.aborted) onError(error); return; }
    }
  }
  async close(version) {
    if (!this.sessionId) return;
    try { const signal = AbortSignal.timeout(2000); await this.fetchSafe(this.url, {method: 'DELETE', headers: await this.headers({}, version), signal}); }
    finally { this.sessionId = null; }
  }
}
