import {refreshGraphicsSurfaces} from '../graphics/surface.js';
import {BrowserWindowHost} from './browser-window-host.js';
import {el} from '../core/core.js';
import {hasUIDialog} from '../core/window-context.js';
import {showMenu, menuIsOpen, closeMenu} from '../theme/menu.js';

/** Wire the reusable host into tools, MDI documents and command bars. */
export function installBrowserWindows(ide) {
  const dock = ide.docking, mdi = ide.documents.mdi, bars = ide.commandBars;
  const host = ide.browserWindows = new BrowserWindowHost(window, {
    themeRoot: ide.root,
    tooltipsEnabled: () => ide.appearance.tooltips !== false,
    onChange: () => ide.autosave(),
    onFailure: error => ide.status(error.message + ' Allow popups for this site and try Float in Browser Window again; the pane remains in the IDE.'),
    decorate: record => {
      const nav = el('nav', {class: 'menubar browser-window-menubar', role: 'menubar', 'aria-label': 'Main menu'});
      const names = ['File', 'Edit', 'View', 'Project', 'Format', 'Debug', 'Run', 'Tools', 'Window', 'Help'];
      const open = button => {
        const r = button.getBoundingClientRect();
        showMenu(ide.menu(button.dataset.menu), r.left, r.bottom, id => ide.command(id), {
          opener: button, label: button.dataset.menu, focusFirst: true,
          onSwitch: direction => open(nav.children[(names.indexOf(button.dataset.menu) + direction + names.length) % names.length])
        });
      };
      for (const name of names) {
        const button = el('button', {type: 'button', role: 'menuitem', 'data-menu': name, 'aria-haspopup': 'menu', 'aria-expanded': 'false'}, name);
        button.onclick = () => open(button);
        button.onpointerenter = () => { if (menuIsOpen()) open(button); };
        button.onkeydown = event => {
          if (['Enter', ' ', 'ArrowDown'].includes(event.key)) { event.preventDefault(); open(button); }
          if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); nav.children[(names.indexOf(name) + (event.key === 'ArrowRight' ? 1 : -1) + names.length) % names.length].focus(); }
        };
        nav.append(button);
      }
      record.content.before(nav);
      let alt = false;
      const keydown = event => {
        if (event.defaultPrevented || hasUIDialog()) return;
        if (event.key === 'Alt') { alt = true; event.preventDefault(); return; }
        alt = false;
        if ((event.ctrlKey || event.metaKey) && event.key === 'F4' && record.key.startsWith('document:')) {
          event.preventDefault(); ide.closeDocument(record.key.slice(9)); return;
        }
        if (event.key === 'F10' && !event.shiftKey && !event.ctrlKey) { event.preventDefault(); nav.firstElementChild.focus(); return; }
        if (event.altKey && !event.ctrlKey && !event.metaKey) {
          const name = {f: 'File', e: 'Edit', v: 'View', p: 'Project', o: 'Format', d: 'Debug', r: 'Run', t: 'Tools', w: 'Window', h: 'Help'}[event.key.toLowerCase()];
          if (name) { event.preventDefault(); open(nav.querySelector(`[data-menu="${name}"]`)); return; }
        }
        ide.keydown(event);
      };
      const keyup = event => { if (event.key === 'Alt' && alt && !hasUIDialog()) { alt = false; event.preventDefault(); if (menuIsOpen()) closeMenu(); else nav.firstElementChild.focus(); } };
      record.doc.addEventListener('keydown', keydown);
      record.doc.addEventListener('keyup', keyup);
      return () => { record.doc.removeEventListener('keydown', keydown); record.doc.removeEventListener('keyup', keyup); };
    }
  });
  dock.browserWindows = mdi.browserWindows = bars.browserWindows = host;
  const refreshSurfaces = node => {
    for (const editor of ide.documents.editors.values()) if (node.contains(editor.root)) editor.transferDocument();
    for (const designer of ide.documents.designers.values()) if (node.contains(designer.root)) designer.transferDocument();
    refreshGraphicsSurfaces(node);
  };
  dock.detach = id => {
    const group = dock.group(id), view = group && dock.views.get(group.id);
    if (!view || !dock.model.visible(group).length) return false;
    dock.cancelInteraction?.();
    const result = host.detach('dock:' + group.id, view, {
      title: () => dock.model.visible(group).map(key => dock.title(key)).join(' / '),
      onFocus: () => view.classList.add('dock-active'),
      onTransfer: () => refreshSurfaces(view),
      onReturn: () => dock.render()
    });
    dock.reflow(); return result;
  };
  mdi.detach = key => {
    const win = mdi.windows.get(key); if (!win) return false;
    mdi.cancelInteraction?.();
    const result = host.detach('document:' + key, win.node, {
      title: () => win.label.textContent,
      onFocus: () => mdi.activate(key),
      onTransfer: () => refreshSurfaces(win.node),
      onReturn: () => mdi.layout(win)
    });
    return result;
  };
  bars.detach = id => {
    const bar = bars.model.get(id), node = bars.views.get(id); if (!bar || !bar.visible) return false;
    bars.cancelInteraction?.();
    const result = host.detach('toolbar:' + id, node, {title: () => bar.name + ' toolbar', onReturn: () => bars.render()});
    bars.render(); return result;
  };
  const openDocument = ide.openDocument.bind(ide);
  ide.openDocument = (...args) => { const result = openDocument(...args); host.focus('document:' + ide.activeDoc?.key); return result; };
  const menu = ide.menu.bind(ide);
  ide.menu = name => {
    const items = menu(name);
    if (name !== 'Window') return items;
    const key = mdi.active || ide.activeDoc?.key;
    items.unshift(
      {label: 'Float Document in Browser Window', enabled: mdi.windows.has(key), action: () => mdi.detach(key)},
      {label: 'Float Tool Group in Browser Window', items: [...dock.panels].filter(([id]) => !dock.model.windows.get(id)?.hidden).map(([id, panel]) => ({label: panel.title, action: () => dock.detach(id)}))},
      {label: 'Browser Windows', enabled: !!host.windows.size, items: [...host.windows.values()].map(record => ({label: record.doc.title, action: () => host.focus(record.key)}))},
      {label: 'Restore Browser Window', enabled: !!host.pending.size, items: [...host.pending.keys()].map(key => ({label: key, action: () => ide.restoreBrowserWindow(key)}))},
      {label: 'Return All Browser Windows to IDE', enabled: !!host.windows.size, action: () => host.attachAll('return')}, null
    );
    return items;
  };
  ide.restoreBrowserWindow = key => {
    if (key.startsWith('document:')) return mdi.detach(key.slice(9));
    if (key.startsWith('toolbar:')) return bars.detach(key.slice(8));
    const group = dock.model.groups.get(key.slice(5));
    return group ? dock.detach(group.active) : false;
  };
  const available = key => key.startsWith('document:') ? mdi.windows.has(key.slice(9)) : key.startsWith('toolbar:') ? !!bars.model.get(key.slice(8))?.visible : dock.model.groups.has(key.slice(5));
  const prunePending = () => { for (const key of host.pending.keys()) if (!available(key)) host.pending.delete(key); };
  const restoreDocuments = ide.restoreDocuments.bind(ide);
  ide.restoreDocuments = () => { restoreDocuments(); prunePending(); };
  const loadProject = ide.loadProject.bind(ide);
  ide.loadProject = (project, options) => { if (!options?.initial) for (const key of host.pending.keys()) if (key.startsWith('document:')) host.pending.delete(key); return loadProject(project, options); };
  const snapshot = ide.layoutSnapshot.bind(ide), restore = ide.restoreLayout.bind(ide);
  ide.layoutSnapshot = () => ({...snapshot(), browserWindows: host.snapshot()});
  ide.restoreLayout = layout => {
    restore(layout);
    try { host.restore(layout?.browserWindows || []); }
    catch (error) { ide.status('Browser window layout ignored: ' + error.message); }
  };
  const capture = ide.captureWindowLayout.bind(ide), apply = ide.applyWindowLayout.bind(ide);
  ide.captureWindowLayout = () => ({...capture(), browserWindows: host.snapshot()});
  ide.applyWindowLayout = value => {
    // apply() validates the entire profile before touching live state.
    const result = apply(value);
    host.restore((result.browserWindows || []).filter(item => !item.key.startsWith('document:') || result.projectId === ide.project.id));
    prunePending();
    if (host.pending.size) ide.status('Layout restored. Use Window → Restore Browser Window once per window to allow browser popups.');
    return result;
  };
  const command = ide.command.bind(ide);
  ide.command = (id, ...args) => {
    if (id === 'resetLayout') { host.attachAll('layout'); host.pending.clear(); }
    return command(id, ...args);
  };
  return host;
}
