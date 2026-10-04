# Classic IDE icon audit

## Fixed coverage

The starting command catalog contained 86 commands. Twenty-four requested an
unregistered glyph and silently displayed `form`: Select All, Indent, Outdent,
Toggle/Next/Previous Bookmark, Last Position, Add Watch, Quick Watch, Watch,
Toolbox, Align Left/Right/Top/Bottom, Bring to Front, Send to Back, Align to Grid,
Show Grid, Lock Controls, Menu Editor, Print Code, Components, and Customize
Toolbars. Other commands incorrectly reused an existing glyph (all three step
commands, all size/distribution commands, code assistance, and debugger windows).

The shared registry now defines 111 named IDE glyphs and 39 distinct toolbox
control glyphs. All 86 catalog commands resolve registered artwork. `step` is a
retained compatibility alias of `step-into`; other named entries are distinct.
The Pointer control and the IDE pointer intentionally depict the same tool.
Names for browser-only features use the classic visual vocabulary, not a claim
that those commands existed in Microsoft's product.

Corrected families include:

- File and shell: binocular Find, property-sheet/hand, connected Object Browser
  objects, Project Explorer, Toolbox, printer, forms/modules/classes, form layout,
  help/status and window chrome.
- Edit and Debug: distinct bookmarks, indentation, comment/uncomment, completion,
  member/constant lists, information tips, Step Into/Over/Out, execution cursor,
  breakpoints, watches, Locals, Immediate and Call Stack.
- Form Editor and controls: six alignment guides, three size commands, two
  distribution commands, z-order, grid, lock, menu and tab order; all intrinsic
  toolbox entries and distinct grid, calendar, tab, image, list and common-control
  variants. Object Browser member rows use method/property/constant/class/event/
  module glyphs instead of generic property icons.

The same command-to-icon catalog decorates IDE menus and context menus, including
lazy submenus. Existing command identifiers, shortcuts, callbacks, saved layouts
and runtime/application menu descriptors are unchanged. Checked menu entries
retain their checkmark rather than replacing it with command artwork.

## Rendering

`src/theme/icon-art.js` contains authored 16 by 16 pixel drawings. Integer cells
are packed into horizontal SVG path runs per color, rather than one DOM node per
pixel. `src/theme/icons.js` caches markup and clones document-local templates;
callers never share mutable nodes. There are no network resources, icon fonts,
emoji, embedded Microsoft images or font files.

Toolbox glyphs are native 16px art centered in the existing 20px slot, removing
fractional 16-to-20 stretching. Large toolbar slots and their SVGs both use 24px;
the former 16px container no longer clips the enlarged icon. Smaller caption
sizes and user/browser zoom remain supported; fractional display scaling is
subject to the browser rasterizer.

Disabled commands use a foreground mask with gray shadow and one-pixel light
emboss, not a translucent grayscale filter. Each of Classic, Standard and High
Contrast defines a complete icon palette at its own theme boundary. A classic
application nested in a high-contrast IDE no longer inherits an ancestor-wide
inversion filter. Forced-colors mode uses system colors. SVGs are decorative,
nonfocusable and aria-hidden; buttons retain their accessible command labels.

Unknown icon names now render an explicit missing-art tile with
`data-missing-icon="true"`, never a plausible but wrong Form or OLE icon. Registry
lookups reject inherited property names and do not interpolate untrusted names
into SVG. All shipped command/control paths are tested to avoid that tile.

## References and visual comparison boundary

The supplied IDE screenshot was the defect reference. The following public
Microsoft documentation supplied reference silhouettes and the meanings of the
shared classic Visual Basic/VBE toolbar symbols:

- [Standard toolbar](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/standard-toolbar)
- [Debug toolbar](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/debug-toolbar)
- [Toolbox](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/toolbox)

The MicrosoftDocs/VBA-Docs reference images for Find, Properties, Object Browser
and Step Into/Over/Out were inspected during the redraw. VBE and VB6 share many
symbols, but VBE is not a native VB6 golden-image set. These drawings are authored
reconstructions, not extracted VB6 executable or OCX resources. The implementation
removes missing/misassigned art; it does not certify byte-for-byte agreement with
every VB6 version, third-party OCX, Windows theme or DPI setting. No proprietary
artwork or fonts were added to the repository.

## Reproducible validation

```sh
npm run build
npm test
python tools/browser-icon-tests.py
# In a Chromium environment that permits file:// and localhost navigation:
python tools/browser-icon-tests.py --launch all
```

`tests/icons.test.mjs` checks catalog/default-bar/static-call coverage, all 39
controls, distinct semantic variants, immutable bounded pixel data, SVG safety,
missing-name/prototype handling, size validation, lazy menu decoration and palette
resets. The browser suite checks the actual built IDE's four toolbars and menus,
Object Browser, normal/large icons, all three themes, 1x/2x device scale, forced
colors, disabled transitions, cache isolation and nested application themes.
`--launch all` also loads the actual standalone file and the split HTTP build.

The suite writes full icon contact sheets, IDE screenshots and machine-readable
results to `reports/icons/`. These are implementation regression images, not
native VB6 reference images. A restricted local browser may reject file/HTTP
navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`; such probes fail explicitly rather
than being counted as passes. The GitHub Actions Icon validation job runs both
launch modes, the complete Node suite, and existing browser/visual suites, then
retains the exact source, built app and visual evidence as an artifact.

The checked-in standalone, hosted bundles and example applications are regenerated
from source with this change. Pages also builds and tests the current source before
publishing, preventing a future source-only icon fix from deploying an older
checked-in bundle.
