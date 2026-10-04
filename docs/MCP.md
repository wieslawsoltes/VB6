# Model Context Protocol (MCP)

VB6 Studio includes an MCP client, a permission-gated MCP server for its live IDE,
and an optional JavaScript/Node.js companion for desktop clients and local stdio
servers. Open **Tools → MCP Connections…**. The same module is bundled into
`dist/index.html` and the self-contained `dist/VB6-Studio-Web.html`; it does not
require a CDN, backend, service worker, browser extension, or installation merely
to open the IDE and use its in-process inspector.

## Deployment choices

| App location | Remote HTTP MCP client | Live IDE available to desktop MCP clients |
| --- | --- | --- |
| Single HTML opened with `file://` | Yes, when the server explicitly permits the browser's `null` origin | Optional loopback companion with `--allow-file` |
| GitHub Pages or another static host | Yes, when the MCP server permits the exact page origin | Optional companion with `--origin https://your-host.example` |
| Localhost | Yes, subject to ordinary CORS for other origins | Companion can also serve `dist` from its own origin |
| Offline | In-process inspector and explicitly paired `MessagePort` | Local companion needs no internet |

A static HTML page cannot listen on a TCP port or launch an OS process. GitHub
Pages cannot run an MCP HTTP server by itself. The companion supplies those
capabilities without changing the single-file/static-host deployment. Browser
CORS, mixed-content rules, enterprise policies, and local-network permissions
still apply. There is no disabled-browser-security workaround or public proxy.
For browsers that prohibit hosted-page-to-loopback connections, open the same
app from the companion's localhost origin instead.

## Connect to a remote MCP server

In **Connect**, enter a name and the server's complete MCP endpoint. Leave
transport on **Auto** for modern or legacy Streamable HTTP; select **Legacy SSE**
for an old SSE endpoint. Supply a bearer token only when the server requires one,
or use the OAuth tab. Nothing connects automatically on page load.

In **Browse & invoke**, select a connection and browse **Tools**, **Resources**,
**Templates**, or **Prompts**. The displayed definition includes the input schema.
Enter a JSON object, select an item, and invoke it. Remote tool calls require an
allow-once confirmation. Tool results and prompt content are untrusted text, not
HTML and not instructions to automatically execute another tool. Results can be
saved with an explicit download action. Cancellation and resource subscriptions
are available in the same window.

The configuration importer accepts `mcpServers` or `servers` maps with HTTP/SSE
URLs. It does not import tokens, custom authentication headers, or environment
variables and never executes imported commands. The configuration exporter omits
credentials and common secret query parameters. Keep arbitrary secrets out of
endpoint URLs as well. Connections, approval grants, OAuth state, tokens, and
sharing permissions are **memory-only** and end on reload. The IDE's existing
project persistence does not persist these MCP credentials.

### CORS checklist for a remote server

Allow only the intended origins, handle `OPTIONS`, and permit `POST` plus the
legacy `GET` and `DELETE` methods where applicable. Allow the request headers
`Content-Type`, `Authorization`, `MCP-Protocol-Version`, `MCP-Method`, `MCP-Name`,
`MCP-Session-Id`, `Last-Event-ID`, and the particular `MCP-Param-*`
headers defined by the server's tool schemas. Expose `MCP-Session-Id`,
`MCP-Protocol-Version`, and `WWW-Authenticate` to browser JavaScript. Modern MCP
routing headers must agree with the JSON body.

OAuth resource metadata, authorization-server metadata, registration (when
used), and token endpoints also need appropriate CORS. A downloaded HTML file
usually sends `Origin: null`; permitting that opaque origin is a broader trust
decision, not authentication. Use authenticated endpoints and trusted local
files, or serve the app from localhost instead. The companion never uses a
wildcard allowed origin and never enables credentialed cookies.

## Expose the live IDE

Open **Expose IDE** and enable sharing. This allows clients to read the current
workspace, including source, designer data, virtual project files, diagnostics,
and debugger information. Do not share a project containing data that the client
should not see. Discovery does not silently grant project access.

Every write, document-navigation request, breakpoint change, runtime start/stop,
and debugger operation requires **the current `expectedRevision`** and a local
**Allow once** approval. Deny is the default. A change of project, revision,
runtime state, or selected paused frame while approval is pending invalidates
the operation. Edits use the existing project validator and undo history. There
is no unrestricted JavaScript evaluator, shell tool, or host-filesystem tool.
Debugger evaluation uses the existing paused VB6 runtime, with instruction and
time limits; its possible side effects are explicitly acknowledged in approval.

Disabling sharing revokes pending requests and detaches the companion. Sharing
is never enabled by opening a project, importing configuration, or reopening the
page. Closing the MCP window does not silently disconnect explicitly established
connections: use **Disconnect**, **Detach companion**, or disable sharing.

### Start the companion

From a source checkout, using Node.js 22 or newer:

```sh
npm run build
npm run mcp:bridge -- --serve dist --allow-file --origin https://wieslawsoltes.github.io
```

The companion binds **127.0.0.1**, port **8766** by default. `--port` changes it.
`--serve dist` is optional. Open `http://127.0.0.1:8766/` for same-origin use, or
keep using the downloaded HTML or your static-hosted IDE. An origin consists
of scheme, hostname and port, **not** the repository path (`/VB6/`). Repeat
`--origin` for additional trusted origins. Omit `--allow-file` when not needed.

The terminal prints two independently generated credentials. Enter the **owner
token** in the IDE's Expose IDE tab with the companion URL and choose **Attach
companion**. Configure desktop MCP clients with the **client token**, never the
owner token. Only one browser owns a companion at a time, protected by a separate
lease. Changing the attached project changes the live workspace seen by clients.
Tokens are sent in authorization headers, never query strings.

The private MCP endpoint is `http://127.0.0.1:8766/mcp`. For desktop clients that
support Streamable HTTP and custom bearer authentication, use that URL directly.
For clients that accept a stdio server configuration:

```json
{
  "mcpServers": {
    "vb6-studio": {
      "command": "node",
      "args": ["/absolute/path/to/VB6/tools/mcp-stdio.mjs", "--url", "http://127.0.0.1:8766/mcp"],
      "env": {"VB6_MCP_TOKEN": "PASTE_THE_CLIENT_TOKEN_FROM_THE_LOCAL_TERMINAL"}
    }
  }
}
```

The adapter writes only MCP JSON-RPC to stdout. Diagnostics go to stderr. The
IDE must stay open and attached. An absent browser produces a clear HTTP 503,
not a stale project snapshot. `VB6_MCP_OWNER_TOKEN` and `VB6_MCP_TOKEN` may be set
in the companion's environment for a fixed local configuration; use distinct,
cryptographically random values of at least 32 characters and protect the
configuration file. Restarting with generated credentials invalidates the old
ones. This companion is a private paired service, not a public OAuth-protected
hosting solution.

### Use existing local stdio MCP servers from the browser

Create a local, trusted `mcp-servers.json`:

```json
{
  "mcpServers": {
    "my-local-server": {
      "command": "node",
      "args": ["/absolute/path/to/my-server.mjs"],
      "cwd": "/absolute/path/to/workspace",
      "env": {"SERVER_SETTING": "value"}
    }
  }
}
```

Start the companion with `--config mcp-servers.json`. In the IDE's Connect tab,
use `http://127.0.0.1:8766/stdio/my-local-server` and the **owner token**. Modern
and legacy stdio servers are translated to browser-compatible HTTP. Only aliases
configured by the person starting the companion can be launched. HTTP requests
cannot specify executable paths, arguments, environments, or arbitrary proxy
URLs. Processes are spawned with `shell: false`. These configured programs still
run with the local user's OS privileges: configure only programs you trust.

## OAuth

The **OAuth** tab supports protected-resource metadata discovery,
authorization-server/OIDC discovery, authorization code with **S256 PKCE**, exact
issuer/state/redirect checks, resource indicators, in-memory bearer tokens and
refresh tokens, and scope challenges. Use a pre-registered public client ID, a
server-supported HTTPS Client ID Metadata Document, or optional dynamic client
registration when the authorization server supports it. No client secret is
embedded in the HTML.

Discovery displays the issuer and scopes for review before authorization.
Choose a redirect URL registered with that authorization server. **Do not use
`file://` as an OAuth redirect.** The downloaded IDE can initiate sign-in in a
separate tab using a registered localhost or HTTPS callback. After authorization,
paste the resulting complete callback URL into the original IDE tab and complete
sign-in there. The original tab holds the one-time state and PKCE verifier. This
explicit callback flow works without deploying a special callback route or
persisting credentials across navigation. Use a callback page you control and
avoid sharing or logging the URL's short-lived authorization code.

Resource/issuer validation, PKCE and metadata are tested against deterministic
fixtures. Authorization-server-specific registration policy and CORS are not
under the IDE's control. An expired/insufficient token requires renewed consent
or reauthentication; mutation requests are not automatically replayed.

## Protocol and feature matrix

| Area | Implemented behavior |
| --- | --- |
| MCP 2026-07-28 | `server/discover`, per-request metadata, version/routing headers, annotated tool argument headers, complete/input-required results, MRTR, POST subscriptions |
| MCP legacy | 2025-11-25, 2025-06-18, 2025-03-26 and 2024-11-05 initialization/capabilities; initialized notifications; HTTP sessions; legacy SSE |
| Transports | Streamable HTTP JSON/SSE, old endpoint-event SSE, newline-delimited stdio via companion, private MessagePort, in-process |
| Client operations | Tools, resources, templates, prompts, completion, pagination, notifications, subscriptions, progress and cancellation |
| Client callbacks | UI form/URL elicitation; optional host-provided roots and sampling callbacks, advertised only when installed |
| HTTP reliability | Response bounds, timeout/abort, redirect rejection for credential safety, legacy GET event resumption, session-expiry detection without replaying the failed operation |
| Live server | Eighteen IDE tools, workspace/module/designer/debug resources, two prompts, module-name completion, change subscriptions |
| Permissions | Opt-in reads; allow-once writes/execution; revision and paused-context checks; undo integration; revocation |

Modern streams are not silently treated as resumable legacy streams. Legacy GET
reconnection is bounded; a disconnected old SSE transport can be reconnected
explicitly. Optional protocol extensions such as Tasks, MCP Apps, Skills,
provider-specific APIs, and an embedded language model are not claimed or
advertised. Sampling requires an application-supplied model provider. The
server's own tools do not request sampling. Its catalogs are static except for
project resources. Raw SDK requests are available to trusted embedding code;
they are not exposed as an unrestricted remote IDE tool.

### IDE tools

`vb6.project.get`, `vb6.module.read`, `vb6.module.write`, `vb6.module.add`,
`vb6.module.remove`, `vb6.form.get`, `vb6.form.update`, `vb6.project.compile`,
`vb6.workspace.search`, `vb6.project.export`, `vb6.project.replace`,
`vb6.document.open`, `vb6.runtime.start`, `vb6.runtime.stop`,
`vb6.debug.snapshot`, `vb6.debug.command`, `vb6.debug.evaluate`,
`vb6.breakpoints.set`.

Read `vb6.project.get` immediately before a mutation and pass the returned
revision as `expectedRevision`. Compilation does not run the project. Export
returns project JSON or standalone **application** HTML as data and never starts
a download or executes it without a local action. Application exports do not
silently inherit IDE MCP credentials or expose an MCP server.

Resources: `vb6://project`, `vb6://diagnostics`, `vb6://output`, `vb6://debug`,
`vb6://module/{name}/source`, and `vb6://module/{name}/form`. Prompt names:
`explain-module` and `review-project`. Results are bounded; use source ranges for
large modules rather than requesting an oversized entire workspace.

## Reuse from JavaScript

The modules under `src/mcp/` are ordinary JavaScript ES modules with no npm
runtime dependencies. Node-only process/HTTP adapters live in `tools/`. In the
bundled IDE the classes are exposed as `VB6StudioAPI.MCP` and the installed
instance as `vb6Studio.mcp`.

```js
const {McpClient, HttpTransport} = VB6StudioAPI.MCP;
const client = new McpClient(new HttpTransport('https://your-server.example/mcp'), {
  approveTool: async request => {
    // Replace with an explicit application-owned consent UI; deny by default.
    return false;
  }
});
await client.connect();
try {
  const tools = await client.listTools();
  console.log(tools.map(tool => tool.name));
} finally {
  await client.close();
}
```

For an already trusted same-process embedder, `bindMcpPort`/`PortTransport` accept
an explicitly transferred `MessagePort`. There is intentionally no unauthenticated
`window.message` listener. The embedder is responsible for authenticating the
peer before transferring a port. The live IDE's sharing and approval gates still
apply to requests through that port.

## Validation and reference

```sh
npm run build
npm test
npm run test:mcp:browser
```

Browser tests require Python Playwright and its Chromium (`pip install
playwright==1.57.0`, then `python -m playwright install chromium`). They navigate
real file, hosted-subpath and localhost builds, test actual browser CORS to a
loopback companion, stdio gateways, a live externally accessed IDE, local
approvals/revocation, undo, project replacement, and real sandbox debugger
execution. `CHROMIUM_PATH` optionally selects a local executable.
`--opaque` runs only the UI portion with `set_content` in environments that
prohibit navigation; it is explicitly reported as UI-only and is not used by CI.
Wire tests include independent JSON-RPC fixtures rather than testing only the
client against its own server. OAuth fixtures do not contact or authorize any
real account.

Primary references:
- [MCP 2026-07-28](https://modelcontextprotocol.io/specification/2026-07-28)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Authorization](https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization)
- [Subscriptions](https://modelcontextprotocol.io/specification/2026-07-28/basic/patterns/subscriptions)
- [Legacy transports](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)

## Lifecycle and integration guarantees

OAuth code grants never inherit another sign-in's refresh token. Only an active
refresh grant can retain its own token when the issuer does not rotate it. Clearing
credentials or starting a newer sign-in invalidates pending discovery, registration,
PKCE and token results. Invalid refresh-token, scope and expiry metadata is rejected.

Disconnect cancels pending requests and tool approvals, even when a custom transport
or approval handler ignores its abort signal. A closed `McpClient` is terminal;
create a new client/transport to reconnect (the Connections UI does this). Cancelled
mutations are not automatically replayed. The companion validates modern mirrored
headers, rejects unsupported legacy HTTP versions and malformed UTF-8, and handles
child-process pipe failure without an unhandled exception. Its owner/client tokens
are not inherited by unrelated stdio servers; explicit per-server `env` remains
available for the trusted desktop relay configuration above.

The MCP modeless window can be detached using the normal **Float in Browser Window**
caption command. Clients and project state remain in the owner IDE; approval dialogs
follow the active window. Closing the detached window returns the tool to the IDE.

`npm run test:mcp:browser` navigates the standalone file, linked HTTP and HTTPS hosted
subpaths, and the localhost companion-served app. The HTTPS fixture uses an ephemeral
self-signed certificate trusted only by its test context; it does not disable CORS,
mixed-content checks or local-network policy. The `--opaque` mode is UI-only and is
never substituted for deployment validation in CI.
