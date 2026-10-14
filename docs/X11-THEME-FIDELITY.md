# X11 theme fidelity

The `x11` / `x11-dark` family is the project's **Motif/CDE-inspired browser
skin**. X11 does not prescribe one window manager or widget appearance. This
family therefore has an explicit, maintained paint contract rather than a claim
to reproduce every X11 desktop. `x11-cde` and `x11-cde-dark` remain supported
migration aliases. The dark palette is a project-defined companion, not a
historical native CDE reference palette.

## Component contract

- **Lighting and geometry:** square surfaces, two-CSS-pixel top/left highlights
  and bottom/right shadows; armed controls reverse those edges. Hover preserves
  the raised face instead of adding a modern accent wash. The dark palette keeps
  the same physical lighting direction. Caption relief has its own colors, not
  the beige control colors behind white title glyphs.
- **Commands and defaults:** the default-button ring is outside and separate
  from the raised or armed face; keyboard focus is an independent, visible
  two-pixel inset outline. Disabled controls retain structure and embossed ink
  without acquiring an active hover/pressed appearance.
- **Fields and indicators:** text/combo/list/rich-text wells retain sunken
  relief when focused. Checkboxes have raised off, recessed filled on and
  stippled mixed states. Radio indicators are diamonds with square inner
  markers. Existing control bounds and keyboard/value semantics do not change.
- **Menus and navigation:** active menus use a raised neutral plate, not a
  Fluent-colored selection slab; disabled entries remain unselected. Separators
  are etched, toolbar/data-navigation buttons have directional relief, tabs are
  raised, and status panes, list/tree/grid containers and progress troughs are
  recessed. Calendar label ink is separate from the physical shadow color.
- **Windows and auxiliary surfaces:** active/inactive captions, contiguous
  caption commands, tool windows, dialogs, tooltips, property grids, IDE service
  panels, sliders and browser-drawn scrollbars share the same paint vocabulary.
  Minimize/maximize/restore/close continue to use the existing action handlers.

The shared detail and application token generators reset their complete role
inventory at **every** theme boundary, including Classic inside X11. IDE rules
exclude authored application/designer controls. A live theme change does not
rebuild controls or restart the VM. Explicit RGB colors, fonts, images, twip
geometry, selection and control values remain authored data. Forced-colors mode
continues to defer to system colors rather than forcing this palette.

## Verification

```sh
npm run build
node --test tests/x11-theme.test.mjs tests/ide-themes.test.mjs tests/application-themes.test.mjs tests/icon-packs.test.mjs
npm run test:themes:browser
npm run test:application-themes:browser
python tools/browser-native-caption-tests.py
```

`tools/x11_theme_checks.py` is mixed into both existing theme browser suites, so
it runs in their existing Chromium/Firefox/WebKit and HTTP/file CI matrix. It
checks actual computed paint, pointer-armed state, Tab/Space keyboard behavior,
VB Click execution, disabled/mixed states, default rings, focus, captions, menu
states, composite controls and Classic boundary reset. Its gallery also gives
Toolbar and ProgressBar visible content instead of testing empty surfaces.

At device-pixel ratios **1 and 2**, the pixel oracle compares text-free button
edge strips to literal palette colors and the expected two-CSS-pixel thickness,
including the reversed armed state. Those expected pixels are not copied from
an updated screenshot. At **1.25 and 1.5**, it checks geometry and computed
relief without pretending that fractional rasterization is identical across
engines. Screenshots are retained as CI artifacts for review.

The Node contracts independently check palette lighting, contrast, raised/armed
shadows, role resets, deterministic generated CSS and browser-suite integration.
The existing broader suites cover authored values/geometry, nested/independent
apps, exports, runtime identity, MDI, dialogs, portal ownership and all supported
control types. Generated bundle fingerprints in `tools/ide-artifacts.json` are
reviewed locally; CI only verifies them and never refreshes its own expectations.

A restricted sandbox can run `VB6_TEST_TRANSPORT=memory` for DOM/paint/state
checks. Its explicit origin/persistence skips are **not** HTTP/file certification.
Native-caption browser tests use an explicitly simulated IPC host; actual
Electron/native-window qualification belongs to the existing platform CI jobs.

## Remaining certification boundaries

These checks establish the browser skin's own specified behavior, **not 100%
pixel-for-pixel equivalence with an unspecified native X11 installation**. Native
certification would require a pinned toolkit/window-manager version, resource
configuration, fonts, scale, renderer and independently captured component/state
reference images. No such native screenshot corpus is asserted by these tests.
System-owned file/date/color pickers, native OCX windows and third-party shadow
DOM remain outside browser CSS ownership. Firefox uses its supported native
scrollbar-color path rather than Chromium/WebKit scrollbar pseudo-elements.
Fonts and fractional-scale antialiasing can differ by host.

Design references: [X.Org architecture](https://www.x.org/guide/concepts/) and
[Motif widget resources](https://docs.oracle.com/cd/E19422-01/819-3700/WidgetReference_1.html).
See also [application themes](APPLICATION-THEMES.md) and [IDE themes](IDE-THEMES.md).

## Retained-renderer fractional clipping regression

PR #129 continuation fixes fractional overflow coverage after child traversal.
A clipped row could repaint an earlier parent-edge hole and alpha-composite its
background over the already painted native border. The renderer now preserves
only the fractional overflow perimeter after descendants. A two-device-pixel
CSS-edge halo also covers independently rounded border widths and scroll offsets;
opaque interiors remain Canvas2D/WebGL2/WebGPU commands.

`tests/rendering-overflow-edges.test.mjs` checks clip-axis ownership, empty and
integral boundaries, ancestor clipping, thin native coverage, and traversal order.
`tools/x11_overflow_checks.py`, mixed into the existing IDE theme suite, compares
fixed, independently stabilized HTML references with Canvas2D at DPR 1, 1.1,
1.25, 1.5, 1.75, 2, 2.5 and 3, for light/dark palettes and initial/scrolled rows.
All comparisons require zero changed pixels; a direct overlay-alpha assertion
requires an opaque interior so an all-native fallback cannot pass.
The existing headed/headless WebGPU and WebGL2 qualification continues to check
full optional-theme IDE screenshots with zero tolerance. No baseline pixel
images or pass thresholds were changed.
