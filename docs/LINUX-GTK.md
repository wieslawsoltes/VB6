# Linux native GTK host

Linux executable export supports GTK3 and GTK4 on x86-64 and ARM64. Select
`gtk3` or `gtk4` as the toolkit while retaining the Linux architecture target.
Both variants use the shared AOT compiler, native runtime, control model,
resource loader, data binding, and VB event dispatch. The exported project
procedures are compiled to machine code. The executable loads the selected
native GTK libraries; it does not require a VB source interpreter or a browser.

The toolkit is part of runtime identity and validation. A GTK3 runtime loads
`libgtk-3.so.0`; a GTK4 runtime loads `libgtk-4.so.1`. Their compiled payloads,
native build caches, dependency reports, and qualification reports are distinct.
GTK, GLib, Pango, Cairo, image loaders, CUPS, and the other declared native
libraries remain deployment dependencies. See [AOT export](LINUX-AOT.md) and
[Linux distribution packaging](LINUX-DISTRIBUTION.md) for executable and package
formats.

## Native controls and composition

The GTK4 host uses actual GTK4 widgets and APIs. The small mechanical adapters
in [`gtk-compat.hpp`](../packages/linux-native/native/gtk-compat.hpp) and
[`gtk-compat.cpp`](../packages/linux-native/native/gtk-compat.cpp) allow shared
control code to retain the same native VB model. GTK4 input controllers, menu
actions, cursor handling, and drawing snapshots have their own implementations.

| VB surface | Native implementation |
| --- | --- |
| Form, MDIForm | `GtkWindow`, with a fixed child layout and the shared form lifetime model |
| CommandButton, CheckBox | Native button and check-button signals |
| OptionButton | GTK3 radio-button groups; GTK4 grouped check buttons |
| TextBox, ComboBox | `GtkEntry`, editable combo boxes, and a scrolling `GtkTextView` for multiline text |
| RichTextBox | `GtkTextView` and `GtkTextBuffer`, with native formatting, image anchors, and embedded editable document regions |
| Label, Frame, PictureBox | Native labels, frames, and fixed containers; PictureBox adds retained Cairo drawing |
| ListBox, TreeView, ListView, directory/file lists | Native `GtkTreeView` models, renderers, selection, and signals |
| MSFlexGrid, MSHFlexGrid, DataGrid | Shared grid model and native tree-view columns; DataGrid uses native cell editing and existing binding transactions |
| HScrollBar, VScrollBar, Slider, UpDown | Native scrollbars, scales, spin buttons, and adjustments |
| ProgressBar, DTPicker, MonthView | Native progress bar and calendar widgets |
| TabStrip, SSTab | `GtkNotebook` with owned page containers and retained child controls |
| Toolbar, StatusBar | GTK3 toolbar items or GTK4 box/button composition, and native status-panel buttons |
| Image, Line, Shape, MSChart | `GtkDrawingArea` and the shared Cairo drawing commands |
| Menu | GTK3 native menu widgets; GTK4 `GMenu`, `GSimpleAction`, popover menus, and shortcut controllers |
| Timer, CommonDialog, ImageList | Shared nonvisual control objects backed by GLib sources, native dialogs, and decoded native pictures |

Some native widgets that GTK4 retains are deprecated by GTK4 but are still
real GTK4 widget implementations. They share the existing, qualified control
and collection logic. A requested control type without a native implementation
raises error 453 rather than producing a placeholder widget.

GTK4 fixed containers and text views subclass the native widgets to compose
the shared Cairo graphics with GTK4 snapshots. Child snapshots remain native;
the host does not replace the entire window with a canvas. Chart, image,
primitive, text, and printing commands use the same Cairo/Pango paths as GTK3.
Rich-document behavior and its preservation boundaries are documented in
[Linux rich text](LINUX-RTF.md).

## Events, focus, menus, and lifetime

Native signals dispatch the existing VB event procedures, including control
arrays and mutable event arguments. GTK4 uses capture-phase key controllers,
click gestures, motion controllers, and focus controllers. Event routing
resolves the actual owning control so nested native children do not duplicate
their parent control's events.

VB string and selection positions use UTF-16. Text entry, selection replacement,
clipboard text, and rich-document anchors convert at the GTK boundary. Rich
text extraction includes U+FFFC object positions, preserving selection indices
across embedded pictures and editable table cells. On GTK4, changing ByRef
`KeyAscii` inserts the replacement through the native editor because GTK4 key
events are immutable; setting it to zero consumes the event. Supplementary
Unicode input continues through GTK's normal input processing.

GTK4 fixed-container focus traversal sorts controls by `TabIndex`, skips
`TabStop = False` controls during Tab navigation, and traverses nested
containers in both directions. Explicit `SetFocus` can still focus an enabled,
visible control with `TabStop = False`. GTK4 `Control.ZOrder` changes the native
child order without changing the form's global stacking order.

GTK4 menu enabled and checked states are native action properties. Rebuilding
a menu preserves its native submenu model even when the root menu is hidden,
so `PopupMenu` can display a context menu that does not appear in the menu bar.
Menu mnemonics and accelerators use native GTK mechanisms.

Form close requests use `QueryUnload` and `Unload`, including cancellation.
Native destruction disposes owned descendants, invalidates their handles, and
removes their GLib timer sources. Modal forms and dialogs use the shared event
loop, so timers and other native events continue to run while a dialog is open.
The dialog stack records native ownership and is unwound when its owner exits.

## Dialogs, clipboard, cursors, and printing

`MsgBox`, `InputBox`, file open/save, color, font, and printer dialogs are native
GTK dialogs with transient ownership. File dialogs preserve the selected
filter and Unicode filenames. Cancellation preserves prior values and raises
32755 when `CancelError` requests it. GTK4's file chooser always asks before
replacing an existing file. Font settings are committed only after GTK returns
a valid selected font description.

The host initializes GTK's program identity before UI creation. File-chooser
recent-document metadata can then serialize the executable command and document
URI correctly, including when the host runs without a `GtkApplication` wrapper.

Clipboard text and pictures use the display's native clipboard. GTK4 adapts its
asynchronous read APIs to the shared synchronous VB operations while processing
the GLib event loop. Image transfer uses native textures and decoded pixels.
Clipboard persistence after process exit remains a desktop clipboard-service
facility.

`Screen.MousePointer`, per-control `MousePointer`, and custom `MouseIcon`
operate on native cursors. A global pointer overrides existing and newly
created controls. GTK4 observes cursor changes from composite native widgets,
retains their normal cursor, and restores it when the VB override is removed.
Monitor queries use GTK's monitor inventory, including the actual X11 primary
monitor when one is available.

Printer inventory, selection, properties, default changes, and removal use
CUPS. Native printer dialogs update the same print settings as the shared
`Printer` object. `EndDoc` renders and submits a real document; cancellation and
`KillDoc` do not submit an empty job. The service fixture verifies a two-page,
three-copy PDF and rejected-job behavior against a local CUPS protocol fixture.

GTK4's font chooser requires the ISO language data used by the native GTK
library. Distribution packaging includes and verifies that data; the AppImage
qualification opens a real compiled font chooser with the host ISO data hidden.
See [the distribution contract](LINUX-DISTRIBUTION.md) for its relocation and
provenance rules.

## X11 and Wayland behavior

GTK selects the display backend from the desktop environment. An application
can also select a backend using the ordinary `GDK_BACKEND=x11` or
`GDK_BACKEND=wayland` environment setting. Both toolkits run normal forms,
native controls, rich documents, local layout, graphics, and timers on Wayland.

Global desktop coordinates and stacking are display-server capabilities:

| Operation | X11 | Wayland |
| --- | --- | --- |
| Native form presentation, local control geometry, form size requests | Supported | Supported; final toplevel placement and size follow the compositor |
| Startup placement hints | Applied through GTK/window-manager mechanisms | Compositor chooses placement |
| Explicit Form.Left/Top reads or writes | Native root-coordinate operation | Error 453 |
| Form.Move with Left or Top supplied | One validated native position request, followed by any requested size change | Error 453 before position, size, or stored-property mutation |
| Form.Move with only Width/Height supplied and missing position arguments | Supported | Supported |
| Form.ZOrder | Native window stacking request | Error 453 |
| Form.Icon | Native window icon | Error 453; the desktop application identity remains a separate packaging concern |
| `user32.GetWindowRect` | Native screen rectangle | Error 453 without changing the output buffer |
| `user32.MoveWindow` for a form | Same validated form move operation | Error 453 |
| `user32.MoveWindow` for a local child | Native child layout | Native child layout |

GTK4 X11 position requests use `_NET_MOVERESIZE_WINDOW` when the window manager
advertises it. Position readback accounts for `_NET_FRAME_EXTENTS`, with native
frame traversal for older window managers. This prevents the window manager's
decorations from corrupting VB coordinate readback. Older X11 window managers
receive ordinary native move requests. The window manager retains the final
authority over placement and stacking.

GTK4 window icons publish `_NET_WM_ICON` ARGB pixels, scaled to at most 256 pixels
on either dimension. Updating an icon does not reapply an earlier stored window
position. Unsupported explicit Wayland operations are checked before stored
VB state or caller-provided output is modified.

## Qualification

The full rebuild gate links native fixtures against the exact production object
files used to build each runtime and verifies source provenance again after
execution:

```sh
node tools/test-linux-aot.mjs --toolkit gtk3 --rebuild --jobs 3
node tools/test-linux-aot.mjs --toolkit gtk4 --rebuild --jobs 3
```

The native fixtures cover all admitted control types, signal dispatch, mutable
key input, Unicode selection, menu state and hidden popups, focus order,
collection mutation, graphics, modal lifetime, real common-dialog button
responses, recent-document launch metadata, clipboard transfer, rich-document
persistence, CUPS printing, and cursor ownership. The same gate also executes actual compiled VB projects and
rejects malformed native project metadata.

[`display-contracts.mjs`](../packages/linux-native/tests/display-contracts.mjs)
runs [`gtk-display-contracts.cpp`](../packages/linux-native/tests/gtk-display-contracts.cpp)
under an isolated Xvfb/Openbox session and an actual Weston Wayland compositor:

```sh
node packages/linux-native/tests/display-contracts.mjs /absolute/path/to/gtk-display-contracts
```

Weston uses its X11 backend inside that private Xvfb session, with the Pixman
renderer. This remains headless and supplies a native input seat, which GTK3
requires; the tested application connects only to the Wayland socket. The
fixture asserts the actual GDK display type, native X11 icon pixels and window
geometry, Wayland error/state boundaries, local controls, formatted text,
embedded image/table anchors, and timer-driven disposal. It uses bounded
watchdogs and stops only the compositor/window-manager processes it started.

The fixture environment uses `NO_AT_BRIDGE=1` for GTK3 and
`GDK_DEBUG=gl-disable:vulkan-disable GSK_RENDERER=cairo GTK_A11Y=test` for GTK4.
These settings isolate optional desktop services and GPU availability during
headless testing. They are not required application launch settings. Display
qualification enables `G_DEBUG=fatal-criticals` and rejects unexpected native
diagnostics. The native test environment needs Xvfb, Openbox, Weston, ISO language
data, and installed fonts in addition to the selected GTK development packages.

## Upstream mechanisms

- [GTK3 to GTK4 migration guide](https://docs.gtk.org/gtk4/migrating-3to4.html)
- [GTK4 widget snapshots](https://docs.gtk.org/gtk4/vfunc.Widget.snapshot.html)
- [GTK4 key event controller](https://docs.gtk.org/gtk4/class.EventControllerKey.html)
- [Extended Window Manager Hints](https://specifications.freedesktop.org/wm/latest/ar01s04.html)
- [GTK4 native font description selection](https://docs.gtk.org/gtk4/method.FontChooser.get_font_desc.html)
