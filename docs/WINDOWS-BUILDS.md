# Windows executable targets

There are three **different** Windows targets. The compiler/linker, build pipelines and modern host are maintained in JavaScript. The new [freestanding AOT target](WIN32-AOT.md) closes the no-extraction boundary for its supported typed subset; it is not full VB6 or a WebGPU renderer. Neither target is a new JavaScript implementation of the Windows kernel, Microsoft compiler, Chromium, or Direct3D.

| Target | Output | Runtime | Graphics |
| --- | --- | --- | --- |
| Freestanding AOT | One PE32/x86 EXE; no extraction | Windows system DLLs; no bundled engine or VB6 runtime | Native controls and GDI; experimental typed subset |
| Modern portable | One distributed Windows `.exe`, x64 or ARM64 | Embedded Electron/Chromium/Node; extracts private runtime files on launch | WebGPU primitives; DOM controls/text; explicit Canvas2D fallback option |
| Classic VB6 | Genuine PE32/x86 `.exe` from a licensed local VB6 compiler | External `MSVBVM60.DLL` and the application's dependencies | Original VB6 controls and graphics, not WebGPU |

**Electron target is not a no-extraction implementation:** Electron's portable target is a self-extracting executable, not a statically linked, entirely memory-resident single-image binary. It needs no separately installed browser, Node, WebView2, or Electron, but writes temporary runtime files and persistent user data. `--no-extract` is rejected instead of claiming this property. Windows UI/graphics binaries in the bundled platform are native code; the project-specific host, adapters and build tools are JavaScript.

## Modern portable builds

From the repository root, with Node.js 22 or later:

```sh
npm --prefix desktop ci
npm run build:windows
npm run build:windows -- --project examples/calculator.vb6web --out release/calculator
npm run build:windows -- --project MyApp.vbp --source-root . --graphics auto
npm run build:windows -- --arch arm64 --out release/windows-arm64
```

The build defaults to `--graphics webgpu`: startup displays an actionable error when no compatible adapter is available. Use `--graphics auto` to allow Canvas2D, or `--graphics canvas2d` explicitly. Hardware support is not guaranteed by packaging. WebGPU accelerates the existing graphics surface; this is not an all-GPU rewrite of controls, text, images or the IDE. Production builds do not override driver blocklists or disable Chromium sandboxing.

`.vb6web`, `.vb6proj`, JSON and Standard EXE `.vbp` inputs are supported. A VBP is imported through the existing browser compiler and therefore retains that compiler's compatibility boundaries. Use the classic target for original compiler semantics. `--source-root` makes the permitted source tree explicit; symlink traversal is not used. `--stage-only` creates the complete staged app without requiring Electron build tools. `--dir` is a developer-only unpacked build, **not** the single-file deliverable.

Each portable build writes the EXE, SHA-256 sums and JSON build evidence. The NSIS launcher may be x86 even for an x64/ARM64 payload; the build report distinguishes those architectures. Official Electron runtime and electron-builder versions are pinned in `desktop/package.json`. Production signing requires the developer's own Windows signing identity; the CI artifacts are unsigned development builds.

### Native windowing

Exported application top-level forms use real Electron `BrowserWindow` windows (Win32 HWNDs on Windows), retaining one JavaScript VM and the same live control DOM rather than copying form state to separate VMs. Implemented integration includes independent windows, caption changes, geometry in VB twips, show/hide, minimize/maximize/restore, focus events, resizing, modal disabling/restoration, native popup menus, native message/file dialogs, input dialogs, close cancellation through `QueryUnload`, and form reuse after unload. The host exposes validated window commands, including fullscreen and always-on-top, through a context-isolated preload. MDI children remain inside their native MDI parent; they are not native Win32 MDI child HWNDs. Arbitrary Win32 `Declare`, HWND control compatibility, OLE and ActiveX hosting are not provided by this modern target.

The IDE itself is packaged as a native window. Its debugger preview retains the existing sandboxed iframe and uses a document-specific CSP with script hashes; that iframe cannot access the native bridge. The existing live-DOM detachment host now uses reserved native desktop windows for tool groups, documents and modeless tools. Properties/code detachment, original editor identity, OS-close restoration, MDI-only restoration and direct child-IPC rejection are tested on x64 and ARM64. This is not a claim of pixel-exact native IDE parity. Application execution through exported EXEs uses the native form adapter described above.

Only manifest-listed assets are served over the secure local `vb6://app` protocol, with integrity checks, blocked remote navigation/network requests, sandboxed renderers, no renderer Node integration, and a main-frame-only IPC bridge. Native file access occurs through explicit open/save dialogs. Project code must still be treated as untrusted input to the language runtime.

## Classic VB6 runtime builds

Install your licensed VB6 toolchain and the project’s development dependencies on a Windows build machine. This repository neither downloads nor redistributes the proprietary compiler, runtime, licenses, or OCX files. Set the compiler path explicitly or use the conventional VB98 installation path:

```powershell
$env:VB6_COMPILER = 'C:\Program Files (x86)\Microsoft Visual Studio\VB98\VB6.EXE'
npm run build:classic -- --project examples/classic/HelloRuntime.vbp --codegen native --out release/classic-native
npm run build:classic -- --project examples/classic/HelloRuntime.vbp --codegen pcode --out release/classic-pcode
npm run build:classic -- --project MyApp.vbp --source-root C:\Sources --out release/myapp
npm run build:classic -- --project examples/calculator.vb6web --stage-only
npm run build:classic -- --inspect C:\Apps\ExistingVB6App.exe
```

`--codegen preserve` (default) retains the project’s compilation mode. `native` and `pcode` override `CompilationType` in the **staged copy only**. Both use the VB6 runtime. Source `.vbp` builds preserve source bytes, relative paths, original designers and reference declarations rather than passing them through the browser language compiler. `.vb6web` uses the repository's native source exporter, writes Windows-1252 text, and therefore has that exporter's compatibility limits; compiler diagnostics remain authoritative. Standard EXE and ActiveX EXE project types are accepted; ActiveX DLL/OCX outputs are not EXE targets.

The JavaScript driver locates `VB6.EXE`, invokes `/make`, `/out` and `/outdir` without a shell, enforces a timeout, verifies a fresh PE32/x86 executable importing `MSVBVM60.DLL`, and writes checksums, a compiler log and a dependency/build report. A zero compiler exit without a fresh valid EXE is a failure. Existing destination EXEs are not overwritten; use a fresh output directory. `--stage-only` works without Windows or the compiler and explicitly reports `compiled: false`. Build only trusted legacy projects: the proprietary compiler and its add-ins/dependencies are not sandboxed by this JavaScript driver.

`--inspect` reads PE metadata without executing an existing EXE. It is **not** a binary emulator, decompiler, or complete dependency audit. Static imports do not reveal late-bound COM, dynamic library loads or all OCX dependencies. Existing EXEs execute on Windows with their original runtime/dependencies; they do not execute inside the browser VM.

Microsoft lists the base 32-bit VB6 runtime, including `MSVBVM60.DLL`, as shipping in supported Windows versions. Additional ActiveX controls/libraries and localization files may require deployment and appropriate rights. A classic program can have one application EXE and still depend on OS/runtime components; the tool does not describe this as a self-contained embedded-runtime EXE.

## Validation

`npm test` includes native policy, build staging, malformed PE, classic compiler-argument, source-preservation, timeout and **mocked** compiler-output tests. Mock fixtures are not evidence that Microsoft’s compiler ran.

The `Native Windows` workflow builds actual x64 portable executables, copies each EXE alone to a new temporary directory, launches it, and exercises native windows, runtime events, modality, unload cancellation, graphics and the IDE sandbox preview. Reports distinguish WebGPU from explicit fallback; enabling a software GPU for smoke tests is test-only. The Win32 AOT and ARM64 workflow now additionally verifies native ARM64 process architecture and launches both staged desktop targets and the isolated ARM64 portable IDE. These hosted runs reported Canvas2D fallback, not hardware-WebGPU certification.

The optional manual `classic` workflow input runs only on `main`, on a trusted self-hosted runner labelled `Windows` and `vb6`, with a separately installed licensed toolchain. It compiles and executes the included dependency-free sample in both modes. This job is intentionally never run for untrusted PR code. A skipped classic job is **not** a successful real-compiler test.

## Upstream references

- Electron native windows: https://www.electronjs.org/docs/latest/api/window-open
- Electron security guidance: https://www.electronjs.org/docs/latest/tutorial/security
- electron-builder portable target: https://www.electron.build/nsis/
- Microsoft VB6 runtime support statement: https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-basic-6/visual-basic-6-support-policy
- VB6 command-line build task documentation: https://nantcontrib.sourceforge.net/release/0.85/help/tasks/vb6.html
