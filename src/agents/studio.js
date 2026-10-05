import {el, download} from '../core/core.js';
import {modal, tabbedPages, icon} from '../ide/ui.js';
import {operationReview} from './review.js';
import {createIdeAdapter} from '../mcp/ide-adapter.js';
import {AGENT_SCOPES} from '../mcp/agent-permissions.js';
import {CodingAgent} from './agent.js';
import {PROVIDERS, createTransport, listModels, modelId} from './providers.js';

const button = (text, action, glyph) => el('button', {type: 'button', onclick: action}, ...(glyph ? [icon(glyph), ' '] : []), text);
const input = (label, attrs = {}) => el('input', {'aria-label': label, ...attrs});
const field = (label, control) => el('label', {class: 'agent-field'}, el('span', {}, label), control);
const group = (title, ...children) => el('fieldset', {}, el('legend', {}, title), ...children);
const choices = (label, values) => el('select', {'aria-label': label}, ...values.map(([value, text]) => el('option', {value}, text)));
function cancellableDialog(title, content, signal, label = 'Allow once') {
  let abort;
  return modal(title, {width: 760, content, buttons: [{label: 'Cancel', value: false, primary: true}, {label, value: true}],
    onReady: ({finish}) => { abort = () => finish(false); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort(); }
  }).finally(() => signal?.removeEventListener('abort', abort));
}
export function installCodingAgents(ide, studioAPI, {transportFactory = createTransport} = {}) {
  if (ide.codingAgents) return ide.codingAgents;
  const listeners = new Set();
  const approve = (request, {signal} = {}) => {
    const args = JSON.stringify(request.arguments, null, 2), review = operationReview(ide.project, request);
    const truncated = args.length > 30000 || review.changes.length > 8 || review.changes.some(change => change.before.length > 20000 || change.after.length > 20000);
    return cancellableDialog('AI Coding Agent — Review Operation', el('div', {class: 'agent-review'},
      el('p', {}, request.peer + ' requests ' + request.name + ' in ' + request.projectName + '.'),
      el('p', {}, 'Approval applies only to this operation. Revision ' + request.arguments.expectedRevision + ' will be checked again before applying. Runtime/debugger actions can execute project code and access its configured data sources.'),
      ...review.changes.slice(0, 8).map(change => group(change.module, el('div', {class: 'agent-diff'},
        el('div', {}, el('strong', {}, 'Before'), el('pre', {class: 'agent-log', tabindex: 0}, change.before.slice(0, 20000))),
        el('div', {}, el('strong', {}, 'After'), el('pre', {class: 'agent-log', tabindex: 0}, change.after.slice(0, 20000)))))),
      el('strong', {}, 'Proposed operation'), el('pre', {class: 'agent-log', tabindex: 0}, args.slice(0, 30000)),
      ...(truncated ? [el('p', {}, 'Preview is truncated. Download and review the complete request before allowing it.')] : []),
      button('Save full review…', () => download('agent-operation-review.json', JSON.stringify(review, null, 2), 'application/json'))), signal);
  };
  const adapter = createIdeAdapter(ide, {approve, historyLabel: 'AI Agent'});
  const agent = new CodingAgent(adapter, {onEvent: event => { for (const listener of listeners) listener(event); }});
  const api = {agent, adapter, onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }};
  ide.codingAgents = api;
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  api.open = prompt => {
    let panel = ide.documents.tools.get('tool:coding-agents');
    if (!panel) panel = new AgentPanel(ide, api, transportFactory);
    ide.documents.openTool(panel);
    if (prompt && !agent.busy) { panel.prompt.value = prompt; panel.prompt.focus(); }
    return panel;
  };
  ide.menu = name => { const items = menu(name); if (name === 'Tools') items.unshift({label: 'AI Coding Agents…', id: 'codingAgents', icon: 'module'}, null); return items; };
  ide.command = (id, ...args) => id === 'codingAgents' ? api.open() : command(id, ...args);
  const reset = ide.documents.reset;
  ide.documents.reset = function(...args) {
    // Preserve the tool window across workspace loads, but cancel old-project authority.
    const panel = this.tools.get('tool:coding-agents');
    if (panel) { panel.cancel(); this.tools.delete(panel.key); }
    try { return reset.apply(this, args); } finally { if (panel) this.openTool(panel); }
  };
  globalThis.addEventListener('pagehide', () => { agent.stop(); adapter.setEnabled(false); });
  studioAPI.Agents = {CodingAgent, createTransport, listModels, installCodingAgents};
  // The IDE restores its document layout before optional integrations are installed.
  // Restore only window metadata here: credentials, tasks and grants never persist.
  const saved = ide.savedDocumentLayout;
  if (saved?.tools?.includes('tool:coding-agents')) {
    api.open(); ide.documents.mdi.restoreSnapshot(saved.windows);
    if (saved.activeWindow && ide.documents.mdi.windows.has(saved.activeWindow)) ide.documents.mdi.activate(saved.activeWindow);
  }
  return api;
}
class AgentPanel {
  constructor(ide, api, transportFactory) {
    this.ide = ide; this.api = api; this.transportFactory = transportFactory;
    this.key = 'tool:coding-agents'; this.title = 'AI Coding Agents'; this.glyph = 'module'; this.width = 840; this.height = 650;
    this.root = el('div', {class: 'agent-panel'}); this.pendingText = '';
    this.status = el('div', {class: 'agent-status', role: 'status'}, 'Idle — no project data has been sent.');
    this.runButton = button('Run', () => this.start(), 'run'); this.stopButton = button('Stop', () => this.cancel(), 'stop');
    this.newButton = button('New Task', () => this.newTask(), 'new');
    this.exportButton = button('Save Transcript…', () => download('coding-agent-transcript.json', JSON.stringify(api.agent.transcript, null, 2), 'application/json'), 'save');
    this.root.append(el('div', {class: 'agent-toolbar'}, this.runButton, this.stopButton, this.newButton, this.exportButton),
      tabbedPages([{id: 'task', label: 'Task', node: this.taskPage()}, {id: 'connection', label: 'Connection', node: this.connectionPage()},
        {id: 'permissions', label: 'Permissions', node: this.permissionsPage()}, {id: 'tools', label: 'Tools', node: this.toolsPage()},
        {id: 'activity', label: 'Activity', node: this.activityPage()}], {label: 'Coding agent pages'}), this.status);
    this.unlisten = api.onChange(event => this.event(event)); this.refresh();
  }
  taskPage() {
    this.prompt = el('textarea', {'aria-label': 'Agent task', rows: 4, spellcheck: 'false', placeholder: 'Describe a coding, form designer, compiler or debugging task.'});
    this.prompt.addEventListener('keydown', event => { if (event.ctrlKey && event.key === 'Enter') { event.preventDefault(); event.stopPropagation(); void this.start(); } });
    this.log = el('pre', {class: 'agent-log agent-conversation', tabindex: 0, 'aria-label': 'Agent conversation'});
    const examples = choices('Task example', [['', '(Choose a task example)'], ['explain', 'Explain current module'], ['fix', 'Fix compiler errors'], ['form', 'Create a form'], ['debug', 'Debug the application']]);
    examples.addEventListener('change', () => {
      if (this.api.agent.busy) return;
      const name = this.ide.activeModule?.name || 'Form1';
      const prompts = {explain: 'Read and explain ' + name + '. Do not modify the project.', fix: 'Compile this project, inspect the diagnostics, fix the source errors and compile again. Preserve its behavior.', form: 'Create a classic VB6 data-entry form with Name and Email fields, validation and Save / Cancel buttons. Inspect the project first and preserve its conventions.', debug: 'Inspect the project and debugger state. Help diagnose the application, using breakpoints, stepping and watches when approved. Explain what the evidence shows.'};
      this.prompt.value = prompts[examples.value] || this.prompt.value;
    });
    this.exampleSelect = examples;
    return el('div', {class: 'agent-page agent-task'}, field('Task example:', examples), this.log, field('Task:', this.prompt), el('div', {}, 'Ctrl+Enter runs the task. Run again to continue this conversation. New Task clears its in-memory context.'));
  }
  connectionPage() {
    this.provider = choices('AI provider', Object.entries(PROVIDERS).map(([id, info]) => [id, info.label]));
    this.connection = choices('Agent connection', [['relay', 'Local relay (API keys stay outside the browser)'], ['direct', 'Direct API (personal use; key in browser memory)']]);
    this.model = input('AI model ID', {value: this.api.agent.model, placeholder: 'Refresh models or enter an exact model ID'});
    if (this.api.agent.provider) this.provider.value = this.api.agent.provider;
    this.models = choices('Available AI models', [['', '(Refresh models to list account access)']]);
    this.models.onchange = () => { if (this.models.value) this.model.value = this.models.value; };
    this.keyInput = input('Provider API key', {type: 'password', autocomplete: 'off', spellcheck: 'false'});
    this.relay = input('Agent relay URL', {value: 'http://127.0.0.1:4892'});
    this.token = input('Agent relay token', {type: 'password', autocomplete: 'off', spellcheck: 'false'});
    this.browserConsent = input('Accept browser key exposure', {type: 'checkbox'});
    this.refreshModels = button('Refresh Models', () => this.discover());
    this.clearKey = button('Clear Credentials', () => { this.keyInput.value = ''; this.token.value = ''; this.status.textContent = 'Credentials cleared.'; });
    this.provider.onchange = () => { this.keyInput.value = ''; this.model.value = ''; this.models.replaceChildren(el('option', {value: ''}, '(Refresh models)')); };
    const direct = group('Direct API', field('API key:', this.keyInput), field('Personal use only:', this.browserConsent), el('p', {}, 'The key is exposed to this page and browser extensions. It is held only until this window closes or the page reloads; it is never saved in the project or browser storage. Enable the checkbox to accept this risk.'));
    const relay = group('Local relay', field('Relay URL:', this.relay), field('Access token:', this.token), el('p', {}, 'Start tools/agent-relay.mjs with provider API keys in environment variables. Only the local access token enters the browser. The relay must explicitly allow this IDE origin.'));
    const toggle = () => { direct.hidden = this.connection.value !== 'direct'; relay.hidden = this.connection.value !== 'relay'; }; this.connection.onchange = toggle; toggle();
    return el('div', {class: 'agent-page'}, field('Provider:', this.provider), field('Connection:', this.connection), relay, direct,
      group('Model', field('Available models:', this.models), field('Model ID:', this.model), el('div', {class: 'agent-actions'}, this.refreshModels, this.clearKey), el('p', {}, 'Model availability and tool support depend on your account. API usage is billed by the selected provider. No keys or requests are included in exported applications.')));
  }
  permissionsPage() {
    this.mode = choices('Agent permission mode', [['review', 'Review each change / execution'], ['readonly', 'Read only (no changes or execution)'], ['scoped', 'Agent: authorize selected scopes for this run (10 minutes)']]);
    this.scopeInputs = Object.entries(AGENT_SCOPES).map(([id, label]) => { const node = input('Coding agent scope ' + id, {type: 'checkbox'}); return {id, node, label}; });
    this.turns = input('Maximum agent requests', {type: 'number', value: '16', min: '1', max: '100'});
    this.outputTokens = input('Maximum output tokens', {type: 'number', value: '8192', min: '256', max: '32768'});
    this.budget = input('Reported token budget', {type: 'number', value: '200000', min: '1024', max: '2000000'});
    return el('div', {class: 'agent-page'}, field('Permission mode:', this.mode),
      group('Delegated scopes (only used in Agent mode)', ...this.scopeInputs.map(({node, label}) => el('label', {}, node, label))),
      group('Run limits', field('Maximum requests:', this.turns), field('Output tokens/request:', this.outputTokens), field('Reported token budget:', this.budget)),
      el('p', {}, 'Read access sends requested project/source/debugger data to the selected provider. Review your project for secrets first. Writes retain normal Undo and stale-revision protection. Execution can access data sources configured in project code. Stop cancels requests and pending approvals; it does not roll back already-applied edits or external side effects.'),
      el('p', {}, 'The token budget uses provider-reported usage, not billing estimates; a request can exceed it. Use provider account spend limits for a hard billing cap. Permissions end after the run, Stop, project reload, expiry, or page reload. MCP sharing and permissions are independent.'));
  }
  toolsPage() {
    const list = el('select', {size: 12, 'aria-label': 'Coding agent tools'}), details = el('pre', {class: 'agent-log', tabindex: 0, 'aria-label': 'Coding agent tool details'});
    for (const tool of this.api.adapter.tools) list.append(el('option', {value: tool.name}, tool.name));
    list.onchange = () => { const tool = this.api.adapter.tools.find(tool => tool.name === list.value); details.textContent = tool ? tool.description + '\n\n' + (tool.annotations.readOnlyHint ? 'Read-only' : 'Requires approval or delegated scope') + '\n\n' + JSON.stringify(tool.inputSchema, null, 2) : ''; };
    list.selectedIndex = 0; list.onchange();
    return el('div', {class: 'agent-page'}, el('p', {}, this.api.adapter.tools.length + ' real IDE tools. API keys, permissions and host shell access are not tools.'), el('div', {class: 'agent-tool-catalog'}, list, details));
  }
  activityPage() { this.activity = el('pre', {class: 'agent-log agent-activity', tabindex: 0, 'aria-label': 'Coding agent activity'}); return el('div', {class: 'agent-page'}, this.activity); }
  transport() {
    if (this.connection.value === 'direct' && !this.browserConsent.checked) throw new Error('Accept browser key exposure in Connection, or use the local relay.');
    return this.transportFactory({provider: this.provider.value, apiKey: this.keyInput.value, relay: this.connection.value === 'relay' ? this.relay.value : '', relayToken: this.token.value});
  }
  async discover() {
    if (this.pending || this.api.agent.busy) return;
    this.pending = new AbortController(); this.refresh(); this.status.textContent = 'Reading provider model catalog…';
    try {
      const models = await listModels(this.transport(), this.provider.value, this.pending.signal);
      this.models.replaceChildren(el('option', {value: ''}, '(Choose a model)'), ...models.map(id => el('option', {value: id}, id)));
      this.status.textContent = models.length + ' models returned. Choose one supporting function calls.';
    } catch (error) { this.status.textContent = error.message; }
    finally { this.pending = null; this.refresh(); }
  }
  async start() {
    if (this.pending || this.api.agent.busy) return;
    const setup = new AbortController(); this.pending = setup; this.refresh();
    try {
      const provider = this.provider.value, model = modelId(this.model.value), prompt = this.prompt.value;
      if (!prompt.trim()) throw new Error('Enter a task on the Task tab.');
      const transport = this.transport(), mode = this.mode.value, scopes = this.scopeInputs.filter(item => item.node.checked).map(item => item.id);
      if (mode === 'scoped' && !scopes.length) throw new Error('Select at least one delegated scope.');
      const project = this.ide.project, authority = this.api.adapter.authoritySignal;
      const signal = AbortSignal.any([setup.signal, authority]);
      const allowed = await cancellableDialog('AI Coding Agent — Start Task', el('div', {class: 'agent-review'},
        el('p', {}, 'Send this task and requested project context from ' + project.name + ' to ' + PROVIDERS[provider].label + ' (' + model + ')?'),
        el('p', {}, 'This may incur API charges. Review source for secrets before continuing. Read access includes project files and debugger data.'),
        el('p', {}, mode === 'scoped' ? 'Authorize for this run, up to 10 minutes: ' + scopes.join(', ') + '. Selected operations will not ask again. Other changes still require review.' : mode === 'readonly' ? 'Read-only mode: the agent cannot change or execute the project.' : 'Each change or execution requires your approval.')), signal, 'Start Task');
      if (!allowed) return; signal.throwIfAborted();
      if (project !== this.ide.project) throw new Error('Project changed; review the current project again.');
      this.pending = null; this.pendingText = '';
      const run = this.api.agent.run({provider, model, prompt, transport, mode, scopes, maxTurns: Number(this.turns.value), maxTokens: Number(this.outputTokens.value), tokenBudget: Number(this.budget.value)});
      this.refresh(); await run;
    } catch (error) { this.status.textContent = error.name === 'AbortError' ? 'Agent cancelled.' : error.message; }
    finally { if (this.pending === setup) this.pending = null; this.refresh(); }
  }
  cancel() { this.pending?.abort(); this.api.agent.stop(); }
  newTask() {
    if (this.pending || this.api.agent.busy) return;
    this.api.agent.reset(); this.pendingText = ''; this.prompt.value = ''; this.status.textContent = 'New task — no project data has been sent.'; this.render();
  }
  event(event) {
    if (event.type === 'delta') { this.pendingText += event.text; if (this.pendingText.length > 200000) this.pendingText = this.pendingText.slice(-200000); }
    else { if (event.type === 'assistant') this.pendingText = ''; if (event.type !== 'idle') this.status.textContent = event.text; }
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); this.refresh(); });
  }
  render() {
    const entries = this.api.agent.transcript;
    this.log.textContent = entries.filter(event => ['user', 'assistant'].includes(event.type)).map(event => (event.type === 'user' ? 'You' : 'Agent') + ':\n' + event.text).join('\n\n').slice(-200000) + (this.pendingText ? '\n\nAgent:\n' + this.pendingText : '');
    this.activity.textContent = entries.filter(event => !['user', 'assistant'].includes(event.type)).map(event => event.time.slice(11, 19) + ' ' + event.type + ': ' + event.text + (event.arguments ? '\n' + JSON.stringify(event.arguments, null, 2) : '') + (event.result ? '\n' + JSON.stringify(event.result, null, 2) : '')).join('\n').slice(-200000);
  }
  refresh() {
    const busy = !!this.pending || this.api.agent.busy;
    this.runButton.disabled = busy; this.stopButton.disabled = !busy; this.newButton.disabled = busy;
    for (const control of [this.provider, this.connection, this.model, this.models, this.keyInput, this.relay, this.token, this.browserConsent, this.refreshModels, this.clearKey, this.mode, this.turns, this.outputTokens, this.budget, this.prompt, this.exampleSelect, ...this.scopeInputs.map(item => item.node)]) control.disabled = busy;
    if (!busy) this.render();
  }
  dispose() { this.cancel(); this.keyInput.value = ''; this.token.value = ''; this.unlisten?.(); if (this.frame) cancelAnimationFrame(this.frame); }
}
