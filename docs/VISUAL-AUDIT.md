# Detached-window update

The historical 0.3–0.5 observations below predate detached IDE windows. Tool groups, documents and command bars now support separate browser windows; see [Browser windows](BROWSER-WINDOWS.md) and the dedicated integration suite. This supersedes the older “in-page only” IDE limitation, not the unrelated native designer/runtime compatibility gaps.

# Visual review — VB6 Studio Web 0.6.0

Reviewed the new shared-theme Resource Editor, dockable explicit evaluator, runtime MDI parent/child window chrome, resizing, window lists, MDI designer properties and eleventh example. New feature screenshots are in reports/boundaries-06. Explicit evaluation now restores a previously minimized runtime preview after a visual check found it covering paused source.

The 34 implementation screenshot states were reviewed and rerun against updated same-environment goldens. Twenty-one images differ from 0.5 because of added properties/template/tool surface changes; exact image differences are recorded in reports/visual-review-06.json. Additional new feature captures are separate single-state evidence. No native VB6 golden images were available. Local fonts, browser text rasterization, authored controls, DPI and OS widgets prevent a certified native pixel-equivalence claim. No font files or Microsoft artwork are bundled.

## Historical reviews

# Visual, theme and interaction audit — VB6 Studio Web 0.5.0

## Current scope

The 0.5.0 review covers the recovered dock/tab/floating/toolbar/editor system and new diagnostic, Data Tip, source drag and saved-profile interactions. Shared classic themes remain consistent with the earlier 0.3/0.4 review below. Additional screenshots are in `reports/finalization-05/` and `reports/recovery/`. Data Tip placement was corrected after visual inspection found an older fixed-position CSS rule overriding its editor-relative geometry.

**This is not a native pixel-equality certificate.** No controlled native VB6 installation was available as a screenshot oracle. There are 34 reviewed, repeatable implementation goldens, plus separately reviewed feature screenshots. The golden harness waits for diagnostics to settle, hides carets and checks repeated frames. Original own goldens were explicitly reviewed and updated for 0.5.0, not presented as unchanged native screenshots.

Current test counts and run evidence are in TESTING.md and reports/release-validation-05.json. Historical findings follow; their before/after descriptions refer to the named earlier versions, not newly implemented runtime functionality.

## 0.4.0 reviewed changes

| Surface | Implemented and checked | Remaining boundary |
|---|---|---|
| Object Browser | Modeless MDI; library, class/member columns and signatures; search/private filter; Back/Forward and source jump; original SVG list glyphs; keyboard lists and resize splitter. | No native type-library loader, native Help integration or certification of every original field/command. |
| Tool lifecycle | Active tool survives workspace rerender; Ctrl+F4/Ctrl+F10, close/reset, incomplete-source refresh and continued code editing. | In-page MDI only, not detached native windows. |
| Project search | Compact find/replace rows, literal query/options, line previews, exact navigation, virtual results and atomic guarded replacement/undo. | Browser extension workflow; no regex/semantic search or full native Find dialog replica. |
| Bookmarks | Source markers coexist with breakpoints in both panes, edit/undo-aware line positions and project navigation. | Saved in browser metadata, not native VB6 workspace files. |
| Themes and scale | New Object Browser reviewed in Classic, Standard and High Contrast; 390px layout and keyboard interactions. | Local font/DPI and physical-device rendering are not certified. |
| New Project | Runtime Workbench adds the tenth example (eleven choices including blank Standard EXE); retained three-page dialog and scrollable template panel. | Deliberately browser-app templates, not native DLL/OCX project types. |

Seven additional feature screenshots appear under `reports/features-04/`. They are single reviewed captures, **not** added to the 34 repeated/golden state count. `reports/visual-review-04.json` records the one updated legacy golden: the New Project template row gains an icon for Runtime Workbench, changing 293 pixels in bounds (625,559)–(655,570). The other 33 prior images were unchanged. The complete visual suite was rerun after reviewing that specific addition; expectations were not changed to conceal a layout failure.

## Baseline findings and implemented changes

| Area | 0.2.0 finding | 0.3.0 implementation | Evidence / boundary |
|---|---|---|---|
| Shell density | 24px main caption, 23px menu, 31px toolbar, 23px status, 266px right dock; mixed gray/gradient styling. | 20/21/29/21 CSS-pixel chrome, 240px right dock, compact 17px tree/property rows and consistent theme variables. | Browser geometry assertions; design profile, not native measured coordinates. |
| Palettes | Multiple hardcoded grays/navy values and incomplete system-color mapping. | One data source for three profiles; Win32 role indices 0–30 (reserved 25 falls back to face), signed/unsigned OLE system colors, matching CSS and drawing RGB resolution. | Unit tests, IDE/runtime/export theme assertions. |
| Icons | Toolbox symbols depended on font glyphs and could appear as emoji. | Original 16px SVG glyphs, classic border and arrow geometry, theme-aware disabled/focus states. | Toolbox SVG count and own screenshots. Original Microsoft bitmaps are not bundled. |
| Default workspace | Full-height single document presentation and browser-extension tabs dominated the shell. | Live MDI windows and hidden-by-default document/debug extension tabs. Gray workspace is visible around child windows. | Designer/code screenshots, MDI tests. |
| MDI interaction | Document switching reused the central surface; classic cascade/tiling behavior was limited. | Independent live designer/code windows, activation, eight resize handles, moving, minimizing, maximizing/restoring, cascade, horizontal/vertical tiling, window list and geometry snapshots. | Six-window nonoverlapping tiling, buffer/caret preservation, pointer and keyboard tests. Runtime MDIForm is not implemented by this change. |
| Tool panels | Visibility and floating behavior were coupled or incomplete. | Independent project/properties/layout/toolbox/debug visibility, floating/docked geometry, caption double-click, keyboard docking and accessible splitters. | Browser interaction tests. Floating windows remain inside the page, not separate OS windows. |
| Menus | Opening a submenu replaced its parent. Native focus/keyboard hierarchy was incomplete. | Retained submenu stack shared by IDE and runtime; mnemonic keys, arrows, Home/End, Enter/Escape, hover switching, disabled/check states, viewport flipping and focus return. | Runtime event dispatch, multi-level Escape and 390px bounds tests. |
| Properties | Always-visible web inputs, roomy rows, incomplete categories/color/font editing. | Compact active-value editor, shared multi-selection properties, alphabetic/categorized views, collapsible groups, Font aggregate/subproperties, resizable name/value columns, F2/arrow navigation and cancellation. | Edits, cancellation followed by commit, collapsed ARIA state, undo, keyboard resizing. |
| Color editor | System colors were not presented as a classic property palette. | 25 named system colors and 48 RGB swatches, two real tabs, OLE hexadecimal display, keyboard access and atomic undo. | Counts, color value/readback, designer paint and undo tests. |
| Font editor | Flat font fields without a complete property editing workflow. | Family/style/size/effects, preview, accepted/cancelled transaction and expanded font subproperties. | Browser edit/undo tests. Only installed fonts are available; no font file is downloaded or bundled. |
| Source windows | Only one full-module textarea view; split/procedure behavior absent. | Shared full source with independently scrolling full-module/procedure/declarations projections, live split resizing, active-pane object/procedure selectors and lower view buttons. | Projection unit tests and source-edit, undo, find/replace, selection, breakpoint and execution-marker tests. |
| Source fidelity | Editor colors/font/separators were inconsistent; view state could be lost. | Courier New local-font default, configurable size, classic token/selection colors, procedure separators, Ctrl+Up/Down procedure navigation and Ctrl+Y source-line deletion. | Own code screenshots in each theme; lexical services remain incomplete semantic tooling. |
| Dialogs and Options | Tabs were largely presentational and browser dialogs differed in focus behavior. | Actual Options Editor/Editor Format/General/Docking pages; transactional cancel; New/Existing/Recent project pages; constrained draggable modal surfaces with focus containment. | Tab keyboard, Cancel and inertness tests. Not all native Options fields/dialog designs are implemented. |
| MsgBox/InputBox | Browser-specific or incomplete classic modal behavior. | Theme-scoped modal boxes, icons, button/default/cancel mapping, input selection, nested focus/inert restoration and drag handling. | Runtime Yes/No behavior rejects an invented Cancel; nested modal/input tests. |
| Scrollbars | Range-input substitutes did not resemble or operate like native scrollbars. | Classic arrow/track/thumb widgets, keyboard navigation, page/line steps, hold repeat, reversed ranges and Scroll/Change dispatch. | Pointer, keyboard, ARIA and event tests. |
| ComboBox | Editable combo lacked a persistent arrow; popup styling depended on browser datalist behavior. | Classic arrow, retained theme-scoped popup, editable/list-only/simple styles, keyboard commit/cancel, prefix search and virtualized items. | Real VB Click/Change, 10,000-item bounded popup, narrow bounds and style tests. |
| UpDown | A narrow HTML number field rather than the expected pair of arrow buttons. | Two-button vertical/horizontal spinner, repeat, wrap, increment and bound checks, keyboard and disabled states. | Unit and browser input tests; native buddy-control integration is not complete. |
| Chart | Initial canvas paint could be missed before connection; colors ignored the active system palette. | Paint invalidated after mount; theme-aware chart background/text/lines/bars. | Gallery canvas/initial-paint check in each theme. Chart feature parity remains partial. |
| Designer | Inconsistent sheet margins, grid/handle colors and theme mismatch. | Classic sheet inset, six-pixel selection handles, distinct container geometry, system-colored grid and live application-theme scope. | Screenshots and existing pointer/snapping tests. Twips use 15 per CSS pixel. |
| Runtime theme/export | Designer, runtime and export could disagree on palette. | Independent IDE appearance and saved application theme. HTML exports carry the theme and the same shared styles/widgets. Authored RGB values remain authored. | Export readback, no external assets, rendering-color tests. |
| Accessibility/UI state | Several false ARIA values were removed; losing a split pane could lose the active editor. | Correct string-valued ARIA/enumerated attributes, active-pane transfer, menu/dialog focus restoration, keyboard tabs, splitters and widgets. | Regression assertions. This is not a full accessibility or physical screen-reader audit. |
| Scaling and touch | Small-screen behavior lacked visual baselines. | 1024px, 390px touch viewport, DPR2 and forced-colors checks; narrow menu/dialog placement and inspector drawer. | CSS geometry plus 2560×1800 screenshot at DPR2. No physical-device/OS DPI certificate. |

## Theme contract

| Profile | Face | Active caption | Window | Selection |
|---|---|---|---|---|
| Windows Classic | `#c0c0c0` | solid `#000080` | white / black text | `#000080` / white text |
| Windows Standard (2000) | `#d4d0c8` | `#0a246a` → `#a6caf0` | white / black text | `#0a246a` / white text |
| High Contrast Black | black | navy | black / white text | purple / white text |

These are explicit recreated browser profiles, not a live Windows theme engine. `Tools → Options → General` selects IDE and application themes separately. `project.settings.theme` travels with a saved/exported app. Theme role changes do not overwrite an explicitly authored RGB color, even where the author chose a low-contrast combination. System forced-colors is checked separately.

The preferred UI face is a local `MS Sans Serif`, followed by Tahoma/Arial; the source default is local Courier New with monospace fallback. Exact glyph metrics depend on the machine. The package contains no `.ttf`, `.otf`, `.woff`, `.woff2` or `.eot` files, and the packager rejects them.

## Control review coverage

The galleries include all 19 offered intrinsic-style and 18 extended-style controls. Intrinsic coverage includes labels/text, button/check/radio, combo/list, frames/pictures, horizontal/vertical scroll, file lists and drawing shapes. Extended coverage includes tree/list, tabs/toolbar/status, grids, rich text, progress/slider, date/calendar, UpDown, image/dialog adapters and chart.

The three themed gallery pairs are initial-state visual baselines, not complete state matrices for each control. Existing functional suites exercise populated tree/list/tab data, bound/unbound grids, rich-text selections and formatting, real dialog files, timers, dynamic controls and source events. The new suite adds selected/open/disabled popup, scrollbar, stepper and menu states. Full owner-draw, every native style flag, hover/pressed/disabled combination, resource icon/mask mode and native OCX API is not certified.

## Screenshot and test method

The current suite totals are recorded in TESTING.md. The visual suite contains 42 interaction cases; an additional golden-comparison case checks all 34 implementation screenshot hashes in the same environment. The 42 visual cases contain many individual DOM, value, focus, geometry and event assertions; the count is cases, not assertions.

For each screenshot, the harness disables animations, hides the caret, waits for paint, captures twice, and checks the number of changed RGB pixels is zero. The reviewed first image is SHA-256 recorded in `tests/visual-goldens.json`. `--check-goldens` rejects an environment or image-set difference. Its metadata explicitly states `nativeVB6ReferencePixels: false`.

Screenshots include classic designer/code, both other code themes, six control galleries, selected source, split/procedure views, menus, color/font/options dialogs, MDI and floating panels, custom combo/spinner, runtime dialogs, exported theme, narrow layout, forced colors and DPR2. Before screenshots from 0.2.0 are included as `before-designer.png` and `before-code.png`; they are not golden inputs.

The exact comparison is deliberately not tolerant of changed font rasterization. A different browser/font environment should use behavior tests and an explicitly reviewed screenshot update, not silently relax the comparison. Replacing our goldens with native screenshots would not by itself create a valid native comparison: viewport, app fixture, OS version, classic theme, font files/settings and DPI must also match.

## Important remaining differences

The most consequential remaining visual/UX differences are local-font metrics, reconstructed rather than original bitmap icons, browser-adapted outer caption actions, missing native Add-Ins, incomplete native Object Browser/type-library integration, complete native customization/add-in surfaces and some project/debug dialogs, incomplete original Options fields (including complete native editing/locale/IME behavior), and some platform-owned controls/choosers. Date-picker popups and host file dialogs are not under this renderer's full control.

IDE MDI and in-page floating panels do not implement runtime MDIForm/UserControl/UserDocument/report designers or detached operating-system windows. Modern find-bar, optional browser tabs, private-files tools and HTML export workflows are intentional browser extensions, not original VB6 screen replicas.

Native COM/OCX/DLL execution, full runtime/file semantics and external data providers remain bounded by `COMPATIBILITY.md`. Hardware WebGPU, Firefox/Safari, physical mobile devices, native IME, arbitrary fonts/DPI and accessibility compatibility have not been validated. Direct file navigation is reported separately from inline browser execution. None of those gaps are erased by the own-golden checks.

## Primary references consulted

These references establish relevant shared behavior and color-role semantics. Office VBA UI documentation is identified as such; it is not a complete VB6 IDE pixel specification.

- Microsoft, Code window: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/code-window
- Microsoft, Properties window: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/properties-window
- Microsoft, Options dialog box: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/options-dialog-box
- Microsoft, GetSysColor: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getsyscolor
- Microsoft, System color constants: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/system-color-constants
- Microsoft, About scroll bars: https://learn.microsoft.com/en-us/windows/win32/controls/about-scroll-bars
- Microsoft, MsgBox: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/msgbox-function

- Microsoft, Object Browser: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/object-browser
