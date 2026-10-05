import {McpError, MCP_META, MCP_LIMIT, isRecord, randomToken, utf8Length, errorResponse} from './protocol.js';

export const TASK_EXTENSION = MCP_META + 'tasks';
export function requireTasks(params) {
  if (!isRecord(params._meta?.[MCP_META + 'clientCapabilities']?.extensions?.[TASK_EXTENSION]))
    throw new McpError(-32021, 'Missing required client capability.', {requiredCapabilities: {extensions: {[TASK_EXTENSION]: {}}}});
}
/** Bounded, ephemeral tasks. Auth identity is supplied by the transport, never clientInfo. */
export class McpTasks {
  constructor({now = () => Date.now(), ttlMs = 120000, limit = 32, changed = () => {}} = {}) {
    this.now = now; this.ttlMs = ttlMs; this.limit = limit; this.changed = changed; this.entries = new Map(); this.observers = new Set();
  }
  onChange(fn) { this.observers.add(fn); return () => this.observers.delete(fn); }
  notify() { for (const fn of this.observers) { try { Promise.resolve(fn()).catch(() => {}); } catch {} } }
  statusChanged(entry) { try { Promise.resolve(this.changed(structuredClone(entry.task), entry.principal)).catch(() => {}); } catch {} this.notify(); }
  // Local owner tooling only: never advertise these methods as tasks/list or tools.
  inspect() {
    this.purge();
    return [...this.entries.values()].map(e => ({taskId:e.task.taskId, toolName:e.toolName,
      status:e.task.status, createdAt:e.task.createdAt, lastUpdatedAt:e.task.lastUpdatedAt, expiresAt:e.expiresAt}));
  }
  cancelLocal(id) { this.purge(); const entry=this.entries.get(id); if (!entry) return false; this.cancelEntry(entry); return true; }
  clearFinished() { for (const [id,e] of this.entries) if (['completed','failed','cancelled'].includes(e.task.status)) this.remove(id); }
  principal(ctx) { return ctx.principal || ctx.sessionKey; }
  purge() {
    for (const [id, entry] of this.entries) if (this.now() >= entry.expiresAt) this.remove(id);
  }
  remove(id) {
    const entry = this.entries.get(id); if (!entry) return;
    this.entries.delete(id); clearTimeout(entry.timer); entry.authority?.removeEventListener('abort', entry.revoke); entry.controller.abort(); this.notify();
  }
  clear(principal) {
    for (const [id, entry] of this.entries) if (principal === undefined || entry.principal === principal) this.remove(id);
  }
  create(run, ctx, authority, {toolName = 'Tool call'} = {}) {
    this.purge();
    if (this.entries.size >= this.limit) throw new McpError(-32000, 'Too many retained tasks; retry after task expiry.');
    const principal = this.principal(ctx); if (!principal) throw new McpError(-32602, 'A transport identity is required for tasks.');
    if (authority?.aborted || ctx.signal?.aborted) throw new McpError(-32800, 'Request cancelled.');
    const taskId = randomToken(24), createdAt = new Date(this.now()).toISOString(), controller = new AbortController();
    const entry = {principal, controller, authority, toolName:String(toolName).slice(0,200), expiresAt: this.now() + this.ttlMs,
      task: {taskId, status: 'working', createdAt, lastUpdatedAt: createdAt, ttlMs: this.ttlMs, pollIntervalMs: 250}};
    entry.revoke = () => this.remove(taskId);
    entry.timer = setTimeout(entry.revoke, this.ttlMs); entry.timer.unref?.();
    this.entries.set(taskId, entry); authority?.addEventListener('abort', entry.revoke, {once: true}); this.notify();
    const settle = (status, value) => {
      if (this.entries.get(taskId) !== entry || entry.task.status !== 'working') return;
      // A throttled/background tab may observe its absolute deadline before the
      // expiry timer runs. Never publish a result after authority has expired.
      if (this.now() >= entry.expiresAt) { this.remove(taskId); return; }
      entry.task = {...entry.task, status, lastUpdatedAt: new Date(this.now()).toISOString(), ...value};
      this.statusChanged(entry);
    };
    // The task owns its lifetime after its handle is returned. Request HTTP close
    // must not cancel it; authority loss, TTL and tasks/cancel still do.
    Promise.resolve().then(() => {
      // Revocation can happen before the queued callback starts. Do not invoke an
      // adapter at all once its handle has been cancelled, expired or removed.
      if (this.now() >= entry.expiresAt) this.remove(taskId);
      if (controller.signal.aborted || this.entries.get(taskId)!==entry || authority?.aborted) throw new McpError(-32800,'Task cancelled.');
      return run({...ctx, signal: controller.signal, emit: () => {}, notify: () => {}, reportProgress: () => {}, log: () => {}});
    }).then(result => {
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
  cancel(id, ctx) { this.cancelEntry(this.find(id, ctx)); return {}; }
  cancelEntry(entry) {
    if (entry.task.status === 'working') {
      entry.task = {...entry.task, status: 'cancelled', lastUpdatedAt: new Date(this.now()).toISOString()};
      entry.controller.abort(); this.statusChanged(entry);
    }
  }
  update(id, responses, ctx) {
    this.find(id, ctx);
    if (!isRecord(responses)) throw new McpError(-32602, 'inputResponses must be an object.');
    // Current task-enabled tools never elicit. Unknown/stale input keys are ignored
    // per the extension. In particular inputResponses cannot approve IDE operations.
    return {};
  }
}
