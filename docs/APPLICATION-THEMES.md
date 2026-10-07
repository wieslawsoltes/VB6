# Application themes

**Tools → Options → General → Appearance → Application Theme** selects the
project's appearance. Choose **OK** to save it, or **Cancel** to leave the
project, running application, and undo history unchanged. Windows Classic is the
default for new projects and for older projects without an appearance setting.

## Available styles

| Family | Light ID | Dark ID |
| --- | --- | --- |
| Fluent WinUI 3 | `fluent` | `fluent-dark` |
| macOS 26 | `macos26` | `macos26-dark` |
| X11 | `x11` | `x11-dark` |

`classic`, `standard` (Windows Standard 2000), and `contrast` (High Contrast
Black) are still supported. The selected family also supplies matching built-in
command, menu, dialog, form, and control icons. See [icon packs](THEME-ICON-PACKS.md).

Application preferences are separate from the similarly named IDE preferences:

- **Application: follow system light/dark appearance** follows the system within
  the chosen optional family without rewriting the saved ID.
- **Application: reduce transparency** removes macOS title-material blur. It does
  not flatten Classic captions or affect authored pictures and colors.
- **Application: reduce motion** removes theme control transitions. The browser's
  reduced-motion preference is also respected.

The Application appearance preview is inert and locally scoped. Changing it does
not start a VM, change the live form, or grant any runtime/agent permissions.
Applying only appearance updates existing designer controls in place and creates
one ordinary project undo entry. Applying to a running IDE application sends an
appearance update over the existing source/token-checked runtime bridge: it does
not restart the VM, reload forms, or overwrite live text/control values.

The IDE can remain Classic while the application uses Fluent Dark, or vice versa.
Changing IDE appearance alone never changes the project's application choice.

## Surfaces and states

The shared application skin covers browser forms, MDI parent/child chrome, window
commands, menus and submenus, MsgBox/InputBox dialogs, intrinsic-style controls,
text fields, list/combo boxes and their popup lists, check/radio states,
scrollbars, sliders, spin buttons, progress bars, frames, tabs, toolbars and
status bars. TreeView, ListView, RichTextBox, grids, calendars, date inputs,
charts, data navigators and the browser portions of registered adapters inherit
the same semantic colors and applicable component rules.

Existing control functionality is unchanged: theme work does not imply new API
compatibility in those controls. Nonvisual Timer, ImageList and CommonDialog
components still have their normal nonvisual runtime behavior. Native binary
OCX windows and OS-owned file/date/color pickers are not browser-rendered skins.

Hover, pressed, checked, indeterminate, selected, disabled and keyboard-focus
states use the appropriate palette. Native select arrows remain available in
forced-colors mode. The user's OS colors take precedence in forced-colors mode;
unsupported CSS adjustment properties are capability-reported by browser tests,
not treated as equivalent to a fully implemented native accessibility mode.

System OLE colors use the closest theme boundary. For example, Button Face and
Window Background change with the application palette; an explicit RGB
`BackColor` does not. Authored fonts, point sizes, twip geometry, images, icons,
RTF formatting, shape colors and layout constraints are not rewritten by a theme
switch. The theme does not override a deliberate hard-coded foreground/background
pair to make it fit a dark palette. Use system colors where adaptation is desired.

Canvas2D and WebGPU command rendering resolve system colors from the owning
application. Surfaces created before attachment refresh their theme during the
first size/layout pass. Existing drawings are invalidated on palette changes;
authored raster pixels are retained. This is not certification of every physical
GPU or native font/raster implementation.

## Project storage, export and embedding

The normal project snapshot carries the settings:

```json
{
  "settings": {
    "theme": "macos26-dark",
    "themeOptions": {
      "followSystemTheme": false,
      "reduceTransparency": true,
      "reduceMotion": true
    }
  }
}
```

These are project preferences, not IDE workspace appearance fields. Unknown IDs
fall back to Classic; only boolean `true` enables an option. Opening an older
project does not add absent default fields unnecessarily. Normal `.vb6web`
save/load, workspace snapshots, and standalone HTML export retain the settings.
Native VB6 `.vbp` files do not define these browser-only theme extensions; retain
a `.vb6web` snapshot when using them alongside original-format source files.

**File → Make project.html** embeds the runtime, all application palettes, all
matching built-in icon packs, and the selected preferences. It needs no IDE,
account, CDN, icon font or theme asset download. Browser-origin restrictions on
local files/storage still apply independently of theme support.

SDK consumers can supply the choice when mounting:

```js
const host = await VB6Runtime.mountApplication(project, container, {
  theme: 'fluent-dark',
  themeOptions: { followSystemTheme: true, reduceMotion: true },
  persist: false
});

// Session-only change: no VM restart or implicit project/storage mutation.
host.setTheme('x11-dark', { reduceMotion: true });
```

`host.setTheme(id, options)` returns the resolved profile. Omitting `options`
retains the host's existing options; passing `{}` clears them. Update the source
project's `settings` explicitly before exporting to persist a session-only SDK
change. `persist` continues to govern the application's virtual files/settings,
not a hidden copy of IDE appearance.

`VB6Runtime.RuntimeAPI` also exposes `THEMES`, `applyTheme`, `colorValue`,
`ApplicationThemeController`, `normalizeApplicationAppearance` and
`resolveApplicationTheme`. Use a controller for custom browser hosts requiring
system-preference tracking and effect options. Dispose it with its host.
Directly changing an attribute alone is not a substitute for graphics invalidation.

Independent and nested applications may use different palettes in the same
document. Every theme boundary resets palette, icon and skin tokens, including
Classic inside a modern application. Transient combo/menu portals copy their
opener's boundary and subscribe only while open. Trimmed submenus release their
listener immediately. They do not adopt whichever IDE/application happened to
last set the document's theme.

Electron's adopted browser form windows copy the owning host's appearance and
receive live palette/effect updates. Their OS-managed frame, native MsgBox and
file-picker UI remain under the operating system. HTML/Electron are the targets
for these skins. Direct Win32 AOT explicitly diagnoses an optional browser-only
application theme instead of silently pretending to render it with native
controls; choose a classic application theme for that target. The separately
licensed original VB6 toolchain does not implement these browser skins.

## Implementation and performance

`src/theme/platform-themes.js` owns the frozen optional profiles shared by the IDE
and applications. `theme.js` combines them with the three Classic profiles and
provides OLE/system-color resolution. `application-appearance.js` owns the
application controller and portal-copy lifecycle. `application-themes.css`
contains runtime component skins; `tools/application-theme-css.mjs` generates
complete boundary-reset tokens. `application-theme-settings.js` owns the Options
preview and draft settings. IDE controller/preferences remain independent.

Theme application performs bounded root-attribute changes and one notification,
not a per-control DOM reconstruction or polling loop. The browser still performs
normal style recalculation/painting. Media listeners are released on disposal and
non-BFCache page teardown; BFCache restores re-resolve the current system scheme.

Generated palettes, runtime/IDE bundles and standalone examples retain exact
fingerprint checks. Application theme changes intentionally affect runtime and
sample output hashes, unlike the earlier IDE-only theme change. Do not bypass
artifact verification to update them.

## Validation

```sh
npm run build
npm test
npm run test:application-themes
npm run test:application-themes:browser
VB6_BROWSER=firefox npm run test:application-themes:browser
VB6_BROWSER=webkit npm run test:application-themes:browser
```

The browser harness builds an owned gallery covering the 39 non-Pointer control
types and uses the existing MDI example. It exercises all six optional palettes, saved
export startup, authored RGB/fonts/geometry, values and selection, real VB Click
execution, late-created drawing controls, independent/nested boundaries, popup
and dialog behavior, MDI identity and new children, system scheme/effect options,
transactional Options/Undo, and authenticated live runtime updates. It also
checks every themed icon, selected/disabled states, six vector sizes and detached
IDE windows. The retained Validate browser matrix runs the suite over real HTTP
and file origins. Reports and screenshots are CI artifacts, not committed source.

A restricted environment may use `VB6_TEST_TRANSPORT=memory`. That run explicitly
skips the two HTTP-storage/file-origin cases; it is not a successful file-launch
or persistence certification.

These are original browser-rendered platform interpretations. They are not
native WinUI/AppKit/Motif bindings, copied platform artwork, every X11 window
manager, or a pixel-for-pixel native-platform certification. Arbitrary vendor
shadow-DOM/custom/native control artwork can require its own adapter styling.

## Caption and control fidelity

Application chrome uses the same locally reset detail tokens as the IDE. Classic
geometry and authored content remain unchanged. Fluent/macOS tree, list, grid
and rich-text borders no longer inherit Classic directional relief; X11 retains
that relief. X11 captions use the active title color rather than a light material
behind light title text. Caption controls preserve action identity across
minimize/maximize/restore, and honor disabled/hidden form flags.

Legacy `x11-cde`/`x11-cde-dark` project preferences migrate to `x11`/`x11-dark`,
including normalized project saves, standalone exports, runtime theme changes,
system-color resolution and explicit legacy icon-pack requests. Existing files
need no manual edit. Classic/Standard/High Contrast remain distinct profiles.
See [the fidelity maintenance contract](IDE-THEMES.md#fidelity-and-compatibility-maintenance).
