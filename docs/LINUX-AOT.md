# Direct Linux AOT export with GTK

The Linux target exports native **x86-64 and ARM64 ELF executables** with **GTK 3.24 controls**. Procedure compilation, executable linking, and ZIP/tar.gz/DEB/RPM packaging run in JavaScript, in the IDE or Node.js. The exported application contains native machine code and the shared native VB6 runtime. It runs without a browser, JavaScript engine, Node.js, Wine, a VB bytecode interpreter, or a project compilation service.

The native executable dynamically links the destination system's GTK, C and C++ libraries. This is full ahead-of-time compilation of the project; it is not an all-static distribution of GTK and its dependencies.

## Export an application

In the IDE, choose **File → Make Project (Linux GTK AOT)…**, set the application name, architecture, optimization level, and package format, then select **Export Linux Application**. Debian/RPM reveal editable package identity, version, publisher, and application license. A visible save link remains available if the browser does not start the automatic download. Compilation and packaging work offline in the standalone IDE.

Extraction produces this application layout:

| Path | Contents |
| --- | --- |
| `Project/bin/Project` | Native ELF64 executable, with Unix mode `0755` |
| `Project/Resources/vb6-assets.bin` | Resource catalog, when the project contains native resources or pictures |
| `Project/Resources/vb6-build.json` | Target, compiler, code size, native-library dependencies, and provenance |
| `Project/Resources/vb6-source-map.json` | VB module/procedure/line metadata from the shared lowering |
| `Project/Resources/vb6-runtime-license.txt` | License notice for the included native runtime |
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

# Select full ARM64 AOT and an installable package.
npm run build:linux -- MyProject.vbp --out NativeOutput --architecture arm64 --format deb --package-name my-application --version 1.0.0 --maintainer "Application Publisher"
npm run build:linux -- MyProject.vbp --out NativeOutput --architecture x64 --format rpm --package-name my-application --version 1.0.0
```

Input may be a `.vb6web` project, native `.vbp`, or project directory. Native import uses the existing VB6 project/form/resource importer. Outputs are created exclusively: an existing archive or application directory is not overwritten. Incomplete output from a cancelled export is removed. Source and output paths are validated before files are published.

`--extract` creates `NativeApplications/<name>/bin/<name>` with executable permissions. It cannot be combined with package format/metadata options. Defaults remain x64 and ZIP; `--architecture arm64` selects AAPCS64 machine code and the ARM64 runtime. The artifact filename is limited to 255 UTF-8 bytes while preserving the complete application/executable basename inside the archive.

## Distribution formats

Every format starts with the same verified ELF and sealed resource directory. `packageLinuxApplication` revalidates the archive bytes before packaging and ignores caller-supplied replacement file maps or reports. No native packager, shell, compiler service, or network access is needed to produce a package.

| Format | Output | Target layout |
| --- | --- | --- |
| `zip` | `<name>-linux-<architecture>.zip` | Portable application directory; preserves the existing ZIP bytes |
| `tar.gz` | `<name>-linux-<architecture>.tar.gz` | Same portable directory, Unix modes, deterministic gzip, and GNU long-path records |
| `deb` | `<package>_<version>-<release>_<amd64\|arm64>.deb` | Debian 2.0 ar/control/data format with dependency metadata and md5sums |
| `rpm` | `<package>-<version>-<release>.<x86_64\|aarch64>.rpm` | RPM v4 headers, SHA-256 header/payload/file digests, required legacy digests, and gzip/CRC cpio payload |

Debian and RPM install the application at `/usr/lib/<package>/`, keeping `bin/` and `Resources/` together. `/usr/bin/<package>` is a relative symlink to the executable. `/usr/share/applications/<package>.desktop` launches that safe ASCII path, and `/usr/share/doc/<package>/copyright` identifies the application's declared license separately from the MIT native runtime notice. Packages contain no maintainer script or installation-time code generator.

Package metadata options are `format`, `packageName`, `version`, `release`, `maintainer`, `summary`, `description`, `license`, `homepage`, and `categories`. The CLI spells these `--format`, `--package-name`, `--version`, `--release`, `--maintainer`, `--summary`, `--description`, `--license`, `--homepage`, and comma-separated `--categories`. Defaults are version `1.0.0`, release `1`, publisher `Unspecified publisher`, application license `Unspecified`, and category `Utility`; they do not infer an application license from the compiler's license. Package IDs and versions use a validated common Debian/RPM subset. Control characters, path traversal, field injection, and unsafe desktop metadata are rejected.

Debian dependency names target Ubuntu 24.04 and compatible Debian systems: `libc6 >= 2.39`, `libstdc++6 >= 13.2`, `libgcc-s1`, `libgtk-3-0t64 >= 3.24`, and `libcups2t64`. RPM targets Fedora-compatible library capabilities, including 64-bit native SONAMEs, `GLIBC_2.39`, `GLIBCXX_3.4.32`, `CXXABI_1.3.13`, and `gtk3 >= 3.24`. The packages are unsigned; content digests establish integrity, not publisher identity. A publisher can sign the resulting RPM or distribute Debian packages through its own signed repository.

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
  exportLinuxDistribution,
  packageLinuxApplication,
  verifyLinuxAOTArchive
} from '@vb6-studio/linux-native';
import {
  readLinuxProject,
  exportLinuxProject,
  exportLinuxExecutable
} from '@vb6-studio/linux-native/node';

const project = await readLinuxProject('./MyProject.vbp');
const options = {name: 'MyApplication', architecture: 'arm64', optimization: 2};
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

// Reuse the same executable in a second format without recompilation.
const debian = await packageLinuxApplication(application, {
  format: 'deb', packageName: 'my-application', version: '1.0.0',
  maintainer: 'Application Publisher', license: 'Unspecified'
}, {signal: controller.signal});

// Or compile and package in one operation.
const rpm = await exportLinuxDistribution(project, options, {
  format: 'rpm', packageName: 'my-application', version: '1.0.0'
}, {signal: controller.signal});

// Publish a new package to a local directory (ZIP is the default).
const archive = await exportLinuxProject(project, {
  compiler: options,
  distribution: {format: 'tar.gz'},
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

Lower-level APIs include `linkLinuxAOT`, `exportLinuxAOT`, `loadLinuxAOTRuntime({architecture})`, `linuxAOTRuntimeInfo({architecture})`, `inspectLinuxELF`, `verifyLinuxAOTRuntime`, and `unpackLinuxAOTArchive`. `LINUX_TARGETS`, `linuxTarget`, `linuxDistributionOptions`, and `LINUX_DISTRIBUTION_FORMATS` describe supported choices. Runtime loads return defensive copies; a caller cannot modify the cached SDK used by later exports. `report.format` remains `ELF64`, while `report.distribution.format` describes the container and `report.applicationSha256` records the original sealed ZIP hash.

## Shared compiler and runtime

Linux reuses the existing project normalization, parser, semantic binder, native constant/reference binding, and native helper-call graph. The platform boundary selects conditional constants, the control/Declare catalog, diagnostics, and architecture code emission. Default macOS compilation continues to use the existing ARM64 emitter and AppKit catalog.

The native C++ runtime remains shared source. It provides values and coercions, exact Currency and Decimal arithmetic, UTF-16 strings, arrays and records, classes, property dispatch, object lifetime, error recovery, files, resources, financial/calendar functions, and disconnected recordsets. Linux supplies a `NativeHost` implementation using GTK, GLib, Cairo, Pango and GdkPixbuf.

Both architectures define `Linux`, `Unix`, `GTK`, and `GTK3` as true and `VBWEB`, `Win16`, `Win32`, `Win64`, `Mac`, and `MacOS` as false. x64 defines `X86_64`/`AMD64`; ARM64 defines `ARM64`. The other architecture's constants are false. Platform branches are resolved before native lowering:

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

The Linux emitters translate helper calls, labels, branches, loops, and error dispatch into native instructions. x64 uses the System V AMD64 calling convention; ARM64 reuses the existing ARM64 emitter with Linux AAPCS64 helper naming and ELF relocation. Both align call frames, preserve callee-saved state, pass arguments correctly, and probe large stack frames. Helper failures are returned across generated frames and rethrown from ordinary native runtime frames, preserving the shared VB error-handling model.

| Compiler option | ELF machine | Native ABI | Project mapping alignment |
| --- | --- | --- | --- |
| `architecture: 'x64'` | `EM_X86_64` (62) | System V AMD64 | 4 KiB |
| `architecture: 'arm64'` | `EM_AARCH64` (183) | AAPCS64 | 64 KiB, compatible with 4/16/64 KiB pages |

Project metadata contains literals, names, type descriptions, form/control specifications and procedure entry offsets. It does not contain an executable AST or instruction stream. Conditions, loops, procedure entry/exit and dispatch decisions execute as machine code.

O0–O3 apply the shared optimization policies to project code. The reusable native SDK is compiled at O2. Limits are checked: project code is bounded at 64 MiB and project metadata at 8 MiB; array and call-depth limits are configurable within the native runtime's validated range.

### ELF linking and loading

The prelinked SDK is a position-independent executable. The JavaScript linker preserves its existing load addresses, dynamic relocations, PLT/GOT and native helpers. It appends an RX segment for project code and an R segment for metadata and the relocated program-header table. Project segments grow to fit the program. Runtime-to-project addresses are established when the operating system loads the image; there is no JIT compilation or writable executable memory.

The exporter validates architecture, ELF tables and section ranges, system-library imports, helper symbols, segment permissions, nonexecutable stack, RELRO and immediate symbol binding. The native loader validates its project segments, ABI and aligned entry offsets before calling project functions.

ARM64 appended mappings preserve the header LOAD segment's file/virtual-address bias. This also keeps the relocated program header address correct in Linux loaders and QEMU implementations that derive `AT_PHDR` from the image load address plus `e_phoff`. Runtime images and compiled procedures from different architectures cannot be mixed.

ZIP verification checks the complete file inventory, executable permissions, file hashes, ELF contents and build report. It reconstructs the original runtime header to verify the runtime provenance hash. The integrity manifest detects modifications; it is not a publisher signature.

## GTK forms and platform behavior

GTK is the first Linux host. Its widget vocabulary maps directly to the existing form/control model: windows, buttons, editable text, list/tree/grid controls, nested frames, notebooks, menus, scroll/range controls, calendars, native dialogs, timers, images and Cairo drawing surfaces. The actual mapping is exposed by `LINUX_CONTROLS` and every compile report. The same form source and event procedures are compiled; an HTML form is not embedded inside a GTK window.

Form loading, instance lifetime, events and error propagation use the existing runtime contracts. GTK supplies the main loop, timers, native widget signals, modal windows and display integration. Window close routes through the shared cancellable unload path. Console-only projects initialize no display and can execute with `DISPLAY` and `WAYLAND_DISPLAY` unset.

The explicit `LINUX_API_SIGNATURES` catalog adapts a documented set of common Windows-style declarations to native Linux/GTK services. It does not load a Windows DLL. Declarations without an adapter receive compiler diagnostics. Windows COM servers, OCX binaries and arbitrary Windows ABI calls remain platform-specific.

These GTK host services use native objects and preserve the shared VB runtime semantics:

| API | Linux behavior |
| --- | --- |
| `RichTextBox` | GTK text-buffer tags implement `TextRTF`/`SelRTF`, selection font/size/bold/italic/underline/strike/colors, paragraph alignment/indents/tabs/bullets, hidden/protected text, and UTF-16-compatible selection/search. File methods default to RTF format `0`; format `1` explicitly selects plain UTF-8. |
| `Printers` collection | CUPS enumeration works without a display. Supports zero-based `Printers(index)`/`Item`, `For Each`, queue metadata, page settings, and `Set Printer = Printers(index)`. Linux lowering preserves ordinary variables, parameters, fields, procedures, and controls named `Printer` or `Printers`. |
| `Printer` jobs | Native GTK/CUPS job submission follows the selected queue and page settings. Cancellation avoids submitting a job; CUPS rejection raises error `482` and preserves the pending document. |
| `CommonDialog.ShowPrinter` | The native GTK settings dialog updates the selected printer, page setup, and copies after acceptance without submitting a job. Cancellation preserves the current settings and honors `CancelError`. |
| `Screen.MousePointer` | Standard cursor values `0`–`15` are retained for the application, applied to existing and newly realized controls, and restored to control defaults when reset to `0`. |
| `App.PrevInstance` | Every host registers at attachment, before property access. A per-user canonical-executable registry uses process locks and an atomic startup snapshot to detect older live instances, clean crash markers, and keep executable aliases consistent. Distinct executable copies are separate applications. |

The RTF parser resolves grouped state, font/color/style tables, code pages, and Unicode fallback. Input is bounded to 16 MiB, 4 Mi UTF-16 text units, 65,536 formatting runs, and bounded table/group counts. Unsupported visible constructs such as embedded pictures/objects, tables, or unsupported line spacing raise error `453` before document mutation; malformed values receive diagnostics. No active embedded content is executed and no formatting is silently converted to plain text. Native and compiled VB fixtures test formatting round trips and failed-import preservation.

Both exported runtimes target **Linux with GTK 3.24, CUPS 2, glibc 2.39, and GNU C++ runtime 13.2 or compatible newer libraries**, built and tested on Ubuntu 24.04. The build report records required GLIBC/GLIBCXX symbol versions and native dependencies. For Ubuntu 24.04:

```sh
sudo apt-get install libgtk-3-0t64 libcups2t64
```

GTK supports both X11 and Wayland. Top-level placement and activation follow the window manager/compositor. In particular, Wayland does not provide arbitrary global top-level window positioning. A native GTK control mapping does not certify every historical OCX property or Windows event-ordering detail. GTK4, all-static deployment, AppImage, and Flatpak remain separate targets. This exporter delivers full native ELF applications with portable ZIP/tar.gz and installable Debian/RPM containers.

## MCP and coding agents

`vb6.build.targets` advertises the `linux` target. Build the current immutable project revision with:

```json
{"target":"linux","expectedRevision":42}
```

Send that object to `vb6.build.create`. The response contains the build report and a caller-owned artifact handle. Read the archive through `vb6.build.read`, advancing byte offsets until `hasMore` is false, and verify the complete-file SHA-256. Unsupported native constructs return diagnostics without an artifact.

Architecture, format, optimization, and package metadata can be selected in the same request:

```json
{"target":"linux","architecture":"arm64","format":"deb","optimization":3,"package":{"packageName":"my-application","version":"1.0.0","maintainer":"Application Publisher"},"expectedRevision":42}
```

These options are rejected for other build targets. Invalid package metadata allocates no artifact. `vb6.build.targets` lists both architectures and all four formats.

The existing artifact lifetime, ownership, cancellation and revision checks apply. MCP retains at most eight artifacts and 32 MiB in total; larger exports use the in-memory package API or CLI. A build request produces bytes and does not start a native process or write host files.

## Validation and runtime maintenance

```sh
npm run test:linux
node tools/test-linux-aot.mjs
node tools/test-linux-distribution.mjs
python tools/browser-linux-aot-tests.py
```

The Node suite checks both emitters, ELF layouts and relocations, malformed input rejection, archives, distribution metadata/digests, package isolation, and output publication. Native acceptance executes actual generated procedures and GTK behavior. Independent package qualification uses `dpkg-deb`, RPM, cpio, tar, and desktop-file validation, then executes the extracted ELF and package symlink while loading resources from another working directory. Long UTF-8 paths, literal shell characters, damaged RPM digests, and dependency symbol floors are covered.

The browser suite downloads every architecture/format combination from HTTP and standalone-file IDEs, compares exact bytes with Node output, and checks cancellation, stale-project rejection, diagnostics, and absence of network requests. Native jobs independently extract and execute those exact browser downloads.

The native acceptance tool starts Xvfb for its GUI cases and keeps console cases headless. Invoke it directly; an outer `xvfb-run` is unnecessary.

The canonical workflow requires native x64 (`ubuntu-24.04`) and ARM64 (`ubuntu-24.04-arm`) jobs, each executing the shipped runtime, rebuilding current native sources, and qualifying packages. Browser jobs export in Chromium, Firefox, and WebKit; dependent jobs on both native machines execute those exact downloads. CI audit tests reject missing architectures, skipped native/package commands, omitted CUPS dependencies, or detached browser artifact execution. Reports and generated applications are retained as workflow artifacts.

Native SDK updates use the existing build/test/embed pattern:

```sh
sudo apt-get install clang g++ pkg-config libgtk-3-dev libcups2-dev xvfb xauth dpkg-dev rpm cpio desktop-file-utils
node tools/test-linux-aot.mjs --architecture x64 --rebuild
node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime reports/linux-aot/validation.json

# Run on native ARM64 Linux, or add --sysroot /path/to/arm64-sysroot on x64.
node tools/test-linux-aot.mjs --architecture arm64 --rebuild
node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime-arm64 reports/linux-aot-arm64/validation.json
node tools/build-linux-native.mjs
npm run build:update-ide-artifacts
```

Embedding requires passing exact-runtime machine-code execution, GTK signals, RTF, printer, previous-instance, resource, lifetime, large-project, and O0–O3 evidence. Cross builds require an explicit ARM64 sysroot, cross compiler, and QEMU; proof records emulated execution distinctly from native execution. Emulated ARM64 qualification executes the same conformance binary with 4/16/64 KiB QEMU page settings. No bootstrap or unverified payload may be embedded. Source provenance covers the portable runtime, shared AOT helpers, GTK host, Linux loader, and ABI definition. Normal package/IDE builds validate both architectures and reject missing or stale payloads.

An extracted cross-compilation sysroot also needs the target GdkPixbuf image-loader cache, ICO/SVG loader modules, and the shared MIME cache normally created by package installation. The qualification tool validates these prerequisites and the loaders' ELF architecture before execution. If they are missing, its diagnostic gives the target `gdk-pixbuf-query-loaders` command to run under QEMU and the `update-mime-database` step; the report records both cache hashes.

## Primary references

- [GTK compilation and pkg-config](https://docs.gtk.org/gtk3/compiling.html)
- [GTK Linux dependencies](https://www.gtk.org/docs/installations/linux/)
- [GTK window position semantics](https://docs.gtk.org/gtk3/method.Window.get_position.html)
- [GTK3 to GTK4 API differences](https://docs.gtk.org/gtk4/migrating-3to4.html)
- [ELF program headers and loading](https://gabi.xinuos.com/elf/07-pheader.html)
- [ELF dynamic linking](https://gabi.xinuos.com/elf/08-dynamic.html)
- [System V AMD64 ABI](https://gitlab.com/x86-psABIs/x86-64-ABI)
- [AAPCS64 calling convention](https://github.com/ARM-software/abi-aa/blob/main/aapcs64/aapcs64.rst)
- [Debian binary package format](https://manpages.debian.org/bookworm/dpkg-dev/deb.5.en.html)
- [RPM v4 package format](https://rpm-software-management.github.io/rpm/manual/format_v4.html)
- [RPM signatures and digests](https://rpm-software-management.github.io/rpm/manual/signatures_digests.html)
- [Desktop launcher execution fields](https://specifications.freedesktop.org/desktop-entry/latest/exec-variables.html)
