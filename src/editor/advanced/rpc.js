/** Small, transport-neutral JSON-RPC 2.0 peer for LSP. No ambient network access. */
export class RpcError extends Error {
  constructor(code, message, data) { super(message); this.name = 'RpcError'; this.code = code; if (data !== undefined) this.data = data; }
}
export const RPC_CANCELLED = -32800;
export const RPC_CONTENT_MODIFIED = -32801;
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const validId = value => typeof value === 'string' || Number.isSafeInteger(value);

export class JsonRpcPeer {
  constructor(transport, { timeout = 30000, maxPending = 256, maxMessageLength = 16 * 1024 * 1024, onError = () => {}, onClose = () => {} } = {}) {
    this.transport = transport; this.timeout = timeout; this.maxPending = maxPending; this.maxMessageLength = maxMessageLength; this.onError = onError; this.onClose = onClose;
    this.sequence = 0; this.pending = new Map(); this.incoming = new Map(); this.requests = new Map(); this.notifications = new Map(); this.closed = false;
    this.unlisten = transport.listen(message => this.receive(message), error => this.close(error || new Error('Language-server connection closed.')));
  }
  onRequest(method, handler) {
    if (this.requests.has(method)) throw new Error('Request handler already registered: ' + method);
    this.requests.set(method, handler);
    return () => { if (this.requests.get(method) === handler) this.requests.delete(method); };
  }
  onNotification(method, handler) {
    let listeners = this.notifications.get(method);
    if (!listeners) this.notifications.set(method, listeners = new Set());
    listeners.add(handler);
    return () => { listeners.delete(handler); if (!listeners.size) this.notifications.delete(method); };
  }
  send(message) {
    if (this.closed) throw new RpcError(-32097, 'Language-server connection is closed.');
    this.transport.send(message);
  }
  notify(method, params) { this.send({ jsonrpc: '2.0', method, ...(params === undefined ? {} : { params }) }); }
  request(method, params, { signal, timeout = this.timeout } = {}) {
    if (this.closed) return Promise.reject(new RpcError(-32097, 'Language-server connection is closed.'));
    if (signal?.aborted) return Promise.reject(new RpcError(RPC_CANCELLED, 'Request cancelled.'));
    if (this.pending.size >= this.maxPending) return Promise.reject(new RpcError(-32099, 'Too many pending language-server requests.'));
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (error, result) => {
        if (!this.pending.delete(id)) return;
        clearTimeout(timer); signal?.removeEventListener('abort', cancel);
        if (error) reject(error); else resolve(result);
      };
      const cancel = () => {
        if (!this.pending.has(id)) return;
        try { this.notify('$/cancelRequest', { id }); } catch { /* close handles pending requests */ }
        finish(new RpcError(RPC_CANCELLED, 'Request cancelled.'));
      };
      this.pending.set(id, finish);
      signal?.addEventListener('abort', cancel, { once: true });
      if (Number.isFinite(timeout) && timeout > 0) timer = setTimeout(() => {
        try { this.notify('$/cancelRequest', { id }); } catch { /* connection may already be closed */ }
        finish(new RpcError(-32098, 'Language-server request timed out: ' + method));
      }, timeout);
      try { this.send({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) }); }
      catch (error) { finish(error); }
    });
  }
  reply(id, result, error) {
    if (this.closed) return;
    try {
      this.send(error
        ? { jsonrpc: '2.0', id, error: { code: Number.isInteger(error.code) ? error.code : -32603, message: String(error.message || error), ...(error.data === undefined ? {} : { data: error.data }) } }
        : { jsonrpc: '2.0', id, result: result === undefined ? null : result });
    } catch (failure) { this.close(failure); }
  }
  receive(value) {
    if (this.closed) return;
    let message = value;
    try {
      if (typeof value === 'string') {
        if (value.length > this.maxMessageLength) throw new RpcError(-32600, 'Language-server message exceeds the size limit.');
        message = JSON.parse(value);
      }
      if (!message || typeof message !== 'object' || Array.isArray(message) || message.jsonrpc !== '2.0') throw new RpcError(-32600, 'Invalid JSON-RPC message.');
      if (own(message, 'method')) {
        if (typeof message.method !== 'string' || (own(message, 'id') && !validId(message.id))) throw new RpcError(-32600, 'Invalid JSON-RPC request.');
        if (message.method === '$/cancelRequest' && !own(message, 'id')) { this.incoming.get(message.params?.id)?.abort(); return; }
        if (!own(message, 'id')) {
          for (const listener of this.notifications.get(message.method) || []) {
            try { Promise.resolve(listener(message.params)).catch(this.onError); } catch (error) { this.onError(error); }
          }
          return;
        }
        const handler = this.requests.get(message.method);
        if (!handler) { this.reply(message.id, null, new RpcError(-32601, 'Method not found: ' + message.method)); return; }
        if (this.incoming.has(message.id)) { this.reply(message.id, null, new RpcError(-32600, 'Duplicate request id.')); return; }
        const controller = new AbortController(); this.incoming.set(message.id, controller);
        let result;
        try { result = handler(message.params, { signal: controller.signal, id: message.id }); }
        catch (error) { this.incoming.delete(message.id); this.reply(message.id, null, error); return; }
        Promise.resolve(result).then(
          result => this.reply(message.id, result, controller.signal.aborted ? new RpcError(RPC_CANCELLED, 'Request cancelled.') : null),
          error => this.reply(message.id, null, error),
        ).finally(() => this.incoming.delete(message.id));
      } else {
        if (!validId(message.id) || own(message, 'result') === own(message, 'error')) throw new RpcError(-32600, 'Invalid JSON-RPC response.');
        const finish = this.pending.get(message.id);
        if (!finish) return;
        if (own(message, 'error')) {
          if (!message.error || !Number.isInteger(message.error.code) || typeof message.error.message !== 'string') throw new RpcError(-32600, 'Invalid JSON-RPC error.');
          finish(new RpcError(message.error.code, message.error.message, message.error.data));
        } else finish(null, message.result);
      }
    } catch (error) { this.onError(error); }
  }
  close(reason = new Error('Language-server connection closed.')) {
    if (this.closed) return;
    this.closed = true;
    for (const finish of [...this.pending.values()]) finish(reason);
    for (const controller of this.incoming.values()) controller.abort();
    this.incoming.clear(); this.requests.clear(); this.notifications.clear();
    try { this.unlisten?.(); this.transport.close?.(); } finally { this.onClose(reason); }
  }
}

/** Works with browser Workers/MessagePorts; the caller owns which code is run. */
export function messagePortTransport(port, { terminate = false } = {}) {
  return {
    send: value => port.postMessage(value),
    listen(onMessage, onClose) {
      const message = event => onMessage(event.data), error = event => onClose(new Error(event.message || 'Language worker failed.'));
      port.addEventListener('message', message); port.addEventListener('messageerror', error); port.addEventListener('error', error); port.start?.();
      return () => { port.removeEventListener('message', message); port.removeEventListener('messageerror', error); port.removeEventListener('error', error); };
    },
    close() { if (terminate) port.terminate?.(); else port.close?.(); },
  };
}

export function connectWebSocket(url, { WebSocketClass = globalThis.WebSocket, signal, timeout = 10000, protocols = [] } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new RpcError(RPC_CANCELLED, 'Connection cancelled.')); return; }
    const socket = new WebSocketClass(url, protocols);
    let done = false;
    const clean = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); socket.removeEventListener('open', open); socket.removeEventListener('error', failed); socket.removeEventListener('close', failed); };
    const fail = error => { if (done) return; done = true; clean(); socket.close(); reject(error); };
    const abort = () => fail(new RpcError(RPC_CANCELLED, 'Connection cancelled.'));
    const failed = () => fail(new Error('Could not connect to the language server.'));
    const timer = setTimeout(() => fail(new Error('Language-server connection timed out.')), timeout);
    const open = () => {
      if (done) return; done = true; clean();
      resolve({
        send(message) {
          if (socket.readyState !== 1) throw new Error('Language-server socket is not open.');
          if (socket.bufferedAmount > 16 * 1024 * 1024) throw new Error('Language-server outgoing queue exceeds the limit.');
          socket.send(JSON.stringify(message));
        },
        listen(onMessage, onClose) {
          const message = event => typeof event.data === 'string' ? onMessage(event.data) : onClose(new Error('LSP WebSocket messages must be JSON text.'));
          const closed = () => onClose(new Error('Language-server WebSocket closed.'));
          socket.addEventListener('message', message); socket.addEventListener('close', closed); socket.addEventListener('error', closed);
          return () => { socket.removeEventListener('message', message); socket.removeEventListener('close', closed); socket.removeEventListener('error', closed); };
        },
        close: () => socket.close(),
      });
    };
    socket.addEventListener('open', open); socket.addEventListener('error', failed); socket.addEventListener('close', failed); signal?.addEventListener('abort', abort, { once: true });
  });
}
