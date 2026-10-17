# MCP Agent Access — the IDE as a server

VB6 Studio exposes its **implemented IDE, compiler, debugger and runtime** to
external coding agents through MCP. It is **not an MCP client or model host**.
There is no external-server connection manager, outbound tool runner, OAuth
sign-in, model sampling provider, or configured-process gateway in the IDE.

Open **Tools → MCP Agent Access…**. The panel has five local administration tabs:
**Agent access**, **Agent permissions**, **Capabilities** (a read-only tool/schema
reference for tools, resources, templates, prompts and Skills), **Activity**, and **Operations** (retained task/build handles). Nothing is shared automatically on startup.

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

The server exposes **132 structured tools**, resources, prompts, pagination,
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
The workspace scope alone cannot authorize these project changes. Public Data Environment definition edits have a separate **data** scope; they cannot execute SQL, open connections or request credentials.

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
| Tasks | Negotiated modern task handles for waits, compilation and inert builds; polling/update/cancel, opted-in notifications, expiry and authority-bound cleanup |
| Skills | Standard `skills/list`, `skills/get`, `resources/directory/read`; six VB6 workflows with complete immutable SHA-256 manifests |
| Rich results / Apps | Text, image, audio, embedded resources and resource links; JSON fallback and typed structured content; existing bounded Intelligent UI / MCP Apps resource |
| Reliability | UTF-8 byte-bounded requests/results/queues, timeouts, strict UTF-8, duplicate-request checks, session cleanup and no automatic mutation replay |
| Companion boundary | Loopback binding, Host/Origin checks, separate owner/client tokens, browser lease, no arbitrary process or remote-URL proxy |

The server does not solicit model sampling or act as a model host. It implements
the modern Tasks and Skills extensions and the existing Intelligent UI / MCP Apps
resource, not every optional or provider-specific extension. This is not
certification against every agent implementation. The local stdio entry is
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
scope, browses resources/templates/prompts/Skills, and exports the schema catalog.
The Skills view reads manifests only: selecting a skill neither loads its
instructions nor grants permissions. Entries include their URI to disambiguate names. **Activity** has a
filterable table, errors-only view, follow toggle and JSON export. Arguments and
credentials are not logged; error summaries can contain project identifiers, so
review activity before sharing it.

**Operations** lists retained tasks and build downloads using local metadata only.
Cancel a selected task, clear finished tasks, or release selected/all build
artifacts. Released/cleared handles immediately become unavailable to agents.
Task arguments, results, client identities and runtime credential caches are not
shown. Closing/reopening the modeless panel disposes only its UI listeners, not
the server or retained operations. These owner controls are not MCP tools; there
is no remote `tasks/list` endpoint or cross-client artifact inventory. Tabs wrap
at narrow widths without overlapping their content.

## Pollable operations and immutable build downloads

Modern clients that advertise `extensions: {"io.modelcontextprotocol/tasks": {}}`
in their per-request client capabilities receive a task handle for
`vb6.agent.wait`, `vb6.project.compile` and `vb6.build.create`. Without that
capability these operations return ordinary inline results. Poll `tasks/get`,
optionally subscribe with `taskIds` through
`subscriptions/listen`, or cancel with `tasks/cancel`. `tasks/update` accepts an
input-response object but these read-only operations never elicit or authorize
changes; unknown/stale input keys have no effect. Tasks last at most 120 seconds,
with at most 32 retained globally and 16 per authenticated principal. Results
are copied and limited to 4 MiB each / 16 MiB total UTF-8; error data is separately
limited to 64 KiB per task. Progress is monotone. A returned handle survives its
initiating HTTP connection, but not authority revocation, server disposal or reload.
Task results include the same complete result envelope as inline calls. Cancellation
that wins after artifact allocation but before settlement releases the orphan artifact.
No legacy experimental Tasks protocol or taskification of mutations is advertised.

`vb6.build.create` produces inert project JSON, application HTML, native-source
ZIP, an existing-compiler Win32 PE32, or a native Linux GTK application
(`target: "linux"`). Linux export emits x86-64 or ARM64 ELF machine code directly
and links the selected GTK3 or GTK4 native SDK. Supply the current `expectedRevision`,
then use `vb6.build.read` with byte offsets and base64 chunks, or follow the
returned resource link to its caller-owned manifest. A resource link is inert:
it neither downloads bytes nor executes the artifact. Every chunk carries
the full-file SHA-256, total byte size and snapshot revision. Unsupported native
constructs return diagnostics, not a substitute executable. SHA-256 uses WebCrypto
where available and a native-differential-tested JS fallback on plain HTTP.
Read-only builds do not run the application, start a compiler process or write
host files. Electron packaging, the licensed classic compiler, and Linux
AppImage/Flatpak packaging use local CLI tools; `vb6.build.targets` describes
their execution requirements.

The Linux build request accepts these additional options:

| Field | Choices or behavior |
| --- | --- |
| `architecture` | `x64` (default) or `arm64` |
| `toolkit` | `gtk3` (default, GTK 3.24) or `gtk4` (GTK 4.14) |
| `format` | `zip` (default), `tar.gz`, `deb`, or `rpm` |
| `optimization` | Project machine-code optimization from `0` through `3` |
| `package` | Validated package identity, version, publisher, license, and desktop metadata |

For example, send this object to `vb6.build.create` using the current revision:

```json
{"target":"linux","architecture":"arm64","toolkit":"gtk4","format":"deb","optimization":3,"package":{"packageName":"my-application","version":"1.0.0","maintainer":"Application Publisher"},"expectedRevision":42}
```

Linux-only options are rejected for other targets. Invalid metadata creates no
artifact. `vb6.build.targets` lists both `architectures`, both `toolkits`, and the
four browser-safe `packageFormats`; its separate `nativePackageFormats` metadata
describes AppImage and Flatpak with `authority: "node-native"`, required Linux
tools, and the CLI route. These two native formats are not accepted by
`vb6.build.create`: save the project and use `npm run build:linux -- PROJECT
--out DIRECTORY --format appimage` or `--format flatpak` on a Linux packaging
host. Source compilation remains offline; the local format tools package the
completed ELF without running it. See [Linux AOT](LINUX-AOT.md),
[native distribution](LINUX-DISTRIBUTION.md), [GTK behavior](LINUX-GTK.md), and
[rich documents](LINUX-RTF.md).

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

## Stable catalog paging and typed results

Tool, resource, template, prompt, skill and skill-directory lists use immutable
serialized snapshots. Continue with the exact opaque `nextCursor`; never construct
an offset or assume a page contains 100 entries. Pages stop at 100 entries **or**
the byte budget. Cursors are bound to the transport principal, catalog/directory,
workspace authority and a 60-second deadline. They can be retried without
re-reading a changing project. Start a fresh list after `-32602` expiry/revocation.
At most 64 snapshots / 16 MiB total are retained, with an eight-snapshot per-caller
quota; oldest snapshots may be evicted. A single oversize catalog entry fails
explicitly rather than being silently dropped. Change-notification catalog reads
are coalesced per principal, not launched per keystroke or subscriber.

Modern `structuredContent` preserves JSON objects, arrays, scalars and null.
Older clients receive an object wrapper for non-object values and an inert text
fallback for resource links predating `2025-06-18`. Rich content is opt-in host
presentation metadata, not fields copied from untrusted project data. Every
successful result also has a JSON text fallback. Output schemas are checked before
a result leaves the server. UI presentations include readable fallback text and
the existing `ui://vb6/intelligent-ui` metadata without changing in-process data.

The dependency-free offline schema validator supports local JSON Pointer/anchor
references, combinators, conditionals, deep enum/const/uniqueness, Unicode lengths,
patterns, number bounds/multiples, object dependencies, tuples, contains and
unevaluated-property/item assertions. It does not fetch schemas, mutate inputs or
apply defaults. It is a bounded assertion implementation, **not a complete JSON
Schema 2020-12 metaschema validator**: dynamic/recursive scopes and nested `$id`
scopes fail explicitly; `format` is an annotation. Schemas and regular expressions
must be trusted host-authored definitions. Remote tools cannot install schemas.

## Standard Skills and resource ranges

`server/discover` declares `io.modelcontextprotocol/skills` with `directoryRead`.
`skills/list` and `skills/get` expose complete entries containing verbatim
frontmatter, all file URIs, byte sizes and `sha256:` digests. The six built-ins are
`inspect-project`, `edit-source`, `design-forms`, `debug-runtime`, `build-artifacts`
and `inspect-data`, each rooted at `skill://vb6/<name>/SKILL.md` and accompanied
by a safety reference. `resources/directory/read` lists direct children, including
`inode/directory` subdirectories; it is not a recursive search. Skill files remain
readable as ordinary resources by legacy clients. Unknown entries return `-32602`.

A host verifies each file against the held manifest and applies its own explicit
skill activation/approval policy. A resource read is **not activation**, a matching
digest is not a trust anchor, and skill text cannot grant IDE permissions. The
server publishes built-in workflows; it does not install remote skills, execute
skill scripts or become an outbound MCP client. Trusted embedders may import
`McpSkillCatalog` from `src/mcp/skill-catalog.js` and supply immutable definitions.

Additional ranged resource templates are:

```text
vb6://module/{name}/source{?offset,count,revision}
vb6://build/{artifactId}
vb6://build/{artifactId}/bytes{?offset,count}
```

For source, start with `vb6://module/Form1/source?count=65536` and follow
`contents[0]._meta["io.vb6/range"].nextUri`. Nonzero offsets require the captured
revision. Offsets/counts are UTF-16 code units, so concatenate text ranges exactly;
never apply byte offsets to source strings. Stale revisions fail rather than
mixing different source snapshots. Unknown, duplicate and invalid query parameters
are rejected. The old full-source resource remains available for compatibility.

The build manifest is JSON metadata, **not the executable's bytes**. Its range
resource returns base64 bytes with size, checksum, offset and continuation metadata.
All reads dispatch through the same validated, permission-checked `code.read` and
`build.read` tools, including embedded coding-agent policy and artifact ownership.
Private artifacts are not added to the global resource catalog.

Protocol references: [core tools](https://modelcontextprotocol.io/specification/2026-07-28/server/tools),
[stable Tasks](https://github.com/modelcontextprotocol/ext-tasks/blob/main/specification/2026-07-28/tasks.md),
[stable Skills](https://github.com/modelcontextprotocol/ext-skills/blob/main/specification/stable/skills.mdx).

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

## Data Environment and large source reads

The `vb6.data.*` tools inspect and edit the project's public connection and command
definitions. `data.providers` describes the seven built-in provider IDs;
`data.list` returns paginated summaries and `vb6://data` exposes that inventory as
a resource. Connection/command `get`, `set`, and `remove` support explicit
create/replace modes and case-insensitive names. `data.rename` updates dependent
command-to-connection references atomically. Removing a connection with commands
requires explicit `cascade:true`. Source identifiers and control bindings are not
rewritten by these operations: use `code.edit`/`control.edit` explicitly.

Mutations require design mode, the current revision and Allow once or the new
**data** scope. Complete candidates are validated with the same model as the IDE,
then committed through project undo. Individual definitions are bounded to
512 KiB. Known credential fields, authorization headers, credential-bearing URLs
and connection strings are rejected by the shared public-configuration validator;
use a `credentialRef` instead. As with source files, arbitrary text is not a
universal secret scanner. Runtime credentials are neither inspected nor changed.
`data.validate` is structural validation, **not** a live connection/SQL test.
There are no database-execution or network-access tools in this group.

For very long source lines, `vb6.code.read` returns bounded UTF-16 ranges rather
than the line-based `module.read` response. Supply `module`, optional `offset`
(default 0), `count` (default 65,536; maximum 262,144 code units) and the optional
`expectedRevision`. Reuse that revision for every chunk; stop and reread on a
stale-revision error. `nextOffset`, `totalCodeUnits`, `hasMore` and
`offsetEncoding:"utf-16"` describe progress. Concatenate as UTF-16 code units:
a chunk boundary can split a surrogate pair without dropping either unit.

Principal revocation cancels matching active calls, legacy sessions, tasks and
artifacts without affecting other principals. A canceled/expired task cannot
start its queued adapter callback, canceled legacy resource subscriptions cannot
recreate closed listeners, and a closed server rejects new dispatches. Stateless
tool calls see current tool registrations even without a prior catalog read.


Transport-authenticated principals own initialized sessions and cancellation
notifications; reusing a session key does not grant access to another caller.
Task deadlines are also checked before queued execution and before publishing a
result, so a suspended tab or delayed timer cannot extend a task's authority.
Cancelling an initiating request before its handle is returned removes that
unpublished task; a successfully returned task remains independent of its HTTP
response lifetime. These are cooperative cancellation rules: they do not
preempt synchronous JavaScript already executing in the browser.

The IDE's separate API-key coding agents consume the same 132-tool adapter.
Their **data** grant authorizes public definition edits only; **code** or
**workspace** grants do not imply it. Read-only runs expose definition reads,
validation and bounded source reads, but not definition mutations. Built-in
agent permissions remain separate from external MCP sharing.
