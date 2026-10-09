# Intelligent UI in VB6 Studio Web

## Use it

Open **Tools > Intelligent UI** for the local source editor, reactive estimate,
real VB6 control example, project-inventory example, and live tool-result gallery.
The **Interactive agent UI** checkbox enables/disables rich assistant rendering.
It is an in-memory preference; default is enabled. Turning it off releases the
visible rich surfaces and shows ordinary source/Markdown without changing tasks.

Open **AI Coding Agents** and ask for an interactive explanation, calculator,
project dashboard, or a UI over inspected tool results. All configured providers
share the same component/tool definitions. The agent may call `vb6.ui.present`
or stream an explicitly labelled `vb6-ui`, `intelligent-ui`, or `dil` code fence.
Only assistant messages and results from the three known UI-result tools receive
interactive interpretation; user messages and ordinary code fences remain text.

For example:

> Read the current project and present a sortable module inventory and line-count
> chart using Intelligent UI. Bind the actual project result; do not edit files.

The UI keeps state locally. Moving a slider, editing a field, sorting/paging a
table or changing a tab does not call a model or modify the project. Message,
tool-request and context actions display an explicit local review and enter the
existing task follow-up queue. They do not automatically send a prompt or execute
a tool. Sending the queued message uses the agent's normal fresh permission flow.
Copy actions use the clipboard; external links require local review.

## Reusable layers

| Layer | Source | Responsibility |
|---|---|---|
| Compiler and expression VM | `packages/intelligent-ui/src/{compiler,expression,safety}.js` | DIL-inspired source to inert JSON, partial-prefix recovery, diagnostics and bounds |
| Reactive runtime | `packages/intelligent-ui/src/runtime.js` | Keyed state, callbacks, render operations, transactional failure and action intents |
| DOM/Worker surface | `packages/intelligent-ui/src/{renderer,client,surface}.js` | Keyed DOM, accessible inputs, bounded composites, Worker watchdog, source/fallback views |
| MCP service and app | `packages/intelligent-ui/src/{mcp,mcp-app}.js` | Connection-owned documents, inspected bindings, app-side MCP Apps lifecycle |
| VB6 integration | `src/intelligent-ui/` | Existing controls, task-bound actions, rich conversation content, gallery and playground |

The independent package imports no VB6 IDE, runtime, browser control, LLM provider
SDK, or third-party dependency. Its four `VB6*` components have standalone semantic
fallbacks. The IDE supplies `BrowserControl` factories for CommandButton, TextBox,
CheckBox and Label without attaching a VB VM. Controls never become project forms
or mutate authored form models.

`npm run build:intelligent-ui` builds the standalone JS, Worker, CSS and MCP HTML.
`npm run pack:intelligent-ui` creates `dist/packages/vb6-intelligent-ui-0.1.0.tgz`,
extracts it outside the repository, runs its standalone smoke test, and writes a
SHA-256 sidecar. The package includes TypeScript declarations and a local demo.
See `packages/intelligent-ui/README.md` for API and supported-language details.

## MCP tools and ownership

Six tools are installed by the same adapter helper as existing IDE tools:

| Tool | Operation |
|---|---|
| `vb6.ui.catalog` | Exact component/property catalog and available inspected bindings |
| `vb6.ui.present` | Create an ephemeral interactive result from source and data |
| `vb6.ui.update` | Replace source/data with `expectedUIRevision` |
| `vb6.ui.read` | Read the caller's current document and revision |
| `vb6.ui.list` | List only this caller's documents |
| `vb6.ui.close` | Close a document with `expectedUIRevision` |

These tools cannot modify or execute a VB6 project. They remain behind MCP sharing,
input validation, cancellation, host ceilings and the coding agent's exact tool
policy. They are classified as project-read-only display operations; creation and
update are not advertised as idempotent. UI revision is deliberately separate from
project revision, so presenting a view does not invalidate a proposed code edit.

`dataRefs` maps an alias to an exact inspected tool name, for example
`{"project":"vb6.project.get"}`. Results are captured only after successful,
permission-checked inspections of project inventory, module source, form model,
compile diagnostics, workspace search or debugger snapshots. A connection cannot
use another connection's captures. Each binding carries tool name, inspection
revision and capture time. Display data may become stale; it is not a live claim
about a subsequently edited project. Reinspect and update to refresh it.

Authentication comes from the transport's `principal` (or trusted local session
key), never from model arguments or `clientInfo`. Bounds are 16 owners, 32 live
documents globally, eight documents and eight captured results per owner.
Workspace epoch changes clear documents and bindings, including reloading a
project with the same ID. MCP principal revocation and sharing/server teardown
clear external views. Coding-agent run completion revokes execution authority but
retains its in-memory display; resetting/deleting the task releases its owner.

The standard result includes normal text plus `structuredContent.ui`. The tool
metadata points at `ui://vb6/intelligent-ui`, served as
`text/html;profile=mcp-app` with no external domains requested. Non-App MCP clients
still receive text/JSON. The exported app handles `2026-01-26` initialization,
partial/final input, tool results, theme/context changes, resize, messages,
context updates, host-proxied tools, links, cancellation and teardown. This is an
app-side integration plus a reusable connection-scoped host. The IDE gallery's
**Open as MCP App** uses the same resource on a configured separate origin.

## Enable isolated apps

Declarative controls, charts and tables work without a server or sandbox setting.
Arbitrary app code is a separate, explicitly enabled facility. Start the dedicated
companion after building; its parent origin must match the IDE's actual origin:

```sh
npm run build
VB6_UI_PARENT_ORIGIN=http://127.0.0.1:8080 npm run ui:sandbox
```

Serve the IDE separately, for example with `npm run serve`, and use its actual
reported port in `VB6_UI_PARENT_ORIGIN`. In **Tools > Intelligent UI**, set the
sandbox URL to `http://127.0.0.1:47231/intelligent-ui-sandbox.html`, enable
**reviewed AppBlocks**, then select **Apply sandbox settings**. Load the isolated
counter example and choose **Run isolated app**; approval shows its source.
**Stop app**, disabling the feature, changing sandbox configuration, unmounting,
workspace reload and revocation dispose the app. Approval is invalidated by a
changed source or host context; it never silently applies to a replacement app.

A file-origin IDE cannot host arbitrary apps; use HTTP(S). For GitHub Pages,
deploy the sandbox on a separate HTTPS origin or use an explicitly supported
loopback companion where the browser permits it. The URL setting is not a promise
that HTTPS/private-network/browser policies will allow a local HTTP service.
No browser protection is disabled or bypassed.

The gallery's **Open as MCP App** renders a tool result using the real host/proxy
pipeline. Only tools from its original connection may be exposed; each request
requires approval and calls the existing permission-checked adapter. Obsolete UI
revisions, workspace changes and owner revocation stop the app. The standalone
host accepts explicit resource/download callbacks; the IDE does not enable them
implicitly. Raw AppBlocks remain a more restricted lane without tools.

## Thread lifecycle and permissions

Thread views retain the original keyed message window, read position and expanded
details. Each rich surface is tied to its originating task, thread and workspace
epoch. Task switches and hidden/evicted entries dispose their DOM/Workers; bounded
state snapshots are kept only under that in-memory thread. A reset, workspace
change, stale document revision or task switch cannot redirect an old button into
a new task. Rich UI toggle does not grant project/network/tool authority.
Gallery MCP Apps use the original agent session key for permission-checked tool
calls and pin follow-ups to their original task. App RPC requests await the actual
host approval result; closing/cancelling an app while review is pending revokes
the request before it can enter the follow-up queue.

Model context and public presentation have independent limits. A large UI may be
omitted from provider context while the bounded local tool result remains visible.
The model still receives its document ID/revision. Normal tool context truncation
and public-thread accounting remain in place. Exporting a transcript is an explicit
user action and may include tool source/data; no automatic task/state persistence
or secret storage was added.

## Safety and compatibility boundaries

This is an original implementation inspired by an independent reverse-engineering
article, not OpenAI's private compiler or a promise of exact DIL wire compatibility.
It implements a documented bounded expression language rather than arbitrary
JavaScript. Parsing is a full bounded prefix pass; streaming is coalesced, and
rendering is keyed. It is not a claim of incremental-parser or GPU-renderer parity.

No model-chosen DOM tags, CSS, raw HTML, global objects, JavaScript constructors,
network functions or prototype traversal enter the main document. Source, JSON,
recursion, evaluation work, collections, aggregate render data, state, requests,
worker lifetime, and composite DOM are bounded. Failures leave the last valid
state/view; callbacks are never replayed automatically after failure.

`AppBlock` is inert by default. The IDE can run it only after a local user enables
the separate-origin sandbox and approves that exact app source. The package's
`McpAppHost` and proxy support a sandboxed intermediate origin and an opaque inner
frame. The companion serves restrictive CSP response headers; a same-origin iframe
is not accepted. Frame isolation is not an OS network firewall or a CPU-availability
guarantee. Raw AppBlocks receive no direct project or tool capabilities.

Trusted `UIReferenceStore` records and inspected MCP captures provide images,
entities and citations. Each tool UI has a bounded, immutable `ui.references`
snapshot with provenance, separate from model-supplied data. Image loading needs
an explicit local per-URL approval or trusted embedder resource policy. This
implementation does not fabricate search results, citations or generated images.

The generic MCP App host supports connection-allowlisted tools/resources, text
messages/context, reviewed links, inline/fullscreen, cancellation and teardown.
Download callbacks and app-exposed tools are optional standalone host APIs, not
implicitly enabled IDE features. Picture-in-picture, wildcard CSP origins and
non-text message modalities are rejected rather than falsely advertised.

The shipped layout is accessible DOM/CSS with SVG charts. The renderer-neutral
operation API can drive other backends; this change does not claim a WebGPU widget
renderer. Classic/Fluent/macOS/X11 IDE palette variables are inherited rather than
hard-coding a separate application theme.

## Tests and build integration

`npm run test:intelligent-ui` tests the core compiler/runtime, hostile expressions,
stream recovery, state retention, custom catalogs, exact tool bindings, MCP owner
isolation/revocation, revisions, cancellation, source/fallback handling, app
lifecycle, and real coding-agent protocol flows for OpenAI, Anthropic and Google.
These provider cases use protocol doubles; they do not use keys or paid APIs.

`python tools/intelligent-ui-browser-tests.py` exercises HTTP modules, HTTP
standalone and file standalone, then tests the independent package and an app-side
MCP host double. `--opaque` is a clearly labelled DOM/Worker-only mode for managed
browsers that block navigation. It is never selected automatically or used as a
substitute for the default CI transport coverage. Reports and screenshots go to
`reports/intelligent-ui/<browser>/`.

The existing Validate workflow runs the full Node suite, the independent-package
smoke test and default Intelligent UI browser tests. A new Chromium/Firefox/WebKit job matrix inside that same workflow runs both the
ordinary HTTP/file suite and `tools/intelligent-ui-host-browser-tests.py`, which
requires real HTTP origins, response-header CSP, opaque inner frames, actual
AppBlock execution, exact action approvals, connection visibility, revocation,
reference rendering and the IDE sandbox settings. There is no opaque-mode
substitute for those host tests. No elevated permission, weaker threshold, or
native-test skip was introduced. The existing
artifact inventory now fingerprints the eleven generated library/Worker/style/MCP/sandbox
outputs and payloads in addition to all prior IDE/runtime/sample artifacts.

## References

- https://www.openui.com/blog/how-chatgpt-intelligent-ui-works
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts

## Precompiled updates and responsive layouts

`UISurface.updateCompiled(document, options)` accepts the inert result of
`compile(source)` from a server or another process. It uses the same bounded
runtime and Worker path without parsing source again. Its Source panel shows the
compiled JSON. This is the library's own versioned JSON format, not executable
JavaScript or OpenAI's private wire format.

For lower-level integrations, `UIRuntime.patch({constants, data, viewport},
expectedVersion)` and `UIClient.request('patch', {patch, version})` update existing
string constants or replace bound data without recompiling. Unknown constant
keys/fields and stale versions are rejected. A failed render restores the prior
program, state, viewport, handlers and tree. Use `UIClient.request('apply',
{document, options})` for a new compiled program; the host still reviews actions.

`DIL.useViewport()` returns `{width, height}` in CSS pixels. In a surface, width
is the measured container width and height is the browser viewport height.
`DIL.useBreakpoint("md")` is a minimum-width test: sm=640, md=768, lg=1024,
xl=1280. `UISurface` coalesces ResizeObserver updates and retains keyed controls
and state; set `responsive:false` for explicit `setViewport({width,height})`
control. `UIRuntime.resize` and the client's `resize` request use the compiled
program without source parsing. The headless default is 1024 by 768.

The IDE includes a **Responsive dashboard** example. The catalog now exposes
trusted named SVG icons, image `aspectRatio`/`objectFit` and rendered metric
`change` text. Unknown icon names, CSS expressions and invalid ratios are rejected.
Image aspect ratios do not grant permission to load external URLs.
