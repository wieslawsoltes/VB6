# Visual validation and rendering contracts

Use this guide when changing classic IDE chrome, controls, themes, layout or
rendering. [Classic HTML rendering](CLASSIC-HTML-RENDERING.md) owns the bevel/list
implementation and attribution; [classic icons](ICON-AUDIT.md),
[IDE themes](IDE-THEMES.md), [application themes](APPLICATION-THEMES.md) and
[icon packs](THEME-ICON-PACKS.md) own their detailed APIs. Test results belong to
the exact revision's PR and CI artifacts, not a cumulative release ledger.

## Rendering and geometry invariants

| Surface | Contract to preserve |
| --- | --- |
| Caption icons | Original integer-cell masks at their native caption size, complete maximize edges, unclipped disabled highlights, existing button hit targets and accessible names. Avoid fractional scaling of general toolbar artwork into caption buttons. |
| Bevels and frames | Staircase corners with semantic theme colors. Preserve border-box dimensions, content origins, padding and resize hit targets, including fractional DPI. Complete all four toolbar/select edges. |
| Toolbars | Fitting desktop toolbars retain their height. Constrained horizontal docks wrap whole commands; vertical/floating bars keep scrolling. Pointer and keyboard access, floating-caption positioning, dragging and redocking must work. Preferred and flex widths must agree. |
| Menu selection | `menu-selected` owns paint; pointer selection moves focus. Keyboard navigation must not leave a second highlighted item under a stationary pointer. One active item per menu level. |
| Native selects | Collapsed-control paint must fit its existing row and retain keyboard selection, change events, tab order and browser-owned popup behavior. Forced colors restore native appearance and real borders. |
| Properties tabs | The selected-tab bridge covers only the adjacent grid border, not the first property row. |
| Theme boundaries | IDE and authored application appearance remain independent. Resolve system colors at each nested theme boundary without overwriting authored RGB, fonts, geometry or images. |
| Virtual lists | No-change paint performs no DOM writes; scrolling reuses visible rows and bounds overscan. Preserve selection, accessibility, search, keyboard behavior and detached-window adoption. |

`src/theme/fidelity.css` supplies the caption/frame refinements after the shared
styles. Caption artwork uses local SVG masks rather than font glyphs or network
assets. `src/theme/menu.js` retains the shared IDE/runtime menu session and
keyboard ownership. Changes must preserve MDI commands, actual detached browser
windows, event handlers and focus restoration.

Forced colors retain real borders, system colors and keyboard focus; suppress
author shadows where required. Native radio circles, authored shapes, source
text and flat menu items are not globally replaced by rectangular bevel rules.
Use the shared style layer for IDE, runtime and standalone exports rather than
patching only a screenshot fixture.

## Review states

Exercise designer and source views, split/procedure projections, menus, dialogs,
Object/Procedure selectors, Properties, floating/detached panes and toolbars.
Check normal, selected, pressed, disabled, focused and forced-color states, plus
open popups and populated controls. Galleries are initial-state references, not
complete native control API or state coverage.

Review classic, standard and high-contrast profiles as well as optional
IDE/application themes. Check exported applications independently of the IDE.
Include fitting desktop and narrow layouts, integer DPR pixel fixtures, and
fractional-DPR geometry checks. Touch emulation is not physical-device testing.
Local font metrics, browser-owned popups and OS chrome need explicit review on
the relevant platform; no proprietary font files are distributed.

## Reproduce

Install the browser dependencies from [Testing](TESTING.md), then run:

```sh
npm run build
npm test
npm run test:visual
python tools/browser-issue39.py --engine chromium
python tools/browser-issue39-state.py --engine chromium
python tools/browser-classic-html.py --engine chromium
```

The issue-numbered scripts remain active regressions for the rendering
contracts above. Repeat their `--engine` runs with `firefox` and `webkit` for
cross-engine changes. They cover authored mask/bevel pixels at integer DPR,
actual UI geometry at fractional DPR, menu pointer-to-keyboard handoff, floating
toolbar interaction, selectors, forced colors and detached style adoption.
Reports identify unsupported emulation cases separately from passing cases.
Use [Testing](TESTING.md) for theme/window/sample-export matrix commands.

Default HTTP/file navigation and an explicit `--inline` smoke run are different
tests. Never count administrator-blocked navigation as an application pass.
`--baseline` in the issue39 runner is a diagnostic reversion expected to fail
new contracts, not a release gate. Keep production listeners, geometry and pixel
assertions intact instead of relaxing them to hide a failure.

## Screenshot and golden-image discipline

The visual harness disables animation, hides the caret, waits for paint and
captures repeat images to check stability. `tests/visual-goldens.json` records
the reviewed implementation images and environment. Run
`npm run test:visual:goldens` only with the matching environment. A browser/font
or image-set change needs explicit review, not a silent tolerance increase.

Save failed fixtures, screenshots, metadata and the original failure separately
so later cases cannot overwrite the evidence. Evidence screenshot failure must
not suppress the underlying functional failure. Compare actual control geometry
and events as well as pixels: a screenshot alone cannot validate hit testing,
keyboard focus, lifetime or export isolation.

These are **our own regression pixels**, not Microsoft VB6 reference pixels.
Native comparisons would need matching OS, theme, fixture, viewport, font
installation and DPI. Browser success, a software GPU or Canvas2D fallback does
not certify physical WebGPU, native IME, every accessibility path, native OCX
painting or pixel-identical VB6 behavior. See [Compatibility](COMPATIBILITY.md).

## Attribution and references

The staircase technique attribution and complete Jordan Scales / 98.css MIT
notice remain in `src/theme/bevels.css`, `LICENSES/98.css.txt` and distributed
CSS, including standalone apps. Caption artwork and project-specific CSS/JS are
original implementation. Removing historical issue notes does not remove
attribution or permit redistribution of proprietary screenshots, fonts or icons.

These references establish relevant shared behavior and color-role semantics. Office VBA UI documentation is identified as such; it is not a complete VB6 IDE pixel specification.

- Microsoft, Code window: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/code-window
- Microsoft, Properties window: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/properties-window
- Microsoft, Options dialog box: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/options-dialog-box
- Microsoft, GetSysColor: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getsyscolor
- Microsoft, System color constants: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/system-color-constants
- Microsoft, About scroll bars: https://learn.microsoft.com/en-us/windows/win32/controls/about-scroll-bars
- Microsoft, MsgBox: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/msgbox-function

- Microsoft, Object Browser: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/object-browser
