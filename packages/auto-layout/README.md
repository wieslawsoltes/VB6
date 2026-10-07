# @vb6/auto-layout

**Version 0.2.0.** Renderer-independent anchoring and automatic layout, implemented in JavaScript with no dependencies. Use the ES module in a browser, worker, Node.js process, canvas renderer, or a UI adapter. The browser build exposes `VB6AutoLayout`; TypeScript declarations are included. This package does not depend on the VB6 IDE or runtime.

```js
import { LayoutEngine, AnchorStyles } from '@vb6/auto-layout';

const layout = new LayoutEngine([
  { id: 'editor', bounds: { x: 12, y: 12, width: 616, height: 420 },
    anchor: AnchorStyles.All, minWidth: 120, minHeight: 80 },
  { id: 'save', bounds: { x: 528, y: 450, width: 100, height: 30 },
    anchor: AnchorStyles.Right | AnchorStyles.Bottom }
], { width: 640, height: 492 });

const result = layout.arrange(960, 720);
for (let j = 0; j < result.changedCount; j++) {
  const index = result.changed[j];
  const id = layout.nodes[index].id;
  const bounds = layout.getBounds(id);
  // Apply bounds to the corresponding DOM, canvas or native view.
}
```

## Semantics

The four edge bits match Windows Forms: Top=1, Bottom=2, Left=4, Right=8. The default is Top|Left (5). Opposite edges stretch; a far edge preserves its distance; neither edge preserves the original offset from the center, rather than centering the control. All 16 masks are supported. Baselines are stable: shrinking below a minimum size and growing again does not erase the original margins. Geometry is not rounded by the solver.

`bounds` are parent-local logical coordinates. Root nodes have no parent; other nodes name a parent ID. Node input order need not be topological. A finite negative position is allowed; sizes and insets must be nonnegative. Zero or an omitted maximum means unlimited. Insets accept a scalar, CSS-order 1/2/4-element arrays, or a side-named object. Graph validation rejects duplicate IDs, missing parents and cycles without replacing a usable previous graph.

`DockStyle` adds Top, Bottom, Left, Right and Fill. Docking consumes space in **input/declaration order**, not WinForms' reverse control z-order. Fill receives space remaining at its own position. The VB6 adapter uses this same order. Anchored controls remain relative to their parent's client area, independently of docked siblings. Dock and Anchor exclusivity is a policy of the VB6 adapter; the standalone solver accepts both and gives an active Dock precedence.

Containers support `Absolute`, `Horizontal`, `Vertical`, `Wrap`, `VerticalWrap`
and `Grid`. Independent `widthMode` and `heightMode` are `fixed`, `hug` or `fill`.
Padding/margins accept four sides; gaps may be negative. `crossGap` controls wrapped
line/grid row spacing independently. `alignItems`, child `align`, `alignContent`
and `justify` select alignment and distribution, including text baselines.

Grid `columns`/`rows` accept a positive track count, a space-separated string, or
an array of fixed numbers, `hug`, `Nfr` and `{size,min,max}` records. A JSON-array
string is also supported for property editors. Empty rows are implicit Hug rows.
Child `gridColumn`/`gridRow` are zero-based; omission means automatic row-major
placement. `columnSpan`/`rowSpan` span cells, `justifySelf` overrides horizontal
alignment and `ignoreLayout` excludes a child from flow while retaining anchors.
The token `auto` is a documented alias of Hug in this independent grammar; it is
not the Figma grid editor's shortcut for `1fr`.

```js
const grid = new LayoutEngine([
  {id:'a', bounds:{width:100,height:30}, widthMode:'fill'},
  {id:'b', bounds:{width:100,height:30}, widthMode:'fill'}
], {width:600,height:100,layout:'Grid',columns:'1fr 2fr',gap:12});
grid.arrange(); // available width 588: a=196, b=392
```

A leaf can provide a pure `measure({width,height,widthMode,heightMode})` callback
returning `{width,height,baseline}` for intrinsic Hug sizing. Without it the caller
supplies `preferredWidth`/`preferredHeight` or authored bounds. The engine has no
DOM, font dependency or renderer. Reentrant mutation from measurement is rejected.
Hug-parent/Fill-child ambiguity uses the parent's authored size on that axis; UI
adapters may explicitly change that authored parent mode to Fixed. Measurement
and grid errors roll back public geometry and leave the engine dirty for retry.
There is no general constraint language, masonry or complete CSS/Figma engine.

## Mutation and rendering

`arrange` never rewrites design baselines. Use `rebase(id, bounds, client)` for a user/application move or resize. Use `update` for properties; non-topological updates validate one record and retain the graph and result buffers. `configure` updates root layout without recapturing child baselines. `setNodes` deliberately establishes a new graph. Do not mutate `nodes`, `options` or typed buffers behind the engine.

`arrange` returns a reusable object with a `Float64Array` of x/y/width/height tuples, a reusable `Int32Array` of changed node indices, and `changedCount`. `passes` reports the most recent arrange call, including zero on the unchanged fast path. The final extra rectangle is the root. Only the first `changedCount` indices are current. Copy data to retain an old frame. Painting, scheduling and pixel snapping belong to the adapter, not this library. Unchanged roots skip the pass in constant time. Changed roots use an allocation-free O(n) anchoring/docking pass. Unsaturated flex distribution is O(n); capped flex sorts breakpoints in O(n log n) worst case. Intrinsic trees use bounded convergence passes (at most 129 passes); expensive measurement and pathological manual grid placement remain caller/resource-bound work. Grid allows 1024 columns, 262144 rows and 1048576 occupied cells. Structure changes rebuild in O(n); depth is handled iteratively.

## Build, tests and packaging

From the repository root:

```sh
npm run build
npm run test:layout
npm run bench:layout
npm run pack:layout
```

`pack:layout` writes a local `.tgz` to `release/`, unpacks it into an isolated temporary directory and executes its public API. It does not publish to npm. The benchmark reports the machine/runtime, sample count, median and p95; it is not a fixed cross-machine performance guarantee.

Reference semantics: [Microsoft AnchorStyles](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.anchorstyles) and [Control.Anchor](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.control.anchor). This is an independent implementation, not a port of .NET Windows Forms.
