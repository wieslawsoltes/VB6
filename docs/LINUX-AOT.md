# Direct Linux AOT export with GTK

The Linux target exports a native **x86-64 ELF executable** with **GTK 3.24 controls**. Both procedure compilation and executable linking run in JavaScript, in the IDE or Node.js. The exported application contains native machine code and the shared native VB6 runtime. It runs without a browser, JavaScript engine, Node.js, Wine, a VB bytecode interpreter, or a project compilation service.

The native executable dynamically links the destination system's GTK, C and C++ libraries. This is full ahead-of-time compilation of the project; it is not an all-static distribution of GTK and its dependencies.

## Export an application

In the IDE, choose **File → Make Project (Linux GTK AOT)…**, set the application name and project optimization level, and select **Export Linux ZIP**. The visible **Save ZIP** link remains available if the browser does not start the automatic download. The exporter works offline in the standalone IDE.

Extraction produces this application layout:

| Path | Contents |
| --- | --- |
| `Project/bin/Project` | Native ELF64 executable, with Unix mode `0755` |
| `Project/Resources/vb6-assets.bin` | Resource catalog, when the project contains native resources or pictures |
| `Project/Resources/vb6-build.json` | Target, compiler, code size, native-library dependencies, and provenance |
| `Project/Resources/vb6-source-map.json` | VB module/procedure/line metadata from the shared lowering |
| `Project/manifest.json` | Complete file inventory and SHA-256 integrity hashes |
| `Project/README.txt` | Application launch instructions and system requirements |

Extract the complete archive, then run:

```sh
./Project/bin/Project
```

Keep `Resources` beside `bin`. The loader resolves `/proc/self/exe` before initializing `App.Path` and resources. Launching through `PATH`, through a symlink, or from a different working directory therefore locates the installed executable's resource directory.

The export dialog uses the same native compiler as the package. It captures an immutable project snapshot, checks that the project is still current before publishing the download, and cancels publication when the dialog closes. Export is disabled during IDE execution. Exporting never launches the Linux process.

## Command line

Node.js 22 or later can export the Linux application from Linux, Windows or macOS:

```sh
npm run build:linux-package

# Produce a runnable application archive.
npm run build:linux -- examples/calculator.vb6web --out NativeOutput

# Produce the extracted application directory and native executable.
npm run build:linux -- examples/calculator.vb6web --out NativeApplications --extract

# Select project-code optimization and the application basename.
npm run build:linux -- MyProject.vbp --out NativeOutput --optimization 3 --name MyApplication
```

Input may be a `.vb6web` project, native `.vbp`, or project directory. Native import uses the existing VB6 project/form/resource importer. Outputs are created exclusively: an existing archive or application directory is not overwritten. Incomplete output from a cancelled export is removed. Source and output paths are validated before files are published.

`--extract` creates `NativeApplications/<name>/bin/<name>` with executable permissions. It is useful when exporting on the Linux destination or staging a release. Without that flag the CLI creates `<name>-linux-x64.zip`.

## Reusable compiler package

`packages/linux-native` builds the independent `@vb6-studio/linux-native` package. Packing does not publish to npm:

```sh
node tools/build-linux-native.mjs
npm pack ./packages/linux-native
```

The package includes a bundled ESM compiler, `dist/browser.js` exposing `VB6Linux`, the compressed native SDK, a Node writer, a CLI, and the runtime source snapshot. The IDE build also emits the standalone browser/worker SDK at `dist/vb6-linux.js`.

```js
import {
  compileLinuxAOT,
  exportLinuxApplication,
  verifyLinuxAOTArchive
} from '@vb6-studio/linux-native';
import {
  readLinuxProject,
  exportLinuxProject,
  exportLinuxExecutable
} from '@vb6-studio/linux-native/node';

const project = await readLinuxProject('./MyProject.vbp');
const options = {name: 'MyApplication', optimization: 2};
const controller = new AbortController();

// Compile to relocatable native procedure code and declarative metadata.
const compiled = compileLinuxAOT(project, options);
console.log(compiled.report.codeBytes, compiled.report.controls);

// Return a complete application ZIP and the executable bytes, without I/O.
const application = await exportLinuxApplication(project, options, {
  signal: controller.signal,
  resources: {'Resources/readme.txt': 'Application data'}
});
await verifyLinuxAOTArchive(application.bytes, application.options);

// Publish a new ZIP to a local directory.
const archive = await exportLinuxProject(project, {
  compiler: options,
  out: './release',
  signal: controller.signal
});
console.log(archive.archive);

// Or publish a fresh extracted application directory.
const installed = await exportLinuxExecutable(project, {
  compiler: options,
  out: './applications'
});
console.log(installed.executable);
```

`compileLinuxAOT` returns native object code and reports `compiled: false` until the ELF is linked. `exportLinuxApplication` returns `compiled: true`, `artifact: 'native-executable'`, the final executable/archive hashes, and verified image information. This distinction prevents a source-only result from being reported as a runnable application.

Lower-level APIs include `linkLinuxAOT`, `exportLinuxAOT`, `loadLinuxAOTRuntime`, `linuxAOTRuntimeInfo`, `inspectLinuxELF`, `verifyLinuxAOTRuntime`, and `unpackLinuxAOTArchive`. Runtime loads return defensive copies; a caller cannot modify the cached SDK used by later exports.

## Shared compiler and runtime

Linux reuses the existing project normalization, parser, semantic binder, native constant/reference binding, and native helper-call graph. The platform boundary selects conditional constants, the control/Declare catalog, diagnostics, and architecture code emission. Default macOS compilation continues to use the existing ARM64 emitter and AppKit catalog.

The native C++ runtime remains shared source. It provides values and coercions, exact Currency and Decimal arithmetic, UTF-16 strings, arrays and records, classes, property dispatch, object lifetime, error recovery, files, resources, financial/calendar functions, and disconnected recordsets. Linux supplies a `NativeHost` implementation using GTK, GLib, Cairo, Pango and GdkPixbuf.

Linux compilation defines `Linux`, `Unix`, `X86_64`, `AMD64`, `GTK` and `GTK3` as true and sets `VBWEB`, `Win16`, `Win32`, `Win64`, `Mac`, `MacOS` and `ARM64` to false. Platform branches are resolved before native lowering:

```vb
#If Linux Then
    Debug.Print "Native Linux application"
#ElseIf Mac Then
    Debug.Print "Native macOS application"
#ElseIf Win32 Then
    Debug.Print "Native Windows application"
#End If
```

VB `Integer` and `Boolean` remain 16-bit and `Long` remains 32-bit on this 64-bit host. Native pointer width does not change the source-language value contract. The GTK host exposes managed integer handles for controls and forms rather than truncating native pointers into VB `Long` values.

### Native code generation

The Linux emitter translates helper calls, labels, branches, loops and error dispatch into x86-64 instructions using the System V AMD64 calling convention. It aligns native call frames, preserves callee-saved state, passes stack arguments correctly and probes large stack frames. Helper failures are returned across generated frames and rethrown from ordinary native runtime frames, preserving the shared VB error-handling model.

Project metadata contains literals, names, type descriptions, form/control specifications and procedure entry offsets. It does not contain an executable AST or instruction stream. Conditions, loops, procedure entry/exit and dispatch decisions execute as machine code.

O0–O3 apply the shared optimization policies to project code. The reusable native SDK is compiled at O2. Limits are checked: project code is bounded at 64 MiB and project metadata at 8 MiB; array and call-depth limits are configurable within the native runtime's validated range.

### ELF linking and loading

The prelinked SDK is a position-independent executable. The JavaScript linker preserves its existing load addresses, dynamic relocations, PLT/GOT and native helpers. It appends an RX segment for project code and an R segment for metadata and the relocated program-header table. Project segments grow to fit the program. Runtime-to-project addresses are established when the operating system loads the image; there is no JIT compilation or writable executable memory.

The exporter validates architecture, ELF tables and section ranges, system-library imports, helper symbols, segment permissions, nonexecutable stack, RELRO and immediate symbol binding. The native loader validates its project segments, ABI and aligned entry offsets before calling project functions.

ZIP verification checks the complete file inventory, executable permissions, file hashes, ELF contents and build report. It reconstructs the original runtime header to verify the runtime provenance hash. The integrity manifest detects modifications; it is not a publisher signature.

## GTK forms and platform behavior

GTK is the first Linux host. Its widget vocabulary maps directly to the existing form/control model: windows, buttons, editable text, list/tree/grid controls, nested frames, notebooks, menus, scroll/range controls, calendars, native dialogs, timers, images and Cairo drawing surfaces. The actual mapping is exposed by `LINUX_CONTROLS` and every compile report. The same form source and event procedures are compiled; an HTML form is not embedded inside a GTK window.

Form loading, instance lifetime, events and error propagation use the existing runtime contracts. GTK supplies the main loop, timers, native widget signals, modal windows and display integration. Window close routes through the shared cancellable unload path. Console-only projects initialize no display and can execute with `DISPLAY` and `WAYLAND_DISPLAY` unset.

The explicit `LINUX_API_SIGNATURES` catalog adapts a documented set of common Windows-style declarations to native Linux/GTK services. It does not load a Windows DLL. Declarations without an adapter receive compiler diagnostics. Windows COM servers, OCX binaries and arbitrary Windows ABI calls remain platform-specific.

These GTK host APIs have explicit compatibility limits:

| API | Linux behavior |
| --- | --- |
| `RichTextBox.LoadFile` / `SaveFile` | Read and write UTF-8 plain text with format `1`. An omitted format defaults to `1` in this host. Other formats, including RTF format `0`, raise VB error `453`; RTF formatting is not preserved. |
| `Printers` collection | Enumeration raises VB error `453`. The `Printer` object supports native output through the GTK system print dialog, where the user can select a printer. |
| `App.PrevInstance` | Raises VB error `453`: the host has no registered application identifier for detecting a previous instance. |

The first exported runtime targets **Linux x86-64 with GTK 3.24 and glibc 2.39 or newer**, built and tested on Ubuntu 24.04. The build report records required GLIBC/GLIBCXX symbol versions and native dependencies. The compatible GNU C++ runtime and GTK runtime packages must be installed on the destination. For Ubuntu 24.04:

```sh
sudo apt-get install libgtk-3-0t64
```

GTK supports both X11 and Wayland. Top-level placement and activation follow the window manager/compositor. In particular, Wayland does not provide arbitrary global top-level window positioning. A native GTK control mapping does not certify every historical OCX property or Windows event-ordering detail. Linux ARM64, a GTK4 host, all-static deployment and installer formats such as AppImage/Flatpak/DEB/RPM are separate targets; this exporter delivers the native ELF application directory and its ZIP.

## MCP and coding agents

`vb6.build.targets` advertises the `linux` target. Build the current immutable project revision with:

```json
{"target":"linux","expectedRevision":42}
```

Send that object to `vb6.build.create`. The response contains the build report and a caller-owned artifact handle. Read the archive through `vb6.build.read`, advancing byte offsets until `hasMore` is false, and verify the complete-file SHA-256. Unsupported native constructs return diagnostics without an artifact.

The existing artifact lifetime, ownership, cancellation and revision checks apply. MCP retains at most eight artifacts and 32 MiB in total; larger exports use the in-memory package API or CLI. A build request produces bytes and does not start a native process or write host files.

## Validation and runtime maintenance

```sh
npm run test:linux
node tools/test-linux-aot.mjs
python tools/browser-linux-aot-tests.py
```

The Node suite checks code generation, ELF layouts and relocations, malformed input rejection, archives, package isolation and output publication. Native acceptance executes actual generated x86-64 procedures and GTK behavior. The browser suite downloads a complete archive from HTTP and standalone-file IDEs, compares it to Node output, verifies executable modes, and checks cancellation, stale-project rejection and diagnostics.

The native acceptance tool starts Xvfb for its GUI cases and keeps console cases headless. Invoke it directly; an outer `xvfb-run` is unnecessary.

The canonical validation workflow requires native Linux tests and a rebuild from current native sources. Its browser jobs export in Chromium, Firefox and WebKit; a dependent Linux job verifies and executes those exact downloads. Reports and generated applications are retained as workflow artifacts.

Native SDK updates use the existing build/test/embed pattern:

```sh
sudo apt-get install clang g++ pkg-config libgtk-3-dev xvfb xauth
node tools/test-linux-aot.mjs --rebuild
node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime reports/linux-aot/validation.json
node tools/build-linux-native.mjs
npm run build:update-ide-artifacts
```

Embedding requires passing native execution evidence for the exact runtime hash. Source provenance covers the portable runtime, shared AOT helpers, GTK host, Linux loader and ABI definition. Normal builds reject missing or stale payloads. They never replace native executable export with a source kit.

## Primary references

- [GTK compilation and pkg-config](https://docs.gtk.org/gtk3/compiling.html)
- [GTK Linux dependencies](https://www.gtk.org/docs/installations/linux/)
- [GTK window position semantics](https://docs.gtk.org/gtk3/method.Window.get_position.html)
- [GTK3 to GTK4 API differences](https://docs.gtk.org/gtk4/migrating-3to4.html)
- [ELF program headers and loading](https://gabi.xinuos.com/elf/07-pheader.html)
- [ELF dynamic linking](https://gabi.xinuos.com/elf/08-dynamic.html)
- [System V AMD64 ABI](https://gitlab.com/x86-psABIs/x86-64-ABI)
