# Matching theme icon packs

The IDE and browser application controls select an icon pack automatically from
their local theme. There is no separate preference to get out of sync. Existing
Windows Classic, Windows Standard and High Contrast Black retain the original
pixel artwork. Optional families use original vector artwork:

| Theme family | Pack ID | Drawing treatment |
| --- | --- | --- |
| Fluent WinUI 3 | `fluent` | Fine monoline strokes, rounded joints |
| macOS 26 | `macos26` | Rounded, heavier strokes with restrained duotone fill |
| X11 Motif | `x11` | Square geometry and relief outlines |
| X11 CDE | `x11-cde` | Colored relief geometry with a distinct stroke weight |

Light and dark variants share their family's geometry and resolve ink/fill from
their own semantic palette. This is not recoloring the old pixel atlas. All
**111 registered command names and 40 toolbox types** have corresponding vector
artwork in **every** optional pack. `step` intentionally aliases `step-into`;
other command names and all control types have distinct bodies within a pack.
The explicit `missing` icon is for genuinely unknown names, not a substitute for
unimplemented registered commands.

## IDE and application integration

The normal `icon` and `controlIcon` renderers are used throughout menus,
customizable/large/floating toolbars, toolbox, Project Explorer, Properties,
form/code and document tabs, docking captions, Object Browser, source assistance,
debugger tools, data/resource tools, coding-agent and MCP interfaces. New/lazy
windows use the active pack without an extra registration step. Detached browser
windows receive the owner's theme attributes and render the same pack.

Caption close/minimize/maximize/restore/detach/help masks are generated from the
matching family, rather than being overwritten by legacy caption CSS. Additional
icon-like font characters in editor Find controls, tree/property expanders,
window commands, menu ordering, watches and stack navigation use decorative
pack-aware indicators while preserving Classic's original glyphs. Their parent
controls retain accessible names. Source text, user captions, punctuation and
user-supplied images/icons are not replaced.

Browser application menus, MsgBox icons, form/window commands, tree folders and
built-in control glyphs use the application boundary, independently of the IDE.
A modern IDE can therefore surround an unchanged Classic authored form; a modern
application can be previewed inside a Classic IDE.

Selected icons follow the selected foreground. Disabled icons use the disabled
foreground even inside a selected item. Forced-colors mode uses OS foreground
pairs and omits decorative relief shadows. Icons are decorative and hidden from
assistive technology where the parent control already supplies its label. No
keyboard/focus/event handlers are installed on the SVG layers themselves.

## Source API and architecture

`src/theme/icon-packs.js` is the original semantic vector source and complete
immutable registry. It asserts coverage against `icon-art.js`; a new registered
command/control cannot silently fall back to a generic optional icon. Geometry
uses SVG paths/rectangles/circles in a 16 × 16 view box, not a font or embedded
raster image. Packs apply family-specific stroke, corner, fill and relief
conventions to that semantic source.

`src/theme/icons.js` retains its original Classic serializer by default:

```js
import { iconSVG, icon, controlIcon } from './src/theme/icons.js';

const classic = iconSVG('save');
const fluent = iconSVG('save', 24, false, 'fluent');
const dynamic = iconSVG('TreeView', 32, true, 'auto');

// Existing IDE/control call sites use the locally inherited theme automatically.
toolbar.append(icon('save'));
toolbox.append(controlIcon('TreeView'));
```

The supported SVG size range is 8–64 pixels. Unknown icon names render the
explicit missing glyph; invalid pack IDs or sizes are rejected. Name/pack data
cannot inject arbitrary markup, scripts or external URLs.

Auto SVGs contain the Classic layer plus four CSS-selected vector layers. Only
the local pack is displayed. A root-theme change therefore preserves the SVG and
its parent control identity, selection and focus; it does not walk or replace
all icon nodes. Existing per-document template caching remains in place. This
trades a bounded number of hidden SVG paths per instantiated icon for no
per-switch DOM allocation or image-request race. No animation or background
polling is required.

`tools/icon-pack-css.mjs` generates complete visibility/caption tokens for each
boundary. Classic explicitly resets these tokens, so it cannot inherit a modern
ancestor's glyphs. `src/theme/icon-packs.css` handles selected/disabled/contrast
states and supplemental indicators. The normal build embeds these assets in both
IDE and runtime outputs, including standalone HTML. No asset server is required.

## Validation and licensing

```sh
npm run build
npm run test:application-themes
npm run test:application-themes:browser
```

Node tests verify complete keys, immutable maps, intentional aliasing only,
per-family differences, safe unknown-name handling, bounded SVG shapes, original
Classic serialization, caption masks, nested token resets and the absence of
external images, fonts or scripts. Browser contact sheets cover all 151 glyphs
in all eight appearances, selected/disabled/selected-disabled states, and
12/16/24/32/48/64-pixel vector sizes. Additional tests switch existing and newly
opened IDE tools and real detached windows without replacing icon controls.

The artwork is part of this project's MIT-licensed original implementation.
There are no bundled Segoe/SF font files, SF Symbols, extracted Microsoft icons,
or Apple platform artwork. The family labels describe visual design direction,
not an official platform asset pack, endorsement, or native pixel certification.
