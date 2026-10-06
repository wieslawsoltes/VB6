/** Public, bounded presentation state. Opaque native provider histories never enter this model. */
export class AgentThread {
  constructor({maxEntries = 1200, maxCharacters = 4000000, maxMessageCharacters = 262144} = {}) {
    for (const value of [maxEntries, maxCharacters, maxMessageCharacters]) if (!Number.isSafeInteger(value) || value < 1) throw new Error('Invalid thread bound.');
    this.maxEntries = maxEntries; this.maxCharacters = maxCharacters; this.maxMessageCharacters = maxMessageCharacters;
    this.entries = []; this.index = new Map(); this.revision = 0; this.characters = 0; this.omitted = 0; this.sequence = 0; this.requestId = '';
  }
  entry(id, kind, event) {
    let item = this.index.get(id);
    if (!item) {
      item = {id, kind, text: '', status: '', time: event.time, revision: 0, size: 0};
      this.index.set(id, item); this.entries.push(item);
    }
    return item;
  }
  change(item, values) {
    this.characters -= item.size;
    Object.assign(item, values);
    let available = Math.max(0, this.maxCharacters - 256);
    for (const key of ['text', 'note', 'arguments', 'result']) if (typeof item[key] === 'string') {
      const limit = Math.min(this.maxMessageCharacters, available);
      if (item[key].length > limit) { item[key] = item[key].slice(0, limit); item.truncated = true; }
      available -= item[key].length;
    }
    item.size = item.text.length + (item.arguments?.length || 0) + (item.result?.length || 0) + (item.note?.length || 0) + Math.min(256, this.maxCharacters);
    this.characters += item.size; item.revision++; this.revision++;
    while (this.entries.length > this.maxEntries || this.characters > this.maxCharacters && this.entries.length > 1) {
      const old = this.entries.shift(); this.index.delete(old.id); this.characters -= old.size; this.omitted++;
    }
  }
  apply(event) {
    const {type, text = ''} = event, serial = ++this.sequence;
    const request = event.requestId || this.requestId || 'unassigned';
    const responseId = 'response:' + request;
    const toolId = 'tool:' + request + ':' + (event.callId || 'unassigned');
    const message = (kind, values = {}) => this.change(this.entry('event:' + serial, kind, event), {text, ...values});
    if (type === 'status') {
      this.requestId = request;
      this.change(this.entry(responseId, 'assistant', event), {status: 'waiting', note: text});
    } else if (type === 'delta') {
      const item = this.entry(responseId, 'assistant', event);
      // Saturate the public preview without disturbing provider-native continuation data.
      const remaining = Math.max(0, this.maxMessageCharacters - item.text.length);
      this.change(item, {text: item.text + text.slice(0, remaining), truncated: item.truncated || text.length > remaining, status: 'streaming'});
    } else if (type === 'assistant') {
      this.change(this.entry(responseId, 'assistant', event), {text, status: 'complete'});
    } else if (type === 'response') {
      const item = this.entry(responseId, 'assistant', event);
      this.change(item, {status: 'complete', note: text});
    } else if (type === 'tool') {
      this.change(this.entry(toolId, 'tool', event), {text, status: 'running', arguments: JSON.stringify(event.arguments ?? {}, null, 2)});
    } else if (type === 'result') {
      const item = this.index.get(toolId);
      if (item) this.change(item, {status: event.result?.error ? 'error' : 'complete', result: JSON.stringify(event.result ?? {}, null, 2), note: text});
      else message('notice');
    } else if (type === 'approval' || type === 'approval-result') {
      const item = this.index.get(toolId);
      if (item) this.change(item, {status: type === 'approval' ? 'approval' : event.allowed ? 'running' : 'denied', note: text});
      else message('notice');
    } else if (type === 'user' || type === 'answer') message('user', {label: type === 'answer' ? 'Your answer' : 'You'});
    else if (type === 'question') message('question');
    else if (type === 'plan') message('plan', {text: text + (event.plan?.steps ? '\n' + event.plan.steps.map(step => step.status + ': ' + step.title).join('\n') : ''), note: 'Model-reported plan, not independent validation evidence.'});
    else if (type === 'error') {
      const tool = event.callId && this.index.get(toolId);
      if (tool) { this.change(tool, {status: tool.status === 'denied' ? 'denied' : 'error', note: text}); message('notice', {status: 'error'}); }
      else {
        const item = this.index.get(responseId);
        if (item && ['waiting', 'streaming'].includes(item.status)) this.change(item, {status: 'interrupted', note: 'Partial response — not a completed answer.'});
        message('notice', {status: 'error'});
      }
    } else if ((['limit', 'retry', 'retrying', 'compacting', 'compacted', 'resume', 'complete', 'usage-warning'].includes(type) || type === 'permission' && ['deny', 'approve-run', 'revoke-tool'].includes(event.permission?.action))) message('notice', {status: type});
    else if (type === 'idle') {
      for (const item of [...this.entries]) if (this.index.has(item.id) && ['waiting', 'streaming', 'running', 'approval'].includes(item.status))
        this.change(item, {status: 'interrupted', note: item.kind === 'tool' ? 'Stopped before a confirmed result. Inspect the project before retrying.' : 'Partial response — not a completed answer.'});
    }
  }
  snapshot() {
    return {omitted: this.omitted, entries: this.entries.map(({size, revision, ...item}) => ({...item}))};
  }
}
