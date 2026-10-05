import {AGENT_SCOPES} from './agent-permissions.js';
import {el, download} from '../core/core.js';
import {modal, tabbedPages} from '../ide/ui.js';
import {MCP_VERSION, McpError, checkAbort} from './protocol.js';
import {McpServer, bindMcpPort} from './server.js';
import {createIdeAdapter} from './ide-adapter.js';
import {BrowserBridge} from './bridge-client.js';
import {companionURL} from './companion-url.js';

const field = (label, input) => el('label', {class: 'mcp-field'}, el('span', {}, label), input);
const button = (text, action) => el('button', {type: 'button', onclick: action}, text);
const input = (label, attrs = {}) => el('input', {'aria-label': label, ...attrs});
const group = (legend, ...children) => el('fieldset', {}, el('legend', {}, legend), ...children);

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
/** Server-only MCP integration. External agents call the IDE; the IDE never calls external MCP tools. */
export function installMcp(ide, studioAPI, {approve = approvalQueue()} = {}) {
  if (ide.mcp) return ide.mcp;
  const listeners = new Set(), log = []; let sequence = 0, generation = 0, pendingBridge = null;
  const activity = entry => {
    log.push({time: new Date().toISOString(), ...entry}); if (log.length > 300) log.splice(0, log.length - 300);
    for (const listener of listeners) { try { listener(); } catch {} }
  };
  const adapter = createIdeAdapter(ide, {approve, onActivity: activity}), server = new McpServer(adapter);
  const api = {adapter, server, log, bridge: null,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    async setSharing(enabled) {
      adapter.setEnabled(enabled);
      if (!enabled) { server.revoke(); await api.detachBridge(); }
      activity({direction: 'local', method: enabled ? 'Agent access enabled' : 'Agent access disabled'});
    },
    async attachBridge(options) {
      if (!adapter.enabled) throw new McpError(-32001, 'Enable agent access before attaching the companion.');
      await api.detachBridge();
      const current = ++generation;
      if (!adapter.enabled) throw new McpError(-32001, 'Agent access was disabled.');
      const bridge = new BrowserBridge(server, {...options, onStatus: message => activity({direction: 'relay', method: message})});
      pendingBridge = bridge;
      try {
        await bridge.connect();
        if (current !== generation || !adapter.enabled) throw new McpError(-32800, 'Companion attachment was cancelled.');
        api.bridge = bridge; pendingBridge = null; activity({direction: 'local', method: 'Companion attached'}); return bridge;
      } catch (error) {
        if (pendingBridge === bridge) pendingBridge = null;
        await bridge.close(); throw error;
      }
    },
    async detachBridge() {
      generation++;
      const bridges = new Set([api.bridge, pendingBridge]); api.bridge = null; pendingBridge = null;
      // Detaching removes delegated authority as well as the paired external connection.
      adapter.permissions.revoke();
      for (const bridge of bridges) await bridge?.close();
      activity({direction: 'local', method: 'Companion detached'});
    },
    bindPort(port) { return bindMcpPort(port, server, {sessionKey: 'private-agent-port-' + (++sequence)}); }
  };
  const indicator = el('button', {type: 'button', class: 'mcp-agent-indicator', 'aria-label': 'MCP agent session', hidden: true, onclick: () => ide.openMcp?.()}, 'MCP agent access');
  ide.root.append(indicator);
  adapter.onChange(() => {
    const grant = adapter.permissions.snapshot(ide.project.id);
    indicator.hidden = !adapter.enabled;
    indicator.textContent = grant.active ? 'MCP agent: ' + grant.scopes.join(', ') : 'MCP: read access / approve writes';
  });
  ide.mcp = api;
  studioAPI.MCP = {MCP_VERSION, McpServer, BrowserBridge, bindMcpPort, createIdeAdapter};
  const resetDocuments = ide.documents.reset;
  ide.documents.reset = function(...args) {
    const tool = this.tools.get('tool:mcp'); if (tool) this.tools.delete('tool:mcp');
    try { return resetDocuments.apply(this, args); } finally { if (tool) this.openTool(tool); }
  };
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  ide.openMcp = () => { let tool = ide.documents.tools.get('tool:mcp'); if (!tool) tool = new McpPanel(api); ide.documents.openTool(tool); return tool; };
  ide.menu = name => { const items = menu(name); if (name === 'Tools') items.unshift({label: 'MCP Agent Access…', id: 'mcpAgentAccess', icon: 'properties'}, null); return items; };
  ide.command = (id, ...args) => id === 'mcpAgentAccess' ? ide.openMcp() : command(id, ...args);
  return api;
}

class McpPanel {
  constructor(api) {
    this.api = api; this.key = 'tool:mcp'; this.title = 'MCP Agent Access'; this.width = 900; this.height = 680; this.glyph = 'MCP';
    this.root = el('div', {class: 'mcp-panel'});
    this.status = el('div', {class: 'mcp-status', role: 'status'}, 'Agent access is disabled.');
    this.activity = el('pre', {class: 'mcp-activity', tabindex: 0, 'aria-label': 'MCP activity'});
    const access = this.sharingPage(), agent = this.agentPage(), catalog = this.catalogPage();
    this.root.append(el('div', {class: 'mcp-heading'}, el('strong', {}, 'External coding-agent access'), el('span', {}, 'MCP server · ' + MCP_VERSION + ' + legacy')),
      tabbedPages([{id: 'access', label: 'Agent access', node: access}, {id: 'agent', label: 'Agent permissions', node: agent}, {id: 'capabilities', label: 'Capabilities', node: catalog}, {id: 'activity', label: 'Activity', node: this.activity}], {label: 'MCP settings'}), this.status);
    this.disposeChange = api.onChange(() => this.refresh()); this.refresh();
  }
  dispose() { this.operation?.abort(); this.bridgeToken.value = ''; this.disposeChange?.(); this.disposeAgentChange?.(); }
  refresh() {
    this.sharing.checked = this.api.adapter.enabled;
    this.connectionStatus.textContent = this.api.bridge?.connected ? 'An external-agent relay is attached.' : 'No companion attached.';
    this.activity.textContent = this.api.log.map(entry => entry.time.slice(11, 19) + ' ' + entry.direction + ' ' + entry.method + (entry.error ? ' — ' + entry.error : '')).join('\n');
  }
  async perform(action) {
    if (this.operation) { this.status.textContent = 'Another local setup operation is in progress.'; return; }
    const controller = new AbortController(); this.operation = controller; this.status.textContent = 'Working…';
    try { const result = await action(controller.signal); this.status.textContent = 'Ready'; return result; }
    catch (error) { this.status.textContent = error.message; }
    finally { if (this.operation === controller) this.operation = null; this.refresh(); }
  }
  sharingPage() {
    this.sharing = input('Enable MCP sharing', {type: 'checkbox', onchange: () => {
      const enabled = this.sharing.checked;
      // Disable is never blocked by an in-flight setup/approval operation.
      if (!enabled) { this.operation?.abort(); this.api.setSharing(false).catch(error => { this.status.textContent = error.message; }); return; }
      this.perform(async signal => {
        let abort; const epoch = this.api.adapter.authorityEpoch;
        try {
          const allow = await modal('Share this IDE through MCP?', {content: el('p', {}, 'External agents can read this project, source, resources, virtual files and debugger data. Writes and execution require approval unless you grant limited-duration agent permissions. Access stops on reload. Only pair agents you trust.'),
            buttons: [{label: 'Cancel', value: false, primary: true}, {label: 'Enable sharing', value: true}],
            onReady: ({finish}) => { abort = () => finish(false); signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) abort(); }});
          checkAbort(signal); if (allow) {
            if (epoch !== this.api.adapter.authorityEpoch) throw new Error('Project or sharing changed. Review the current project before sharing.');
            await this.api.setSharing(true);
          }
        } finally { if (abort) signal.removeEventListener('abort', abort); }
      });
    }});
    this.bridgeURL = input('Companion URL', {value: 'http://127.0.0.1:8766'});
    this.bridgeToken = input('Companion owner token', {type: 'password', autocomplete: 'off'});
    this.connectionStatus = el('p', {role: 'status'}, 'No companion attached.');
    return el('div', {class: 'mcp-page'}, field('Enable access for external coding agents', this.sharing),
      el('p', {}, 'This IDE is an MCP server, not an MCP client. Agents control the real project, editor, designer, compiler, debugger, runtime and workspace. The Capabilities tab is a read-only reference, not a tool runner.'),
      group('Pair the local relay', el('pre', {class: 'mcp-description'}, 'node tools/mcp-bridge.mjs --serve dist --allow-file\n# For GitHub Pages, add: --origin https://wieslawsoltes.github.io'),
        el('p', {}, 'A static HTML page cannot listen on a TCP port. Start the companion yourself, then enter its loopback origin and owner token. The companion only relays external agent requests to this IDE. It cannot launch other MCP servers.'),
        field('Companion origin (loopback only)', this.bridgeURL), field('Owner token (memory only)', this.bridgeToken), this.connectionStatus,
        el('div', {class: 'mcp-actions'}, button('Attach companion', () => this.perform(async signal => {
          const url = companionURL(this.bridgeURL.value).origin;
          const abort = () => { this.api.detachBridge().catch(() => {}); }; signal.addEventListener('abort', abort, {once: true});
          try { checkAbort(signal); await this.api.attachBridge({url, token: this.bridgeToken.value}); }
          finally { signal.removeEventListener('abort', abort); this.bridgeToken.value = ''; }
        })), button('Detach companion', () => { this.operation?.abort(); this.api.detachBridge().catch(error => { this.status.textContent = error.message; }); }))),
      group('Configure the external agent',
        el('p', {}, 'For an HTTP-capable agent, use the companion origin plus /mcp and its separate CLIENT token. Never give an agent the owner token.'),
        el('pre', {class: 'mcp-description'}, JSON.stringify({mcpServers: {'vb6-studio': {command: 'node', args: ['/absolute/path/to/VB6/tools/mcp-stdio.mjs', '--url', 'http://127.0.0.1:8766/mcp'], env: {VB6_MCP_TOKEN: 'PASTE_CLIENT_TOKEN_FROM_TERMINAL'}}}}, null, 2)),
        button('Download agent configuration template', () => this.perform(() => {
          const url = companionURL(this.bridgeURL.value).origin + '/mcp';
          download('vb6-agent-mcp.json', JSON.stringify({mcpServers: {'vb6-studio': {command: 'node', args: ['/absolute/path/to/VB6/tools/mcp-stdio.mjs', '--url', url], env: {VB6_MCP_TOKEN: 'PASTE_CLIENT_TOKEN_FROM_TERMINAL'}}}}, null, 2), 'application/json');
        }))),
      el('p', {}, 'Single-file HTML needs --allow-file; hosted pages need their exact origin allowed. Browser local-network policies still apply. Serve the same app on localhost when a browser blocks hosted-to-loopback access.'));
  }
  catalogPage() {
    const definitions = this.api.adapter.tools.map(({execute, ...definition}) => definition);
    const list = el('select', {size: 10, 'aria-label': 'Exposed agent tools'});
    const detail = el('pre', {class: 'mcp-description', tabindex: 0, 'aria-label': 'Agent tool schema'});
    const search = input('Filter exposed agent tools', {placeholder: 'Search tool names and descriptions'});
    const render = () => {
      const query = search.value.toLowerCase();
      const filtered = definitions.filter(t => (t.name + ' ' + t.description).toLowerCase().includes(query));
      list.replaceChildren(...filtered.map(t => el('option', {value: t.name}, t.name + (t.annotations.readOnlyHint ? ' · read' : ' · change'))));
      list.selectedIndex = filtered.length ? 0 : -1; show();
    };
    const show = () => { detail.textContent = JSON.stringify(definitions.find(t => t.name === list.value) || {}, null, 2); };
    search.addEventListener('input', render); list.addEventListener('change', show); render();
    return el('div', {class: 'mcp-page'}, el('p', {}, definitions.length + ' structured tools exposed to external agents. No shell, arbitrary JavaScript or IDE security-dialog control is provided.'), field('Filter', search), el('div', {class: 'mcp-catalog'}, list, detail),
      el('p', {}, 'Agents discover tools, resources and prompts over MCP. They should read vb6.agent.capabilities first and use expectedRevision for changes; paused debugger operations also use pauseId.'),
      button('Download exposed tool schemas', () => download('vb6-agent-tools.json', JSON.stringify(definitions, null, 2), 'application/json')));
  }
  agentPage() {
    const scopes = Object.entries(AGENT_SCOPES).map(([key,label]) => ({key, node:input('Agent scope '+key,{type:'checkbox'}),label}));
    const minutes=input('Agent permission duration',{type:'number',min:1,max:60,value:10});
    this.agentStatus=el('pre',{'aria-label':'Agent permission status',role:'status'});
    const refresh=()=>{const state=this.api.adapter.permissions.snapshot(this.api.adapter.snapshot().id);this.agentStatus.textContent=state.active?'ACTIVE until '+new Date(state.expiresAt).toLocaleTimeString()+' — '+state.scopes.join(', '):'No delegated permissions. Mutations require Allow once.';};
    // Subscribe through adapter change events, not by replacing its authority callback.
    this.disposeAgentChange=this.api.adapter.onChange(refresh);refresh();
    return el('div',{class:'mcp-page'},el('h3',{},'Coding-agent access for this project'),
      el('p',{},'Select capabilities you authorize all currently paired MCP clients to use without per-request approval. Revisions, argument validation and runtime checks remain enforced. Permissions expire and are cleared on project replacement, sharing disable or reload. Agents cannot change these permissions or click IDE security dialogs.'),
      ...scopes.map(s=>field(s.label,s.node)),field('Duration (minutes, 1–60)',minutes),this.agentStatus,
      el('div',{class:'mcp-actions'},button('Grant selected permissions',()=>this.perform(async signal=>{
        if(!this.api.adapter.enabled)throw new Error('Enable sharing first.');
        const selected=scopes.filter(s=>s.node.checked).map(s=>s.key),duration=Number(minutes.value);
        if(!selected.length||!Number.isInteger(duration)||duration<1||duration>60)throw new Error('Choose scopes and a duration from 1 to 60 minutes.');
        const projectId=this.api.adapter.snapshot().id, epoch=this.api.adapter.authorityEpoch;
        const lifetime=AbortSignal.any([signal,this.api.adapter.authoritySignal]); let abort;
        try {
          const accepted=await modal('Authorize coding agents?',{content:el('p',{},'Allow all paired clients to use '+selected.join(', ')+' for '+duration+' minutes in the current project? Execution scopes can run project code and retain its side effects. Only authorize clients you trust.'),buttons:[{label:'Cancel',value:false,primary:true},{label:'Authorize session',value:true}],
            onReady:({finish})=>{abort=()=>finish(false);lifetime.addEventListener('abort',abort,{once:true});if(lifetime.aborted)abort();}});
          checkAbort(lifetime);if(!accepted)return;
          if(epoch!==this.api.adapter.authorityEpoch||projectId!==this.api.adapter.snapshot().id||!this.api.adapter.enabled)throw new Error('Project or sharing changed.');
          this.api.adapter.permissions.allow(projectId,selected,duration);refresh();return {authorized:selected,minutes:duration};
        } finally {if(abort)lifetime.removeEventListener('abort',abort);}
      })),button('Revoke agent permissions',()=>{this.api.adapter.permissions.revoke();this.api.server.revoke();refresh();})));
  }
}
