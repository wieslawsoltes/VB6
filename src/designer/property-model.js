import {validateMacOS26Properties,clearMacOS26ColorRoles,macos26PropertyDefaults,MACOS26_PROPERTIES} from '../theme/macos26-compat.js';
/** Pure, atomic designer property edits shared by property grids and gestures. */
import {CONTROL_DEFAULTS} from '../project/model.js';
import {activeTab, checkedTab, controlParents, materializeTabPages, setTabCount, setTabEntry, tabEntries, tabPagePlan} from '../controls/tab-model.js';
import {resizeAxes, setTabIndex, tabOrderEligible} from './control-model.js';
import {collectionDefinition, validateCollection} from './collections.js';

const common = {Left: 0, Top: 0, Width: 1800, Height: 450, Enabled: -1, Visible: -1, TabIndex: 0, TabStop: -1, FontName: 'MS Sans Serif', FontSize: 8.25, FontBold: 0, FontItalic: 0, ForeColor: -2147483640, BackColor: -2147483633, ToolTipText: '', Tag: ''};
const tabKeys = new Set(['Tab', 'Tabs', 'Caption', 'Picture', 'TabEnabled', 'TabVisible', 'TabOrientation', 'TabsPerRow', 'TabHeight', 'TabMaxWidth', 'Style']);
const geometry = new Set(['Left', 'Top', 'Width', 'Height']);

export function designerPropertyValues(control, form = null, plan = null, options = {}) {
  const macos=options.macos26===true||MACOS26_PROPERTIES.some(key=>Object.hasOwn(control.properties||{},key));
  const values = {...(macos?macos26PropertyDefaults(control.type):{}),...(control === form ? {} : common), ...CONTROL_DEFAULTS[control.type], ...control.properties, Name: control.name};
  if (control !== form && !tabOrderEligible(control)) {delete values.TabIndex; delete values.TabStop;}
  if (control.type === 'SSTab') {
    const entries = plan?.owners.get(control.id)?.entries || tabEntries(control), page = activeTab(control), entry = entries[page];
    Object.assign(values, {Tabs: entries.length, Tab: page, Caption: entry?.Caption || '', Picture: entry?.Picture || '', TabEnabled: entry?.Enabled ? -1 : 0, TabVisible: entry?.Visible ? -1 : 0});
    for (const key of Object.keys(values)) if (/^Tab(?:\(\d+\)\.|(?:Caption|Enabled|Visible|Picture)\(\d+\))/i.test(key)) delete values[key];
  }
  if (form && control !== form) {
    const binding = (plan || tabPagePlan(form)).bindings.get(control.id);
    if (binding) {values.Left = binding.left; values.TabPage = binding.page;}
  }
  for (const key of ['Nodes', 'Columns', 'Items', 'Buttons', 'Panels', 'Tabs', 'ListImages', 'GridData']) {
    if (control.type === 'TabStrip' && key === 'Tabs' && !Array.isArray(values.Tabs)) values.Tabs = tabEntries(control);
    if (collectionDefinition(control, key)) values[key] ??= key === 'Columns' ? values.ColumnHeaders || [] : key === 'Items' ? values.ListItems || [] : [];
  }
  if (values.Columns) delete values.ColumnHeaders;
  if (values.Items) delete values.ListItems;
  return values;
}

/** Returns null for edits owned by the IDE (rename, form geometry, layout), or
 * a complete replacement form. Validation and all edits happen on a clone, so
 * an invalid member of a multi-selection cannot partially mutate the project.
 */
export function editDesignerProperties(form, ids, changes) {
  if (!form || !ids.length || ids.includes(form.id)) return null;
  const targets = form.controls.filter(c => ids.includes(c.id)), keys = Object.keys(changes);
  if (!targets.length || keys.some(k => k === 'Name' || /^(?:Anchor|Dock|Layout)/.test(k))) return null;
  if (!keys.some(key => MACOS26_PROPERTIES.includes(key)||['BackColor','ForeColor'].includes(key)||['TabIndex', 'TabPage', 'Index'].includes(key) || geometry.has(key) || targets.some(c => c.type === 'SSTab' && tabKeys.has(key) || collectionDefinition(c, key)))) return null;
  const next = structuredClone(form), selected = next.controls.filter(c => ids.includes(c.id));
  materializeTabPages(next);
  for (const target of selected) {
    validateMacOS26Properties({...target.properties,...changes},target.type);
    clearMacOS26ColorRoles(target.properties,changes);
    for (const [key, value] of Object.entries(changes).sort(([a], [b]) => (a === 'Tabs' ? -2 : a === 'Tab' ? -1 : 0) - (b === 'Tabs' ? -2 : b === 'Tab' ? -1 : 0))) {
      const p = target.properties;
      if (key === 'TabIndex') continue;
      if (key === 'Index') {
        if (value !== undefined && (!Number.isInteger(Number(value)) || Number(value) < 0 || Number(value) > 32767)) throw new Error('Index must be between 0 and 32767, or blank.');
        if (value === undefined) delete p.Index; else p.Index = Number(value);
        continue;
      }
      if (key === 'TabPage') {
        const parent = controlParents(next).get(target.id);
        if (parent?.type !== 'SSTab') throw new Error('TabPage requires an SSTab container.');
        p.TabPage = checkedTab(parent, value); continue;
      }
      if (collectionDefinition(target, key)) {
        p[key] = validateCollection(target, key, value);
        if (key === 'Columns') delete p.ColumnHeaders;
        if (key === 'Items') delete p.ListItems;
        continue;
      }
      if (target.type === 'SSTab' && tabKeys.has(key)) {
        if (key === 'Tabs') {setTabCount(next, target, value); continue;}
        if (key === 'Tab') {p.Tab = checkedTab(target, value); continue;}
        if (['Caption', 'Picture', 'TabEnabled', 'TabVisible'].includes(key)) {
          setTabEntry(target, activeTab(target), key.replace(/^Tab/, ''), key === 'TabEnabled' || key === 'TabVisible' ? value ? -1 : 0 : value); continue;
        }
        const [min, max] = key === 'TabOrientation' ? [0, 3] : key === 'TabsPerRow' ? [1, 32767] : key === 'Style' ? [0, 1] : [0, 300000];
        if (!Number.isInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new Error(`${key} must be between ${min} and ${max}.`);
        p[key] = Number(value); continue;
      }
      if (geometry.has(key)) {
        const n = Number(value), axes = resizeAxes({...target, properties: {...p, ...changes}}), dimension = key === 'Width' || key === 'Height';
        if (!Number.isFinite(n) || Math.abs(n) > 300000 || dimension && n < (target.type === 'Line' ? 0 : 15)) throw new Error('Invalid control geometry (twips).');
        if (key === 'Width' && !axes.x || key === 'Height' && !axes.y) {if (n !== p[key]) throw new Error(`${target.type} has a fixed ${key.toLowerCase()} in the designer.`);}
        p[key] = n; continue;
      }
      if (value === undefined) delete p[key]; else p[key] = structuredClone(value);
    }
  }
  if (Object.hasOwn(changes, 'Index')) {
    for (const target of selected) if (next.controls.some(c => c.id !== target.id && c.name.toLowerCase() === target.name.toLowerCase() && (c.properties.Index === undefined || target.properties.Index === undefined || c.properties.Index === target.properties.Index))) throw new Error('A control with this name and Index already exists.');
  }
  if (Object.hasOwn(changes, 'TabIndex')) setTabIndex(next, selected, changes.TabIndex);
  return next;
}
