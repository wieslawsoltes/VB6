# Optional IDE themes

Choose **Tools → Options → General → Appearance → IDE theme**, then **OK**.
Selection previews the theme inside the dialog; **Cancel** does not change the
running IDE. **Windows Classic remains the default**, including for older saved
workspaces. No account, network request, additional font, or dependency is needed.

## Choices

| Family | Light | Dark |
| --- | --- | --- |
| Fluent WinUI 3 | `fluent` | `fluent-dark` |
| macOS 26 | `macos26` | `macos26-dark` |
| X11 | `x11` | `x11-dark` |

Windows Classic, Windows Standard (2000), and High Contrast Black remain
available as before. X11 itself is a windowing protocol rather than a single
visual design: the single X11 family uses a restrained Motif-style look, not a claim to
reproduce every Linux desktop or window-manager theme.

**Follow system light/dark appearance** resolves the selected optional family to
its light or dark partner. The saved choice is not rewritten when the operating
system preference changes. **Reduce theme transparency** disables macOS chrome
blur and translucent backgrounds. **Reduce theme motion** disables theme button
transitions. The equivalent browser accessibility preferences are respected;
forced-colors mode uses system colors and visible control outlines. These options
are workspace appearance preferences, not project properties.

Appearance is restored through the existing local workspace persistence. Storage
remains best-effort and origin-specific: browsers may deny it, especially for
local files/private sessions. A downloaded project is still the durable backup of
project data; it does not carry these personal IDE settings.

## Coverage and visual behavior

The shared skin applies to the application title/menu/status bars; customizable
and floating toolbars; buttons, check/radio boxes, inputs, selects, sliders and
progress widgets; docked and floating tool panes, MDI documents, tabs and
splitters; modal dialogs and modeless tools; context/submenus, tooltips and color
palette popups; Project Explorer, Properties, Form Layout, Object Browser,
Resource Editor and Data Environment; code backgrounds/gutters/syntax,
IntelliSense, Quick Info and data tips; debugger, watch/value trees and output;
and coding-agent/MCP conversations, settings, reviews, permissions and activity.

Fluent uses flat layers, restrained corners and accent focus. macOS uses rounded
frames, in-page document traffic lights, and restrained glass only on functional
chrome and menus: code and data surfaces stay opaque. Motif/CDE use square frames,
beveled controls and diamond radio buttons. Each optional family has a complete matching original vector icon pack, with
light/dark and selected/disabled states. Classic keeps its original pixel artwork.
See [theme icon packs](THEME-ICON-PACKS.md).

Current IDE commands, keyboard navigation, IME/text selection, revision checks,
agent permissions, docking and source-editor metrics remain owned by their
existing components. Changing a theme is not a document rebuild. Detached
same-origin browser windows receive live appearance changes, including system
light/dark resolution; returning them to the IDE retains their view state.

## Application and native-platform boundaries

**IDE theme does not change Application theme.** Applications now offer the same
six optional variants alongside the three Classic palettes, with independent
project-owned settings. See [application themes](APPLICATION-THEMES.md). Authored forms and controls
retain their VB6 fonts, colors, sizes and relative coordinates. Property color
swatches resolve system colors using the application palette even when the
surrounding Properties window has a dark IDE skin. RGB values remain authored
RGB values. No project data, undo entry, executable setting or exported runtime
is changed merely by selecting an IDE theme.

These are browser-rendered skins, not native WinUI/AppKit/Motif toolkit bindings
or pixel-for-pixel platform certifications. Browser/OS title bars, file pickers,
permission dialogs, actual native OCX windows and operating-system decorations
are system-managed. Browser CSS cannot provide native wallpaper-derived Mica,
AppKit Liquid Glass refraction, or change another process's title bar. The macOS
skin uses CSS blur/transparency with an opaque fallback. Only locally available
font names and fallback stacks are referenced; no Microsoft/Apple font files,
SF Symbols or proprietary artwork are redistributed.

## Architecture

- `src/theme/ide-appearance.js`: frozen, complete IDE profile registry,
  normalization, system-pair resolution and an O(1) root-attribute controller.
  One media-query listener is released on page teardown; BFCache restores refresh
  the current system preference. Optional-to-optional changes do not invalidate
  runtime drawing surfaces through a redundant legacy theme event.
- `tools/ide-theme-css.mjs` and `src/theme/ide-palettes.css`: deterministic generated
  semantic colors and per-portal palette rebinding. Root variables, native
  element color schemes, icon colors and all system-color aliases stay coherent.
- `src/theme/ide-themes.css`: scoped component skins loaded last in the IDE only.
  Authored form/control boundaries are excluded from generic element selectors
  and explicitly reset inherited runtime typography and color scheme.
- `src/ide/theme-settings.js`: inert, locally scoped preview and preference inputs.
- Editor, workspace/MCP configuration and detached-window adapters use the same
  normalized IDE appearance model. Unrelated editor changes do not discard the
  selected theme. MCP configuration continues to require the ordinary permission
  and revision checks; this does not expose any new permission-control route.

The shared `THEMES` registry now contains all nine profiles. Application and
IDE component skins and preference controllers remain independently scoped.
The build includes application skins and matching icon packs in runtime outputs
as well as the IDE, and verifies the same fingerprint manifest as other changes. To author new output fingerprints locally,
use the documented `npm run build:update-ide-artifacts` command, not a CI bypass.

## Validation

```sh
npm run build
npm test
npm run test:themes
npm run test:themes:browser
VB6_BROWSER=firefox npm run test:themes:browser
VB6_BROWSER=webkit npm run test:themes:browser
```

Install the matching Python Playwright browser before running each engine. The
retained **Validate** workflow runs the theme browser suite in its existing
Chromium/Firefox/WebKit matrix; no feature-specific workflow is added.

Node tests check immutable complete palettes, readable normal/selected/caption/
syntax text contrast (at least 4.5:1 for tested pairs), malformed preferences,
light/dark pairs, bounded updates, BFCache/listener lifetime, detached attributes,
deterministic generation and IDE/application isolation. MCP tests cover theme preference
preservation and normal authority/revision rejection.

The browser suite exercises all six optional choices through Options, transactional
Cancel, authored form/descendant computed styles and geometry, unchanged project
and undo state, workspace persistence/reload, standalone file startup, all family
system pairs, reduced effects/forced colors, source overlay transparency and
custom code colors, menu/palette portals, native keyboard checkbox interaction,
modeless tools and tabs, debugger panes, live detached-window synchronization,
and narrow Options layouts. Reports and screenshots are artifacts under
`reports/ide-themes/<engine>/`, not source files. A restricted local run can use
`VB6_TEST_TRANSPORT=memory`; it explicitly skips the two origin-dependent
persistence/file cases and is not reported as equivalent to real-origin testing.

## Design references

The design direction uses public platform guidance, not copied platform assets:

- Microsoft: [WinUI 3](https://learn.microsoft.com/en-us/windows/apps/winui/winui3/)
  and [Mica](https://learn.microsoft.com/en-us/windows/apps/design/style/mica).
- Apple: [Materials](https://developer.apple.com/design/human-interface-guidelines/materials)
  and [Accessibility](https://developer.apple.com/design/human-interface-guidelines/accessibility).

## Selected, pressed and accessible control states

Filled primary buttons and selected template/data/anchor/review rows retain the
selection foreground/background pair while hovered or pressed. Their keyboard
focus indicator uses a contrasting inset ring; checkboxes and radio buttons use
an outer ring, without changing layout measurements. Disabled primary commands
use the disabled foreground rather than an enabled accent fill.

In forced-colors mode, captions and selected labels use matched system colors in
small, explicitly scoped regions so automatic text backplates cannot obscure the
text. The rest of the document and authored forms keep browser color adjustment.
Native select arrows replace gradient chevrons; caption and selected-row glyphs
follow the system foreground. No custom RGB palette replaces the user's contrast
colors. Media emulation and the `forced-color-adjust` CSS property are detected
independently. Engines exposing the media query without the adjustment property
still run the system-color-pair, native-select-arrow and keyboard-focus checks;
the report explicitly marks adjustment coverage as unavailable. An engine without
forced-colors media emulation reports an explicit skip, not a successful paint test.

The browser suite additionally checks primary-button focus contrast, pressed text,
checked keyboard focus, disabled commands, all eight New Project selection states,
keyboard selection, forced-color labels/select arrows, and unchanged project data.

## Fidelity and compatibility maintenance

The canonical Linux family is **X11**, with light and dark appearances. Existing
`x11-cde` and `x11-cde-dark` preferences normalize to `x11` and `x11-dark` when
loaded; they are not additional menu choices or duplicated icon packs. Effect
preferences and the independent application theme survive migration.

Shared `details.css` paint is parameterized by `theme-detail-css.mjs` and rebound
at every IDE, preview, popup and application boundary. This keeps Classic app
forms Classic inside a modern IDE, and the reverse. It changes no authored
client/control bounds, fonts, images, RGB colors, control identity or VM state.

Classic retains its bitmap caption masks, squared raised/sunken edges, compact
metrics and disabled embossing, with a stepped checkbox mark and consistent
default/focus cues. Fluent captions use flat hit areas and distinct close hover
and pressed colors. macOS captions use left-hand red/yellow/green controls,
13-pixel document/form buttons and 12-pixel tool buttons, with glyph discovery
on hover or keyboard focus. X11 keeps square relief, Motif-style minimize and
maximize glyphs, centered captions and squared scrollbars. Light/dark, inactive,
disabled, hidden and forced-color states use the same shared rules.

Caption buttons carry `data-caption-action` so a minimized window's **Restore**
command remains the minimize control, not the maximize control merely because
they share a restore glyph. Hidden ControlBox/MinButton/MaxButton and tool-window
constraints still come from the original window model. Browser headers expose
only actions the application can actually perform; no fake OS close buttons
are added. Native detached-window outer decorations remain OS/browser owned.

These are compact browser-rendered platform interpretations, not native toolkit
or pixel-equivalence certification. Platform guidance informs paint and state
treatment, while the existing VB6 layout and authored client coordinates take
precedence over enlarging the UI to modern native metrics. Reference guidance:
[Microsoft title-bar design](https://learn.microsoft.com/en-us/windows/apps/design/basics/titlebar-design)
and [Oracle Motif/CDE window-manager architecture](https://docs.oracle.com/cd/E19683-01/806-7495/archov-7/index.html).

`tests/theme-details.test.mjs` covers canonical migration, icon compatibility and
complete token resets. The existing three-engine IDE/application browser suites
now also cover caption geometry, restore identity, modern composite edges,
scrollbar isolation, disabled/hidden controls and keyboard/forced-color ink.
