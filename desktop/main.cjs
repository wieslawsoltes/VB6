'use strict';
const { app, BrowserWindow, protocol, ipcMain, screen, Menu, dialog, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { ORIGIN, MAX_WINDOWS, CSP, integer, text, trustedURL, assetPath, clampBounds, windowOptions, menuTemplate } = require('./policy.cjs');
const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, 'manifest.json'), 'utf8'));
const webRoot = path.join(__dirname, 'web');
const records = new Map(), pending = new Map(), opening = new Map(), modalStack = [], runtimeDocuments = new Map();
let root, quitting = false;
const smoke = process.argv.includes('--native-smoke');
const smokeReport = process.env.VB6_SMOKE_REPORT;
if (smoke && process.env.VB6_SMOKE_SOFTWARE_GPU === '1') app.commandLine.appendSwitch('enable-unsafe-webgpu');
protocol.registerSchemesAsPrivileged([{ scheme: 'vb6', privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
// Normal production runs do not override GPU driver blocklists or disable Chromium's sandbox.
app.setName(manifest.name);
app.setPath('userData', path.join(app.getPath('appData'), manifest.appId));
const stateFile = () => path.join(app.getPath('userData'), 'native-window-state.json');
const preferences = { preload: path.join(__dirname, 'preload.cjs'), sandbox: true, contextIsolation: true,
  nodeIntegration: false, nodeIntegrationInWorker: false, webviewTag: false, webSecurity: true,
  backgroundThrottling: false, navigateOnDragDrop: false, safeDialogs: true };
function mainSender(event) {
  if (!root || root.isDestroyed() || event.sender !== root.webContents || event.senderFrame !== root.webContents.mainFrame || !trustedURL(event.senderFrame.url)) throw new Error('Unauthorized native bridge caller');
}
function getRecord(id) { const r = records.get(id); if (!r || r.window.isDestroyed()) throw new Error('Unknown native window'); return r; }
function emit(id, type, extra = {}) { if (root && !root.isDestroyed()) root.webContents.send('vb6:window-event', { id, type, ...extra }); }
function snapshot(win) { return { bounds: win.getBounds(), contentBounds: win.getContentBounds(), state: win.isMinimized() ? 1 : win.isMaximized() ? 2 : 0, focused: win.isFocused(), visible: win.isVisible() }; }
function updateModal() {
  for (let i = modalStack.length - 1; i >= 0; i--) if (!records.has(modalStack[i])) modalStack.splice(i, 1);
  const top = modalStack.at(-1);
  for (const [id, r] of records) if (!r.window.isDestroyed()) r.window.setEnabled(!top || id === top);
  if (root && !root.isDestroyed()) root.setEnabled(!top);
}
function secure(win) {
  const wc = win.webContents;
  wc.on('will-navigate', (event, url) => { if (win !== root || !trustedURL(url)) event.preventDefault(); });
  wc.on('will-frame-navigate', (event, details) => { const url = details?.url ?? event.url; if (url && !trustedURL(url) && !url.startsWith('blob:vb6://app/')) event.preventDefault(); });
  wc.on('will-attach-webview', event => event.preventDefault());
  wc.setWindowOpenHandler(({ url, frameName }) => {
    const reservation = pending.get(frameName);
    if (wc !== root?.webContents || url !== 'about:blank' || !reservation || reservation.expires < Date.now()) return { action: 'deny' };
    pending.delete(frameName); opening.set(frameName,reservation.kind);
    return { action: 'allow', outlivesOpener: false, overrideBrowserWindowOptions: { ...reservation.options, webPreferences: preferences } };
  });
  wc.on('did-create-window', (child, details) => { const kind = opening.get(details.frameName); opening.delete(details.frameName); register(details.frameName,child,kind); });
  wc.on('render-process-gone', (_event, details) => {
    if (!quitting) { dialog.showErrorBox('VB6 renderer stopped', details.reason); if (win === root) app.quit(); }
  });
}
function register(id, win, kind = 'form') {
  if (!/^vb6-[a-f0-9]{32}$/.test(id) || records.has(id)) { win.destroy(); return; }
  const r = { window: win, kind, forceClose: false, closePending: false, eventQueued: false };
  records.set(id, r); secure(win); win.setMenu(null);
  const changed = () => {
    if (r.eventQueued) return;
    r.eventQueued = true;
    setImmediate(() => { r.eventQueued = false; if (!win.isDestroyed()) emit(id, 'state', snapshot(win)); });
  };
  for (const type of ['move', 'resize', 'maximize', 'unmaximize', 'minimize', 'restore', 'show', 'hide', 'focus', 'blur']) win.on(type, changed);
  win.on('close', event => {
    if (quitting || r.forceClose) return;
    event.preventDefault();
    if (!r.closePending) { r.closePending = true; emit(id, 'close-request'); }
  });
  win.on('closed', () => { records.delete(id); updateModal(); emit(id, 'closed'); });
  updateModal();
}
ipcMain.on('vb6:prepare-window', (event, value) => {
  try {
    mainSender(event);
    for (const [id, r] of pending) if (r.expires < Date.now()) pending.delete(id);
    if (records.size + pending.size >= MAX_WINDOWS) throw new Error('Native window limit exceeded');
    const id = 'vb6-' + crypto.randomBytes(16).toString('hex');
    const kind = value?.kind || 'form';
    if (!['form','tool'].includes(kind) || kind === 'tool' && manifest.kind !== 'studio') throw new Error('Invalid native window role');
    pending.set(id, { kind, options: windowOptions(value, screen.getAllDisplays()), expires: Date.now() + 10000 });
    event.returnValue = { ok: true, id };
  } catch (error) { event.returnValue = { ok: false, error: error.message }; }
});
ipcMain.handle('vb6:runtime-document', (event, html) => {
  mainSender(event);
  if (manifest.kind !== 'studio' || typeof html !== 'string' || Buffer.byteLength(html) > 8 * 1024 * 1024) throw new Error('Invalid runtime preview');
  const document = html.replace(/\r\n?/g, '\n');
  const hashes = [...document.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script\s*>/gi)].map(m => "'sha256-" + crypto.createHash('sha256').update(m[1]).digest('base64') + "'");
  const csp = CSP.replace("script-src 'self'", "script-src 'self' " + hashes.join(' '));
  while (runtimeDocuments.size >= 4) runtimeDocuments.delete(runtimeDocuments.keys().next().value);
  const url = ORIGIN + '/preview/' + crypto.randomBytes(16).toString('hex');
  runtimeDocuments.set(url, { document, csp });
  return url;
});
ipcMain.handle('vb6:info', event => { mainSender(event); return { version: 1, name: manifest.name, kind: manifest.kind, graphics: manifest.graphics,
  platform: process.platform, arch: process.arch, electron: process.versions.electron,
  scripts: manifest.scripts, displays: screen.getAllDisplays().map(d => ({ id: d.id, workArea: d.workArea, scaleFactor: d.scaleFactor })) }; });
ipcMain.handle('vb6:window-command', (event, id, command, value) => {
  mainSender(event);
  if (id === 'controller') {
    if (command === 'hide' && manifest.kind === 'application') { root.hide(); return; }
    if (command === 'show') { root.show(); return; }
    if (command === 'quit') { app.quit(); return; }
    throw new Error('Unsupported controller command');
  }
  if (command === 'cancel-reservation') { pending.delete(id); return; }
  const r = getRecord(id), win = r.window;
  switch (command) {
    case 'show': win.show(); break;
    case 'hide': win.hide(); break;
    case 'focus': win.focus(); break;
    case 'title': win.setTitle(text(value)); break;
    case 'bounds': { const b = clampBounds(value, screen.getAllDisplays()); win.setPosition(b.x, b.y); win.setContentSize(b.width, b.height); break; }
    case 'state': {
      const state = integer(value, 0, 0, 2);
      if (state === 1) win.minimize(); else { if (win.isMinimized()) win.restore(); if (state === 2) win.maximize(); else win.unmaximize(); }
      break;
    }
    case 'always-on-top': if (typeof value !== 'boolean') throw new TypeError('Expected boolean'); win.setAlwaysOnTop(value); break;
    case 'fullscreen': if (typeof value !== 'boolean') throw new TypeError('Expected boolean'); win.setFullScreen(value); break;
    case 'modal': {
      const index = modalStack.indexOf(id); if (index >= 0) modalStack.splice(index, 1);
      if (value === true) { const owner = modalStack.at(-1); const parent = owner ? getRecord(owner).window : BrowserWindow.getFocusedWindow(); if (parent && parent !== win) win.setParentWindow(parent); modalStack.push(id); }
      else if (value !== false) throw new TypeError('Expected boolean');
      else win.setParentWindow(null);
      updateModal(); break;
    }
    case 'cancel-close': r.closePending = false; break;
    case 'destroy': r.forceClose = true; win.destroy(); return;
    case 'snapshot': break;
    default: throw new Error('Unsupported window command');
  }
  return snapshot(win);
});
ipcMain.handle('vb6:popup-menu', (event, id, items, position = {}) => {
  mainSender(event); const win = getRecord(id).window;
  return new Promise(resolve => {
    let selected = null;
    const menu = Menu.buildFromTemplate(menuTemplate(items, value => { selected = value; }));
    menu.popup({ window: win, x: integer(position.x, 0, 0, 100000), y: integer(position.y, 0, 0, 100000), callback: () => resolve(selected) });
  });
});
function dialogOwner() { const top = modalStack.at(-1); return top ? getRecord(top).window : BrowserWindow.getFocusedWindow() || root; }
ipcMain.handle('vb6:message-box', async (event, options = {}) => {
  mainSender(event);
  const buttons = options.buttons;
  if (!Array.isArray(buttons) || !buttons.length || buttons.length > 8) throw new Error('Invalid message buttons');
  const result = await dialog.showMessageBox(dialogOwner(), { title: text(options.title), message: text(options.message, '', 65536, true),
    buttons: buttons.map(b => text(b, '', 128)), defaultId: integer(options.defaultId, 0, 0, buttons.length - 1),
    cancelId: integer(options.cancelId, buttons.length - 1, 0, buttons.length - 1), noLink: true,
    type: ['none', 'info', 'error', 'question', 'warning'].includes(options.type) ? options.type : 'info' });
  return result.response;
});
let fileDialogActive = false;
ipcMain.handle('vb6:open-file', async (event, options = {}) => {
  mainSender(event); if (fileDialogActive) throw new Error('A file dialog is already open'); fileDialogActive = true;
  try {
    const result = await dialog.showOpenDialog(dialogOwner(), { title: text(options.title, 'Open'), properties: ['openFile'] });
    if (result.canceled) return null;
    const file = result.filePaths[0]; if (fs.statSync(file).size > 20 * 1024 * 1024) throw new Error('File exceeds 20 MiB');
    return { name: path.basename(file), bytes: new Uint8Array(fs.readFileSync(file)) };
  } finally { fileDialogActive = false; }
});
ipcMain.handle('vb6:save-file', async (event, name, bytes) => {
  mainSender(event); if (!(bytes instanceof Uint8Array) || bytes.byteLength > 20 * 1024 * 1024) throw new Error('Invalid file data');
  if (fileDialogActive) throw new Error('A file dialog is already open'); fileDialogActive = true;
  try {
    const result = await dialog.showSaveDialog(dialogOwner(), { defaultPath: path.basename(text(name, 'Export.dat', 240)) });
    if (result.canceled) return false;
    fs.writeFileSync(result.filePath, bytes); return true;
  } finally { fileDialogActive = false; }
});
app.on('before-quit', () => { quitting = true; });
app.on('window-all-closed', () => app.quit());
app.whenReady().then(async () => {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler(() => false);
  ses.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !trustedURL(details.url) && !/^(data:|blob:|about:blank$)/.test(details.url) }));
  protocol.handle('vb6', async request => {
    try {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 });
      const preview = runtimeDocuments.get(request.url);
      if (preview) return new Response(preview.document, { headers: { 'Content-Type': 'text/html; charset=utf-8', 'Content-Security-Policy': preview.csp, 'X-Content-Type-Options': 'nosniff' } });
      const file = assetPath(webRoot, request.url, manifest.files);
      const bytes = fs.readFileSync(file), name = path.relative(webRoot, file).split(path.sep).join('/');
      if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.files[name]) throw new Error('Asset integrity check failed');
      const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.ico': 'image/x-icon' }[path.extname(file)] || 'application/octet-stream';
      return new Response(bytes, { headers: { 'Content-Type': mime + '; charset=utf-8', 'Content-Security-Policy': CSP, 'X-Content-Type-Options': 'nosniff' } });
    } catch { return new Response('Asset unavailable', { status: 404 }); }
  });
  let saved = {};
  try { saved = JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch {}
  root = new BrowserWindow({ ...windowOptions({ width: 1280, height: 850, ...saved.bounds, title: manifest.name }, screen.getAllDisplays()), webPreferences: preferences });
  secure(root); root.setMenu(null);
  root.on('close', () => {
    try { fs.mkdirSync(path.dirname(stateFile()), { recursive: true }); fs.writeFileSync(stateFile() + '.tmp', JSON.stringify({ bounds: root.getNormalBounds(), maximized: root.isMaximized() })); fs.renameSync(stateFile() + '.tmp', stateFile()); } catch {}
  });
  await root.loadURL(ORIGIN + '/index.html');
  if (manifest.kind === 'studio') { root.show(); if (saved.maximized) root.maximize(); }
  if (smoke) {
    try { await require('./smoke.cjs').run({ app, root, records, manifest, reportPath: smokeReport }); }
    catch (error) { if (smokeReport) fs.writeFileSync(smokeReport, JSON.stringify({ ok: false, error: error.stack }, null, 2)); app.exit(1); }
  }
}).catch(error => { if (smokeReport) fs.writeFileSync(smokeReport, JSON.stringify({ ok: false, error: error.stack })); dialog.showErrorBox('VB6 startup failed', error.message); app.exit(1); });
