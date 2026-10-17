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
| `MacOSMaterial` | A native effect view contains the original VB container. Its controls, parent relationship, handles and text editors retain their ownership. `content` uses `NSVisualEffectView`; the other roles use `NSGlassEffectView` on macOS 26 when compiled with SDK 26 or later. Earlier systems use the corresponding `NSVisualEffectView` material. |
| `MacOSBackgroundRole`, `MacOSForegroundRole` | Semantic `NSColor` values on supported native text, button and container surfaces. The native colors respond to the effective appearance. The two pressed-color roles are derived from the native accent or red color with `shadowWithLevel:`. A native glass background role becomes its tint; older material effects use a translucent semantic color wash. |
| `PlaceholderText` | Native field/combo placeholder text, or a noninteractive placeholder in a multiline TextBox. Placeholder text is not part of the VB Text value, selection or accessibility value. |
| `MacOSAccessibilityLabel`, `MacOSAccessibilityHelp`, `MacOSAccessibilityIdentifier` | Public AppKit accessibility properties on the semantic control and, where applicable, its container/window. Empty strings restore inferred values. |
| `MacOSIndeterminate` | A ProgressBar's `NSProgressIndicator` indeterminate state. A visible, enabled indicator starts its native animation; disabling the state stops it and restores determinate operation. |

The semantic color names are the same as the browser resource contract in
`src/theme/macos26-resources.js`. Native AppKit uses its own colors, rather than
the browser's fallback RGB values. Assigning an explicit `BackColor` or
`ForeColor` relinquishes the corresponding semantic binding. Unsupported
combinations, such as a background role on a borderless command button, a
material on a native TabStrip/SSTab, or a control size on a PictureBox, fail with a
capability diagnostic instead of being ignored.

A material role describes the effect around an existing VB container. It does
not convert that container into an `NSToolbar`, `NSSplitView`, window title bar,
menu or popover controller. Native TabStrip/SSTab materials are rejected because
the standard tab view's background cannot be made transparent without changing
its navigation. Existing fixed VB bounds remain authoritative and should leave
enough room for the chosen native control size. The layer does not claim
pixel-identical browser rendering, import Apple design assets or implement
SwiftUI APIs inside the VB runtime.

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

Native source changes invalidate the existing offline runtime fingerprint. The
macOS refresh must compile, execute and sign-check the changed runtime before its
generated payload can be embedded. The existing provenance, resource, lifetime,
signature and execution gates remain required. Running the JavaScript tests on
another platform does not certify AppKit execution or native visual parity.

## Apple reference material

- [Build an AppKit app with the new design (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/310/)
- [Design foundations with Liquid Glass (WWDC25)](https://developer.apple.com/videos/play/wwdc2025/356/)
- [NSGlassEffectView](https://developer.apple.com/documentation/appkit/nsglasseffectview)
- [NSControl.ControlSize](https://developer.apple.com/documentation/appkit/nscontrol/controlsize-swift.enum)
- [AppKit release notes for macOS 11](https://developer.apple.com/documentation/macos-release-notes/appkit-release-notes-for-macos-11)
- [Apple Design Resources: macOS 26 in Figma](https://www.figma.com/community/file/1543337041090580818/apple-design-resources-macos-26)

The macOS 26 Figma kit is a design reference link. No Figma assets or proprietary
font binaries are copied into the native runtime.
