# VB6 Studio Web 0.6.0

A browser-native classic Visual Basic development environment, source runtime and controls library. Built from HTML, CSS and JavaScript, with WebGPU drawing and Canvas2D fallback. Export edited projects as independent single HTML applications.

**New in 0.6:** runtime MDI forms/child windows and a working example; project-defined interfaces/default members and DefType declarations; explicit cancellable paused function evaluation; broader mapped live editing; native .res import/export, runtime resource functions and a modeless Resource Editor; modeless-tool restoration in workspace profiles.

**Not a complete, native or pixel-identical Microsoft VB6 replacement.** Detailed supported behavior and limits are in [Compatibility](docs/COMPATIBILITY.md), with [release notes](docs/RELEASE-NOTES-0.6.0.md) and [validation](docs/TESTING.md).

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

Requires Node.js 22 or later. The browser build has no npm package dependencies:

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
| `desktop` | JavaScript native host, secure bridge and portable executable packaging dependencies |
| `tools`, `tests`, `reports` | Reproducible build/package tools, regression tests and validation evidence |
| `examples`, `dist`, `docs` | Editable examples, built applications and documentation |

Generated runtime and diagnostics payloads are rebuilt from readable source modules. They are not substitutes for missing source. No `.git` directory is required to build; the optional history bundle preserves the repository and branches.

## Limits and documentation

Automatic checking covers the implemented parser/compiler, generally one primary parser error per module. It is not a full native semantic analyzer. Auto-checking is capped at 2,048 modules and 16 Mi UTF-16 source units; manual Check remains available. A fallback yields between modules, not inside a single long compile. Large-module input is windowed, but the canonical source is still one complete string. This is not a rope editor or proof of native performance equality.

IDE tool groups, code/form documents, modeless tools and toolbars can now detach into real top-level browser windows. Use the ↗ caption button or **Float in Browser Window** command; see [Browser windows](docs/BROWSER-WINDOWS.md) for restoration, lifecycle and platform constraints. Native MDIForm/UserControl/UserDocument/report designers, type-library/add-in loading, unrestricted Edit and Continue, complete control APIs and native pixel fidelity remain unfinished. Hardware WebGPU, physical Safari/mobile devices and every IME/accessibility path are not certified. Automated browser-window coverage is documented separately; it is not certification of complete VB6 parity.

[User guide](docs/USER_GUIDE.md) · [Architecture / SDK embedding](docs/ARCHITECTURE.md) · [Compatibility](docs/COMPATIBILITY.md) · [Visual audit](docs/VISUAL-AUDIT.md) · [Release notes](docs/RELEASE-NOTES-0.6.0.md) · [Worktrees](docs/WORKTREES.md)

MIT-licensed original implementation. Visual Basic is a Microsoft trademark; this project is not Microsoft software or endorsed by Microsoft. Historical reconstruction evidence remains in `RECOVERY.md`; its old test failures and version marker describe the recovery snapshot, not this release.

## Windows executables

Two JavaScript-driven build targets are available: **modern Windows portable EXEs** with a bundled Electron/WebGPU host and native form windows, and **classic VB6 runtime EXEs** built by a separately installed licensed `VB6.EXE` compiler. See [Windows builds](docs/WINDOWS-BUILDS.md) for commands, architecture, validation and compatibility boundaries.

```sh
npm --prefix desktop install
npm run build:windows -- --project examples/calculator.vb6web
npm run build:classic -- --project examples/classic/HelloRuntime.vbp --codegen native
```

The modern portable EXE extracts its embedded runtime at launch. The classic EXE depends on the external 32-bit VB6 runtime and any project-specific OCX/COM components. Neither is advertised as a no-extraction, no-dependency implementation.
