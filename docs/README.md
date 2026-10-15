# Build and maintenance documentation

Start with the [repository quick start](../README.md#getting-started), then use
this index for the contracts needed to build, maintain and extend the project.
These guides describe the implemented system, not complete native VB6 parity.

## Build, test and architecture

- [Validation and deployment](CI.md): consolidated workflows, parallel suite ownership, failure gates and publication security.

- [Architecture and SDK embedding](ARCHITECTURE.md): module boundaries, execution,
  persistence and extension points.
- [Application export](APPLICATION-EXPORT.md): deployment APIs, modular output, CSP and validation.
- [Direct macOS AOT export](MACOS-DIRECT-AOT.md): offline ARM64 executable export,
  reusable Win32 infrastructure, application signing and SDK maintenance.
- [macOS distribution](MACOS-DISTRIBUTION.md): trusted local Developer ID signing,
  Hardened Runtime, entitlement approval, notarization and final-archive verification.
- [Native macOS export](MACOS-EXPORT.md): Apple Silicon compiler, AppKit runtime,
  approved local builds, source kits, reusable APIs and compatibility boundaries.
- [Native macOS resources and pictures](MACOS-RESOURCES.md): RES/FRX imports,
  resource functions, picture ownership, cursor metadata and sealed bundle data.
- [Native macOS arrays](MACOS-ARRAYS.md): typed result storage, value ownership,
  ReDim, helper ABI and executable acceptance.
- [Native macOS lifetime and editing](MACOS-LIFETIME-EDITING.md): reference release,
  finalizer safe points, live AppKit text, selection and list ownership contracts.
- [Build artifacts](IDE-BUILD-ARTIFACTS.md): source-only builds, exact fingerprints
  and safe regeneration when integrating changes.
- [Testing](TESTING.md): setup, reproducible checks and validation boundaries.
- [Build tools](../tools/README.md) and [test scope](../tests/README.md): maintained
  entry points, fixtures and cleanup rules.
- [Compatibility](COMPATIBILITY.md) and [user guide](USER_GUIDE.md): supported
  behavior, deliberate limits and workflows to preserve.

## Language, runtime and project files

- [Language frontend](LANGUAGE-FRONTEND.md): scanning, declarations and diagnostics.
- [Procedure-local storage](LANGUAGE-LOCAL-STORAGE.md): skipped declarations, local scope,
  per-invocation initialization, Static lifetime and metadata-only declaration plans.
- [Circular record dependencies](LANGUAGE-RECORD-RECURSION.md): declaration-cycle diagnostics,
  iterative graph analysis and cached provider edits.
- [Array storage, source properties and Like](LANGUAGE-ARRAYS-LIKE.md): binding, ownership,
  matcher bounds, runtime semantics and explicit export limitations.
- [VB.NET / .NET 10 migration](VBNET-MIGRATION.md): source conversion, ZIP export,
  reusable packages, compatibility runtime, extensions and conformance gates.
- [VB.NET language and record lowering](VBNET-LANGUAGE-LOWERING.md): independent
  property accessors, exact optional defaults, binary layouts and dispatch boundaries.
- [Native-first VB.NET output and support policies](VBNET-NATIVE-FIRST.md).
- [Compiler/runtime](COMPILER-RUNTIME.md) and [scalar/Variant semantics](SCALAR-COMPATIBILITY.md).
- [Source debugger](DEBUGGER.md), [extended debugger contracts](DEBUGGER-COMPATIBILITY.md),
  [native break lifecycle](NATIVE-DEBUGGER-BREAK-LIFECYCLE.md) and
  [preview lifecycle](NATIVE-PREVIEW-LIFECYCLE.md).
- [Native project interchange](NATIVE-PROJECTS.md) and
  [workspace, save recovery and interoperability](NATIVE-WORKSPACE-INTEROP.md).
- [Data sources](DATA-SOURCES.md): providers, binding, credentials and deployment.
- [HTML5 WebBrowser](WEBBROWSER.md): classic navigation/events, isolated DOM automation,
  designer integration, HTML exports and native compatibility boundaries.
- [Common Automation](COMMON-AUTOMATION.md): HTTP/XML/ADO stream objects, shared data
  transport, virtual files, recordset binding and deployment examples.
- [Keyboard/mouse events](INPUT-EVENTS.md) and [optional automatic layout](anchoring-layout.md).

## IDE, appearance and rendering

- [Form designer and SSTab editing](DESIGNER-SUPPORT.md): native tab imports,
  atomic property/collection editors, shared control capabilities and explicit boundaries.

- [Optional Figma workspace](figma-workspace.md): real VB6 Assets/Layers/Design,
  reversible workspace profiles, canvas navigation, auto layout and anchoring.
- [Figma paint publication](figma-presentation.md): retained-renderer transactions,
  native/canvas synchronization and composited-pixel regression gates.
- [Optional advanced editor](ADVANCED-EDITOR.md): minimap, source navigation, split views,
  safe debugger data tips, VB6/XAML language servers, lifecycle and deployment.

- [Optional XAML form authoring](XAML.md): standalone compiler, source editor,
  designer/Properties synchronization, persistence and conversion boundaries.

- [IntelliSense](INTELLISENSE.md) and [resolution/reference contracts](INTELLISENSE-COMPATIBILITY.md).
- [Auto Layout designer](auto-layout-designer.md): opt-in panel, canvas interaction,
  shared solver and export boundaries.
- [Detached browser windows](BROWSER-WINDOWS.md).
- [HTML retention and designer measurements](HTML-RENDERING-PERFORMANCE.md): DOM identity, read-before-write batching and browser validation.
- [UI rendering backends](RENDERING.md): settings, native islands, lifecycle,
  performance measurement and strict acceptance; [rendering source attribution](RENDERING-SOURCES.md).
- [GPU startup and recovery](RENDERING-TROUBLESHOOTING.md): adapter/context failures,
  live diagnostics, saved-policy retry and environment limitations.
- [IDE themes](IDE-THEMES.md), [application themes](APPLICATION-THEMES.md) and
  [matching icon packs](THEME-ICON-PACKS.md).
- [macOS 26 visual fidelity](MACOS-THEME-FIDELITY.md): component states, native references,
  authored-layout preservation and measured comparison boundaries.

- [WinUI 3 resource fidelity](WINUI-PARITY.md): pinned resources, component states,
  boundary isolation, validation and native-pixel limits.
- [X11 fidelity](X11-THEME-FIDELITY.md): Motif-inspired paint/state contracts,
  pixel checks, isolation and native-reference certification boundaries.
- [Classic icons](ICON-AUDIT.md), [classic HTML rendering and attribution](CLASSIC-HTML-RENDERING.md)
  and [visual validation](VISUAL-AUDIT.md).

## Windows compilation and native services

- [Windows build targets](WINDOWS-BUILDS.md), [target validation](NATIVE-VALIDATION.md),
  [native compiler and optimizer](native-compiler-optimization.md),
  [direct Win32 AOT](WIN32-AOT.md) and [export troubleshooting](WIN32-EXPORT-TROUBLESHOOTING.md).
- [Private native services](WIN32-PRIVATE-SERVICES.md): demand-driven linkage, pointer primitives and owned-frame performance.
- [Native strings and control metadata](NATIVE-STRING-METADATA.md): counted BSTRs,
  Replace/InStr binding, Tag/Name lifetime and HWND-backed TabStop.
- [Win32 controls](WIN32-CONTROLS.md): native AOT control coverage, property and stream ownership, layout integration, output dependencies and Windows execution checks.
- [Runtime intrinsic controls](WIN32-DYNAMIC-CONTROLS.md): owned HWND references, sparse control arrays, generation-safe creation and native callbacks.
- [Typed source events](WIN32-EVENTS.md): synchronous WithEvents/RaiseEvent, reentrant delivery and subscription ownership.
- [Independent native Forms and MDI](WIN32-FORM-INSTANCES.md): per-instance HWND/control state, embedded interface ownership, cancellation and admission limits.
- [Native Recordset/grid binding](WIN32-DATA-BINDING.md): owned snapshots, source cursor preservation, atomic publication and bounded bulk conversion.
- [Native external Automation](WIN32-AUTOMATION.md): real IDispatch calls, argument ABI, ownership and COM errors.
- [Native InputBox](WIN32-INPUTBOX.md): Unicode modal dialogs, argument snapshots, callback lifetime and Windows acceptance.
- [Typed native classes](WIN32-CLASSES.md): instance ownership, properties, runtime member dispatch and counted String mutation.
- [Native drawing surfaces](WIN32-SURFACES.md): Form/PictureBox hDC ownership, retained backing, painting, scaling and failure cleanup.
- [Native RichEdit selection and search](WIN32-RICHEDIT.md): mixed-format masks, Unicode search, line lookup and undo/redo.
- [Native grids, charts and tab pages](WIN32-GRIDS-CHARTS-TABS.md): storage, editing, GDI, ownership and execution gates.
- AOT language/ABI contracts: [numeric storage](WIN32-NUMERIC.md),
  [Currency](WIN32-CURRENCY.md), [Date](WIN32-DATES.md),
  [calendar intervals](WIN32-CALENDAR-INTERVALS.md), [arrays](WIN32-ARRAYS.md),
  [calls](WIN32-CALLS.md), [Variants and ParamArray](WIN32-VARIANTS.md),
  [bindings](WIN32-BINDINGS.md),
  [callbacks](WIN32-CALLBACKS.md) and [String interop](WIN32-STRING-INTEROP.md).
- [COM/OLE services and reusable packages](COM-OLE.md): portable contracts, VB GetObject,
  native data/storage services, ownership, explicit permissions and support boundaries.
- Native Automation: [startup/deadlines](NATIVE-AUTOMATION-STARTUP.md),
  [typed scalars](NATIVE-SCALAR-INTEROP.md) and [DATE transport](NATIVE-DATE-TRANSPORT.md).
- OCX: [setup and support](OCX-SUPPORT.md), [container contracts](OCX-CONTAINER-CONTRACTS.md),
  [active objects](OCX-ACTIVE-OBJECT.md) and [property browsing](OCX-PROPERTY-BROWSING.md)
  and [source PropertyPages](OCX-SOURCE-PROPERTY-PAGES.md).

## Coding agents and automation

- [Coding-agent setup and APIs](coding-agents.md), [permissions](CODING-AGENT-PERMISSIONS.md),
  [conversation/session budgets](CODING-AGENT-THREADS.md),
  [error recovery and compaction](CODING-AGENT-RECOVERY.md) and
  [change review/workbench](CODING-AGENT-WORKBENCH.md).
- [ChatGPT account setup](CHATGPT-LOGIN.md) and [sign-in troubleshooting](CHATGPT-SIGNIN-TROUBLESHOOTING.md).
- [MCP server setup and security](MCP.md) and [agent tool reference](MCP-AGENTS.md).

## Independently reusable packages

Package READMEs own their API, installation and compatibility details:
[optional advanced editor](../packages/advanced-editor/README.md),
[automatic layout](../packages/auto-layout/README.md),
[XAML compiler and language services](../packages/xaml-compiler/README.md),
[Win32 browser compatibility](../packages/win32-browser/README.md),
[portable COM/OLE](../packages/com-ole/README.md),
[Automation values and adapters](../packages/automation/README.md),
[native COM/OLE companion](../packages/native-automation/README.md),
[native debugger](../packages/native-debugger/README.md),
[Apple Silicon compiler and AppKit runtime](../packages/macos-native/README.md) and
[optional compute compiler/runtime](../packages/vb6-compute/README.md).

## Maintaining these docs

Keep actionable setup, architecture, API/ABI contracts, security and lifetime
rules, compatibility limits, reproduction commands and required attribution.
Update the owning guide when behavior changes; add a separate guide only for a
substantial contract and link it here. Keep implementation tests with the code.

Do not add dated continuation logs, recovered-source inventories, worktree
transcripts, duplicate release notes or copies of passing test totals. Git
history and pull requests retain change provenance; CI artifacts retain
revision-specific logs and measurements. A historical pass is not validation of
a later revision. Preserve useful contracts in their owning guide before
removing a superseded document, and update links and packaging inputs together.
The [porting index](../reports/README.md) links maintained compatibility trackers;
generated run evidence does not belong in the source documentation.

## Compatibility reference sources

Official descriptions inform implementation, not certification. Shared VBA
language and Win32 behavior are not an exact licensed VB6 differential oracle.
No proprietary fonts, icons or runtime binaries are redistributed.

- Microsoft, Implements statement (shared VBA/Classic VB syntax): https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/implements-statement
- Microsoft, DefType statements: https://learn.microsoft.com/en-us/office/vba/language/concepts/getting-started/deftype-statements
- Microsoft, RESOURCEHEADER: https://learn.microsoft.com/en-us/windows/win32/menurc/resourceheader
- Microsoft, STRINGTABLE resource: https://learn.microsoft.com/en-us/windows/win32/menurc/stringtable-resource
- Microsoft, WM_MDICASCADE (Win32 window behavior, not browser parity certification): https://learn.microsoft.com/en-us/windows/win32/winmsg/wm-mdicascade
- Microsoft, Visual Basic 6.0 Resource Center: https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-basic-6/visual-basic-6.0-documentation

## Intelligent UI

[INTELLIGENT-UI.md](INTELLIGENT-UI.md) documents the reusable streaming UI library,
MCP tools and App resource, coding-agent conversation rendering, permission
boundaries, standalone packaging, and integration validation.
