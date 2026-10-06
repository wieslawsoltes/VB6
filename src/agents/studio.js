import {el, download} from '../core/core.js';
import {modal, tabbedPages, icon} from '../ide/ui.js';
import {operationReview} from './review.js';
import {createIdeAdapter} from '../mcp/ide-adapter.js';
import {AGENT_SCOPES} from '../mcp/agent-permissions.js';
import {CodingAgent} from './agent.js';
import {AgentConversations} from './conversations.js';
import {AgentThreadView} from './thread-view.js';
import {AGENT_PERMISSION_PROFILES, AgentPermissionSession, normalizeAgentPermissions, normalizePermissionConstraints, permissionSummary} from './permissions.js';
import {AGENT_LIMIT_FIELDS, AGENT_LIMIT_PRESETS, normalizeAgentLimits, loadAgentLimits, saveAgentLimits} from './limits.js';
import {PROVIDERS, createTransport, listModels, modelId} from './providers.js';

const button = (text, action, glyph) => el('button', {type: 'button', onclick: action}, ...(glyph ? [icon(glyph), ' '] : []), text);
const input = (label, attrs = {}) => el('input', {'aria-label': label, ...attrs});
const field = (label, control) => el('label', {class: 'agent-field'}, el('span', {}, label), control);
const group = (title, ...children) => el('fieldset', {}, el('legend', {}, title), ...children);
const choices = (label, values) => el('select', {'aria-label': label}, ...values.map(([value, text]) => el('option', {value}, text)));
function cancellableDialog(title, content, signal, label = 'Allow once', extraButtons = []) {
  let abort;
  return modal(title, {width: 760, content, buttons: [{label: 'Cancel', value: false, primary: true}, {label, value: true}, ...extraButtons],
    onReady: ({finish}) => { abort = () => finish(false); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort(); }
  }).finally(() => signal?.removeEventListener('abort', abort));
}
async function questionDialog(request, {signal} = {}) {
  const answer = el('textarea', {'aria-label': 'Answer to agent', rows: 4, maxLength: 8000, spellcheck: 'false'});
  const options = choices('Suggested answers', [['', '(Choose an answer or enter your own)'], ...(request.options || []).map(value => [value, value])]);
  let submit, abort;
  const update = () => { if (submit) submit.disabled = !answer.value.trim(); };
  options.onchange = () => { if (options.value) answer.value = options.value; update(); };
  answer.oninput = update;
  const accepted = await modal('AI Coding Agent — Question', {width: 650,
    content: el('div', {class: 'agent-review'}, el('p', {}, request.question),
      el('p', {}, 'Do not enter credentials. An answer is task information, not permission to edit or execute code.'),
      ...(request.options ? [field('Suggestions:', options)] : []), field('Your answer:', answer)),
    buttons: [{label: 'Cancel', value: false, primary: true}, {label: 'Send Answer', value: true, action: () => !!answer.value.trim()}],
    onReady: ({dialog, finish}) => {
      submit = dialog.querySelector('.ide-dialog-footer button:last-child'); update();
      abort = () => finish(false); signal?.addEventListener('abort', abort, {once: true}); if (signal?.aborted) abort();
    }
  }).finally(() => signal?.removeEventListener('abort', abort));
  return accepted ? answer.value : null;
}
export function installCodingAgents(ide, studioAPI, {transportFactory = createTransport, permissionConstraints = {}} = {}) {
  if (ide.codingAgents) return ide.codingAgents;
  const listeners = new Set();
  const approve = async (request, {signal} = {}) => {
    api.agent.emit('approval', 'Review ' + request.name + ' before execution.');
    const args = JSON.stringify(request.arguments, null, 2), review = operationReview(ide.project, request);
    const truncated = args.length > 30000 || review.changes.length > 8 || review.changes.some(change => change.before.length > 20000 || change.after.length > 20000);
    const allowed = await cancellableDialog('AI Coding Agent — Review Operation', el('div', {class: 'agent-review'},
      el('p', {}, request.peer + ' requests ' + request.name + ' in ' + request.projectName + '.'),
      el('p', {}, 'Allow once approves only this invocation. Allow tool for this run approves this exact tool with any schema-valid arguments until the current run ends or its original lease expires. It does not approve an entire scope. ' + (request.arguments.expectedRevision ? 'Revision ' + request.arguments.expectedRevision + ' will be checked again before applying. ' : '') + 'Runtime/debugger actions can execute project code and access its configured data sources.'),
      ...review.changes.slice(0, 8).map(change => group(change.module, el('div', {class: 'agent-diff'},
        el('div', {}, el('strong', {}, 'Before'), el('pre', {class: 'agent-log', tabindex: 0}, change.before.slice(0, 20000))),
        el('div', {}, el('strong', {}, 'After'), el('pre', {class: 'agent-log', tabindex: 0}, change.after.slice(0, 20000)))))),
      el('strong', {}, 'Proposed operation'), el('pre', {class: 'agent-log', tabindex: 0}, args.slice(0, 30000)),
      ...(truncated ? [el('p', {}, 'Preview is truncated. Download and review the complete request before allowing it.')] : []),
      button('Save full review…', () => download('agent-operation-review.json', JSON.stringify(review, null, 2), 'application/json'))), signal, 'Allow once', request.permission?.canAllowRun ? [{label: 'Allow tool for this run', value: 'run'}] : []);
    api.agent.emit('approval-result', allowed === 'run' ? 'Approved this exact tool for this run only.' : allowed ? 'Approved for this operation only.' : 'Operation denied or cancelled.', {allowed: !!allowed});
    return allowed;
  };
  const adapter = createIdeAdapter(ide, {approve, historyLabel: 'AI Agent'});
  const conversations = new AgentConversations(adapter, {askUser: questionDialog, permissionConstraints, defaultLimits: loadAgentLimits(),
    onEvent: event => { for (const listener of listeners) { try { listener(event); } catch {} } }});
  const api = {get agent() { return conversations.agent; }, conversations, adapter,
    onChange(listener) { listeners.add(listener); return () => listeners.delete(listener); }};
  ide.codingAgents = api;
  const menu = ide.menu.bind(ide), command = ide.command.bind(ide);
  api.open = prompt => {
    let panel = ide.documents.tools.get('tool:coding-agents');
    if (!panel) panel = new AgentPanel(ide, api, transportFactory);
    ide.documents.openTool(panel);
    if (prompt && !api.agent.busy) { panel.prompt.value = prompt; panel.prompt.focus(); }
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
  globalThis.addEventListener('pagehide', () => { api.agent.stop(); adapter.setEnabled(false); const panel = ide.documents.tools.get('tool:coding-agents'); if (panel) { panel.cancel(); panel.keyInput.value = ''; panel.token.value = ''; } });
  studioAPI.Agents = {CodingAgent, AgentConversations, AgentPermissionSession, normalizeAgentPermissions, normalizePermissionConstraints, createTransport, listModels, installCodingAgents};
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
    this.root = el('div', {class: 'agent-panel'});
    this.status = el('div', {class: 'agent-status', role: 'status'}, 'Idle — no project data has been sent.');
    this.runButton = button('Run', () => this.start(), 'run'); this.continueButton = button('Continue', () => this.start(true), 'run'); this.stopButton = button('Stop', () => this.cancel(), 'stop');
    this.compactButton = button('Compact context', () => this.start(false, true));
    this.newButton = button('New Task', () => this.newTask(), 'new');
    this.exportButton = button('Save Transcript…', () => download('coding-agent-transcript.json', JSON.stringify({version: 2, thread: api.agent.thread.snapshot(), activity: api.agent.transcript, usage: api.agent.usage, estimatedTokens: api.agent.estimatedTokens}, null, 2), 'application/json'), 'save');
    this.root.append(el('div', {class: 'agent-toolbar'}, this.runButton, this.continueButton, this.stopButton, this.compactButton, this.newButton, this.exportButton),
      (this.pages = tabbedPages([{id: 'task', label: 'Task', node: this.taskPage()}, {id: 'connection', label: 'Connection', node: this.connectionPage()},
        {id: 'permissions', label: 'Permissions', node: this.permissionsPage()}, {id: 'tools', label: 'Tools', node: this.toolsPage()},
        {id: 'plan', label: 'Plan', node: this.planPage()}, {id: 'tasks', label: 'Tasks', node: this.tasksPage()}, {id: 'activity', label: 'Activity', node: this.activityPage()}], {label: 'Coding agent pages'})), this.status);
    this.unlisten = api.onChange(event => this.event(event)); this.syncTask();
  }
  taskPage() {
    this.prompt = el('textarea', {'aria-label': 'Agent task', rows: 4, maxLength: 100000, spellcheck: 'false', placeholder: 'Describe a coding, form designer, compiler or debugging task.'});
    this.prompt.addEventListener('input', () => { this.api.conversations.active.draft = this.prompt.value; });
    this.prompt.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing && event.keyCode !== 229) {
        event.preventDefault(); event.stopPropagation(); void this.start();
      }
    });
    this.threadView = new AgentThreadView({announce: text => { this.status.textContent = text; }});
    this.log = this.threadView.scroller;
    this.sendButton = button('Send', () => this.start(), 'run');
    this.composerStop = button('Stop generation', () => this.cancel(), 'stop');
    this.quickMode = choices('Task permission profile', Object.entries(AGENT_PERMISSION_PROFILES));
    this.quickMode.onchange = () => { this.mode.value = this.quickMode.value; this.profileChanged(); };
    this.permissionBadge = el('div', {class: 'agent-permission-badge', 'aria-label': 'Effective agent permissions', role: 'status'});
    this.revokeButton = button('Revoke permissions & stop', () => { this.pending?.abort(); this.api.agent.revokePermissions(); this.refresh(); }, 'stop');
    const examples = choices('Task example', [['', '(Choose a task example)'], ['explain', 'Explain current module'], ['fix', 'Fix compiler errors'], ['form', 'Create a form'], ['debug', 'Debug the application']]);
    examples.addEventListener('change', () => {
      if (this.api.agent.busy) return;
      const name = this.ide.activeModule?.name || 'Form1';
      const prompts = {explain: 'Read and explain ' + name + '. Do not modify the project.', fix: 'Compile this project, inspect the diagnostics, fix the source errors and compile again. Preserve its behavior.', form: 'Create a classic VB6 data-entry form with Name and Email fields, validation and Save / Cancel buttons. Inspect the project first and preserve its conventions.', debug: 'Inspect the project and debugger state. Help diagnose the application, using breakpoints, stepping and watches when approved. Explain what the evidence shows.'};
      this.prompt.value = prompts[examples.value] || this.prompt.value; this.api.conversations.active.draft = this.prompt.value;
    });
    this.exampleSelect = examples;
    this.contextStatus = el('div', {class: 'agent-context', 'aria-label': 'Task context usage'});
    this.recoveryText = el('p');
    this.recoverySettings = button('Review limits…', () => { if (this.api.agent.failure?.kind === 'access') { this.pages.select('connection'); this.keyInput.focus(); return; } this.pages.select('permissions'); const control = ({output: this.outputTokens, context: this.contextLimit, calls: this.callLimit, requests: this.turns})[this.api.agent.limit?.kind] || this.budget; control.focus(); control.select(); });
    this.recoveryContinue = button('Resume task', () => this.start(true), 'run');
    this.recovery = el('div', {class: 'agent-limit-recovery', hidden: true, role: 'status'}, this.recoveryText,
      el('div', {class: 'agent-actions'}, this.recoverySettings, this.recoveryContinue));
    this.budgetMeter = el('progress', {class: 'agent-budget-meter', max: 1, value: 0, 'aria-label': 'Session token budget used'});
    return el('div', {class: 'agent-page agent-task'}, field('Task example:', examples), this.contextStatus, this.budgetMeter, this.recovery, this.threadView.root,
      el('div', {class: 'agent-composer'}, el('div', {class: 'agent-permission-bar'}, field('Permissions:', this.quickMode), this.revokeButton), this.permissionBadge, field('Message:', this.prompt), el('div', {class: 'agent-actions'}, this.sendButton, this.composerStop,
        el('span', {}, 'Enter sends • Shift+Enter adds a line'))),
      el('div', {class: 'agent-composer-help'}, 'Continue resumes an interrupted task without repeating completed operations. /compact creates a context checkpoint. Tasks are memory-only.'));
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
    this.mode = choices('Agent permission mode', Object.entries(AGENT_PERMISSION_PROFILES));
    this.mode.onchange = () => this.profileChanged();
    this.approvalPolicy = choices('Approval policy', [['on-request', 'Ask when needed'], ['never', 'Never ask — deny actions requiring approval']]);
    this.permissionMinutes = input('Permission lease minutes', {type: 'number', min: 1, max: this.api.agent.permissionConstraints.maxMinutes, step: 1, value: 10});
    this.approvalPolicy.onchange = this.permissionMinutes.onchange = () => this.updatePermissions();
    this.permissionError = el('p', {class: 'agent-permission-error', role: 'status'});
    this.permissionDescription = el('p');
    this.scopeRules = Object.entries(AGENT_SCOPES).map(([id, label]) => {
      const node = choices('Permission rule for ' + id, [['', 'Use profile'], ['allow', 'Allow'], ['ask', 'Ask'], ['deny', 'Deny']]);
      node.onchange = () => this.updatePermissions(); return {id, node, label};
    });
    this.ruleTool = choices('Permission rule tool', this.api.agent.tools.map(tool => [tool.name, tool.name]));
    this.ruleAction = choices('Permission rule action', [['allow', 'Allow'], ['ask', 'Ask'], ['deny', 'Deny']]);
    this.toolRules = {};
    this.ruleAdd = button('Set tool rule', () => { this.toolRules[this.ruleTool.value] = this.ruleAction.value; this.updatePermissions(); });
    this.ruleList = el('select', {size: 5, 'aria-label': 'Exact tool permission rules'});
    this.ruleRemove = button('Remove tool rule', () => { delete this.toolRules[this.ruleList.value]; this.updatePermissions(); });
    this.grants = el('select', {size: 4, 'aria-label': 'Active run tool approvals'});
    this.revokeTool = button('Revoke selected tool approval', () => { this.api.agent.permissionSession?.removeApproval(this.grants.value); this.render(); });
    this.resetPermissions = button('Reset to Ask for approval', () => { this.showPermissions(normalizeAgentPermissions({}, this.api.agent.tools)); this.updatePermissions(); });
    this.scopeInputs = Object.entries(AGENT_SCOPES).map(([id, label]) => { const node = input('Coding agent scope ' + id, {type: 'checkbox'}); node.onchange = () => this.updatePermissions(); return {id, node, label}; });
    const saved = this.api.conversations.active.limits;
    const make = (key, label) => { const rule = AGENT_LIMIT_FIELDS[key], node = input(label, {type: 'number', value: saved[key], min: rule.min, max: rule.max, step: 1}); node.addEventListener('change', () => this.updateLimits()); return node; };
    this.turns = make('maxTurns', 'Maximum agent requests'); this.callLimit = make('maxCalls', 'Maximum agent tool calls');
    this.outputTokens = make('maxTokens', 'Maximum output tokens'); this.budget = make('tokenBudget', 'Session token budget');
    this.contextLimit = make('maxContextBytes', 'Request context byte limit'); this.requestTimeout = make('requestTimeoutMs', 'Request timeout milliseconds');
    this.limitControls = {maxTurns: this.turns, maxCalls: this.callLimit, maxTokens: this.outputTokens, tokenBudget: this.budget, maxContextBytes: this.contextLimit, requestTimeoutMs: this.requestTimeout};
    this.recoveryLimits = ['maxRetries', 'autoCompactTokens', 'contextWindowTokens', 'compactKeepTurns', 'compactOutputTokens', 'toolResultBytes'].map(key => { const node = make(key, AGENT_LIMIT_FIELDS[key].label); this.limitControls[key] = node; return {key, node}; });
    this.limitPreset = choices('Agent limit preset', [['custom', 'Custom'], ...Object.entries(AGENT_LIMIT_PRESETS).map(([id, preset]) => [id, preset.label])]);
    this.limitPreset.onchange = () => { const preset = AGENT_LIMIT_PRESETS[this.limitPreset.value]; if (preset) { this.showLimits(preset.limits); this.updateLimits(); } };
    this.limitError = el('p', {class: 'agent-limit-error', role: 'status'});
    return el('div', {class: 'agent-page'}, field('Permission mode:', this.mode), this.permissionDescription,
      field('Approval policy:', this.approvalPolicy), field('Lease (minutes):', this.permissionMinutes),
      el('p', {}, 'Full IDE access allows all registered IDE operations without individual approval unless a deny/ask rule or host policy restricts them. It is not unrestricted computer access. Browser, runtime, native bridge and provider boundaries still apply.'),
      el('p', {}, 'Never ask does not mean approve everything: it rejects any operation that would need approval. Deny rules always win. Read only and Plan cannot be widened by allow rules. Preferences are memory-only and per task; every Run/Continue needs a fresh confirmation.'),
      group('Delegated scopes (Custom profile)', ...this.scopeInputs.map(({node, label}) => el('label', {}, node, label))),
      group('Scope overrides (project-changing operations)', ...this.scopeRules.map(({node, label}) => field(label, node))),
      group('Exact tool overrides (including reads)', field('Tool:', this.ruleTool), field('Action:', this.ruleAction), this.ruleAdd, this.ruleList, this.ruleRemove,
        el('p', {}, 'Rules use exact registered tool names, never command prefixes or wildcards. A scope deny cannot be widened by a tool allow. Auto edit asks before destructive operations and execution.')),
      group('Active run approvals', this.grants, this.revokeTool, el('p', {}, 'These approve an exact tool with any valid arguments, not just the current arguments. They expire with this run and cannot carry to another task. Revoking affects future invocations; Revoke permissions & stop also cancels pending work.')),
      this.resetPermissions, this.permissionError,
      group('Session budget and run limits', field('Preset:', this.limitPreset), field('Session token budget:', this.budget),
        field('Requests per run:', this.turns), field('Tool calls per run:', this.callLimit), field('Output tokens/request:', this.outputTokens),
        field('Request context bytes:', this.contextLimit), field('Timeout (milliseconds):', this.requestTimeout), this.limitError,
        el('p', {}, 'The default session allowance is 4,000,000 tokens. Continue and follow-ups retain prior usage; raise the allowance here to extend a session. Requests and tool calls are capped per Run/Continue.'),
        el('p', {}, 'Only these numeric preferences are saved for new tasks. Each open task keeps its own limits. Credentials, prompts, histories and permissions are never saved.')),
      group('Recovery and context compaction', ...this.recoveryLimits.map(({key, node}) => field(AGENT_LIMIT_FIELDS[key].label + ':', node)),
        el('p', {}, 'Transient generation failures retry with bounded backoff. Retry-After, Stop, lease expiry and all budgets remain enforced. Set retries to 0 for manual recovery. Completed edits are never replayed.'),
        el('p', {}, 'Auto-compaction defaults to an estimated 64,000 input tokens, independent of cumulative usage. Set the threshold to 0 to disable automatic compaction. Set model context window only from your provider’s model specification (0 means unspecified). Estimates are not a tokenizer or a model-capacity guarantee.'),
        el('p', {}, 'Compact context (or /compact) requests a tool-free checkpoint. The goal, latest request and recent whole turns are retained; older detail may be lost. Public thread and billed usage are not reset. No IDE tools execute during manual compaction. Every retry/checkpoint can incur charges.')),
      el('p', {}, 'Read access sends requested project/source/debugger data to the selected provider. Review your project for secrets first. Writes retain normal Undo and stale-revision protection. Execution can access data sources configured in project code. Stop cancels requests and pending approvals; it does not roll back already-applied edits or external side effects.'),
      el('p', {}, 'The session budget counts reported input and output tokens, including provider-reported reasoning/cache usage. Requests with missing usage receive a separately labelled byte-based safety estimate. A request can exceed the remaining budget. These are application caps, not the model’s context/output capacity or a hard billing limit. Use provider account spend controls; lower output/context settings when your model requires it. Permissions end after the run, Stop, project reload, expiry, or page reload. MCP sharing and permissions are independent.'));
  }
  readPermissions() {
    return normalizeAgentPermissions({mode: this.mode.value, approvalPolicy: this.approvalPolicy.value, permissionMinutes: Number(this.permissionMinutes.value),
      scopes: this.scopeInputs.filter(item => item.node.checked).map(item => item.id),
      scopeRules: Object.fromEntries(this.scopeRules.filter(item => item.node.value).map(item => [item.id, item.node.value])), toolRules: this.toolRules}, this.api.agent.tools);
  }
  showPermissions(config) {
    this.mode.value = config.mode; this.quickMode.value = config.mode; this.approvalPolicy.value = config.approvalPolicy; this.permissionMinutes.value = config.permissionMinutes;
    for (const item of this.scopeInputs) item.node.checked = config.scopes.includes(item.id);
    for (const item of this.scopeRules) item.node.value = config.scopeRules[item.id] || '';
    this.toolRules = {...config.toolRules}; this.renderPermissionRules(); this.permissionError.textContent = '';
  }
  renderPermissionRules() {
    const selected = this.ruleList.value;
    this.ruleList.replaceChildren(...Object.entries(this.toolRules).map(([name, action]) => el('option', {value: name}, action.toUpperCase() + ' — ' + name)));
    if (Object.hasOwn(this.toolRules, selected)) this.ruleList.value = selected;
  }
  profileChanged() {
    if (this.pending || this.api.agent.busy) return;
    this.approvalPolicy.value = ['readonly', 'plan', 'full'].includes(this.mode.value) ? 'never' : 'on-request';
    this.updatePermissions();
  }
  updatePermissions() {
    if (this.pending || this.api.agent.busy) return;
    try {
      const config = this.readPermissions(), host = this.api.agent.permissionConstraints;
      if (!host.allowedModes.includes(config.mode) || config.permissionMinutes > host.maxMinutes) throw new Error('These permissions exceed the host policy.');
      this.api.conversations.active.permissions = config; this.quickMode.value = config.mode;
      this.permissionDescription.textContent = permissionSummary(config); this.permissionError.textContent = '';
      this.renderPermissionRules(); this.render();
    } catch (error) { this.permissionError.textContent = error.message; }
  }
  readLimits() { return normalizeAgentLimits(Object.fromEntries(Object.entries(this.limitControls).map(([key, node]) => [key, Number(node.value)]))); }
  showLimits(limits) {
    for (const [key, node] of Object.entries(this.limitControls)) node.value = limits[key];
    this.limitPreset.value = Object.entries(AGENT_LIMIT_PRESETS).find(([, preset]) => Object.keys(this.limitControls).every(key => preset.limits[key] === limits[key]))?.[0] || 'custom';
    this.limitError.textContent = '';
  }
  updateLimits() {
    try {
      const limits = this.readLimits(); this.api.conversations.active.limits = limits;
      this.api.conversations.defaultLimits = saveAgentLimits(limits); this.showLimits(limits); this.render();
    } catch (error) { this.limitError.textContent = error.message; }
  }
  toolsPage() {
    const list = el('select', {size: 12, 'aria-label': 'Coding agent tools'}), details = el('pre', {class: 'agent-log', tabindex: 0, 'aria-label': 'Coding agent tool details'});
    for (const tool of this.api.agent.tools) list.append(el('option', {value: tool.name}, tool.name));
    list.onchange = () => { const tool = this.api.agent.tools.find(tool => tool.name === list.value); details.textContent = tool ? tool.description + '\n\n' + (tool.annotations.readOnlyHint ? 'Read-only' : 'Controlled by permission profile and rules') + '\n\n' + JSON.stringify(tool.inputSchema, null, 2) : ''; };
    list.selectedIndex = 0; list.onchange();
    return el('div', {class: 'agent-page'}, el('p', {}, this.api.adapter.tools.length + ' real IDE tools plus local plan/question tools. Answers and plans never grant permissions. API keys and host shell access are not tools.'), el('div', {class: 'agent-tool-catalog'}, list, details));
  }
  planPage() {
    this.planSummary = el('p'); this.planList = el('ol', {class: 'agent-plan', 'aria-label': 'Agent task plan'});
    return el('div', {class: 'agent-page'}, el('p', {}, 'Plan status is reported by the agent, not proof of successful execution. Check tool results and compiler diagnostics.'), this.planSummary, this.planList);
  }
  tasksPage() {
    this.taskList = el('select', {size: 8, 'aria-label': 'Agent tasks'});
    this.taskList.onchange = () => this.switchTask(this.taskList.value);
    this.taskName = input('Task name', {maxLength: 100});
    this.renameButton = button('Rename', () => { try { this.api.conversations.rename(this.api.conversations.activeId, this.taskName.value); this.render(); } catch (error) { this.status.textContent = error.message; } });
    this.deleteButton = button('Delete Task…', () => this.deleteTask());
    this.handoffButton = button('New Task with Context…', () => this.handoff());
    this.taskDetails = el('pre', {class: 'agent-log', 'aria-label': 'Task details', tabindex: 0});
    return el('div', {class: 'agent-page'}, el('p', {}, 'Select a task to switch without sending a request. Up to 8 tasks are kept only in this page. They share the live project, not a snapshot. Deleting a task does not undo project edits.'),
      this.taskList, field('Name:', this.taskName), el('div', {class: 'agent-actions'}, this.renameButton, this.deleteButton, this.handoffButton), this.taskDetails);
  }
  switchTask(id) {
    if (this.pending || this.api.conversations.busy) return;
    try {
      this.api.conversations.active.draft = this.prompt.value;
      this.api.conversations.select(id); this.syncTask();
    } catch (error) { this.status.textContent = error.message; }
  }
  syncTask() {
    const {agent} = this.api, task = this.api.conversations.active;
    if (agent.provider && this.provider.value !== agent.provider) { this.keyInput.value = ''; this.models.replaceChildren(el('option', {value: ''}, '(Refresh models)')); }
    if (agent.provider) this.provider.value = agent.provider;
    if (agent.model) this.model.value = agent.model;
    this.prompt.value = task.draft; this.showLimits(task.limits); this.showPermissions(task.permissions); this.taskName.value = task.title;
    this.status.textContent = 'Selected ' + task.title + (agent.matchesWorkspace() ? ' — ' + agent.state : ' — previous project session; start a new task.'); this.refresh();
  }
  async deleteTask() {
    if (this.pending || this.api.conversations.busy) return;
    const task = this.api.conversations.active, controller = new AbortController(); this.pending = controller; this.refresh();
    try {
      const yes = await cancellableDialog('AI Coding Agent — Delete Task', el('p', {}, 'Delete "' + task.title + '" and its in-memory conversation? Project edits remain in normal Undo history.'), controller.signal, 'Delete Task');
      if (yes && !controller.signal.aborted) { this.api.conversations.remove(task.id); this.syncTask(); }
    } finally { this.pending = null; this.refresh(); }
  }
  async handoff() {
    if (this.pending || this.api.conversations.busy) return;
    const context = el('textarea', {'aria-label': 'Reviewed task context', rows: 12, maxLength: 60000, class: 'agent-handoff'}, this.api.conversations.handoff());
    const controller = new AbortController(); this.pending = controller; this.refresh();
    try {
      const yes = await cancellableDialog('AI Coding Agent — Review Context', el('div', {class: 'agent-review'},
        el('p', {}, 'Review and edit public messages before copying them to a new task. This is an excerpt, not an automatic summary. Tool results, signatures, credentials and permissions are not copied. Public text may still contain confidential source or user-entered secrets.'), context,
        el('p', {}, 'No request is sent now. Add the new task instructions, then review the provider and permissions before Run.')), controller.signal, 'Create Task');
      if (yes && !controller.signal.aborted) { this.api.conversations.active.draft = this.prompt.value; this.api.conversations.createFromContext(context.value); this.syncTask(); }
    } catch (error) { this.status.textContent = error.message; }
    finally { this.pending = null; this.refresh(); }
  }
  activityPage() { this.activity = el('pre', {class: 'agent-log agent-activity', tabindex: 0, 'aria-label': 'Coding agent activity'}); return el('div', {class: 'agent-page'}, this.activity); }
  transport() {
    if (this.connection.value === 'direct' && !this.browserConsent.checked) throw new Error('Accept browser key exposure in Connection, or use the local relay.');
    return this.transportFactory({provider: this.provider.value, apiKey: this.keyInput.value, relay: this.connection.value === 'relay' ? this.relay.value : '', relayToken: this.token.value, requestTimeoutMs: this.readLimits().requestTimeoutMs});
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
  async start(continuation = false, compactOnly = false) {
    if (!continuation && this.prompt.value.trim() === '/compact') compactOnly = true;
    if (this.pending || this.api.agent.busy) return;
    const setup = new AbortController(); this.pending = setup; this.refresh();
    try {
      const provider = this.provider.value, model = modelId(this.model.value), prompt = this.prompt.value, limits = this.readLimits();
      if (!continuation && !compactOnly && !prompt.trim()) throw new Error('Enter a task on the Task tab.');
      if (compactOnly && (!this.api.agent.canCompact || provider !== this.api.agent.provider || model !== this.api.agent.model)) throw new Error('Choose the task’s original provider/model and a task with completed context to compact.');
      if (continuation && (!this.api.agent.canResume || provider !== this.api.agent.provider || model !== this.api.agent.model)) throw new Error("Choose the task's original provider/model and a resumable task, or start a new task.");
      const transport = this.transport(), permissions = this.readPermissions(), {mode, scopes} = permissions;
      if (!this.api.agent.permissionConstraints.allowedModes.includes(mode) || permissions.permissionMinutes > this.api.agent.permissionConstraints.maxMinutes) throw new Error('These permissions exceed the host policy.');
      const fullConfirmation = input('Confirm Full IDE access for this run', {type: 'checkbox'});
      const confirmButton = button('Review permission settings', () => { this.pending?.abort(); this.pages.select('permissions'); });
      const project = this.ide.project, authority = this.api.adapter.authoritySignal;
      const signal = AbortSignal.any([setup.signal, authority]);
      const allowed = await cancellableDialog(compactOnly ? 'AI Coding Agent — Compact Context' : continuation ? 'AI Coding Agent — Continue Task' : 'AI Coding Agent — Start Task', el('div', {class: 'agent-review'},
        el('p', {}, 'Send this task and requested project context from ' + project.name + ' to ' + PROVIDERS[provider].label + ' (' + model + ')?'),
        ...(compactOnly ? [el('p', {}, 'Request a checkpoint of this task’s public history from the same provider. No IDE tools will execute. Existing context is replaced only after a valid summary; the public thread and cumulative budget remain. Summaries may lose detail.')] : []),
        el('p', {}, 'Recovery: up to ' + limits.maxRetries + ' automatic retries per generation request. Checkpoints and retry attempts consume this run’s request and session allowances.'),
        el('p', {}, 'This may incur API charges. Review source for secrets before continuing. Read access includes project files and debugger data.'),
        el('p', {}, 'Session allowance: ' + limits.tokenBudget.toLocaleString('en-US') + ' tokens; ' + this.api.agent.budgetUsed.toLocaleString('en-US') + ' already accounted. Output cap: ' + limits.maxTokens.toLocaleString('en-US') + ' per request. This run allows ' + limits.maxTurns + ' requests and ' + limits.maxCalls + ' tool calls. Larger limits may substantially increase costs.'),
        ...(continuation ? [el('p', {}, this.api.agent.pendingTurn ? 'Continue first processes the validated deferred batch without requesting it again. No operation in that batch has executed. Original arguments are retained; stale revisions are rejected, never automatically rewritten. Current permission choices still apply.' : 'Continue sends the pending request with prior completed tool results, not a duplicate task prompt. Run limits and permissions are reviewed again. A failed or truncated request may already have incurred charges.'), el('p', {}, this.api.agent.failure?.retryAfterMs ? 'Provider suggested retry delay: ' + Math.ceil(this.api.agent.failure.retryAfterMs / 1000) + ' seconds. Continue will honor any remaining delay.' : '')] : []),
        el('p', {}, permissionSummary(permissions)),
        el('p', {}, mode === 'full' ? 'FULL IDE ACCESS: project edits/deletions, runtime execution and debugger evaluation may occur without further approval. Running project code may use its configured networks, data sources or native integrations. This cannot be undone by Stop. This does not add arbitrary host shell/disk access or bypass provider/browser security.' : mode === 'scoped' ? 'Delegated scopes: ' + (scopes.join(', ') || '(none)') + '. Other effects use the approval policy.' : ['readonly', 'plan'].includes(mode) ? 'Read-only boundary: no project edits or execution. Plan mode produces a proposal, not automatic implementation.' : mode === 'autoedit' ? 'Automatically edit non-destructive code, designer, virtual files, public data definitions and workspace. Ask before execution, project replacement and destructive effects.' : 'Each change or execution requires approval unless an explicit allow rule applies.'),
        el('pre', {class: 'agent-log'}, JSON.stringify({scopeRules: permissions.scopeRules, toolRules: permissions.toolRules, host: this.api.agent.permissionConstraints}, null, 2)),
        ...(mode === 'full' ? [el('label', {class: 'agent-full-confirm'}, fullConfirmation, 'I understand and authorize Full IDE access for this run only.')] : []), confirmButton), signal, compactOnly ? 'Compact Context' : continuation ? 'Continue Task' : 'Start Task');
      if (!allowed) return; signal.throwIfAborted();
      if (mode === 'full' && !fullConfirmation.checked) throw new Error('Full IDE access was not confirmed. No request was sent.');
      if (project !== this.ide.project) throw new Error('Project changed; review the current project again.');
      this.pending = null; this.api.conversations.active.limits = limits; this.api.conversations.defaultLimits = saveAgentLimits(limits);
      this.api.conversations.active.permissions = permissions;
      const options = {provider, model, prompt, transport, ...permissions, fullAccessConfirmed: mode === 'full' && fullConfirmation.checked, ...limits};
      const run = compactOnly ? this.api.agent.compact(options) : continuation ? this.api.agent.resume(options) : this.api.agent.run(options);
      if (compactOnly && this.prompt.value.trim() === '/compact') { this.prompt.value = ''; this.api.conversations.active.draft = ''; }
      this.refresh(); await run;
    } catch (error) { this.status.textContent = error.name === 'AbortError' ? 'Agent cancelled.' : error.message; }
    finally { if (this.pending === setup) this.pending = null; this.refresh(); }
  }
  cancel() { this.pending?.abort(); this.api.agent.stop(); }
  newTask() {
    if (this.pending || this.api.agent.busy) return;
    try { this.api.conversations.active.draft = this.prompt.value; this.api.conversations.create(); this.syncTask(); } catch (error) { this.status.textContent = error.message; }
  }
  event(event) {
    if (event.taskId && event.taskId !== this.api.conversations.activeId) return;
    if (event.type === 'user') { this.prompt.value = ''; this.api.conversations.active.draft = ''; }
    if (!['delta', 'idle', 'permission'].includes(event.type)) this.status.textContent = event.text;
    const win = this.root.ownerDocument.defaultView;
    if (!this.frame) { this.frameWindow = win; this.frame = win.requestAnimationFrame(() => { this.frame = null; this.render(); this.refresh(false); }); }
  }

  render() {
    const {agent, conversations} = this.api, task = conversations.active, entries = agent.transcript;
    const budget = task.limits.tokenBudget, used = agent.budgetUsed;
    this.contextStatus.textContent = task.title + ' — ' + agent.state + ' | ' + agent.usage.tokens.toLocaleString('en-US') + ' / ' + budget.toLocaleString('en-US') + ' reported session tokens'
      + (agent.unreportedRequests ? ' + ' + agent.estimatedTokens.toLocaleString('en-US') + ' estimated (' + agent.unreportedRequests + ' unreported requests)' : '')
      + ' | ' + Math.max(0, budget - used).toLocaleString('en-US') + ' remaining | ' + agent.usage.requests + ' requests, ' + agent.usage.calls + ' tools | ' + Math.ceil(agent.historyBytes / 1024) + ' KiB native history | ' + (agent.lastInputTokens == null ? 'Input tokens: estimated on next request' : agent.lastInputTokens.toLocaleString('en-US') + ' last reported input tokens') + ' | ' + agent.compactions + ' compactions';
    const lease = agent.permissionSession?.snapshot(), config = task.permissions;
    this.permissionBadge.textContent = lease?.active ? permissionSummary(config) + ' • Active until ' + new Date(lease.expiresAt).toLocaleTimeString() + ' • ' + lease.approvedTools.length + ' exact-tool approvals' : permissionSummary(config) + ' • Inactive — no permission grant';
    this.permissionBadge.dataset.profile = config.mode;
    this.permissionDescription.textContent = permissionSummary(config);
    const grantStamp = JSON.stringify(lease?.approvedTools || []);
    if (this.grantStamp !== grantStamp) { this.grantStamp = grantStamp; this.grants.replaceChildren(...(lease?.approvedTools || []).map(name => el('option', {value: name}, name))); }
    this.revokeTool.disabled = !lease?.active || !lease.approvedTools.length;
    this.budgetMeter.max = budget; this.budgetMeter.value = Math.min(budget, used); this.budgetMeter.setAttribute('aria-valuetext', Math.min(100, Math.round(used / budget * 100)) + '% of session budget accounted');
    this.recovery.hidden = !agent.canResume;
    this.recoveryText.textContent = agent.limit?.message || ({access: 'Check provider credentials and model access in Connection, then Continue. No automatic retry; completed edits are retained.', quota: 'Provider quota/billing needs attention. Retry with Continue after the provider account is ready; prior context and usage are retained.', request: 'The provider rejected request settings. Review the model/output limits before Continue, or create a new task to change models.'})[agent.failure?.kind] || (agent.state === 'retry' ? 'The provider request was interrupted. Review the connection and budget before a manual retry. Completed edits will not be replayed.' : '');
    if (agent.limit?.required) this.recoveryText.textContent += ' Required for this batch/request: ' + agent.limit.required.toLocaleString('en-US') + (agent.limit.kind === 'context' ? ' bytes.' : ' tool calls.');
    this.threadView.update(agent.thread, {taskId: task.id, busy: agent.busy});
    const planStamp = task.id + ':' + agent.plan.revision;
    if (this.planStamp !== planStamp) {
      this.planStamp = planStamp; this.planSummary.textContent = agent.plan.explanation || 'No task plan yet.';
      this.planList.replaceChildren(...agent.plan.steps.map(step => el('li', {'data-status': step.status}, el('strong', {}, ({pending: 'Pending', in_progress: 'In progress', completed: 'Completed'})[step.status] + ': '), step.title)));
    }
    const tasks = conversations.list(), stamp = JSON.stringify(tasks.map(({id, title, state, currentWorkspace}) => ({id, title, state, currentWorkspace})));
    if (this.tasksStamp !== stamp) { this.tasksStamp = stamp; this.taskList.replaceChildren(...tasks.map(item => el('option', {value: item.id}, item.title + ' — ' + (item.currentWorkspace ? item.state : 'previous project')))); }
    this.taskList.value = task.id;
    if (this.displayedTask !== task.id) { this.displayedTask = task.id; this.taskName.value = task.title; }
    this.taskDetails.textContent = 'Task: ' + task.title + '\nProvider/model: ' + (agent.provider ? agent.provider + ' / ' + agent.model : '(not started)') + '\nState: ' + agent.state + '\nProject session: ' + (agent.matchesWorkspace() ? 'current' : 'changed — cannot resume') + '\nContext is memory-only; no signatures, tool history or grants are copied by New Task with Context.';

    const activityStamp = task.id + ':' + (entries.at(-1)?.id || 0);
    if (this.activityStamp !== activityStamp) { this.activityStamp = activityStamp; this.activity.textContent = entries.filter(event => !['user', 'assistant', 'question', 'answer'].includes(event.type)).map(event => event.time.slice(11, 19) + ' ' + event.type + ': ' + event.text + (event.arguments ? '\n' + JSON.stringify(event.arguments, null, 2) : '') + (event.result ? '\n' + JSON.stringify(event.result, null, 2) : '')).join('\n').slice(-200000); }
  }
  refresh(render = true) {
    const busy = !!this.pending || this.api.agent.busy;
    this.revokeButton.disabled = !busy;
    this.compactButton.disabled = busy || !this.api.agent.canCompact;
    this.sendButton.disabled = busy || !!this.api.agent.pendingTurn; this.composerStop.disabled = !busy;
    this.recoveryContinue.disabled = busy || !this.api.agent.canResume; this.recoverySettings.disabled = busy;
    this.runButton.disabled = busy || !!this.api.agent.pendingTurn; this.continueButton.disabled = busy || !this.api.agent.canResume; this.stopButton.disabled = !busy; this.newButton.disabled = busy;
    for (const control of [this.provider, this.connection, this.model, this.models, this.keyInput, this.relay, this.token, this.browserConsent, this.refreshModels, this.clearKey, this.mode, this.quickMode, this.approvalPolicy, this.permissionMinutes, this.ruleTool, this.ruleAction, this.ruleAdd, this.ruleRemove, this.ruleList, this.resetPermissions, ...this.scopeRules.map(item => item.node), this.turns, this.outputTokens, this.budget, this.callLimit, this.contextLimit, this.requestTimeout, ...this.recoveryLimits.map(item => item.node), this.limitPreset, this.exampleSelect, this.taskList, this.taskName, this.renameButton, this.deleteButton, this.handoffButton, ...this.scopeInputs.map(item => item.node)]) control.disabled = busy;
    if (render) this.render();
  }
  dispose() { this.api.conversations.active.draft = this.prompt.value; this.cancel(); this.keyInput.value = ''; this.token.value = ''; this.unlisten?.(); if (this.frame) this.frameWindow?.cancelAnimationFrame(this.frame); this.threadView.dispose(); }
}
