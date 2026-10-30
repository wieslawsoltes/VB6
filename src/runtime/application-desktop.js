import {el, download} from '../core/dom.js';
import {safeName} from '../core/core.js';
import {writeZip} from '../project/zip.js';
import {bindApplicationTheme} from '../theme/application-appearance.js';

/** Closing the last form leaves the event-loop VM running rather than stopped. Loaded hidden or
 * minimized forms still own a running application and must never be duplicated. */
export function canRelaunchApplication(host) {
  if (!host || host.disposed) return true;
  const vm = host.vm;
  if (!vm) return false;
  if (vm.state === 'stopped' || vm.state === 'error') return true;
  return ['idle', 'running'].includes(vm.state) && !vm.stack?.length && !vm.processing && !vm.eventQueue?.length &&
    ![...(vm.formInstances || [])].some(instance => instance.loaded);
}

/** Enumerate one directory without reading/decoding file contents. */
export function applicationDiskEntries(fs, directory = '/') {
  const path = fs.canonical(directory), prefix = path === '/' ? '/' : path + '/';
  if (!fs.directories.has(path)) throw new Error('Folder no longer exists.');
  const entries = [];
  for (const [names, folder] of [[fs.directories, true], [fs.files.keys(), false]]) {
    for (const name of names) {
      if (name === path || !name.startsWith(prefix)) continue;
      const leaf = name.slice(prefix.length);
      if (!leaf || leaf.includes('/')) continue;
      const value = folder ? null : fs.files.get(name);
      entries.push({path: name, name: leaf, folder, bytes: folder ? null : value.length});
    }
  }
  return entries.sort((a, b) => Number(b.folder) - Number(a.folder) || a.name.localeCompare(b.name));
}

/** Preserve binary and VB ANSI file bytes, directory hierarchy and empty folders. */
export function archiveApplicationDisk(fs) {
  const files = Object.create(null);
  for (const name of fs.directories) if (name !== '/') files[name.replace(/^\//, '') + '/'] = new Uint8Array();
  for (const name of fs.files.keys()) files[name.replace(/^\//, '')] = fs.readBytes(name);
  return writeZip(files);
}

/** Export-only shell. The running application's controls, forms and VM remain
 * owned by ApplicationHost; the shell survives their disposal/relaunch. */
export function createApplicationDesktop({document, container, project, launch, persistent = true}) {
  const view = document.defaultView;
  const node = (tag, attrs = {}, ...children) => el(tag, {...attrs, document}, ...children);
  const button = (label, action, handler) => node('button', {type: 'button', 'data-desktop-action': action, onclick: handler}, label);
  let host, disposed = false, loading = true, timer = null, directory = '/', listingKey = null, releaseTheme = () => {};
  const subscriptions = [];
  const root = node('section', {id: 'vb6-desktop', 'data-vb-native': '', 'aria-label': 'Application desktop'});
  const state = node('span', {class: 'vb6-desktop-state', role: 'status', 'aria-live': 'polite'}, 'Starting application…');
  const notice = node('p', {class: 'vb6-disk-notice', role: 'status', 'aria-live': 'polite'},
    persistent ? 'Files are private to this application. Download a copy to keep them on your computer.' : 'This session uses memory. Download files before closing this page.');
  const launchButton = button('Launch application', 'launch', async () => {
    if (loading || !canRelaunchApplication(host)) return;
    setLoading(true);
    try { await launch(); }
    catch (error) { notice.textContent = String(error?.message || error); }
    finally { if (!disposed) setLoading(false); }
  });
  const diskButton = button('Private disk', 'files', () => {
    if (!host?.fs) return;
    refreshFiles();
    if (!dialog.open) dialog.showModal();
  });
  const bar = node('div', {class: 'vb6-desktop-bar'}, launchButton, diskButton,
    node('span', {class: 'vb6-desktop-title'}, project.name), state);
  const path = node('output', {'aria-label': 'Current folder', class: 'vb6-disk-path'}, '/');
  const listing = node('tbody');
  const table = node('table', {class: 'vb6-disk-table'},
    node('thead', {}, node('tr', {}, node('th', {scope: 'col'}, 'Name'), node('th', {scope: 'col'}, 'Size'), node('th', {scope: 'col'}, 'Action'))), listing);
  const parent = button('Up', 'up', () => { directory = directory.slice(0, directory.lastIndexOf('/')) || '/'; refreshFiles(); });
  const all = button('Download all (.zip)', 'download-all', () => {
    perform(() => download(safeName(project.name) + '-files.zip', archiveApplicationDisk(host.fs), 'application/zip', {document}));
  });
  const close = button('Close', 'close-files', () => dialog.close());
  const dialog = node('dialog', {class: 'vb6-disk-window', 'aria-labelledby': 'vb6-disk-title'},
    node('header', {}, node('h1', {id: 'vb6-disk-title'}, 'Private disk'), close), notice,
    node('nav', {'aria-label': 'Private disk folders'}, parent, path, button('Refresh', 'refresh-files', () => refreshFiles())),
    node('div', {class: 'vb6-disk-scroll'}, table), node('footer', {}, all));
  dialog.addEventListener('close', () => { if (!disposed && diskButton.isConnected) diskButton.focus(); });
  root.append(bar, dialog);
  document.body.append(root);
  document.documentElement.setAttribute('data-vb-desktop', 'true');

  function perform(action) {
    try { action(); }
    catch (error) { notice.textContent = String(error?.message || error); }
  }
  function refreshFiles() {
    if (disposed || !host?.fs) return;
    const fs = host.fs;
    if (!fs.directories.has(fs.canonical(directory))) directory = '/';
    directory = fs.canonical(directory);
    path.textContent = directory;
    parent.disabled = directory === '/';
    all.disabled = fs.files.size === 0 && fs.directories.size <= 1;
    const entries = applicationDiskEntries(fs, directory), key = JSON.stringify([directory, entries]);
    // A timer or any other form mutation may refresh the desktop status. Keep
    // unchanged rows alive so these unrelated updates cannot steal focus or
    // interrupt a pointer gesture on a file's Download button.
    if (key === listingKey) return;
    const rows = entries.map(entry => {
      const name = entry.folder ? button(entry.name, 'open-folder', () => { directory = entry.path; refreshFiles(); }) : node('span', {}, entry.name);
      const action = entry.folder ? node('span', {}, 'Folder') : button('Download', 'download-file', () => {
        perform(() => download(entry.name, host.fs.readBytes(entry.path), 'application/octet-stream', {document}));
      });
      if (!entry.folder) action.setAttribute('aria-label', 'Download ' + entry.name);
      return node('tr', {'data-disk-path': entry.path}, node('td', {}, name), node('td', {}, entry.folder ? '—' : entry.bytes.toLocaleString() + ' bytes'), node('td', {}, action));
    });
    if (!rows.length) rows.push(node('tr', {}, node('td', {colspan: 3}, 'This folder is empty.')));
    listing.replaceChildren(...rows);
    listingKey = key;
  }
  function refresh() {
    if (disposed) return;
    const closed = canRelaunchApplication(host);
    launchButton.disabled = loading || !closed;
    diskButton.disabled = !host?.fs;
    const text = loading ? 'Starting application…' : closed ? 'Application closed — ready to launch again.' : 'Application running';
    if (state.textContent !== text) state.textContent = text;
    const label = 'Private disk' + (host?.fs ? ' (' + host.fs.files.size + ')' : '');
    if (diskButton.textContent !== label) diskButton.textContent = label;
    if (dialog.open) refreshFiles();
  }
  function schedule() {
    if (disposed || timer !== null) return;
    // Run after the VM's async event-finally has released its processing flag.
    timer = view.setTimeout(() => { timer = null; refresh(); }, 0);
  }
  const observer = new view.MutationObserver(schedule);
  function unbind() {
    observer.disconnect();
    for (const off of subscriptions.splice(0)) off();
    releaseTheme(); releaseTheme = () => {};
  }
  function bind(next) {
    if (disposed) return;
    unbind(); host = next; loading = false;
    releaseTheme = bindApplicationTheme(container, root);
    if (host?.stage) observer.observe(host.stage, {subtree: true, childList: true, attributes: true, attributeFilter: ['style', 'hidden']});
    if (host?.vm?.on) for (const event of ['state', 'stop']) subscriptions.push(host.vm.on(event, schedule));
    refresh(); schedule();
  }
  function setLoading(value) { loading = value; refresh(); }
  refresh();
  return {root, bind, setLoading, canLaunch: () => !loading && canRelaunchApplication(host),
    message(message) {
      if (message.type === 'storage') notice.textContent = message.message + ' Download files before closing this page.';
      schedule();
    },
    dispose() {
      if (disposed) return;
      disposed = true; unbind();
      if (timer !== null) view.clearTimeout(timer);
      if (dialog.open) dialog.close();
      root.remove(); document.documentElement.removeAttribute('data-vb-desktop');
    }};
}
