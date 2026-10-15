# Browser control compatibility

This implementation concerns `src/controls` and its browser runtime, designer,
export and language-service integrations. It incorporates main
`638b5f4a6e5e9feda7e30b435a3720124725ff7c` (including PR #128's macOS theme and
navigation changes), without replacing the native Win32/AppKit exporters.

## Implemented contracts

| Area | Behavior |
| --- | --- |
| Collections | Strict one-based indices; case-insensitive, unique keys; stable item identity; read-only indices; atomic validation; batched notifications; removal/disposal ownership. |
| Intrinsic lists | ListBox/ComboBox zero-based indices, stable sorted insertion, ItemData/selection identity, NewIndex, removal remapping and input-state guards. |
| TreeView | All five relative Add placements, creation-order indices independent of sibling order, snapshot sorting, cycle-safe Move, hierarchy/sibling/path navigation, selected-node identity, nonselecting EnsureVisible, checkboxes, ImageLists, keyboard/typeahead and label editing. |
| ListView | Icon, small-icon, list and report layouts; ListSubItems and indexed SubItems; image subscriptions; independent keyboard focus, extended selection, checkbox events, search/hit testing, visible counts, header resize/reorder, application-owned ColumnClick sorting and label editing. |
| Grids | Sparse row/column data, two-axis realization, fixed rows/columns, zero-height hidden rows, variable sizes, keyboard/pointer range selection, indexed geometry/alignment/data, cell formatting, FillStyle and selection-bounded Clip, retained cells and transactional editing. |
| Toolbar | Six distinct button styles, exclusive contiguous button groups, check/value state, disabled/hidden items, image lists, keyboard navigation, per-button menus and owned popup lifetime. |
| StatusBar | Normal/simple modes, keyed panels, alignment, bevels, width/autosize, indicators, timers, images, panel click/double-click events and disposal. |
| Date controls | Validated OLE dates and min/max bounds; leap/month stepping; nullable DTPicker; localized/custom formatting and parsing; typed VB callbacks; owned dropdowns; contiguous MonthView ranges, visible dates/day-bold callbacks, keyboard navigation and up to twelve panels. |
| CommonDialog | Browser-owned color/font editors with atomic acceptance, preview, validation, OLE RGB conversion and CancelError 32755. Open/save cancellation and FileTitle handling are retained. |
| Language/runtime | Shared constants, indexed-property contracts, completion types, event signatures/designer event menus, typed Boolean collection members, nullable date dispatch and bounded agent access. DTPicker's Format property and Format event remain distinct. |

### Rendering and lifetime

Collections and sparse data models are separate from their views. Tree and list
controls retain visible row nodes; the grids use prefix offsets and binary search
for visible rows/columns, including hidden rows and fixed headers. Rendering is
bounded by the viewport rather than the total item count. Selection-only changes
do not replace the clicked grid cell, preserving genuine double-click editing.

Image-list subscriptions, resize observers, timers, pointer captures, label
editors and popup ownership are released by their owning controls. Disabled,
hidden, design-mode or paused controls cannot use browser input callbacks to
bypass programmatic state checks.

Label editing uses the real VM event loop and ByRef cancellation/normalization.
Application changes or removal during callbacks are not overwritten. Slow-click
editing respects automatic/manual LabelEdit; explicit StartLabelEdit remains
available without deadlocking a currently executing VB procedure.

### Validation

Run `npm run build`, `node --test tests/control-*.test.mjs`, and
`python tools/browser-control-compatibility-tests.py`. The browser suite also
accepts `--browser chromium`, `--browser firefox`, or `--browser webkit`; the
maintained Validate workflow owns it in the existing three-engine controls
integration matrix. It uses the production RuntimeAPI, parser, VM, host and
current built CSS, not substitute controls or test-only styles.

Each browser attempt retains its report, hashes and failure screenshots under
`reports/control-compatibility/<engine>/<attempt>/`. A separate `latest.json`
points to the newest result; rerunning does not erase previous failures. The
suite covers actual pointer and keyboard input, VB event callbacks, editing,
modal cancellation, image ownership and 50,000-item lists / 12,000-root trees /
10,000-by-100 grids with explicit realization bounds. These are behavior and
realization checks, not a frame-rate benchmark or native pixel-equality claim.

Build products are checked against the reviewed `tools/ide-artifacts.json`
fingerprints. The full Validate workflow, including its fail-closed aggregate
job, remains required at the final integrated head. Local SDK-dependent skips
are not counted as native-platform verification.

## Remaining compatibility boundaries

This is a substantial controls increment, **not complete Microsoft VB6/OCX API
or native-pixel parity**. In particular, it does not complete:

- MSChart's complete chart/axis/series hierarchy and all chart types, hierarchical
  MSHFlexGrid bands, every grid merge/sort/format option, or all legacy common-
  control properties and event-order edge cases.
- Arbitrary native OCX/COM hosting, rich-text embedded OLE formats, native drag
  images, OS printer/font enumeration and every CommonDialog flag/help/hook.
- Native custom date-format parsing callbacks beyond the explicitly implemented
  formatting/day-bold contracts, every IME/locale/date-parser behavior, or exact
  OS common-control text/graphics rasterization.
- External database/provider services or changes to native Win32/AppKit control
  implementations. Existing native and provider validation is preserved but does
  not certify those separate subsystems against every browser feature above.

New public APIs should be added to `compatibility-contract.js` and
`control-type-catalog.js` together, with model, actual VM dispatch and browser
input regressions. Unsupported boundaries must not be silently reported as
complete or inferred from a successful build.

## Reference contracts

Microsoft's Visual Studio 6.0 Windows Controls documentation: Add for Nodes
(`aa443386`), ListItems (`aa443222`), ListSubItems (`aa443223`), ColumnHeaders
(`aa443195`), Buttons (`aa443104`) and ButtonMenus (`aa443211`), and the related
Sorted, Clip, date-format, MinDate/MaxDate and GetDayBold documentation. An
archived Microsoft-authored copy is available at
https://ok5nw.nagano.cz/vb6/language_reference/methods/methods_a.pdf and the sibling
`properties/` and `events/` reference directories. Nodes use creation-order
indices separately from sibling/display order, with tvwNext as the default
relationship. Tree sorting is a snapshot operation; grid Clip writes are bounded
by the selected rectangle. No Microsoft source, native artwork or font files are
incorporated.
