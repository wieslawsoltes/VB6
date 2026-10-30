/** Browser tab presentation. The persistent page model lives in tab-model.js;
 * this adapter only changes live runtime props, never the project document.
 */
import {el} from '../core/core.js';
import {VBError} from '../language/lexer.js';
import {truth} from '../runtime/values.js';
import {acceptsInput} from './input.js';
import {TabItems} from './collections.js';
import {activeTab, checkedTab, tabCount, tabEntries, tabPagePlan, materializeTabPages, setTabCount, setTabEntry} from './tab-model.js';

const state = view => ({...view.model, type: view.type, properties: view.props});
const stripMnemonic = text => String(text ?? '').replace(/&&/g, '\0').replace(/&/g, '').replace(/\0/g, '&');
const indexed = new Map(['Caption', 'Enabled', 'Visible', 'Picture'].map(key => ['tab' + key.toLowerCase(), key]));
const asVBError = fn => {try {return fn();} catch (e) {if (e instanceof VBError) throw e; throw new VBError(e.message, 380);}};
// Rewriting an identical ARIA attribute still notifies MutationObserver and
// invalidates the GPU DOM scene; retain both nodes and unchanged attributes.
const tabAttribute = (node, name, value) => {value = String(value); if (node.getAttribute(name) !== value) node.setAttribute(name, value);};

export function browserTabEntries(view) {
  return view.type === 'TabStrip' && view.Tabs ? view.Tabs.items : tabEntries(state(view));
}

export function buildTabs(view) {
  view._pageChildren = [];
  view._tabButtons = new Map();
  view.node.classList.add('vb-tabs');
  view.node.classList.toggle('vb-sstab', view.type === 'SSTab');
  view.tabHeader = el('div', {class: 'vb-tab-header', role: 'tablist', 'aria-label': view.model.name + ' pages'});
  view.childHost = el('div', {class: 'vb-tab-client', id: 'tab-client-' + view.model.id, role: 'tabpanel'});
  view.node.append(view.tabHeader, view.childHost);
  if (view.type === 'TabStrip') {
    view.Tabs = new TabItems(() => view.invalidate());
    for (const tab of tabEntries(state(view))) {
      const item = view.Tabs.Add(undefined, tab.Key, tab.Caption, tab.Image);
      for (const key of ['Enabled', 'Visible', 'ToolTipText']) if (tab[key] !== undefined) item[key] = tab[key];
    }
  } else {
    Object.defineProperty(view, 'Tabs', {enumerable: true, get: () => getTabProperty(view, 'Tabs'), set: value => setTabProperty(view, 'Tabs', value)});
    for (const [name, key] of indexed) {
      const publicName = 'Tab' + key;
      view[publicName] = page => asVBError(() => {
        const entry = tabEntries(state(view))[checkedTab(state(view), page)];
        return key === 'Enabled' || key === 'Visible' ? entry[key] ? -1 : 0 : entry[key];
      });
    }
  }
  view.SetFocus = () => (view.tabHeader.querySelector('button[tabindex]:not([tabindex="-1"]):not(:disabled)') || view.tabHeader.querySelector('button:not(:disabled)') || view.node).focus({preventScroll: true});
  view.tabHeader.addEventListener('click', event => {
    const button = event.target.closest('[data-tab-index]');
    if (!button || !view.tabHeader.contains(button) || view.design || !acceptsInput(view)) return;
    const page = Number(button.dataset.tabIndex), entry = browserTabEntries(view)[page];
    if (!entry || entry.Enabled === false || entry.Enabled === 0 || entry.Visible === false || entry.Visible === 0) return;
    event.preventDefault(); event.stopPropagation();
    setTabProperty(view, 'Tab', page);
  });
  view.tabHeader.addEventListener('keydown', event => {
    if (view.design || event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.altKey || event.ctrlKey || event.metaKey || !acceptsInput(view)) return;
    const entries = browserTabEntries(view), pages = entries.map((entry, i) => ({entry, i})).filter(({entry}) => entry.Enabled !== false && entry.Enabled !== 0 && entry.Visible !== false && entry.Visible !== 0).map(({i}) => i);
    let at = Math.max(0, pages.indexOf(Number(event.target.closest('[data-tab-index]')?.dataset.tabIndex ?? view.props.Tab ?? 0)));
    if (!pages.length) return;
    const vertical = Number(view.props.TabOrientation) >= 2, rtl = view.node.ownerDocument.defaultView.getComputedStyle(view.node).direction === 'rtl';
    if (event.key === (vertical ? 'ArrowDown' : rtl ? 'ArrowLeft' : 'ArrowRight')) at = (at + 1) % pages.length;
    else if (event.key === (vertical ? 'ArrowUp' : rtl ? 'ArrowRight' : 'ArrowLeft')) at = (at + pages.length - 1) % pages.length;
    else if (event.key === 'Home') at = 0;
    else if (event.key === 'End') at = pages.length - 1;
    else return;
    event.preventDefault(); event.stopPropagation();
    setTabProperty(view, 'Tab', pages[at]);
    view.tabHeader.querySelector(`[data-tab-index="${pages[at]}"]`)?.focus();
  });
}

export function getTabProperty(view, key) {
  if (view.type !== 'SSTab') return undefined;
  if (key === 'Tabs') return tabCount(state(view));
  if (key === 'Tab') return activeTab(state(view));
  if (key === 'Caption' || key === 'Picture') return tabEntries(state(view))[activeTab(state(view))]?.[key] ?? '';
  return undefined;
}

export function setIndexedTab(view, name, args, value) {
  const key = indexed.get(String(name).toLowerCase());
  if (view.type !== 'SSTab' || !key) return false;
  if (args.length !== 1) throw new VBError('Wrong number of arguments for ' + name, 450);
  asVBError(() => setTabEntry(state(view), args[0], key, key === 'Enabled' || key === 'Visible' ? truth(value) ? -1 : 0 : value));
  refreshTabs(view, view.tabImage);
  return true;
}

export function setTabProperty(view, key, value) {
  if (view.type !== 'SSTab' && view.type !== 'TabStrip') return false;
  if (key === 'Tab') {
    const count = browserTabEntries(view).length, page = Number(value);
    if (!Number.isInteger(page) || page < 0 || page >= count) throw new VBError('Invalid tab index', 380);
    const previous = Number(view.props.Tab || 0);
    if (page === previous) return true;
    const focused = view.node.ownerDocument.activeElement, repairFocus = !view.design && (view._pageChildren || []).some(child => child.node.contains(focused));
    view.props.Tab = page;
    refreshTabs(view, view.tabImage);
    if (repairFocus) view.tabHeader.querySelector(`[data-tab-index="${page}"]`)?.focus();
    view.event('Click', view.type === 'SSTab' ? [previous] : []);
    return true;
  }
  if (view.type === 'SSTab' && (key === 'Caption' || key === 'Picture')) return setIndexedTab(view, 'Tab' + key, [activeTab(state(view))], value);
  if (view.type === 'SSTab' && key === 'Tabs') {
    const owner = state(view), controls = (view.form?.controls || [view]).map(state);
    const model = controls.find(c => c.id === owner.id) || owner;
    asVBError(() => setTabCount({controls}, model, value));
    refreshTabs(view, view.tabImage); return true;
  }
  const ranges = {TabOrientation: [0, 3], TabsPerRow: [1, 32767], TabHeight: [0, 300000], TabMaxWidth: [0, 300000]};
  if (key in ranges) {
    const [min, max] = ranges[key]; value = Number(value);
    if (!Number.isInteger(value) || value < min || value > max) throw new VBError('Invalid ' + key, 380);
    view.props[key] = value; refreshTabs(view, view.tabImage); return true;
  }
  return false;
}

/** Keep page membership independent of Visible and remove stale owner links.
 * Validate first: a failed reassignment cannot detach the old page membership.
 */
export function bindTabChild(view, parent, page) {
  const owner = parent?.type === 'SSTab' ? parent : null;
  const next = owner ? asVBError(() => checkedTab(state(owner), page ?? activeTab(state(owner)))) : undefined;
  unbindTabChild(view);
  if (owner) {
    view._tabOwner = owner; view._tabPage = next; view.props.TabPage = next;
    (owner._pageChildren ??= []).push(view);
  }
}

export function unbindTabChild(view) {
  if (view._tabOwner) view._tabOwner._pageChildren = (view._tabOwner._pageChildren || []).filter(child => child !== view);
  view._tabOwner = null; view._tabPage = undefined; delete view.props.TabPage;
}

/** Apply raw import offsets once at mount, not every time a child moves. Keep
 * page visibility separate from Visible so code can change Visible while its
 * page is inactive. Nested containers naturally inherit their parent's mask.
 */
export function mountTabPages(form) {
  const plan = tabPagePlan(form.originalModel || form.model), views = new Map(form.controls.map(c => [c.model.id, c]));
  form.tabDiagnostics = plan.diagnostics;
  for (const view of form.controls) {view._pageChildren = []; view._tabOwner = null; view._tabPage = undefined;}
  for (const {owner, child, page, left} of plan.bindings.values()) {
    const parent = views.get(owner.id), view = views.get(child.id);
    if (!parent || !view) continue;
    view._tabOwner = parent; view._tabPage = page;
    view.props.Left = left; view.props.TabPage = page;
    parent._pageChildren.push(view);
    view.refresh();
  }
  // Live props are already independent clones. Drop their legacy name records
  // after resolving coordinates, so later Container changes do not invalidate
  // unrelated page-count edits. Never modify the persisted designer document.
  if (!plan.diagnostics.length) materializeTabPages({controls: form.controls.map(state)});
}

export function refreshTabs(view, image = () => '') {
  view.tabImage = image;
  const entries = browserTabEntries(view), active = Math.max(0, Math.min(entries.length - 1, Number(view.props.Tab || 0)));
  const visible = entries.map((entry, index) => ({entry, index})).filter(({entry}) => view.design || entry.Visible !== false && entry.Visible !== 0);
  const orientation = Math.max(0, Math.min(3, Number(view.props.TabOrientation) || 0)), vertical = orientation >= 2;
  const explicitSegments = view.props.MacOSControlStyle === 'segmented';
  const perRow = explicitSegments ? Math.max(1, visible.length) : Math.max(1, Math.min(32767, Number(view.props.TabsPerRow) || (view.type === 'SSTab' ? 3 : Math.max(1, visible.length))));
  const rows = Math.max(1, Math.ceil(visible.length / perRow)), height = Math.max(18, Number(view.props.TabHeight ?? 360) / 15);
  if (view.node.dataset.tabOrientation !== String(orientation)) view.node.dataset.tabOrientation = String(orientation);
  tabAttribute(view.tabHeader, 'aria-orientation', vertical ? 'vertical' : 'horizontal');
  const segmented = explicitSegments || view.type === 'TabStrip' && orientation === 0;
  const track = segmented && !explicitSegments ? 'var(--detail-strip-column, minmax(0, 1fr))' : 'minmax(0, 1fr)';
  Object.assign(view.tabHeader.style, {gridTemplateColumns: vertical ? `repeat(${rows}, ${height}px)` : `repeat(${Math.min(perRow, Math.max(1, visible.length))}, ${track})`, gridTemplateRows: vertical ? `repeat(${Math.min(perRow, Math.max(1, visible.length))}, minmax(0, 1fr))` : `repeat(${rows}, ${height}px)`, gridAutoFlow: vertical ? 'column' : 'row', height: vertical ? '100%' : rows * height + 'px', width: vertical ? rows * height + 'px' : segmented && !explicitSegments ? 'var(--detail-strip-width, 100%)' : '100%'});
  view.node.classList.toggle('vb-tab-property-pages', Number(view.props.Style) === 1);
  const focused = view.node.ownerDocument.activeElement, headerFocus = view.tabHeader.contains(focused);
  const keyFor = (entry, index) => view.type === 'TabStrip' ? entry : index;
  const keys = new Set(entries.map(keyFor));
  for (const [key, button] of view._tabButtons) if (!keys.has(key)) {button.remove(); view._tabButtons.delete(key);}
  let ordinal = 0;
  for (const {entry, index} of visible) {
    const key = keyFor(entry, index), caption = stripMnemonic(entry.Caption);
    let button = view._tabButtons.get(key);
    if (!button) {
      button = el('button', {type: 'button', class: 'vb-tab-button', role: 'tab'});
      button.append(el('span')); view._tabButtons.set(key, button);
    }
    if (view.tabHeader.children[ordinal] !== button) view.tabHeader.insertBefore(button, view.tabHeader.children[ordinal] || null);
    ordinal++;
    tabAttribute(button, 'id', `tab-${view.model.id}-${index}`);
    tabAttribute(button, 'data-tab-index', index);
    tabAttribute(button, 'aria-controls', view.childHost.id);
    tabAttribute(button, 'aria-label', caption);
    if (view.design && view.type === 'SSTab') tabAttribute(button, 'data-designer-tab', index);
    button.disabled = !view.design && (!truth(view.props.Enabled) || entry.Enabled === false || entry.Enabled === 0);
    button.classList.toggle('vb-design-hidden-tab', view.design && (entry.Visible === false || entry.Visible === 0));
    if (button.title !== String(entry.ToolTipText || '')) button.title = String(entry.ToolTipText || '');
    const label = button.querySelector('span');
    if (label.textContent !== caption) label.textContent = caption;
    const picture = image(entry.Picture), previous = button.querySelector('img');
    if (picture) {if (previous) {if (previous.getAttribute('src') !== picture) previous.src = picture;} else button.prepend(el('img', {src: picture, alt: '', class: 'vb-tab-picture'}));}
    else previous?.remove();
  }
  while (view.tabHeader.children.length > visible.length) view.tabHeader.lastElementChild.remove();
  const selectable = visible.filter(({entry}) => entry.Enabled !== false && entry.Enabled !== 0);
  const focusPage = selectable.find(({index}) => index === active)?.index ?? selectable[0]?.index;
  if (view.node.tabIndex !== -1) view.node.tabIndex = -1;
  for (const button of view.tabHeader.children) {
    const selected = Number(button.dataset.tabIndex) === active;
    button.classList.toggle('active', selected);
    tabAttribute(button, 'aria-selected', selected);
    const tabIndex = !view.design && !button.disabled && Number(button.dataset.tabIndex) === focusPage && truth(view.props.TabStop) ? Number(view.props.TabIndex) || 0 : -1;
    if (button.tabIndex !== tabIndex) button.tabIndex = tabIndex;
    const maxWidth = Number(view.props.TabMaxWidth || 0);
    button.style.maxWidth = !vertical && maxWidth > 0 ? maxWidth / 15 + 'px' : '';
  }
  if (headerFocus && (!focused.isConnected || focused.disabled)) view.SetFocus();
  tabAttribute(view.childHost, 'aria-labelledby', `tab-${view.model.id}-${active}`);
  for (const child of view._pageChildren || []) {
    const hidden = child._tabPage !== active || !view.design && (!truth(child.props.Visible) || ['Timer', 'ImageList', 'CommonDialog'].includes(child.type));
    if (child.node.hidden !== hidden) child.node.hidden = hidden;
  }
}
