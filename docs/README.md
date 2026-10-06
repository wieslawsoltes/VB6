# Build and maintenance documentation

Start with the [repository quick start](../README.md#getting-started), then use
this index for the contracts needed to build, maintain and extend the project.
These guides describe the implemented system, not complete native VB6 parity.

## Build, test and architecture

- [Architecture and SDK embedding](ARCHITECTURE.md): module boundaries, execution,
  persistence and extension points.
- [Build artifacts](IDE-BUILD-ARTIFACTS.md): source-only builds, exact fingerprints
  and safe regeneration when integrating changes.
- [Testing](TESTING.md): setup, reproducible checks and validation boundaries.
- [Compatibility](COMPATIBILITY.md) and [user guide](USER_GUIDE.md): supported
  behavior, deliberate limits and workflows to preserve.

## Language, runtime and project files

- [Compiler/runtime](COMPILER-RUNTIME.md) and [scalar/Variant semantics](SCALAR-COMPATIBILITY.md).
- [Source debugger](DEBUGGER.md), [extended debugger contracts](DEBUGGER-COMPATIBILITY.md),
  [native break lifecycle](NATIVE-DEBUGGER-BREAK-LIFECYCLE.md) and
  [preview lifecycle](NATIVE-PREVIEW-LIFECYCLE.md).
- [Native project interchange](NATIVE-PROJECTS.md) and
  [workspace, save recovery and interoperability](NATIVE-WORKSPACE-INTEROP.md).
- [Data sources](DATA-SOURCES.md): providers, binding, credentials and deployment.
- [Keyboard/mouse events](INPUT-EVENTS.md) and [optional automatic layout](anchoring-layout.md).

## IDE, appearance and rendering

- [IntelliSense](INTELLISENSE.md) and [resolution/reference contracts](INTELLISENSE-COMPATIBILITY.md).
- [Detached browser windows](BROWSER-WINDOWS.md).
- [IDE themes](IDE-THEMES.md), [application themes](APPLICATION-THEMES.md) and
  [matching icon packs](THEME-ICON-PACKS.md).
- [Classic icons](ICON-AUDIT.md), [classic HTML rendering and attribution](CLASSIC-HTML-RENDERING.md)
  and [visual validation](VISUAL-AUDIT.md).

## Windows compilation and native services

- [Windows build targets](WINDOWS-BUILDS.md), [target validation](NATIVE-VALIDATION.md),
  [direct Win32 AOT](WIN32-AOT.md) and [export troubleshooting](WIN32-EXPORT-TROUBLESHOOTING.md).
- AOT language/ABI contracts: [numeric storage](WIN32-NUMERIC.md),
  [Currency](WIN32-CURRENCY.md), [Date](WIN32-DATES.md),
  [calendar intervals](WIN32-CALENDAR-INTERVALS.md), [arrays](WIN32-ARRAYS.md),
  [calls](WIN32-CALLS.md), [bindings](WIN32-BINDINGS.md),
  [callbacks](WIN32-CALLBACKS.md) and [String interop](WIN32-STRING-INTEROP.md).
- Native Automation: [startup/deadlines](NATIVE-AUTOMATION-STARTUP.md),
  [typed scalars](NATIVE-SCALAR-INTEROP.md) and [DATE transport](NATIVE-DATE-TRANSPORT.md).
- OCX: [setup and support](OCX-SUPPORT.md), [container contracts](OCX-CONTAINER-CONTRACTS.md),
  [active objects](OCX-ACTIVE-OBJECT.md), [property browsing](OCX-PROPERTY-BROWSING.md)
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
[automatic layout](../packages/auto-layout/README.md),
[Win32 browser compatibility](../packages/win32-browser/README.md),
[native debugger](../packages/native-debugger/README.md) and
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
