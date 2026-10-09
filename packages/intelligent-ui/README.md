# @vb6/intelligent-ui

A dependency-free, renderer-neutral streaming UI compiler and bounded reactive
runtime. The package does not import the VB6 IDE, its project model, its VM,
provider SDKs, or a UI framework. It includes a keyed DOM renderer, an optional
Worker client, and an app-side MCP Apps transport.

## Use the package

Build from the repository with `npm run build:intelligent-ui`, then
`npm run pack:intelligent-ui`. Install the resulting `.tgz` in another project,
or copy the package's `src` directory as native ES modules. The `dist` directory
contains a browser global bundle, Worker bundle, stylesheet, and MCP App HTML.
The included `examples/demo.html` uses these local files without a server.

```js
import {UISurface} from '@vb6/intelligent-ui';
import '@vb6/intelligent-ui/styles.css';

const surface = new UISurface(document.querySelector('#answer'), {
  onAction(action) {
    // Review the exact action and apply YOUR application's authorization.
    // Rendering a button is not permission to execute its proposed action.
    console.log(action);
  }
});
await surface.update(`
{@body const [seats, setSeats] = DIL.useState(8)}
<slider label="Seats" min={1} max={40} step={1}
  value={seats} onChange={v => setSeats(v)} />
<metric label="Monthly total" value={seats * 29} unit="USD" />
<button onClick={() => GenUI.issueNewTurn("Explain " + seats + " seats")}>Ask</button>
`);
// Later, including while generation is in progress:
await surface.update(nextSource, {partial: true, data: inspectedData});
// On unmount:
surface.dispose();
```

Supply `workerSource` with the **contents** of `dist/intelligent-ui-worker.js`
to move compilation and evaluation off the UI thread. It is a classic Blob
Worker; no dynamic imports, network, `eval`, or generated JavaScript are needed.
When Workers cannot be constructed or eight are already active, the same bounded
interpreter runs locally. A Worker that fails after construction or exceeds its
three-second watchdog is terminated; its actions are not replayed automatically.
The view retains its last rendered output and offers Restart.

## Language and data

The syntax is inspired by the public OpenUI analysis, **not a reproduction of
OpenAI's private DIL compiler or wire format**. Source is parsed into inert JSON
instructions. The expression language resembles a small JavaScript subset; it is
not evaluated by JavaScript's `eval` or `Function`.

Supported source includes text and basic Markdown; literal code fences;
whitelisted component tags; interpolations; `const` derived expressions;
`DIL.useState`; `DIL.useAppData()`; `if`/`else if`/`else`; and keyed `each` blocks.
Callbacks use expression-bodied arrows. Arrays, objects, arithmetic, conditions,
a limited set of collection/string methods, and explicitly listed `Math` functions
are available. `==` and `!=` intentionally use strict equality. Template literals,
JavaScript statements, imports, ambient globals and arbitrary methods are rejected.
Unknown components/properties and incomplete source have explicit diagnostics.

Call `catalogDescription()` for the authoritative component/property catalog.
It includes layout, typography, inputs, forms, tabs, details, metrics, paginated
sortable tables, SVG bar/line charts, links and reference affordances. The four
`VB6*` primitives have semantic DOM fallbacks in the standalone package; the IDE
supplies factories backed by its actual `BrowserControl` implementation.

`data` is caller-supplied, bounded JSON. Own-property access only is permitted.
Images do not initiate requests unless an embedder supplies an explicit
`allowResource(url) === true` policy. `AsyncImage`/`AsyncImageGroup` and entity or
citation references require a host resolver/factory; there is no built-in search,
image generation, or fabricated citation database. `AppBlock` is recognized but inert in the default DOM renderer. The package now
provides `createAppBlockFactory` for explicitly reviewed execution through a
separately hosted sandbox proxy. It never executes source in the IDE document.
Do not mount untrusted raw HTML in the host document or assume iframe CSP alone
is an operating-system network firewall or a CPU-availability guarantee.

## Actions and state

`GenUI.issueNewTurn`, `copy`, `openUrl`, `callTool`, `updateContext`, and
`openEntityDetail` are available only during explicit event dispatch. They return
bounded action intents; the core performs **no** tool calls, project writes,
network requests, navigation or provider requests. `normalizeAction` checks the
intent before host handling. URLs must be HTTP(S) and cannot contain credentials.

State is keyed by lexical scope and declared name. Streaming prefixes preserve
already edited values; keyed loops preserve identity when reordered. A completed
source removes abandoned state. Failed evaluation retains the last good state and
view. Stale event versions are rejected. Snapshots contain only bounded local
state, not closures, credentials or host objects. Persistence is an embedder choice.

Trusted factories may pass an `AbortSignal` as the second argument of `onAction`.
The surface forwards it to its host callback as the third argument, `{signal}`.
A host that awaits approval must recheck this signal immediately before effects.
The action promise is returned unchanged through the renderer, so an MCP App does
not receive success before the actual review completes. The VB6 integration uses
this for cancellation/revocation while a review dialog is open.

`StreamingCompiler` accepts prefixes/chunks and distinguishes program changes
from constant-only changes. Parsing is a bounded full-prefix pass, not an
incremental token parser. `UISurface` coalesces partial updates and `DOMRenderer`
applies keyed operations rather than replacing the complete subtree. Changed
Markdown/table/chart contents are regenerated inside their own component.

## Renderer-neutral integration

```js
import {UIRuntime, DOMRenderer, createCatalog} from '@vb6/intelligent-ui';
const catalog = createCatalog({Temperature: {value: 'number'}});
const runtime = new UIRuntime({catalog});
const renderer = new DOMRenderer(root, {
  factories: {
    Temperature: ({document}) => {
      const node = document.createElement('output');
      return {node, update: props => { node.textContent = props.value + ' °C'; }};
    }
  },
  onEvent: (id, args) => {
    const result = runtime.dispatch(id, args, runtime.version);
    renderer.apply(result.operations);
    reviewActions(result.actions);
  }
});
renderer.apply(runtime.update('<Temperature value={21} />').operations);
```

Trusted factories are application code, outside the model's capability boundary.
They own their DOM, resource policies and disposal. Pass the same `catalog` to
`UISurface` for custom components in both Worker and local modes.

## MCP

`McpUIService` owns bounded per-principal documents and exact inspected-tool
bindings. The embedding MCP server authenticates callers, validates tool schemas,
checks cancellation and permissions, and calls `service.run`. Never use model
arguments or `clientInfo` as an authenticated principal. The IDE adapter implements
these checks and invalidates bindings on a workspace reload.

The exported MCP App uses `ui://vb6/intelligent-ui`,
`text/html;profile=mcp-app`, `_meta.ui.resourceUri`, the `2026-01-26` lifecycle,
partial/final tool input, structured tool results, host theme updates, resize,
reviewed messages/context, links, host-proxied tools and teardown. Text/JSON tool
results remain usable when a client does not render Apps. The service does not
implement an MCP transport itself.

The package includes both an **app-side client** and **connection-scoped host**.
`McpAppHost` requires an HTTP(S) parent and a different sandbox origin. It checks
message source and origin, restricts app-visible tools and readable resource URIs
to an explicit connection catalog, bounds requests, and requires an injected
approval callback for actions. Unsupported methods fail explicitly. Inline and
fullscreen and a movable/resizable in-window `pip` overlay are negotiated.
PiP is not an OS always-on-top window. Trusted callbacks enable reviewed resource
reads and staged downloads; app-exposed tools are available
only after the app declares the capability. The default IDE does not grant raw
AppBlocks project or tool access.

`dist/intelligent-ui-sandbox.html` implements the intermediate proxy and opaque
inner iframe. Serve it on a **dedicated origin with CSP response headers**, not as
an ordinary same-origin IDE asset. `tools/serve-intelligent-ui-sandbox.mjs` is the
repository's read-only loopback companion. The exact embedding origin is required;
there are no credentials, project files, writable endpoints, or request proxies
in this service. HTTPS embedders may need a separately deployed HTTPS sandbox due
to mixed-content or private-network browser policies. Those restrictions are not
bypassed by the library.

```js
import {McpAppHost} from '@vb6/intelligent-ui/host';
const app = new McpAppHost(root, {
  proxyUrl: 'https://sandbox.example.org/intelligent-ui-sandbox.html',
  html: trustedTemplate,
  tools: connectionTools,
  callTool: (name, args, {signal}) => connection.callTool(name, args, {signal}),
  approve: request => showExactRequestApproval(request)
});
app.setToolInput(argumentsFromModel);
app.setToolResult(resultFromTool);
// Revocation and unmount must release both frames and pending requests.
app.dispose();
```

CSP metadata permits exact HTTP(S) origins, plus WS(S) for connections.
`resourceDomains` alone accepts validated `https://*.subdomain.example` patterns.
Global wildcards, wildcard IPs, wildcard connections/frames/base origins and
directive injection are rejected; model source cannot choose CSP policy. The companion enforces restrictive response
headers inherited by the inner frame and its allowed navigations. Treat the
sandbox endpoint as trusted deployment code. Browser frame isolation does not
promise that hostile arbitrary code cannot consume CPU or navigate its own frame.
No camera, microphone, clipboard, geolocation or payment permission is requested.

## Inspected references

`UIReferenceStore` and `createReferenceFactories` provide cancellable trusted
resolution for `image`, `AsyncImage`, `AsyncImageGroup`, `Entity` and `Cite`.
Records require provenance. Image URLs are loaded only under an explicit resource
policy or an affirmative per-URL approval; images are not searched or generated
by this package. The MCP service includes immutable, bounded `ui.references`
snapshots from inspected tool captures; model-supplied `data.references` is not
used as trusted provenance. Updated documents carry fresh reference snapshots.
A caller cannot read another caller's records. Factories propagate the surface's
exact action guard rather than gaining an independent route to host effects.

## Bounds and validation

Source: 100,000 characters (IDE MCP tool source: 32,000); nesting: 40;
rendered instruction nodes: 2,000; evaluation: 100,000 steps; collection length:
2,000; aggregate UI data, local state and rendered payload: bounded separately.
The DOM renderer also budgets composite table/chart/Markdown content; tables cap
visible cells and paginate. Custom factories must enforce their own limits.

Run `npm test` inside the packaged directory for the standalone smoke test.
Repository tests are `npm run test:intelligent-ui` and
`npm run test:intelligent-ui:browser`; see `docs/INTELLIGENT-UI.md` for integration
coverage and the distinction between real transport and opaque-document tests.

## References

Original implementation inspired by:
- https://www.openui.com/blog/how-chatgpt-intelligent-ui-works
- https://github.com/modelcontextprotocol/ext-apps/blob/main/specification/2026-01-26/apps.mdx
- https://github.com/modelcontextprotocol/ext-apps/blob/main/src/spec.types.ts

No OpenAI private source, OpenUI source, or external runtime dependency is bundled.

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


## Rich content, view context and downloads

The public `normalizeContentBlocks` validator supports bounded MCP text, image,
audio, embedded resources and resource links. Binary data requires canonical
base64. Resource URIs are data, never implicit fetch requests. Use
`renderContentPreview(root, blocks)` for local Blob-backed raster/audio previews;
call the returned `dispose()` to release URLs. HTML/SVG resources remain text or
binary descriptions, not active markup.

`GenUI.sendMessage(blocks)` emits a `messageContent` intent, and
`McpAppClient.sendMessage(blocks)` sends the corresponding MCP request. Both depend
on the host's explicit review/delivery policy. `UIModelContextStore` stores the
latest reviewed `{content, structuredContent}` per view, not an append-only queue.
Hosts must clear it on owner/view revocation; the VB6 adapter does this and shows
current context again before a confirmed provider run.

```js
import {UIModelContextStore, prepareDownloads} from '@vb6/intelligent-ui';
const contexts = new UIModelContextStore();
contexts.set('active-view', {structuredContent: {selected: 'module-1'}});
contexts.set('active-view', {structuredContent: {selected: 'module-2'}});
// Only module-2 is present. Include snapshots only under your send policy.
const latest = contexts.snapshot();
contexts.delete('active-view');

// Invoke only after exact local approval. Links must be connection-allowlisted.
const files = await prepareDownloads(request.contents, {
  resourceUris: connectionResourceUris,
  readResource: (uri, options) => connection.readResource(uri, options),
  signal
});
// No files have been written by the library. Recheck authority before delivery.
```

Downloads stage all validated files before an embedder writes any. Batches are
bounded to eight files and 256,000 decoded bytes; a linked response must match the
requested URI. Cancelled app clients reject pending and future requests, discard
late success responses and clean up even if teardown callbacks fail. Callback
`isError` values propagate to callers rather than becoming false success.

## App-exposed tools and floating views

```js
import {McpAppClient} from '@vb6/intelligent-ui';
const app = new McpAppClient({
  tools: [{name: 'selection', inputSchema: {type: 'object'}}],
  onToolCall: async (name, args, {signal}) => {
    signal.throwIfAborted();
    return {content: [{type: 'text', text: currentSelection()}]};
  }
});
await app.connect();
await app.requestDisplayMode('pip'); // Must be negotiated; host reviews requests.
```

`setTools` changes the declared catalog and sends the list-changed notification.
`McpAppHost.listAppTools()` / `callAppTool()` use the app's declared capability.
There is no connection to arbitrary host functions. Tool callbacks must validate
their declared argument semantics and observe cancellation. Display transitions
keep the original iframe connected, preserve state, and provide keyboard movement
and an inline-return control. PiP/fullscreen are host-window presentation modes.

## Trusted reference-provider registry

`UIReferenceProviders` accepts named host implementations with description and
`resolve(query, {owner, signal})`. Resolution requires an explicit approval
callback, bounded queries, concurrency limits and timeout. Registration never
fetches a URL. Revocation/unregistration cancels in-flight work and discards late
results. Resolved records must include provenance and pass `validateReference`.

The VB6 adapter exposes registration through
`vb6Studio.intelligentUI.extensions.registerReferenceProvider` and discovery /
resolution through `vb6.ui.catalog` / `vb6.ui.resolveReference`. It does not supply
third-party credentials or choose an external service automatically. Reference
resolution and subsequent image-URL loading are separate approvals.

The IDE provider adapters retain images/PDFs in native OpenAI, Anthropic and Gemini
request shapes. Gemini supports its own image MIME set and audio formats; a format
not supported by the selected adapter fails before sending. Neither protocol
shape tests nor local preview promise compatibility with every provider model.
See `docs/INTELLIGENT-UI.md` for the delivery matrix, ownership, resource readers
and the distinction between local diagnostic and actual HTTP/two-origin tests.
