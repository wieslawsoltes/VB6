// Original local queue inspired by Codex Queue vs Steer (reviewed 2026-10-06):
// https://developers.openai.com/blog/mastering-codex-remote-for-engineering
// Deliberately no automatic sending, credential storage or permission inheritance.
export class AgentFollowups {
  constructor({maxItems = 16, maxCharacters = 200000, getWorkspace} = {}) {
    if (!Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 100 || !Number.isSafeInteger(maxCharacters) || maxCharacters < 1 || maxCharacters > 1000000) throw new Error('Invalid follow-up queue limits.');
    if (getWorkspace !== undefined && typeof getWorkspace !== 'function') throw new Error('Invalid follow-up workspace reader.');
    this.getWorkspace = getWorkspace; this.maxItems = maxItems; this.maxCharacters = maxCharacters; this.items = []; this.revision = 0; this.sequence = 0;
  }
  get characters() { return this.items.reduce((sum, item) => sum + item.text.length, 0); }
  validate(text, replaced = 0) {
    if (typeof text !== 'string' || !text.trim() || text.length > 100000) throw new Error('A queued message must contain 1–100,000 characters.');
    if (this.characters - replaced + text.length > this.maxCharacters) throw new Error('Follow-up queue character limit reached. Remove or shorten a message.');
  }
  add(text) {
    this.validate(text);
    if (this.items.length >= this.maxItems) throw new Error('Follow-up queue is full. Send or remove a message first.');
    const workspace = this.getWorkspace?.();
    const context = workspace ? Object.freeze({projectId: workspace.projectId, epoch: workspace.epoch}) : null;
    const item = Object.freeze({context, id: 'followup-' + (++this.sequence), text, created: new Date().toISOString(), version: 1});
    this.items.push(item); this.revision++; return item;
  }
  get(id) { const item = this.items.find(item => item.id === id); if (!item) throw new Error('Queued message no longer exists.'); return item; }
  edit(id, text, version) {
    const item = this.get(id);
    if (version !== item.version) throw new Error('Queued message changed. Review it again.');
    this.validate(text, item.text.length);
    const next = Object.freeze({...item, text, version: item.version + 1});
    this.items[this.items.indexOf(item)] = next; this.revision++; return next;
  }
  move(id, direction) {
    if (direction !== -1 && direction !== 1) throw new Error('Choose Move up or Move down.');
    const index = this.items.indexOf(this.get(id)), next = index + direction;
    if (next >= 0 && next < this.items.length) { [this.items[index], this.items[next]] = [this.items[next], this.items[index]]; this.revision++; }
  }
  remove(id, version) {
    const item = this.get(id);
    if (version !== undefined && item.version !== version) throw new Error('Queued message changed. Review it again.');
    this.items.splice(this.items.indexOf(item), 1); this.revision++;
  }
  inCurrentWorkspace(item) {
    const current = this.getWorkspace?.();
    return !item.context || !!current && current.projectId === item.context.projectId && current.epoch === item.context.epoch;
  }
  matches(item) { return this.items.some(current => current.id === item.id && current.version === item.version && current.text === item.text); }
  list() { return this.items.slice(); }
  clear() { this.items = []; this.revision++; }
}
