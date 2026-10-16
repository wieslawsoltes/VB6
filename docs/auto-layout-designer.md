# Optional Auto Layout designer

Auto layout is a Studio extension, not an original Microsoft VB6 property. Enable
**Tools > Options > General > Layout Extensions > Enable anchoring and automatic
layout (this project)**. The strict Boolean `settings.anchoring === true` is the
single gate. The Auto Layout window, menus, gestures, properties, enum completion
and runtime members are unavailable when it is off. Turning it off preserves
inactive authored metadata. Existing projects are not enabled automatically.

## Panel and editing

The **Auto Layout** window is a normal dockable IDE tool, available through
**View > Auto Layout**. It follows the classic VB6 palette and the optional IDE
themes, without recoloring the application being designed. It can be docked,
floated and detached using the existing window manager. Disabling the project
option unregisters the tool, including a previously detached copy.

Select a form, visual container or child. The window contains:

| Group | Controls |
| --- | --- |
| Flow and sizing | Absolute, horizontal, vertical, both wrap directions, grid or either masonry direction; independent Fixed/Hug/Fill width and height; child min/max dimensions |
| Container spacing | Six main-axis distributions, item/baseline alignment, wrapped-line alignment, signed gaps, independent line/row gap, linked or four-sided padding |
| Grid | Fixed/Hug/weighted `fr` tracks, bounded repeat/minmax syntax, implicit tracks, row/column sparse/dense packing, explicit cells/spans and cell alignment |
| Responsive grid, direction and bindings | RTL/inherited direction, reverse flow/wrap, local length tokens, named areas and start/end line selectors |
| Child and constraints | Ignore auto layout, align-self, flex basis, grow/shrink weights, linked or four-sided margins, Anchor and Dock |
| Contents and order | Clip contents, first-on-top or last-on-top canvas stacking, ordered child selection and reparenting |

All geometric values use the project's existing **twip** convention. `-1` on an
individual inset inherits its linked value; `-1` line gap inherits Gap. Zero
maximum size is unlimited. `-1` flex basis uses the preferred size. A negative Gap
permits overlap; canvas stacking chooses which overlapping child appears above.

The nine-button alignment editor works for horizontal and vertical flows. The
Distribute field also exposes Space Between (automatic spacing), Space Around
and Space Evenly. Grid columns accept `1200 hug 1fr 2fr`; an empty Rows field means
implicit Hug rows. For per-track limits the same fields accept a JSON array, for
example `[{"size":"1fr","min":600,"max":1800},"2fr"]`. Input is data, not code;
invalid or oversized definitions are rejected before a model edit is published.
The fields also accept `repeat(3, minmax(600, 1fr))`. Fixed minmax upper limits
mean capped Hug, not full CSS intrinsic track sizing. Auto placement can proceed
by rows or columns, with optional dense hole filling. Dense changes placement,
not model order, tab traversal or canvas stacking. Explicit cells reserve their
whole spans before automatic placement, even when declared later. Explicit
outlying cells add implicit tracks; cells are no longer silently clamped.

Multi-selection fields show mixed values. Batch updates validate all selected
controls before changing any of them. Layout changes, nesting and ordering go
through normal project revision checks and Undo/Redo. Running or locked forms
cannot be edited. Existing OCX property validation is retained.

## Canvas interaction

**Shift+A** adds auto layout to a selected container, or wraps selected siblings
in a new borderless `LayoutFrameN` with inferred direction and gap. It preserves
control IDs, names, event source and child-parent identities. **Alt+Shift+A**
removes the selected container's flow without deleting the container or children.

Drag a child in a flow to reorder it. The insertion line and highlighted target
container show the destination. Drag into another container to reparent it;
world-space coordinates are retained when entering absolute layout. Cyclic
parenting is rejected. Arrow keys reorder flow children. The panel also has
Move Earlier, Move Later and Select Parent commands and a destination selector.

Free-position drag/resize displays edge, center, repeated-spacing and matching-
size guides. Hold **Alt** to bypass snapping; Alt-hover measures distances to a
sibling or the form. Insets and gaps have draggable, keyboard-accessible sliders.
Spacing drags preview solved control positions without writing the project;
release creates one history entry. Escape, pointer cancellation, lost capture,
window blur or a stale project revision cancels the gesture. Shift adjusts
spacing in 120-twip steps; otherwise it uses 15-twip steps. Alt on a padding
handle adjusts all four sides. The panel's **Show guides** option hides visual
guides but does not disable layout.

Grid outlines use solved cell rectangles, not the smaller control bounds.
Column and row rulers expose empty tracks as well as occupied ones. Drag a ruler
or focus it and use arrows to resize one track; Shift changes the step from 15
to 120 twips. The edited track becomes Fixed while all other track definitions
and limits are retained. Sliders expose and obey per-track minimum/maximum
sizes. Preview, cancellation and one-entry Undo/Redo have the same transactional
behavior as spacing edits. Only visible ruler handles (up to 1024 per axis) and
cell outlines (up to 4096) are realized. Explicit track editing is limited to the
first 1024 tracks and the 4096-character serialized definition limit.

Arrow keys on grid children move their cells instead of ineffectively reordering
them. A same-grid selection preserves relative cell offsets and model order.
Dragging into an empty grid cell gives it an explicit row/column. Cross-container
multi-drops pack selected spans without overlapping one another; deliberately
explicit overlaps with other children remain allowed. An empty grid with no
authored rows offers its first implicit row as a drop destination.

Repeated responsive rulers are read-only until **Expand Responsive Columns/Rows**
converts the current repeat count to ordinary authored tracks. This explicit Undo
transaction removes repetition, auto-fit collapse and relative length bindings on
that axis, retaining line names and track limits; it is not a promise to freeze
all child rectangles. Fixed tracks outside the repeat remain individually editable.
Masonry exposes only its lane rulers, not fictitious stacking-axis grid cells.

Named or negative selectors are preserved while editing properties. A direct cell
move materializes resolved positions/spans and clears the old name/area selectors,
so repeated arrows actually move the control. Cross-container moves likewise keep
the resolved span. RTL ruler movement follows its visible edge, and left/right
grid arrows follow visual direction. All operations retain ordinary Undo/Redo.

There is no Figma-file import or generic component variant system in this extension.

## Responsive templates, direction and masonry

Columns/Rows accept, for example:

```text
[start] repeat(auto-fit, [card] minmax(var(--card-min, 1200), 1fr)) [end]
300 repeat(auto-fill, 600 900) 300
calc(25% - 60) minmax(600, 2fr) 1fr
```

Auto-fill keeps empty tracks; auto-fit collapses unused repeated tracks and their
gutters. Counts are recomputed from the current content size. A repeat needs a
positive definite size/minimum, and each axis permits only one automatic repeat.
Bare numbers (and the parser's `px` spelling) use **twips in this adapter**, not
CSS pixels; use `1500` for a 100-pixel logical width. Percentages use available
container content size. The expression parser supports bounded arithmetic,
`min`/`max`/`clamp` and inherited `var` tokens, not arbitrary JavaScript or equations.

**Layout variables** is a JSON object such as `{"--card-min":1200}`. A nested
container inherits parent tokens and may override them locally. Cycles, unresolved
names without a fallback, invalid sizes/limits and resource overflows are errors.
Bindings affect track lengths only; they do not evaluate code or replace the
project's control/property model.

Legacy Column/Row fields remain zero-based. Start/end line fields use one-based
indices, negatives from the explicit end, names (`card 2`) and spans (`span 2`).
A negative end does not move when some other child creates a far-away implicit
track. Named areas use rectangular rows such as `"header header" "sidebar body"`;
children select their Area name. A dot denotes an unnamed cell. Invalid L-shaped
areas and unknown names are rejected before publishing a designer transaction.

**Direction** applies inherited LTR/RTL to managed geometry. It preserves physical
margins, Anchor/Dock meaning, text direction, source declaration order and tab
order. **Reverse order** reverses stack/wrap/masonry packing; **Reverse wrap lines**
reverses the cross-axis stacking of wrapped lines. Grid uses its own placement
rules instead of these flow-order switches.

**Masonry** packs vertically down columns; **Horizontal Masonry** packs across
rows. An item chooses the shortest contiguous lane range, with stable logical
index tie-breaking. Named/explicit lanes and lane spans are supported. Only the
lane axis may Fill; stacking sizes must be Fixed or Hug. Stacking-axis cells/spans,
rectangular areas and unsupported stacking distributions are explicitly rejected.
Gap separates lanes, while Line/row gap separates stacked cards. The nine-button
alignment board distributes lanes and aligns the whole stack. This algorithm is
independent of the CSS Grid Level 3 draft.

## Sizing and runtime

Fixed preserves the authored preferred dimension (subject to flex weights and
limits). Hug uses child content bounds and container spacing. The browser adapter
measures supported text controls with the installed canvas font metrics and
invalidates the cache on font loading and relevant text/font changes. Unknown
controls, including arbitrary OCX implementations, use their authored dimensions
unless an independent solver consumer supplies a measurement callback.

Fill takes the space allocated by its stack or grid parent. A parent cannot Hug
an axis while a participating child Fills the same axis: the designer/runtime
resolves that parent axis to Fixed, avoiding a circular size dependency. A manual
resize changes only the resized axis to Fixed. Wrapped cross-axis Hug sizing is
recomputed at allocated main-axis widths/heights. Hidden and ignored children do
not consume flow space; ignored children retain anchoring behavior.

The UI runtime uses the same solver, synchronous geometry and batched painting.
`SuspendLayout`, `ResumeLayout` and `PerformLayout` retain their existing contract.
Text changes, dynamic visible controls, reparenting and viewport/form resizing
invalidate the appropriate layout state. An unsuspended live layout-property
assignment that fails resolution restores both properties and last-good geometry,
including a parent sizing change made by the Hug/Fill compatibility rule. A
subsequent valid assignment can proceed. Suspension retains its scheduling
semantics: cross-property errors are deferred until ResumeLayout, not a general
transaction or automatic rollback of unrelated application data. The runtime does not modify saved
designer baselines. For example, after enabling the project extension:

```vb
Private Sub Form_Load()
    Me.SuspendLayout
    Frame1.LayoutMode = vbLayoutGrid
    Frame1.LayoutGridColumns = "1fr 2fr"
    Frame1.LayoutGap = 120
    Command1.LayoutWidthMode = vbLayoutSizeFill
    Command2.LayoutWidthMode = vbLayoutSizeFill
    Me.ResumeLayout True
End Sub
```

## Export coverage and explicit boundaries

`.vb6web` JSON, native-source layout companions, standalone HTML and Electron-
packaged EXEs retain the authored advanced layout properties. HTML embeds the
complete independent solver; no CDN or layout service is required.

The **freestanding PE32 compiler retains the previously validated anchoring,
docking and classic explicit-size stack/wrap subset**. Grid, intrinsic/Fill modes,
baseline/line alignment, negative gaps and the other advanced nondefault
properties are explicitly diagnosed on that target, rather than silently
approximated. Use the HTML/Electron target for those features. The licensed
Microsoft compiler still rejects the Studio layout extension. The separate
experimental compute target does not acquire advanced forms support here.

This is an independently implemented Figma-inspired interaction model, not
certification of every Figma layout rule or pixel/typography behavior. Stroke-
inclusive sizing, arbitrary component/variant binding, general equations and full
text shaping equivalence are not provided. Grid supports row/column sparse and
dense placement, named/negative selectors, areas, responsive tracks and explicit
resource limits. It does not implement subgrid, vertical writing modes, all CSS
intrinsic keywords or implicit tracks preceding the explicit origin. Masonry is
not CSS Grid Level 3 conformance.

Text measurement uses the active canvas shaper for whole candidate lines rather
than summing glyph widths. It preserves combining/emoji grapheme clusters, common
CJK punctuation boundaries, nonbreaking spaces, explicit newlines and zero-width
breaks. Long Latin words keep normal overflow behavior. The helper's emergency
grapheme breaking is opt-in and is not imposed on controls whose CSS does not use
it. Without Intl.Segmenter a reduced combining/emoji fallback is used. Full UAX #14,
complex-script line breaking, tab-stop parity, rich-text runs and exact browser
line-height/native-font parity remain outside this measurement adapter.

## Performance and validation

`@vb6/auto-layout` 0.4.0 is independent of the IDE and renderer. Anchoring uses
iterative graphs and reusable typed geometry/change buffers; unchanged roots
have a constant-time fast path. Unsaturated flex distribution is linear; capped
flex sorts saturation thresholds, avoiding repeated quadratic full-line scans.
Hug/wrap uses bounded convergence passes with explicit failure on nonconvergence.
Grid caches occupancy by revision and resolved template dimensions and avoids repeated whole-grid scans for
equal-shape dense items. Intrinsic spanning tracks redistribute growth after a
track reaches its cap. Text measurement has both an entry limit and an estimated
UTF-16 key-byte budget; oversized keys are not retained. Text input is limited to
1,048,576 UTF-16 code units and candidate shaping to 8,388,608 code units per call;
exceeding either limit produces an explicit error, never silent truncation.
Baseline metrics are available when alignment is inherited by a fixed-size
child. Runtime no-op layouts avoid control/stacking writes, and disposed layout
controllers cannot schedule new work through retained callbacks. Grid guide
geometry is cached by form revision. It is not a promise that every grid span,
measurement callback or whole-editor operation is linear or allocation-free.

Run `npm run test:layout`, `npm run test:layout:designer`, `npm run bench:layout`
and `npm run pack:layout`. The retained Validate workflow tests actual HTTP-origin
Chromium, Firefox and WebKit. The browser evidence names its transport; local
opaque-origin tests are not presented as HTTP verification. Benchmarks report
machine, sample count and median/p95, and exclude painting and whole-frame cost.
The package command extracts and tests both ES-module and browser-global builds;
it never publishes to npm.

Primary grid syntax references: [CSS Grid Level 1](https://www.w3.org/TR/css-grid-1/) and [CSS Flexible Box Layout](https://www.w3.org/TR/css-flexbox-1/). The limits and independent semantics above take precedence over those standards for this implementation.

Primary interaction references: [Figma auto layout guide](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout-in-Figma),
[horizontal and vertical flows](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout),
and [grid flow](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow).
The existing [anchoring guide](anchoring-layout.md) documents Windows Forms edge semantics.
