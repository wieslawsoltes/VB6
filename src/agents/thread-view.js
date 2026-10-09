import {el} from '../core/core.js';
// Weak keys release view preferences with the in-memory task; never serialize them.
const readingStates = new WeakMap();
let richFactory=null;
export function configureThreadUI(factory){richFactory=factory;}
const STATES = {waiting: 'Waiting for response…', streaming: 'Responding…', running: 'Running…', approval: 'Waiting for your approval', complete: 'Completed', error: 'Failed', denied: 'Denied', interrupted: 'Interrupted'};
const write = (node, text) => { if (node.textContent !== text) node.textContent = text; };
async function copyText(root, text, announce) {
  const doc = root.ownerDocument, win = doc.defaultView, active = doc.activeElement;
  try {
    if (win.navigator.clipboard?.writeText) await win.navigator.clipboard.writeText(text);
    else throw new Error('Clipboard API unavailable');
    announce('Copied.');
  } catch {
    const selection = win.getSelection(), ranges = selection ? Array.from({length: selection.rangeCount}, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
    const area = el('textarea', {class: 'agent-copy-buffer', readonly: true, 'aria-label': 'Copy text'});
    area.value = text; root.append(area); area.select();
    let copied = false;
    try { copied = !!doc.execCommand?.('copy'); } catch {} finally { area.remove(); active?.focus({preventScroll: true}); if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); } }
    announce(copied ? 'Copied.' : 'Copy unavailable. Select the text and use your browser’s Copy command.');
  }
}
function inline(node, text, budget) {
  // Intentionally small text-only Markdown subset: no HTML, images, embeds or script URLs.
  const pattern = /(`[^`\n]+`|\*\*[^*\n]+\*\*|\[[^\[\]\n]+\]\([^\s()[\]]+\))/g;
  let end = 0;
  for (const match of text.matchAll(pattern)) {
    if (--budget.left < 0) break;
    node.append(text.slice(end, match.index)); const value = match[0];
    if (value.startsWith('`')) node.append(el('code', {}, value.slice(1, -1)));
    else if (value.startsWith('**')) node.append(el('strong', {}, value.slice(2, -2)));
    else {
      const split = value.indexOf(']('), label = value.slice(1, split), href = value.slice(split + 2, -1);
      let safe = false; try { const url = new URL(href); safe = ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password; } catch {}
      node.append(safe ? el('a', {href, target: '_blank', rel: 'noopener noreferrer'}, label) : value);
    }
    end = match.index + value.length;
  }
  node.append(text.slice(end));
}
function markdown(node, text, root, announce) {
  node.replaceChildren(); const lines = text.split('\n'), budget = {left: 500};
  for (let i = 0; i < lines.length;) {
    // Very large/pathological replies fall back to literal text, not unbounded DOM.
    if (--budget.left < 0) { node.append(el('pre', {class: 'agent-plain-tail', tabindex: 0}, lines.slice(i).join('\n'))); break; }
    const fence = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (fence) {
      const language = fence[2].trim().slice(0, 40), code = []; i++;
      const close = new RegExp('^\\s*' + fence[1][0] + '{' + fence[1].length + ',}\\s*$');
      while (i < lines.length && !close.test(lines[i])) code.push(lines[i++]);
      if (i < lines.length) i++;
      const value = code.join('\n'), copy = el('button', {type: 'button', 'aria-label': 'Copy code', onclick: () => copyText(root, value, announce)}, 'Copy');
      node.append(el('div', {class: 'agent-code-block'}, el('div', {class: 'agent-code-heading'}, el('span', {}, language || 'Code'), copy), el('pre', {tabindex: 0}, el('code', {}, value))));
    } else if (!lines[i].trim()) i++;
    else if (/^#{1,3}\s/.test(lines[i])) { const title = el('h4'); inline(title, lines[i++].replace(/^#{1,3}\s+/, ''), budget); node.append(title); }
    else if (/^\s*(?:[-*]|\d+[.)])\s+/.test(lines[i])) {
      const ordered = /^\s*\d/.test(lines[i]), list = el(ordered ? 'ol' : 'ul');
      const pattern = ordered ? /^\s*\d+[.)]\s+/ : /^\s*[-*]\s+/;
      while (i < lines.length && pattern.test(lines[i]) && budget.left-- > 0) { const li = el('li'); inline(li, lines[i++].replace(pattern, ''), budget); list.append(li); }
      node.append(list);
    } else {
      const paragraph = [lines[i++]];
      while (i < lines.length && lines[i].trim() && !/^\s*(`{3,}|~{3,}|#{1,3}\s|[-*]\s|\d+[.)]\s)/.test(lines[i])) paragraph.push(lines[i++]);
      const p = el('p'); inline(p, paragraph.join('\n'), budget); node.append(p);
    }
  }
}
/** Keyed updates preserve old replies, selection, expanded tool details and the reader's position. */
export class AgentThreadView {
  constructor({announce = () => {}} = {}) {
    this.announce = announce; this.nodes = new Map(); this.follow = true; this.windowSize = 150; this.version = -1; this.savedTop = 0; this.expanded = new Set();
    this.root = el('div', {class: 'agent-thread-view'});
    this.scroller = el('div', {class: 'agent-conversation', tabindex: 0, role: 'log', 'aria-label': 'Agent conversation', 'aria-live': 'off'});
    this.omission = el('div', {class: 'agent-thread-notice'});
    this.older = el('button', {type: 'button', onclick: () => { this.follow = false; this.visibleEnd = this.lastEnd; this.windowSize = Math.min(this.thread.maxEntries, this.windowSize + 100); this.version = -1; this.update(this.thread, this.options); }}, 'Show earlier messages');
    this.list = el('div', {class: 'agent-thread-messages'});
    this.empty = el('div', {class: 'agent-thread-empty'}, el('strong', {}, 'Start a coding conversation'), el('p', {}, 'Ask about your code, describe an edit, or investigate a debugger issue. Replies and tool progress appear here. Changes still require the permissions you choose.'));
    this.jump = el('button', {type: 'button', class: 'agent-jump-latest', hidden: true, onclick: () => { this.follow = true; this.visibleEnd = null; this.version = -1; this.update(this.thread, this.options); }}, 'Jump to latest');
    this.scroller.append(this.omission, this.older, this.empty, this.list); this.root.append(this.scroller, this.jump);
    this.scroller.addEventListener('scroll', () => {
      // Hidden tabs have no geometry; they must not change the reader's follow preference.
      if (!this.scroller.clientHeight) return;
      const following = this.follow;
      this.savedTop = this.scroller.scrollTop;
      this.follow = this.scroller.scrollHeight - this.scroller.scrollTop - this.scroller.clientHeight <= 32;
      this.visibleEnd = this.follow ? null : this.lastEnd;
      // Reaching the end of an older frozen window must display newer entries
      // NOW, even if generation has finished and no further event will arrive.
      if (this.follow && !following) { this.version = -1; this.update(this.thread, this.options); }
      this.jump.hidden = this.follow;
      this.remember();
    });
    if (globalThis.ResizeObserver) { this.resize = new ResizeObserver(() => {
      if (this.scroller.clientHeight) this.scroller.scrollTop = this.follow ? this.scroller.scrollHeight : this.savedTop;
    }); this.resize.observe(this.scroller); }
  }
  remember() {
    if (!this.thread) return;
    for (const [id, record] of this.nodes) if (record.node.tagName === 'DETAILS') {
      if (record.node.open) this.expanded.add(id); else this.expanded.delete(id);
    }
    readingStates.set(this.thread, {follow: this.follow, visibleEnd: this.visibleEnd, windowSize: this.windowSize,
      top: this.savedTop, expanded: [...this.expanded]});
  }
  create(item) {
    const node = el(item.kind === 'tool' ? 'details' : 'article', {class: 'agent-thread-entry agent-' + item.kind, 'data-entry-id': item.id});
    const heading = el(item.kind === 'tool' ? 'summary' : 'header', {class: 'agent-message-heading'});
    const label = el('strong'), state = el('span', {class: 'agent-message-state'}); heading.append(label, state);
    const body = el('div', {class: 'agent-message-body'}), note = el('div', {class: 'agent-message-note'});
    const record = {node, heading, label, state, body, note, version: -1, text: ''};
    if (['user', 'assistant', 'question'].includes(item.kind)) {
      const copy = el('button', {type: 'button', class: 'agent-message-copy', 'aria-label': 'Copy message', onclick: () => copyText(this.root, record.text, this.announce)}, 'Copy');
      heading.append(copy); record.copy = copy;
    }
    node.append(heading, body, note); this.nodes.set(item.id, record);
    if (item.kind === 'tool') {
      node.open = this.expanded.has(item.id);
      node.addEventListener('toggle', () => { if (this.nodes.get(item.id) === record) this.remember(); });
    }
    return record;
  }
  renderItem(item) {
    const record = this.nodes.get(item.id) || this.create(item);
    if (record.version === item.revision) return record;
    record.version = item.revision; record.node.dataset.status = item.status;
    write(record.label, item.kind === 'tool' ? item.text : item.label || ({assistant: 'Agent', question: 'Agent question', plan: 'Task plan', notice: 'Status'})[item.kind] || 'You');
    write(record.state, STATES[item.status] || '');
    const interactive=item.kind==='assistant'&&this.rich?.renderAssistant(item,record);
    if (item.kind === 'tool') {
      if (record.arguments !== item.arguments) {
        if (!record.args) { record.args = el('pre', {tabindex: 0}); record.body.append(el('strong', {}, 'Arguments'), record.args); }
        write(record.args, item.arguments || '{}'); record.arguments = item.arguments;
      }
      if (record.result !== item.result) {
        if (!record.output) { record.output = el('pre', {tabindex: 0}); record.body.append(el('strong', {}, 'Result'), record.output); }
        write(record.output, item.result || ''); record.result = item.result;
      }
      this.rich?.renderTool(item,record);
    } else if(interactive){record.stream=null;record.formatted=true;record.body.classList.remove('is-streaming');
    } else if (item.kind === 'assistant' && ['waiting', 'streaming'].includes(item.status)) {
      if (!record.stream) { record.body.replaceChildren(); record.stream = record.body.ownerDocument.createTextNode(''); record.body.append(record.stream); record.text = ''; }
      if (item.text.startsWith(record.text)) record.stream.appendData(item.text.slice(record.text.length)); else record.stream.data = item.text;
      record.body.classList.add('is-streaming'); record.formatted = false;
    } else if (record.text !== item.text || !record.formatted) {
      record.stream = null; record.body.classList.remove('is-streaming');
      if (['user', 'assistant', 'question'].includes(item.kind)) markdown(record.body, item.text, this.root, this.announce);
      else write(record.body, item.text);
      record.formatted = true;
    }
    record.text = item.text; if (record.copy) record.copy.hidden = !item.text;
    const note = (item.truncated ? 'Public message preview truncated; provider context is kept separately. ' : '') + (item.note || '');
    write(record.note, note); record.note.hidden = !note;
    return record;
  }
  update(thread, options = {}) {
    if (!thread) return;
    if(!this.rich&&richFactory)this.rich=richFactory(this,(node,text)=>markdown(node,text,this.root,this.announce));
    const switched = this.thread !== thread || this.taskId !== options.taskId;
    if (switched) {
      this.remember();this.rich?.clear();
      const saved = readingStates.get(thread);
      this.taskId = options.taskId; this.nodes.clear(); this.list.replaceChildren();
      this.follow = saved?.follow ?? true; this.visibleEnd = saved?.visibleEnd ?? null;
      this.savedTop = saved?.top || 0; this.windowSize = saved?.windowSize || 150;
      this.expanded = new Set(saved?.expanded || []); this.version = -1;
    }
    this.thread = thread; this.options = options;
    this.scroller.setAttribute('aria-busy', String(!!options.busy));
    if (this.version === thread.revision) return;
    this.version = thread.revision;
    let end = this.follow || !this.visibleEnd ? thread.entries.length : thread.entries.findIndex(item => item.id === this.visibleEnd) + 1;
    if (end < 1) end = thread.entries.length;
    const start = Math.max(0, end - this.windowSize), items = thread.entries.slice(start, end);
    const visible = this.scroller.clientHeight > 0;
    const top = switched || !visible ? this.savedTop : this.scroller.scrollTop;
    const topEdge = this.scroller.getBoundingClientRect().top + this.scroller.clientTop;
    const anchor = !switched && visible ? [...this.list.children].find(node => node.getBoundingClientRect().bottom > topEdge) : null;
    const offset = anchor ? anchor.getBoundingClientRect().top : 0;
    write(this.omission, thread.omitted ? `${thread.omitted} earlier entries were omitted from this bounded public thread. Native context and project edits are unaffected.` : '');
    this.omission.hidden = !thread.omitted; this.older.hidden = start === 0; this.empty.hidden = !!thread.entries.length;
    const retained = new Set(items.map(item => item.id)), existing = new Set(thread.entries.map(item => item.id));
    for (const id of this.expanded) if (!existing.has(id)) this.expanded.delete(id);
    for (const [id, record] of this.nodes) if (!retained.has(id)) {
      if (existing.has(id) && record.node.open) this.expanded.add(id);
      this.rich?.remove(id);record.node.remove(); this.nodes.delete(id);
    }
    let previous = null;
    for (const item of items) {
      const record = this.renderItem(item), expected = previous ? previous.nextSibling : this.list.firstChild;
      if (record.node !== expected) this.list.insertBefore(record.node, expected);
      previous = record.node;
    }
    this.lastEnd = items.at(-1)?.id; this.jump.hidden = this.follow;
    write(this.jump, 'Jump to latest' + (thread.entries.length > end ? ' (' + (thread.entries.length - end) + ' new)' : ''));
    if (visible) {
      if (this.follow) this.scroller.scrollTop = this.scroller.scrollHeight;
      else if (anchor?.isConnected) this.scroller.scrollTop = top + anchor.getBoundingClientRect().top - offset;
      else this.scroller.scrollTop = top;
      this.savedTop = this.scroller.scrollTop;
    }
    this.remember();
  }
  dispose() { this.rich?.dispose();this.remember(); this.resize?.disconnect(); this.nodes.clear(); }
}
