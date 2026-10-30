# macOS 26 native appearance contract

The native source and direct ARM64 compilers share the scalar appearance contract
used by the designer, project model, `.frm` files and XAML translation. Native
compilation validates both the value and the selected AppKit widget's capability;
an appearance property is not considered supported merely because it can be
serialized. The compile report's `appearance` section lists the controls using
the contract, native widget substitutions, deployment requirements and material
fallbacks. The same validation applies to native runtime property assignments.

## Public AppKit implementations

| Authored property | Native behavior |
| --- | --- |
| `MacOSControlSize` | Public AppKit mini, small, regular and large control sizes; extra large requires macOS 26. Tables also adjust their default row metric, while explicit row heights remain authoritative. Authored VB geometry is retained. |
| `MacOSControlStyle` on CommandButton | Rounded push, Return-key default action, destructive action, borderless, inline, circular and help bezels. Existing VB Default and Cancel settings continue to work. |
| `MacOSControlStyle="search"` | `NSSearchField` for a single-line, non-password TextBox. The real shared field editor, UTF-16 selection and VB Change events are retained. |
| `MacOSControlStyle="switch"` | `NSSwitch` and an adjacent native caption label for a CheckBox. Value remains 0/1 and Click remains the event. Clicking its caption or sending BM_CLICK uses the same native action. The switch's accessibility label defaults to the VB Caption. Mixed and fractional values are rejected. |
| `MacOSControlStyle="segmented"` on Toolbar | A real `NSSegmentedControl`, retaining the Toolbar object, handle and `Buttons` collection. Homogeneous button Styles 0, 1 and 2 select AppKit momentary, multiple and single tracking respectively. ButtonClick receives the original Button item after its Value is updated. |
| `MacOSControlStyle="segmented"` on TabStrip/SSTab | A real `NSSegmentedControl` navigates retained `NSTabViewItem` pages in a borderless, transparent `NSTabView`. The original tab widget, handle, page ownership and selected item stay intact, and the container can use native materials. |
| `MacOSMaterial` | A native effect view contains the original VB container. Its controls, parent relationship, handles and text editors retain their ownership. `content` uses `NSVisualEffectView`; the other roles use `NSGlassEffectView` on macOS 26 when compiled with SDK 26 or later. Earlier systems use the corresponding `NSVisualEffectView` material. |
| `MacOSBackgroundRole`, `MacOSForegroundRole` | Semantic `NSColor` values on supported native text, button and container surfaces. The native colors respond to the effective appearance. The two pressed-color roles are derived from the native accent or red color with `shadowWithLevel:`. A native glass background role becomes its tint; older material effects use a translucent semantic color wash. |
| `PlaceholderText` | Native field/combo placeholder text, or a noninteractive, wrapping placeholder in a multiline TextBox. The multiline label follows the actual text container origin, insets, alignment and available width. It hides during marked IME composition and is not part of the VB Text value, selection or accessibility value. |
| `MacOSAccessibilityLabel`, `MacOSAccessibilityHelp`, `MacOSAccessibilityIdentifier` | Public AppKit accessibility properties on the semantic control and, where applicable, its container/window. Empty strings restore inferred values. |
| `MacOSIndeterminate` | A ProgressBar's `NSProgressIndicator` indeterminate state. A visible, enabled indicator starts its native animation; disabling the state stops it and restores determinate operation. |

The semantic color names are the same as the browser resource contract in
`src/theme/macos26-resources.js`. Native AppKit uses its own colors, rather than
the browser's fallback RGB values. Assigning an explicit `BackColor` or
`ForeColor` relinquishes the corresponding semantic binding. Unsupported
combinations, such as a background role on a borderless command button, a
material on an automatic native TabStrip/SSTab, or a control size on a PictureBox, fail with a
capability diagnostic instead of being ignored.

A material role describes the effect around an existing VB container. It does
not convert that container into an `NSToolbar`, `NSSplitView`, window title bar,
menu or popover controller. AppKit's standard tab bezel draws its own background;
the segmented tab presentation provides explicit navigation with a transparent
page container. Existing fixed VB bounds remain authoritative and should leave
enough room for the chosen native control size. The layer does not claim
pixel-identical browser rendering, import Apple design assets or implement
SwiftUI APIs inside the VB runtime.

## Segmented controls and retained tab pages

`mac:SegmentedControl` lowers to a Toolbar with typed Button records. The XAML
selection modes `Momentary`, `Multiple` and `Single` map to Button Styles 0, 1 and
2. A segmented Toolbar requires one tracking mode across its collection. Styles
3–5 and mixed modes need the ordinary Toolbar presentation. Style and Value
assignments are validated before changing either the model or the native widget.
Value is always 0 or 1; a momentary item cannot retain a selected value. Selecting
a single-mode item programmatically clears the other item Values in the same
transaction, including items whose segments are hidden. Initial authored single
mode records with several selected items are rejected.

Segmented tab navigation is one horizontal row above or below the pages
(`TabOrientation` 0 or 1); it ignores classic SSTab `TabsPerRow` wrapping geometry.
Segments divide the authored width equally. Left and right orientations remain
available with the automatic native tab presentation. Disabled segments cannot
be activated by the user, and hidden segments do not occupy the header. Logical
item indices and selected values remain stable when visibility changes. A VB
program may select a disabled or hidden page explicitly; when its segment is
hidden, no visible segment appears selected. The compiler and runtime reject
hidden tabs in the automatic native presentation and identify the segmented
style needed to implement them. Automatic disabled tabs reject selection through
the AppKit delegate; their standard AppKit headers do not provide a per-item
disabled appearance.

Both native compilers lower authored Toolbar Buttons and tab records to bounded
collection records after the frontend has validated the original XAML sidecar.
The lowered program owns its form copy; compilation leaves the authored project
and the returned normalized project unchanged. The shared tab model resolves
explicit `TabPage`, saved tab ownership and classic SSTab inactive-page offsets
before native layout. An initially inactive child belongs to its own persistent
page, and an authored selection is applied after the pages have been created.
SSTab children retain their `Left` and `Top` relative to the full control origin,
matching the designer and browser. Native page bounds translate that origin
without resizing the authored controls or adding another header offset. This
also applies through top/bottom presentation and material changes.

Caption, tooltip, enablement, visibility and collection changes reconcile
existing tab items. Updating a caption or inserting an item before the selected
page does not rebuild that page or detach its field editor. Removing a page with
owned child controls is rejected until those children have been moved or removed.
Actual page transitions respect the current editor's Validate result and marked
text. They validate an unchanged field once and suppress a duplicate AppKit
validation callback during the same handoff. The separate NSTextField and
NSTextView delegate paths both dispatch Validate and LostFocus; a cancelled
multiline transition also restores the selection that AppKit would otherwise
expand. Because a VB focus handler can remove a destination page or unload the
form, the runtime rechecks the destination after the focus handoff before asking
AppKit to select it. Structural collection updates do not synthesize Click or
Change; an actual selection change emits the control's usual Click event.

The native segmented presentation currently supports text labels and tooltips.
Nonneutral Image or Picture values require another control presentation and are
rejected at compile time, at bootstrap, on runtime Add, and before an appearance
or item property mutation. Item records allow at most 1,048,576 UTF-16 code units
each, and native tab/toolbar collections allow at most 32,767 items. Known record
members must be finite scalar values and use their canonical VB spelling, such
as `Style`, `Value` and `ToolTipText`. Public VB item APIs remain case-insensitive.
Caption and Text are aliases, so a record cannot supply both. Ordinary authored
Toolbar records also validate Style 0–5 and Value 0/1 before bootstrap.

## Availability and diagnostics

The application deployment baseline remains macOS 11.0. Source builds retain
availability guards and compile-time guards so older SDKs can still build the
baseline implementation. A runtime built with an SDK older than 26 uses native
visual effects even on macOS 26; building with SDK 26 enables native Liquid
Glass. The verified offline runtime refresh therefore runs on `macos-26`.

| Diagnostic | Meaning |
| --- | --- |
| `MAC260` | Malformed, unknown, duplicate or incompatible appearance metadata. General project validation may report VB error 380 first for malformed shared-contract values. |
| `MAC261` | The native widget/style has no supported implementation of the requested appearance capability. |
| `MAC262` | Extra-large control size requires a deployment minimum of 26.0 or later. |
| `MAC263` | A binary native switch requires CheckBox Value 0 or 1. |
| `MAC264` | The chosen deployment minimum permits older systems, which use the documented native material fallback. This is a warning, not a silent substitution. |
| `MAC265` | Malformed native collection records, unsupported record shape or size, or conflicting tab-page ownership metadata. |

The native runtime reports invalid appearance values as VB error 380 and
unsupported native capabilities as VB error 438. Native style replacement keeps
the VB control object and handle stable, preserves its parent and tab links, and
restores an active field editor and selection without synthetic Change events.
Material insertion/removal also preserves a focused descendant's editor and
selection. A structural appearance change during marked IME composition is
rejected until that composition is committed, rather than discarding it.
Accessibility-only updates preserve RichTextBox attributed runs and selection.

## Validation and runtime provenance

`tests/macos26-native-appearance.test.mjs` tests source and AOT compiler acceptance,
negative diagnostics, semantic role coverage and scalar preservation.
`packages/macos-native/tests/appkit-appearance.mm` runs against real AppKit in both
native validation tools and the runtime refresh workflow. It covers all styles,
control sizes, live field-editor replacement, switch events and rejection,
light/dark colors, placeholders, accessibility, indicator state, material
availability, nested controls, scroll documents and window content replacement.
The acceptance output must contain `APPKIT_APPEARANCE_OK`.

`packages/macos-native/tests/appkit-segmented.mm` is linked by the same native
test glob. It checks actual NSSegmentedControl tracking, item identity and events,
hidden and disabled segments, incremental tab reconciliation, field-editor
selection, reentrant validation, tab-page ownership, material/style transitions,
native collection decoding and atomic rejection. It emits `APPKIT_SEGMENTED_OK`
before the enclosing appearance fixture reports success.

`tools/macos26-native-sample.mjs` extends the editable preferences example with
executable VB assertions while retaining its authored XAML. Native source export
and all four direct AOT optimization levels load the form, exercise its real
collections and page editors, and unload it before reporting
`NATIVE_MACOS26_SAMPLE_OK`. The checks cover initial tracking and selection,
programmatic single and multiple selection, search and switch state, and retained
multiline text, selection and control handles across page changes.

Native source changes invalidate the existing offline runtime fingerprint. The
macOS refresh must compile, execute and sign-check the changed runtime before its
generated payload can be embedded. Publication additionally requires successful
appearance, segmented-control and compiled-sample execution evidence in the
native report. The existing provenance, resource, lifetime,
signature and execution gates remain required. Running the JavaScript tests on
another platform does not certify AppKit execution or native visual parity.

## Apple reference material

- [Build an AppKit app with the new design (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/310/)
- [Design foundations with Liquid Glass (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/356/)
- [NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview)
- [NSSegmentedControl](https://developer.apple.com/documentation/appkit/nssegmentedcontrol)
- [Segmented control programming guide: selection and tracking](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/SegmentedControl/Articles/SegmentedControlCode.html)
- [NSTabView.drawsBackground](https://developer.apple.com/documentation/appkit/nstabview/drawsbackground)
- [NSTextView.textContainerOrigin](https://developer.apple.com/documentation/appkit/nstextview/textcontainerorigin)
- [NSTextDelegate](https://developer.apple.com/documentation/appkit/nstextdelegate)
- [NSControl.ControlSize](https://developer.apple.com/documentation/appkit/nscontrol/controlsize-swift.enum)
- [AppKit release notes for macOS 11](https://developer.apple.com/documentation/macos-release-notes/appkit-release-notes-for-macos-11)
- [Apple Design Resources: macOS 26 in Figma](https://www.figma.com/community/file/1543337041090580818/apple-design-resources-macos-26)

The macOS 26 Figma kit is a design reference link. No Figma assets or proprietary
font binaries are copied into the native runtime.
