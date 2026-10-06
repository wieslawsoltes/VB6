# VB6 Studio Web

A browser-native classic Visual Basic development environment, source runtime and controls library. Built from HTML, CSS and JavaScript, with WebGPU drawing and Canvas2D fallback. Export edited projects as independent single HTML applications.

**Not a complete, native or pixel-identical Microsoft VB6 replacement.** See [Compatibility](docs/COMPATIBILITY.md) for supported behavior and limits, and [Testing](docs/TESTING.md) for validation evidence.

## Contents

- [Getting started](#getting-started)
- [IDE and form design](#ide-and-form-design)
- [Language, runtime and debugging](#language-runtime-and-debugging)
- [Controls and data sources](#controls-and-data-sources)
- [Project files and resources](#project-files-and-resources)
- [Build targets and reusable SDKs](#build-targets-and-reusable-sdks)
- [Coding agents](#coding-agents)
- [MCP access for external coding agents](#mcp-access-for-external-coding-agents)
- [Examples](#examples)
- [Build and test](#build-and-test)
- [Source layout](#source-layout)
- [Compatibility and documentation](#compatibility-and-documentation)
- [License](#license)

## Getting started

Requires **Node.js 22 or later**. The build has no npm package dependencies.

```sh
npm run build
npm run serve
```

Open the address printed by the server (default `http://127.0.0.1:8080`). After building, the complete IDE is also available as `dist/VB6-Studio-Web.html`, designed to open directly in a browser. Browser origin policies can restrict local files, clipboard or persistent storage; a local static server is the alternative. The packaged browser directory also works with a normal static host. No service, database or account is required by the application.

The initial Order Entry project is editable and runnable:

| Action | Command |
|---|---|
| Run the project | **F5** |
| Stop execution | **Shift+F5** |
| Export an independent application | **File → Make <project>.html…** |
| Download an editable `.vb6web` file | **Save Project** |

Save explicit project backups. Origin storage and layout persistence are best-effort browser facilities, not a replacement for downloaded backups.

The generated IDE/runtime bundles, embedded runtime payload and sample HTML apps are build artifacts rather than checked-in snapshots. Every build checks their exact bytes against `tools/ide-artifacts.json`. CI artifacts and the GitHub Pages build provide built applications. See [IDE build artifacts](docs/IDE-BUILD-ARTIFACTS.md).

## IDE and form design

### Workspace and editing

The IDE includes a modeless Object Browser, project search and atomic replacement, bookmarks, full/procedure/declarations and split source views, Project Explorer, Properties, Form Layout, designer/menu tools, classic menus/dialogs, MDI document management, customizable toolbars and independent debugger panes.

Same-project profiles and automatic workspace restoration reopen supported modeless tools and restore their geometry without opening unrelated project documents.

### IntelliSense

Classic List Members, List Constants, Complete Word, Quick Info and Parameter Info share typed resolution across source panes, Immediate, Watch and Evaluation fields. Nested `With`, arrays/default members, classes/UDTs/enums, runtime/data adapters and explicit portable reference metadata feed the same Object Browser. Automatic assistance never executes project code or opens a connection.

See [IntelliSense commands, reference descriptors, safety and validation](docs/INTELLISENSE.md). [Browser IntelliSense compatibility](docs/INTELLISENSE-COMPATIBILITY.md) covers WithEvents/interface handler dropdowns, labels, reference priority, strict metadata validation and DAO-specific typed chains. Native COM/OCX binary loading and Windows type-library registry discovery are not implied by code assistance.

### In-page MDI and browser windows

IDE tool groups, code/form documents, modeless tools and toolbars can detach into real top-level browser windows. Choose **Tools → Options → Docking → IDE window mode** for **In-page MDI only** or **MDI with optional browser windows**. In optional mode, use the ↗ caption button or **Float in Browser Window** command.

See [Browser windows](docs/BROWSER-WINDOWS.md) for restoration, lifecycle, platform constraints and automated coverage.

### Themes

Windows Classic, Windows Standard (2000), and High Contrast Black remain available. IDE appearance is independent of the exported application's theme. System colors resolve through the theme; authored RGB colors are retained.

**Tools → Options → General → Appearance → IDE theme** also offers **Fluent WinUI 3**, **macOS 26**, **X11 Motif** and **X11 CDE**, each in light and dark variants. Classic VB6 remains the default. Themes cover IDE chrome, controls, dialogs, tools, editors, debugger and agent/MCP surfaces, including live detached windows. System light/dark matching and reduced transparency/motion are optional; authored application forms and exported runtimes keep their own appearance. See [IDE themes, scope and validation](docs/IDE-THEMES.md).

### Optional anchoring and automatic layout

Enable **Tools → Options → General → Layout Extensions → Enable anchoring and automatic layout (this project)** to expose Windows Forms-style edge anchoring, docking and flow layout in the classic designer, Properties, code and exports. The extension is **off and hidden by default**.

The reusable, dependency-free `@vb6/auto-layout` package includes ES module/browser builds and TypeScript declarations. See [the layout guide](docs/anchoring-layout.md) and [standalone package](packages/auto-layout/README.md) for semantics, export compatibility and validation.

## Language, runtime and debugging

### Compiler and source runtime

The compiler and cooperative VM execute VB-style source through their own instruction model, not JavaScript eval of user VB text. Supported features include procedures/classes/properties, named and optional arguments, ByRef paths, instance static storage, arrays and records, control flow and error handling, events, exact backed Currency, distinct Empty/Null/Nothing/Missing/Error values, calendar helpers and private binary/text files.

Language support also includes module-scoped DefType declarations, validated project-defined interfaces, contract dispatch and default-member attributes, computed branches and numbered error handling, compile-time constant/Enum binding, exact Variant Decimal values, all thirteen financial intrinsics, and string/whole-array operations. These run in exported standalone apps as well as the IDE.

See [Compiler/runtime contracts, limits and tests](docs/COMPILER-RUNTIME.md). The [compatibility matrix](docs/COMPATIBILITY.md) identifies incomplete coercion, lifetime and binding semantics; this is not a claim of complete native VB6 conformance.

### Scalar and Variant compatibility

The source VM preserves scalar subtype and typed-versus-Variant origin through expressions, calls, storage, debugger inspection and file operations. Checked conversions, promotion, safe ByRef temporaries and sequential Input are covered by source regressions and Windows Automation differential checks.

See [Scalar compatibility and evidence](docs/SCALAR-COMPATIBILITY.md) for APIs, reproduction commands and explicit native/locale/certification boundaries.

### Runtime MDI

Runtime MDI supports a single MDIForm, independent child instances, active-window tracking, move/resize, min/max/restore, cascade/tiling, WindowList menus and coordinated cancellable unloading. The MDI Resource Workspace example demonstrates these capabilities.

### Debugger and execution control

The classic debugger includes conditional breakpoints, statement-level stepping and source highlighting, all three Error Trapping modes, recoverable error breaks with retained live frames, scoped break watches, caller-frame inspection, typed variable edits, Quick Watch, bounded value trees, guarded watch evaluation, Immediate assignment, column-aware Run to Cursor and bounded Set Next Statement.

Explicit paused user-function evaluation supports a selected caller frame, cancellation, instruction/time limits, evaluated dialogs and restoration of debugger/error state. Automatic watches remain side-effect-free.

Compatible paused source edits use bounded instruction remapping for eligible straight-line insertions/deletions while preserving paused locals and caller continuation. Unsafe changes require restart. These are browser implementations, not arbitrary native debugger capabilities.

See the [debugger guide](docs/DEBUGGER.md) for shortcuts, runtime APIs, validation and remaining compatibility limits.

## Controls and data sources

### Browser controls and OCX interoperability

There are 37 offered browser control types, including classic intrinsic-style controls and TreeView, ListView, RichTextBox, grids, tabs, toolbars, calendars, charts and file-dialog adapters. Familiar names do not imply full native API coverage. In-memory recordsets are not external ADO/DAO providers.

Installed COM/OCX execution is available only through the explicitly granted Windows companion; it is not native-binary execution inside the browser. Arbitrary add-ins and universal native API compatibility are not implemented. See [OCX designer, runtime adapters and Windows hosting](docs/OCX-SUPPORT.md) for events, property pages, persistence, licensing and precise boundaries.

### Data connections and binding

Classic Data Environment/Data View and Data Link Properties share a provider-backed ADO-style layer with exported HTML/Electron apps. Use embedded offline **SQLite**, **REST CRUD**, **OData**, **GraphQL**, **JSON/CSV**, or an authenticated native gateway for PostgreSQL, MySQL, SQL Server and installed OLE DB/ODBC providers. Four runnable examples demonstrate SQLite editing and modern HTTP data sources.

See [Data sources, examples and deployment](docs/DATA-SOURCES.md) for the compatibility matrix, connection dialogs, binding, credentials and gateway setup. This is not exhaustive native VB6/ADO/DAO/RDO parity; installed native providers and the PE32 AOT compiler have separate deployment boundaries.

## Project files and resources

### Original Visual Basic projects

Open `.vbp` projects and `.vbg` groups from complete selected files, folders or ZIPs, alongside existing browser snapshots. Save native source/companion files as a ZIP or to an explicitly selected directory, or keep a `.vb6web` snapshot with native metadata.

Unchanged bytes, source encodings, hidden attributes, duplicate project settings and unknown companions are retained. Unsafe or unsupported native edits fail rather than silently discard data. Project-group switching keeps peer edits and detects shared-file conflicts.

See [Native project files](docs/NATIVE-PROJECTS.md) for usage, filesystem safeguards, encoding choices and the distinction between file preservation and native COM/runtime compatibility.

### Native workspace and interoperability

Native project support includes explicit ZIP filename-codepage selection, preserved/restored VBW document windows, recoverable folder-save journals, exclusive immutable ZIP snapshots, trusted custom-control/Automation adapter registries, an opt-in x86/x64 Windows stdio host, and a separately licensed compiler round-trip harness. Native activation is never granted by opening a project.

See [Native workspace and interoperability](docs/NATIVE-WORKSPACE-INTEROP.md) for commands, deployment contracts, tests and remaining boundaries.

### Resources

The modeless Resource Editor supports native Win32 `.res` string/binary import and export, byte preservation and VBP `ResFile32` integration. Runtime resource functions include `LoadResString`, typed `LoadResData` and supported `LoadResPicture`.

## Build targets and reusable SDKs

### Standalone HTML applications

Export edited projects with **File → Make <project>.html…**. Each generated HTML application embeds its own runtime; the IDE is not required to run it. See [Architecture / SDK embedding](docs/ARCHITECTURE.md) for reusable runtime integration.

### Windows executables

| Target | Output and execution model |
|---|---|
| **Direct Win32 AOT** | A no-extraction x86 EXE using a JavaScript PE linker/code generator and real Windows controls. An experimental typed-integer subset, not a replacement for the complete browser VM. |
| **Modern portable** | An embedded Electron/WebGPU host that self-extracts. |
| **Classic VB6** | A build using a separately installed licensed compiler and the original runtime. |

```sh
# JavaScript-only direct PE build: no npm dependencies or external compiler
npm run build:win32 -- --project examples/native/AotWindows.vb6web --out release/aot

# WebGPU/DOM runtime packaged as a portable desktop app
npm --prefix desktop ci
npm run build:windows -- --project examples/calculator.vb6web --graphics auto

# Original licensed VB6 toolchain, on Windows
npm run build:classic -- --project examples/classic/HelloRuntime.vbp --codegen native
```

The browser's **File → Make <project>.exe (Win32 AOT)…** runs the direct compiler locally, including in the standalone HTML. `dist/vb6-native.js` is its independently usable browser/worker SDK. The direct target includes scalar stdcall Declares, native control HWNDs, genuine MDICLIENT/MDI child windows, modal loops and cancellable unload. It uses **GDI/native controls, not WebGPU**; unsupported types/instructions/controls fail compilation.

The desktop IDE detaches and restores live tool/code panes through native windows, and its ARM64 portable build has been executed on a Windows ARM64 runner. This does not certify physical WebGPU: hosted x64/ARM64 tests explicitly exercised Canvas2D fallback. Classic compiler tests remain labelled mocks unless the separate licensed-toolchain job is run.

See [Direct Win32/AOT contract, examples and SDK](docs/WIN32-AOT.md), [Windows targets](docs/WINDOWS-BUILDS.md), and [Desktop validation](docs/NATIVE-VALIDATION.md). Full VB6 AOT parity, all-GPU rendering, COM/OCX/full Declare ABI and existing-binary browser emulation remain unfinished.

### Reusable Win32 browser compatibility

Browser IDE runs, the runtime SDK and published single-file HTML apps share [`@vb6/win32-browser`](packages/win32-browser/README.md), an independent, zero-dependency MIT package. It provides common kernel/memory/file/INI, registry, window/message/timer, clipboard, GDI and safe URL operations.

`Declare`, `Alias`, typed ByRef buffers, aligned UDTs, `AddressOf` callbacks and runtime `hWnd` values are integrated without changing the classic IDE layout.

**Graphics and GDI.** Memory DCs, writable DIBs, 15 raster operations, bitmap blitting, alpha blending and complex region clipping are supported; forms and picture boxes expose read-only `hDC`. Bitmap surfaces use an explicit Canvas2D fallback. The region layer includes Boolean geometry, RGNDATA interchange, copied clips and region painting.

Advanced GDI support covers curved/polygon/path regions, transforms, memory-DC fonts, owned window shapes and paint/update lifecycles. GDI rasters can use the reusable WebGPU texture presenter with an explicit Canvas2D fallback. Try **Bitmap blitting**, **Region clipping**, and **Paths and text** in **Win32 API Workbench**.

See the [GDI guide](packages/win32-browser/GDI.md), [Region compatibility guide](packages/win32-browser/REGIONS.md), and [Advanced GDI contracts and measured boundaries](packages/win32-browser/ADVANCED-GDI.md).

**Common services.** Beyond graphics, the package supports file discovery, shell paths, UTF-8/Windows-1252 conversion, private environment expansion, cooperative events/semaphores, GUID values, Base64, registry enumeration, atoms and window properties. Six classic VB6 samples are included in the Examples menu and standalone HTML builds. See [Service contracts, samples and isolation boundaries](packages/win32-browser/SERVICES.md).

This is a browser-compatible subset, not native DLL execution or full Win32 parity. Private files/registry/clipboard stay application-local; unsupported APIs, flags, messages and ABI shapes fail explicitly. Full native raster/font certification is not claimed. See the package's [compatibility boundaries](packages/win32-browser/README.md#vb6-adapter) and [API inventory](packages/win32-browser/API.md).

`npm run pack:win32-browser` builds and tests a standalone `.tgz` after `npm run build`; it does not publish to npm.

## Coding agents

**Tools → AI Coding Agents…** opens a classic VB6 modeless MDI tool window, with the existing bevels, title bar, tabs, menus, keyboard navigation and window layouts.

### Connections and setup

API-key connections run coding tasks through **OpenAI Responses, Anthropic Messages, or Google Gemini** using your API account. Refresh Models lists account-accessible models; manual model IDs are also supported. No cloud requests are made until you request model discovery or approve starting a task.

The optional `npm run agent:relay` keeps provider keys in local environment variables; only a process-local relay token enters the browser. Direct API mode is available for personal use after an explicit browser-key exposure warning. API usage is billed by your API account; no bundled API credit is implied.

The OpenAI connection also offers **ChatGPT account — ChatGPT plan usage** alongside API-key mode. The supported local/open-source OAuth flow runs through the protected local agent relay; no Codex credential copying or API-key fallback is used. Account selection, sign-in/consent, model discovery, streaming IDE tools, refresh and sign-out retain the classic IDE appearance and permission checks. Live-account entitlement/inference validation is separate from the deterministic test fixtures.

See [Coding agents: setup, workflows, security and validation](docs/coding-agents.md) and [ChatGPT sign-in setup, security and preview limitations](docs/CHATGPT-LOGIN.md).

### IDE operations and permissions

The agent uses the same 125 typed IDE operations as external coding agents: project/source inspection, atomic multi-module edits, form/control/menu design, compiler diagnostics, debugger/runtime control, public Data Environment definitions, virtual files/resources, and workspace management. It is a real iterative tool-use loop, not just a chat box. Streaming text, tool activity, before/after edit review, Stop, normal Undo, request/tool/token limits and downloadable in-memory transcripts are included.

The composer offers **Ask for approval, Read only, Plan, Auto edit, Full IDE access, and Custom** profiles. Scope and exact-tool Allow/Ask/Deny rules, run-only approvals, explicit full-access acknowledgement, lease expiry and revoke controls are enforced by the IDE tool adapter. Full IDE access is not unrestricted host shell/disk/network access. See [Permission profiles](docs/CODING-AGENT-PERMISSIONS.md).

Review each change is the default. Read-only mode excludes mutators/execution; Agent mode can authorize selected scopes for one run, up to ten minutes. These permissions **never enable or inherit external MCP sharing**. Provider/API keys, tasks, reasoning state and grants are not saved in projects, browser storage, window-layout exports or shipped applications.

### Conversations and session budgets

The **Task** tab renders a live conversation with streaming replies, collapsible tool steps, approval/interruption states, safe formatted text and copyable code. Draft while the agent runs; Enter sends, Shift+Enter adds a line, and Jump to latest resumes following after you scroll up.

The default is a cumulative **4 million tokens per task**, with a **20 million** Large preset and independent output, request, tool, context and timeout controls. Only numeric preferences can persist. See [Conversation rendering and session budgets](docs/CODING-AGENT-THREADS.md) for limits, accounting and provider-capability caveats.

The classic **Tasks** tab supports eight independent named conversations, drafts and cumulative usage. **Continue** explicitly resumes a limited task or retries a transient provider request without replaying completed IDE operations. Local plan and question tools provide structured progress and clarification; neither grants permission.

**New Task with Context…** lets you review/edit a public-message excerpt before creating a fresh draft, without copying signatures, tools or grants. Tasks stay memory-only and all operate on the same live project.

### Recovery and context compaction

Recovery includes bounded transient-request retries, **Compact context** and the local **`/compact`** command. Automatic checkpoints start at a configurable 64,000 estimated/reported input tokens by default; this active-context threshold is separate from cumulative billed usage.

Checkpoints preserve the exact goal and latest request, with recent complete native turns, and never replay edits, reset usage, or renew permissions. See [Recovery, checkpoints and Codex CLI comparison](docs/CODING-AGENT-RECOVERY.md).

### Local change review and follow-ups

The classic agent **Changes** tab compares current module source/designer state against task-start or latest-run checkpoints, with bounded diffs, patch export, line-targeted feedback and revision-checked source-only restoration through normal Undo.

**Queue message** stores follow-ups locally while generation runs. Queue supports editing/reordering and explicit fresh-confirmation dispatch without replacing unsent composer drafts or inheriting Full-access grants. Nothing sends automatically.

The Changes tab also supports individually restoring changed source blocks with normal Undo, explicit stale-review warnings, and task-local review/queue selections. See [The workbench guide](docs/CODING-AGENT-WORKBENCH.md) for coverage, memory limits, stale-workspace protection and non-Git boundaries.

## MCP access for external coding agents

Open **Tools → MCP Agent Access…** to expose this IDE to an external coding agent. The IDE is an **MCP server only**: it does not connect to external MCP servers, run their tools, perform OAuth sign-in, or launch configured stdio servers.

Its **125 structured tools** cover projects and source interchange, public Data Environment definitions, bounded source reads, code edits, compiler diagnostics, forms/controls/menus, resources and virtual files, editor/workspace management, Object Browser, debugger/live edits and sandboxed application interaction. The same server is bundled into the static app and single-file HTML.

Sharing is off by default. Changes require local approval or explicitly authorized, scoped, project-bound permissions lasting 1–60 minutes. Revisions, runtime guards, expiry, revocation and undo remain enforced.

For external HTTP or stdio agents, start the dependency-free Node.js relay:

```sh
npm run mcp:bridge -- --serve dist --allow-file --origin https://wieslawsoltes.github.io
```

Pair the browser using its **owner token**. Give the external agent only the separate **client token**, with the `/mcp` endpoint or `tools/mcp-stdio.mjs` relay. The companion only connects agents to this IDE; it cannot spawn arbitrary programs or act as an outbound MCP gateway. Browser origin/local-network policy still applies.

The classic MCP dialog also has an **Operations** tab for local task cancellation and build-download cleanup. Data definition edits have a separate, locally granted **data** scope and do not execute SQL or access a runtime credential cache.

See [MCP setup and migration](docs/MCP.md) and [Coding-agent workflow and complete tool reference](docs/MCP-AGENTS.md).

## Examples

`dist/examples/` contains Order Entry, Calculator, Clock, Graphics Lab, Data Browser, Common Controls, Language Lab, Event Workbench, Rich Text Editor, Runtime Workbench and MDI Resource Workspace. Editable counterparts are in `examples/`. Each generated HTML app embeds its own runtime; the IDE is not required to run it.

Additional data-source and Win32 samples are described in the [data-source guide](docs/DATA-SOURCES.md) and [Win32 services guide](packages/win32-browser/SERVICES.md).

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

**Launch verification boundary:** the documented validation environment blocked direct file navigation and localhost HTTP navigation with `ERR_BLOCKED_BY_ADMINISTRATOR` before application startup. The emitted HTML and exported apps were tested through inline Chromium loading. Blocked probes are recorded separately, not represented as successful launch tests.

See [Testing and validation](docs/TESTING.md) for reproducible commands, evidence and limits. Packaging tools create a source manifest, independent SDK, browser distribution, examples, visual evidence and optional Git bundle. `tools/verify-release.py` freshly extracts the delivered source ZIP, rebuilds it, reruns tests, and checks SDK loading, history and archive integrity.

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

## Compatibility and documentation

Automatic checking covers the implemented parser/compiler, generally one primary parser error per module. It is not a full native semantic analyzer. Auto-checking is capped at 2,048 modules and 16 Mi UTF-16 source units; manual Check remains available. A fallback yields between modules, not inside a single long compile. Large-module input is windowed, but the canonical source is still one complete string. This is not a rope editor or proof of native performance equality.

Native MDIForm/UserControl/UserDocument/report designers, type-library/add-in loading, unrestricted Edit and Continue, complete control APIs and native pixel fidelity remain unfinished. Hardware WebGPU, physical Safari/mobile devices and every IME/accessibility path are not certified. Automated browser-window coverage is documented separately; it is not certification of complete VB6 parity.

| Guide | Topics |
|---|---|
| [User guide](docs/USER_GUIDE.md) | IDE workflows and application usage |
| [Architecture / SDK embedding](docs/ARCHITECTURE.md) | Source architecture and reusable components |
| [Compatibility](docs/COMPATIBILITY.md) | Supported behavior and explicit boundaries |
| [Testing and validation](docs/TESTING.md) | Reproducible checks and validation evidence |
| [Visual audit](docs/VISUAL-AUDIT.md) | Visual coverage and fidelity limits |
| [Worktrees](docs/WORKTREES.md) | Development worktree documentation |

## License

MIT-licensed original implementation. Visual Basic is a Microsoft trademark; this project is not Microsoft software or endorsed by Microsoft.
