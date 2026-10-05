import {McpTasks, TASK_EXTENSION, requireTasks} from './tasks.js';
import {randomToken, MCP_VERSION, MCP_LIMIT, MCP_VERSIONS, MCP_LEGACY_VERSIONS, MCP_META, McpError, checkMessage, errorResponse, isRecord, checkAbort, validateArguments, validateHeaders, pageItems, awaitAbort, utf8Length} from './protocol.js';

/** MCP server reusable with a browser IDE, a headless adapter, MessagePort, stdio or HTTP. */
export class McpServer {
  constructor(adapter, {name = 'vb6-studio', version = '0.6.0', taskTools = ['vb6.agent.wait']} = {}) {
    this.adapter = adapter; this.info = {name, version}; this.sessions = new Map(); this.active = new Map(); this.listeners = new Set();
    this.tools = new Map(adapter.tools.map(tool => [tool.name, tool]));
    this.taskTools = new Set(taskTools);
    this.tasks = new McpTasks({changed: (task, principal) => {
      for (const listener of this.listeners) if (listener.principal === principal && listener.filter.taskIds?.includes(task.taskId))
        this.emit(listener, {jsonrpc: '2.0', method: 'notifications/tasks', params: {...task, ...listener.meta}});
    }});
    this.disposeChange = adapter.onChange?.(change => this.changed(change));
  }
  capabilities(modern = false) {
    return {tools: {listChanged: true}, resources: {listChanged: true, ...(!modern ? {subscribe: true} : {})}, prompts: {listChanged: true}, completions: {}, ...(modern ? {extensions: {[TASK_EXTENSION]: {}}} : {logging: {}})};
  }
  emit(listener, message) {
    try { Promise.resolve(listener.emit(message)).catch(() => this.listeners.delete(listener)); }
    catch { this.listeners.delete(listener); }
  }
  async catalogStamp() {
    return {tools: JSON.stringify(this.adapter.tools.map(({execute, ...tool}) => tool)),
      prompts: JSON.stringify((this.adapter.prompts || []).map(({get, ...prompt}) => prompt)),
      resources: JSON.stringify(await this.adapter.resources?.() || [])};
  }
  changed(change = {}) {
    // Compare catalogs, not revisions: typing changes resource contents, not the
    // resource list. Failures in one transport cannot break another subscriber.
    for (const listener of this.listeners) {
      if (this.adapter.enabled === false || listener.legacy && !this.sessions.get(listener.sessionKey)?.ready) continue;
        for (const uri of listener.filter.resourceSubscriptions || []) if (!change.uris || change.uris.includes(uri))
          this.emit(listener, {jsonrpc: '2.0', method: 'notifications/resources/updated', params: {uri, ...listener.meta}});
      listener.pending = (listener.pending || Promise.resolve()).then(async () => {
        if (!this.listeners.has(listener) || this.adapter.enabled === false) return;
        const stamp = await this.catalogStamp();
        if (!this.listeners.has(listener) || this.adapter.enabled === false) return;
        for (const type of ['tools', 'prompts', 'resources']) if (listener.filter[type + 'ListChanged'] && listener.stamp?.[type] !== stamp[type])
          this.emit(listener, {jsonrpc: '2.0', method: 'notifications/' + type + '/list_changed', params: listener.meta});
        listener.stamp = stamp;
        this.tools = new Map(this.adapter.tools.map(tool => [tool.name, tool]));
      }).catch(() => {});
    }
  }
  revokePrincipal(principal) { if (!principal) return; this.tasks.clear(principal); this.adapter.revokePrincipal?.(principal); }
  closeSession(key) {
    this.sessions.delete(key);
    for (const [id, request] of this.active) if (request.sessionKey === key) { request.controller.abort(); this.active.delete(id); }
    for (const listener of this.listeners) if (listener.sessionKey === key) this.listeners.delete(listener);
  }
  revoke() { this.tasks.clear(); this.adapter.revokeArtifacts?.(); for (const request of this.active.values()) request.controller.abort(); this.active.clear(); this.sessions.clear(); this.listeners.clear(); }
  close() { this.revoke(); this.disposeChange?.(); }
  async dispatch(message, context = {}) {
    let kind;
    try { kind = checkMessage(message); if (utf8Length(JSON.stringify(message)) > MCP_LIMIT) throw new McpError(-32600, 'MCP request exceeds the 8 MiB message limit.'); } catch (error) { return errorResponse(message?.id, error); }
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
    let progress = -1;
    ctx.reportProgress = (value, total, text) => {
      const token = params._meta?.progressToken;
      if ((typeof token !== 'string' && !(typeof token === 'number' && Number.isFinite(token))) || ctx.signal.aborted || !Number.isFinite(value) || value <= progress) return;
      progress = value;
      emit({jsonrpc: '2.0', method: 'notifications/progress', params: {progressToken: token, progress: value, ...(Number.isFinite(total) ? {total} : {}), ...(text ? {message: String(text).slice(0, 1000)} : {})}});
    };
    ctx.log = (level, data) => {
      const levels = ['debug','info','notice','warning','error','critical','alert','emergency'];
      const threshold = modern ? params._meta?.[MCP_META + 'logLevel'] : session?.logLevel;
      if (!ctx.signal.aborted && levels.includes(level) && levels.includes(threshold) && levels.indexOf(level) >= levels.indexOf(threshold))
        emit({jsonrpc: '2.0', method: 'notifications/message', params: {level, logger: 'vb6-studio', data}});
    };
    try {
      checkAbort(ctx.signal);
      if (modern) {
        if (version !== MCP_VERSION) throw new McpError(-32022, 'Unsupported protocol version.', {supported: MCP_VERSIONS, requested: version});
        if (!isRecord(params._meta[MCP_META + 'clientCapabilities'])) throw new McpError(-32602, 'Modern MCP requires per-request clientCapabilities.');
        const info = params._meta[MCP_META + 'clientInfo'];
        if (info !== undefined && (!isRecord(info) || typeof info.name !== 'string' || typeof info.version !== 'string')) throw new McpError(-32602, 'Invalid optional clientInfo.');
        if (context.headers) validateHeaders(message, context.headers, this.tools.get(params.name)?.inputSchema);
      } else if (message.method !== 'initialize' && message.method !== 'ping' && !session?.ready) throw new McpError(-32000, 'Initialize the MCP session first.');
      let result;
      if (message.method === 'server/discover' && modern) result = {supportedVersions: MCP_VERSIONS, capabilities: this.capabilities(true), instructions: 'VB6 IDE tools. Sharing must be enabled in the IDE. Changes and execution require local approval or an unexpired locally authorized scope. Read the current revision before editing.'};
      else if (message.method === 'initialize' && !modern) {
        if (session) throw new McpError(-32600, 'This session is already initialized.');
        if (this.sessions.size >= 64) throw new McpError(-32000, 'Too many MCP sessions.');
        if (typeof params.protocolVersion !== 'string' || !isRecord(params.capabilities) || !isRecord(params.clientInfo)) throw new McpError(-32602, 'Invalid initialize parameters.');
        const selected = MCP_LEGACY_VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : MCP_LEGACY_VERSIONS[0];
        const stamp = await awaitAbort(this.catalogStamp(), ctx.signal); checkAbort(ctx.signal);
        if (this.sessions.has(sessionKey)) throw new McpError(-32600, 'This session is already initialized.');
        if (this.sessions.size >= 64) throw new McpError(-32000, 'Too many MCP sessions.');
        this.sessions.set(sessionKey, {version: selected, ready: false, subscriptions: new Set(), clientInfo: params.clientInfo});
        this.listeners.add({sessionKey, legacy: true, emit: context.notify || emit, meta: {}, stamp,
          filter: {toolsListChanged: true, promptsListChanged: true, resourcesListChanged: true, resourceSubscriptions: []}});
        result = {protocolVersion: selected, capabilities: this.capabilities(), serverInfo: this.info, instructions: 'Enable MCP sharing in the IDE. Edits require expectedRevision and local approval or an unexpired locally authorized scope.'};
      } else if (message.method === 'ping') result = {};
      else {
        this.adapter.assertEnabled?.();
        result = await awaitAbort(this.handle(message.method, params, ctx, modern, session), ctx.signal);
      }
      checkAbort(ctx.signal);
      if (modern) {
        const cacheable = ['server/discover','tools/list','prompts/list','resources/list','resources/templates/list','resources/read'].includes(message.method);
        result = {...result, resultType: result.resultType || 'complete', ...(cacheable ? {ttlMs: 0, cacheScope: 'private'} : {}), _meta: {...result._meta, [MCP_META + 'serverInfo']: this.info}};
      }
      if (utf8Length(JSON.stringify({jsonrpc: '2.0', id: message.id, result})) > MCP_LIMIT) throw new McpError(-32000, 'MCP result exceeds the 8 MiB message limit; read smaller source ranges.');
      return {jsonrpc: '2.0', id: message.id, result};
    } catch (error) {
      // -32002 is reserved as legacy resource-not-found by modern MCP. Preserve
      // its diagnostic/data while translating stale arguments and missing URIs.
      if (modern && error instanceof McpError && error.code === -32002) error = new McpError(-32602, error.message, error.data);
      return errorResponse(message.id, error);
    }
    finally { context.signal?.removeEventListener('abort', abort); if (this.active.get(key)?.controller === controller) this.active.delete(key); }
  }
  async handle(method, params, context, modern, session) {
    const paginate = (items, field) => { items = [...items].sort((a, b) => { const x = a.name || a.uri || a.uriTemplate || '', y = b.name || b.uri || b.uriTemplate || ''; return x < y ? -1 : x > y ? 1 : 0; }); const page = pageItems(items, params.cursor); return {[field]: page.items, ...(page.nextCursor ? {nextCursor: page.nextCursor} : {})}; };
    switch (method) {
      case 'tools/list': this.tools = new Map(this.adapter.tools.map(tool => [tool.name, tool])); return paginate([...this.tools.values()].map(({execute, ...tool}) => tool), 'tools');
      case 'tools/call': {
        const tool = this.tools.get(params.name); if (!tool) throw new McpError(-32602, 'Unknown tool: ' + params.name);
        const args = params.arguments === undefined ? {} : params.arguments;
        validateArguments(args, tool.inputSchema);
        const run = async ctx => {
          try {
            ctx.reportProgress?.(0, 1, 'Starting ' + tool.name);
            const output = await tool.execute(args, ctx); checkAbort(ctx.signal);
            const data = isRecord(output) ? output : {value: output};
            if (tool.outputSchema) { try { validateArguments(data, tool.outputSchema, 'result'); } catch { throw new McpError(-32603, 'Tool output does not match its outputSchema.'); } }
            ctx.reportProgress?.(1, 1, 'Completed ' + tool.name);
            return {content: [{type: 'text', text: JSON.stringify(data, null, 2)}], structuredContent: data, isError: false};
          } catch (error) {
            if (ctx.signal?.aborted || error instanceof McpError) throw error;
            return {content: [{type: 'text', text: String(error.message || error).slice(0, 2000)}], isError: true};
          }
        };
        if (modern && this.taskTools.has(tool.name) && isRecord(params._meta?.[MCP_META + 'clientCapabilities']?.extensions?.[TASK_EXTENSION]))
          return this.tasks.create(run, context, this.adapter.authoritySignal);
        return run(context);
      }
      case 'tasks/get': case 'tasks/update': case 'tasks/cancel': {
        if (!modern) throw new McpError(-32601, 'Tasks require the modern Tasks extension.');
        requireTasks(params);
        if (method === 'tasks/get') return this.tasks.get(params.taskId, context);
        if (method === 'tasks/cancel') return this.tasks.cancel(params.taskId, context);
        return this.tasks.update(params.taskId, params.inputResponses, context);
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
        for (const value of Object.values(params.arguments || {})) if (typeof value !== 'string') throw new McpError(-32602, 'Prompt argument values must be strings.');
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
        if (!listener) { listener = {stamp: await this.catalogStamp(), sessionKey: context.sessionKey, legacy: true, emit: context.notify || context.emit, meta: {}, filter: {resourceSubscriptions: []}}; this.listeners.add(listener); }
        listener.filter.resourceSubscriptions = [...session.subscriptions]; return {};
      }
      case 'subscriptions/listen': {
        if (!modern || !isRecord(params.notifications)) throw new McpError(-32602, 'Modern subscriptions require a notifications filter.');
        const filter = {}, requested = params.notifications;
        for (const name of ['toolsListChanged','promptsListChanged','resourcesListChanged']) {
          if (requested[name] !== undefined && typeof requested[name] !== 'boolean') throw new McpError(-32602, 'Invalid subscription filter.');
          if (requested[name] === true) filter[name] = true;
        }
        if (requested.taskIds !== undefined) {
          requireTasks(params);
          if (!Array.isArray(requested.taskIds) || requested.taskIds.length > 32) throw new McpError(-32602, 'Invalid task subscriptions.');
          for (const id of requested.taskIds) this.tasks.find(id, context);
          filter.taskIds = [...new Set(requested.taskIds)];
        }
        if (requested.resourceSubscriptions !== undefined) {
          if (!Array.isArray(requested.resourceSubscriptions) || requested.resourceSubscriptions.length > 100 || requested.resourceSubscriptions.some(uri => typeof uri !== 'string')) throw new McpError(-32602, 'Invalid resource subscriptions.');
          for (const uri of requested.resourceSubscriptions) await this.adapter.readResource(uri, context);
          filter.resourceSubscriptions = [...new Set(requested.resourceSubscriptions)];
        }
        const stamp = await this.catalogStamp(); checkAbort(context.signal);
        const meta = {_meta: {[MCP_META + 'subscriptionId']: context.requestId}}, listener = {stamp, principal: this.tasks.principal(context), sessionKey: context.sessionKey, filter, emit: context.emit, meta};
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
export function bindMcpPort(port, server, {sessionKey = 'port-' + randomToken(24), onError = () => {}} = {}) {
  const lifetime = new AbortController();
  port.onmessage = async event => {
    try { const reply = await server.dispatch(event.data, {sessionKey, signal: lifetime.signal, requestId: event.data?.id, emit: message => port.postMessage(message), notify: message => { if (!lifetime.signal.aborted) port.postMessage(message); }}); if (reply && !lifetime.signal.aborted) port.postMessage(reply); }
    catch (error) { onError(error); }
  };
  port.start?.();
  return () => { lifetime.abort(); port.onmessage = null; port.close(); server.closeSession(sessionKey); server.revokePrincipal(sessionKey); };
}
