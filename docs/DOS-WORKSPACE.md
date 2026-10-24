# DOS / TUI workspace

Enable **Tools > Options > General > Workspace mode > DOS / TUI**, or
**View > DOS / TUI Workspace**. **Tools > DOS Workspace Options** configures the
palette, cell metrics, form display, graphics projection and editor presentation.
Classic remains the default. Options are staged until OK; Cancel changes nothing.
Classic, Figma and DOS are mutually exclusive presentations of the same project.

## Shared authority and lifetime

The existing VB6 form, properties, source, bindings, auto-layout, anchors, controls,
commands, inspector and undo history remain authoritative. Presentation does not
create a second form model, text buffer, event dispatcher or language service.
Canvases are `aria-hidden` and `pointer-events:none`. Original controls retain
keyboard, pointer, focus, accessibility and text-editing ownership.

`src/rendering/invalidation.js` carries optional materialization notifications
from BrowserControl/BrowserForm refresh and retained graphics. Property-only
`input.value`, selection and drawing changes repaint without polling or model
copies. Bounded primitive-property projection does not invoke accessors or expose
the VM/collections. Mutation, resize, selection, input, font and device-scale
notifications coalesce at animation-frame boundaries. Idle trees do not repaint
continuously. The cell caret is steady, not driven by a perpetual blink timer.

Each ApplicationHost stage is an ownership boundary, including classic hosts.
Sibling/nested applications may use different palettes or remain native. Removed
or adopted controls, detached roots and host disposal retire their subscriptions,
canvases, input/style leases, cached glyphs and owned popups. A document shares
one root-lifetime observer. Stylesheet and ResizeObserver subscriptions use
independent leases, so disposing one painter cannot disable its sibling.

`src/rendering/presentation-portals.js` associates existing menus, combo lists
and runtime dialogs with their opener. Their original navigation and event code
remains in use; palette and lifetime follow the owning host. The retained HTML/GPU
scene treats cell-painted regions as native islands rather than painting over
TUI output. This contract does not certify every GPU/backend/device combination.

Node-scoped collection-metric and designer-grid providers in `src/rendering`
let a presentation request visual row/column spacing from the existing widgets
and designer. Providers have independent, reversible leases; callbacks update
the original materialized geometry without storing presentation data in a project.

## Character buffers and allocation

`CellBuffer` stores Unicode scalar glyphs, packed EGA16 foreground/background and
four text-style bits: bold, italic, underline and strikethrough. Damage includes
style-only changes. Clip stacks, mnemonic text, overlap-safe blits and detached
snapshots share the same bounded storage. A composed back buffer is diffed into
retained front-buffer rows. `CanvasCellRenderer` rasterizes only damaged spans
through a shared bounded LRU atlas. Glyph keys include the actual palette, device
size, opacity and style bits.

`FrameCellRenderer` uses four transparent perimeter strips. Raster storage scales
with perimeter, not window area. Trailing strips sit at the true pixel extent so
partial final cells cannot cut off frame corners. The logical export buffer is
still dense. Interior controls are never obscured by a full opaque frame canvas.

Device scaling rounds absolute cell edges, preventing accumulated pitch drift.
Partial trailing cells are clipped rather than stretching the grid.
`CanvasCellRenderer.setExtent(width, height)` bounds the backing bitmap to the
native viewport while preserving the cell pitch. CSS and bitmap extents agree,
so presentation cannot create an extra scrollbar or change the scrollport it
reads. Screen export derives pitch from the logical raster extent, not from
dividing a cropped viewport by the rounded-up cell count. Source
editors use their measured column/line pitch. Collection, popup and control
projections account for borders, scrolling and ancestor scaling.

The combined control/chrome/text-view surface budget per root is **16,777,216
device pixels**, including concurrently displayed dialogs. Each ordinary canvas
is limited to 4,194,304 pixels. The default atlas holds at most 2,048 tiles and
1,048,576 pixels. Raster-projection scratch surfaces are limited to 524,288 samples.
Core buffers, text traversal and screen imports have separate cell/source limits.
Validation precedes allocation/cache eviction. Oversized or unavailable regions
retain their native paint and can recover after resize/invalidation. Palette and
metric changes retire old surface allocations before accounting for new ones.

`src/tui/raster.js` and `letterforms.js` contain independently authored geometric
and letter stroke recipes: printable ASCII, non-NUL CP437 display characters,
Polish accents, additional Latin/Greek/math symbols and algorithmic Braille.
Supported glyphs do not depend on installed fonts. Other Unicode uses the browser
rasterizer. These masks are neither a copied VGA ROM nor a certified vendor font.
No font files, DOS binaries or vendor assets are distributed by this feature.

## Form display and designer geometry

**Readable form display** derives bounded, independently scaled horizontal and
vertical density from existing captions and control heights. It expands display
space uniformly within a form instead of silently truncating ordinary command
labels. Caption scanning is bounded; expansion is capped at 3x horizontally and
2x vertically. Form contents, existing controls and designer overlays share the
same transform. No authored twips, application layout or history is rewritten.
Very long captions can still exceed the bounded display area.

Pointer mapping, selection bounds, anchor guides and drag/resize coordinates use
`src/rendering/coordinate-space.js` to invert the actual materialized scale,
including designer zoom, cell-density transforms and host scaling. Form/window
and designer scroll extents accommodate the display transform. **Authored form
display** retains original hit rectangles. Switching modes restores owned CSS.
IDE DOS mode defaults to readable display; an embedded ApplicationHost defaults
to authored geometry unless `formLayout: 'readable'` is explicitly selected.

**Tools > DOS Workspace Options > Designer grid** selects **Project grid**
(the default) or **Character cells**. Character-cell dimensions map through the
readable-form scale into the shared designer coordinate system. Pointer drawing,
movement and resizing, free auto-layout gestures and keyboard movement use the
horizontal and vertical cell pitch. Authored project twips, constraints and undo
history remain canonical; Ctrl/Command+arrow retains the one-pixel fine step.

The existing Show Grid option controls visibility. Empty designer backgrounds
use logical cell markers so sparse grid dots survive cell projection; pictures
and authored drawing retain the ordinary graphics path. Changing presentation
or disposing DOS mode restores the project grid.

## Control and workspace coverage

All 40 built-in toolbox controls have explicit paint capabilities, plus Form/MDIForm.
Label, TextBox, CommandButton, CheckBox, OptionButton, ComboBox, ListBox, ranges,
ProgressBar, Slider, filesystem lists, TreeView/ListView, grids, toolbar/status
panels, dates, Data/Adodc and design-time nonvisual controls have cell painters.
Form, Frame, PictureBox and tab containers retain their original ownership and
child structure while chrome, tabs and materialized graphics receive cell paint.
Image and MSChart support raster projection. WebBrowser, OLE and unknown OCXs
remain explicit native interactive surfaces, not empty substitute controls.

TreeView, ListView, MSFlexGrid, MSHFlexGrid and DataGrid use the presentation's
row/header pitch in both their native layout and cell painter. Logical scroll
positions, virtual extents, header placement and keyboard reveal follow that
same geometry. Metric changes retain an active grid editor and its native input
identity. Authored row-height properties remain unchanged; releasing the
presentation restores the original layout metrics and owned styles.

Intrinsic Shape supports six shape kinds, eight fill patterns and dashed/dotted
perimeters; cell aspect is considered for circles/squares. Range orientation,
vertical progress, mnemonics, default/pressed/focused/disabled states and password
masking come from the canonical materialized control. Geometry and hit targets
remain aligned with the presentation transform.

Workspace chrome covers menus, command bars, toolboxes, project/property rows,
dock/document titles, tab headers, Object Browser, dialogs, debugger/watch values,
Immediate input and output transcripts. Shell track/row-height leases preserve
existing docking state and collapsed sides. Virtualized tool lists use the same
row pitch as their painter, including keyboard scrolling and spacer bounds.
Text transcripts retain native selection even when another input owns focus.
Native theme-preview examples intentionally preserve the appearance being previewed.

The shell is still laid out by HTML. It is not a single hardware character-grid
window manager, and arbitrary hosted content is not globally quantized.

### Function keys and pane navigation

The bottom command strip presents F1 through F10. Holding Shift, Ctrl or the
platform Meta modifier shows the corresponding existing IDE shortcuts: definition
and position navigation, bookmarks, debug stepping, watches, code/form views and
document commands. Shift+F2 runs Go to Definition; Ctrl+Shift+F2 runs Last Position
when navigation history is available. Unassigned modified
keys remain empty. The original source editor, menu and debugger continue to own
those keyboard bindings. Strip clicks call the same `ide.command` dispatcher and
recheck live menu availability before acting. Disabled commands and keyboard focus
use the active palette's own cell attributes.

F6 moves to the next visible docked pane or document; Shift+F6 moves backward.
Each pane remembers its last native focus target, preserving the original source
selection and input element. Hidden/inert panes, minimized documents, disabled
fields and removed targets are skipped. Dialogs and open pickers retain their
keyboard ownership. Ctrl+F6 and Ctrl+Shift+F6 keep the existing MDI document cycle.
The View menu also exposes the two pane commands.

The function strip is one keyboard tab stop. Left/Right, Home and End navigate
available commands, Enter/Space activate the focused button, and Escape returns
to the previously focused pane. Detached IDE windows receive their own strip and
modifier state. Blur clears held modifiers; switching presentations or closing
an owning window removes its strip and listeners. No polling loop, separate
editor buffer, authored project metadata or undo entry is introduced.

## Text, rich text and the optional advanced editor

TextBox and editable ComboBox project native UTF-16 selections, supplementary
characters, tabs, CRLF, wrapping, scrolling, alignment and a block caret. Password
snapshots contain masked glyphs. Original input, clipboard, IME, undo and VB6 events
remain authoritative. Complex shaping, bidirectional text and composition expose
the original editor rather than guessing a visually incorrect scalar order.
Empty and trailing-empty aligned lines keep a visible insertion caret; selecting
a newline extends the selection without moving the line's aligned text.

RichTextBox projects actual DOM run geometry and selection through
`src/tui/rich-text.js`; it does not parse or edit a second RTF document. EGA color
and bold/italic/underline/strikethrough are represented in the cell style plane.
The fixed-pitch TUI presentation deliberately normalizes font metrics; original
RTF formatting data and native restoration remain intact. This is not an exact
projection of every possible proportional font size or embedded RTF object.

Classic VB6/XAML source uses its own measured token/line geometry, execution and
gutter indicators, source selection and virtual textarea. The optional Monaco
editor exposes a trusted node-scoped provider through
`src/rendering/text-view.js`. Its independently bundled adapter reads real visible
ranges, tokens, folds, selections, carets and breakpoint/execution decorations.
The same Monaco models and IDE history service handle real editing and split views.
Presentation settings are leased and reapplied after normal appearance updates;
disabling TUI restores the previous editor settings.

The advanced minimap is sampled from its own materialized canvas into Braille
cells without replacing minimap navigation. Existing scrollbar and popup/widget
hit targets remain active through transparent paint regions. Complex shaping and
composition use the genuine native editor. Synthetic composition lifecycle tests
are not certification of an operating-system IME or candidate window. Arbitrary
third-party widgets and inlay content may retain native paint.

## In-application pickers

Collapsed select, date and color fields can open bounded, owner-scoped TUI popups.
Original values are committed through one input/change pair after actual user
activation. Cancellation does not change the field. The browser's default popup
is suppressed only for the owned field while the TUI popup is active.

Select navigation skips disabled options and disabled optgroups, supports
arrows/Home/End/Page keys and type-ahead, and retains the original field identity.
Calendar navigation uses strict ISO dates in years 1 through 9999, UTC civil-date
arithmetic, leap-day/month-end clamping, keyboard movement and native min/max
validation. Color dialogs expose EGA swatches plus validated full RGB hex entry.
Popup close, presentation switch and host disposal restore listeners and focus.
These are in-application picker presentations, not replacements for privileged
OS file dialogs, clipboard permissions or foreign-origin content.

## Graphics

**Half-block cells** sample 1x2 colors per character. **Braille cells** sample
2x4 and cluster to foreground/background using Unicode dot ordering. **Native
graphics** restores the existing drawing surface. Alpha is composited before EGA
quantization. Centered object-fit and nonstretched images retain canonical bounds.
The pure projection API supports ordered dithering. Drawing invalidation observes
the retained raster without a second command model or mandatory GPU readback.
These are lossy display projections, never claims of native-pixel equality.

Unloaded, tainted or unavailable images fall back to native paint. No sandbox,
CSP, origin, OCX, media or filesystem permission is bypassed to obtain pixels.

## APIs and export

```js
await vb6Studio.dosMode.configure({
  mode: 'dos', profile: 'commander', cellWidth: 8, cellHeight: 16,
  formLayout: 'readable', graphics: 'braille', editing: 'cells'
});
const snapshots = vb6Studio.dosMode.snapshot();
const screen = vb6Studio.dosMode.sessions.get(document).screen();
await vb6Studio.dosMode.configure({mode: 'classic'});

const host = await VB6Runtime.mountApplication(project, container, {
  presentation: {mode: 'dos', profile: 'turbo', formLayout: 'authored'}
});
host.setPresentation({mode: 'dos', profile: 'win31', graphics: 'native'});
host.dispose();
```

Profiles: `turbo`, `commander`, `win31`, `monochrome`. Graphics: `blocks`, `braille`,
`native`. Editing: `cells`, `native`. Form layout: `readable`, `authored`.
Legacy settings are normalized. Workspace preferences are not silently written
into authored projects. F5/Immediate preview passes validated presentation
attributes through the existing trusted runtime-document loader. Opaque-origin
preview sandboxes are preserved; native loader refusal never falls back to a
less-restricted document. Direct ApplicationHost construction shares the same
presentation lifetime as `mountApplication`.

`VB6Runtime.RuntimeAPI.TUI` and `src/tui/api.js` expose the dependency-free cell,
text, graphics, screen and extension contracts. Importing them acquires no global
DOM resources. Register custom painters before mounting through
`vb6Studio.dosMode.registry.register(type, painter, {capability: 'cells'})`;
registration returns an idempotent disposer. Unknown controls remain native.
`registerTextView(node, {read, subscribe, configure})` is a trusted same-document
extension, not an untrusted IPC interface. Replacing a provider retires the old
binding without letting an old disposer remove the replacement.

**Tools > Export DOS Screen** downloads JSON, ANSI, plain text or B800 pairs.
Commands: `dosExportJSON`, `dosExportANSI`, `dosExportText`, `dosExportB800`.

```js
const {TUI} = VB6Runtime.RuntimeAPI;
const cells = new TUI.CellBuffer(80, 25, {foreground: 14, background: 1});
cells.frame(0, 0, 80, 25, {double: true, title: 'Application'});
cells.put(2, 2, 'A', 14, 1, 5); // Bold + underline.
const restored = TUI.deserializeScreen(TUI.serializeScreen(cells));
const ansi = TUI.serializeANSI(restored);
const b800 = TUI.serializeB800(restored, {unmappable: 'error', styles: 'discard'});
```

JSON (`vb6-tui-screen`, version 1) validates dimensions, payload lengths, Unicode
scalars, EGA attributes and optional style bytes before publication. ANSI SGR is
generated from bounded attributes/style bits; text cannot inject C0/C1/escape
commands. B800 is character/attribute data, not executable or a VGA emulator.
Non-CP437 characters replace with `?` by default or throw with `unmappable:'error'`.
Style flags are discarded by default or rejected with `styles:'error'`; B800
cannot represent rich styles. Bright backgrounds are colors, not VGA blinking.

`screen()` quantizes visible owned control/chrome/text-view layers with ancestor
clipping and ordering. Layer-relative clipping preserves partial first rows.
Native/opaque content is absent, and independent surface origins and pitches can
lose detail. This is a logical TUI capture, not a browser-compositor screenshot
or exact reconstruction of a globally aligned hardware screen.

## Validation and fidelity scope

```sh
node --test tests/tui-*.test.mjs
npm run build
npm run verify:ide-artifacts
npm test
python tools/ci/check.py
python tools/dos-browser-tests.py
VB6_BROWSER=firefox python tools/dos-browser-tests.py
VB6_BROWSER=webkit python tools/dos-browser-tests.py
VB6_ORIGIN=file python tools/dos-browser-tests.py
# After the normal optional pinned-editor build:
python tools/browser-tui-advanced-tests.py
```

The DOS suite belongs to the dedicated cross-engine `tui-authoring` group;
optional-editor TUI tests belong to `advanced-editor`. The state matrix covers
four palettes and device scales 1, 1.25 and 2, including alternate cell metrics.
Assertions exercise real controls, source typing/undo, selections, debugger rows,
readable captions, staged Options, portals, dates/colors/selects, rich text, owned
allocations, lifetime restoration and actual downloads. Advanced tests exercise
real Monaco input, folds, split views, independent carets, shared history,
configuration leases, screen projection and composition lifecycle.
Additional shared-designer checks exercise rectangular cell drawing, drag/resize,
keyboard nudges, auto-layout free gestures, readable scaling, zoom and canonical
undo. Shell checks compare actual key dispatch with command-strip activation,
including detached windows; collection and text checks retain native inputs while
verifying VB6 events and restoration to Classic mode.

`VB6_ORIGIN=memory` and `VB6_TEST_TRANSPORT=memory` explicitly identify offline
qualification, not HTTP/file persistence, secure-origin or platform evidence.
Passing Chromium does not certify Firefox, WebKit, GPU execution or OS input
methods. Revision-specific totals/logs belong in PRs and CI artifacts, not here.

This is not an MS-DOS/FreeDOS emulator, Windows 3.1 window manager or Norton/Borland
binary clone. Profiles and authored glyphs are design references, not vendor
reference goldens. Arbitrary rich/hosted widgets, complex shaping, OS IME/file
pickers, extreme caption sizes and exact vendor raster/layout/state matching
remain explicit fidelity boundaries. No 100% native-pixel certification is claimed.
