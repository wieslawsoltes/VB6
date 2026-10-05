// External test driver only. Not an IDE capability.
import {MCP_VERSION, MCP_LEGACY_VERSIONS, MCP_META, McpError, errorResponse, checkAbort, checkMessage, isRecord, headerAnnotations, randomToken, awaitAbort} from '../../src/mcp/protocol.js';
import {HttpTransport, McpHttpError} from './mcp-transports.mjs';

/** Dual-era MCP client. Optional capabilities are advertised only with explicit handlers. */
export class McpClient {
  constructor(transport, {name = 'vb6-studio', version = '0.6.0', timeout = 30000, handlers = {}, onNotification = () => {}, onActivity = () => {}, approveTool, era = 'auto'} = {}) {
    this.transport = transport; this.info = {name, version}; this.timeout = timeout; this.handlers = handlers; this.onNotification = onNotification; this.onActivity = onActivity; this.approveTool = approveTool; this.era = era;
    this.lifetime = new AbortController(); this.sequence = 0; this.prefix = randomToken(8); this.version = MCP_VERSION; this.connected = false; this.controllers = new Set(); this.toolSchemas = new Map();
  }
  capabilities() {
    const result = {};
    if (this.handlers['roots/list']) result.roots = {};
    if (this.handlers['sampling/createMessage']) result.sampling = {};
    if (this.handlers['elicitation/create']) result.elicitation = {form: {}, url: {}};
    return result;
  }
  async receive(message, {signal} = {}) {
    const kind = checkMessage(message);
    if (kind === 'notification') { try { this.onNotification(message); } catch {} return; }
    if (kind !== 'request') return;
    try {
      if (message.method === 'ping') return {jsonrpc: '2.0', id: message.id, result: {}};
      const handler = this.handlers[message.method]; if (!handler) throw new McpError(-32601, 'Client capability is not enabled: ' + message.method);
      const result = await awaitAbort(handler(message.params || {}, {signal}), signal); return {jsonrpc: '2.0', id: message.id, result};
    } catch (error) { return errorResponse(message.id, error); }
  }
  async connect({signal} = {}) {
    checkAbort(signal); checkAbort(this.lifetime.signal);
    if (this.connected) return this.serverInfo;
    if (this.connecting) return awaitAbort(this.connecting, signal);
    this.connectSignal = signal;
    this.connecting = this.establish();
    try { return await this.connecting; } finally { this.connecting = null; }
  }
  async establish() {
    if (this.era !== 'legacy') {
      this.version = MCP_VERSION;
      try {
        const discovery = await this.request('server/discover', {}, {duringConnect: true, signal: this.connectSignal});
        if (!Array.isArray(discovery.supportedVersions) || !discovery.supportedVersions.includes(MCP_VERSION)) throw new McpError(-32022, 'Server discovery does not offer a supported modern version.');
        this.serverCapabilities = discovery.capabilities || {}; this.serverInfo = discovery._meta?.[MCP_META + 'serverInfo'] || {}; this.connected = true; return discovery;
      } catch (error) {
        if (this.lifetime.signal.aborted || this.era === 'modern' || error.code === -32800 || error.status === 401 || error.status === 403 || [-32020,-32021].includes(error.code)) throw error;
        if (error.code === -32022 && !error.data?.supported?.some(v => MCP_LEGACY_VERSIONS.includes(v))) throw error;
        const legacyError = error instanceof McpHttpError ? [400,404,405].includes(error.status) : [-32601,-32000,-32600].includes(error.code);
        if (!legacyError && error.code !== -32022) throw error;
      }
    }
    await this.initializeLegacy(); return this.serverInfo;
  }
  async initializeLegacy() {
    this.version = MCP_LEGACY_VERSIONS[0];
    const result = await this.request('initialize', {protocolVersion: this.version, capabilities: this.capabilities(), clientInfo: this.info}, {duringConnect: true, signal: this.connectSignal});
    if (!MCP_LEGACY_VERSIONS.includes(result.protocolVersion)) throw new McpError(-32022, 'Unsupported negotiated protocol version.');
    this.version = result.protocolVersion; this.serverInfo = result.serverInfo; this.serverCapabilities = result.capabilities || {};
    await awaitAbort(this.notify('notifications/initialized'), this.lifetime.signal); checkAbort(this.lifetime.signal); checkAbort(this.connectSignal); this.connected = true;
    if (this.transport instanceof HttpTransport) {
      this.listener?.abort(); this.listener = new AbortController();
      this.transport.listen(message => this.receive(message), {version: this.version, signal: this.listener.signal, onError: error => this.activity({direction: 'event', method: 'notifications', error: error.message})});
    }
  }
  activity(value) { try { this.onActivity(value); } catch {} }
  async notify(method, params = {}) { return this.transport.exchange({jsonrpc: '2.0', method, params}, {version: this.version, signal: AbortSignal.timeout(3000), onMessage: value => this.receive(value)}); }
  async request(method, params = {}, {signal, timeout = this.timeout, duringConnect = false, schema, onNotification} = {}) {
    checkAbort(this.lifetime.signal);
    if (!duringConnect && !this.connected) throw new McpError(-32000, 'Connect to an MCP server first.');
    if (!isRecord(params)) throw new McpError(-32602, 'MCP parameters must be an object.');
    if (this.controllers.size >= 128) throw new McpError(-32000, 'Too many pending MCP requests.');
    const controller = new AbortController(), abort = () => controller.abort(); this.controllers.add(controller);
    signal?.addEventListener('abort', abort, {once: true}); this.lifetime.signal.addEventListener('abort', abort, {once: true}); if (signal?.aborted || this.lifetime.signal.aborted) controller.abort();
    const timer = timeout > 0 ? setTimeout(abort, timeout) : null, start = Date.now(); let activeId;
    try {
      let next = {...params};
      for (let round = 0; round < 16; round++) {
        checkAbort(controller.signal); activeId = this.prefix + ':' + (++this.sequence);
        const bodyParams = this.version === MCP_VERSION ? {...next, _meta: {...next._meta, [MCP_META + 'protocolVersion']: this.version, [MCP_META + 'clientInfo']: this.info, [MCP_META + 'clientCapabilities']: this.capabilities()}} : next;
        const reply = await awaitAbort(this.transport.exchange({jsonrpc: '2.0', id: activeId, method, params: bodyParams}, {version: this.version, signal: controller.signal, schema, onMessage: message => { try { onNotification?.(message); } catch {} return this.receive(message, {signal: controller.signal}); }}), controller.signal);
        checkAbort(controller.signal);
        if (!reply || checkMessage(reply) !== 'response' || reply.id !== activeId) throw new McpError(-32600, 'Invalid MCP response.');
        if (reply.error) throw new McpError(reply.error.code, reply.error.message, reply.error.data);
        const result = reply.result;
        if (!isRecord(result)) throw new McpError(-32600, 'MCP result must be an object.');
        if (this.version === MCP_VERSION && !['complete','input_required'].includes(result.resultType)) throw new McpError(-32600, 'Invalid modern MCP resultType.');
        if (this.version !== MCP_VERSION || result.resultType !== 'input_required') { this.activity({direction: 'out', method, milliseconds: Date.now() - start}); return result; }
        if (!['tools/call','resources/read','prompts/get'].includes(method) || !result.inputRequests && result.requestState === undefined) throw new McpError(-32600, 'Unexpected input_required result.');
        if (result.inputRequests !== undefined && (!isRecord(result.inputRequests) || Object.keys(result.inputRequests).length > 32)) throw new McpError(-32600, 'Invalid input requests.');
        const inputResponses = Object.create(null);
        for (const [id, request] of Object.entries(result.inputRequests || {})) {
          const handler = this.handlers[request?.method];
          if (!['roots/list','sampling/createMessage','elicitation/create'].includes(request?.method) || !handler) throw new McpError(-32601, 'Required client capability is not enabled: ' + request?.method);
          inputResponses[id] = await awaitAbort(handler(request.params || {}, {signal: controller.signal}), controller.signal); checkAbort(controller.signal);
        }
        next = {...params, inputResponses};
        if (result.requestState !== undefined) { if (typeof result.requestState !== 'string') throw new McpError(-32600, 'Invalid requestState.'); next.requestState = result.requestState; }
        else delete next.requestState;
      }
      throw new McpError(-32000, 'Too many MCP input rounds.');
    } catch (error) {
      if (controller.signal.aborted && this.version !== MCP_VERSION && activeId && method !== 'initialize') this.notify('notifications/cancelled', {requestId: activeId, reason: 'Client cancelled or timed out.'}).catch(() => {});
      this.activity({direction: 'out', method, milliseconds: Date.now() - start, error: controller.signal.aborted ? 'Cancelled or timed out.' : error.message});
      if (error.sessionExpired && !duringConnect && !controller.signal.aborted && !this.lifetime.signal.aborted) { this.connected = false; await this.initializeLegacy().catch(() => {}); }
      if (controller.signal.aborted) throw new McpError(-32800, 'MCP request cancelled or timed out.'); throw error;
    } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); this.lifetime.signal.removeEventListener('abort', abort); this.controllers.delete(controller); }
  }
  async list(method, field, options = {}) {
    const result = [], cursors = new Set(); let cursor;
    for (let page = 0; page < 100; page++) {
      const response = await this.request(method, cursor === undefined ? {} : {cursor}, options);
      if (!Array.isArray(response[field])) throw new McpError(-32600, 'Invalid ' + field + ' list.');
      if (result.length + response[field].length > 10000) throw new McpError(-32600, 'MCP catalog exceeds 10,000 entries.');
      result.push(...response[field]); cursor = response.nextCursor; if (cursor === undefined) return result;
      if (typeof cursor !== 'string' || cursors.has(cursor)) throw new McpError(-32600, 'Invalid or repeating pagination cursor.'); cursors.add(cursor);
    }
    throw new McpError(-32600, 'MCP pagination limit exceeded.');
  }
  async listTools(options) {
    const tools = await this.list('tools/list', 'tools', options), valid = []; this.toolSchemas.clear();
    for (const tool of tools) {
      try { if (typeof tool.name !== 'string' || !isRecord(tool.inputSchema) || tool.inputSchema.type !== 'object') throw new Error('Invalid tool definition.'); if (this.version === MCP_VERSION && this.transport instanceof HttpTransport) headerAnnotations(tool.inputSchema); if (this.toolSchemas.has(tool.name)) throw new Error('Duplicate tool name.'); this.toolSchemas.set(tool.name, tool.inputSchema); valid.push(tool); }
      catch (error) { this.activity({direction: 'event', method: 'tools/list', error: 'Excluded invalid tool: ' + String(tool?.name).slice(0, 100)}); }
    }
    return valid;
  }
  async callTool(name, args = {}, options = {}) {
    const signal = options.signal ? AbortSignal.any([options.signal, this.lifetime.signal]) : this.lifetime.signal; checkAbort(signal);
    options = {...options, signal};
    if (this.approveTool && !await awaitAbort(this.approveTool({name, arguments: args, endpoint: this.transport.url || 'local'}, options), signal)) throw new McpError(-32001, 'Tool invocation declined.');
    checkAbort(options.signal);
    if (!this.toolSchemas.has(name)) await this.listTools(options);
    if (!this.toolSchemas.has(name)) throw new McpError(-32602, 'Tool is not present in the validated catalog.');
    return this.request('tools/call', {name, arguments: args}, {...options, schema: this.toolSchemas.get(name)});
  }
  listResources(options) { return this.list('resources/list', 'resources', options); }
  listResourceTemplates(options) { return this.list('resources/templates/list', 'resourceTemplates', options); }
  readResource(uri, options) { return this.request('resources/read', {uri}, options); }
  listPrompts(options) { return this.list('prompts/list', 'prompts', options); }
  getPrompt(name, args = {}, options) { return this.request('prompts/get', {name, arguments: args}, options); }
  complete(ref, argument, context, options) { return this.request('completion/complete', {ref, argument, ...(context ? {context} : {})}, options); }
  subscribe(notifications, options = {}) {
    if (this.version !== MCP_VERSION) throw new McpError(-32601, 'Use subscribeResource for a legacy server.');
    return this.request('subscriptions/listen', {notifications}, {...options, timeout: 0});
  }
  subscribeResource(uri, options) { return this.request('resources/subscribe', {uri}, options); }
  unsubscribeResource(uri, options) { return this.request('resources/unsubscribe', {uri}, options); }
  async close() { this.lifetime.abort(); this.connected = false; this.listener?.abort(); for (const controller of this.controllers) controller.abort(); try { await this.transport.close?.(this.version); } catch (error) { this.activity({direction: 'event', method: 'disconnect', error: error.message}); } finally { this.toolSchemas.clear(); } }
}
