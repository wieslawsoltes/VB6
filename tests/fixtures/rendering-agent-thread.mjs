import {AgentThread} from '../../src/agents/thread.js';
import {AgentThreadView} from '../../src/agents/thread-view.js';

// Use the actual keyed transcript, Markdown and tool-result view. No provider,
// credentials, network requests or project edits are involved in this fixture.
export function mount() {
  const thread = new AgentThread(), view = new AgentThreadView();
  document.body.append(view.root);
  for (let i = 0; i < 8; i++) {
    const requestId = 'fixture-' + i, callId = 'inspect-' + i;
    thread.apply({type: 'assistant', requestId, text: 'Prepared 1 tool operation(s).'});
    thread.apply({type: 'tool', requestId, callId, text: 'vb6.runtime.inspect ' + i,
      arguments: {form: 'TreeGridDemo', rows: [11, 28], description: 'Collapsed arguments must not be painted.'}});
    thread.apply({type: 'result', requestId, callId, result: {rows: Array.from({length: 28}, (_, j) =>
      ({name: j + ' Budget 2025.xlsx', type: 'Excel file', size: '24 KB', folder: 'Projects/TreeGridDemo'}))}});
  }
  thread.apply({type: 'assistant', requestId: 'validation', text:
    '**Validation:** The project compiled with no diagnostics. Expand All showed 47 visible nodes; scrolling displayed rows 11–28; Collapse All returned the tree to 3 visible nodes.\n\n' +
    '**Implementation note:** This is a VB6 demo using a ListBox to render fixed-width text columns. The filesystem entries are sample data, not a live filesystem listing.\n\n' +
    '```vb\nPrivate Sub Form_Load()\n    Debug.Print "' + 'TreeGridDemo row '.repeat(16) + '"\nEnd Sub\n```'});
  thread.apply({type: 'complete', text: 'Task completed.'});
  view.update(thread, {taskId: 'rendering-regression'});
  view.follow = false; view.savedTop = 0; view.scroller.scrollTop = 0;
  const tools = () => [...view.list.querySelectorAll('details.agent-tool')];
  let removed = [];
  return {
    view, thread, tools,
    // Equivalent visible DOM is an independent same-backend pixel oracle even
    // for optional atlas text, whose antialiasing need not match native HTML.
    detachHidden() {
      removed = tools().filter(node => !node.open).map(node => {
        const children = [...node.childNodes].filter(child => child !== node.querySelector(':scope > summary'));
        for (const child of children) child.remove();
        return {node, children};
      });
    },
    restoreHidden() { for (const {node, children} of removed) node.append(...children); removed = []; },
    stream() {
      thread.apply({type: 'delta', requestId: 'stream', text: 'Streaming reply with **formatted text** and a retained reader position.'});
      view.update(thread, {taskId: 'rendering-regression', busy: true});
    },
    complete() {
      thread.apply({type: 'response', requestId: 'stream', text: ''});
      view.update(thread, {taskId: 'rendering-regression'});
    },
    // Rounded native ancestors previously scanned thousands of hidden nodes
    // and punched a viewport-sized hole when their traversal budget was hit.
    nativeOverflow() {
      const tool = tools()[1]; tool.style.borderRadius = '4px';
      const nested = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = 'Nested collapsed result'; nested.append(summary);
      const hidden = document.createElement('div');
      for (let i = 0; i < 2100; i++) { const child = document.createElement('span'); child.textContent = 'hidden'; hidden.append(child); }
      nested.append(hidden); tool.querySelector('.agent-message-body').append(nested);
      tool.open = true;
      return {tool, nested, hidden};
    }
  };
}

export function audit(renderer) {
  const reads = {hiddenGeometry: 0, hiddenText: 0};
  const hidden = node => {
    for (let child = node.nodeType === 1 ? node : node.parentElement; child?.parentElement; child = child.parentElement) {
      const parent = child.parentElement;
      if (parent.tagName === 'DETAILS' && !parent.open &&
          child !== [...parent.children].find(n => n.tagName === 'SUMMARY')) return true;
    }
    return false;
  };
  for (const [method, key] of [['rect', 'hiddenGeometry'], ['text', 'hiddenText']]) {
    const original = renderer.adapter[method];
    renderer.adapter[method] = function(node, ...args) {
      if (hidden(node)) reads[key]++;
      return original.call(this, node, ...args);
    };
  }
  return reads;
}
