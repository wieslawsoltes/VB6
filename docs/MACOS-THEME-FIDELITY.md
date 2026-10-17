# macOS 26 theme fidelity

The `macos26` and `macos26-dark` profiles share component metrics between the IDE,
application windows, runtime dialogs, and detached menu/combo portals. The target
is macOS 26, not an unspecified blend of older macOS releases. Select the IDE and
application themes independently in **Tools → Options → General → Appearance**.

## Component and interaction coverage

The light palette uses a white window with translucent neutral control layers;
the dark palette uses a #1e1e1e window with independently composited light control
layers. Content selection and command accents are separate semantic roles. Chrome chooses
the locally available system font. No Apple fonts, SF Symbols files, or native
platform artwork are embedded or fetched.

Caption buttons are 12 CSS pixels with an 8-pixel gap. Close, minimize, and
maximize retain their own red/yellow/green paint when pressed and when an action
becomes Restore. Disabled captions do not reveal a hover glyph. Document titles
are centered between symmetric gutters without intercepting caption commands.

Ordinary command buttons have neutral hover/pressed surfaces. Default commands
use the accent fill with contrasting text and an inset keyboard indicator.
Check boxes use a 16-pixel indicator, five-pixel corner radius and eight-by-two-
pixel mixed-state dash. Radio indicators are 16 pixels with a six-pixel dot.
Slider thumbs are 20 by 18 pixels on six-pixel tracks; progress bars paint an
eight-pixel track. Native-sized inner steppers preserve their authored outer box. Fields, trees, lists, grids, rich text,
frames, tabs, and status panels no longer accidentally inherit Classic relief.
Trees use disclosure chevrons with accessible Expand/Collapse names. Segmented
inspector tabs use blue selected segments with white text, while document tabs
retain their separate surface treatment rather than a WinUI underline. Calendars,
combo arrows, progress tracks, menus, and toolbars have component-specific paint.
Access-key underlines are hidden in macOS captions/menus, not in authored RTF.

Horizontal and vertical sliders paint a bounded fill relative to their actual
minimum and maximum. DOM input updates the fill immediately, including keyboard
input; programmatic refresh and orientation changes use the same normalization.
The range helper handles empty/inverted spans, nonfinite values, and finite
spans whose subtraction overflows. Scrollbars are arrowless with inset rounded
thumbs. Their existing ResizeObserver also watches the track, so changing themes
correctly recalculates travel even if the outer control did not resize. Classic
arrows and travel return when switching back.

Materials are confined to owned chrome and popup surfaces. Reduce transparency,
increased contrast, forced colors, and missing backdrop-filter support provide
opaque fallbacks. Reduced motion continues to remove control transitions.
Native OS pickers and vendor-owned controls retain their own appearance.

## Preservation contract

A theme switch does not replace a control, restart the VM, change live values,
rewrite a project, or alter authored twip bounds, fonts, images, and RGB pairs.
Default-command tint is applied only to the ordinary Button Face plus Window
Text/Button Text **system-color pair**. Literal RGB, other system roles, and
mixed authored/system pairs are not reinterpreted as that pair. Frame material
similarly requires the ordinary Button Face/text roles; read-only combo material
requires the ordinary Window/text roles. Authored `FontName = "-apple-system"`
and CSS generic families now resolve as explicit font aliases in controls and
rich text, without copying fonts or changing existing project font properties.

The native caption/reference measurements live in the deeply frozen
`src/theme/macos-reference-metrics.js`. They were obtained from active/key AppKit
windows on **macOS 26.6.2, build 25G83**, capture revision
`b6472b68740e282562aadd728f43f8cac97aa0b0`, artifact `11927890599`.
`tests/fixtures/macos26-native-measurements.json` retains independently extracted
sRGB values, paint extents and source PNG SHA-256 hashes, not runtime artwork.
Command blue is #007aff in both appearances; pressed blue is #006ee6 in light
and #1987ff in dark. Replacing these with the content-selection blue is incorrect.

Composite border changes compensate with padding: a two-pixel Classic border
becomes one pixel plus one pixel of padding; rich-text padding changes from
three to four pixels. Content origins and outer bounds therefore remain stable.
The application caption/client sizing contract is unchanged. Native AppKit may
choose a different intrinsic size; this compatibility-preserving skin does not
silently resize an existing VB6 form to that size.

Every macOS-only detail token is explicitly reset at other theme boundaries,
including Classic inside macOS. Runtime rules consume those local tokens rather
than inheriting an IDE selector. Theme generators, source palettes, runtime CSS,
standalone exports, and build fingerprints are updated together.

## Browser regression evidence

Run from the repository root after building:

```sh
npm run build
node --test tests/macos-theme-fidelity.test.mjs tests/ide-themes.test.mjs tests/application-themes.test.mjs
python tools/browser-application-theme-tests.py
python tools/browser-theme-tests.py
python tools/browser-native-caption-tests.py
VB6_BROWSER=firefox python tools/browser-application-theme-tests.py
VB6_BROWSER=webkit python tools/browser-application-theme-tests.py
```

The shared registered-control gallery exercises authored geometry
and colors, DOM/VM identity, theme changes, detached surfaces, Options/Undo,
interaction states, and accessibility preferences. macOS-specific tests cover
pressed/default/disabled commands, mixed checks, disclosure interaction,
slider keyboard/orientation changes, scrollbar travel, material reduction,
caption action colors, and IDE inspector selection. Caption PNG checks at device
scales 1 and 2 verify physical dimensions, center color, and circular corners.
Screenshots and structured results are retained under `reports/` and in CI.

`VB6_TEST_TRANSPORT=memory` is available in restricted environments. It explicitly
skips origin-storage and file-navigation tests; it is not HTTP/file persistence
certification. The normal CI browser matrix uses the actual origins.

## Native reference capture

The existing macOS 26 Validate matrix job additionally compiles and runs:

```sh
mkdir -p reports/macos-theme-reference
swiftc tools/macos-theme-reference.swift -o reports/macos-theme-reference/capture -framework AppKit
reports/macos-theme-reference/capture
```

The tool instantiates real AppKit controls in light and dark appearances and
captures **232 PNGs**: the gallery, window frame view, all 21 individual controls,
pressed primary/secondary buttons, ten explicitly disabled controls, and all
views after a real key-window transition, in both appearances at 1× and 2×. It validates nonempty PNGs,
image dimensions, and visible/nonuniform paint, then writes `reference.json`
with native classes, point bounds, pixel dimensions, sRGB semantic colors,
OS version, appearance, and actual activation state. A failure fails the job.
The output is included in `macos-aot-macos-26`; the executable is removed before
upload. Capture fails unless both appearances are active/key and each inactive
capture has an actual different key window. The atlas remains 980 by 840 points
independently of the runner's screen size. Process-local defaults request a blue accent without changing the
runner's global preferences. The tool rejects a different macOS major version.

This is a native reference corpus, **not a fabricated native-parity assertion**.
Its report deliberately records `nativePixelParityCertified: false` until a
matching browser/native comparison is performed and reviewed. Browser test
screenshots are not native goldens. Frame-view captures do not include the
WindowServer's outside shadow, wallpaper sampling, or Liquid Glass refraction.
OS patch version, display scale, accent, activation, fonts, control size,
authoring constraints, and accessibility settings must match for a meaningful
pixel comparison. A cross-platform browser skin alone cannot certify every
native/vendor surface or arbitrary authored font/geometry combination.

## Native/browser comparison, separate from functional CI

`tools/build-macos-theme-fixture.mjs` builds the browser counterpart from the
**public VB runtime**, regular controls and an explicitly authored system font.
It does not replace controls with test-only HTML/CSS, copied native images, or
per-capture recoloring. Light/dark and enabled/disabled changes update the same
live controls; their identity, errors and external requests are checked. The
ordinary three-engine browser matrix captures this complete runtime inventory.
The macOS 26 job additionally compares **WebKit and Chromium on the same host**
against that job's actual native corpus.

```sh
python tools/test_macos_theme_compare.py
python tools/browser-macos-reference-tests.py --native-dir reports/macos-theme-reference
# Explicitly fail unless the entire declared native inventory is exact:
python tools/browser-macos-reference-tests.py --native-dir reports/macos-theme-reference --require-exact
```

`reports/macos-theme-browser/<engine>/native-differences/comparison.json` records
every comparison and original PNG hash. Differences are unmasked and use zero
pixel tolerance. No image alignment, resampling, glyph exclusion, blur, or
antialiasing allowance is applied. Native transparent pixels are composited
onto their recorded sRGB window background before comparing visible RGB; raw
alpha differences are also retained. Even a one-level difference in only the
blue channel is counted. Missing counterparts and dimension mismatches fail
that image's comparison rather than being skipped.

A successful *comparison invocation* says the comparison ran, **not that pixels
matched**. Functional CI requires complete captures and successful comparison
execution; it does not quietly relabel different pixels as exact. The separate
`--require-exact` command fails unless every mandatory state at both scales is
present and equal, native activation transitions were verified, OS versions
match, no browser errors/external requests occurred, and no adaptation gaps
remain. Even that certificate is scoped to the captured view/control inventory,
not every native framework, third-party OCX, or WindowServer surface.

The native-comparison browser fixture explicitly records unresolved adaptations:
its legacy search sample has no intrinsic NSSearchField; HTML date entry uses the browser's locale/picker;
and native AppKit non-client dimensions differ from the preserved VB6 window
contract. Native glyph rasterization, segmented/tab geometry and full compositor
materials also require further comparison rather than an unsupported 100%
claim. `cacheDisplay(in:to:)` captures view drawing, not the WindowServer's final
composition. Neither passing functional CI nor the native reference corpus
establishes 100% platform pixel parity.

Apple's design and API references:

- [Build an AppKit app with the new design (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/310/)
- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
- [NSView.cacheDisplay(in:to:)](https://developer.apple.com/documentation/appkit/nsview/cachedisplay(in:to:))

The native APIs document view capture and platform behavior; the project's CSS
metrics and compatibility choices remain independently tested implementation
choices, not Apple-supplied pixel-equivalence guarantees.

## WebKit vertical-range compatibility

The Linux WebKit 26 WPE engine used by the pinned browser matrix accepts
`writing-mode: vertical-lr` in CSS but adjusts range inputs back to
`horizontal-tb`, even with `!important` and `appearance: none`. That is a real
hit-testing defect for this skin: clicking the top and bottom produced the same
value before the fix, not just a different computed-style string.

`src/controls/range-orientation.js` probes a real, hidden range once per document
and uses `slider-vertical` **only** when native vertical writing modes are absent
and that appearance is actually supported. Chromium and supporting WebKit ports
keep the standard writing-mode path. Both paths retain the same input node,
thumb/track CSS, native drag/keyboard behavior, focus, range normalization, and
control/VM identities. Horizontal orientation removes the compatibility class.
No browser-name detection, polling, resize observer, synthetic pointer/value
handler, or additional focusable element is introduced.

The application theme suite now tests top/bottom pointer values, native dragging,
Up/Down/Home/End, disabled-event suppression, live resize, restoration to horizontal
input, and ordinary/forced-colors input across all nine palettes. The two macOS
palettes additionally require exact accent pixels along the vertical track.
This replaces the single-mechanism computed-style check with stricter behavior
and paint assertions; it does not exempt WebKit from orientation coverage.

Unmodified Home/End keys use the native range value sanitizer and the existing
input/change event path on all engines. Some WebKit ports omit those endpoint
commands even when native dragging works. Modified shortcuts, IME input, disabled
controls and prevented events are not intercepted; repeated endpoint keys do not
emit duplicate changes. Arrow keys and pointer dragging remain browser-owned.

### Shared WinUI/X11 integration

The macOS skin composes with the resource-backed WinUI skin rather than
replacing its state brushes. `controlThemePaint` wraps the already-authored
command/combo paint: an invalid WinUI resource falls back to the local macOS
paint, and an invalid macOS resource falls back to the original OLE role.
Neither layer resolves an ancestor's color prematurely. Invalid, fractional or
out-of-range OLE numbers cannot alias a state-brush slot.

The final WinUI component sheet retains the existing non-WinUI detail metrics,
including macOS 16px indicators, transparent 2px command insets, zero default
outline, popup padding, capsule progress, and horizontal/vertical range geometry.
The macOS scroll track no longer retains the Classic checkerboard image.
The four-`:not()` Classic field selector now gives the owning WinUI input resource
priority, so TextBox and DTPicker use their actual resource strokes instead of
Classic relief. This is an intentional WinUI field-paint correction, not a claim
that all non-macOS pixels are unchanged.

`tests/theme-paint-composition.test.mjs` exercises the nested fallback and OLE
contracts. The existing WinUI browser suite still removes/reinserts its complete
sheet and requires identical non-WinUI computed paints and disabled glyphs.
An additional literal-resource field test checks normal/disabled stroke paint
and unchanged authored bounds. Existing X11 assertions and captured-pixel
requirements are retained without changing their thresholds.

### Non-key windows, popup buttons and segmented strips

The continuation after `4b6c481c` uses that head's native **non-key** AppKit
captures (artifact `11954783994`), not just active-window colors. Independent
RGBA samples and original PNG SHA-256s are retained in
`tests/fixtures/macos26-inactive-measurements.json`. Default buttons, checked and
mixed indicators, radio dots, sliders, progress and selected segments now become
neutral when the owning form loses activation. Removing that state restores the
accent without changing props, values, focus targets or runtime/control identity.
The state roles are rebound at each nested theme boundary, so an independent
active application does not inherit the outer form's inactive paint. The old
Classic mixed-checkbox inset is also removed in macOS only.

List-only ComboBox (`Style=2`) now paints a 24px body inside the original 28px
reference box, uses paired popup chevrons and a transparent arrow hit target,
and has separate pressed, disabled and keyboard-focus paint. Editable and simple
combos retain their existing presentation and the same real input, virtual list,
keyboard selection and VB events. Literal RGB still passes through `comboPaint`.
Top-oriented TabStrip headers remove the extra rectangular frame and padding,
use intrinsic-label-aware column tracks and a two-pixel top inset, and separate
unselected neighbors. SSTab's authored page/client origin and vertical strips are
not redirected into this segmented layout. Forced colors restores ordinary strip
width/column geometry and visible system paint.

`tools/macos_composite_checks.py` runs in the existing three-engine application
suite. It checks state transitions, nested boundary reset, inner/outer geometry,
1x/2x paint extents, real popup/keyboard selection, disabled behavior, and input
identity through Style changes. Translucent-state sample tests use literal native
RGBA inputs in an independent, style-isolated CSS source-over swatch. They do not
read colors from the tested component or its generated tokens. Canvas2D is not
used as a CSS raster oracle: the WPE WebKit port quantizes those pipelines
differently, which previously produced false one-level failures. A negative
control injects a one-channel, one-level mutation into the real component and
requires it to differ while the independent reference remains unchanged. Slider
track samples use an independently specified hard-stop gradient, rather than
a solid-color swatch: gradient stops and solid backgrounds can follow different
premultiplied-alpha quantization paths even inside one engine. A second negative
control injects a one-level mutation into the real native slider track and must
also fail exact equality. Neither reference reads the production gradient or its
custom properties, and neither changes behavior based on the browser name. The
full 232-state native comparison remains unmasked, zero-tolerance, and reports
its own exact-match/certification status; this portable layer check does not
turn native/browser mismatches into passes.

The served IDE now loads its fingerprint-verified diagnostic worker from the
same directory and HTTP origin as `studio.js`. That avoids a document-owned
Blob URL fetch racing navigation in WebKit. File/inline standalone exports
still contain the identical worker source and use one bounded document-owned
Blob URL. Cross-origin scripts never select an external worker; worker failures
still take the existing yielding parser fallback. Cancellation, stale-message
rejection, pagehide suspension and restoration remain covered by lifecycle tests.

## macOS 26 semantic authoring and IDE surfaces

The macOS 26 compatibility extension adds a shared resource dictionary and
explicit authoring properties for existing controls. `macos26-resources.js`
separates the measured AppKit colors from additional independently authored
browser resources. The CSS generator binds every color, state, material and size
token at every application/IDE palette boundary, including non-macOS boundaries
where those tokens become invalid. An embedded Classic form therefore does not
inherit its containing Mac window's switch, search or material paint.

The design references are Apple's
[AppKit adoption session](https://developer.apple.com/videos/play/wwdc2025/310/),
[new design system session](https://developer.apple.com/videos/play/wwdc2025/356/),
and the linked [macOS 26 Figma design resource](https://www.figma.com/community/file/1543337041090580818/apple-design-resources-macos-26).
The Figma URL is retained as a reference; its design file, artwork, fonts and
symbols have not been imported. The new resource values and effects are CSS
implementation choices, not values extracted from that kit.

### IDE hierarchy

Command bars use grouped capsule surfaces. Contiguous command buttons share a
visual group; separators divide the groups without inserting wrappers or
changing keyboard order. The leading docked sidebar has a floating rounded pane,
while the trailing property inspector remains aligned with the document edge.
Property groups, tree selection, editor/document tabs, tooltips, context menus,
floating command bars, utility dialogs, and agent/MCP panels use the same local
semantic roles. Editor text, document data, and designer artwork remain sharp.

Delegated `ToolTipText` overlays retain the opening application's local palette,
font and accessibility preferences after moving into the document overlay.
They follow live application theme changes and release that binding when hidden.
IDE command tooltips follow the IDE palette independently. The browser theme
suite checks both ownership paths, including Classic help inside every optional
IDE theme and live macOS light/dark changes while a tooltip remains open.

Chrome materials use bounded backdrop filtering. Reduced transparency,
increased contrast, forced colors and a missing backdrop-filter implementation
switch those surfaces to opaque resources. Each bar/pane owns its filter;
individual toolbar buttons do not allocate separate filters. This implements the
documented hierarchy with browser compositing; it does not reproduce
WindowServer refraction, wallpaper sampling or NSGlassEffectContainerView's
optical interaction between overlapping glass elements.

### Authored appearance properties

| Property | Values / behavior |
| --- | --- |
| `MacOSControlSize` | `mini`, `small`, `regular`, `large`, `extraLarge`; changes inner command padding/corners, preserving the authored outer rectangle. Large and extra-large commands use capsules. |
| `MacOSControlStyle` | Command styles: `automatic`, `push`, `default`, `destructive`, `borderless`, `inline`, `circular`, `help`. CheckBox additionally accepts `switch`; TextBox accepts `search`. |
| `MacOSMaterial` | `none`, `content`, `sidebar`, `titlebar`, `toolbar`, `menu`, `popover`, `sheet`, `hud` on supported containers. `content` is opaque. |
| `MacOSBackgroundRole`, `MacOSForegroundRole` | Explicit semantic color names such as `windowBackgroundColor`, `controlAccentColor`, `labelColor`, `secondaryLabelColor`, and `separatorColor`. |
| `PlaceholderText` | Placeholder for TextBox or editable ComboBox. |
| `MacOSAccessibilityLabel`, `MacOSAccessibilityHelp`, `MacOSAccessibilityIdentifier` | Stable accessible naming and authoring metadata. |
| `MacOSIndeterminate` | ProgressBar `0`/`-1`; unknown progress uses a moving bounded segment and omits a falsely precise accessible current value. |

The regular command painter retains the existing 6px/8px corner radii and 4px/9px
padding used by the native-reference fixture. The other preferred sizes do not
overwrite twip bounds or authored fonts. A circular command should be authored
with a square rectangle when an actual circle is required. Destructive commands
use a secondary red tint and ink so the default action retains greater visual
prominence. A visual default style should be paired with `Default = True` (or
`IsDefault="True"` in XAML) when Return should invoke it.

Search retains the original text input, IME state, selection and event path. Its
magnifier is decorative; its named clear button and unmodified Escape clear the
same value. Switching presentation does not create a second editable value.
The switch retains the original checkbox input. The VB6 mixed value keeps
checkbox accessibility semantics and paints a centered thumb. A moving progress
segment becomes stationary under reduced motion; it remains partially filled
instead of suggesting completion.

Explicit RGB still uses the ordinary authored paint. A compatible default
system-color pair can participate in a material or state brush. Assigning a new
`BackColor` or `ForeColor` relinquishes the corresponding semantic role unless
the same edit explicitly supplies the new role.

### XAML authoring

`urn:vb6:macos26` is this project's macOS-shaped authoring vocabulary. It maps to
the existing VB6 control model; it is not an implementation of the AppKit or
SwiftUI API/ABI. For stacks and grids, enable the project's XAML and anchoring
settings.

```xml
<mac:Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
            xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
            xmlns:mac="urn:vb6:macos26"
            x:Name="Form1" Title="Settings">
  <mac:StackView Width="360" Height="200" Spacing="12">
    <mac:SearchField x:Name="Search" StringValue=""
                     PlaceholderString="Filter settings"
                     mac:Accessibility.Label="Search settings" />
    <mac:Switch x:Name="Enabled" Title="Enable feature" IsOn="True" />
    <mac:Button x:Name="Apply" Title="Apply"
                ControlSize="large" ControlStyle="default"
                IsDefault="True" Action="Apply_Click" />
  </mac:StackView>
</mac:Window>
```

Existing presentation/VB6 controls can use `mac:Appearance.ControlSize`,
`mac:Appearance.ControlStyle`, `mac:Appearance.Material`, and the semantic role
properties. Intrinsic `{ThemeResource macOS.labelColor}` and other supported
roles remain live on Background/Foreground instead of being frozen to the
appearance in effect at compilation time.

The extension's semantic/state and accessibility contracts are covered by
`tests/macos26-theme.test.mjs` together with the runtime/compiler integration
suites. These checks extend the existing native-reference checks; they do not
relabel the native comparison fixture's unresolved optical/raster differences.
