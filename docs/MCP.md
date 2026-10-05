# MCP Agent Access — the IDE as a server

VB6 Studio exposes its **implemented IDE, compiler, debugger and runtime** to
external coding agents through MCP. It is **not an MCP client or model host**.
There is no external-server connection manager, outbound tool runner, OAuth
sign-in, model sampling provider, or configured-process gateway in the IDE.

Open **Tools → MCP Agent Access…**. The panel has four local administration tabs:
**Agent access**, **Agent permissions**, **Capabilities** (a read-only tool/schema
reference), and **Activity**. Nothing is shared automatically on startup.

## Architecture and deployment

```text
External coding agent (MCP client)
    ├─ Streamable HTTP ──────────────────────┐
    └─ stdio → tools/mcp-stdio.mjs ──────────┤
                                            ↓
                      Node loopback companion /mcp
                                            ↕ authenticated relay
                 Browser IDE's live MCP server and approval UI
                                            ↓
                Project / editor / designer / compiler / debugger
                                            ↓
                      Existing isolated application runtime
```

The HTML contains the actual server/IDE adapter and operates on the same live
project, undo history, compiler and debugger that the user sees. The companion
does not hold a second workspace. It provides the listening HTTP endpoint that
an ordinary web page cannot provide. Browser polling of this **loopback relay**
is transport for inbound agent requests, not access to external MCP servers.

| App deployment | External-agent connection |
| --- | --- |
| `dist/VB6-Studio-Web.html` opened directly with `file://` | Start the companion with `--allow-file`, then pair the IDE |
| GitHub Pages or another static HTTP(S) host | Allow the exact page origin with `--origin`, then pair the IDE |
| Localhost | The companion can serve `dist`, giving the IDE a same-origin relay |
| Trusted embedding | Explicitly transfer a private MessagePort to the server adapter |

The app needs no backend or CDN merely to open. A standalone/static page cannot
listen for TCP connections or spawn processes. The external-agent relay is
therefore an optional, separately started Node.js process. Browser local-network,
CORS, mixed-content and enterprise policies are not bypassed. When a browser
blocks hosted-page-to-loopback requests, open the same app from localhost.

## Setup

From the source checkout, using Node.js 22 or newer:

```sh
npm run build
npm run mcp:bridge -- --serve dist --allow-file --origin https://wieslawsoltes.github.io
```

The default origin is `http://127.0.0.1:8766`. `--port` changes the port;
`--serve dist` is optional. Open that URL to use the localhost-served IDE, or keep
using the downloaded HTML/static-hosted app. `--origin` takes scheme, hostname
and optional port, **not** the `/VB6/` path. Repeat it for additional trusted
origins. Omit `--allow-file` when direct-file use is not needed.

The terminal prints two independent random credentials:

1. **Owner token:** enter it only in the IDE's **Agent access** tab. Enable
   sharing, enter the companion origin and owner token, and click **Attach companion**.
2. **Client token:** give this token to the external agent. Never give the agent
   the owner token. The IDE clears the owner-token input after attachment and does
   not persist it in project storage or downloads.

Only one browser can own a companion at once; a separate lease protects its
connection. The HTTP endpoint for agents is `http://127.0.0.1:8766/mcp` with
`Authorization: Bearer <client-token>`. HTTP-capable agents may use it directly.
For agents accepting a stdio MCP entry:

```json
{
  "mcpServers": {
    "vb6-studio": {
      "command": "node",
      "args": [
        "/absolute/path/to/VB6/tools/mcp-stdio.mjs",
        "--url", "http://127.0.0.1:8766/mcp"
      ],
      "env": {"VB6_MCP_TOKEN": "PASTE_CLIENT_TOKEN_FROM_TERMINAL"}
    }
  }
}
```

The IDE offers **Download agent configuration template** with placeholders,
never live credentials. Set the absolute path and client token in the agent's
own configuration. The stdio relay writes only MCP JSON-RPC to stdout; diagnostics
go to stderr. It accepts only a loopback `/mcp` endpoint, not arbitrary remote
URLs. Neither the relay nor the companion launches external MCP servers.

Keep the IDE open and attached. An absent/disconnected browser produces an error,
not an old project snapshot. Companion tokens can alternatively be supplied through
`VB6_MCP_OWNER_TOKEN` and `VB6_MCP_TOKEN`; use distinct cryptographically random
values of at least 32 characters and protect the local configuration. Generated
tokens change on restart. This is a private paired local service, not a public
OAuth-protected MCP hosting service.

## Agent workflow and control surface

The server exposes **114 structured tools**, resources, prompts, pagination,
subscriptions, cancellation and event-driven waiting. The complete tool reference
and examples are in [MCP-AGENTS.md](MCP-AGENTS.md).

An agent should discover `tools/list`, read `vb6.agent.capabilities`, then read
`vb6.project.get`. Every mutation except interrupt-only
`vb6.debug.cancelEvaluation` requires the current `expectedRevision`.
After a mutation or a stale-revision error, read state again. For paused debugger
operations, also use the current `pauseId` and an existing stack-frame identity.
Use `vb6.agent.wait` for state/event changes instead of repeatedly fetching source.

Code edits use zero-based UTF-16 offsets, end-exclusive, with optional
`expectedText` checks. Multi-module `vb6.code.edit` changes are atomic and undoable.
Source edited while paused remains staged until `vb6.debug.applyEdits`. The
existing live-edit engine rejects unsupported signature/control-flow changes.
Compiler tools compile source and report diagnostics; they do not execute it.
Runtime tools address controls, menus and application dialogs with opaque IDs,
never owner-document selectors or arbitrary JavaScript.

Project/native imports accept supplied text, base64 files or ZIP data. Exports
return bytes/text for the agent to save using its own authorized filesystem.
Project `files.*` tools refer to the **virtual disk**, not the host machine.
Native project/reference/control support remains bounded by the underlying IDE;
MCP access does not add native VB6/COM/OCX compatibility that the IDE lacks.

## Local consent and delegated permissions

Enabling sharing permits paired clients to read the current project, source,
designer data, resources, virtual files, diagnostics and debugger data. Share only
projects the external agent is authorized to see. Discovery never enables sharing.

By default, mutations require **Allow once** with **Deny** preselected. The local
user may instead authorize selected scopes in **Agent permissions** for 1–60
minutes. Scopes cover code, project, designer, virtual files/resources, debugger,
runtime interaction and workspace. They apply to **all paired clients**, not a
client-supplied name. No scope is selected by default; tokens, grants and sharing
state remain memory-only. An indicator shows enabled access and active scopes.
Editor text edits require the **code** scope, whole-project undo/redo requires
**project**, and capturing runtime files into a project requires **files**.
The workspace scope alone cannot authorize these data changes.

Pending consent is bound to the current workspace instance, even when another
loaded project retains the same ID. Disabling/re-enabling sharing cannot revive
old requests. Explicit evaluations reserve their edit revision before awaiting
the sandbox, so concurrent same-revision mutations cannot both take effect.

Grants expire and clear on local revocation, project replacement, companion
attachment/detachment, sharing disable or reload. Current revision, argument,
project and debugger checks remain mandatory even with a grant. Revocation aborts
pending authorized work; it does not undo effects already completed or stop a
previously started application. Stop that application explicitly when needed.

No remote tool can change local permissions, read pairing credentials, click
IDE security dialogs or access an arbitrary JavaScript/shell/DOM method.
Application-dialog replies operate only inside the existing runtime sandbox.
OS file pickers, clipboard, printing, fullscreen and creation of a new detached
browser window still require local browser interaction. Existing in-page windows
can be managed and detached windows can be returned through structured tools.

## Protocol and transport

| Area | Implemented behavior |
| --- | --- |
| Modern MCP `2026-07-28` | Server discovery, per-request metadata, optional clientInfo, routing/header validation, cache hints, sorted catalogs, complete results, POST subscriptions |
| Legacy MCP | `2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05` session initialization/capabilities |
| Agent transports | Streamable HTTP JSON/SSE through the companion; stdio via the external relay; explicitly paired private MessagePort |
| Server features | Typed tools with output schemas, resources/templates, two source-review prompts, module-name completion, pagination, notifications/subscriptions and cancellation |
| Tasks | Negotiated modern task handles for `vb6.agent.wait`, polling/update/cancel, opted-in notifications, expiry and authority-bound cleanup |
| Reliability | UTF-8 byte-bounded requests/results/queues, timeouts, strict UTF-8, duplicate-request checks, session cleanup and no automatic mutation replay |
| Companion boundary | Loopback binding, Host/Origin checks, separate owner/client tokens, browser lease, no arbitrary process or remote-URL proxy |

The server does not solicit model sampling or act as a model host. Tasks are
implemented only for event-driven `vb6.agent.wait`, as described below. MCP Apps,
Skills and provider-specific extensions are not implemented. This is
not certification against every agent implementation. The local stdio entry is
for an **external agent to reach this IDE**, not for the IDE to run another server.

## Classic dialog

The dialog uses the same font, colors, tab control, inset fields and buttons as
other IDE tools, including Windows Standard and High Contrast Black. It retains
docking, resizing and real browser-window detachment. Arrow/Home/End keys switch
tabs; Ctrl+Tab cycles them and Escape closes the tool without disabling sharing.
The footer's **Stop sharing** is the explicit revocation action.

**Agent access** groups sharing, connection status and the local companion settings.
Setup instructions and the credential-free agent configuration are expandable.
**Agent permissions** exposes no preselected grants and disables authorization
until sharing is enabled. **Capabilities** filters tools by name/description and
scope, browses resources/prompts, and exports the schema catalog. **Activity** has a
filterable table, errors-only view, follow toggle and JSON export. Arguments and
credentials are not logged; error summaries can contain project identifiers, so
review activity before sharing it.

## Pollable waits and immutable build downloads

Modern clients that advertise `extensions: {"io.modelcontextprotocol/tasks": {}}`
in their per-request client capabilities receive a task handle for
`vb6.agent.wait`. Poll `tasks/get`, optionally subscribe with `taskIds` through
`subscriptions/listen`, or cancel with `tasks/cancel`. `tasks/update` accepts an
input-response object but these wait tasks never elicit or authorize changes;
unknown/stale input keys have no effect. Tasks last at most 120 seconds, with at
most 32 retained. Ordinary clients still receive a synchronous wait result.
No legacy experimental Tasks protocol or taskification of mutations is advertised.

`vb6.build.create` produces inert project JSON, application HTML, native-source
ZIP or an existing-compiler Win32 PE32. Supply the current `expectedRevision`,
then use `vb6.build.read` with byte offsets and base64 chunks. Every chunk carries
the full-file SHA-256, total byte size and snapshot revision. Unsupported native
constructs return diagnostics, not a substitute executable. SHA-256 uses WebCrypto
where available and a native-differential-tested JS fallback on plain HTTP.
Read-only builds do not run the application, start a compiler process or write
host files. Electron packaging and the licensed classic compiler remain local CLI
operations; `vb6.build.targets` describes this boundary.

Build artifacts expire after five minutes. At most eight / 32 MiB total are
retained, evicting the oldest when necessary; reads are limited to 256 KiB per
chunk. `vb6.build.release` frees a handle early. A build remains an immutable
snapshot after ordinary edits, but switching/replacing the project, disabling
sharing, detaching the relay or disposing the server invalidates its access.
Handles are unguessable and bound to a transport-assigned identity, never
`clientInfo`. Agents using the same companion client credential share that
identity. They are not isolated merely by supplying different names.

Use `vb6.project.entries` before imports with multiple possible entry files;
`project.import` accepts `entryPath`, `encoding` and `basenameFallback` alongside
supplied text/base64 files or ZIP bytes. `project.group` inventories all group
members; `project.select` switches the active member with preserved IDE histories,
and `project.startup` updates the startup project with undo. Project switches
revoke old project grants. Adding an entire group as loose modules is rejected;
source/asset collisions do not silently overwrite existing companion data.

## Trusted embedding API

The browser bundle exports only the server-related MCP APIs:

```js
const {McpServer, createIdeAdapter, bindMcpPort} = VB6StudioAPI.MCP;
// `authenticatedPort` must already be authenticated and explicitly transferred
// by the trusted embedder. The IDE's sharing/approval gates still apply.
const disconnect = vb6Studio.mcp.bindPort(authenticatedPort);
// Later: disconnect();
```

The installed adapter/server are `vb6Studio.mcp.adapter` and
`vb6Studio.mcp.server`. Local administration is available through `setSharing`,
`attachBridge`, `detachBridge` and `openMcp`; none is exposed as a remote tool.
There is no unauthenticated global `window.message` MCP listener.

## Migration from the initial bidirectional implementation

The former **MCP Connections** UI and its **Connect**, **Browse & invoke** and
**OAuth** tabs have been removed. `McpClient`, `McpOAuth`, outbound browser
transports, external connection import/export, elicitation/sampling client UI,
`/stdio/<alias>`, `--config` and the configured-child-process runner are removed
from the production implementation. Obsolete options fail explicitly. Existing
external agents using the companion's `/mcp` or `tools/mcp-stdio.mjs` retain the
same direction of access. Re-pair locally after reload.

Test-only external peers live under `tests/helpers` to exercise the server.
They are not imported into the IDE or exposed through its public API.

## Validation

```sh
npm run build
npm test
npm run test:mcp:browser
npm run test:mcp:agent
```

Browser suites require Python Playwright 1.57.0 and its Chromium. The default
suites navigate real standalone `file://`, HTTP/HTTPS hosted subpaths and
companion localhost, and use an **external HTTP agent** for operations after
local consent. They verify server-only UI/API, secret-free configuration,
read/write approval and revocation, detached approval windows, code/designer/
workspace operations, undo, real compilation and sandbox debugging, live edits,
control/grid/menu interaction and InputBox replies. Test reports enumerate the
tools actually exercised; not every tool is claimed to have a browser scenario.

The HTTPS fixture uses a temporary self-signed certificate trusted only by its
own test context. CORS and local-network policy stay enabled. `--opaque` is an
explicitly UI-only fallback for environments that prohibit navigation; it is
never used as deployment validation in CI. Node tests cover the structured tool
surface, malformed/stale input, concurrent writes, authority boundaries and
HTTP/stdio/MessagePort protocol behavior.

Primary protocol references:
- [MCP specification](https://modelcontextprotocol.io/specification/2026-07-28)
- [Streamable HTTP](https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http)
- [Legacy tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
