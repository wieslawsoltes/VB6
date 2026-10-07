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
| Flow and sizing | Absolute, horizontal, vertical, both wrap directions or grid; independent Fixed/Hug/Fill width and height; child min/max dimensions |
| Container spacing | Six main-axis distributions, item/baseline alignment, wrapped-line alignment, signed gaps, independent line/row gap, linked or four-sided padding |
| Grid | Fixed, Hug or weighted `fr` tracks, implicit rows, explicit zero-based row/column, row/column spans and cell alignment |
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

Grid outlines currently show occupied child rectangles, not a separate editable
ruler for every empty track. The property fields edit empty tracks and manual
cell positions. There is no Figma-file import, variable binding or component
variant system in this extension.

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
invalidate the appropriate layout state. The runtime does not modify saved
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
inclusive sizing, variable/component binding, masonry, arbitrary constraint
expressions and full text shaping equivalence are not provided. Grid placement
is row-major with optional manual positions and explicit resource limits.

## Performance and validation

`@vb6/auto-layout` 0.2.0 is independent of the IDE and renderer. Anchoring uses
iterative graphs and reusable typed geometry/change buffers; unchanged roots
have a constant-time fast path. Unsaturated flex distribution is linear; capped
flex sorts saturation thresholds, avoiding repeated quadratic full-line scans.
Hug/wrap uses bounded convergence passes with explicit failure on nonconvergence.
Grid caches occupancy by revision. It is not a promise that every grid span,
measurement callback or whole-editor operation is linear or allocation-free.

Run `npm run test:layout`, `npm run test:layout:designer`, `npm run bench:layout`
and `npm run pack:layout`. The retained Validate workflow tests actual HTTP-origin
Chromium, Firefox and WebKit. The browser evidence names its transport; local
opaque-origin tests are not presented as HTTP verification. Benchmarks report
machine, sample count and median/p95, and exclude painting and whole-frame cost.
The package command extracts and tests both ES-module and browser-global builds;
it never publishes to npm.

Primary behavior references: [Figma auto layout guide](https://help.figma.com/hc/en-us/articles/360040451373-Guide-to-auto-layout-in-Figma),
[horizontal and vertical flows](https://help.figma.com/hc/en-us/articles/31289464393751-Use-the-horizontal-and-vertical-flows-in-auto-layout),
and [grid flow](https://help.figma.com/hc/en-us/articles/31289469907863-Use-the-grid-auto-layout-flow).
The existing [anchoring guide](anchoring-layout.md) documents Windows Forms edge semantics.
