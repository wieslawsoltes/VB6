/** The engine supplies DOM for prompts. Adopt it into the editor's current
 * window so detached editors retain command history, IME and native input.
 */
export function openInputModePrompt(record, template, callback, options, notify) {
  const host = record.host, document = host.root.ownerDocument;
  const supplied = template?.nodeType ? template : document.createTextNode(String(template ?? ''));
  const input = supplied.querySelector?.('input');
  if (!input) return openInputModeNotification(record, template, {...options, duration: 0}, notify);
  record.closePrompt?.();
  const bar = document.createElement('div');
  bar.className = 'input-mode-commandline';
  bar.setAttribute('role', 'group'); bar.setAttribute('aria-label', 'Vim command line');
  input.classList.add('input-mode-command-input');
  input.setAttribute('aria-label', 'Vim command line');
  input.autocomplete = 'off'; input.spellcheck = false;
  // The upstream prefix/description can contain interactive controls (regex
  // dialect toggles). Moving these exact nodes preserves their event handlers.
  bar.append(supplied); host.root.append(bar);
  input.value = options.value ?? '';
  let closed = false;
  const close = value => {
    if (closed) return;
    if (typeof value === 'string') { input.value = value; return; }
    closed = true; bar.remove();
    if (record.closePrompt === close) record.closePrompt = null;
    invoke(() => options.onClose?.(bar));
    notify();
  };
  const invoke = fn => {
    if (record.run) return record.run(fn);
    record.busy++;
    try { return fn(); }
    finally { record.busy--; notify(); }
  };
  input.addEventListener('keydown', event => {
    // Keep command-line keys out of both the code editor and IDE shortcut maps.
    event.stopPropagation();
    if (event.isComposing || event.keyCode === 229) return;
    invoke(() => {
      if (options.onKeyDown?.(event, input.value, close) || event.defaultPrevented || closed) return;
      if (event.key === 'Escape') { event.preventDefault(); close(); host.focus(); return; }
      if (event.key === 'Enter' && options.closeOnEnter !== false) {
        event.preventDefault(); const value = input.value;
        close(); host.focus(); callback?.(value);
      }
    });
  });
  input.addEventListener('keyup', event => {
    event.stopPropagation();
    if (!closed && !event.isComposing) invoke(() => options.onKeyUp?.(event, input.value, close));
  });
  input.addEventListener('input', event => {
    if (!closed && !event.isComposing) invoke(() => options.onInput?.(event, input.value, close));
  });
  input.addEventListener('blur', event => {
    if (closed) return;
    invoke(() => options.onBlur?.(event, close));
    if (options.closeOnBlur === true) close();
  });
  record.closePrompt = close;
  input.focus();
  if (options.selectValueOnOpen === false) input.setSelectionRange(input.value.length, input.value.length); else input.select();
  notify(); return close;
}

export function openInputModeNotification(record, template, options = {}, notify = () => {}) {
  const document = record.host.root.ownerDocument, node = document.createElement('div');
  node.className = 'input-mode-notification'; node.setAttribute('role', 'status');
  node.textContent = template?.textContent ?? String(template ?? '');
  record.host.root.append(node);
  record.message = node.textContent;
  let closed = false, timer;
  const close = () => {
    if (closed) return; closed = true; clearTimeout(timer); node.remove();
    record.notifications?.delete(close);
    if (record.message === node.textContent) record.message = '';
    notify();
  };
  record.notifications?.add(close);
  if (options.duration !== 0) timer = setTimeout(close, options.duration ?? 5000);
  notify(); return close;
}
