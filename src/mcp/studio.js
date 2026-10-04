import {el, download} from '../core/core.js';
import {modal, tabbedPages} from '../ide/ui.js';
import {MCP_VERSION, McpError, checkAbort, httpURL, isRecord} from './protocol.js';
import {McpClient} from './client.js';
import {McpServer, bindMcpPort} from './server.js';
import {HttpTransport, LegacySseTransport, LocalTransport, PortTransport} from './transports.js';
import {createIdeAdapter} from './ide-adapter.js';
import {BrowserBridge} from './bridge-client.js';
import {McpOAuth} from './oauth.js';

const field = (label, input) => el('label', {class: 'mcp-field'}, el('span', {}, label), input);
const button = (text, action) => el('button', {type: 'button', onclick: action}, text);
const input = (label, attrs = {}) => el('input', {'aria-label': label, ...attrs});
const safeText = value => JSON.stringify(value, null, 2).slice(0, 2000000);
const codeBox = (label, value = '{}') => el('textarea', {'aria-label': label, spellcheck: false, value});
const group = (legend, ...children) => el('fieldset', {}, el('legend', {}, legend), ...children);

export function parseMcpConfig(value) {
  const parsed = typeof value === 'string' ? JSON.parse(value) : value;
  if (!isRecord(parsed)) throw new McpError(-32602, 'Expected an MCP configuration object.');
  const entries = parsed.mcpServers || parsed.servers; if (!isRecord(entries) || Object.keys(entries).length > 50) throw new McpError(-32602, 'Use mcpServers or servers with at most 50 entries.');
  const configs = [], warnings = [];
  for (const [name, entry] of Object.entries(entries)) {
    if (!isRecord(entry)) throw new McpError(-32602, 'Invalid configuration for ' + name);
    if (entry.command) { warnings.push(name + ': stdio commands must be explicitly configured in the companion (--config). Use its /stdio/' + encodeURIComponent(name) + ' URL here.'); continue; }
    const url = httpURL(entry.url).href;
    if (entry.type && !['http','sse','streamable-http','auto'].includes(entry.type)) throw new McpError(-32602, 'Unknown MCP transport: ' + entry.type);
    if (entry.headers || entry.token || entry.env) warnings.push(name + ': credentials and custom headers were not imported. Enter the token for this session.');
    configs.push({name: name.slice(0, 100), url, type: entry.type === 'sse' ? 'sse' : 'auto'});
  }
  return {configs, warnings};
}
export function exportMcpConfig(configs) {
  const servers = Object.create(null);
  for (const config of configs) if (config.url) {
    const url = new URL(config.url); for (const key of [...url.searchParams.keys()]) if (/token|secret|password|credential|authorization|api.?key/i.test(key)) url.searchParams.delete(key);
    servers[config.name] = {type: config.type === 'sse' ? 'sse' : 'http', url: url.href};
  }
  return {mcpServers: servers};
}
let promptQueue = Promise.resolve();
function promptModal(title, options) {
  const job = promptQueue.catch(() => {}).then(() => modal(title, options)); promptQueue = job; return job;
}
function approvalQueue() {
  let tail = Promise.resolve();
  return (request, {signal} = {}) => {
    const job = tail.catch(() => {}).then(async () => {
      checkAbort(signal);
      const fullArguments = JSON.stringify(request.arguments || {}, null, 2), details = el('div', {}, el('pre', {class: 'mcp-approval-details'}, fullArguments.slice(0, 12000)), ...(fullArguments.length > 12000 ? [el('p', {}, 'Preview truncated. Download the complete arguments to review all changes before allowing this request.'), button('Download full request arguments', () => download('mcp-request.json', fullArguments, 'application/json'))] : []));
      let abort;
      try {
        return await promptModal('Allow MCP operation?', {width: 660,
          content: el('div', {class: 'mcp-approval'}, el('p', {}, 'An MCP client is requesting an operation. Allowing it can change data or execute code. Approval applies to this request only.'),
            el('p', {}, 'Operation: ' + request.name), el('p', {}, 'Peer: ' + (request.endpoint || request.peer || 'MCP client')), request.projectName ? el('p', {}, 'Project: ' + request.projectName) : '', details),
          buttons: [{label: 'Deny', value: false, primary: true}, {label: 'Allow once', value: true}],
          onReady: ({finish}) => { abort = () => finish(false); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort(); }});
      } finally { if (abort) signal?.removeEventListener('abort', abort); }
    }); tail = job; return job;
  };
}
async function elicit(params, {signal} = {}) {
  checkAbort(signal); const content = el('div', {class: 'mcp-elicitation'}, el('p', {}, String(params.message || 'The MCP server requests input.').slice(0, 4000))), fields = [];
  if (params.mode === 'url') {
    const url = httpURL(params.url); content.append(el('p', {}, 'This opens an external site. Do not enter credentials unless you trust its exact address.'), el('a', {href: url.href, target: '_blank', rel: 'noopener noreferrer'}, url.href));
  } else {
    const schema = params.requestedSchema;
    if (!isRecord(schema) || schema.type !== 'object' || !isRecord(schema.properties) || Object.keys(schema.properties).length > 24) throw new McpError(-32602, 'Unsupported elicitation form schema.');
    for (const [name, property] of Object.entries(schema.properties)) {
      if (!isRecord(property) || !['string','integer','number','boolean'].includes(property.type) || ['__proto__','prototype','constructor'].includes(name)) throw new McpError(-32602, 'Unsupported elicitation field.');
      const node = Array.isArray(property.enum) ? el('select', {'aria-label': name}, ...property.enum.map(value => el('option', {value: String(value)}, String(value)))) : input(name, {type: property.type === 'boolean' ? 'checkbox' : property.type === 'integer' || property.type === 'number' ? 'number' : 'text'});
      if (property.default !== undefined) { if (property.type === 'boolean') node.checked = !!property.default; else node.value = String(property.default); }
      if (schema.required?.includes(name)) node.required = true;
      if (typeof property.minLength === 'number') node.minLength = property.minLength; if (typeof property.maxLength === 'number') node.maxLength = Math.min(property.maxLength, 10000);
      if (property.minimum !== undefined) node.min = property.minimum; if (property.maximum !== undefined) node.max = property.maximum;
      if (property.type === 'integer') node.step = '1'; else if (property.type === 'number') node.step = 'any';
      content.append(field(String(property.title || name), node)); fields.push({name, property, node});
    }
  }
  let abort;
  try {
    const accepted = await promptModal('MCP server requests input', {width: 560, content, buttons: [{label: 'Decline', value: false, primary: true}, {label: 'Submit', value: true, action: () => fields.every(({node}) => node.reportValidity())}],
      onReady: ({finish}) => { abort = () => finish(false); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort(); }});
    if (!accepted) return {action: signal?.aborted ? 'cancel' : 'decline'};
    if (params.mode === 'url') return {action: 'accept'};
    const result = Object.create(null); for (const {name, property, node} of fields) { if (!node.required && !node.value && property.type !== 'boolean') continue; result[name] = property.type === 'boolean' ? node.checked : ['number','integer'].includes(property.type) ? Number(node.value) : node.value; }
    return {action: 'accept', content: result};
  } finally { signal?.removeEventListener('abort', abort); }
}

/** Installs a modeless native-style MCP tool window without changing IDE runtime semantics. */
export function installMcp(ide, studioAPI, {approve = approvalQueue()} = {}) {
  if (ide.mcp) return ide.mcp;
  const listeners = new Set(), clients = new Map(), configs = [], log = []; let sequence = 0;
  const activity = entry => { log.push({time: new Date().toISOString(), ...entry}); if (log.length > 300) log.splice(0, log.length - 300); for (const listener of listeners) listener(); };
  const adapter = createIdeAdapter(ide, {approve, onActivity: activity}), server = new McpServer(adapter);
  const api = {adapter, server, clients, configs, log, approve, bridge: null,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async setSharing(enabled) { adapter.setEnabled(enabled); if (!enabled) { server.revoke(); await api.bridge?.close(); api.bridge = null; } activity({direction: 'local', method: enabled ? 'Sharing enabled' : 'Sharing disabled'}); },
    async connect(config, {token = '', oauth, handlers = {'elicitation/create': elicit}, signal} = {}) {
      if (clients.size >= 20) throw new McpError(-32000, 'Disconnect a server before adding another.');
      const transport = config.local ? new LocalTransport(server) : new (config.type === 'sse' ? LegacySseTransport : HttpTransport)(config.url, {token: oauth ? () => oauth.accessToken() : token});
      const client = new McpClient(transport, {timeout: 60000, handlers, onActivity: activity, onNotification: message => activity({direction: 'event', method: message.method}), approveTool: config.local ? undefined : approve});
      try { await client.connect({signal}); checkAbort(signal); } catch (error) { await client.close().catch(() => {}); throw error; }
      const id = 'mcp-' + (++sequence), record = {id, name: config.name || (config.local ? 'This IDE' : new URL(config.url).host), config: {name: config.name, url: config.url, type: config.type}, client, oauth};
      clients.set(id, record); activity({direction: 'local', method: 'Connected: ' + record.name}); return record;
    },
    async disconnect(id) { const record = clients.get(id); if (!record) return; clients.delete(id); await record.client.close(); record.client.transport.token = ''; record.oauth?.clear(); activity({direction: 'local', method: 'Disconnected: ' + record.name}); },
    async attachBridge(options) { if (!adapter.enabled) throw new McpError(-32001, 'Enable sharing before attaching the companion.'); if (api.bridge) await api.bridge.close(); const bridge = new BrowserBridge(server, {...options, onStatus: message => activity({direction: 'bridge', method: message})}); await bridge.connect(); api.bridge = bridge; return bridge; },
    bindPort(port) { return bindMcpPort(port, server, {sessionKey: 'private-port-' + (++sequence)}); }
  };
  ide.mcp = api; studioAPI.MCP = {MCP_VERSION, McpClient, McpServer, HttpTransport, LegacySseTransport, LocalTransport, PortTransport, BrowserBridge, McpOAuth, bindMcpPort, createIdeAdapter, parseMcpConfig, exportMcpConfig};
  const resetDocuments = ide.documents.reset;
  ide.documents.reset = function(...args) {
    const tool = this.tools.get('tool:mcp'); if (tool) this.tools.delete('tool:mcp');
    try { return resetDocuments.apply(this, args); } finally { if (tool) this.openTool(tool); }
  };
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  ide.openMcp = () => { let tool = ide.documents.tools.get('tool:mcp'); if (!tool) tool = new McpPanel(api); ide.documents.openTool(tool); return tool; };
  ide.menu = name => { const items = menu(name); if (name === 'Tools') items.unshift({label: 'MCP Connections…', id: 'mcpConnections', icon: 'properties'}, null); return items; };
  ide.command = (id, ...args) => id === 'mcpConnections' ? ide.openMcp() : command(id, ...args);
  return api;
}

class McpPanel {
  constructor(api) {
    this.api = api; this.key = 'tool:mcp'; this.title = 'MCP Connections'; this.width = 960; this.height = 680; this.glyph = 'MCP';
    this.root = el('div', {class: 'mcp-panel'}); this.status = el('div', {class: 'mcp-status', role: 'status'}, 'No connections. Nothing is shared until you enable it.');
    this.result = el('pre', {class: 'mcp-result', tabindex: 0, 'aria-label': 'MCP result'}, 'Results appear here as untrusted text.'); this.args = codeBox('MCP arguments', '{}');
    this.connections = el('select', {'aria-label': 'Active MCP connection', onchange: () => { this.catalog = []; this.renderCatalog(); }});
    this.catalogList = el('select', {size: 9, 'aria-label': 'MCP catalog', onchange: () => this.selectItem()}); this.description = el('pre', {class: 'mcp-description'});
    const connectPage = this.connectionPage(), browsePage = this.browsePage(), sharingPage = this.sharingPage(), oauthPage = this.oauthPage();
    this.activity = el('pre', {class: 'mcp-activity', tabindex: 0, 'aria-label': 'MCP activity'});
    this.root.append(el('div', {class: 'mcp-heading'}, el('strong', {}, 'Model Context Protocol'), el('span', {}, '2026-07-28 + legacy compatibility')),
      tabbedPages([{id: 'connect', label: 'Connect', node: connectPage}, {id: 'browse', label: 'Browse & invoke', node: browsePage}, {id: 'share', label: 'Expose IDE', node: sharingPage}, {id: 'oauth', label: 'OAuth', node: oauthPage}, {id: 'activity', label: 'Activity', node: this.activity}], {label: 'MCP settings'}), this.status);
    this.disposeChange = api.onChange(() => this.refresh()); this.refresh();
  }
  dispose() { this.operation?.abort(); this.subscription?.abort(); this.token.value = ''; this.bridgeToken.value = ''; this.disposeChange?.(); }
  refresh() {
    const selected = this.connections.value; this.connections.replaceChildren(...[...this.api.clients].map(([id, record]) => el('option', {value: id}, record.name + ' · ' + record.client.version)));
    if (this.api.clients.has(selected)) this.connections.value = selected;
    this.sharing.checked = this.api.adapter.enabled;
    this.activity.textContent = this.api.log.map(entry => entry.time.slice(11, 19) + ' ' + entry.direction + ' ' + entry.method + (entry.error ? ' — ' + entry.error : '')).join('\n');
  }
  async perform(action) {
    if (this.operation) { this.status.textContent = 'Cancel the current operation before starting another.'; return; }
    const controller = new AbortController(); this.operation = controller; this.status.textContent = 'Working…';
    try { const result = await action(controller.signal); if (result !== undefined) this.result.textContent = safeText(result); this.status.textContent = 'Ready'; return result; }
    catch (error) { this.status.textContent = error.message; this.result.textContent = 'Error: ' + error.message; if ([401,403].includes(error.status) && error.challenge) { this.oauthChallenge.value = error.challenge; this.oauthEndpoint.value = this.api.clients.get(this.connections.value)?.client.transport.url || this.url.value; this.status.textContent += ' Open the OAuth tab to sign in.'; } }
    finally { if (this.operation === controller) this.operation = null; this.refresh(); }
  }
  connectionPage() {
    this.name = input('Connection name', {placeholder: 'My MCP server'}); this.url = input('MCP endpoint', {type: 'url', placeholder: 'https://server.example/mcp'}); this.token = input('Bearer token', {type: 'password', autocomplete: 'off'});
    this.type = el('select', {'aria-label': 'MCP transport'}, el('option', {value: 'auto'}, 'Auto (modern / legacy HTTP)'), el('option', {value: 'sse'}, 'Legacy SSE (2024)'));
    this.saved = el('select', {'aria-label': 'Imported connection', onchange: () => { const config = this.api.configs[Number(this.saved.value)]; if (config) { this.name.value = config.name; this.url.value = config.url; this.type.value = config.type; this.token.value = ''; } }});
    const importFile = input('Import MCP configuration', {type: 'file', accept: '.json,application/json', onchange: () => this.perform(async () => {
      const file = importFile.files[0]; if (!file) return; if (file.size > 1024 * 1024) throw new Error('Configuration is too large.'); const result = parseMcpConfig(await file.text());
      this.api.configs.splice(0, this.api.configs.length, ...result.configs); this.saved.replaceChildren(el('option', {value: ''}, 'Choose a configuration…'), ...result.configs.map((config, index) => el('option', {value: index}, config.name))); importFile.value = ''; return {imported: result.configs.length, warnings: result.warnings};
    })});
    return el('div', {class: 'mcp-page'}, el('p', {}, 'Connect to a remote MCP server, or a configured stdio server at the companion’s /stdio/name endpoint. Direct remote servers must allow this browser origin through CORS. Tokens stay in memory.'),
      group('Server connection', field('Name', this.name), field('Endpoint', this.url), field('Transport', this.type), field('Bearer token (session only)', this.token),
        el('div', {class: 'mcp-actions'}, button('Connect', () => this.perform(async signal => { const config = {name: this.name.value || new URL(this.url.value).host, url: this.url.value, type: this.type.value}; const record = await this.api.connect(config, {token: this.token.value, signal}); this.token.value = ''; this.api.configs.push(record.config); this.refresh(); this.connections.value = record.id; return {connected: record.name, protocol: record.client.version, capabilities: record.client.serverCapabilities}; })),
          button('Connect to this IDE', () => this.perform(async signal => { if (!this.api.adapter.enabled) throw new Error('Enable sharing in Expose IDE before using the local inspector.'); const record = await this.api.connect({local: true, name: 'This IDE'}, {signal}); this.refresh(); this.connections.value = record.id; return {connected: record.name, protocol: record.client.version}; })))),
      group('Configuration', field('Import JSON', importFile), field('Imported connections', this.saved), button('Export configuration (no tokens)', () => download('mcp-config.json', JSON.stringify(exportMcpConfig(this.api.configs), null, 2), 'application/json'))));
  }
  current() { const record = this.api.clients.get(this.connections.value); if (!record) throw new McpError(-32000, 'Select an active MCP connection.'); return record.client; }
  browsePage() {
    this.uri = input('Resource URI', {placeholder: 'vb6://project'});
    return el('div', {class: 'mcp-page mcp-browser'}, field('Active connection', this.connections),
      el('div', {class: 'mcp-actions'}, ...[['Tools','tools'],['Resources','resources'],['Templates','templates'],['Prompts','prompts']].map(([label, kind]) => button(label, () => this.loadCatalog(kind))),
        button('Disconnect', () => this.perform(() => this.api.disconnect(this.connections.value)))),
      el('div', {class: 'mcp-catalog'}, this.catalogList, this.description), field('Arguments (JSON object)', this.args),
      el('div', {class: 'mcp-actions'}, button('Invoke selected', () => this.invoke()), button('Cancel operation', () => this.operation?.abort()), button('Save result', () => download('mcp-result.json', this.result.textContent, 'application/json'))),
      el('div', {class: 'mcp-actions'}, field('Resource URI', this.uri), button('Read URI', () => this.perform(signal => this.current().readResource(this.uri.value, {signal}))), button('Subscribe', () => this.subscribe()), button('Stop subscription', () => this.unsubscribe())), this.result);
  }
  loadCatalog(kind) { return this.perform(async signal => { const client = this.current(); this.kind = kind; this.catalog = await ({tools: () => client.listTools({signal}), resources: () => client.listResources({signal}), templates: () => client.listResourceTemplates({signal}), prompts: () => client.listPrompts({signal})}[kind])(); this.renderCatalog(); return {catalog: kind, count: this.catalog.length}; }); }
  renderCatalog() { this.catalogList.replaceChildren(...(this.catalog || []).map((item, index) => el('option', {value: index}, item.name || item.uri || item.uriTemplate))); this.selectItem(); }
  selectItem() {
    const item = this.catalog?.[Number(this.catalogList.value)]; this.description.textContent = item ? safeText(item) : 'Choose a catalog to browse.';
    if (!item) return; if (item.uri) this.uri.value = item.uri;
    const args = {}; for (const [key, schema] of Object.entries(item.inputSchema?.properties || {})) if (item.inputSchema.required?.includes(key)) args[key] = key === 'expectedRevision' && this.api.clients.get(this.connections.value)?.config.url === undefined ? this.api.adapter.revision : schema.type === 'integer' || schema.type === 'number' ? 0 : schema.type === 'object' ? {} : schema.type === 'array' ? [] : schema.type === 'boolean' ? false : '';
    for (const arg of item.arguments || []) if (arg.required) args[arg.name] = ''; this.args.value = JSON.stringify(args, null, 2);
  }
  invoke() { return this.perform(signal => { const client = this.current(), item = this.catalog?.[Number(this.catalogList.value)]; if (!item) throw new Error('Choose a catalog entry.'); const args = JSON.parse(this.args.value); if (!isRecord(args)) throw new Error('Arguments must be a JSON object.');
    if (this.kind === 'tools') return client.callTool(item.name, args, {signal}); if (this.kind === 'prompts') return client.getPrompt(item.name, args, {signal});
    if (this.kind === 'templates') { let uri = item.uriTemplate.replace(/\{([A-Za-z0-9_]+)\}/g, (_, key) => { if (typeof args[key] !== 'string') throw new Error('Enter the template argument: ' + key); return encodeURIComponent(args[key]); }); if (uri.includes('{')) throw new Error('For complex URI templates, enter the expanded URI in Resource URI.'); return client.readResource(uri, {signal}); }
    return client.readResource(item.uri, {signal}); }); }
  subscribe() {
    return this.perform(async signal => { await this.unsubscribe(); const client = this.current(), uri = this.uri.value; this.subscriptionClient = client; this.subscriptionURI = uri; this.subscription = new AbortController();
      if (client.version === MCP_VERSION) { client.subscribe({resourcesListChanged: true, ...(uri ? {resourceSubscriptions: [uri]} : {})}, {signal: this.subscription.signal, onNotification: message => { this.result.textContent = safeText(message); }}).catch(error => { if (!this.subscription?.signal.aborted) this.status.textContent = error.message; }); }
      else await client.subscribeResource(uri, {signal}); return {subscribed: uri || 'resource list'}; });
  }
  async unsubscribe() { this.subscription?.abort(); if (this.subscriptionClient?.version !== MCP_VERSION && this.subscriptionURI) await this.subscriptionClient?.unsubscribeResource(this.subscriptionURI).catch(() => {}); this.subscription = null; this.subscriptionURI = null; }
  sharingPage() {
    this.sharing = input('Enable MCP sharing', {type: 'checkbox', onchange: () => this.perform(async () => {
      const enabled = this.sharing.checked; if (enabled) { const allow = await modal('Share this IDE through MCP?', {content: el('p', {}, 'MCP readers can read the entire current project, source, resources, virtual files and debugger data. Edits and execution still require approval for every request. Only attach clients you trust. Sharing stops on reload.'), buttons: [{label: 'Cancel', value: false, primary: true}, {label: 'Enable sharing', value: true}]}); if (!allow) { this.sharing.checked = false; return; } }
      await this.api.setSharing(enabled); return {sharing: enabled, revision: this.api.adapter.revision};
    })});
    this.bridgeURL = input('Companion URL', {value: 'http://127.0.0.1:8766'}); this.bridgeToken = input('Companion owner token', {type: 'password', autocomplete: 'off'});
    return el('div', {class: 'mcp-page'}, field('Enable MCP sharing for this session', this.sharing),
      el('p', {}, 'Disabled by default. External writes need the current expectedRevision and explicit local approval. Disconnect or disable sharing to revoke pending requests. No arbitrary JavaScript, shell execution or host filesystem access is exposed.'),
      group('Desktop clients and local stdio', el('pre', {}, 'node tools/mcp-bridge.mjs --serve dist --allow-file\n# For GitHub Pages, additionally: --origin https://wieslawsoltes.github.io'),
        el('p', {}, 'Enter the companion’s owner token here. Give desktop MCP clients its separate client token. A static HTML page cannot open a listening HTTP socket or spawn a process; the optional companion supplies that boundary.'),
        field('Companion origin', this.bridgeURL), field('Owner token (session only)', this.bridgeToken),
        el('div', {class: 'mcp-actions'}, button('Attach companion', () => this.perform(async () => { await this.api.attachBridge({url: this.bridgeURL.value, token: this.bridgeToken.value}); this.bridgeToken.value = ''; return {companion: 'attached', endpoint: this.bridgeURL.value + '/mcp'}; })), button('Detach companion', () => this.perform(async () => { await this.api.bridge?.close(); this.api.bridge = null; return {companion: 'detached'}; })))),
      el('p', {}, 'Local HTML uses Origin: null and needs --allow-file. Hosted apps need the exact host origin allowed. Browser local-network permission may also be required. Direct remote connections do not require the companion.'));
  }
  oauthPage() {
    const endpoint = input('OAuth MCP endpoint', {placeholder: 'https://server.example/mcp'}), challenge = input('WWW-Authenticate challenge'), clientId = input('OAuth client ID'), redirect = input('OAuth redirect URI', {placeholder: 'Registered HTTPS or localhost callback URL'}), scope = input('OAuth scopes'), callback = input('OAuth callback URL', {autocomplete: 'off'});
    this.oauthEndpoint = endpoint; this.oauthChallenge = challenge;
    const link = el('a', {target: '_blank', rel: 'noopener noreferrer', hidden: true}, 'Open sign-in in a new tab'); const metadata = el('pre', {class: 'mcp-description'});
    return el('div', {class: 'mcp-page'}, el('p', {}, 'OAuth public client with S256 PKCE. The original tab must remain open. Complete sign-in in a new tab, then paste its final callback URL here. This also supports file:// apps without inventing an invalid file:// redirect. The issuer must allow browser CORS and your registered redirect URI.'),
      field('MCP endpoint', endpoint), field('Optional WWW-Authenticate challenge', challenge),
      button('Discover authorization server', () => this.perform(async () => { this.oauth?.clear(); this.oauth = new McpOAuth(endpoint.value); const result = await this.oauth.discover({challenge: challenge.value}); scope.value = result.scope; metadata.textContent = safeText(result); return {issuer: result.metadata.issuer}; })), metadata,
      field('Public client ID or HTTPS client metadata URL', clientId), field('Registered callback URI', redirect), field('Scopes', scope),
      el('div', {class: 'mcp-actions'}, button('Export client metadata', () => this.perform(() => { if (!this.oauth) throw new Error('Discover authorization first.'); download('client-metadata.json', JSON.stringify(this.oauth.clientMetadata(clientId.value, redirect.value), null, 2), 'application/json'); })), button('Register public client (optional)', () => this.perform(async () => { if (!this.oauth) throw new Error('Discover authorization first.'); clientId.value = await this.oauth.register(redirect.value); return {registered: true, issuer: this.oauth.metadata.issuer}; })),
        button('Prepare sign-in', () => this.perform(async () => { if (!this.oauth) throw new Error('Discover authorization first.'); link.href = await this.oauth.begin({clientId: clientId.value, redirectURI: redirect.value, scope: scope.value}); link.hidden = false; return {signInReady: true, issuer: this.oauth.metadata.issuer}; })), link),
      field('Paste final callback URL', callback), button('Complete sign-in and connect', () => this.perform(async () => { if (!this.oauth) throw new Error('Prepare sign-in first.'); await this.oauth.complete(callback.value); callback.value = ''; link.hidden = true; link.removeAttribute('href'); const record = await this.api.connect({name: new URL(this.oauth.endpoint).host + ' (OAuth)', url: this.oauth.endpoint, type: 'auto'}, {oauth: this.oauth}); this.refresh(); this.connections.value = record.id; return {connected: record.name, protocol: record.client.version}; })),
      button('Clear OAuth credentials', () => { this.oauth?.clear(); callback.value = ''; link.hidden = true; link.removeAttribute('href'); this.status.textContent = 'OAuth credentials cleared from memory.'; }));
  }
}
