# HTML5 WebBrowser control

`WebBrowser` is the browser runtime's modern HTML control with an
IWebBrowser2/SHDocVw-shaped **source API**. It uses the current browser's HTML,
CSS, Canvas and JavaScript engine, not Trident, MSHTML, an ActiveX download or a
rasterized imitation. It is not an installable Microsoft VB6 binary OCX, and
this implementation does not make the native AOT exporter host WebView2.

## Add it and run the example

Choose **WebBrowser** in the extended toolbox, draw it on a form, and keep the
usual name, geometry, layout, enabled/visible state and control-array Index.
The designer is a non-executing placeholder; it never loads the configured
website or runs DocumentText. Double-clicking creates `DocumentComplete`.
The Object/Procedure dropdown includes the typed browser events, and the
Object Browser/IntelliSense includes browser enums and the supported DOM types.

Open the **HTML5 WebBrowser** built-in example, or
`examples/webbrowser-html5.vb6web`, then Run. Its classic toolbar drives browser
history, reload and stop. The page contains CSS Grid, Canvas graphics, an input,
range slider, details element and JavaScript counter. Its VB6 DocumentComplete
handler changes the page through `Document.GetElementById`.
`npm run build` also produces `dist/examples/webbrowser-html5.html`.

For a new form with a WebBrowser1 control:

```vb
Private Sub Form_Load()
    WebBrowser1.NavigateToString "<!doctype html><title>Report</title><p id='result'>Loading</p>"
End Sub

Private Sub WebBrowser1_DocumentComplete(ByVal pDisp As Object, ByRef URL As Variant)
    Dim element As Object
    If WebBrowser1.DocumentAvailable Then
        Set element = WebBrowser1.Document.GetElementById("result")
        If Not element Is Nothing Then element.InnerText = "Updated from VB6"
    End If
End Sub
```

The classic `Navigate "about:blank"`, then `Document.Open`, `Document.Write`,
`Document.Close` pattern also works after document readiness. Do not write the
same document unconditionally from every completion handler: use an application
flag when initializing it. The VM awaits DOM calls, so ordinary sequential VB
statements work without JavaScript promises in the VB source.

## Navigation and state

| API | Behavior |
| --- | --- |
| Navigate / Navigate2 | HTTP(S), about:blank and relative URLs. Both use the same embedded navigation implementation. |
| GoBack / GoForward | Per-control bounded history, independent of the browser tab. Unavailable travel raises error 5. |
| GoHome / GoSearch | Navigate to HomeURL / SearchURL. No privileged search provider or shell activation. |
| Refresh / Refresh2(0) | Reload the current entry without deleting forward history. Cache-specific levels raise 445. |
| Stop | Cancel a pending navigation; revoke an in-flight frame. A completed document remains displayed. |
| Document / DocumentAvailable | Revocable DOM facade for owned HTML after readiness; Nothing / False for external documents. |
| LocationURL / LocationName | Requested logical URL and observable owned-document title. Not a cross-origin redirect inspector. |
| Busy / ReadyState | Control-observable loading state. External iframe load is not proof of HTTP success. |
| CanGoBack / CanGoForward | History availability, also reported through CommandStateChange. |
| NavigationStatus / LastError | Explicit uninitialized, loading, complete, opaque, unobservable, stopped or error state and diagnostics. |
| URL / DocumentText | Designer properties that navigate when assigned at runtime. DocumentText stores assigned HTML, not a live DOM serialization. |
| NavigateToString | HTML5 extension that parses an owned HTML document, including scripts. |
| ExecuteScript | HTML5 extension; runs JavaScript only inside an available owned document. Scalar results and promises are supported. |
| PostWebMessageAsString | Delivers a string as a message event inside that document. No host/native object is granted. |

Accepted flags are `navNoHistory`, `navHyperlink`, and new-window/new-tab flags
that enter the cancellable popup path. Other flags are rejected with 445 rather
than silently weakening cache, origin, download or ActiveX restrictions. A
transient no-history page can go back to the previous real entry. Same-document
fragment navigation retains the DOM and object identities.

Named subframes, nonempty Navigate PostData, custom Headers, file/data/script
URLs, URL credentials, native browser bars and desktop browser activation are
not supported. Use HTML forms for ordinary form submissions; a self-navigation
can make the destination unobservable and revokes the owned DOM bridge. `_top`
and `_parent` remain confined to this control, not the IDE or host tab.

## Events, cancellation and debugging

BeforeNavigate2 and the legacy BeforeNavigate run before an accepted navigation.
`Cancel` is a real writable ByRef Boolean. The other BeforeNavigate2 ByRef
arguments are informational; redirect by calling Navigate, which invalidates
the superseded request. No request or history entry is committed after Cancel.

Owned-document completion delivers NavigateComplete2 / NavigateComplete,
ProgressChange, DownloadComplete, DocumentComplete and history command state.
DownloadBegin, TitleChange, PropertyChange and observable StatusTextChange are
also produced. Progress is an indeterminate lifecycle signal, not invented
network-byte progress. NavigateError reports control-observable failures with a
generic failure HRESULT, not a fabricated HTTP status; its Cancel suppresses the
control-owned error display. There is no complete subframe navigation model.

Owned links and window.open enter the NewWindow3 / NewWindow2 path. Cancel them
or assign an existing WebBrowser control to `ppDisp`. The runtime never opens a
host window automatically. Native-only event signatures (for example browser
chrome, FileDownload and secure-lock notifications) are available for source
metadata but are not invented as events the iframe platform cannot observe.

Events use the existing VM queued-action dispatcher. They retain the control
array Index prefix and survive debugger Pause/Resume. Navigation generations
prevent obsolete callbacks from running after replacement or disposal. Events
are not recursively invoked inside Form_Load, so awaiting cancellable events
does not deadlock a running VB procedure. VM stop/error and form/control disposal
release timers, iframe ports, pending requests and document handles.

## DOM compatibility

Supported facade types are HTMLDocument, HTMLElement, HTMLElementCollection,
HTMLStyle, HTMLWindow2, HTMLLocation and HTMLAttribute, with corresponding
MSHTML-style source aliases. These are allowlisted runtime contracts, not native
MSHTML interface pointers. See `src/controls/webbrowser-dom-contract.js` for the
exact member and invocation-mode list.

The facade includes document title/body/head, Open/Write/Writeln/Close, element
creation, ID/name/tag/CSS queries, HTML/text/value/checked properties, common
attributes and styles, child editing, focus/click/selection/scroll methods,
collections with default Item and named lookup, Tags and For Each enumeration.
Boolean and integral DOM results retain their VB scalar types. Repeated handles
have stable object identity. Document.Open/Close retains the document proxy;
full navigation revokes it and accessing a saved old proxy raises error 91.

This is not all of MSHTML: proprietary selection/text ranges, attachEvent,
VBScript, document modes, ActiveXObject, arbitrary native DOM interfaces and
IE-specific attribute flags are not emulated. HTML parsing, layout, script,
editing and CSS behavior follow the modern engine. ExecuteScript is a deliberate
child-realm operation, not arbitrary evaluation in the IDE or VM host.

## Commands and property compatibility

GetProperty/PutProperty retain a bounded per-control VB value bag and produce
PropertyChange. ClientToWindow validates two writable Long dimensions; values
are unchanged because the embedded viewport has no separate application chrome.
Zoom and OLECMDID_OPTICAL_ZOOM work from 10 to 1000 percent, including the ExecWB
output ByRef argument. QueryStatusWB reports support/enabled state for refresh,
stop, zoom and document commands.

Print, cut, copy, paste, undo, redo and select-all are delegated only when the
owned document/engine supports them. Clipboard, user activation, dialog and CSP
requirements still apply. Query status before use; errors are not disguised as
successful edits. Silent printing, help, unsupported OLE commands, Quit and
ShowBrowserBar raise 445. Unload the containing form instead of Quit.

Silent suppresses owned-document alert/confirm/prompt; configure it before
navigating an opaque document. Native browser chrome, offline mode, browser
registration and drop-target registration cannot be enabled. Retained imported
settings do not grant these capabilities. Application denotes this embedded
control; Parent/Container denotes its form; Name is the editable VB control name.
HWND is the runtime's synthetic handle, not an operating-system browser window.
FullName and Path do not claim a browser executable.

## Security, deployment and native source files

All frames are sandboxed without `allow-same-origin`, including owned HTML.
Scripts and forms run in the isolated child realm; they cannot read the IDE DOM
or its storage. The private MessageChannel handshake checks source window,
opaque origin and nonce. Calls use bounded allowlisted handles and values;
unrelated host objects, guessed handles and prototype traversal are rejected.
The limits cover HTML/URL size, history, RPC requests and timeouts, property bag
entries and document objects. This is isolation, not an HTML sanitizer: loaded
content may still make browser-permitted network requests.

External URLs are loaded directly without a proxy, header rewriting or code
injection. They remain opaque even when their URL would normally share the host
origin. Document is Nothing, ExecuteScript raises 70, and completion is labelled
`opaque`. X-Frame-Options, CSP frame-ancestors, mixed-content restrictions and
site authentication policies can prevent embedding. Browsers may fire iframe
load for an error page; the control does not claim it can distinguish every
such failure. No test or runtime path disables these policies.

The control is registered automatically in the standard IDE and ApplicationHost,
including inline and split HTML exports. A trusted host can supply its own
ControlAdapterRegistry override. A plain browser runtime import does not create
or activate a native COM server. Existing rendering/layout and native-window
adapters remain separate.

Imported WebBrowser, SHDocVw.WebBrowser, SHDocVwCtl.WebBrowser, Shell.Explorer and
Shell.Explorer.2 aliases normalize to the built-in control while preserving the
original native type. Arbitrary Vendor.WebBrowser types are not substituted.
New native source uses SHDocVwCtl.WebBrowser and the original SHDocVw type-library
GUID `{EAB22AC0-30C1-11CF-A7EB-0000C05BAE0B}`. Existing native headers are retained.

Native source compatibility does not turn Microsoft's old control into an
HTML5 engine. The classic compiler target retains that native control;
browser-only designer values are rejected instead of silently stripped when
nondefault. The freestanding native AOT planner explicitly rejects WebBrowser.
A modern native Windows host would require a separately implemented WebView2
adapter, deployment and validation.

## Maintenance and validation

The contract, controller, history, DOM contract, agent, frame transport and DOM
proxy live in separate `src/controls/webbrowser*.js` modules. The control adapter
uses the ordinary control registry. IDE event/type metadata lives in
`src/ide/webbrowser.js`, `src/editor` and `src/language/webbrowser-type-catalog.js`.
Do not add special cases to the generic VM property evaluator for DOM access.

```sh
npm run build
node --test tests/webbrowser*.test.mjs
python tools/browser-webbrowser-tests.py
VB6_BROWSER=firefox python tools/browser-webbrowser-tests.py
VB6_BROWSER=webkit python tools/browser-webbrowser-tests.py
```

Install the matching Playwright browser first. The existing Validate workflow
runs real HTTP/file inline/split exports, compiled VB handlers and ByRef calls,
DOM/JavaScript/Canvas, cancellation, pause/resume, history, stale-object disposal,
external same/cross-origin and CSP/XFO isolation, and the actual IDE designer.
Results and screenshots are artifacts under `reports/webbrowser/<engine>`.
`VB6_OFFLINE=1` is a supplemental local exact-content mode when navigation is
unavailable; it is rejected in GitHub Actions and is not origin/CSP evidence.

The checked build manifest must be updated with
`npm run build:update-ide-artifacts` after intentional bundle changes; ordinary
builds still verify the manifest. Unit and browser tests are regression evidence,
not a certification of every original VB6/Internet Explorer behavior.

## Primary references

- [Microsoft IWebBrowser2.Navigate2](https://learn.microsoft.com/en-us/previous-versions/aa752134(v=vs.85))
- [WHATWG iframe sandbox](https://html.spec.whatwg.org/multipage/iframe-embed-object.html#attr-iframe-sandbox)
- [Native VB6 WebBrowser form/type-library example](https://docs.oracle.com/cd/E24705_01/doc.91/e24221/com_guaranteed_events.htm)
