# @vb6/auto-layout

**Version 0.4.0.** Renderer-independent anchoring and automatic layout, implemented in JavaScript with no dependencies. Use the ES module in a browser, worker, Node.js process, canvas renderer, or a UI adapter. The browser build exposes `VB6AutoLayout`; TypeScript declarations are included. This package does not depend on the VB6 IDE or runtime.

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
`Grid`, `Masonry` and `HorizontalMasonry`. Independent `widthMode` and `heightMode` are `fixed`, `hug` or `fill`.
Padding/margins accept four sides; gaps may be negative. `crossGap` controls wrapped
line/grid row spacing independently. `alignItems`, child `align`, `alignContent`
and `justify` select alignment and distribution, including text baselines.

Grid `columns`/`rows` accept a positive track count, a space-separated string, or
an array of fixed numbers, `hug`, `Nfr` and `{size,min,max}` records. A JSON-array
string is also supported for property editors. Empty rows are implicit Hug rows.
Child `gridColumn`/`gridRow` are zero-based; omission means automatic placement. `gridAutoFlow` selects `row` (default),
`column`, `row dense` or `column dense`. Dense packing reuses holes without
reordering nodes, painting order or keyboard traversal. Explicit cells reserve
their entire spans before automatic placement; explicit overlaps are intentional.
Outlying explicit coordinates create implicit tracks rather than silently moving
a child back into the authored track range. `columnSpan`/`rowSpan` span cells, `justifySelf` overrides horizontal
alignment and `ignoreLayout` excludes a child from flow while retaining anchors.
`repeat(3, 120 minmax(40, 2fr))` expands bounded track lists. `minmax` accepts
fixed/auto minima and fixed/Hug/fractional maxima. A fixed maximum is a capped
Hug track, not CSS min-content/max-content sizing. Named lines, negative end
indices, named areas and bounded responsive expressions are described below.
Parsing is bounded to 4096 input characters, eight nested repeats and 1024 authored
or automatically expanded tracks; the separate implicit-grid row budget is larger.

Container `justify` distributes whole column tracks; `alignContent` distributes
rows. Cross-axis Stretch grows only Hug rows, redistributing growth when a row
hits its maximum. Child alignment is independent (`justifySelf` defaults to
Start). Single-row baseline alignment accounts for both ascent and descent.

The token `auto` is a documented alias of Hug in this independent grammar; it is
not the Figma grid editor's shortcut for `1fr`.

```js
const grid = new LayoutEngine([
  {id:'a', bounds:{width:100,height:30}, widthMode:'fill'},
  {id:'b', bounds:{width:100,height:30}, widthMode:'fill'}
], {width:600,height:100,layout:'Grid',columns:'1fr 2fr',gap:12});
grid.arrange(); // available width 588: a=196, b=392
```

`getGridLayout(id = null)` returns a detached snapshot of the last successful
solve. It contains the grid content rectangle, every resolved column/row (index,
start, size, min/max and implicit status), and each participating child's actual
cell rectangle and spans. Empty tracks and nested empty grids are represented;
empty Hug grids measure authored tracks, padding and gaps. Mutating the returned
snapshot cannot change the engine. Failed arrangements retain the last committed
snapshot together with public rectangles. Unknown IDs throw; non-grid nodes
return `null`.

A leaf can provide a pure `measure({width,height,widthMode,heightMode})` callback
returning `{width,height,baseline}` for intrinsic Hug sizing. Without it the caller
supplies `preferredWidth`/`preferredHeight` or authored bounds. The engine has no
DOM, font dependency or renderer. Reentrant mutation from measurement is rejected.
Hug-parent/Fill-child ambiguity uses the parent's authored size on that axis; UI
adapters may explicitly change that authored parent mode to Fixed. Measurement
and grid errors roll back public geometry and leave the engine dirty for retry.
There is no general equation solver, subgrid, CSS intrinsic keyword system or complete CSS/Figma engine.

## Responsive templates and named placement

```js
const responsive = new LayoutEngine([
  {id:'heading', gridColumnStart:'begin', gridColumnEnd:-1,
   bounds:{width:100,height:28}, widthMode:'fill'},
  {id:'card', bounds:{width:100,height:60}, widthMode:'fill'}
], {layout:'Grid', width:640, height:200, gap:12,
    columns:'[begin] repeat(auto-fit, [card] minmax(var(--minimum), 1fr)) [end]',
    layoutVariables:{'--minimum':140}, direction:'rtl'});
responsive.arrange();
responsive.arrange(960, 200); // recomputes count without editing the template
```

`auto-fill` retains unused tracks; `auto-fit` collapses unused repeated tracks and
adjacent gutters. Spanning cells keep all covered tracks occupied. Fixed prefix
and suffix tracks, multi-track patterns and line aliases are retained. One
automatic repeat per axis is permitted. Its pattern needs a definite positive
fixed size, maximum or minimum; `repeat(auto-fill, 1fr)` is rejected rather than
guessing. Zero/nonpositive resolved advances and excessive track counts fail
explicitly. Negative line indices refer to the **explicit** template boundary,
not a far-away implicitly placed child.

The original `gridColumn`/`gridRow` properties stay **zero-based**. New
`gridColumnStart`/`gridColumnEnd` and row equivalents use **one-based** lines,
negative indices from the end, named occurrences (`card 2`) and named/numeric
spans (`span card 2`, `span 2`). End lines are exclusive. Reversed definite
endpoints are normalized. Lines before the explicit starting boundary and two
indefinite named spans are diagnosed. Named selectors take precedence over the
legacy coordinate on their axis. Unknown line names are not silently ignored.

`gridTemplateAreas: '"header header" "sidebar body"'` declares rectangular
areas; a child selects `gridArea:'body'`. Dots leave cells unnamed. Explicit edge
selectors may override an area's edge, retaining the other edge. Ragged rows,
nonrectangular areas and unknown areas are errors. Area-generated
`header-start`/`header-end` aliases can also be used as line selectors.

Track sizes and limits accept percentages relative to the container content
extent and `calc`, `min`, `max`, `clamp`, and `var(--name, fallback)`. Arithmetic
supports addition/subtraction and multiplication/division by a unitless scalar.
There is no `eval`, stylesheet injection, URL loading or arbitrary JavaScript.
Numeric literals and the `px` spelling both denote the caller's logical unit.
`layoutVariables` accepts a plain record or JSON string. Tokens inherit through
containers with local overrides; this is length binding, not a generic component
variant system. Cyclic references, invalid resolved sizes/limits and excessive
expression work fail without publishing partial rectangles. Variable maps are
copied, at most 128 entries per local map and 256 inherited names; expression
nesting is bounded to 16 levels and evaluation to 4096 visits.

`direction` inherits from the parent (root defaults to LTR). RTL mirrors managed
horizontal geometry and logical Start/End while keeping physical margins, Anchor
and Dock semantics. It does **not** rewrite text direction, node order or tab
order. `reverse` reverses flow/masonry packing order; `wrapReverse` reverses wrapped
line stacking. Both leave the declaration list and design baselines unchanged.
Grid follows its own placement rules rather than these flow-order switches.

Grid snapshots additionally expose direction, named boundaries, collapsed status,
automatic-repeat kind and the original authored track index. Track metadata is
detached, including its nested name arrays.

## Masonry lanes

`Masonry` (6) packs down column lanes; `HorizontalMasonry` (7) packs across row
lanes. Existing mode numbers 0–5 are unchanged. Each item chooses the shortest
contiguous lane range capable of holding its span. Equal candidates use the
lowest logical lane index. Explicit/named lane positions, responsive lane counts,
limits, margins, padding, RTL and reverse packing are supported. The node list is
never reordered by the solver.

```js
const masonry = new LayoutEngine([
  {id:'a', bounds:{width:100,height:80}, widthMode:'fill'},
  {id:'b', bounds:{width:100,height:40}, widthMode:'fill'},
  {id:'wide', bounds:{width:100,height:60}, widthMode:'fill',columnSpan:2}
], {layout:'Masonry', width:640, height:400,
    columns:'repeat(auto-fill,minmax(140,1fr))',gap:12,crossGap:16});
masonry.arrange();
const lanes = masonry.getMasonryLayout();
```

Only the perpendicular axis has tracks. The stacking dimension is Fixed or Hug;
Fill, explicit stacking-axis cells/spans and rectangular named areas are rejected.
`gap` separates lanes, `crossGap` separates stacked cards. Whole-stack alignment
is Start/Center/End. `getMasonryLayout(id=null)` returns detached lanes, actual
card rectangles, content extents and probe counts, including empty containers.
A failed solve retains the last successful grid and masonry snapshots.

Packing computes sliding lane maxima with a monotonic deque. It is bounded by
1024 lanes and 8,388,608 probes, not an unqualified linear-in-card-count guarantee.
This is an independent shortest-lane algorithm, **not** CSS Grid Level 3 masonry
conformance. CSS writing modes, subgrid and generic component variants are outside
this package's contract. Text shaping is supplied by the consumer's measure callback.

## Mutation and rendering

`arrange` never rewrites design baselines. Use `rebase(id, bounds, client)` for a user/application move or resize. Use `update` for properties; non-topological updates validate one record and retain the graph and result buffers. `configure` updates root layout without recapturing child baselines. `setNodes` deliberately establishes a new graph. Do not mutate `nodes`, `options` or typed buffers behind the engine.

`arrange` returns a reusable object with a `Float64Array` of x/y/width/height tuples, a reusable `Int32Array` of changed node indices, and `changedCount`. `passes` reports the most recent arrange call, including zero on the unchanged fast path. The final extra rectangle is the root. Only the first `changedCount` indices are current. Copy data to retain an old frame. Painting, scheduling and pixel snapping belong to the adapter, not this library. Unchanged roots skip the pass in constant time. Changed roots use an allocation-free O(n) anchoring/docking pass. Unsaturated flex distribution is O(n); capped flex sorts breakpoints in O(n log n) worst case. Intrinsic trees use bounded convergence passes (at most 129 passes); expensive measurement and pathological manual grid placement remain caller/resource-bound work. Grid allows 1024 columns, 262144 rows and 1048576 requested occupied cells (overlaps count toward this budget). Placement is also bounded by 8388608 probes; repeated equal-shape dense placement caches monotonic search positions instead of rescanning the whole grid. Structure changes rebuild in O(n); depth is handled iteratively.

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
