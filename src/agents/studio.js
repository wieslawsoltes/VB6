import {el, download} from '../core/core.js';
import {modal, tabbedPages, icon} from '../ide/ui.js';
import {operationReview} from './review.js';
import {createIdeAdapter} from '../mcp/ide-adapter.js';
import {AGENT_SCOPES} from '../mcp/agent-permissions.js';
import {CodingAgent} from './agent.js';
import {AgentConversations} from './conversations.js';
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
  const conversations = new AgentConversations(adapter, {askUser: questionDialog,
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
  studioAPI.Agents = {CodingAgent, AgentConversations, createTransport, listModels, installCodingAgents};
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
    this.runButton = button('Run', () => this.start(), 'run'); this.continueButton = button('Continue', () => this.start(true), 'run'); this.stopButton = button('Stop', () => this.cancel(), 'stop');
    this.newButton = button('New Task', () => this.newTask(), 'new');
    this.exportButton = button('Save Transcript…', () => download('coding-agent-transcript.json', JSON.stringify(api.agent.transcript, null, 2), 'application/json'), 'save');
    this.root.append(el('div', {class: 'agent-toolbar'}, this.runButton, this.continueButton, this.stopButton, this.newButton, this.exportButton),
      tabbedPages([{id: 'task', label: 'Task', node: this.taskPage()}, {id: 'connection', label: 'Connection', node: this.connectionPage()},
        {id: 'permissions', label: 'Permissions', node: this.permissionsPage()}, {id: 'tools', label: 'Tools', node: this.toolsPage()},
        {id: 'plan', label: 'Plan', node: this.planPage()}, {id: 'tasks', label: 'Tasks', node: this.tasksPage()}, {id: 'activity', label: 'Activity', node: this.activityPage()}], {label: 'Coding agent pages'}), this.status);
    this.unlisten = api.onChange(event => this.event(event)); this.syncTask();
  }
  taskPage() {
    this.prompt = el('textarea', {'aria-label': 'Agent task', rows: 4, maxLength: 100000, spellcheck: 'false', placeholder: 'Describe a coding, form designer, compiler or debugging task.'});
    this.prompt.addEventListener('input', () => { this.api.conversations.active.draft = this.prompt.value; });
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
    this.contextStatus = el('div', {class: 'agent-context', 'aria-label': 'Task context usage'});
    return el('div', {class: 'agent-page agent-task'}, field('Task example:', examples), this.contextStatus, this.log, field('Task:', this.prompt), el('div', {}, 'Ctrl+Enter sends a new task or follow-up. Continue resumes a limited task or retries a failed request without repeating its prompt. Tasks are memory-only.'));
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
    this.callLimit = input('Maximum agent tool calls', {type: 'number', value: '128', min: '1', max: '1000'});
    this.outputTokens = input('Maximum output tokens', {type: 'number', value: '8192', min: '256', max: '32768'});
    this.budget = input('Reported token budget', {type: 'number', value: '200000', min: '1024', max: '2000000'});
    return el('div', {class: 'agent-page'}, field('Permission mode:', this.mode),
      group('Delegated scopes (only used in Agent mode)', ...this.scopeInputs.map(({node, label}) => el('label', {}, node, label))),
      group('Run limits', field('Maximum requests:', this.turns), field('Maximum tool calls:', this.callLimit), field('Output tokens/request:', this.outputTokens), field('Reported token budget:', this.budget)),
      el('p', {}, 'Read access sends requested project/source/debugger data to the selected provider. Review your project for secrets first. Writes retain normal Undo and stale-revision protection. Execution can access data sources configured in project code. Stop cancels requests and pending approvals; it does not roll back already-applied edits or external side effects.'),
      el('p', {}, 'The token budget uses provider-reported usage, not billing estimates; a request can exceed it. Use provider account spend limits for a hard billing cap. Permissions end after the run, Stop, project reload, expiry, or page reload. MCP sharing and permissions are independent.'));
  }
  toolsPage() {
    const list = el('select', {size: 12, 'aria-label': 'Coding agent tools'}), details = el('pre', {class: 'agent-log', tabindex: 0, 'aria-label': 'Coding agent tool details'});
    for (const tool of this.api.agent.tools) list.append(el('option', {value: tool.name}, tool.name));
    list.onchange = () => { const tool = this.api.agent.tools.find(tool => tool.name === list.value); details.textContent = tool ? tool.description + '\n\n' + (tool.annotations.readOnlyHint ? 'Read-only' : 'Requires approval or delegated scope') + '\n\n' + JSON.stringify(tool.inputSchema, null, 2) : ''; };
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
    this.prompt.value = task.draft; this.pendingText = ''; this.taskName.value = task.title;
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
  async start(continuation = false) {
    if (this.pending || this.api.agent.busy) return;
    const setup = new AbortController(); this.pending = setup; this.refresh();
    try {
      const provider = this.provider.value, model = modelId(this.model.value), prompt = this.prompt.value;
      if (!continuation && !prompt.trim()) throw new Error('Enter a task on the Task tab.');
      if (continuation && (!this.api.agent.canResume || provider !== this.api.agent.provider || model !== this.api.agent.model)) throw new Error("Choose the task's original provider/model and a resumable task, or start a new task.");
      const transport = this.transport(), mode = this.mode.value, scopes = this.scopeInputs.filter(item => item.node.checked).map(item => item.id);
      if (mode === 'scoped' && !scopes.length) throw new Error('Select at least one delegated scope.');
      const project = this.ide.project, authority = this.api.adapter.authoritySignal;
      const signal = AbortSignal.any([setup.signal, authority]);
      const allowed = await cancellableDialog(continuation ? 'AI Coding Agent — Continue Task' : 'AI Coding Agent — Start Task', el('div', {class: 'agent-review'},
        el('p', {}, 'Send this task and requested project context from ' + project.name + ' to ' + PROVIDERS[provider].label + ' (' + model + ')?'),
        el('p', {}, 'This may incur API charges. Review source for secrets before continuing. Read access includes project files and debugger data.'),
        ...(continuation ? [el('p', {}, 'Continue sends the pending request with prior completed tool results, not a duplicate task prompt. Run limits and permissions are reviewed again. A failed request may already have incurred charges.'), el('p', {}, this.api.agent.failure?.retryAfterMs ? 'Provider suggested retry delay: ' + Math.ceil(this.api.agent.failure.retryAfterMs / 1000) + ' seconds. No automatic retry is scheduled.' : '')] : []),
        el('p', {}, mode === 'scoped' ? 'Authorize for this run, up to 10 minutes: ' + scopes.join(', ') + '. Selected operations will not ask again. Other changes still require review.' : mode === 'readonly' ? 'Read-only mode: the agent cannot change or execute the project.' : 'Each change or execution requires your approval.')), signal, continuation ? 'Continue Task' : 'Start Task');
      if (!allowed) return; signal.throwIfAborted();
      if (project !== this.ide.project) throw new Error('Project changed; review the current project again.');
      this.pending = null; this.pendingText = '';
      const options = {provider, model, prompt, transport, mode, scopes, maxTurns: Number(this.turns.value), maxCalls: Number(this.callLimit.value), maxTokens: Number(this.outputTokens.value), tokenBudget: Number(this.budget.value)};
      const run = continuation ? this.api.agent.resume(options) : this.api.agent.run(options);
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
    if (event.type === 'delta') { this.pendingText += event.text; if (this.pendingText.length > 200000) this.pendingText = this.pendingText.slice(-200000); }
    else { if (['assistant', 'error', 'resume', 'task'].includes(event.type)) this.pendingText = ''; if (event.type !== 'idle') this.status.textContent = event.text; }
    if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = null; this.render(); this.refresh(); });
  }
  render() {
    const {agent, conversations} = this.api, task = conversations.active, entries = agent.transcript;
    this.contextStatus.textContent = task.title + ' — ' + agent.state + ' | ' + Math.ceil(agent.historyBytes / 1024) + ' KiB native context | ' + agent.usage.requests + ' requests, ' + agent.usage.tokens + ' reported tokens, ' + agent.usage.calls + ' tool calls';
    this.planSummary.textContent = agent.plan.explanation || 'No task plan yet.';
    this.planList.replaceChildren(...agent.plan.steps.map(step => el('li', {'data-status': step.status}, el('strong', {}, ({pending: 'Pending', in_progress: 'In progress', completed: 'Completed'})[step.status] + ': '), step.title)));
    const tasks = conversations.list(), stamp = JSON.stringify(tasks);
    if (this.tasksStamp !== stamp) { this.tasksStamp = stamp; this.taskList.replaceChildren(...tasks.map(item => el('option', {value: item.id}, item.title + ' — ' + (item.currentWorkspace ? item.state : 'previous project')))); }
    this.taskList.value = task.id;
    if (this.displayedTask !== task.id) { this.displayedTask = task.id; this.taskName.value = task.title; }
    this.taskDetails.textContent = 'Task: ' + task.title + '\nProvider/model: ' + (agent.provider ? agent.provider + ' / ' + agent.model : '(not started)') + '\nState: ' + agent.state + '\nProject session: ' + (agent.matchesWorkspace() ? 'current' : 'changed — cannot resume') + '\nContext is memory-only; no signatures, tool history or grants are copied by New Task with Context.';
    this.log.textContent = entries.filter(event => ['user', 'assistant', 'question', 'answer'].includes(event.type)).map(event => (event.type === 'assistant' ? 'Agent' : event.type === 'question' ? 'Agent question' : event.type === 'answer' ? 'Your answer' : 'You') + ':\n' + event.text).join('\n\n').slice(-200000) + (this.pendingText ? '\n\nAgent:\n' + this.pendingText : '');
    this.activity.textContent = entries.filter(event => !['user', 'assistant', 'question', 'answer'].includes(event.type)).map(event => event.time.slice(11, 19) + ' ' + event.type + ': ' + event.text + (event.arguments ? '\n' + JSON.stringify(event.arguments, null, 2) : '') + (event.result ? '\n' + JSON.stringify(event.result, null, 2) : '')).join('\n').slice(-200000);
  }
  refresh() {
    const busy = !!this.pending || this.api.agent.busy;
    this.runButton.disabled = busy; this.continueButton.disabled = busy || !this.api.agent.canResume; this.stopButton.disabled = !busy; this.newButton.disabled = busy;
    for (const control of [this.provider, this.connection, this.model, this.models, this.keyInput, this.relay, this.token, this.browserConsent, this.refreshModels, this.clearKey, this.mode, this.turns, this.outputTokens, this.budget, this.callLimit, this.prompt, this.exampleSelect, this.taskList, this.taskName, this.renameButton, this.deleteButton, this.handoffButton, ...this.scopeInputs.map(item => item.node)]) control.disabled = busy;
    if (!busy) this.render();
  }
  dispose() { this.api.conversations.active.draft = this.prompt.value; this.cancel(); this.keyInput.value = ''; this.token.value = ''; this.unlisten?.(); if (this.frame) cancelAnimationFrame(this.frame); }
}
