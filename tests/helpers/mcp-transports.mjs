import {McpError, randomToken, checkMessage, checkAbort} from '../../src/mcp/protocol.js';
export {IdeRelayTransport as HttpTransport, SseParser, readJsonResponse, readSseResponse, McpHttpError} from '../../tools/mcp-http.mjs';

// Explicit external test peers for the server's non-network transports. Not bundled.
export class LocalTransport {
  constructor(server) { this.server = server; this.sessionKey = 'local:' + randomToken(12); }
  exchange(message, {signal, onMessage = () => {}} = {}) { this.onMessage = onMessage; return this.server.dispatch(structuredClone(message), {sessionKey: this.sessionKey, requestId: message.id, signal, emit: value => onMessage(structuredClone(value)), notify: value => this.onMessage?.(structuredClone(value))}); }
  async close() { this.server.closeSession(this.sessionKey); }
}
export class PortTransport {
  constructor(port) {
    this.port = port; this.pending = new Map();
    port.onmessage = async event => {
      try { const kind = checkMessage(event.data); if (kind === 'response') this.pending.get(event.data.id)?.resolve(event.data); else { const reply = await this.onMessage?.(event.data); if (reply) port.postMessage(reply); } }
      catch (error) { this.onError?.(error); }
    }; port.start?.();
  }
  exchange(message, {signal, onMessage} = {}) {
    this.onMessage = onMessage; checkAbort(signal);
    if (checkMessage(message) !== 'request') { this.port.postMessage(message); return Promise.resolve(); }
    if (this.pending.size >= 128 || this.pending.has(message.id)) return Promise.reject(new McpError(-32600, 'Duplicate or excessive request.'));
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.pending.delete(message.id); signal?.removeEventListener('abort', abort); }, abort = () => { cleanup(); try { this.port?.postMessage({jsonrpc: '2.0', method: 'notifications/cancelled', params: {requestId: message.id}}); } catch {} reject(new McpError(-32800, 'Request cancelled.')); };
      this.pending.set(message.id, {resolve: value => { cleanup(); resolve(value); }, reject: error => { cleanup(); reject(error); }}); signal?.addEventListener('abort', abort, {once: true});
      try { this.port.postMessage(message); } catch (error) { cleanup(); reject(error); }
    });
  }
  async close() { for (const pending of this.pending.values()) pending.reject(new McpError(-32800, 'Port closed.')); this.pending.clear(); this.port.onmessage = null; this.port.close(); }
}
