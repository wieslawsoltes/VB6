# macOS 26 theme fidelity

The `macos26` and `macos26-dark` profiles share component metrics between the IDE,
application windows, runtime dialogs, and detached menu/combo portals. The target
is macOS 26, not an unspecified blend of older macOS releases. Select the IDE and
application themes independently in **Tools → Options → General → Appearance**.

## Component and interaction coverage

The light palette uses neutral window/control layers; the dark palette uses
separate graphite content, control, title, and inactive surfaces. Chrome chooses
the locally available system font. No Apple fonts, SF Symbols files, or native
platform artwork are embedded or fetched.

Caption buttons are 12 CSS pixels with an 8-pixel gap. Close, minimize, and
maximize retain their own red/yellow/green paint when pressed and when an action
becomes Restore. Disabled captions do not reveal a hover glyph. Document titles
are centered between symmetric gutters without intercepting caption commands.

Ordinary command buttons have neutral hover/pressed surfaces. Default commands
use the accent fill with contrasting text and an inset keyboard indicator.
Check boxes use a three-pixel corner radius and a seven-by-two-pixel mixed-state
dash. Radio buttons remain circular. Fields, trees, lists, grids, rich text,
frames, tabs, and status panels no longer accidentally inherit Classic relief.
Trees use disclosure chevrons with accessible Expand/Collapse names. Segmented
inspector tabs use a selected surface rather than a WinUI underline. Calendars,
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
mixed authored/system pairs are not reinterpreted as that pair.

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
captures the gallery, window frame view, individual controls, and additional
pressed/disabled default-button states at 1× and 2×. It validates nonempty PNGs,
image dimensions, and visible/nonuniform paint, then writes `reference.json`
with native classes, point bounds, pixel dimensions, sRGB semantic colors,
OS version, appearance, and actual activation state. A failure fails the job.
The output is included in `macos-aot-macos-26`; the executable is removed before
upload. Process-local defaults request a blue accent without changing the
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

Apple's design and API references:

- [Build an AppKit app with the new design (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/310/)
- [Designing for macOS](https://developer.apple.com/design/human-interface-guidelines/designing-for-macos)
- [NSView.cacheDisplay(in:to:)](https://developer.apple.com/documentation/appkit/nsview/cachedisplay(in:to:))

The native APIs document view capture and platform behavior; the project's CSS
metrics and compatibility choices remain independently tested implementation
choices, not Apple-supplied pixel-equivalence guarantees.
