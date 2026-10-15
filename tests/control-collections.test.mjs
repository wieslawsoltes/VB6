import test from 'node:test';
import assert from 'node:assert/strict';
import {ControlCollection, TreeNodes, ListItems, ColumnHeaders, ToolbarButtons, StatusPanels, TabItems, ImageItems, ControlArray} from '../src/controls/collections.js';
const error = n => e => e.number === n;
for (const Type of [ListItems, ColumnHeaders, ToolbarButtons, StatusPanels, TabItems, ImageItems]) {
  test(`${Type.name}: one-based insertion and stable keyed identities`, () => {
    const c = new Type(), a = c.Add(undefined, 'A', 'one'), b = c.Add(1, 'b', 'two');
    assert.equal(c.Item(1), b); assert.equal(c.Item('a'), a); assert.equal(a.Index, 2);
    b.Key = 'Renamed'; assert.equal(c.Item('RENAMED'), b); assert.throws(() => c.Item('b'), error(35601));
    assert.throws(() => {b.Key = 'a';}, error(35602)); assert.equal(b.Key, 'Renamed');
    c.Remove('Renamed'); assert.equal(b.Index, 0); assert.equal(a.Index, 1);
    b.Key = 'A'; assert.equal(c.Item('a'), a); c.Clear(); assert.equal(c.Count, 0); assert.equal(a.Index, 0);
  });
  test(`${Type.name}: failed insertion is atomic`, () => {
    let calls = 0; const c = new Type(() => calls++); c.Add(undefined, 'key', 'one');
    for (const index of [-1, 0.5, 3, NaN, Infinity]) assert.throws(() => c.Add(index, 'x', 'two'), error(35600));
    assert.throws(() => c.Add(undefined, 'KEY', 'two'), error(35602)); assert.equal(c.Count, 1); assert.equal(calls, 1);
    for (const index of [0, -1, 0.5, 2, NaN, Infinity]) assert.throws(() => c.Item(index), error(35600));
  });
}
test('collection batches notifications without losing mutations or exceptions', () => {
  let calls = 0; const c = new ControlCollection(() => calls++);
  assert.throws(() => c.batch(() => {c.insert({Key: 'a'}); c.batch(() => c.insert({Key: 'b'})); throw Error('stop');}), /stop/);
  assert.equal(calls, 1); assert.equal(c.Count, 2); c.insert({Key: 'c'}); assert.equal(calls, 2);
});
test('tree relational insertions affect siblings, not creation indices', () => {
  const t = new TreeNodes(), root = t.Add(undefined, undefined, 'r', 'Root'); root.Expanded = -1;
  const a = t.Add(root, 4, 'a', 'A'), b = t.Add(a, 2, 'b', 'B'), first = t.Add(b, 0, 'first', 'First'), previous = t.Add(b, 3, 'previous', 'Previous'), last = t.Add(first, 1, 'last', 'Last');
  assert.deepEqual(t.flattened().map(r => r.node.Key), ['r', 'first', 'a', 'previous', 'b', 'last']);
  assert.equal(first.Index, 4); assert.equal(root.Children, 5); assert.equal(root.Child, first);
  assert.equal(a.Previous, first); assert.equal(a.Next, previous); assert.equal(a.FirstSibling, first); assert.equal(a.LastSibling, last); assert.equal(last.Next, null);
  assert.equal(a.Root, root); assert.equal(a.FullPath, 'Root\\A');
});
test('tree moves preserve descendants and reject foreign relatives and cycles atomically', () => {
  const t = new TreeNodes(), a = t.Add(undefined, undefined, 'a', 'A'), b = t.Add(a, 4, 'b', 'B'), c = t.Add(b, 4, 'c', 'C'), d = t.Add(undefined, undefined, 'd', 'D');
  const snapshot = () => t.items.map(n => [n.Key, n.Parent?.Key, n.Index]); const before = snapshot();
  assert.throws(() => a.Move(c, 4), /Cyclic/); assert.throws(() => b.Move(b, 2), /itself/);
  assert.throws(() => b.Move(new TreeNodes().Add(), 4), error(35601)); assert.deepEqual(snapshot(), before);
  b.Parent = d; assert.equal(c.FullPath, 'D\\B\\C'); assert.equal(a.Children, 0); assert.equal(b.Index, 2);
  b.Move(undefined); assert.equal(b.Parent, null); assert.equal(c.Root, b);
});
test('tree selection is exclusive; EnsureVisible expands without selecting', () => {
  const visible = [], selected = [], t = new TreeNodes(undefined, n => selected.push(n?.Key ?? null), {onEnsure: n => visible.push(n.Key), pathSeparator: () => '/'});
  const root = t.Add(undefined, undefined, 'r', 'R'), a = t.Add(root, 4, 'a', 'A'), b = t.Add(a, 4, 'b', 'B');
  root.Selected = -1; assert.equal(b.EnsureVisible(), -1); assert.equal(b.EnsureVisible(), 0);
  assert.equal(root.Selected, -1); assert.equal(b.Selected, 0); assert.equal(b.FullPath, 'R/A/B'); assert.deepEqual(visible, ['b', 'b']);
  b.Selected = -1; assert.equal(root.Selected, 0); b.Selected = 0; assert.deepEqual(selected, ['r', 'b', null]);
});
test('tree removes a selected subtree once and permits key reuse', () => {
  let calls = 0; const t = new TreeNodes(() => calls++), root = t.Add(undefined, undefined, 'r'), child = t.Add(root, 4, 'c'), leaf = t.Add(child, 4, 'l'); leaf.Selected = -1;
  calls = 0; t.Remove('c'); assert.equal(calls, 1); assert.equal(t.Count, 1); assert.equal(t.selected, null); assert.equal(root.Children, 0); assert.equal(leaf.Index, 0);
  assert.throws(() => leaf.EnsureVisible(), error(35601)); assert.equal(t.Add(root, 4, 'l').Index, 2);
});
test('tree maintains stable sorted siblings without reordering the collection', () => {
  const t = new TreeNodes(undefined, undefined, {sorted: () => true}); const z = t.Add(undefined, undefined, 'z', 'Z'), a = t.Add(undefined, undefined, 'a', 'A');
  t.sort();assert.deepEqual(t.flattened().map(r => r.node.Key), ['a', 'z']); assert.equal(z.Index, 1); assert.equal(a.Next, z);
});
test('tree depth and subtree removal do not recurse or scan all nodes per descendant', () => {
  const t = new TreeNodes(); let n = t.Add(undefined, undefined, 'root'); const root = n;
  for (let i = 0; i < 12000; i++) {n.Expanded = -1; n = t.Add(n, 4, 'n' + i, String(i));}
  assert.equal(t.flattened().length, 12001); assert.equal(n.Root, root); t.Remove('n0'); assert.equal(t.Count, 1);
});
test('ListSubItems and indexed strings share one identity-preserving collection', () => {
  let calls = 0; const c = new ListItems(() => calls++), item = c.Add(undefined, 'r');
  item.setIndexed('SubItems', [3], 'Third'); assert.equal(item.ListSubItems.Count, 3); assert.equal(item.SubItems(3), 'Third');
  const sub = item.ListSubItems.Item(3); sub.Key = 'third'; sub.Text = 'Updated'; sub.ReportIcon = 2; assert.deepEqual(item.subItems, ['', '', 'Updated']);
  assert.equal(item.ListSubItems.Item('THIRD'), sub); item.ListSubItems.Remove(1); assert.equal(sub.Index, 2);
  assert.throws(() => item.setIndexed('SubItems', [0], 'bad'), error(35600)); assert.throws(() => item.setIndexed('SubItems', [1, 2], 'bad'), error(450));
  item.subItems = ['First', 'Second']; assert.equal(item.SubItems(2), 'Second'); assert.equal(item.SubItems(3), ''); assert.ok(calls > 5);
});
test('ListItems selection reflects properties, deletion and multiselect without EnsureVisible side effects', () => {
  const ensured = [], c = new ListItems(undefined, undefined, {multiSelect: () => true, onEnsure: i => ensured.push(i.Key)}), a = c.Add(undefined, 'a'), b = c.Add(undefined, 'b');
  a.Selected = -1; b.Selected = -1; assert.equal(c.selection.size, 2); c.select(a, true); assert.equal(b.Selected, 0);
  b.EnsureVisible(); assert.equal(c.selected, a); assert.deepEqual(ensured, ['b']); c.Remove('a'); assert.equal(c.selected, null);
  b.Selected = -1; c.Clear(); assert.equal(b.Selected, 0); assert.equal(c.selection.size, 0);
});
test('column width and alignment validate before insertion or mutation', () => {
  const c = new ColumnHeaders(), a = c.Add(undefined, 'a'); const revision = c.revision;
  for (const width of [-1, NaN, Infinity, 300001]) assert.throws(() => {a.Width = width;}, error(380));
  assert.throws(() => c.Add(undefined, 'b', 'B', 100, 3), error(380)); assert.equal(c.revision, revision); assert.equal(a.Width, 1440); assert.equal(a.SubItemIndex, 0);
});
test('toolbar menus expose independent keys and reactive properties', () => {
  let calls = 0; const c = new ToolbarButtons(() => calls++), b = c.Add(undefined, 'open', 'Open', 5), menu = b.ButtonMenus.Add(undefined, 'recent', 'Recent');
  const before = calls; menu.Enabled = 0; assert.equal(calls, before + 1); assert.equal(b.ButtonMenus.Item('RECENT'), menu);
  assert.throws(() => {b.Style = 6;}, error(380)); assert.equal(b.Style, 5);
});
test('empty and invalid control array bounds and indices fail explicitly', () => {
  const a = new ControlArray(i => a.items.set(i, {}), i => a.items.delete(i));
  assert.throws(() => a.LBound, error(9)); assert.throws(() => a.UBound, error(9));
  for (const n of [-1, 1.5, NaN, Infinity, 32768]) assert.throws(() => a.Load(n), error(380));
  a.Load(0); a.Load(32767); assert.equal(a.LBound, 0); assert.equal(a.UBound, 32767);
});

test('collection keys do not normalize VB type suffixes', () => {
  const c=new ListItems();for(const key of ['x','x$','x%','x&','x!','x#','x@'])c.Add(undefined,key,key);
  assert.equal(c.Count,7);assert.equal(c.Item('X$').Text,'x$');assert.equal(c.Item('X').Text,'x');
});
test('collection subscriptions release and preserve batched delivery', () => {
  const c=new ListItems();let count=0;const off=c.subscribe(()=>count++);
  c.batch(()=>{c.Add();c.Add();});assert.equal(count,1);off();c.Clear();assert.equal(count,1);
});
test('TreeView sort is an explicit operation, not an automatic insertion policy', () => {
  const c=new TreeNodes(),p=c.Add(undefined,undefined,'p'),z=c.Add(p,4,'z','Zulu'),a=c.Add(p,4,'a','Alpha');
  p.Sorted=-1;assert.equal(p.Child,a);assert.equal(a.Next,z);const b=c.Add(p,4,'b','Beta');assert.equal(z.Next,b);
  p.Sorted=-1;assert.equal(a.Next,b);assert.equal(b.Next,z);b.Text='ZZZ';assert.equal(b.Next,z);
  p.Sorted=-1;assert.equal(z.Next,b);assert.equal(b.Index,4);b.Parent={__nothing:true};assert.equal(b.Parent,null);
});
