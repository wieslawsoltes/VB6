import {McpError, MCP_LIMIT, httpURL, randomToken, checkAbort} from './protocol.js';

/** Opt-in outbound connection to the loopback companion. No open inbound browser listener. */
export class BrowserBridge {
  constructor(server, {url = 'http://127.0.0.1:8766', token, fetch: fetchFn = globalThis.fetch.bind(globalThis), onStatus = () => {}} = {}) {
    this.server = server; this.url = httpURL(url).href.replace(/\/$/, ''); this.token = token; this.fetch = fetchFn; this.onStatus = onStatus; this.requests = new Map(); this.sessions = new Set(); this.connected = false;
    if (new URL(this.url).pathname !== '/') throw new McpError(-32602, 'Use the companion origin without a path.');
  }
  status(text) { try { this.onStatus(text); } catch {} }
  async post(path, body, signal, lease = this.lease) {
    const response = await this.fetch(this.url + path, {method: 'POST', credentials: 'omit', redirect: 'error', cache: 'no-store', referrerPolicy: 'no-referrer', signal,
      headers: {'Content-Type': 'application/json', Authorization: 'Bearer ' + this.token, ...(lease ? {'X-VB6-Lease': lease} : {})}, body: JSON.stringify(body)});
    if (!response.ok) throw new McpError(-32000, 'Companion HTTP ' + response.status + (response.status === 409 ? ': another browser is attached or the lease expired.' : response.status === 403 ? ': check the exact --origin or --allow-file setting.' : '.'));
    const reader = response.body?.getReader(), decoder = new TextDecoder(); let text = '', size = 0;
    if (!reader) return {};
    try { while (true) { const {value, done} = await reader.read(); if (done) break; size += value.byteLength; if (size > 4 * MCP_LIMIT + 65536) throw new McpError(-32600, 'Companion poll is too large.'); text += decoder.decode(value, {stream: true}); } text += decoder.decode(); return text ? JSON.parse(text) : {}; } finally { await reader.cancel().catch(() => {}); }
  }
  async connect() {
    if (this.connected || this.lifetime) throw new McpError(-32000, 'Companion is already connected.');
    if (typeof this.token !== 'string' || this.token.length < 32) throw new McpError(-32602, 'Enter the companion owner token, not its client token.');
    this.lifetime = new AbortController(); this.id = randomToken(12);
    try {
      const result = await this.post('/bridge/attach', {id: this.id}, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(10000)]), null);
      this.lease = result.lease; this.connected = true; this.status('Connected'); this.task = this.poll(); return this;
    } catch (error) { this.lifetime.abort(); this.lifetime = null; throw error; }
  }
  async poll() {
    try {
      while (!this.lifetime.signal.aborted) {
        const {events = []} = await this.post('/bridge/poll', {}, AbortSignal.any([this.lifetime.signal, AbortSignal.timeout(35000)]));
        for (const event of events) {
          if (event.type === 'closeSession') { this.server.closeSession(event.sessionKey); this.sessions.delete(event.sessionKey); continue; }
          if (event.type === 'cancel') { this.requests.get(event.key)?.abort(); continue; }
          if (event.type !== 'message' || typeof event.key !== 'string' || typeof event.sessionKey !== 'string') continue;
          if (this.requests.size >= 128) throw new McpError(-32000, 'Too many companion requests.');
          const controller = new AbortController(); this.requests.set(event.key, controller); this.sessions.add(event.sessionKey);
          this.dispatch(event, controller).catch(() => {});
        }
      }
    } catch (error) { if (!this.lifetime?.signal.aborted) this.status('Disconnected: ' + error.message); }
    finally { this.connected = false; this.lifetime?.abort(); for (const controller of this.requests.values()) controller.abort(); for (const key of this.sessions) this.server.closeSession(key); this.sessions.clear(); this.requests.clear(); }
  }
  async dispatch(event, controller) {
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal]);
    // Each stream keeps its notifications and final reply ordered, even while other requests run.
    let sequence = Promise.resolve();
    const send = (message, done = false) => {
      sequence = sequence.then(() => this.post('/bridge/reply', {key: event.key, sessionKey: event.sessionKey, message, done}, this.lifetime.signal));
      sequence.catch(() => {}); return sequence;
    };
    const notify = message => this.post('/bridge/notify', {sessionKey: event.sessionKey, message}, this.lifetime.signal).catch(() => {});
    try {
      const reply = await this.server.dispatch(event.message, {sessionKey: event.sessionKey, requestId: event.message.id, peer: 'Companion MCP client', headers: event.headers, signal, emit: message => { send(message).catch(() => {}); }, notify});
      checkAbort(signal); await send(reply, true);
    } catch (error) { if (!signal.aborted) this.status('Companion request failed: ' + error.message); }
    finally { this.requests.delete(event.key); if (event.ephemeral) { this.server.closeSession(event.sessionKey); this.sessions.delete(event.sessionKey); } }
  }
  async close() {
    if (!this.lifetime) return;
    try { if (this.lease) await this.post('/bridge/detach', {}, AbortSignal.timeout(2000)); } catch {}
    this.connected = false; this.lifetime.abort(); await this.task; this.lease = null; this.lifetime = null; this.token = ''; this.status('Disconnected');
  }
}
