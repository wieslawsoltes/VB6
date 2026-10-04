/** Native Windows adapter. One VM owns all forms; same-origin windows retain DOM/event identity. */
export function installNativeHost(host, bridge = globalThis.vb6Native) {
  if (!bridge || bridge.version !== 1 || host.nativeWindows) return false;
  const document = host.container.ownerDocument, browser = document.defaultView;
  const forms = new Map(), dialogs = new Map();
  let disposed = false;
  const report = error => host.send('output', { text: 'Native window: ' + error.message, newline: true });
  const command = (id, name, value) => bridge.windowCommand(id, name, value).catch(report);
  function open(options) {
    const id = bridge.prepareWindow(options);
    const win = browser.open('about:blank', id, 'popup');
    if (!win) throw new Error('Native window creation was denied');
    const doc = win.document;
    for (const name of ['data-vb-theme', 'lang']) {
      const value = document.documentElement.getAttribute(name); if (value) doc.documentElement.setAttribute(name, value);
    }
    for (const node of document.querySelectorAll('style,link[rel="stylesheet"]')) doc.head.append(node.cloneNode(true));
    const style = doc.createElement('style');
    style.textContent = `html,body{margin:0;width:100%;height:100%;overflow:hidden;background:var(--vb-face,#c0c0c0)}
      .vb-form[data-native-window]{position:relative!important;inset:0!important;transform:none!important;border:0!important;box-shadow:none!important;width:100%!important;height:100%!important}
      .vb-form[data-native-window]:not([hidden]){display:flex!important;flex-direction:column}
      .vb-form[data-native-window]>.vb-form-title,.vb-form[data-native-window]>.vb-form-grip{display:none!important}
      .vb-form[data-native-window]>.vb-form-content{flex:1 1 auto;min-height:0;width:100%!important;height:0!important}
      .vb-form[data-native-window]>.vb-form-menu{flex:none}`;
    doc.head.append(style);
    return { id, win, doc };
  }
  function size(form) {
    const p = form.props;
    return { x: Number(p.Left || 0) / 15, y: Number(p.Top || 0) / 15,
      width: Math.max(96, Number(p.ClientWidth ?? p.Width ?? 9000) / 15),
      height: Math.max(64, Number(p.ClientHeight ?? p.Height ?? 6000) / 15 + (form.menuBar.hidden ? 0 : 19)) };
  }
  function attach(form) {
    if (form.MDIChild) return; // MDI children stay inside their native MDI parent, not independent taskbar windows.
    const record = { form, id: null, win: null, state: Number(form.props.WindowState) || 0, focused: false, applying: false };
    const refresh = form.refresh.bind(form), show = form.Show.bind(form), hide = form.Hide.bind(form), dispose = form.dispose.bind(form);
    form.movedByUser = true;
    form.nativeWindow = record;
    function sync() {
      if (!record.id || record.applying) return;
      const title = String(form.props.Caption || form.model.name), bounds = size(form), signature = JSON.stringify(bounds);
      if (title !== record.title) { record.title = title; record.win.document.title = title; command(record.id, 'title', title); }
      if (signature !== record.bounds && record.state === 0) { record.bounds = signature; command(record.id, 'bounds', bounds); }
    }
    function ensure() {
      if (record.id) return;
      Object.assign(record, open({ ...size(form), title: String(form.props.Caption || form.model.name),
        borderStyle: Number(form.props.BorderStyle ?? 2), minButton: form.props.MinButton !== 0,
        maxButton: form.props.MaxButton !== 0, controlBox: form.props.ControlBox !== 0 }));
      forms.set(record.id, record);
      form.node.setAttribute('data-native-window', record.id);
      record.doc.body.append(form.node);
      form.cancelWindowInteraction?.();
      record.doc.addEventListener('focusin', () => {
        if (form.shown && !record.focused) command(record.id, 'focus');
      });
      record.doc.addEventListener('keydown', event => { if (event.altKey && event.key === 'F4') { event.preventDefault(); requestClose(record); } });
      sync();
    }
    form.refresh = () => { refresh(); sync(); };
    form.Show = () => { ensure(); record.focused = true; show(); command(record.id, 'show'); command(record.id, 'state', record.state); command(record.id, 'focus'); };
    form.Hide = () => { hide(); if (record.id) { command(record.id, 'modal', false); command(record.id, 'hide'); } };
    Object.defineProperty(form, 'WindowState', { configurable: true, get: () => record.state, set: value => {
      value = Number(value); if (!Number.isInteger(value) || value < 0 || value > 2) throw new Error('Invalid WindowState');
      record.state = value; form.props.WindowState = value; if (record.id) command(record.id, 'state', value);
    } });
    form.toggleMinimize = () => { form.WindowState = record.state === 1 ? 0 : 1; };
    form.toggleMaximize = () => { form.WindowState = record.state === 2 ? 0 : 2; };
    form.showMenu = async (items, anchor, all) => {
      ensure();
      const map = entries => entries.filter(m => m.properties.Visible !== 0).map(m => m.properties.Caption === '-' ? null : {
        id: m.name, label: String(m.properties.Caption || m.name), enabled: m.properties.Enabled !== 0,
        checked: m.properties.Checked ? true : undefined,
        items: all.some(c => c.parent === m.name) ? map(all.filter(c => c.parent === m.name)) : undefined
      });
      try {
        const rect = anchor.getBoundingClientRect();
        const selected = await bridge.popupMenu(record.id, map(items), { x: rect.left, y: rect.bottom });
        if (selected && !form.disposed) await form.vm.dispatch(form.instance, selected + '_Click', []);
      } catch (error) { report(error); }
    };
    form.dispose = () => {
      if (form.disposed) return;
      if (record.id) { forms.delete(record.id); command(record.id, 'destroy'); }
      dispose();
    };
    record.ensure = ensure;
  }
  async function requestClose(record) {
    if (record.closing) return;
    record.closing = true;
    try { await host.vm.requestUnload(record.form.instance); }
    catch (error) { report(error); }
    finally {
      record.closing = false;
      if (record.id && !record.form.disposed) await command(record.id, 'cancel-close');
      // Unload releases the VB lifetime, not the reusable JS form object. Hide alone never exits.
      if (!record.form.instance.loaded && ![...host.vm.formInstances].some(instance => instance.loaded)) {
        setTimeout(() => { if (!disposed && ![...host.vm.formInstances].some(instance => instance.loaded)) command('controller', 'quit'); }, 0);
      }
    }
  }
  const unsubscribe = bridge.onWindowEvent(event => {
    if (disposed) return;
    const dialog = dialogs.get(event.id);
    if (dialog) { if (event.type === 'close-request' || event.type === 'closed') dialog.finish(''); return; }
    const record = forms.get(event.id); if (!record) return;
    if (event.type === 'close-request') { requestClose(record); return; }
    if (event.type === 'closed') { forms.delete(event.id); record.id = null; record.win = null; return; }
    if (event.type !== 'state') return;
    const form = record.form, previous = size(form), p = form.props;
    record.applying = true;
    record.state = event.state; p.WindowState = event.state;
    if (event.state !== 1) {
      p.Left = event.bounds.x * 15; p.Top = event.bounds.y * 15;
      p.ClientWidth = Math.max(1, event.contentBounds.width) * 15;
      p.ClientHeight = Math.max(1, event.contentBounds.height - (form.menuBar.hidden ? 0 : form.menuBar.offsetHeight || 19)) * 15;
      record.bounds = JSON.stringify(size(form)); form.refresh(); form.surface?.resize();
      host.mdi?.layout();
    }
    record.applying = false;
    if (event.focused) {
      const active = form.type === 'MDIForm' && form.mdiController?.active?.shown ? form.mdiController.active.instance : form.instance;
      host.vm.library.get('screen').ActiveForm = active;
    }
    if (event.focused !== record.focused) { record.focused = event.focused; form.event(event.focused ? 'Activate' : 'Deactivate'); }
    const current = size(form);
    if (current.width !== previous.width || current.height !== previous.height) form.event('Resize', [], true);
  });
  const createForm = host.createForm.bind(host);
  host.createForm = async (...args) => { const form = await createForm(...args); attach(form); return form; };
  const beginModal = host.beginModal.bind(host);
  host.beginModal = form => {
    const end = beginModal(form), record = form.nativeWindow;
    if (record) { record.ensure(); command(record.id, 'modal', true); }
    return () => { end(); if (record?.id && forms.has(record.id)) command(record.id, 'modal', false); };
  };
  host.msgBox = async (message, style = 0, title = host.project.name) => {
    const groups = [[['OK', 1]], [['OK', 1], ['Cancel', 2]], [['Abort', 3], ['Retry', 4], ['Ignore', 5]],
      [['Yes', 6], ['No', 7], ['Cancel', 2]], [['Yes', 6], ['No', 7]], [['Retry', 4], ['Cancel', 2]]];
    const buttons = groups[Number(style) & 7] || groups[0];
    const index = await bridge.messageBox({ title: String(title), message: String(message), buttons: buttons.map(b => b[0]),
      defaultId: Math.min(buttons.length - 1, (Number(style) >> 8) & 3), cancelId: buttons.some(b => b[1] === 2) ? buttons.findIndex(b => b[1] === 2) : buttons.length - 1,
      type: ({ 16: 'error', 32: 'question', 48: 'warning', 64: 'info' })[Number(style) & 112] || 'none' });
    return buttons[index]?.[1] ?? 2;
  };
  host.inputBox = (message, title = host.project.name, initial = '') => new Promise((resolve, reject) => {
    let record;
    try {
      record = open({ title: String(title), width: 460, height: 170, borderStyle: 3, minButton: false, maxButton: false });
      const doc = record.doc, cover = doc.createElement('form'), label = doc.createElement('label'), input = doc.createElement('input');
      const ok = doc.createElement('button'), cancel = doc.createElement('button');
      label.textContent = String(message); label.htmlFor = 'native-input'; input.id = 'native-input'; input.value = String(initial);
      ok.textContent = 'OK'; ok.type = 'submit'; cancel.textContent = 'Cancel'; cancel.type = 'button';
      cover.style.cssText = 'display:grid;gap:12px;padding:16px;font:14px sans-serif';
      cover.append(label, input, ok, cancel); doc.body.append(cover);
      let done = false;
      record.finish = value => { if (done) return; done = true; dialogs.delete(record.id); host.dialogs = host.dialogs.filter(d => d !== cover); command(record.id, 'destroy'); resolve(value); };
      cover.vbFinish = () => record.finish(''); host.dialogs.push(cover); dialogs.set(record.id, record);
      cover.addEventListener('submit', event => { event.preventDefault(); record.finish(input.value); });
      cancel.addEventListener('click', () => record.finish(''));
      doc.addEventListener('keydown', event => { if (event.key === 'Escape') record.finish(''); });
      command(record.id, 'modal', true); command(record.id, 'show'); input.focus(); input.select();
    } catch (error) { if (record?.id) command(record.id, 'destroy'); reject(error); }
  });
  host.modal = async (title, body, buttons = [{caption:'OK',value:1}], input = null, options = {}) => {
    if (input != null) return host.inputBox(body, title, input);
    const index = await bridge.messageBox({title:String(title),message:String(body),buttons:buttons.map(b=>String(b.caption)),
      defaultId:options.defaultIndex ?? 0,cancelId:buttons.length-1,type:'info'});
    return buttons[index]?.value;
  };
  host.openFile = props => bridge.openFile({ title: String(props?.DialogTitle || 'Open') });
  host.saveFile = (name, data) => bridge.saveFile(String(name), typeof data === 'string' ? new TextEncoder().encode(data) : new Uint8Array(data));
  const send = host.send.bind(host);
  host.send = (type, data) => { send(type, data); if (type === 'stopped' && !disposed) command('controller','quit'); };
  const start = host.start.bind(host);
  host.start = async () => { const result = await start(); if (!forms.size) await command('controller', 'show'); return result; };
  const dispose = host.dispose.bind(host);
  host.dispose = () => { if (disposed) return; disposed = true; dispose(); for (const d of dialogs.values()) d.finish(''); unsubscribe(); };
  host.nativeWindows = { forms, dialogs };
  return true;
}
