/** Common-control collections. Collection indices are one based; ListBox data
 * indices are intentionally handled elsewhere. Mutations validate before commit.
 */
import { VBError } from '../language/lexer.js';
import { lower } from '../core/core.js';

const fail = (message, number = 380) => { throw new VBError(message, number); };
export function controlInteger(value, min, max, number = 380) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n < min || n > max) fail('Invalid property value or index', number);
  return n;
}
const boolean = value => value ? -1 : 0;
const string = value => String(value ?? '');
const owner = new WeakMap(), ordinal = new WeakMap();
export function observable(item, key, value, onChange, convert = v => v) {
  let state = convert(value);
  Object.defineProperty(item, key, {enumerable: true, configurable: true,
    get: () => state, set: value => {const next = convert(value); if (Object.is(next, state)) return; state = next; onChange();}});
}
function properties(item, values, changed) {
  for (const [key, value] of Object.entries(values)) observable(item, key, value, changed);
  return item;
}

export class ControlCollection {
  constructor(onChange = () => {}) {
    this.items = []; this.onChange = onChange; this.keys = new Map(); this.revision = 0;
    this.depth = 0; this.dirty = false;
  }
  get Count() { return this.items.length; }
  changed() { this.revision++; if (this.depth) this.dirty = true; else this.onChange(); }
  batch(action) {
    this.depth++;
    try { return action(); }
    finally { if (!--this.depth && this.dirty) {this.dirty = false; this.onChange();} }
  }
  owns(item) { return !!item && owner.get(item) === this; }
  require(item) { if (!this.owns(item)) fail('Element not found', 35601); return item; }
  Item(key) {
    const item = typeof key === 'number'
      ? this.items[controlInteger(key, 1, this.Count, 35600) - 1]
      : this.keys.get(lower(string(key)));
    if (!item) fail('Element not found', 35601);
    return item;
  }
  index(key) { return this.Item(key).Index - 1; }
  insertion(index) { return index === undefined || index === 0 ? this.Count : controlInteger(index, 1, this.Count + 1, 35600) - 1; }
  checkKey(key, except = null) {
    key = string(key); const existing = key && this.keys.get(lower(key));
    if (existing && existing !== except) fail('Key is not unique in collection', 35602);
    return key;
  }
  insert(item, index) {
    const at = this.insertion(index), key = this.checkKey(item.Key);
    if (owner.has(item)) fail('Object already belongs to a collection', 35602);
    let currentKey = key;
    Object.defineProperty(item, 'Key', {enumerable: true, configurable: true,
      get: () => currentKey, set: value => {
        const next = this.owns(item) ? this.checkKey(value, item) : string(value);
        if (next === currentKey) return;
        if (this.owns(item)) {if (currentKey) this.keys.delete(lower(currentKey)); if (next) this.keys.set(lower(next), item);}
        currentKey = next; if (this.owns(item)) this.changed();
      }});
    Object.defineProperty(item, 'Index', {enumerable: true, configurable: true, get: () => ordinal.get(item) || 0});
    owner.set(item, this); if (key) this.keys.set(lower(key), item);
    this.items.splice(at, 0, item); this.reindex(at); this.changed(); return item;
  }
  reindex(start = 0) { for (let i = start; i < this.Count; i++) ordinal.set(this.items[i], i + 1); }
  detach(item) { if (item.Key) this.keys.delete(lower(item.Key)); owner.delete(item); ordinal.delete(item); }
  Remove(key) { const at = this.index(key); this.detach(this.items[at]); this.items.splice(at, 1); this.reindex(at); this.changed(); }
  Clear() { if (!this.Count) return; for (const item of this.items) this.detach(item); this.items = []; this.changed(); }
  [Symbol.iterator]() { return this.items[Symbol.iterator](); }
}

// Node.Index is collection order, independent of the display/sibling order.
const nodeState = new WeakMap();
export class TreeNodes extends ControlCollection {
  constructor(onChange, onSelect, options = {}) {
    super(onChange); this.onSelect = onSelect; this.options = options;
    this.roots = []; this.selected = null;
  }
  children(parent) { return parent ? nodeState.get(this.require(parent)).children : this.roots; }
  placement(relative, relationship = 2, moving = null) {
    const relation = controlInteger(relationship, 0, 4);
    const rel = relative === undefined || relative === null || relative === '' ? null
      : typeof relative === 'object' ? this.require(relative) : this.Item(relative);
    if (rel === moving && moving) fail('A node cannot be relative to itself');
    const parent = rel ? relation === 4 ? rel : rel.Parent : null;
    for (let n = moving ? parent : null; n; n = n.Parent) if (n === moving) fail('Cyclic node relationship');
    const siblings = moving ? this.children(parent).filter(n => n !== moving) : this.children(parent);
    const at = !rel || relation === 1 || relation === 4 ? siblings.length
      : relation === 0 ? 0 : siblings.indexOf(rel) + (relation === 2 ? 1 : 0);
    return {parent, at};
  }
  Add(relative, relationship = 2, key = '', text = '', image, selectedImage) {
    this.checkKey(key); const {parent, at} = this.placement(relative, relationship);
    const item = {Key: key, Tag: ''}, state = {parent, children: [], selected: 0};
    nodeState.set(item, state);
    const changed = () => {if (this.owns(item)) this.changed();};
    for (const [name, value] of Object.entries({Text: string(text), Image: image, SelectedImage: selectedImage,
      ExpandedImage: undefined, Bold: 0, Checked: 0, Expanded: 0, Sorted: 0, ForeColor: null, BackColor: null}))
      observable(item, name, value, changed, name === 'Text' ? string : ['Bold', 'Checked', 'Expanded', 'Sorted'].includes(name) ? boolean : v => v);
    Object.defineProperties(item, {
      Parent: {enumerable: true, get: () => state.parent, set: value => this.move(item, value, 4)},
      Selected: {enumerable: true, get: () => state.selected, set: value => this.select(value ? item : this.selected === item ? null : this.selected)},
      Children: {get: () => state.children.length},
      Child: {get: () => this.ordered(item)[0] || null},
      FirstSibling: {get: () => this.ordered(state.parent)[0] || null},
      LastSibling: {get: () => this.ordered(state.parent).at(-1) || null},
      Next: {get: () => this.sibling(item, 1)}, Previous: {get: () => this.sibling(item, -1)},
      Root: {get: () => {let n = item; while (n.Parent) n = n.Parent; return n;}},
      FullPath: {get: () => {const parts = []; for (let n = item; n; n = n.Parent) parts.push(n.Text); return parts.reverse().join(this.options.pathSeparator?.() ?? '\\');}}
    });
    item.Move = (relative, relationship = 4) => this.move(item, relative, relationship);
    item.EnsureVisible = () => {
      this.require(item); let expanded = false;
      this.batch(() => {for (let n = item.Parent; n; n = n.Parent) if (!n.Expanded) {n.Expanded = -1; expanded = true;}});
      this.options.onEnsure?.(item); return expanded ? -1 : 0;
    };
    this.batch(() => {this.insert(item); this.children(parent).splice(at, 0, item);});
    return item;
  }
  ordered(parent = null) {
    const children = this.children(parent);
    return (parent ? parent.Sorted : this.options.sorted?.())
      ? children.slice().sort((a, b) => a.Text.localeCompare(b.Text)) : children;
  }
  sibling(item, delta) {this.require(item); const siblings = this.ordered(item.Parent); return siblings[siblings.indexOf(item) + delta] || null;}
  move(item, relative, relationship = 4) {
    this.require(item); const {parent, at} = this.placement(relative, relationship, item);
    const previous = this.children(item.Parent), oldAt = previous.indexOf(item);
    if (parent === item.Parent && oldAt === at) return;
    previous.splice(oldAt, 1); nodeState.get(item).parent = parent; this.children(parent).splice(at, 0, item); this.changed();
  }
  select(item) {
    if (item) this.require(item); if (item === this.selected) return;
    if (this.selected) nodeState.get(this.selected).selected = 0;
    this.selected = item || null; if (item) nodeState.get(item).selected = -1;
    this.onSelect?.(this.selected); this.changed();
  }
  Remove(key) {
    const item = this.Item(key), removed = new Set(), stack = [item];
    while (stack.length) {const current = stack.pop(); removed.add(current); for (const child of nodeState.get(current).children) stack.push(child);}
    const siblings = this.children(item.Parent); siblings.splice(siblings.indexOf(item), 1);
    this.batch(() => {
      if (removed.has(this.selected)) this.select(null);
      for (const node of removed) {this.detach(node); nodeState.get(node).parent = null; nodeState.get(node).children = [];}
      this.items = this.items.filter(node => !removed.has(node)); this.reindex(); this.changed();
    });
  }
  Clear() {this.batch(() => {this.select(null); this.roots = []; for (const n of this.items) {nodeState.get(n).parent = null; nodeState.get(n).children = [];} super.Clear();});}
  flattened() {
    const result = [], stack = this.ordered().slice().reverse().map(node => ({node, depth: 0}));
    while (stack.length) {const entry = stack.pop(), children = this.ordered(entry.node); result.push({...entry, children: children.length});
      if (entry.node.Expanded) for (let i = children.length - 1; i >= 0; i--) stack.push({node: children[i], depth: entry.depth + 1});}
    return result;
  }
}

export class ListSubItems extends ControlCollection {
  Add(index, key = '', text = '', reportIcon, toolTipText = '') {
    const item = {Key: key, Tag: ''}, changed = () => {if (this.owns(item)) this.changed();};
    properties(item, {Text: string(text), ReportIcon: reportIcon, ToolTipText: string(toolTipText), Bold: 0, ForeColor: null}, changed);
    return this.insert(item, index);
  }
}
const listState = new WeakMap();
export class ListItems extends ControlCollection {
  constructor(onChange, onSelect, options = {}) {super(onChange); this.onSelect = onSelect; this.options = options; this.selected = null; this.selection = new Set();}
  Add(index, key = '', text = '', icon, smallIcon) {
    // Validate before creating subcollections or exposing any new object.
    this.insertion(index); this.checkKey(key);
    const item = {Key: key, Tag: ''}, state = {selected: 0}; listState.set(item, state);
    const changed = () => {if (this.owns(item)) this.changed();};
    item.ListSubItems = new ListSubItems(changed);
    properties(item, {Text: string(text), Icon: icon, SmallIcon: smallIcon, Checked: 0, Bold: 0, ForeColor: null, ToolTipText: ''}, changed);
    Object.defineProperties(item, {
      Selected: {enumerable: true, get: () => state.selected, set: value => this.select(item, !!value, !!this.options.multiSelect?.())},
      subItems: {enumerable: true, get: () => item.ListSubItems.items.map(sub => sub.Text), set: values => {
        if (!Array.isArray(values) || values.length > 10000) fail('Invalid subitems');
        const texts = values.map(string); item.ListSubItems.batch(() => {item.ListSubItems.Clear(); for (const value of texts) item.ListSubItems.Add(undefined, '', value);});
      }}
    });
    item.SubItems = n => {n = controlInteger(n, 1, 10000, 35600); return item.ListSubItems.items[n - 1]?.Text ?? '';};
    item.setIndexed = (name, args, value) => {
      if (lower(name) !== 'subitems') fail('Invalid indexed property', 438);
      if (args.length !== 1) fail('Wrong number of arguments', 450);
      const n = controlInteger(args[0], 1, 10000, 35600), text = string(value);
      item.ListSubItems.batch(() => {while (item.ListSubItems.Count < n) item.ListSubItems.Add(); item.ListSubItems.Item(n).Text = text;});
    };
    item.EnsureVisible = () => {this.require(item); this.options.onEnsure?.(item);};
    item.changed = changed;
    return this.insert(item, index);
  }
  select(item, selected = true, additive = false) {
    this.require(item); let dirty = false;
    if (selected && !additive) for (const previous of this.selection) if (previous !== item) {listState.get(previous).selected = 0; this.selection.delete(previous); dirty = true;}
    if (!!listState.get(item).selected !== selected) {listState.get(item).selected = selected ? -1 : 0; if (selected) this.selection.add(item); else this.selection.delete(item); dirty = true;}
    const focus = selected ? item : this.selected === item ? this.selection.values().next().value || null : this.selected;
    if (focus !== this.selected) {this.selected = focus; this.onSelect?.(focus); dirty = true;}
    if (dirty) this.changed();
  }
  clearSelection() {
    if (!this.selection.size && !this.selected) return;
    for (const item of this.selection) listState.get(item).selected = 0;
    this.selection.clear(); this.selected = null; this.onSelect?.(null); this.changed();
  }
  Remove(key) {const item = this.Item(key); this.batch(() => {this.select(item, false, true); super.Remove(key);});}
  Clear() {this.batch(() => {this.clearSelection(); super.Clear();});}
}
export class ColumnHeaders extends ControlCollection {
  Add(index, key = '', text = '', width = 1440, alignment = 0, icon) {
    const item = {Key: key}, changed = () => {if (this.owns(item)) this.changed();};
    properties(item, {Text: string(text), Icon: icon, Tag: ''}, changed);
    observable(item, 'Width', width, changed, value => {const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 300000) fail('Invalid column width'); return n;});
    observable(item, 'Alignment', alignment, changed, value => controlInteger(value, 0, 2));
    Object.defineProperty(item, 'SubItemIndex', {get: () => Math.max(0, item.Index - 1)});
    return this.insert(item, index);
  }
}
export class ButtonMenus extends ControlCollection {
  Add(index, key = '', text = '') {const item = {Key: key, Tag: ''}; properties(item, {Text: string(text), Enabled: -1, Visible: -1, Checked: 0}, () => {if (this.owns(item)) this.changed();}); return this.insert(item, index);}
}
const toolbarButtonState = new WeakMap();
export class ToolbarButtons extends ControlCollection {
  constructor(onChange, options = {}) {super(onChange); this.options = options;}
  validate(items) {
    try {this.options.validate?.(items);}
    catch (error) {if (error instanceof VBError) throw error; fail(error.message);}
  }
  changeButton(item, key, value) {
    const state = toolbarButtonState.get(item);
    value = controlInteger(value, 0, key === 'Style' ? 5 : 1);
    if (!this.owns(item)) {state[key] = value; return;}
    const changes = new Map([[item, {...state, [key]: value}]]);
    // VB grouped buttons are contiguous in collection order. Hidden buttons
    // remain members of their group, so showing one cannot reveal two choices.
    if (key === 'Value' && value === 1 && item.Style === 2) {
      const at = item.Index - 1;
      for (const direction of [-1, 1]) for (let i = at + direction; i >= 0 && i < this.Count && this.items[i].Style === 2; i += direction)
        changes.set(this.items[i], {...toolbarButtonState.get(this.items[i]), Value: 0});
    }
    this.validate(this.items.map(button => changes.has(button) ? {...button, ...changes.get(button)} : button));
    this.batch(() => {
      for (const [button, next] of changes) {
        const current = toolbarButtonState.get(button);
        if (current.Style === next.Style && current.Value === next.Value) continue;
        Object.assign(current, next); this.changed();
      }
    });
  }
  Add(index, key = '', caption = '', style = 0, image) {
    const at = this.insertion(index); this.checkKey(key);
    const item = {Key: key, Tag: ''}, changed = () => {if (this.owns(item)) this.changed();};
    const state = {Style: controlInteger(style, 0, 5), Value: 0}; toolbarButtonState.set(item, state);
    properties(item, {Caption: string(caption), Image: image, Enabled: -1, Visible: -1, ToolTipText: '', Description: '', MixedState: 0}, changed);
    for (const name of ['Style', 'Value']) Object.defineProperty(item, name, {enumerable: true,
      get: () => state[name], set: value => this.changeButton(item, name, value)});
    item.ButtonMenus = new ButtonMenus(changed);
    this.validate([...this.items.slice(0, at), item, ...this.items.slice(at)]);
    return this.insert(item, index);
  }
}
export class StatusPanels extends ControlCollection {
  Add(index, key = '', text = '', style = 0) {
    const item = {Key: key, Tag: ''}, changed = () => {if (this.owns(item)) this.changed();};
    properties(item, {Text: string(text), Style: style, Width: 1440, MinWidth: 0, AutoSize: 0, Alignment: 0, Enabled: -1, Visible: -1, ToolTipText: '', Picture: '', Bevel: 1}, changed);
    return this.insert(item, index);
  }
}
export class TabItems extends ControlCollection {
  Add(index, key = '', caption = '', image) {const item = {Key: key, Tag: ''}; properties(item, {Caption: string(caption), Image: image, Enabled: -1, Visible: -1, ToolTipText: ''}, () => {if (this.owns(item)) this.changed();}); return this.insert(item, index);}
}
export class ImageItems extends ControlCollection {
  Add(index, key = '', picture = '') {const item = {Key: key, Tag: ''}; observable(item, 'Picture', picture, () => {if (this.owns(item)) this.changed();}); return this.insert(item, index);}
}
export class ControlArray {
  constructor(load = null, unload = null) {this.items = new Map(); this.__type = 'ControlArray'; this.load = load; this.unload = unload;}
  Load(index) {if (!this.load) fail('Control array does not support Load', 438); return this.load(controlInteger(index, 0, 32767));}
  Unload(index) {if (!this.unload) fail('Control array does not support Unload', 438); return this.unload(controlInteger(index, 0, 32767));}
  Item(index) {const item = this.items.get(controlInteger(index, 0, 32767, 340)); if (!item) fail('Control array element does not exist', 340); return item;}
  get Count() {return this.items.size;}
  bound(last) {if (!this.Count) fail('Control array has no elements', 9); let result = last ? -Infinity : Infinity; for (const n of this.items.keys()) result = last ? Math.max(result, n) : Math.min(result, n); return result;}
  get LBound() {return this.bound(false);} get UBound() {return this.bound(true);}
  [Symbol.iterator]() {return [...this.items.entries()].sort((a, b) => a[0] - b[0]).map(v => v[1])[Symbol.iterator]();}
}
