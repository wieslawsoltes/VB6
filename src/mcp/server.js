import {MCP_VERSION, MCP_LIMIT, MCP_VERSIONS, MCP_LEGACY_VERSIONS, MCP_META, McpError, checkMessage, errorResponse, isRecord, checkAbort, validateArguments, validateHeaders, pageItems, awaitAbort} from './protocol.js';

/** MCP server reusable with a browser IDE, a headless adapter, MessagePort, stdio or HTTP. */
export class McpServer {
  constructor(adapter, {name = 'vb6-studio', version = '0.6.0'} = {}) {
    this.adapter = adapter; this.info = {name, version}; this.sessions = new Map(); this.active = new Map(); this.listeners = new Set();
    this.tools = new Map(adapter.tools.map(tool => [tool.name, tool]));
    this.disposeChange = adapter.onChange?.(change => this.changed(change));
  }
  capabilities(modern = false) {
    return {tools: modern ? {} : {listChanged: true}, resources: modern ? {} : {subscribe: true, listChanged: true}, prompts: modern ? {} : {listChanged: true}, completions: {}, ...(modern ? {} : {logging: {}})};
  }
  changed(change = {}) {
    for (const listener of this.listeners) {
      const filter = listener.filter;
      if (filter.resourcesListChanged) listener.emit({jsonrpc: '2.0', method: 'notifications/resources/list_changed', params: listener.meta});
      for (const uri of filter.resourceSubscriptions || []) if (!change.uris || change.uris.includes(uri)) listener.emit({jsonrpc: '2.0', method: 'notifications/resources/updated', params: {uri, ...listener.meta}});
    }
  }
  closeSession(key) {
    this.sessions.delete(key);
    for (const [id, request] of this.active) if (request.sessionKey === key) { request.controller.abort(); this.active.delete(id); }
    for (const listener of this.listeners) if (listener.sessionKey === key) this.listeners.delete(listener);
  }
  revoke() { for (const request of this.active.values()) request.controller.abort(); this.active.clear(); this.sessions.clear(); this.listeners.clear(); }
  close() { this.revoke(); this.disposeChange?.(); }
  async dispatch(message, context = {}) {
    let kind;
    try { kind = checkMessage(message); } catch (error) { return errorResponse(message?.id, error); }
    if (kind === 'response') return undefined;
    const sessionKey = context.sessionKey || 'local', session = this.sessions.get(sessionKey);
    const params = message.params || {}, version = params._meta?.[MCP_META + 'protocolVersion'];
    const modern = version !== undefined, emit = context.emit || (() => {});
    if (kind === 'notification') {
      if (message.method === 'notifications/initialized' && session) session.ready = true;
      if (message.method === 'notifications/cancelled') this.active.get(sessionKey + ':' + typeof params.requestId + ':' + params.requestId)?.controller.abort();
      return undefined;
    }
    const key = sessionKey + ':' + typeof message.id + ':' + message.id;
    if (this.active.has(key)) return errorResponse(message.id, new McpError(-32600, 'Duplicate active request ID.'));
    if (this.active.size >= 128) return errorResponse(message.id, new McpError(-32000, 'Too many pending requests.'));
    const controller = new AbortController(), abort = () => controller.abort();
    context.signal?.addEventListener('abort', abort, {once: true}); if (context.signal?.aborted) controller.abort();
    this.active.set(key, {controller, sessionKey});
    const ctx = {...context, requestId: message.id, sessionKey, signal: controller.signal, emit};
    try {
      checkAbort(ctx.signal);
      if (modern) {
        if (version !== MCP_VERSION) throw new McpError(-32022, 'Unsupported protocol version.', {supported: MCP_VERSIONS, requested: version});
        if (!isRecord(params._meta[MCP_META + 'clientInfo']) || !isRecord(params._meta[MCP_META + 'clientCapabilities'])) throw new McpError(-32602, 'Modern MCP requires per-request clientInfo and clientCapabilities.');
        if (context.headers) validateHeaders(message, context.headers, this.tools.get(params.name)?.inputSchema);
      } else if (message.method !== 'initialize' && message.method !== 'ping' && !session?.ready) throw new McpError(-32000, 'Initialize the MCP session first.');
      let result;
      if (message.method === 'server/discover' && modern) result = {supportedVersions: MCP_VERSIONS, capabilities: this.capabilities(true), instructions: 'VB6 IDE tools. Sharing must be enabled in the IDE. Changes and execution require local approval or an unexpired locally authorized scope. Read the current revision before editing.'};
      else if (message.method === 'initialize' && !modern) {
        if (session) throw new McpError(-32600, 'This session is already initialized.');
        if (this.sessions.size >= 64) throw new McpError(-32000, 'Too many MCP sessions.');
        if (typeof params.protocolVersion !== 'string' || !isRecord(params.capabilities) || !isRecord(params.clientInfo)) throw new McpError(-32602, 'Invalid initialize parameters.');
        const selected = MCP_LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : MCP_LEGACY_VERSIONS[0];
        this.sessions.set(sessionKey, {version: selected, ready: false, subscriptions: new Set(), clientInfo: params.clientInfo});
        result = {protocolVersion: selected, capabilities: this.capabilities(), serverInfo: this.info, instructions: 'Enable MCP sharing in the IDE. Edits require expectedRevision and local approval or an unexpired locally authorized scope.'};
      } else if (message.method === 'ping') result = {};
      else {
        this.adapter.assertEnabled?.();
        result = await awaitAbort(this.handle(message.method, params, ctx, modern, session), ctx.signal);
      }
      checkAbort(ctx.signal);
      if (modern) result = {...result, resultType: result.resultType || 'complete', _meta: {...result._meta, [MCP_META + 'serverInfo']: this.info}};
      if (JSON.stringify(result).length > MCP_LIMIT) throw new McpError(-32000, 'MCP result exceeds the 8 MiB message limit; read smaller source ranges.');
      return {jsonrpc: '2.0', id: message.id, result};
    } catch (error) { return errorResponse(message.id, error); }
    finally { context.signal?.removeEventListener('abort', abort); if (this.active.get(key)?.controller === controller) this.active.delete(key); }
  }
  async handle(method, params, context, modern, session) {
    const paginate = (items, field) => { const page = pageItems(items, params.cursor); return {[field]: page.items, ...(page.nextCursor ? {nextCursor: page.nextCursor} : {})}; };
    switch (method) {
      case 'tools/list': return paginate([...this.tools.values()].map(({execute, ...tool}) => tool), 'tools');
      case 'tools/call': {
        const tool = this.tools.get(params.name); if (!tool) throw new McpError(-32602, 'Unknown tool: ' + params.name);
        validateArguments(params.arguments || {}, tool.inputSchema);
        try {
          const output = await tool.execute(params.arguments || {}, context); checkAbort(context.signal);
          const data = isRecord(output) ? output : {value: output};
          return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}], structuredContent: data, isError: false};
        } catch (error) {
          if (context.signal?.aborted || error instanceof McpError) throw error;
          return {content: [{type: 'text', text: String(error.message || error).slice(0, 2000)}], isError: true};
        }
      }
      case 'resources/list': return paginate(await this.adapter.resources(), 'resources');
      case 'resources/templates/list': return paginate(this.adapter.templates || [], 'resourceTemplates');
      case 'resources/read':
        if (typeof params.uri !== 'string') throw new McpError(-32602, 'A resource URI is required.');
        return {contents: await this.adapter.readResource(params.uri, context)};
      case 'prompts/list': return paginate((this.adapter.prompts || []).map(({get, ...prompt}) => prompt), 'prompts');
      case 'prompts/get': {
        const prompt = this.adapter.prompts?.find(p => p.name === params.name); if (!prompt) throw new McpError(-32602, 'Unknown prompt.');
        if (params.arguments !== undefined && !isRecord(params.arguments)) throw new McpError(-32602, 'Prompt arguments must be an object.');
        for (const arg of prompt.arguments || []) if (arg.required && typeof params.arguments?.[arg.name] !== 'string') throw new McpError(-32602, 'Missing prompt argument: ' + arg.name);
        return prompt.get(params.arguments || {}, context);
      }
      case 'completion/complete': return this.adapter.complete ? this.adapter.complete(params) : {completion: {values: [], total: 0, hasMore: false}};
      case 'logging/setLevel':
        if (modern) throw new McpError(-32601, 'logging/setLevel is not part of modern MCP.');
        if (!['debug','info','notice','warning','error','critical','alert','emergency'].includes(params.level)) throw new McpError(-32602, 'Unknown log level.');
        session.logLevel = params.level; return {};
      case 'resources/subscribe': case 'resources/unsubscribe': {
        if (modern) throw new McpError(-32601, 'Use subscriptions/listen with modern MCP.');
        if (typeof params.uri !== 'string') throw new McpError(-32602, 'A resource URI is required.');
        await this.adapter.readResource(params.uri, context);
        if (method === 'resources/subscribe') session.subscriptions.add(params.uri); else session.subscriptions.delete(params.uri);
        let listener = [...this.listeners].find(l => l.sessionKey === context.sessionKey && l.legacy);
        if (!listener) { listener = {sessionKey: context.sessionKey, legacy: true, emit: context.notify || context.emit, meta: {}, filter: {resourceSubscriptions: []}}; this.listeners.add(listener); }
        listener.filter.resourceSubscriptions = [...session.subscriptions]; return {};
      }
      case 'subscriptions/listen': {
        if (!modern || !isRecord(params.notifications)) throw new McpError(-32602, 'Modern subscriptions require a notifications filter.');
        const filter = {}, requested = params.notifications;
        if (requested.resourcesListChanged === true) filter.resourcesListChanged = true;
        if (requested.resourceSubscriptions !== undefined) {
          if (!Array.isArray(requested.resourceSubscriptions) || requested.resourceSubscriptions.length > 100 || requested.resourceSubscriptions.some(uri => typeof uri !== 'string')) throw new McpError(-32602, 'Invalid resource subscriptions.');
          for (const uri of requested.resourceSubscriptions) await this.adapter.readResource(uri, context);
          filter.resourceSubscriptions = [...new Set(requested.resourceSubscriptions)];
        }
        const meta = {_meta: {[MCP_META + 'subscriptionId']: context.requestId}}, listener = {sessionKey: context.sessionKey, filter, emit: context.emit, meta};
        context.emit({jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged', params: {notifications: filter, ...meta}});
        this.listeners.add(listener);
        try { await new Promise(resolve => { if (context.signal.aborted) resolve(); else context.signal.addEventListener('abort', resolve, {once: true}); }); }
        finally { this.listeners.delete(listener); }
        checkAbort(context.signal); return {};
      }
      default: throw new McpError(-32601, 'Method not found: ' + method);
    }
  }
}
/** Explicitly attach a private MessagePort; no global window-message listener or wildcard trust. */
export function bindMcpPort(port, server, {sessionKey = 'port', onError = () => {}} = {}) {
  const lifetime = new AbortController();
  port.onmessage = async event => {
    try { const reply = await server.dispatch(event.data, {sessionKey, signal: lifetime.signal, requestId: event.data?.id, emit: message => port.postMessage(message), notify: message => { if (!lifetime.signal.aborted) port.postMessage(message); }}); if (reply && !lifetime.signal.aborted) port.postMessage(reply); }
    catch (error) { onError(error); }
  };
  port.start?.();
  return () => { lifetime.abort(); port.onmessage = null; port.close(); server.closeSession(sessionKey); };
}
