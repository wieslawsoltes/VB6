# Issue 39 — annotated classic UI corrections

Original report: https://github.com/wieslawsoltes/VB6/issues/39

The reporter's 1312 × 966 annotation was inspected directly, including the marks
not repeated in the issue prose. Its PNG SHA-256 is
`a630d84009206fc64a97ffc25fbe3d58973ad187ace397e532e42832900645a2`.
No screenshot, executable resources or fonts from the reporter or Microsoft are
bundled into the product. The independent pixel fixtures are authored contracts,
not a claim of native Windows font or complete VB6 golden-image certification.

## Annotation-to-fix map

| Annotation | Correction |
| --- | --- |
| Maximize button missing an edge | A complete 10px rectangular mask replaces a clipped/scaled 16px general-purpose icon in caption contexts. |
| Crooked close buttons in Toolbox, Project, Properties, Form Layout and Immediate | Original integer-cell close artwork at its native 10px size; no font glyph or fractional 16-to-12 scaling. |
| Cramped document-caption icons | Caption-only masks fit within existing 14/16px buttons with the two-pixel bevel clear. Restore and detach artwork also use integer cells. The 15px floating-toolbar close button has an integer origin and retains absolute caption positioning. |
| Weird Toolbox bevels and Motif-like window frames | The attributed PR #36 staircase bevel layer covers forms/buttons/menus; `fidelity.css` extends the same border-box paint to remaining MDI, dock and IDE frames. Border dimensions and resize hit targets are retained. |
| Missing right toolbar bevel | Left/right edge strips complete the existing top/bottom paint without changing the fitting desktop toolbar's 29px height. |
| Unnecessary toolbar horizontal scrollbar | Horizontal docked toolbars wrap whole commands under constraints. Buttons remain reachable by pointer and keyboard; vertical and floating toolbars retain scrolling. Existing small-screen zoom visibility is unchanged. |
| Two highlighted Tools menu items | `menu-selected` is the sole paint owner; pointer selection moves focus. A stationary pointer cannot keep a second hover highlight after keyboard navigation. Nested menus retain one highlight per level. |
| Missing bottom bevels on Object/Procedure lists | Native selects receive all four inset edges. Their existing 25px row now fits a 21px field, padding and separator instead of overflowing it. Native popup and keyboard behavior remain. |
| Extra line beneath the selected Properties tab | A one-pixel bridge covers only the adjoining grid's top border, beyond the tab's own bottom border; it does not cover the first property row. |

## Implementation

`src/theme/fidelity.css` is appended after the existing shared styles by
`tools/build.mjs`, for the modular/standalone IDE, reusable controls CSS and HTML
exports. Caption art is a local SVG mask; there are no network requests, font
assets, observers, geometry reads or additional application DOM nodes. General
16px toolbar/toolbox icons and their public 111-name inventory are unchanged.

Normal, pressed and disabled caption states use exact cell positions. Disabled
highlights are separate offset masks, not a filter clipped by its own mask.
Theme colors are resolved at nested boundaries; forced colors keep real borders,
system colors and keyboard focus. MDI maximize/restore/minimize/close and real
browser detachment retain their existing event handlers and accessibility names.

`src/theme/menu.js` retains the shared IDE/runtime menu session, ownership and
keyboard logic; its pointer selection now follows the active item with focus.

The staircase technique attribution and complete Jordan Scales / 98.css MIT
notice remain in `src/theme/bevels.css` and `LICENSES/98.css.txt` (PR #36).
Caption artwork and issue-specific CSS/JavaScript here are original project code.

The bundler normalizes only source-label path separators to `/`. This prevents
Windows versus POSIX labels from changing generated bundles and nested runtime
payloads. Module resolution, emitted program semantics and the existing comment
terminator guard are unchanged. A portable regression simulates both separator
conventions and requires byte-identical bundled output.

## Reproduction and validation

```sh
npm run build
npm test
python tools/browser-issue39.py --engine chromium
python tools/browser-issue39-state.py --engine chromium
python tools/browser-classic-html.py --engine chromium
```

The main suite checks exact authored mask and bevel pixels at DPR 1, 2, 3 and 4;
actual editor/tab/toolbar geometry at DPR 1, 1.25, 1.5 and 2; wide and 390px
layouts; disabled/pressed/theme/focus behavior; genuine pointer-to-keyboard menu
handoff; MDI actions and detached-document style adoption. HTTP and standalone
file navigation run in CI. `--inline` explicitly selects a restricted local
review transport, not a deployment-origin substitute. Screenshots, environment
metadata and results are retained under `reports/issue39/<engine>`.

The supplemental state suite operates on the actual floating Standard toolbar,
not an isolated caption fixture. It verifies 15px Close positioning, pointer hit
testing, dragging, pointer/Enter hide, redisplay and redocking at DPR 1 and 1.25.
Those position regressions fail against the preceding relative-position style.
It also checks native-disabled and ARIA-disabled caption ink under forced colors;
engines without forced-colors emulation explicitly report that case as skipped.
Results are retained under `reports/issue39-state/<engine>`.

`--baseline` in the main suite is a diagnostic reversion of this change's final
stylesheet and menu pointer-focus line; it intentionally fails the new visual
contracts. It is never used as a passing release gate. Permanent CI runs
unmodified production listeners, tests all three browser engines, and requires
reproducible bundles. Existing input/designer and compiler/runtime/visual suites
remain enabled. Functional issue fixes are independently merged in #20, #22,
#25 and #31.

## Scope

These corrections address the concrete annotations in issue #39 without changing
the classic layout or introducing a different renderer. Integer-DPI exactness is
for the specified authored glyph/chrome pixels. Fractional scaling still uses the
browser rasterizer; native OS fonts, browser-owned select popups, OS window chrome,
and every native VB6/theme/DPI combination are not certified as pixel-identical.
