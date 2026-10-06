import {McpError} from './protocol.js';

/** Local-only delegated authority. Never serialized into projects or reachable as an MCP tool. */
export const AGENT_SCOPES = Object.freeze({
  data: 'Edit public data connections and commands (no SQL or network execution)',
  code: 'Edit code, declarations and bookmarks',
  project: 'Create/import/replace projects, change metadata and undo/redo project history',
  designer: 'Edit forms, controls, menus and designer selection',
  files: 'Edit project virtual files, assets and resources (not the host disk)',
  debugger: 'Control execution, watches, stack frames and live code',
  runtime: 'Interact with running forms and runtime dialogs',
  workspace: 'Control editors, documents, docking, toolbars and appearance'
});
export function agentScope(name) {
  // Classify effects, not just the UI surface that exposes an operation.
  if (name === 'vb6.editor.edit') return 'code';
  if (name === 'vb6.history.apply') return 'project';
  if (name === 'vb6.runtime.capture') return 'files';
  const part = name.split('.')[1];
  if (['module','code','procedure','bookmarks'].includes(part)) return 'code';
  if (['form','control','menu','designer'].includes(part)) return 'designer';
  if (['files','assets','resources','appSettings'].includes(part)) return 'files';
  if (['debug','breakpoints','watches'].includes(part)) return 'debugger';
  if (part === 'data') return 'data';
  if (part === 'runtime') return 'runtime';
  if (['project','references'].includes(part)) return 'project';
  return 'workspace';
}
export class AgentPermissions {
  constructor({now = () => Date.now(), changed = () => {}} = {}) {
    this.policy = null; this.now = now; this.changed = changed; this.grant = null; this.timer = null; this.controller = null;
  }
  allow(projectId, scopes, minutes = 10) {
    if (typeof projectId !== 'string' || !projectId || !Array.isArray(scopes) || !scopes.length || scopes.some(s => !Object.hasOwn(AGENT_SCOPES, s)) || !Number.isInteger(minutes) || minutes < 1 || minutes > 60)
      throw new McpError(-32602, 'Choose known permission scopes and a duration from 1 to 60 minutes.');
    this.revoke();
    this.controller = new AbortController();
    this.grant = {projectId, scopes: [...new Set(scopes)], expiresAt: this.now() + minutes * 60000};
    this.timer = setTimeout(() => this.revoke(), minutes * 60000); this.timer.unref?.();
    this.changed(); return this.snapshot(projectId);
  }
  permits(name, projectId) {
    return !!this.grant && this.grant.projectId === projectId && this.now() < this.grant.expiresAt && this.grant.scopes.includes(agentScope(name));
  }
  // Optional in-process coding-agent policy. Independent MCP adapters keep legacy scope behavior.
  usePolicy(policy) { this.revoke(); this.policy = policy; }
  get signal() { return this.policy?.signal || this.controller?.signal; }
  snapshot(projectId) {
    if (this.policy) return this.policy.snapshot(projectId);
    const active = !!this.grant && this.grant.projectId === projectId && this.now() < this.grant.expiresAt;
    return {active, scopes: active ? [...this.grant.scopes] : [], expiresAt: active ? this.grant.expiresAt : null};
  }
  revoke() {
    const policy = this.policy; this.policy = null; policy?.revoke();
    clearTimeout(this.timer); this.timer = null; const had = !!this.grant; this.grant = null;
    this.controller?.abort(); this.controller = null; if (had) this.changed();
  }
  dispose() { this.revoke(); }
}
