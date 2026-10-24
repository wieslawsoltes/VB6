# VB6 native Linux compiler

This package compiles VB6 projects into native Linux x86_64 and ARM64 ELF executables with GTK 3 controls. Compilation, linking, and ZIP/tar.gz/DEB/RPM packaging run in JavaScript, including entirely offline in the browser. The exported application's procedures are native machine code; the executable does not contain a JavaScript engine, browser, Wine, VB6 bytecode interpreter, or Microsoft VB6 runtime.

The compiler reuses the VB6 parser, binder, native lowering graph, resource catalog, portable C++ value/runtime implementation, and ARM64 emitter already used by the macOS exporter. The Linux backend adds System V x86_64 emission, architecture-specific ELF linking, and the native GTK host. O0–O3 control optimization of project machine code; both bundled runtimes are compiled at O2.

## Export from the IDE

Choose **File → Make MyProject (Linux GTK AOT)…** to open **Make Linux GTK Application**, select a name, architecture, optimization level, and package format, then choose **Export Linux Application**. ZIP and tar.gz contain an executable under **NAME/bin/NAME**, a **Resources** directory, source map, build report, runtime license notice, and integrity manifest. Extract the entire directory, then run **./NAME/bin/NAME**. Debian and RPM packages install a desktop launcher and **/usr/bin/PACKAGE_NAME**; review the package name, version, publisher, and application license before distributing.

The download works without a Linux compiler, compiler bridge or network connection. The browser never executes the Linux application.

## Reusable Node API

Build the package in the repository before packing it:

    node tools/build-linux-native.mjs
    npm pack ./packages/linux-native

The resulting npm package is independent of the repository. It includes bundled ESM/browser compilers, the verified compressed native runtime, a CLI, and the native SDK sources used to build that runtime.

    import { exportLinuxApplication, exportLinuxDistribution, packageLinuxApplication, verifyLinuxAOTArchive } from '@vb6-studio/linux-native';
    import {
      readLinuxProject,
      exportLinuxProject,
      exportLinuxExecutable
    } from '@vb6-studio/linux-native/node';

    const project = await readLinuxProject('./MyProject.vbp');
    const compiler = { name: 'MyApplication', architecture: 'arm64', optimization: 2 };

    // In-memory browser/Node export, with no filesystem effects.
    const result = await exportLinuxApplication(project, compiler);
    await verifyLinuxAOTArchive(result.bytes, result.options);

    // Package the same verified application without compiling it again.
    const deb = await packageLinuxApplication(result, {
      format: 'deb', packageName: 'my-application', version: '1.0.0',
      maintainer: 'Application Publisher', license: 'Unspecified'
    });

    // Write a package; refuse an existing file. ZIP remains the default.
    const archive = await exportLinuxProject(project, {
      compiler,
      distribution: { format: 'rpm', packageName: 'my-application', version: '1.0.0' },
      out: './artifacts'
    });

    // Or create a fresh application directory with executable permissions.
    const application = await exportLinuxExecutable(project, {
      compiler,
      out: './applications'
    });
    console.log(archive.archive, application.executable);

The Node API accepts native .vbp projects, project directories and .vb6web JSON files. File import is bounded and rejects symbolic links. Both output APIs create files exclusively, preserve the resource layout, and leave existing applications untouched. AbortSignal cancels export; the directory API removes its incomplete output. Neither API runs the generated executable.

## Command line

    vb6-linux MyProject.vbp --out NativeOutput
    vb6-linux MyProject.vb6web --out NativeOutput --optimization 3 --name MyApplication
    vb6-linux MyProject.vbp --out NativeApplications --extract
    vb6-linux MyProject.vbp --out NativeOutput --architecture arm64 --format tar.gz
    vb6-linux MyProject.vbp --out NativeOutput --architecture x64 --format deb --package-name my-application --version 1.0.0 --maintainer "Application Publisher"
    vb6-linux MyProject.vbp --out NativeOutput --architecture arm64 --format rpm --package-name my-application --version 1.0.0

In a repository checkout, use **node tools/build-linux.mjs** in place of **vb6-linux** after building the package.

## Runtime requirements and portability

The targets are **Linux x86_64 and ARM64, GTK 3.24, CUPS 2, glibc 2.39, and GNU C++ runtime 13.2 or compatible newer libraries**. Ubuntu 24.04 is the native build and acceptance environment. Debian packages declare Ubuntu/Debian library package names; RPM packages declare 64-bit SONAME and GNU symbol capabilities plus `gtk3 >= 3.24` for Fedora-compatible systems. The runtime manifest records the compiler, GTK version, and required GLIBC/GLIBCXX symbol versions. Applications remain fully AOT compiled when they dynamically link system GUI libraries.

GTK supplies X11 and Wayland display backends. A console-only project can run without a display; a forms application needs a working graphical session. Window position requests follow the display server: Wayland does not expose global top-level window coordinates, so desktop-wide Left/Top behavior cannot match Win32.

Controls use native GTK widgets with the VB6 forms/property model, including real events, form lifetimes and native drawing. The toolkit catalog describes the mapped control types. Acceptance tests establish concrete implemented behavior; they do not certify every property/event of every VB6 OCX. Windows DLLs, COM servers and OCX binaries cannot be loaded into this Linux process. Unsupported native declarations receive compiler diagnostics.

The GTK host now provides these native services:

| API | Linux behavior |
| --- | --- |
| `RichTextBox` | Native attributed text, `TextRTF`/`SelRTF`, selection font/color/style and paragraph formatting, protected/hidden text, Unicode selection/search, and RTF file persistence. `LoadFile`/`SaveFile` default to RTF format `0`; explicit format `1` reads/writes plain UTF-8 text. |
| `Printers` / `Printer` | Headless CUPS enumeration, zero-based `Printers(index)`/`Item`, `For Each`, validated `Set Printer = Printers(index)`, queue metadata, page settings, and native GTK print-job submission/cancellation. |
| `CommonDialog.ShowPrinter` | Native GTK selection updates accepted printer settings without submitting a job. Cancellation preserves the settings and honors `CancelError`. |
| `Screen.MousePointer` | Standard cursor state (`0`–`15`) persists for current and future controls; reset to `0` restores control defaults. |
| `App.PrevInstance` | Registered at host attachment, before any property read. A stable startup snapshot detects older live instances of the same canonical executable for the current user, including aliases, concurrent starts, and crash cleanup. |

RTF is bounded to 16 MiB, 4 Mi UTF-16 text units, and 65,536 formatting runs. Unsupported visible RTF constructs such as embedded objects/images, tables, and unsupported line spacing raise diagnostics before changing the document; formatting is never silently flattened. GTK4, an all-static GTK distribution, AppImage, and Flatpak remain separate targets. The ELF application directory and Debian/RPM installers require their recorded system libraries.

## Runtime architecture

The pinned runtime is an ordinary position-independent ELF executable with native GTK and the shared C++ runtime. Export appends separate load segments for generated machine code and declarative project metadata. Code is readable/executable and metadata is read-only; no writable executable mapping is needed. The linker preserves existing segment addresses, dynamic relocations, immediate symbol binding, RELRO and the nonexecutable stack.

The program header table resides in the new metadata mapping. ARM64 mappings use 64 KiB alignment and preserve the header's file/virtual-address bias for loader compatibility across 4/16/64 KiB pages. The Linux loader validates the tagged segments, metadata marker, ABI, and procedure offsets before passing function pointers to the shared native runtime. It resolves /proc/self/exe before locating resources, so launching by PATH, a package symlink, or from another working directory works correctly.

The package verifies the bundled runtime SHA-256, source provenance, ELF architecture, helper symbols and system-library imports. Generated archives have deterministic timestamps, executable modes and integrity manifests.

## Native acceptance and runtime refresh

Maintainers need Node.js 22+, Clang or GCC, pkg-config, GTK 3 and CUPS development headers, Xvfb, and Xauth. On Ubuntu:

    sudo apt-get install clang g++ pkg-config libgtk-3-dev libcups2-dev xvfb xauth dpkg-dev rpm cpio desktop-file-utils
    node tools/test-linux-aot.mjs --architecture x64
    node tools/test-linux-distribution.mjs --architecture x64

This runs actual generated ELF machine code, including all optimization levels, shared language/runtime conformance, resources, lifetimes, project-segment growth, GTK forms, RTF, CUPS, and instance contracts. Run `--architecture arm64` on an ARM64 Linux machine, or supply `--sysroot PATH` on x64 to execute through QEMU user emulation. Reports distinguish native and emulated execution; no emulator is shipped in an exported application.

To rebuild and qualify the SDK after a native-source change:

    node tools/test-linux-aot.mjs --architecture x64 --rebuild
    node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime reports/linux-aot/validation.json
    # On ARM64 Linux, or with an explicit ARM64 sysroot/QEMU on x64:
    node tools/test-linux-aot.mjs --architecture arm64 --rebuild
    node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime-arm64 reports/linux-aot-arm64/validation.json
    node tools/build-linux-native.mjs

Embedding requires passing machine-code and native-service acceptance evidence tied to the exact runtime hash and source snapshot. Normal package builds check both architectures and reject stale payloads; changes to native sources cannot silently ship an older runtime. See [the full architecture and packaging guide](../../docs/LINUX-AOT.md) for API metadata, package layout, MCP, and CI contracts.

GTK references: [compilation](https://docs.gtk.org/gtk3/compiling.html), [Linux packages](https://www.gtk.org/docs/installations/linux/), [Wayland position semantics](https://docs.gtk.org/gtk3/method.Window.get_position.html). ELF references: [program loading](https://gabi.xinuos.com/elf/07-pheader.html), [dynamic linking](https://gabi.xinuos.com/elf/08-dynamic.html).
