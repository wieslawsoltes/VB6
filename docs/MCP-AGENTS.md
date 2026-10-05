# Coding agents: structured control of VB6 Studio

The MCP server exposes **125 tools** across the implemented IDE: project/native
source interchange, code, editor views, forms/controls/menus, resources, virtual
files, debugger, live application interaction, Object Browser, explorer,
documents, docking, toolbars, appearance, public Data Environment definitions and undo. The same source is bundled into
the linked static app and single-file HTML. External clients reach the live IDE
through the authenticated loopback companion. There is no outbound MCP client in the IDE; see [MCP setup](MCP.md).

This is structured access to the browser IDE's **implemented features**, not a
claim of complete Microsoft VB6 binary/COM/debugger compatibility. `tools/list`
is the authoritative schema, including enums, required fields and bounds.
`vb6.agent.capabilities` supplies the inventory, current permissions and limits.
`vb6.commands.list` maps the toolbar catalog plus the structured Data Environment route and reports live menu
entries. Menu actions without a structured route are explicitly marked local-only,
not executed through an unrestricted command dispatcher.

## Local authorization

Enable **Tools → MCP Agent Access → Agent access → Enable sharing**. Reads now expose
the current project to paired clients. Mutations still show **Allow once** with
Deny as the default. For a coding session, open **Agent permissions**, select
scopes, choose 1–60 minutes, then confirm **Authorize session**. Scopes are:

| Scope | Authority |
| --- | --- |
| code | Module source/identity, editor text edits, atomic edits, declarations, event stubs, bookmarks |
| project | New/import/replace projects, metadata, reference declarations, explorer and project undo/redo |
| designer | Forms, controls, menus, properties, geometry and designer state |
| files | Project virtual files, raster assets, native RES, VB application settings and runtime capture |
| debugger | Stack/frame control, typed inspection/assignment, evaluation, watches, breakpoints and live edits |
| runtime | Start/stop, sandbox controls, menus, application dialogs and virtual runtime files |
| workspace | Editor selection/views, documents, docking, toolbars, appearance |
| data | Public connection/command definition edits, rename and removal; no SQL, live connections or credential cache |

The grant applies to **all paired clients**, not one named client. Only pair
trusted clients. No scope is selected by default. Authority is memory-only,
project-bound and time-limited. A visible MCP agent indicator remains in the owner
IDE. Revoke with **Revoke agent permissions**, disable sharing, detach the companion, or reload. Grants
also clear when the project identity changes, including history restoring another
project. Expiry/revocation aborts ongoing delegated requests and cancels explicit
VB evaluation. It does not roll back effects already performed or stop an
application that was previously started; use `vb6.runtime.stop` for that.

Control mutations require a running/idle application; paused state changes use
the debugger tools. Replies to runtime dialogs opened by explicit evaluation
remain available while paused.

Agents cannot grant, extend or revoke local permissions, read credentials, click
IDE/MCP consent dialogs, or invoke arbitrary JavaScript/DOM/shell operations.
Runtime dialog interaction is restricted to the sandboxed application, never the
owner IDE. User-gesture-controlled OS pickers, clipboard access, printing,
fullscreen and creation of a new detached OS/browser window remain local actions.
An already-open in-page window can be positioned; a detached window can be returned.

Delegation eliminates repetitive consent prompts, **not revision validation,
schema validation, design/paused-state guards or debugger safety limits**. Operations
outside authorized scopes still require Allow once. Project imports return the
existing importer's diagnostics, and do not install native libraries or execute
imported commands.

## Reliable agent workflow

1. Read `vb6.agent.capabilities`, `vb6.project.get` and relevant source/model tools.
2. Send the returned `revision` as `expectedRevision` on each mutation. On a stale
   revision error, reread and recompute the proposed edit; do not blindly replay it.
3. Use `vb6.code.edit` for atomic multi-module changes. Each range is a zero-based
   UTF-16 offset into the **original** module source; `end` is exclusive. Edits
   must not overlap. Optional `expectedText` adds a precise source precondition.
4. Compile, start with break or breakpoints, and read `vb6.debug.snapshot`.
   Pass its `pauseId` and optional `frameIndex` to typed debugger operations.
   `debug.command` accepts `pause`, `run`/`continue`, `stepInto`, `stepOver`, `stepOut`.
5. Edits in break mode are staged. Call `vb6.debug.applyEdits` explicitly. The VM
   rejects unsafe active topology/signature changes without replacing its code.
   `debug.runToCursor` and `debug.setNextStatement` operate on current runtime code.
6. Use `vb6.runtime.inspect` for opaque run-specific IDs, then
   `vb6.runtime.interact` for supported controls, grid/list cells, menu commands
   and InputBox/MsgBox replies. Input is queued; an accepted reply is not a promise
   that the application handler has completed.

Concurrent same-revision source/project writes cannot overwrite one another: a
second conflicting operation fails its revision check before mutation. Reading
output/watch notifications advances **eventSequence** without invalidating source
revision preconditions. `vb6.agent.wait` can wait for `afterRevision`, `afterEvent`,
`state`, or a new `afterPause`. Supplied conditions are combined. Its `matched`
field distinguishes a condition from a timeout. For stepping, use
`{state:"paused", afterPause: previousPauseId}` rather than matching the previous
pause. For queued application I/O, inspect output/runtime state until the expected
result is visible. Waits and subscriptions do not automatically execute follow-up
operations.

### Atomic source edit

```json
{
  "name": "vb6.code.edit",
  "arguments": {
    "expectedRevision": 42,
    "edits": [
      {"module": "Main", "start": 55, "end": 70,
       "expectedText": "value = value+1", "text": "value = value+2"}
    ]
  }
}
```

Use actual offsets and revisions from reads. `code.transform` and module/control
rename use the existing lexical rename engine; they are **not** whole-program
semantic refactoring. Designer IDs disambiguate indexed control-array elements.
Names cannot be changed accidentally through the generic property patch route.

### Runtime and debugger

`debug.inspect` and `debug.locals` inspect storage without invoking project
functions/getters. `debug.assign` accepts typed literal text.
`debug.evaluate` permits an expression, optional current frame/pause identity,
`instructionLimit` (1–1,000,000) and `timeLimit` (1–30,000 ms). Defaults are 100,000
instructions and 5 seconds. `debug.immediate` executes bounded VB Immediate
statements in a paused frame and can access the runtime's implemented VB APIs.
These may have side effects. `debug.cancelEvaluation` stops in-flight evaluation
without entering the approval queue; it does not grant authority or undo effects.

`runtime.inspect` returns paginated forms, controls and menu items, plus active
application dialogs. IDs are invalidated by runtime replacement. Property/method
and indexed-property allowlists are included in the response. `runtime.interact`
actions are `click`, `focus`, `set`, `event`, `menu`, `dialog`, `call`,
`indexedGet`, `indexedSet`. The allowlisted control methods are AddItem,
RemoveItem, Clear, Move, SetFocus, Refresh, Cls, Print, Scale, Undo, Redo, Find and
GetLineFromChar. Indexed properties are List, ItemData, Selected, TextMatrix,
ColWidth and RowHeight. Unsupported control semantics remain explicit errors.
Only the top runtime dialog can be answered. Disabled/hidden controls,
modal-blocked forms, inactive menu ancestors and stale IDs reject input.

The shared runtime still enforces its original capabilities and sandbox. Collection
APIs beyond the structured control allowlists can be manipulated using VB code
and the bounded paused Immediate/evaluation APIs; no internal JS-object traversal
is offered. This does not add unrestricted native function evaluation or OS automation.

## Files, export and resources

`project.import` accepts `files` entries (`path`, `content`, optional `encoding`:
`utf8` or `base64`) **or** a base64 `zip`. Use `project.entries` to select an
`entryPath`, and supply the native source `encoding` when it is not auto-detectable.
`basenameFallback` explicitly enables the importer's compatible path lookup. Optional `add:true` imports modules/assets
into the current project; it does not merge every setting of another workspace.
`project.files`, `project.archive` and `project.export` return data; they do not
open downloads or choose host paths. A desktop agent may save returned bytes using
its own separately authorized filesystem facilities.

`files.*` means the **project's virtual disk**, never the host disk. Binary ranges
are byte offsets; text ranges are UTF-16. `runtime.snapshot` reads the running
application's isolated virtual files/settings; `runtime.capture` copies them into
the project with undo. Native RES editing preserves adjacent entries and supports
string tables and arbitrary opaque resource bytes. Assets accept offline raster
images, not remote fetch URLs, SVG or HTML.

Native project paths, references and attributes are validated against line/path
injection and duplicate paths. They preserve declarations; they do not load COM/OCX,
execute macros, or extend the format parity of the underlying importer/exporter.

## Build artifact and task examples

Read `build.targets`, then call `build.create` with, for example,
`{"target":"sources","expectedRevision":42}`. On success, retain the returned
`artifactId`; call `build.read` with `{ "artifactId":"…", "offset":0, "count":262144 }`.
Decode each base64 `data` chunk, advance to `nextOffset` until `hasMore` is false,
and verify the full SHA-256 before saving. `project.files` also accepts optional
`byteOffset`/`byteCount` for bounded source-file reads, including encoded native
text. Offset units are bytes, not JS string positions. Large downloads do not
require a giant JSON-RPC result or execute project code.

For a nonblocking modern wait, add this to each request's client capabilities:
`{"extensions":{"io.modelcontextprotocol/tasks":{}}}`. `vb6.agent.wait` then returns
`resultType:"task"`. `tasks/get` takes `taskId`; terminal `completed` includes the
normal tool `result`, `failed` includes `error`, and `cancelled` has no successful
result. `tasks/cancel` and `tasks/update` acknowledge with `resultType:"complete"`.
For HTTP all three task methods require `Mcp-Name: <taskId>` in addition to the
normal modern routing/version headers. Wait tasks are read-only, max 30 seconds
of waiting, and max 120 seconds of retained task lifetime; they cannot approve
IDE actions. Reread/recompute after a modern stale-revision `-32602` (legacy
clients retain `-32002`), rather than replaying a mutation.

See [MCP setup and limits](MCP.md) for expiry, identity binding and unsupported
extensions. The old experimental legacy Tasks API is not exposed.

## Additional resources

In addition to the existing project/module/form/debug resources:
`vb6://agent/capabilities`, `vb6://project/settings`, `vb6://files`,
`vb6://resources`, `vb6://workspace`, `vb6://watches`, `vb6://history`.
They obey the same sharing gate and subscriptions. No resource includes MCP tokens.

## Validation

```sh
npm run build
npm test
npm run test:mcp:browser
npm run test:mcp:agent
```

The coding-agent browser test uses the real IDE, local consent UI, compiler,
undo, editors, designers and sandbox debugger. In its default mode it sends
operations from an external HTTP MCP client through the companion in four real
navigation modes: standalone `file://`, HTTP subpath, HTTPS subpath and companion
localhost. The HTTPS fixture trusts only its ephemeral test certificate. It does
not disable CORS or local-network policy. `--opaque` is explicitly UI-only and is
not substituted for real navigation in CI. Node tests additionally exercise
metadata/path injection, atomic edits, races, scoped authority, expiry/revocation,
protocol interoperability and runtime isolation.

## Data Environment workflow

Use `data.providers` and `data.list` first. Create a connection with
`data.connection.set`, then a command using `data.command.set`; `mode` must be
`create` or `replace`. Both require `expectedRevision` and either Allow once or
local delegation of **data**. No grant in **workspace** or **runtime** implicitly
grants data-definition edits. The standard **project** scope retains its existing
whole-project replacement/import powers, including project-contained definitions.

```json
{
  "name": "vb6.data.connection.set",
  "arguments": {
    "expectedRevision": 42,
    "mode": "create",
    "definition": {"name": "LocalData", "provider": "sqlite", "path": "customers.sqlite"}
  }
}
```

These are saved design-time definitions. `data.validate` checks structure, not
server availability or SQL semantics; no backend is contacted or credential
prompt approved. A connection rename updates commands pointing to it in the same
undo record. Source code and control bindings need explicit separate edits.
Removal never deletes the underlying project virtual database file. Exported
project JSON and native data sidecars contain the committed definitions.

## Large source and owner operations

Use `vb6.code.read` for bounded chunks, including long single-line sources. Read
at most 262,144 UTF-16 code units per call (default 65,536), advance using
`nextOffset`, and supply the same `expectedRevision` throughout reconstruction.
Offsets are not UTF-8 bytes or Unicode code-point indices. A surrogate split at
a boundary must be rejoined without loss; EOF returns an empty final chunk.

The local **Operations** tab lets the IDE owner cancel retained tasks, clear
finished records and release build artifacts. Agents cannot enumerate other
clients' operations through these controls. A cleared/released handle returns
not-found; do not blindly repeat a mutation to recover a missing handle. Tasks
remain limited to `agent.wait`; definitions and other mutations are not taskified.

## Tool reference

Every name below has the `vb6.` prefix. The live MCP catalog contains the full
JSON schema. Mutations require `expectedRevision` except the safe, interrupt-only
`debug.cancelEvaluation` tool.

### project

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.project.get` | Read | Read project identity, module inventory, runtime state, and current edit revision. |
| `vb6.project.compile` | Read | Compile and report diagnostics without executing code. |
| `vb6.project.export` | Read | Return the full project JSON or standalone application HTML. This reads project data; it does not download or execute. |
| `vb6.project.replace` | Mutate | Replace the complete workspace from a validated VB6 web project. Requires local approval and records undo. |
| `vb6.project.details` | Read | Read project settings, references, native metadata and module identities without embedding all source and binary data. |
| `vb6.project.update` | Mutate | Update project name, description, startup, settings and preserved native metadata. Validated and undoable. |
| `vb6.project.new` | Mutate | Create a new project with one form. Replaces the workspace after approval; its previous project can be recovered through undo. |
| `vb6.project.import` | Mutate | Open or add original VB6/native or web source files, or a base64 ZIP. Uses the existing importer and reports format diagnostics. Does not access the host filesystem. |
| `vb6.project.files` | Read | List or read original/native-style exported project files without downloads. Read binary resources as base64; text uses UTF-8. |
| `vb6.project.archive` | Read | Return a source/workspace ZIP as base64 data, never an automatic download. Native export has the same compatibility limits as the IDE. |
| `vb6.project.explorer` | Read | Read the active project node, expanded module folders and toolbox category. |
| `vb6.project.explorerSet` | Mutate | Control project explorer folders and toolbox categories without changing project code. |

| `vb6.project.entries` | Read | Inspect supplied files/ZIP for selectable entry paths and supported encodings. |
| `vb6.project.group` | Read | List all open native group members, active member and startup project. |
| `vb6.project.select` | Mutate | Switch group members while preserving edited peers and per-project IDE state; revoke old authority. |
| `vb6.project.startup` | Mutate | Set the native group startup path with undo and revision checks. |

### build

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.build.targets` | Read | Describe inert export targets, artifact limits and local-only packaging operations. |
| `vb6.build.create` | Read | Build immutable bytes for a supplied current revision; return handle/checksum or native diagnostics. |
| `vb6.build.read` | Read | Read caller-owned base64 chunks with byte offsets, complete SHA-256 and snapshot revision. |
| `vb6.build.release` | Read | Release a caller-owned temporary build artifact; does not delete project or host files. |

### module

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.module.read` | Read | Read source lines from one module. Line numbers are one-based; at most 1000 lines per call. |
| `vb6.module.write` | Mutate | Replace a module source atomically with undo. Requires current expectedRevision and local approval. |
| `vb6.module.add` | Mutate | Add a form, standard module, or class module with undo and local approval. |
| `vb6.module.remove` | Mutate | Remove a module with undo and local approval. The final module cannot be removed. |
| `vb6.module.rename` | Mutate | Rename a module/form and its source identifier references, preserving strings and comments. This is lexical, not whole-program semantic refactoring. |
| `vb6.module.metadata` | Mutate | Edit module attributes, native path, class header and source encoding metadata. |

### form

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.form.get` | Read | Read a module’s full form/control/menu designer model. |
| `vb6.form.update` | Mutate | Replace a form model after validation, with undo and local approval. |
| `vb6.form.properties` | Mutate | Patch form designer properties without replacing controls. Use module.rename to change identity. |

### workspace

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.workspace.search` | Read | Search project source literally (not a regular expression). Results include module and line. |
| `vb6.workspace.get` | Read | Read appearance, document/window geometry, dock layout, toolbar state and named layout names. Excludes MCP UI and credentials. |
| `vb6.workspace.configure` | Mutate | Set recognized IDE appearance and editor options. Unknown options are rejected; MCP permissions are never configurable here. |
| `vb6.workspace.layout` | Mutate | Restore a fully validated layout, including docking, toolbars and editor views. Browser-window restoration remains gesture-controlled. |
| `vb6.workspace.layouts` | Read | Read named layout descriptors. |
| `vb6.workspace.saveLayout` | Mutate | Save/replace the current layout under a bounded name. |
| `vb6.workspace.deleteLayout` | Mutate | Delete one named layout. |

### document

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.document.open` | Mutate | Open a module at a source line or in the form designer, with local approval. |

### runtime

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.runtime.start` | Mutate | Compile and start the project in the existing sandboxed VB6 runtime after local approval. Project code can perform its normal runtime effects. |
| `vb6.runtime.stop` | Mutate | Stop the running application after local approval. |
| `vb6.runtime.inspect` | Read | Inspect live form instances, their controls, observable properties and runtime dialogs using opaque IDs. Only the sandboxed application is inspected. |
| `vb6.runtime.interact` | Mutate | Interact with a running form/control or application dialog using IDs returned by runtime.inspect: click, focus, set a property, call an allowlisted control method, indexedGet/indexedSet, event, menu command or dialog reply. It cannot touch IDE/MCP dialogs. |
| `vb6.runtime.snapshot` | Read | Read the running application’s isolated virtual disk and VB settings, without changing the project. |
| `vb6.runtime.capture` | Mutate | Copy the running application’s virtual disk/settings into the project with undo. Does not read host files. |

### debug

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.debug.snapshot` | Read | Read debugger locals, stack, watch values and breakpoints. Does not evaluate expressions. |
| `vb6.debug.command` | Mutate | Pause, continue, or single-step the existing runtime after local approval. |
| `vb6.debug.evaluate` | Mutate | Evaluate an expression in the paused runtime. May execute project code or mutate state; requires approval or a delegated debugger scope. |
| `vb6.debug.frames` | Read | Read stack frames, selected frame and pause identity without evaluating source. |
| `vb6.debug.inspect` | Read | Inspect stored locals, fields, records or array children without invoking user functions/getters. Requires current pause identity; results are paginated. |
| `vb6.debug.locals` | Read | Read typed local storage for one stack frame; no user code is executed. |
| `vb6.debug.selectFrame` | Mutate | Select a valid paused stack frame, updating the Locals and Watch tools and source navigation. |
| `vb6.debug.assign` | Mutate | Assign a typed literal into paused local/field/array storage. Does not evaluate arbitrary JavaScript. |
| `vb6.debug.runToCursor` | Mutate | Resume until a selected executable source line. Uses the current runtime code; apply pending edits explicitly first. |
| `vb6.debug.setNextStatement` | Mutate | Move the paused instruction pointer within the existing VM’s supported safe regions. |
| `vb6.debug.applyEdits` | Mutate | Apply staged source edits to the paused VM. Unsafe topology/signature changes are rejected by the existing live-edit engine. |
| `vb6.debug.immediate` | Mutate | Execute a VB Immediate statement in the paused frame. May mutate state or execute VB code; cancellation and the VM evaluation budget still apply. |
| `vb6.debug.cancelEvaluation` | Mutate | Cancel an in-flight explicit evaluation. No approval queue or revision dependency; effects already committed are retained. |

### breakpoints

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.breakpoints.set` | Mutate | Replace source breakpoints, validating modules and lines, after local approval. |

### agent

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.agent.capabilities` | Read | Discover the entire supported agent surface, scope categories, current authority, command routing, and explicit host-only boundaries. |
| `vb6.agent.wait` | Read | Wait for revision, observed event sequence, or runtime-state change, without polling the whole project. Returns on change, timeout or cancellation. |

### references

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.references.get` | Read | Read project reference and OCX declarations. This does not load native COM libraries. |
| `vb6.references.set` | Mutate | Replace preserved reference/OCX declarations, without downloading or executing native libraries. |

### code

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.code.edit` | Mutate | Apply disjoint source edits across modules atomically, with one undo transaction. All UTF-16 ranges refer to the original source. Paused-runtime edits remain staged. |
| `vb6.code.transform` | Mutate | Format source or lexically rename an identifier. Omitting module applies to all modules. Strings/comments are preserved by rename; it is not semantic rename. |
| `vb6.code.symbols` | Read | Read declaration symbols and procedure signatures, with module scoping, literal filtering and pagination. |
| `vb6.code.complete` | Read | Return declaration-aware completion, quick info or parameter info at a UTF-16 source offset without changing editor selection. |

### procedure

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.procedure.add` | Mutate | Add a Sub, Function or Property using the existing declaration generator. |
| `vb6.procedure.get` | Read | Read procedure declarations and native attributes. |
| `vb6.procedure.attributes` | Mutate | Update a procedure description, HelpID, member ID and flags. |
| `vb6.procedure.event` | Mutate | Generate a typed event handler for a form or control. Control arrays include the Index argument. |

### bookmarks

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.bookmarks.get` | Read | Read one module’s source bookmarks. |
| `vb6.bookmarks.set` | Mutate | Replace source bookmarks with validated one-based lines. |

### control

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.control.edit` | Mutate | Add/update/remove/rename/reparent/reorder a control. Use stable IDs for array elements. Removal of children requires cascade:true. |

### menu

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.menu.edit` | Mutate | Add/update/remove/rename/reparent/reorder menu designer entries. Parent names and cycles are validated. |

### designer

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.designer.format` | Mutate | Apply container-local spacing, grid sizing, centering and largest/smallest sizing with undo. |
| `vb6.designer.catalog` | Read | Read every supported control type and property defaults from the current project models. |
| `vb6.designer.get` | Read | Read selected control IDs, zoom/tool/lock/tab-order state and the full form model. |
| `vb6.designer.set` | Mutate | Set the active form, selected control IDs, drawing tool, zoom, lock and tab-order mode. |
| `vb6.designer.align` | Mutate | Align, size, distribute, snap or reorder selected controls using existing designer geometry. |

### files

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.files.list` | Read | List virtual project files and directories. This never reads the operating-system filesystem. |
| `vb6.files.read` | Read | Read a bounded range of a virtual file: UTF-16 text units or binary bytes. Binary results use base64. |
| `vb6.files.write` | Mutate | Write text or base64 bytes to the project’s isolated virtual disk, with undo. |
| `vb6.files.manage` | Mutate | Remove, rename or copy a virtual file; create/remove empty virtual directories. |

### assets

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.assets.list` | Read | List project raster assets without embedding image data. |
| `vb6.assets.read` | Read | Read one exact project asset as inert data. |
| `vb6.assets.write` | Mutate | Add/replace an offline raster data URL. Remote URLs, SVG and active HTML are rejected. |
| `vb6.assets.remove` | Mutate | Remove an asset. Existing picture references may then become unresolved. |

### appSettings

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.appSettings.get` | Read | Read project application settings, distinct from private IDE/MCP settings. |
| `vb6.appSettings.set` | Mutate | Replace the project’s VB application settings with undo. Does not change MCP permissions. |

### resources

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.resources.list` | Read | List native resource keys/types/languages and byte sizes without binary payloads. |
| `vb6.resources.read` | Read | Read the exact base64 bytes and metadata for one native resource key. |
| `vb6.resources.strings` | Read | Read decoded native string table entries. |
| `vb6.resources.write` | Mutate | Add/replace a native resource entry (type, name, language, base64 data and optional header metadata). |
| `vb6.resources.remove` | Mutate | Remove one native resource key with undo. |
| `vb6.resources.string` | Mutate | Set one native string-table entry, preserving adjacent entries. |
| `vb6.resources.import` | Mutate | Import an original Win32 RES file supplied as base64 data. |
| `vb6.resources.export` | Read | Export original/current Win32 RES bytes as base64, without a browser download. |

### objects

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.objects.catalog` | Read | Query Object Browser declarations, library signatures and authored control properties without executing code. |

### documents

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.documents.list` | Read | List open code/designer documents and modeless tools, without MCP secrets. |
| `vb6.documents.close` | Mutate | Close one code/designer document or a non-security modeless tool. Source stays in the project. |
| `vb6.documents.set` | Mutate | Activate, minimize, maximize, restore or position an existing document/modeless tool. MCP security tooling is excluded and no OS popup is created. |

### editor

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.editor.get` | Read | Read cursor, full-source selection and split/procedure-view metadata for an open module. |
| `vb6.editor.set` | Mutate | Open a module and set its selection, split panes, procedure/full-module view and scroll metadata using UTF-16 offsets. |
| `vb6.editor.edit` | Mutate | Edit the selected module with explicit text or block operations. No host clipboard access; text must be supplied. Paused changes remain staged. |

### history

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.history.get` | Read | Read undo/redo labels and counts without embedding project snapshots. |
| `vb6.history.apply` | Mutate | Undo or redo one project edit, using the IDE’s existing history. |

### windows

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.windows.set` | Mutate | Show/hide/activate/dock/float a registered IDE tool group, return detached windows, or arrange MDI documents. Does not open browser popups. |

### toolbars

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.toolbars.get` | Read | Read toolbar descriptors and the complete public command catalog. |
| `vb6.toolbars.set` | Mutate | Replace the complete toolbar layout. Validates command IDs, bounds and custom bar names before changing the UI. |

### commands

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.commands.list` | Read | Map every catalog command to its structured MCP replacement or direct UI command. Native/security UI actions cannot be blindly clicked by agents. |
| `vb6.commands.execute` | Mutate | Execute a supported non-modal UI command from commands.list. Does not expose arbitrary command names or security dialogs. |

### watches

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.watches.get` | Read | Read expressions, breakpoint watch definitions and evaluated values. |
| `vb6.watches.set` | Mutate | Replace watch expressions and expression/change/true modes, optionally scoped to a module/procedure. Automatic watches do not execute project code. |

### output

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.output.read` | Read | Read bounded output, Immediate or diagnostics entries with offset/limit. |
| `vb6.output.clear` | Mutate | Clear Output and/or Immediate display, not files or source. |

### data

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.data.providers` | Read | Describe built-in providers and design-only/credential boundaries. |
| `vb6.data.list` | Read | Paginated connection/command summaries; no SQL text or live results. |
| `vb6.data.connection.get` | Read | Read one public saved connection definition. |
| `vb6.data.connection.set` | Mutate | Explicitly create/replace a complete validated public connection. |
| `vb6.data.connection.remove` | Mutate | Remove a connection; dependent commands require explicit cascade. |
| `vb6.data.command.get` | Read | Read one saved command definition, including public parameters. |
| `vb6.data.command.set` | Mutate | Explicitly create/replace a command referencing a saved connection. |
| `vb6.data.command.remove` | Mutate | Remove only the command definition, with undo. |
| `vb6.data.rename` | Mutate | Rename a connection/command; update command-to-connection links atomically. |
| `vb6.data.validate` | Read | Structural diagnostics without SQL execution, credentials or networking. |

### Additional bounded source access

| Tool | Access | Behavior |
| --- | --- | --- |
| `vb6.code.read` | Read | Bounded UTF-16 source chunks, optional revision guard, explicit EOF/progress. |
