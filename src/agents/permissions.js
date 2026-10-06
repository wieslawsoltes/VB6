import {AGENT_SCOPES, agentScope} from '../mcp/agent-permissions.js';
import {McpError, awaitAbort, checkAbort} from '../mcp/protocol.js';

// Original implementation informed by the access-boundary/approval-policy distinction:
// https://developers.openai.com/codex/concepts/sandboxing (reviewed 2026-10-06).
// These are IDE-tool permissions, NOT an OS filesystem/network sandbox.
export const AGENT_PERMISSION_PROFILES = Object.freeze({
  review: 'Ask for approval', readonly: 'Read only', plan: 'Plan (no project changes)',
  autoedit: 'Auto edit (ask before execution)', full: 'Full IDE access', scoped: 'Custom / selected scopes'
});
const actions = ['allow', 'ask', 'deny'];
const scopeNames = Object.keys(AGENT_SCOPES);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = text => { throw new McpError(-32602, text); };
const deny = text => { throw new McpError(-32001, text); };
export function permissionEffects(tool) {
  if (isInspectionTool(tool)) return [];
  const primary = agentScope(tool.name), effects = new Set([primary]);
  if (['vb6.project.new', 'vb6.project.import', 'vb6.project.select', 'vb6.history.apply'].includes(tool.name))
    for (const scope of ['project', 'code', 'designer', 'files', 'data', 'workspace']) effects.add(scope);
  if (['vb6.module.add', 'vb6.module.remove', 'vb6.module.rename'].includes(tool.name)) { effects.add('project'); effects.add('designer'); }
  if (['vb6.control.edit', 'vb6.menu.edit', 'vb6.debug.applyEdits'].includes(tool.name)) effects.add('code');
  if (['debugger', 'runtime'].includes(primary) && (tool.annotations?.openWorldHint || tool.name === 'vb6.runtime.start')) { effects.add('debugger'); effects.add('runtime'); }
  return [...effects];
}
export const isInspectionTool = tool => tool?.annotations?.readOnlyHint === true && tool.annotations.destructiveHint !== true && tool.annotations.openWorldHint !== true;
function names(values, allowed, label) {
  if (!Array.isArray(values) || values.length > allowed.length || values.some(value => !allowed.includes(value)) || new Set(values).size !== values.length) fail('Choose known, distinct ' + label + '.');
  return [...values];
}
function rules(value, allowed, label) {
  if (!record(value) || Object.keys(value).length > allowed.length) fail('Invalid ' + label + '.');
  const result = {};
  for (const [name, action] of Object.entries(value)) {
    if (!allowed.includes(name) || !actions.includes(action)) fail('Unknown ' + label + ' or action: ' + name);
    result[name] = action;
  }
  return Object.freeze(result);
}
/** Validate host constraints once at installation. A task cannot override this ceiling. */
export function normalizePermissionConstraints(value = {}, tools = []) {
  if (!record(value) || Object.keys(value).some(key => !['allowedModes', 'deniedTools', 'deniedScopes', 'maxMinutes', 'allowRunApprovals'].includes(key))) fail('Invalid host permission constraints.');
  const allowedModes = names(value.allowedModes ?? Object.keys(AGENT_PERMISSION_PROFILES), Object.keys(AGENT_PERMISSION_PROFILES), 'permission profiles');
  if (!allowedModes.length) fail('Host must allow at least one permission profile.');
  const maxMinutes = value.maxMinutes ?? 60;
  if (!Number.isInteger(maxMinutes) || maxMinutes < 1 || maxMinutes > 60) fail('Host permission duration must be 1–60 minutes.');
  if (value.allowRunApprovals !== undefined && typeof value.allowRunApprovals !== 'boolean') fail('Invalid run-approval constraint.');
  return Object.freeze({allowedModes: Object.freeze(allowedModes),
    deniedTools: Object.freeze(names(value.deniedTools ?? [], tools.map(tool => tool.name), 'denied tools')),
    deniedScopes: Object.freeze(names(value.deniedScopes ?? [], scopeNames, 'denied scopes')),
    maxMinutes, allowRunApprovals: value.allowRunApprovals !== false});
}
/** No storage, wildcard rules, caller-supplied endpoints, or model-controlled grants. */
export function normalizeAgentPermissions(value = {}, tools = []) {
  if (!record(value) || Object.keys(value).some(key => !['mode', 'scopes', 'scopeRules', 'toolRules', 'approvalPolicy', 'permissionMinutes'].includes(key))) fail('Invalid coding-agent permission settings.');
  const mode = value.mode ?? 'review';
  if (!Object.hasOwn(AGENT_PERMISSION_PROFILES, mode)) fail('Choose a known agent permission profile.');
  const approvalPolicy = value.approvalPolicy ?? (['readonly', 'plan', 'full'].includes(mode) ? 'never' : 'on-request');
  if (!['on-request', 'never'].includes(approvalPolicy)) fail('Choose Ask when needed or Never ask (deny instead).');
  const permissionMinutes = value.permissionMinutes ?? 10;
  if (!Number.isInteger(permissionMinutes) || permissionMinutes < 1 || permissionMinutes > 60) fail('Permission duration must be 1–60 minutes.');
  const scopes = Object.freeze(names(value.scopes ?? [], scopeNames, 'delegated scopes'));
  return Object.freeze({mode, scopes, approvalPolicy, permissionMinutes,
    scopeRules: rules(value.scopeRules ?? {}, scopeNames, 'scope rule'),
    toolRules: rules(value.toolRules ?? {}, tools.map(tool => tool.name), 'exact tool rule')});
}
export function permissionSummary(config) {
  return AGENT_PERMISSION_PROFILES[config.mode] + ' • ' + (config.approvalPolicy === 'never' ? 'Never ask; disallowed actions fail' : 'Ask when needed')
    + ' • expires after ' + config.permissionMinutes + ' minute(s) or when this run ends';
}
/** One immutable project/task-bound lease. Approval decisions only come from the local host. */
export class AgentPermissionSession {
  constructor(config, {tools, projectId, sessionKey, constraints = {}, fullAccessConfirmed = false, onEvent = () => {}, now = () => Date.now()} = {}) {
    this.config = normalizeAgentPermissions(config, tools);
    this.constraints = normalizePermissionConstraints(constraints, tools);
    if (!this.constraints.allowedModes.includes(this.config.mode)) fail('This permission profile is disabled by the host.');
    if (this.config.permissionMinutes > this.constraints.maxMinutes) fail('Permission duration exceeds the host limit.');
    if (this.config.mode === 'full' && fullAccessConfirmed !== true) fail('Full IDE access requires explicit local confirmation for every run.');
    if (typeof projectId !== 'string' || !projectId || typeof sessionKey !== 'string' || !sessionKey) fail('Permissions require an identified project and task.');
    // Copy trusted metadata; a later catalog change cannot promote a tool to read-only.
    this.tools = new Map(tools.map(tool => [tool.name, {name: tool.name, annotations: {...tool.annotations}}]));
    this.projectId = projectId; this.sessionKey = sessionKey; this.onEvent = onEvent; this.now = now;
    this.expiresAt = now() + this.config.permissionMinutes * 60000;
    this.controller = new AbortController(); this.runApprovals = new Set(); this.active = true;
    this.timer = setTimeout(() => this.revoke('Permission lease expired. Start or resume only after a fresh local confirmation.'), this.config.permissionMinutes * 60000);
    this.timer.unref?.();
  }
  get signal() { return this.controller.signal; }
  report(action, name, reason) {
    // Never log arguments, project source, credentials, or provider-native history here.
    try { this.onEvent({action, tool: name || '', reason, profile: this.config.mode, expiresAt: this.expiresAt}); } catch {}
  }
  assertContext(projectId, context = {}) {
    checkAbort(context.signal);
    if (!this.active || this.now() >= this.expiresAt) { this.revoke('Permission lease expired.'); deny('Agent permissions are revoked or expired.'); }
    if (this.projectId !== projectId || this.sessionKey !== context.sessionKey) deny('Agent permission lease belongs to another project or task.');
    checkAbort(this.signal);
  }
  /** Evaluate hard boundaries first. Explicit deny beats every allow, including Full IDE access. */
  decision(name) {
    const tool = this.tools.get(name), c = this.config, scope = agentScope(name), inspection = isInspectionTool(tool);
    const effects = tool ? permissionEffects(tool) : [];
    if (!tool) return {action: 'deny', reason: 'Tool is not in this run’s trusted catalog.'};
    if (this.constraints.deniedTools.includes(name) || effects.some(scope => this.constraints.deniedScopes.includes(scope))) return {action: 'deny', reason: 'Disabled by host policy.'};
    if (!inspection && ['readonly', 'plan'].includes(c.mode)) return {action: 'deny', reason: 'Read-only/Plan mode forbids project changes and execution.'};
    if (c.toolRules[name] === 'deny' || effects.some(scope => c.scopeRules[scope] === 'deny')) return {action: 'deny', reason: 'Explicit deny rule.'};
    let action = c.toolRules[name] ?? (effects.some(scope => c.scopeRules[scope] === 'ask') ? 'ask' : !inspection ? c.scopeRules[scope] : undefined);
    if (!action) {
      if (inspection || c.mode === 'full') action = 'allow';
      else if (c.mode === 'scoped' && c.scopes.includes(scope)) action = 'allow';
      else if (c.mode === 'autoedit' && ['code', 'designer', 'files', 'data', 'workspace'].includes(scope) && !tool.annotations.destructiveHint && !tool.annotations.openWorldHint) action = 'allow';
      else action = 'ask';
    }
    if (action === 'ask' && this.runApprovals.has(name)) return {action: 'allow', reason: 'Exact tool approved for this run.'};
    if (action === 'ask' && c.approvalPolicy === 'never') return {action: 'deny', reason: 'Approval would be required; Never ask denies rather than escalating.'};
    return {action, reason: action === 'allow' ? 'Allowed by the reviewed permission profile/rules.' : 'Local approval required.'};
  }
  assertTool(name, projectId, context) {
    this.assertContext(projectId, context);
    const decision = this.decision(name);
    if (decision.action === 'deny') { this.report('deny', name, decision.reason); deny(decision.reason + ' Operation: ' + name); }
    return decision;
  }
  async authorize(request, context, approve) {
    let decision = this.assertTool(request.name, request.projectId, context);
    if (decision.action === 'allow') { this.report('allow', request.name, decision.reason); return; }
    const signal = AbortSignal.any([context.signal, this.signal].filter(Boolean));
    const review = {...request, permission: {profile: this.config.mode, expiresAt: this.expiresAt, canAllowRun: this.constraints.allowRunApprovals}};
    const answer = await awaitAbort(Promise.resolve(approve(review, {signal})), signal);
    this.assertTool(request.name, request.projectId, {...context, signal});
    // Legacy host callbacks can return boolean true. Strings must be exact local UI values.
    if (answer !== true && answer !== 'once' && answer !== 'run') { this.report('deny', request.name, 'Local user denied the operation.'); deny('The local user declined this operation.'); }
    if (answer === 'run') {
      if (!this.constraints.allowRunApprovals) deny('Run-wide approvals are disabled by the host.');
      this.runApprovals.add(request.name);
    }
    this.report(answer === 'run' ? 'approve-run' : 'approve-once', request.name, answer === 'run' ? 'Exact tool only; original expiry and current revision checks remain.' : 'This invocation only.');
  }
  removeApproval(name) {
    if (this.runApprovals.delete(name)) this.report('revoke-tool', name, 'Future uses require approval again.');
  }
  snapshot(projectId = this.projectId) {
    const active = this.active && this.now() < this.expiresAt && projectId === this.projectId;
    return {active, profile: this.config.mode, approvalPolicy: this.config.approvalPolicy, expiresAt: active ? this.expiresAt : null,
      scopes: active ? scopeNames.filter(scope => { const tools = [...this.tools.values()].filter(tool => permissionEffects(tool).includes(scope)); return tools.length > 0 && tools.every(tool => this.decision(tool.name).action === 'allow'); }) : [],
      approvedTools: active ? [...this.runApprovals] : []};
  }
  revoke(reason = 'Run ended or permissions revoked.') {
    if (!this.active) return;
    this.active = false; clearTimeout(this.timer); this.runApprovals.clear();
    this.controller.abort(new DOMException(reason, 'AbortError')); this.report('revoke', '', reason);
  }
}
