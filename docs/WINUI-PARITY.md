# WinUI 3 resource-backed themes

`fluent` and `fluent-dark` share the same WinUI resource vocabulary in the IDE,
application designer, application runtime, Options preview, detached browser
windows, dialogs, portals and standalone HTML exports. IDE and application
appearance are still independent. Classic remains the default.

## Pinned reference and attribution

The reference is Microsoft.UI.Xaml in Windows App SDK **2.5.1**, tag
[`winui3/release/2.5.1`](https://github.com/microsoft/microsoft-ui-xaml/tree/winui3/release/2.5.1).
The resource paths below are relative to `src/controls/dev/CommonStyles/`:

| Resource | Git blob |
| --- | --- |
| `Common_themeresources_any.xaml` | `ca07acb962a7c018a174bf28dcd0e945b13ddb4d` |
| `Button_themeresources.xaml` | `e63c32389e599c2277061d9ce29483516e6927a3` |
| `CheckBox_themeresources.xaml` | `71e21d32b764c8b7fc6fe7312e7a6847a0fb5c89` |
| `RadioButton_themeresources.xaml` | `223a28385186f36a4629d354928e5fb705ab10b3` |
| `TextBox_themeresources.xaml` | `6934b646465eb602218f2ebf950268ac689ea33c` |

The 83 common color resources retain their native names, including upstream
spelling, and their original alpha bytes. XAML `#AARRGGBB` is explicitly converted
to CSS `#RRGGBBAA`; a malformed value fails rather than silently changing channels.
Colors are Microsoft MIT-licensed adaptations. `LICENSES/WinUI.txt` retains the
complete license, which is also embedded in the generated application CSS and
therefore in standalone HTML. Release packaging retains the entire LICENSES tree.
No Microsoft font binaries, icon fonts, native DLLs or platform artwork are added.

## Implemented rendering rules

**Standard and accent buttons.** Normal, pointer-over, pressed and disabled
states use distinct native fill and foreground resources. Accent hover/pressed
fills retain the reference 90%/80% opacity. A masked one-pixel border paints the
three-DIP elevation gradient independently of the inner fill; light and dark
border directions differ. Pressing does not shift the content. Padding is
`5px 11px 6px`; the background transition is 83 ms. Keyboard focus is separate
from the default action rather than a permanent dotted rectangle. The outer
two-DIP focus stroke has a separate one-DIP inner stroke, using
`FocusStrokeColorInner`, and survives keyboard press and pointer hover without
changing control bounds. IDE command-bar
buttons use subtle-fill resources instead of standard raised-button paint.

**Editable text.** TextBox, ComboBox text fields, date fields and dialog input
use normal, hover, focused and disabled resources. Focus strengthens the bottom
stroke from one to two pixels and selects the active input fill. The TextBox host
is transparent when its authored background is OLE Window, preventing a second
white layer underneath a translucent control fill. Dark disabled text uses the
reference TextBox-specific `#5DFEFEFE`, not the common `#5DFFFFFF` resource.
Text, selection and control identity are retained across theme changes.

**Check and radio controls.** The glyph box is 20 by 20 CSS pixels. Check glyphs
are 12 by 12; indeterminate marks are 12 by 2. Checked radio glyph insets change
from three to two to four pixels for normal, hover and pressed states. Checked,
unchecked, indeterminate and disabled fills and strokes are independent. Authored
outer control dimensions and label fonts do not change. Radio glyphs keep
`TextOnAccentFillColorPrimary` in pressed and disabled states; they deliberately
do not reuse the checkbox disabled/pressed foreground resources.

**Surfaces and supporting components.** The IDE uses a 14-pixel body font,
32-pixel ordinary buttons and input minimum height, semantic dialog surfaces,
24-pixel dialog-body/footer padding, 32-pixel menu rows, rounded selections,
separate tooltip/flyout corners and accent selection indicators. Application
menus, combo/list/tree selections, frames, scroll tracks, ranges and progress
bars consume the same boundary-local resources. Dense property editors retain
their existing compact layout. Authored application controls do not acquire IDE
minimum heights or a new VB font size.

Existing form captions, docking, composite controls, grids, rich text, calendars,
drawing controls and registered adapters continue to consume the shared palette
and existing platform-detail rules. They are not newly certified native WinUI
control templates by virtue of consuming these resources.

## Boundary, authoring and accessibility contracts

Every application boundary resets every generated WinUI token, including
non-Fluent families, using the guaranteed-invalid custom-property value. Existing
Classic/macOS/X11 component fallbacks therefore remain effective, even when nested
inside a Fluent IDE or application. Runtime painting has no Fluent ancestor
selector. IDE-only selectors exclude authored application subtrees.

`control-theme-color.js` wraps only expected system-color roles: CommandButton
Button Face and control text, and editable-control Window and control text.
Explicit RGB values and other system-color roles remain authored. The existing
VB model, twip geometry, font points, undo records, VM, input values and graphics
invalidation lifecycle are not replaced. Theme changes still use the existing
boundary-attribute update; this work adds no per-control observer or polling loop.

Forced-colors mode retains system-owned colors and existing accessibility rules;
resource-backed painting is guarded by `forced-colors: none`. Reduced motion
resolves the new transition duration to zero. Native platform fonts are used only
when installed, with the existing fallback stack on other platforms.

## Build and validation

`tools/winui-theme-css.mjs` translates the frozen resources into state aliases,
metrics and complete boundary resets. The application and IDE palette generators
include those tokens. `winui-controls.css` supplies runtime paint;
`winui-ide.css` supplies IDE density and styling. `tools/build.mjs` includes the
sheets in generated CSS, runtime payloads, standalone exports and the IDE.

```sh
npm run build
npm test
npm run test:winui
npm run test:winui:browser
npm run test:application-themes:browser
npm run test:themes:browser
python tools/browser-native-caption-tests.py
python tools/ci/check.py
python -m unittest discover -s tools/ci -p 'test_*.py'
```

The WinUI browser entrypoint belongs to the existing integration-authoring CI
suite and its browser matrix. `VB6_BROWSER=firefox` and `VB6_BROWSER=webkit`
select the other engines. `VB6_TEST_TRANSPORT=file` selects a real file origin for
the WinUI harness. Restricted local runs may set `VB6_TEST_TRANSPORT=memory`;
that transport is identified in the report and does not certify HTTP storage or
file-launch behavior. Existing origin-specific suites keep their own assertions.

The new tests independently assert state-critical source values, ARGB conversion,
all 83 common resources, all boundary resets, OLE/RGB ownership, generated output,
license retention, real runtime and IDE button/check states, input underlines,
authored geometry, text selection, and non-Fluent fallback equivalence. Captures
at device scales 1, 1.25, 1.5 and 2 check repeatability. Generated artifact hashes
remain mandatory: explicitly review/update the manifest while authoring, then run
an ordinary build to verify it. CI must never regenerate its own expectations.

## What is not certified

**This is resource-backed browser rendering, not 100% native pixel parity.**
Repeatable browser captures are not native reference images and must not be
reported as such. The browser report explicitly sets `nativePixelCertification`
to false. The work does not implement native Mica/Acrylic composition, Windows
text rasterization, native file/date/color pickers, vendor OCX artwork or every
WinUI control template. Authored VB geometry can intentionally be smaller than a
native WinUI minimum. The accent remains the project's selected palette accent,
not a claim that the browser can read the operating system's accent ramp.

A pixel-certification gate still requires an independently captured native WinUI
fixture at the pinned SDK revision, Windows build, font, accent, scale, contrast,
activation and interaction state. Match those conditions before comparing the
corresponding browser output. Store reference provenance and actual difference
images; do not bless the implementation's own captures as native goldens or loosen
thresholds to hide font/compositor differences. Native Windows/Electron execution
and the full remote Validate gate remain separate requirements before merging.

## Continuation regression checks

The focus-ring and radio state tests exercise both application and IDE paint.
They check the secondary focus stroke separately from the primary outline, retain
focus during Space-key activation, verify that focus does not change geometry,
and distinguish checkbox disabled ink from the radio's primary ink.

Microsoft documents the secondary focus border and its one-DIP default in
[FocusVisualSecondaryThickness](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.frameworkelement.focusvisualsecondarythickness).
The pinned RadioButton resource above maps normal, hover, pressed, and disabled
glyph fill to `TextOnAccentFillColorPrimary`; no platform font is redistributed.


## Painted-frame and drawing-layer regressions

Form and PictureBox graphics can be allocated after their child controls. Their
Canvas2D and WebGPU/overlay planes now share a negative stacking level inside an
isolated drawing host, below controls but above the host background. This preserves
GPU-before-overlay DOM order, alpha composition, authored control dimensions and
VB `ZOrder` behavior. No pointer-event interception or per-frame observer is added.
A DOM-visible/clickable input is not sufficient evidence: an otherwise transparent
to-input canvas can still cover every pixel of it.

Browser tests therefore sample real composited PNG pixels across all nine themes,
both Form/PictureBox containers and repeated ZOrder changes, and execute an actual
VB Click afterwards. The two-plane synthetic fixture tests stacking and alpha
composition only; required real WebGPU/WebGL2 jobs remain separate.

The native Electron smoke harness now retains a screenshot only after sampling
that exact PNG for the current form palette and unobscured TextBox. It waits for
renderer frames with bounded capture/inspection deadlines, records every mismatch,
and fails on persistent stale/occluded pixels. The portable PNG sampler is also
exercised at 1x, 1.25x and 2x with negative proofs for a stale Light frame under a
Dark oracle and an opaque input overlay. Native bitmap channel ordering is not
assumed. These are implementation-state/visibility probes, not independent native
WinUI reference pixels; native pixel certification remains false.

The WebKit regression retains exact brush values and bounded assertions. It awaits
the requested pointer/style state rather than accepting an intermediate animated
alpha from an arbitrary frame. No color tolerance, skipped failure or relaxed
fingerprint is used to make a browser pass.

## Integration with shared platform detail roles

The merged X11 fidelity work on main (`d0814313`) adds shared indicator, menu,
range and focus roles. WinUI overrides consume those roles as their non-Fluent
fallbacks instead of restoring historical hard-coded Classic values. In
particular, X11 retains its 9-pixel square check mark, diamond radio inset,
stippled mixed state, disabled gray ink, neutral active menus and range relief.
Default-command elevation reads the WinUI shadow slot first so an X11 shared
rule cannot erase Fluent's independent inner keyboard-focus stroke. The
existing X11 state/pixel suite and WinUI focus/disabled-glyph suite are both
retained: integration does not replace one family's assertions with the other.

## Deterministic browser interaction and lifecycle

The WinUI state harness parks the pointer at two interior viewport positions after
palette and enabled-state changes, rather than relying on `(0, 0)` at the viewport edge. Normal
states still require the real control to lose `:hover`/`:active`; the brush
assertions remain exact. A dedicated regression cancels a pressed command by
releasing outside it, changes the palette while disabled, re-enables it, and
checks both normal ink/fill and that no VB Click handler executed.

IDE palette cases operate on the same IDE and project instances. They dismiss the
previous Options draft through Cancel before reopening it in the next palette and
assert identity preservation. Before measuring the IDE or destroying a fixture,
the harness observes the current diagnostics scheduler reaching its terminal
state (no pending job, busy job, or scheduled timer). It neither disables workers
nor suppresses page errors: errors raised during context closure still fail the
suite. The existing bounded timeout also fails if diagnostics become stuck.
This is fixture synchronization, not a claim to fix the WebKit engine's handling
of requests started during document replacement.

`reports/winui/<engine>/results.json` includes the actual unittest result: test
count, success, failure/error/skip counts and failure tracebacks, in addition to
per-state records. Passing paint assertions followed by a teardown failure can
no longer be mistaken for a successful suite by reading only those records.
The full integration browser matrix and all generated-output checks remain in
the existing required Validate workflow.
