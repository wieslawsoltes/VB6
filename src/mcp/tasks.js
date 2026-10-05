import {McpError, MCP_META, MCP_LIMIT, isRecord, randomToken, utf8Length, errorResponse} from './protocol.js';

export const TASK_EXTENSION = MCP_META + 'tasks';
export function requireTasks(params) {
  if (!isRecord(params._meta?.[MCP_META + 'clientCapabilities']?.extensions?.[TASK_EXTENSION]))
    throw new McpError(-32021, 'Missing required client capability.', {requiredCapabilities: {extensions: {[TASK_EXTENSION]: {}}}});
}
/** Bounded, ephemeral tasks. Auth identity is supplied by the transport, never clientInfo. */
export class McpTasks {
  constructor({now = () => Date.now(), ttlMs = 120000, limit = 32, changed = () => {}} = {}) {
    this.now = now; this.ttlMs = ttlMs; this.limit = limit; this.changed = changed; this.entries = new Map();
  }
  principal(ctx) { return ctx.principal || ctx.sessionKey; }
  purge() {
    for (const [id, entry] of this.entries) if (this.now() >= entry.expiresAt) this.remove(id);
  }
  remove(id) {
    const entry = this.entries.get(id); if (!entry) return;
    this.entries.delete(id); clearTimeout(entry.timer); entry.authority?.removeEventListener('abort', entry.revoke); entry.controller.abort();
  }
  clear(principal) {
    for (const [id, entry] of this.entries) if (principal === undefined || entry.principal === principal) this.remove(id);
  }
  create(run, ctx, authority) {
    this.purge();
    if (this.entries.size >= this.limit) throw new McpError(-32000, 'Too many retained tasks; retry after task expiry.');
    const principal = this.principal(ctx); if (!principal) throw new McpError(-32602, 'A transport identity is required for tasks.');
    if (authority?.aborted || ctx.signal?.aborted) throw new McpError(-32800, 'Request cancelled.');
    const taskId = randomToken(24), createdAt = new Date(this.now()).toISOString(), controller = new AbortController();
    const entry = {principal, controller, authority, expiresAt: this.now() + this.ttlMs,
      task: {taskId, status: 'working', createdAt, lastUpdatedAt: createdAt, ttlMs: this.ttlMs, pollIntervalMs: 250}};
    entry.revoke = () => this.remove(taskId);
    entry.timer = setTimeout(entry.revoke, this.ttlMs); entry.timer.unref?.();
    this.entries.set(taskId, entry); authority?.addEventListener('abort', entry.revoke, {once: true});
    const settle = (status, value) => {
      if (this.entries.get(taskId) !== entry || entry.task.status !== 'working') return;
      entry.task = {...entry.task, status, lastUpdatedAt: new Date(this.now()).toISOString(), ...value};
      try { this.changed(entry.task, principal); } catch {}
    };
    // The task owns its lifetime after its handle is returned. Request HTTP close
    // must not cancel it; authority loss, TTL and tasks/cancel still do.
    Promise.resolve().then(() => run({...ctx, signal: controller.signal, emit: () => {}, notify: () => {}, reportProgress: () => {}, log: () => {}})).then(result => {
      if (utf8Length(JSON.stringify(result)) > MCP_LIMIT / 2) throw new McpError(-32603, 'Task result is too large.');
      settle('completed', {result});
    }).catch(error => settle(controller.signal.aborted ? 'cancelled' : 'failed', controller.signal.aborted ? {} : {error: errorResponse(null, error instanceof McpError && error.code === -32002 ? new McpError(-32602, error.message, error.data) : error).error}));
    return {resultType: 'task', ...entry.task};
  }
  find(id, ctx) {
    this.purge();
    const entry = typeof id === 'string' ? this.entries.get(id) : null;
    if (!entry || entry.principal !== this.principal(ctx)) throw new McpError(-32602, 'Task not found or expired.');
    return entry;
  }
  get(id, ctx) { return structuredClone(this.find(id, ctx).task); }
  cancel(id, ctx) {
    const entry = this.find(id, ctx);
    if (entry.task.status === 'working') {
      entry.task = {...entry.task, status: 'cancelled', lastUpdatedAt: new Date(this.now()).toISOString()};
      entry.controller.abort(); this.changed(entry.task, entry.principal);
    }
    return {};
  }
  update(id, responses, ctx) {
    this.find(id, ctx);
    if (!isRecord(responses)) throw new McpError(-32602, 'inputResponses must be an object.');
    // Current task-enabled tools never elicit. Unknown/stale input keys are ignored
    // per the extension. In particular inputResponses cannot approve IDE operations.
    return {};
  }
}
