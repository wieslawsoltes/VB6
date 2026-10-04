# Detached browser windows

VB6 Studio can move live IDE tool groups, code editors, form designers, modeless
project tools and command bars into separate top-level browser windows. This is
`window.open` plus same-origin DOM adoption, not a fixed-position overlay, screenshot,
iframe duplicate or second copy of the project/runtime.

## Choosing in-page MDI or optional browser windows

**Tools → Options → Docking → IDE window mode** offers two choices. The same
preference is available directly under **Window → Window Mode**.

- **In-page MDI only** keeps all IDE documents, tool windows and toolbars in the
  page. Documents retain move/resize, minimize/maximize/restore, cascade, horizontal
  and vertical tiling, Ctrl+Tab cycling and Ctrl+F4 closing. In-page tool docking
  and floating remain available. Popup caption buttons are hidden; popup menu
  commands and the detachment API are disabled.
- **MDI with optional browser windows** preserves the existing default: documents
  open inside MDI, and individual panes detach only when explicitly requested.
  In-page and detached windows can be used together.

Applying MDI-only returns existing detached panes to the IDE without closing their
contents or resetting the project, undo history or debugger. Their browser geometry
is remembered. Re-enabling optional windows never opens popups automatically; use
**Window → Restore Browser Window** to reopen each remembered pane with a click.

The choice is an IDE preference in workspace autosave, not a VB6 project property.
It survives reload, project changes and Reset Window Layout. Named window profiles
restore positions but do not override the current mode or enable detached windows.
Options takes effect on **OK**; **Cancel** leaves the mode unchanged. Changing only
this preference does not add a project undo entry.

## Using the feature

Click **↗** in a tool/document caption. Caption and toolbar context menus also offer
**Float in Browser Window**. For a linked dock group, the whole group moves together;
its tabs continue to work. A detached window has a complete command menubar, **Focus
IDE**, and **Return to IDE**. Its native title bar can be moved/resized across displays
using the browser/operating system. Browser chrome, minimize/maximize, snapping and
monitor placement are not emulated by the IDE.

The **Window** menu provides the active-document float command, a tool-group picker,
a list of open browser windows, and **Return All Browser Windows to IDE**. Existing
in-page docking/floating, tab grouping, cascade and tiling remain available. In-page
arrangements do not reposition detached documents. A minimized document's content
is visible while detached, and its previous in-page state returns when redocked.

The popup’s native Close button returns the live pane to the IDE. **Close Document**
(or Ctrl+F4) instead closes that document/tool. Hiding a pane, deleting its host,
resetting the layout or switching projects closes affected popups safely. Keep the
main IDE open: it owns the project, undo history, compiler, debugger and runtime.
Closing/reloading it closes its companion windows. Windows from other IDE tabs
have separate hosts and are not reused by name.

## Shared editing and UI behavior

The same DOM nodes, editor objects and event handlers move between documents.
Source changes, property edits, designer selection, breakpoints and undo/redo all
use the original session. There is no replicated project model, polling-based text
synchronization or last-writer-wins storage race. A popup menu or dialog opens in
the invoking document; application dialogs make all session windows inert and release
them when dismissed or when their owning popup closes. Menus, color palettes,
tooltips, keyboard commands and file downloads use the active document context.

Editor frame scheduling and canvas/theme/resize subscriptions move to the destination
document. Main-page title changes do not recopy stylesheets. Styling and appearance
updates do propagate. A single 500 ms owner-side watcher checks external window
geometry and recovers panes after close/navigation if normal lifecycle events were
not delivered; there is no continuous render loop solely for window management.

## Saving and reopening layouts

Automatic session layout and named window profiles include a `browserWindows` list:

```json
{"key":"document:main:code","bounds":{"left":-1920,"top":80,"width":900,"height":700}}
```

Keys identify `dock:`, `document:` or `toolbar:` hosts. Geometry is finite and bounded,
with negative screen positions preserved for secondary displays. Duplicate, malformed
or excessive descriptors invalidate an imported profile before any live mutation.
Older profiles remain readable. Document descriptors do not transfer across projects.

On reload or layout restore, panes are safely docked and remembered windows become
pending. Select **Window → Restore Browser Window → [window]** once per window.
Each opening is synchronous within that click, so the browser can apply its normal
popup permission policy. Failed openings keep the live pane and saved descriptor;
allow popups for the site and retry. Unsupported/stale targets are discarded.

## Browser and operating-system boundaries

A desktop browser normally honors `popup=yes` with a separate native-framed window,
but browser settings, enterprise policy and mobile browsers can force a tab or block
it. The IDE cannot force an OS window, always-on-top state, native owner-window
relationships, exact taskbar integration or unrestricted display placement. No
multi-screen permission is requested. Users can move allowed windows using normal
OS controls; requested/saved bounds may be corrected by the browser.

The host supports linked-CSS HTTP(S) builds and the inline standalone HTML build. A
same-origin opener relationship is required; sandboxing, disallowed scripts/popups,
severed opener policies or restricted file origins can prevent this feature. The
host uses a fresh `about:blank` context and never navigates it to project-supplied
URLs. It does not weaken browser security, add `postMessage` command execution or
expose an unauthenticated collaboration endpoint. User programs continue to execute
through the existing runtime bridge, not inside the detached IDE document.

Runtime MDI child forms are still a separate in-page runtime feature. IDE detachment
does not claim native VB6 binary/control compatibility or independence from the owner
session. OS/browser crashes cannot be made lossless by a DOM host; normal project
saving and autosave remain important.

Platform references: [Window.open](https://developer.mozilla.org/en-US/docs/Web/API/Window/open),
[Document.adoptNode](https://developer.mozilla.org/en-US/docs/Web/API/Document/adoptNode).

## Reusing the host and running checks

`src/ide/browser-window-host.js` exports `BrowserWindowHost`. Create one with the owner
window, theme root and optional change/failure/decorate callbacks. Call
`detach(key, liveNode, {title, onTransfer, onReturn})` from a user gesture;
`attach`, `attachAll`, `focus`, `snapshot`, `restore` and `dispose` cover its lifecycle.
`setEnabled(false)` returns live panes, remembers their geometry and blocks subsequent
`detach` calls; `setEnabled(true)` permits explicit detachment again without opening
anything. IDE integrations use `ide.setWindowMode('mdi' | 'hybrid')`.
A `decorate` callback can return a cleanup function. `restore` validates and records
pending geometry without opening popups. Integrations must preserve external mounts
when rendering their own layout model, as the IDE docking/MDI/toolbar adapters do.

```sh
npm run build
npm test
python -m pip install playwright==1.57.0
python -m playwright install chromium
npm run test:windows
# Additional engines after installing them with Playwright:
VB6_BROWSER=firefox npm run test:windows
VB6_BROWSER=webkit npm run test:windows
```

The dedicated suite drives real popup creation, shared editing and debugger execution,
linked tabs, modeless tools, toolbar downloads, dialogs, theme/resize updates,
blocked/setup-failure rollback, return/close/hide/reset/project-switch behavior,
owner isolation, saved layouts, HTTP reload/navigation and standalone file loading.
Chromium tests explicitly retain its popup blocker rather than Playwright's default
disable flag. Reports/screenshots are build artifacts, not golden OS-native images.
`VB6_TEST_TRANSPORT=memory` is an explicitly reduced local mode for sandboxes that
forbid navigation: it loads the inline app and skips the three real-navigation
cases. Normal CI does not use that mode.
