import {registerUIDocument,uiDocument} from '../core/window-context.js';
import {browserBounds, normalizeBrowserWindows} from './browser-window-state.js';
import {ClassicTooltips} from '../theme/tooltip.js';
import {closeMenu} from '../theme/menu.js';
import {IDE_THEME_ATTRIBUTES,copyIdeThemeAttributes} from '../theme/ide-appearance.js';

/** Same-origin live-DOM host. The owner remains the sole project/runtime authority.
 * Opening is synchronous: callers must invoke detach from a user gesture. */
export class BrowserWindowHost {
  constructor(owner, {themeRoot, onChange = () => {}, onFailure = () => {}, decorate = () => {}, tooltipsEnabled = () => true} = {}) {
    this.owner = owner;
    this.document = owner.document;
    this.themeRoot = themeRoot || this.document.documentElement;
    this.onChange = onChange;
    this.onFailure = onFailure;
    this.decorate = decorate;
    this.tooltipsEnabled = tooltipsEnabled;
    this.windows = new Map();
    this.pending = new Map();
    this.disposed = false;
    this.enabled = true;
    this.unregister = registerUIDocument(this.document);
    this.pagehide = () => this.dispose();
    owner.addEventListener('pagehide', this.pagehide);
    this.themeObserver = new owner.MutationObserver(() => this.syncTheme());
    this.themeObserver.observe(this.themeRoot, {attributes: true, attributeFilter: ['class', 'style', 'data-vb-theme']});
    this.rootThemeObserver = new owner.MutationObserver(() => this.syncTheme());
    this.rootThemeObserver.observe(this.document.documentElement, {attributes: true, attributeFilter: IDE_THEME_ATTRIBUTES});
    this.styleObserver = new owner.MutationObserver(records => {
      // Source edits update document.title frequently; never reparse all styles for those.
      const styleNode = node => node.nodeType === 1 && node.matches('style,link');
      if (records.some(record => styleNode(record.target) || record.target.parentElement?.closest('style') ||
          [...record.addedNodes, ...record.removedNodes].some(styleNode))) this.syncStyles();
    });
    this.styleObserver.observe(this.document.head, {childList: true, subtree: true, characterData: true, attributes: true});
  }
  setEnabled(enabled) {
    if (this.disposed || this.enabled === !!enabled) return;
    this.enabled = !!enabled;
    if (!this.enabled) {
      const saved = this.snapshot();
      this.attachAll('mode');
      this.pending = new Map(saved.map(({key, bounds}) => [key, bounds]));
    }
  }
  has(key) { return this.windows.has(key); }
  mount(key) { return this.windows.get(key)?.content; }
  focus(key) { const record = this.windows.get(key); if (!record) return false; try { record.popup.focus(); } catch {} return true; }
  detach(key, node, options = {}) {
    if (this.disposed || !this.enabled || !node?.parentNode) return false;
    if (this.has(key)) return this.focus(key);
    const rect = node.getBoundingClientRect();
    const bounds = browserBounds(options.bounds || this.pending.get(key) || {
      left: this.owner.screenX + rect.left + 30, top: this.owner.screenY + rect.top + 40,
      width: Math.max(300, rect.width), height: Math.max(220, rect.height + 62)
    });
    let popup, setupRecord, transport;
    try {
      // _blank never reuses another IDE tab's named window. No untrusted URL is loaded.
      const source = uiDocument();
      const requester = source === this.document || [...this.windows.values()].some(r => r.doc === source) ? source.defaultView : this.owner;
      transport = this.transport?.open(bounds,typeof options.title === 'function' ? options.title() : options.title || key);
      popup = transport ? transport.popup : requester.open('', '_blank', `popup=yes,resizable=yes,scrollbars=yes,left=${bounds.left},top=${bounds.top},width=${bounds.width},height=${bounds.height}`);
      if (!popup || popup.closed) throw new Error('The browser blocked the popup.');
      popup.opener = this.owner;
      const doc = popup.document;
      if (!transport?.native) { doc.open(); doc.write('<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>'); doc.close(); }
      if (!transport?.native) { const base = doc.createElement('base'); base.href = this.document.baseURI; doc.head.append(base); }
      const root = doc.createElement('div'); root.className = 'browser-window-root';
      const header = doc.createElement('header'); header.className = 'browser-window-caption';
      const label = doc.createElement('strong');
      const back = doc.createElement('button'); back.type = 'button'; back.textContent = 'Return to IDE';
      back.setAttribute('aria-label', 'Return to IDE'); back.onclick = () => this.attach(key);
      const focus = doc.createElement('button'); focus.type = 'button'; focus.textContent = 'Focus IDE';
      focus.onclick = () => this.owner.focus();
      header.append(label, focus, back);
      const content = doc.createElement('main'); content.className = 'browser-window-content';
      root.append(header, content); doc.body.append(root);
      const anchor = this.document.createComment('Detached browser window: ' + key);
      const record = {key, node, popup, doc, root, label, content, anchor, options, bounds, transport, cleanups: [], closing: false};
      setupRecord = record;
      this.copyStyles(record);
      this.copyTheme(record);
      // Complete all fallible setup before transferring the live pane.
      record.cleanups.push(registerUIDocument(doc));
      const tooltips = new ClassicTooltips(root, {enabled: this.tooltipsEnabled});
      record.cleanups.push(() => tooltips.dispose());
      const cleanup = this.decorate(record);
      if (typeof cleanup === 'function') record.cleanups.push(cleanup);
      options.onBeforeTransfer?.();
      const viewState = record.viewState = this.captureView(node);
      content.inert = true;
      node.before(anchor);
      this.windows.set(key, record);
      try { content.append(doc.adoptNode(node)); }
      catch (error) { this.attach(key, 'failed'); throw error; }
      this.pending.delete(key);
      const returnPane = () => this.attach(key, 'closed');
      if (transport) transport.onClose = returnPane;
      popup.addEventListener('pagehide', returnPane);
      record.cleanups.push(() => popup.removeEventListener('pagehide', returnPane));
      const changed = () => { this.measure(record); this.onChange(); };
      popup.addEventListener('resize', changed);
      const focused = () => options.onFocus?.();
      popup.addEventListener('focus', focused);
      record.cleanups.push(() => popup.removeEventListener('resize', changed));
      record.cleanups.push(() => popup.removeEventListener('focus', focused));
      const titles = new this.owner.MutationObserver(() => this.updateTitle(record));
      titles.observe(node, {childList: true, characterData: true, subtree: true});
      record.cleanups.push(() => titles.disconnect());
      this.updateTitle(record);
      record.stylesReady.then(() => {
        if (this.windows.get(key) !== record) return;
        transport?.show();
        popup.requestAnimationFrame(() => {
          if (this.windows.get(key) !== record) return;
          content.inert = false;
          this.restoreView(record, viewState);
          this.notifyTransfer(record);
          root.dataset.ready = 'true';
        });
      }).catch(error => { this.attach(key, 'failed'); this.onFailure(error); });
      this.startPolling();
      popup.focus(); options.onFocus?.(); this.onChange();
      return true;
    } catch (error) {
      if (this.has(key)) this.attach(key, 'failed');
      else for (const cleanup of setupRecord?.cleanups || []) { try { cleanup(); } catch {} }
      try { if (transport) transport.close(); else popup?.close(); } catch {}
      this.onFailure(error);
      return false;
    }
  }
  updateTitle(record) {
    const title = String(typeof record.options.title === 'function' ? record.options.title() : record.options.title || record.key);
    if (record.label.textContent !== title) record.label.textContent = title;
    if (record.doc.title !== title + ' — VB6 Studio') { record.doc.title = title + ' — VB6 Studio'; record.transport?.title(record.doc.title); }
  }
  copyStyles(record) {
    const ready = [];
    for (const style of record.doc.head.querySelectorAll('[data-owner-style]')) style.remove();
    for (const source of this.document.head.querySelectorAll('style,link[rel="stylesheet"]')) {
      const copy = source.cloneNode(true);
      copy.setAttribute('data-owner-style', '');
      if (source.tagName === 'LINK') {
        copy.href = source.href;
        if (!copy.disabled) ready.push(new Promise(resolve => {
          copy.addEventListener('load', resolve, {once: true});
          copy.addEventListener('error', resolve, {once: true});
        }));
      }
      record.doc.head.append(copy);
    }
    record.stylesReady = Promise.all(ready);
  }
  copyTheme(record) {
    copyIdeThemeAttributes(this.document.documentElement, record.doc.documentElement);
    record.root.className = this.themeRoot.className + ' browser-window-root';
    record.root.style.cssText = this.themeRoot.style.cssText;
    record.doc.dispatchEvent(new this.owner.CustomEvent('vb-theme-change', {detail: {theme: record.doc.documentElement.dataset.vbTheme}}));
  }
  syncStyles() { for (const record of this.windows.values()) { try { this.copyStyles(record); } catch { this.attach(record.key, 'unreachable'); } } }
  syncTheme() { for (const record of this.windows.values()) { try { this.copyTheme(record); } catch { this.attach(record.key, 'unreachable'); } } }
  notifyTransfer(record) {
    record.node.dispatchEvent(new this.owner.CustomEvent('vb-window-change', {bubbles: true}));
    record.options.onTransfer?.();
  }
  captureView(node) {
    const active = node.ownerDocument.activeElement;
    return {active: node.contains(active) ? active : null, scroll: [node, ...node.querySelectorAll('*')].filter(n => n.scrollTop || n.scrollLeft).map(n => [n, n.scrollLeft, n.scrollTop])};
  }
  restoreView(record, state) {
    if (state.active?.isConnected) state.active.focus({preventScroll: true});
    for (const [node, left, top] of state.scroll) { node.scrollLeft = left; node.scrollTop = top; }
  }
  measure(record) {
    try {
      const next = browserBounds({left: record.popup.screenX, top: record.popup.screenY, width: record.popup.innerWidth, height: record.popup.innerHeight});
      const changed = JSON.stringify(next) !== JSON.stringify(record.bounds);
      record.bounds = next;
      return changed;
    } catch { return false; }
  }
  startPolling() {
    if (this.timer) return;
    // Detect close/crash/navigation even when pagehide is not delivered. One timer per IDE.
    this.timer = this.owner.setInterval(() => {
      let changed = false;
      for (const record of [...this.windows.values()]) {
        try {
          if (record.popup.closed || record.popup.document !== record.doc || !record.node.isConnected) {
            this.attach(record.key, 'unreachable'); continue;
          }
          changed = this.measure(record) || changed;
        } catch { this.attach(record.key, 'unreachable'); }
      }
      if (changed) this.onChange();
    }, 500);
  }
  attach(key, reason = 'return') {
    const record = this.windows.get(key);
    if (!record || record.closing) return false;
    record.closing = true;
    this.measure(record);
    this.windows.delete(key);
    record.options.onBeforeTransfer?.();
    const viewState = record.content.inert ? record.viewState : this.captureView(record.node);
    closeMenu(false);
    record.doc.dispatchEvent(new this.owner.CustomEvent('vb-window-release'));
    record.doc.querySelectorAll('.property-color-popup').forEach(node => node.dismiss?.());
    for (const cleanup of record.cleanups) { try { cleanup(); } catch {} }
    // Keep a direct reference: recovering never depends on the popup still being accessible.
    const node = this.document.adoptNode(record.node);
    if (record.anchor.parentNode) record.anchor.replaceWith(node);
    else this.themeRoot.append(node);
    try { if (record.transport) record.transport.close(); else record.popup.close(); } catch {}
    if (!this.windows.size && this.timer) { this.owner.clearInterval(this.timer); this.timer = null; }
    record.options.onReturn?.(reason);
    this.restoreView(record, viewState);
    this.notifyTransfer(record);
    if (!this.disposed) this.onChange();
    if (reason === 'return') { this.owner.focus(); node.querySelector('input,textarea,[tabindex="0"],button')?.focus(); }
    return true;
  }
  attachAll(reason = 'layout') { for (const key of [...this.windows.keys()]) this.attach(key, reason); }
  snapshot() {
    for (const record of this.windows.values()) this.measure(record);
    return [...this.pending].filter(([key]) => !this.has(key)).map(([key, bounds]) => ({key, bounds: {...bounds}}))
      .concat([...this.windows.values()].map(r => ({key: r.key, bounds: {...r.bounds}})));
  }
  restore(value) {
    const normalized = normalizeBrowserWindows(value);
    this.attachAll('layout');
    this.pending = new Map(normalized.map(item => [item.key, item.bounds]));
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.attachAll('owner-closed');
    this.pending.clear();
    this.themeObserver.disconnect(); this.rootThemeObserver.disconnect(); this.styleObserver.disconnect();
    this.transport?.dispose(); this.unregister(); this.owner.removeEventListener('pagehide', this.pagehide);
  }
}
