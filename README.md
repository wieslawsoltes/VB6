# VB6 Studio Web 0.6.0

A browser-native classic Visual Basic development environment, source runtime and controls library. Built from HTML, CSS and JavaScript, with WebGPU drawing and Canvas2D fallback. Export edited projects as independent single HTML applications.

**New in 0.6:** runtime MDI forms/child windows and a working example; project-defined interfaces/default members and DefType declarations; explicit cancellable paused function evaluation; broader mapped live editing; native .res import/export, runtime resource functions and a modeless Resource Editor; modeless-tool restoration in workspace profiles.

**Not a complete, native or pixel-identical Microsoft VB6 replacement.** Detailed supported behavior and limits are in [Compatibility](docs/COMPATIBILITY.md), with [release notes](docs/RELEASE-NOTES-0.6.0.md) and [validation](docs/TESTING.md).

## Debugger and runtime execution control

The classic debugger now includes statement-level stepping and source highlighting, all three Error Trapping modes, recoverable error breaks with retained live frames, scoped break watches, column-aware Run to Cursor and Set Next Statement, and improved caller-frame inspection and Immediate assignment. See the [debugger guide](docs/DEBUGGER.md) for shortcuts, runtime APIs, validation, and remaining compatibility limits.

## Data sources

Classic Data Environment/Data View and Data Link Properties now share a provider-backed ADO-style layer with exported HTML/Electron apps. Use embedded offline **SQLite**, **REST CRUD**, **OData**, **GraphQL**, **JSON/CSV**, or an authenticated native gateway for PostgreSQL, MySQL, SQL Server and installed OLE DB/ODBC providers. Four runnable examples demonstrate SQLite editing and modern HTTP data sources.

See [data sources, examples and deployment](docs/DATA-SOURCES.md) for the compatibility matrix, connection dialogs, binding, credentials and gateway setup. This is not exhaustive native VB6/ADO/DAO/RDO parity; installed native providers and the PE32 AOT compiler have separate deployment boundaries.

## IntelliSense

Classic List Members, List Constants, Complete Word, Quick Info and Parameter Info now share typed resolution across source panes, Immediate, Watch and Evaluation fields. Nested `With`, arrays/default members, classes/UDTs/enums, runtime/data adapters and explicit portable reference metadata feed the same Object Browser. Automatic assistance never executes project code or opens a connection.

See [IntelliSense commands, reference descriptors, safety and validation](docs/INTELLISENSE.md). The [browser compatibility follow-up](docs/INTELLISENSE-COMPATIBILITY.md) adds WithEvents/interface handler dropdowns, labels, reference priority, strict metadata validation and DAO-specific typed chains. Native COM/OCX binary loading and Windows type-library registry discovery are not implied by code assistance.

## Run

The complete IDE is `dist/VB6-Studio-Web.html`. It is designed to open directly in a browser. Browser origin policies can restrict local files, clipboard or persistent storage. A local static server is the alternative:

```sh
npm run serve
```

Open the address printed by the server (default `http://127.0.0.1:8080`). The packaged browser directory also works with a normal static host. No service, database or account is required by the application.

**Launch verification limitation:** this release environment blocks both direct file navigation and localhost HTTP navigation with `ERR_BLOCKED_BY_ADMINISTRATOR` before application startup. The actual emitted HTML and exported apps were tested through inline Chromium loading. Those blocked probes are recorded separately, not represented as successful launch tests. See [Testing](docs/TESTING.md).

The initial Order Entry project is editable and runnable. Press **F5** to run, **Shift+F5** to stop, and choose **File → Make <project>.html…** to export an independent application. **Save Project** downloads an editable `.vb6web` file. Save explicit project backups; origin storage and layout persistence are best-effort browser facilities, not a replacement for downloaded backups.

## What is new in 0.6.0

This release starts from the verified 0.5.0 source and Git history. The previous incomplete continuation did not leave a newer source archive. Four real feature worktrees were implemented, tested and merged; this is not an older build renamed as a new version.

| Area | Implemented in this release |
|---|---|
| Runtime MDI | A single MDIForm, independent child instances, active-window tracking, move/resize, min/max/restore, cascade/tiling, WindowList menus and coordinated cancellable unloading. |
| Resource tools | A modeless Resource Editor; native Win32 .res string/binary import and export; byte preservation; VBP ResFile32 integration; LoadResString, typed LoadResData and supported LoadResPicture. |
| Language | Module-scoped DefType declarations, validated project-defined interfaces, contract dispatch and default-member attributes. |
| Explicit evaluation | Paused user-function execution with selected caller frame, cancellation, instruction/time limits, evaluated dialogs and restoration of debugger/error state. Automatic watches remain side-effect-free. |
| Live editing | Bounded instruction remapping supports eligible straight-line insertions/deletions while preserving paused locals and caller continuation. Unsafe changes require restart. |
| Workspace restoration | Same-project profiles and automatic restoration now reopen supported modeless tools and restore their geometry without opening unrelated project documents. |

Three shared themes remain available: Windows Classic, Windows Standard (2000), and High Contrast Black. IDE appearance is independent of the exported application's theme. System colors resolve through the theme; authored RGB colors are retained.

## Existing IDE, runtime and controls

The source includes modeless Object Browser, project search and atomic replacement, bookmarks, full/procedure/declarations and split source views, Project Explorer, Properties, Form Layout, designer/menu tools, classic menus/dialogs, MDI document management, customizable toolbars and independent debugger panes. Debugging includes conditional breakpoints, stepping, caller-frame inspection, typed variable edits, Quick Watch, bounded value trees, guarded watch evaluation, Run to Cursor, compatible paused source edits and bounded Set Next Statement. These are browser implementations, not arbitrary native debugger capabilities.

The compiler and cooperative VM execute VB-style source through their own instruction model, not JavaScript eval of user VB text. Supported features include procedures/classes/properties, named and optional arguments, ByRef paths, instance static storage, arrays and records, control flow and error handling, events, exact backed Currency, distinct Empty/Null/Nothing/Missing/Error values, calendar helpers and private binary/text files. The compatibility matrix identifies incomplete coercion, lifetime and binding semantics.

There are 37 offered browser control types, including classic intrinsic-style controls and TreeView, ListView, RichTextBox, grids, tabs, toolbars, calendars, charts and file-dialog adapters. Familiar names do not imply full native API coverage. In-memory recordsets are not external ADO/DAO providers. Native COM/OCX, DLL calls, Windows API execution and arbitrary add-ins are not implemented.

## Eleven examples

`dist/examples/` contains Order Entry, Calculator, Clock, Graphics Lab, Data Browser, Common Controls, Language Lab, Event Workbench, Rich Text Editor, Runtime Workbench and MDI Resource Workspace. Editable counterparts are in `examples/`. Each generated HTML app embeds its own runtime; the IDE is not required to run it.

## Build and test

Requires Node.js 22 or later. The build has no npm package dependencies:

```sh
npm run build
npm test
```

Browser tests require Python, Playwright, Pillow and a Chromium executable. The tools use installed Chromium; they do not install packages themselves.

```sh
npm run validate
npm run test:visual:goldens
npm run probe:launch
```

The launch probe is intentionally separate from inline behavioral validation. Exact own-golden screenshots require the recorded browser/font environment. They are not Microsoft VB6 reference screenshots.

See [Testing and validation](docs/TESTING.md) for release counts, reproducible commands and limits. The release packaging tools create a source manifest, independent SDK, browser distribution, examples, visual evidence and optional Git bundle. `tools/verify-release.py` freshly extracts the delivered source ZIP, rebuilds it, reruns tests, and checks SDK loading, history and archive integrity.

## Source layout

| Directory | Responsibility |
|---|---|
| `src/language`, `src/runtime`, `src/core` | Parsing, compilation, diagnostics, VM, host and value semantics |
| `src/controls`, `src/graphics`, `src/theme` | Browser controls, drawing and shared themes |
| `src/editor`, `src/ide`, `src/designer` | Editor services, workspace/tool windows and form editing |
| `src/project`, `src/exporter` | Project/native-text interchange, resource preservation and standalone export |
| `tools`, `tests`, `reports` | Reproducible build/package tools, regression tests and validation evidence |
| `examples`, `dist`, `docs` | Editable examples, built applications and documentation |

Generated runtime and diagnostics payloads are rebuilt from readable source modules. They are not substitutes for missing source. No `.git` directory is required to build; the optional history bundle preserves the repository and branches.

## Limits and documentation

Automatic checking covers the implemented parser/compiler, generally one primary parser error per module. It is not a full native semantic analyzer. Auto-checking is capped at 2,048 modules and 16 Mi UTF-16 source units; manual Check remains available. A fallback yields between modules, not inside a single long compile. Large-module input is windowed, but the canonical source is still one complete string. This is not a rope editor or proof of native performance equality.

IDE tool groups, code/form documents, modeless tools and toolbars can now detach into real top-level browser windows. Choose **Tools → Options → Docking → IDE window mode** for **In-page MDI only** or **MDI with optional browser windows**. In optional mode, use the ↗ caption button or **Float in Browser Window** command; see [Browser windows](docs/BROWSER-WINDOWS.md) for restoration, lifecycle and platform constraints. Native MDIForm/UserControl/UserDocument/report designers, type-library/add-in loading, unrestricted Edit and Continue, complete control APIs and native pixel fidelity remain unfinished. Hardware WebGPU, physical Safari/mobile devices and every IME/accessibility path are not certified. Automated browser-window coverage is documented separately; it is not certification of complete VB6 parity.

[User guide](docs/USER_GUIDE.md) · [Architecture / SDK embedding](docs/ARCHITECTURE.md) · [Compatibility](docs/COMPATIBILITY.md) · [Visual audit](docs/VISUAL-AUDIT.md) · [Release notes](docs/RELEASE-NOTES-0.6.0.md) · [Worktrees](docs/WORKTREES.md)

MIT-licensed original implementation. Visual Basic is a Microsoft trademark; this project is not Microsoft software or endorsed by Microsoft. Historical reconstruction evidence remains in `RECOVERY.md`; its old test failures and version marker describe the recovery snapshot, not this release.

## API-key coding agents

**Tools → AI Coding Agents…** opens a classic VB6 modeless MDI tool window, with the
existing bevels, title bar, tabs, menus, keyboard navigation and window layouts.
It runs coding tasks through **OpenAI Responses, Anthropic Messages, or Google
Gemini** using your API account. Refresh Models lists account-accessible models;
manual model IDs are also supported. No cloud requests are made until you request
model discovery or approve starting a task.

The agent uses the same 125 typed IDE operations as external coding agents:
project/source inspection, atomic multi-module edits, form/control/menu design,
compiler diagnostics, debugger/runtime control, public Data Environment definitions,
virtual files/resources, and workspace management. It is a real iterative tool-use loop, not just a chat box.
Streaming text, tool activity, before/after edit review, Stop, normal Undo,
request/tool/token limits and downloadable in-memory transcripts are included.

The **Task** tab now renders a live conversation with streaming replies, collapsible
tool steps, approval/interruption states, safe formatted text and copyable code.
Draft while the agent runs; Enter sends, Shift+Enter adds a line, and Jump to latest
resumes following after you scroll up. The new default is a cumulative **4 million
tokens per task**, with a **20 million** Large preset and independent output,
request, tool, context and timeout controls. Only numeric preferences can persist.
See [conversation rendering and session budgets](docs/CODING-AGENT-THREADS.md)
for limits, accounting and provider-capability caveats.

The classic **Tasks** tab supports eight independent named conversations, drafts
and cumulative usage. **Continue** explicitly resumes a limited task or retries
a transient provider request without replaying completed IDE operations. Local
plan and question tools provide structured progress and clarification; neither
grants permission. **New Task with Context…** lets you review/edit a public-message
excerpt before creating a fresh draft, without copying signatures, tools or grants.
Tasks stay memory-only and all operate on the same live project.

Review each change is the default. Read-only mode excludes mutators/execution;
Agent mode can authorize selected scopes for one run, up to ten minutes. These
permissions **never enable or inherit external MCP sharing**. Provider/API keys,
tasks, reasoning state and grants are not saved in projects, browser storage,
window-layout exports or shipped applications.

The optional `npm run agent:relay` keeps provider keys in local environment
variables; only a process-local relay token enters the browser. Direct API
mode is available for personal use after an explicit browser-key exposure warning.
See **[Coding agents: setup, workflows, security and validation](docs/coding-agents.md)**
for exact setup instructions, examples and limitations. Provider usage is billed
by your API account; no subscription login or bundled API credit is implied.

## MCP access for coding agents

Open **Tools → MCP Agent Access…** to expose this IDE to an external coding agent.
The IDE is an **MCP server only**: it does not connect to external MCP servers,
run their tools, perform OAuth sign-in, or launch configured stdio servers.

Its **125 structured tools** cover projects and source interchange, public Data
Environment definitions, bounded source reads, code edits,
compiler diagnostics, forms/controls/menus, resources and virtual files,
editor/workspace management, Object Browser, debugger/live edits and sandboxed
application interaction. The same server is bundled into the static app and
single-file HTML. Sharing is off by default. Changes require local approval or
explicitly authorized, scoped, project-bound permissions lasting 1–60 minutes.
Revisions, runtime guards, expiry, revocation and undo remain enforced.

For external HTTP or stdio agents, start the dependency-free Node.js relay:

```sh
npm run mcp:bridge -- --serve dist --allow-file --origin https://wieslawsoltes.github.io
```

Pair the browser using its **owner token**. Give the external agent only the
separate **client token**, with the `/mcp` endpoint or `tools/mcp-stdio.mjs` relay.
The companion only connects agents to this IDE; it cannot spawn arbitrary programs
or act as an outbound MCP gateway. Browser origin/local-network policy still applies.

[MCP setup and migration](docs/MCP.md) ·
[Coding-agent workflow and complete tool reference](docs/MCP-AGENTS.md)

The classic MCP dialog also has an **Operations** tab for local task cancellation
and build-download cleanup. Data definition edits have a separate, locally granted
**data** scope and do not execute SQL or access a runtime credential cache.

### Compiler/runtime compatibility workstream

The current development source adds computed branches and numbered error handling,
compile-time constant/Enum binding, exact Variant Decimal values, all thirteen
financial intrinsics, and string/whole-array corrections. These run in exported
standalone apps as well as the IDE. See [implemented contracts, limits and tests](docs/COMPILER-RUNTIME.md).
This is not a claim of complete native VB6 conformance.

## Windows executables

There are now three distinct build targets. **Direct Win32 AOT** emits a no-extraction x86 EXE using a JavaScript PE linker/code generator and real Windows controls. It is an experimental typed-integer subset, not a replacement for the complete browser VM. **Modern portable** embeds the Electron/WebGPU host and self-extracts. **Classic VB6** invokes a separately installed licensed compiler and uses the original runtime.

```sh
# JavaScript-only direct PE build: no npm dependencies or external compiler
npm run build:win32 -- --project examples/native/AotWindows.vb6web --out release/aot

# Existing WebGPU/DOM runtime packaged as a portable desktop app
npm --prefix desktop ci
npm run build:windows -- --project examples/calculator.vb6web --graphics auto

# Original licensed VB6 toolchain, on Windows
npm run build:classic -- --project examples/classic/HelloRuntime.vbp --codegen native
```

The browser's **File → Make <project>.exe (Win32 AOT)…** runs the direct compiler locally, including in the standalone HTML. `dist/vb6-native.js` is its independently usable browser/worker SDK. The direct target includes scalar stdcall Declares, native control HWNDs, genuine MDICLIENT/MDI child windows, modal loops and cancellable unload. It uses **GDI/native controls, not WebGPU**; unsupported types/instructions/controls fail compilation.

The desktop IDE now detaches and restores live tool/code panes through native windows, and its ARM64 portable build has been executed on a Windows ARM64 runner. This does not certify physical WebGPU: hosted x64/ARM64 tests explicitly exercised Canvas2D fallback. Classic compiler tests remain labelled mocks unless the separate licensed-toolchain job is run.

See [Direct Win32/AOT contract, examples and SDK](docs/WIN32-AOT.md), [all Windows targets](docs/WINDOWS-BUILDS.md), and [earlier desktop validation](docs/NATIVE-VALIDATION.md). Full VB6 AOT parity, all-GPU rendering, COM/OCX/full Declare ABI and existing-binary browser emulation remain unfinished.

## Original Visual Basic project files

Open `.vbp` projects and `.vbg` groups from complete selected files, folders or ZIPs, alongside existing browser snapshots. Save native source/companion files as a ZIP or to an explicitly selected directory, or keep a `.vb6web` snapshot with native metadata. Unchanged bytes, source encodings, hidden attributes, duplicate project settings and unknown companions are retained; unsafe or unsupported native edits fail rather than silently discard data. Project-group switching keeps peer edits and detects shared-file conflicts. See [Native project files](docs/NATIVE-PROJECTS.md) for usage, filesystem safeguards, encoding choices and the distinction between file preservation and native COM/runtime compatibility.


### Reusable Win32 browser compatibility

Browser IDE runs, the runtime SDK and published single-file HTML apps now share
[`@vb6/win32-browser`](packages/win32-browser/README.md), an independent,
zero-dependency MIT package. Version 0.3.0 registers 231 export names for
common kernel/memory/file/INI, registry, window/message/timer, clipboard, GDI and
safe URL operations. `Declare`, `Alias`, typed ByRef buffers, aligned UDTs,
`AddressOf` callbacks and runtime `hWnd` values are integrated without changing
the classic IDE layout. Memory DCs, writable DIBs, 15 raster operations, bitmap
blitting, alpha blending and complex region clipping are supported; forms and picture
boxes expose read-only `hDC`. Bitmap surfaces use an explicit Canvas2D fallback.
Try **Bitmap blitting** and **Region clipping** in **Win32 API Workbench**.
The region layer adds Boolean geometry, RGNDATA interchange, copied clips and
region painting. See the [GDI guide](packages/win32-browser/GDI.md) and
[region compatibility guide](packages/win32-browser/REGIONS.md).

This is a browser-compatible subset, not native DLL execution or full Win32
parity. Private files/registry/clipboard stay application-local; unsupported
APIs, flags, messages and ABI shapes fail explicitly. See the package's
[compatibility boundaries](packages/win32-browser/README.md#vb6-adapter) and
[API inventory](packages/win32-browser/API.md). `npm run pack:win32-browser`
builds and tests a standalone `.tgz` after `npm run build`; it does not publish to npm.
### Native workspace and interoperability

Native project support also includes explicit ZIP filename-codepage selection, preserved/restored VBW document windows, recoverable folder-save journals, exclusive immutable ZIP snapshots, trusted custom-control/Automation adapter registries, an opt-in x86/x64 Windows stdio host, and a separately licensed compiler round-trip harness. Native activation is never granted by opening a project. See [native workspace and interoperability](docs/NATIVE-WORKSPACE-INTEROP.md) for commands, deployment contracts, tests, and remaining boundaries.

## Scalar and Variant source compatibility

The source VM preserves scalar subtype and typed-versus-Variant origin through expressions, calls, storage, debugger inspection and file operations. Checked conversions, promotion, safe ByRef temporaries and sequential Input are covered by source regressions and fresh Windows Automation differential checks. See [Scalar compatibility and evidence](docs/SCALAR-COMPATIBILITY.md) for APIs, reproduction commands and explicit native/locale/certification boundaries.
