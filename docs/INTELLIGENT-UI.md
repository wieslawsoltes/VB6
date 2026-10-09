# Intelligent UI in VB6 Studio Web

## Start in the IDE

Open **Tools > Intelligent UI** for the source editor, reactive estimate, real
VB6 controls, inspected project inventory, responsive dashboard, references and
**Reviewed content and context** examples. The live gallery displays results
created through MCP or the coding agent. **Interactive agent UI** is enabled by
default; disabling it disposes running apps and clears reviewed view context.
This preference, sandbox settings, tasks and approvals are memory-only.

In **AI Coding Agents**, request an interactive explanation or dashboard over
inspected project data. The agent can call `vb6.ui.present` or stream an explicit
`vb6-ui`, `intelligent-ui`, or `dil` fence. Ordinary user messages and code fences
are never interpreted as UI. Only assistant UI fences and the known UI-result
tools receive rich rendering. Source, diagnostics and text fallback stay available.

Changing a slider, typing, selecting a tab or sorting/paging a table is local.
It does not make a model request or change a project. `GenUI.issueNewTurn` and
`GenUI.sendMessage` open local review and then enter **Queue**. Sending a queued
item requires the agent's normal provider, budget and permission confirmation.
The unsent composer draft is not sent or erased by queued-message delivery.

## Independent layers

| Layer | Source | Responsibility |
|---|---|---|
| Compiler / interpreter | `packages/intelligent-ui/src/{compiler,expression,safety}.js` | Bounded DIL-inspired syntax, inert JSON, recovery and diagnostics |
| Reactive runtime | `packages/intelligent-ui/src/runtime.js` | State, derived values, keyed loops/conditions, operations and action intents |
| Renderer / surface | `packages/intelligent-ui/src/{renderer,client,surface}.js` | Keyed DOM, Worker watchdog, responsive sizing and source/fallback views |
| MCP Apps | `packages/intelligent-ui/src/{mcp,mcp-app,app-host,sandbox,display-mode}.js` | Owner-bound documents, transport, separate-origin hosting and display modes |
| Content / references | `packages/intelligent-ui/src/{content,content-view,references,reference-providers}.js` | Reviewed content, downloads, latest context and trusted provider adapters |
| VB6 integration | `src/intelligent-ui/` and `src/agents/content.js` | Existing BrowserControl adapters, ownership checks, review, queue and provider messages |

The MIT `@vb6/intelligent-ui` package imports no IDE, VM, LLM provider SDK or
external runtime dependency. Its `VB6Button`, `VB6TextBox`, `VB6CheckBox` and
`VB6Label` have standalone semantic fallbacks; the IDE supplies factories using
its actual CommandButton, TextBox, CheckBox and Label without attaching a VM.
Rendering does not add controls to the authored project.

Build with `npm run build:intelligent-ui`; package with
`npm run pack:intelligent-ui`. The latter creates a `.tgz` under `dist/packages`,
extracts it outside the repository, runs the package smoke test, and emits a
SHA-256 sidecar. The package includes ES modules, TypeScript declarations,
standalone browser/Worker bundles, CSS, MCP App/proxy HTML and a local demo.

## Language, updates and layout

The compiler accepts Markdown, whitelisted tags/properties, interpolations,
`{@body const ...}`, `DIL.useState`, derived expressions, conditionals and keyed
loops. Expressions use a bounded subset, not arbitrary JavaScript. There are no
ambient globals, network functions, imports, `eval` or dynamic constructors.
Callbacks use expression-bodied arrows. Unknown syntax/properties are diagnosed.

`UISurface.updateCompiled(document, options)` consumes the inert output of
`compile(source)` without parsing source again. Its Source panel displays JSON.
`UIRuntime.patch({constants, data, viewport}, expectedVersion)` and the equivalent
`UIClient` request update existing string constants or replace data without
recompilation. Unknown fields/constant keys and stale versions are rejected.
Failed renders retain the previous program, state, handlers, viewport and tree.

`DIL.useViewport()` returns container width and viewport height in CSS
pixels. `DIL.useBreakpoint(name)` tests minimum width: sm=640, md=768, lg=1024,
xl=1280. ResizeObserver updates are coalesced and preserve keyed edited controls.
Set `responsive:false` and use `setViewport` for explicit host sizing. The
headless default is 1024 by 768. `DIL.useAppData(selector)` reads bounded host
JSON; `DIL.useConstants()` reads the current constant table.

The catalog includes layout, text, forms, keyboard-accessible tabs, metrics,
paginated sortable tables, SVG charts, trusted named SVG icons, and references.
Images support validated `aspectRatio` / `objectFit`; neither grants permission
to load a URL. `metric.change` is included in rendering and text fallback.

## MCP tools and ownership

Seven UI tools use the existing permission-checked adapter:

| Tool | Operation |
|---|---|
| `vb6.ui.catalog` | Exact component/property catalog, captures and registered reference providers |
| `vb6.ui.present` | Create a caller-owned ephemeral result |
| `vb6.ui.update` | Replace source/data with `expectedUIRevision` |
| `vb6.ui.read` / `vb6.ui.list` | Read only that caller's documents |
| `vb6.ui.close` | Close a document with the current UI revision |
| `vb6.ui.resolveReference` | Request a configured trusted provider, with exact-query approval |

The first six are project-read-only display operations. `resolveReference` may
contact an external provider and is marked open-world. Its exact query always
needs local approval; **Never ask** denies it, and declining uses the agent's
terminal permission-denied code. Presenting UI never grants project authority.
UI revisions are separate from project edit revisions.

`dataRefs`, for example `{"project":"vb6.project.get"}`, refers to a successful
inspection in the same authenticated connection. Project inventory, module
source, form model, diagnostics, search and debugger snapshots can be captured.
Provenance records the tool, capture time and revision. Captures can become stale;
reinspect instead of claiming they are live data. Model-supplied `data.references`
is not trusted provenance. `ui.references` is an immutable bounded host snapshot.

Identity comes from the transport principal or trusted local agent session key,
not model arguments or `clientInfo`. Workspace reloads (even the same project ID),
sharing teardown and principal revocation release documents/bindings. A completed
agent run revokes execution permission but can retain its display; resetting or
deleting the task releases it. Each owner has bounded documents, captures and
resolved references. Controls, gallery actions and app tools remain pinned to
the original task, thread, workspace and displayed document revision.

## Reviewed media and model context

The MCP transport accepts bounded text, image, audio, embedded-resource and
resource-link blocks. Binary data must be canonical base64. `renderContentPreview`
shows supported embedded raster images/audio from local Blob URLs, revoking them
on disposal. It never fetches resource links, interprets resource text as HTML,
or renders SVG as active content. A format that the browser cannot preview still
has a textual description; preview support is not provider delivery support.

`GenUI.sendMessage(blocks)` and `McpAppClient.sendMessage(blocks)` preserve reviewed
attachments in an immutable memory-only follow-up. **Queue** exposes a content
summary and **Remove attachments**. Unsupported provider formats fail before a
provider request; links remain descriptions unless explicitly read/downloaded.
The provider adapters preserve bytes in the provider's native message shape:

| Provider path | Implemented inline binary inputs |
|---|---|
| OpenAI Responses | PNG, JPEG, WebP, GIF (provider requires non-animated), PDF |
| Anthropic Messages | PNG, JPEG, WebP, GIF, PDF |
| Gemini GenerateContent | PNG, JPEG, WebP, HEIC, HEIF, PDF and supported audio MIME types |

Gemini audio includes WAV, MP3/MPEG, AIFF, AAC, OGG, FLAC, M4A, L16, Opus, A-law,
mu-law and WebM. `audio/x-wav` is normalized to `audio/wav` without changing bytes.
Audio is not routed to an unsupported OpenAI Responses or Anthropic Messages
format. Model-specific capability, content validity, limits and billing are still
controlled by the provider. Tests use protocol doubles, not paid API requests.

`GenUI.updateContext(data)` or `McpAppClient.updateModelContext({content,
structuredContent})` opens **Replace reviewed context**. It replaces one owning
view's snapshot; it does not create a follow-up or send a request. Empty context
clears that view. The next confirmed run shows and snapshots the latest reviewed
contexts; approval fails if they change during confirmation. Context is added to
request construction without modifying signed/native history. Compaction omits
binary bytes, retaining public text and attachment descriptions.

View disposal, feature disable, task reset and workspace changes release context.
**Clear reviewed UI context** clears the active task explicitly. In-flight app
requests carry cancellation signals; closing/cancelling a view prevents pending
approval from causing later effects. Cancelled clients reject pending and future
requests, and late responses cannot revive them. Teardown cleans up transport even
when an embedder's teardown callback fails, reporting that failure to the host.

## Separate-origin apps and display modes

Declarative UI needs no companion. Arbitrary HTML/JavaScript requires explicit
sandbox configuration and approval of the exact app source. Serve the IDE over
HTTP(S), then start the dedicated companion with its actual parent origin:

```sh
npm run build
VB6_UI_PARENT_ORIGIN=http://127.0.0.1:8080 npm run ui:sandbox
```

Set **Separate-origin sandbox URL** to
`http://127.0.0.1:47231/intelligent-ui-sandbox.html`, enable **reviewed AppBlocks**,
and select **Apply sandbox settings**. The companion serves only proxy HTML with
CSP headers; it has no project files, credentials, writable endpoints or general
request proxy. A file-origin IDE cannot host arbitrary apps. HTTPS deployments
may require a separate HTTPS sandbox because of browser mixed-content or local
network policy. No browser protection is disabled by this feature.

`AppBlock` runs in an opaque inner iframe behind a different-origin proxy. It
receives no direct project, tool, clipboard, camera, microphone or geolocation
capability. Host theme variables reach the app without restarting it. Stop,
unmount, setting changes and revocation release frames and pending actions.
Browser isolation is not an OS network firewall or CPU-availability guarantee.

The gallery's **Open as MCP App** renders `ui://vb6/intelligent-ui` using the same
host/proxy pipeline. Tools/resources come only from the original connection and
normal adapter permissions remain authoritative. App-visible tool filtering,
notifications, result errors, cancellation and teardown are supported. A reusable
`McpAppClient` can expose declared app-side tools with `setTools` / `onToolCall`;
the host can list/call them and observe catalog changes.

Hosts and apps negotiate `inline`, `fullscreen` and `pip`. **Float MCP App** is
a movable/resizable in-window overlay, not an OS always-on-top window. Keyboard
movement, **Return app inline** and host Escape are supported. The top layer
escapes MDI clipping where available without reparenting/reloading the iframe.
App-requested mode changes need approval; trusted local gallery buttons do not.

CSP permits exact HTTP(S) resource origins and WS(S) connection origins. A wildcard
is accepted only as a validated `http(s)://*.subdomain.example` resource origin;
global wildcards, wildcard IPs, connection/frame/base wildcards, credentials,
paths and directive injection are rejected. Wildcards are never enabled by
model source, and a configured host must explicitly supply its CSP policy.

## Resource reads and downloads

The IDE's generated MCP App offers **Download UI source** when its host advertises
that capability. Every request is reviewed. `prepareDownloads` stages the whole
bounded batch before any download; a resource link must be in the connection
allowlist and its response must match the exact requested URI. The IDE reads
project, module source/form, diagnostics and debugger resources through existing
permission-checked tools, never unrestricted URI fetch. Paged source reads pin
revision and workspace, rejecting mixed-revision content.

Only after validation/approval does the IDE request browser downloads using local
Blob URLs. Browser/user download policy still controls whether files are saved.
Unknown resources, invalid base64, oversized batches, denial and cancellation
cause no new download. Raw AppBlocks have no download callback by default.

## Configure trusted reference providers

A host can register a real search/image/entity service using an adapter it owns:

```js
const unregister = vb6Studio.intelligentUI.extensions.registerReferenceProvider(
  'company-search', {
    description: 'Search the configured company reference service',
    resolve: (query, {signal}) => companyReferenceService.lookup(query, {signal})
  }
);
// lookup must return a validated image/images/entity/citation with provenance.
// Remove on host integration shutdown:
unregister();
```

`companyReferenceService` is the embedding application's implementation, not a
bundled service or a model-selected endpoint. Registration itself makes no request.
The agent discovers providers through `vb6.ui.catalog`, resolves an approved query,
and references the returned `host-ref-*` ID. Results are caller-private and copied
into subsequent UI snapshots. Timeouts, cancellation, owner revocation and provider
unregistration discard late results. Image loading separately requires URL review
or an explicit trusted resource policy. There are no fabricated search results.

## Validation and scope

`npm run test:intelligent-ui` covers compiler/runtime bounds, streaming, state,
MCP ownership, rich content, cancellation, downloads, contexts and provider shapes.
`tools/intelligent-ui-browser-tests.py` defaults to real modular HTTP, standalone
HTTP and file origins. Its explicit `--opaque` mode is a labelled local diagnostic,
not an automatic fallback or replacement for deployment tests.
`tools/intelligent-ui-host-browser-tests.py` requires real separate HTTP origins
and response-header CSP. The Validate matrix runs both suites in Chromium,
Firefox and WebKit, alongside the existing native/rendering gates. Package smoke,
strict declarations and all generated-artifact fingerprints remain enforced.

This is an original DIL-inspired language and versioned inert program format,
not OpenAI's private compiler or private protocol. Default widgets are semantic
DOM/CSS with SVG charts; this change does not claim a GPU widget renderer, a
complete browser/OS sandbox, every provider model, or all possible external
services. Unsupported syntax, resources, formats and capabilities fail explicitly.
The advanced editor and WebGPU transcript changes on main are preserved.

## References

- https://www.openui.com/blog/how-chatgpt-intelligent-ui-works
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts
- https://developers.openai.com/api/docs/guides/images-vision
- https://platform.claude.com/docs/en/build-with-claude/vision
- https://ai.google.dev/gemini-api/docs/image-understanding
- https://ai.google.dev/gemini-api/docs/audio
