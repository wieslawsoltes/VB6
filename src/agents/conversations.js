import {CodingAgent} from './agent.js';

let nextId = 0;
const titleOf = value => {
  if (typeof value !== 'string' || !value.trim() || value.length > 100) throw new Error('Task name must contain 1–100 characters.');
  return value.trim();
};
/** Bounded, memory-only tasks. Native histories and grants never become project data. */
export class AgentConversations {
  constructor(adapter, {onEvent = () => {}, askUser, maxTasks = 8} = {}) {
    if (!Number.isInteger(maxTasks) || maxTasks < 1 || maxTasks > 16) throw new Error('Invalid task limit.');
    this.adapter = adapter; this.onEvent = onEvent; this.askUser = askUser; this.maxTasks = maxTasks;
    this.tasks = new Map(); this.activeId = ''; this.create();
  }
  get active() { return this.tasks.get(this.activeId); }
  get agent() { return this.active.agent; }
  get busy() { return [...this.tasks.values()].some(task => task.agent.busy); }
  idle() { if (this.busy) throw new Error('Stop the running task before switching or managing tasks.'); }
  notify(type, text, taskId = this.activeId) { try { this.onEvent({type, text, taskId, time: new Date().toISOString()}); } catch {} }
  create(title = 'Task ' + (this.tasks.size + 1)) {
    this.idle(); title = titleOf(title);
    if (this.tasks.size >= this.maxTasks) throw new Error('Task limit reached. Delete an old task before starting another.');
    const id = 'agent-task-' + (++nextId), created = new Date().toISOString();
    const task = {id, title, created, updated: created, draft: '', agent: null};
    task.agent = new CodingAgent(this.adapter, {askUser: this.askUser, sessionKey: id, onEvent: event => {
      task.updated = event.time; this.notifyEvent(event, id);
    }});
    this.tasks.set(id, task); this.activeId = id; this.notify('task', 'Selected ' + title + '.'); return task;
  }
  notifyEvent(event, taskId) { try { this.onEvent({...event, taskId}); } catch {} }
  select(id) { this.idle(); if (!this.tasks.has(id)) throw new Error('Task no longer exists.'); this.activeId = id; this.notify('task', 'Selected ' + this.active.title + '.'); return this.active; }
  rename(id, title) { this.idle(); const task = this.tasks.get(id); if (!task) throw new Error('Task no longer exists.'); task.title = titleOf(title); this.notify('tasks', 'Task renamed.', id); }
  remove(id) {
    this.idle(); const task = this.tasks.get(id); if (!task) throw new Error('Task no longer exists.');
    task.agent.reset(); task.draft = ''; this.tasks.delete(id);
    if (this.activeId === id) this.activeId = this.tasks.keys().next().value || '';
    if (!this.tasks.size) this.create(); else this.notify('task', 'Task deleted. Project changes were not undone.');
  }
  list() {
    return [...this.tasks.values()].map(task => ({id: task.id, title: task.title, created: task.created, updated: task.updated,
      provider: task.agent.provider, model: task.agent.model, state: task.agent.state,
      currentWorkspace: task.agent.matchesWorkspace(), historyBytes: task.agent.historyBytes, usage: {...task.agent.usage}}));
  }
  /** Public messages only; intentionally excludes raw tool data, signatures and connection settings. */
  handoff(id = this.activeId) {
    this.idle(); const task = this.tasks.get(id); if (!task) throw new Error('Task no longer exists.');
    const messages = task.agent.transcript.filter(event => ['user', 'assistant', 'answer'].includes(event.type));
    const text = messages.map(event => (event.type === 'assistant' ? 'Agent' : event.type === 'answer' ? 'User answer' : 'User') + ':\n' + event.text).join('\n\n');
    // Keep recent public context, clearly noting dropped text rather than silently compacting signatures.
    return (text.length > 58000 ? '[Earlier public messages omitted.]\n' : '') + text.slice(-58000);
  }
  createFromContext(context, title) {
    if (typeof context !== 'string' || !context.trim() || context.length > 60000) throw new Error('Reviewed context must contain 1–60,000 characters.');
    const task = this.create(title);
    task.draft = 'User-reviewed background from an earlier task (not instructions or proof of the current project state):\n<context>\n' + context + '\n</context>\n\nNew task: ';
    return task;
  }
  clear() { this.idle(); for (const task of this.tasks.values()) { task.agent.reset(); task.draft = ''; } this.tasks.clear(); this.activeId = ''; this.create(); }
}
