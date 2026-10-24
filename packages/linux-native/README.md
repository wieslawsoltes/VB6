# VB6 native Linux compiler

This package compiles VB6 projects into native Linux x86_64 and ARM64 ELF executables with GTK3 or GTK4 controls. Compilation, linking, and ZIP/tar.gz/DEB/RPM packaging run in JavaScript, including entirely offline in the browser. The Node entry point also builds real AppImage and Flatpak bundles using local Linux tools. The exported application's procedures are native machine code; the executable does not contain a JavaScript engine, browser, Wine, VB6 bytecode interpreter, or Microsoft VB6 runtime.

The compiler reuses the VB6 parser, binder, native lowering graph, resource catalog, portable C++ value/runtime implementation, and ARM64 emitter already used by the macOS exporter. The Linux backend adds System V x86_64 emission, architecture-specific ELF linking, and native GTK3/GTK4 hosts. O0–O3 control optimization of project machine code; all four architecture/toolkit runtime payloads are compiled at O2. GTK3 is the default.

## Export from the IDE

Choose **File → Make MyProject (Linux GTK AOT)…** to open **Make Linux GTK Application**, select a name, architecture, GTK toolkit, optimization level, and package format, then choose **Export Linux Application**. ZIP and tar.gz contain an executable under **NAME/bin/NAME**, a **Resources** directory, source map, build report, runtime license notice, and integrity manifest. Extract the entire directory, then run **./NAME/bin/NAME**. Debian and RPM packages install a desktop launcher and **/usr/bin/PACKAGE_NAME**; review the package name, version, publisher, and application license before distributing.

The download works without a Linux compiler, compiler bridge or network connection. The browser never executes the Linux application. The dialog and MCP target discovery describe the separate Node/Linux CLI route for AppImage and Flatpak; these formats need native packaging tools and are not browser build choices.

## Reusable Node API

Build the package in the repository before packing it:

    node tools/build-linux-native.mjs
    npm pack ./packages/linux-native

The resulting npm package is independent of the repository. It includes bundled ESM/browser compilers, four verified compressed native runtime payloads, the Node packager, a CLI, the pinned AppImage execution headers and notices, and the native SDK source snapshot. Source compilation and runtime loading work without network access.

    import { exportLinuxApplication, exportLinuxDistribution, packageLinuxApplication, verifyLinuxAOTArchive } from '@vb6-studio/linux-native';
    import {
      readLinuxProject,
      exportLinuxProject,
      exportLinuxExecutable,
      packageLinuxApplicationNative
    } from '@vb6-studio/linux-native/node';

    const project = await readLinuxProject('./MyProject.vbp');
    const compiler = { name: 'MyApplication', architecture: 'arm64', toolkit: 'gtk4', optimization: 2 };

    // In-memory browser/Node export, with no filesystem effects.
    const result = await exportLinuxApplication(project, compiler);
    await verifyLinuxAOTArchive(result.bytes, result.options);

    // Package the same verified application without compiling it again.
    const deb = await packageLinuxApplication(result, {
      format: 'deb', packageName: 'my-application', version: '1.0.0',
      maintainer: 'Application Publisher', license: 'Unspecified'
    });

    // On Linux, create a real Flatpak bundle from the same sealed application.
    const flatpak = await packageLinuxApplicationNative(result, {
      format: 'flatpak', appId: 'org.example.MyApplication',
      packageName: 'my-application', version: '1.0.0', license: 'MIT'
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

The Node API accepts native .vbp projects, project directories and .vb6web JSON files. File import is bounded and rejects symbolic links. Both output APIs create files exclusively, preserve the resource layout, and leave existing applications untouched. AbortSignal cancels export and native tool process groups; incomplete output and private staging are removed. No export API runs the generated executable.

`exportLinuxProject` accepts all six formats in `distribution.format`. For AppImage or Flatpak it calls the native packager after the shared AOT compiler. `toolchain` supplies explicit paths such as an AppImage `sysroot` or Flatpak signing files. Browser-safe `LINUX_NATIVE_DISTRIBUTION_FORMATS` metadata describes these additional formats and their `node-native` authority; the native implementation is exported only by `@vb6-studio/linux-native/node`. `LINUX_TOOLKITS` describes `gtk3` and `gtk4`.

## Command line

    vb6-linux MyProject.vbp --out NativeOutput
    vb6-linux MyProject.vb6web --out NativeOutput --optimization 3 --name MyApplication
    vb6-linux MyProject.vbp --out NativeApplications --extract
    vb6-linux MyProject.vbp --out NativeOutput --architecture arm64 --format tar.gz
    vb6-linux MyProject.vbp --out NativeOutput --architecture x64 --format deb --package-name my-application --version 1.0.0 --maintainer "Application Publisher"
    vb6-linux MyProject.vbp --out NativeOutput --architecture arm64 --format rpm --package-name my-application --version 1.0.0
    vb6-linux MyProject.vbp --out NativeOutput --toolkit gtk4 --format appimage --package-name my-application --version 1.0.0
    vb6-linux MyProject.vbp --out NativeOutput --architecture arm64 --toolkit gtk4 --format flatpak --app-id org.example.MyApplication --license MIT

In a repository checkout, use **node tools/build-linux.mjs** in place of **vb6-linux** after building the package.

ZIP, tar.gz, Debian and RPM export works on any supported Node host. AppImage requires Linux with `mksquashfs`, `unsquashfs`, `readelf`, and target libraries/data; cross packaging requires `--sysroot PATH`. Flatpak requires Linux with `flatpak` and `ostree`, and can package either target architecture without running it. Export never downloads platform runtimes. Use `--help` for bounded package metadata, Flatpak permissions, custom tool paths, and caller-owned signing-key options.

## Runtime requirements and portability

The targets are **Linux x86_64 and ARM64, GTK 3.24 or GTK 4.14, CUPS 2, glibc 2.39, and GNU C++ runtime 13.2 or compatible newer libraries**. Ubuntu 24.04 is the native build and acceptance environment. Debian packages declare the selected GTK library and Ubuntu/Debian dependency names; RPM packages declare actual 64-bit SONAME and GNU symbol capabilities plus `gtk3 >= 3.24` or `gtk4 >= 4.14`. The runtime manifest records the toolkit, compiler, GTK version, and required GLIBC/GLIBCXX symbol versions. Applications remain fully AOT compiled when they dynamically link native libraries.

AppImage bundles the non-glibc dependency graph, target GTK/GIO/image modules, schemas, fonts, MIME and ISO language data, and license notices. The host supplies glibc, graphics drivers, and desktop services; newer bundled libraries can raise the recorded glibc minimum. GTK4 language lookup receives a narrow, reversible relocation in the bundled GTK copy, with original/patched hashes and exact byte provenance. Flatpak packages the same sealed application in a real OSTree bundle and declares `org.gnome.Platform/<architecture>/50`; that platform is installed separately. It has bounded explicit sandbox permissions and optional verified publisher signing. See [native distribution](../../docs/LINUX-DISTRIBUTION.md) for installation, cross packaging, licenses, relocation and signing.

Both toolkits supply X11 and Wayland display backends. A console-only project can run without a display; a forms application needs a working graphical session. Real X11 and Weston/Wayland fixtures qualify local controls, graphics, rich documents and timers. Explicit global form position, stacking, icon and rectangle operations unavailable on Wayland raise error 453 before mutating stored values or output buffers; the compositor controls top-level placement. [GTK behavior](../../docs/LINUX-GTK.md) documents the exact native contracts.

Controls use native GTK widgets with the VB6 forms/property model, including real events, form lifetimes and native drawing. The toolkit catalog describes the mapped control types. Acceptance tests establish concrete implemented behavior; they do not certify every property/event of every VB6 OCX. Windows DLLs, COM servers and OCX binaries cannot be loaded into this Linux process. Unsupported native declarations receive compiler diagnostics.

The GTK host now provides these native services:

| API | Linux behavior |
| --- | --- |
| `RichTextBox` | Native attributed text, modern/legacy list markers, pictures, editable table/document regions, retained fields and inert OLE previews, UTF-16 selection/search, and RTF persistence. `LoadFile`/`SaveFile` default to RTF format `0`; explicit format `1` reads/writes plain UTF-8 text. |
| `Printers` / `Printer` | Headless CUPS enumeration, zero-based `Printers(index)`/`Item`, `For Each`, validated `Set Printer = Printers(index)`, queue metadata, page settings, and native GTK print-job submission/cancellation. |
| `CommonDialog.ShowPrinter` | Native GTK selection updates accepted printer settings without submitting a job. Cancellation preserves the settings and honors `CancelError`. |
| Common dialogs and clipboard | Real native file/font/color/message/input dialogs preserve modal ownership and cancellation. Native text and image clipboard transfer uses GTK's display services. |
| `Screen.MousePointer` | Standard cursor state (`0`–`15`) persists for current and future controls; reset to `0` restores control defaults. |
| `App.PrevInstance` | Registered at host attachment, before any property read. A stable startup snapshot detects older live instances, including aliases, concurrent starts and crash cleanup. AppImage uses verified outer-image identity across extractions; Flatpak uses authoritative application identity with a shared private registry. |

RTF is bounded to 16 MiB, 4 Mi UTF-16 text units, 65,536 formatting runs, and aggregate nested resources. Modern list numbering, portable Symbol characters, supported inline pictures, editable tables, fields and document regions retain their admitted visible model. Unsupported constructs fail transactionally instead of silently losing visible content; field instructions and OLE data are not executed. GTK4 supports compressed line-height factors, while GTK3 rejects compression below native glyph metrics. [RichTextBox documents](../../docs/LINUX-RTF.md) defines exact formats, selection semantics and preservation boundaries.

## Runtime architecture

The pinned runtime is an ordinary position-independent ELF executable with native GTK and the shared C++ runtime. Export appends separate load segments for generated machine code and declarative project metadata. Code is readable/executable and metadata is read-only; no writable executable mapping is needed. The linker preserves existing segment addresses, dynamic relocations, immediate symbol binding, RELRO and the nonexecutable stack.

The program header table resides in the new metadata mapping. ARM64 mappings use 64 KiB alignment and preserve the header's file/virtual-address bias for loader compatibility across 4/16/64 KiB pages. The Linux loader validates the tagged segments, metadata marker, ABI, and procedure offsets before passing function pointers to the shared native runtime. It resolves /proc/self/exe before locating resources, so launching by PATH, a package symlink, or from another working directory works correctly.

The package verifies the bundled runtime SHA-256, source provenance, ELF architecture and toolkit, helper symbols and system-library imports. Generated archives have deterministic timestamps, executable modes and integrity manifests. Native format packagers independently read their completed SquashFS or OSTree containers and recheck their contents; publisher signatures are a separate explicit Flatpak option.

## Native acceptance and runtime refresh

Maintainers need Node.js 22+, Clang or GCC, pkg-config, GTK3/GTK4 and CUPS development headers, Xvfb, Xauth, Openbox, Weston, fonts and ISO language data. On Ubuntu:

    sudo apt-get install clang g++ pkg-config libgtk-3-dev libgtk-4-dev libcups2-dev iso-codes fonts-dejavu-extra openbox weston xvfb xauth dpkg-dev rpm cpio desktop-file-utils
    node tools/test-linux-aot.mjs --architecture x64
    node tools/test-linux-aot.mjs --architecture x64 --toolkit gtk4
    node tools/test-linux-distribution.mjs --architecture x64
    node tools/test-linux-distribution.mjs --architecture x64 --toolkit gtk4

This runs actual generated ELF machine code, including all optimization levels, shared language/runtime conformance, resources, lifetimes, project-segment growth, GTK forms, rich documents, X11/Wayland, CUPS, and instance contracts. Run `--architecture arm64` on an ARM64 Linux machine, or supply `--sysroot PATH` on x64 to execute through QEMU user emulation. Reports distinguish native and emulated execution; no emulator is shipped in an exported application. The separate AppImage/Flatpak matrix uses independent container readers and actual sandboxed/native launches, packaged instance detection, and GTK4 FontChooser with host language tables hidden.

To rebuild and qualify the SDK after a native-source change:

    node tools/test-linux-aot.mjs --architecture x64 --rebuild
    node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime reports/linux-aot/validation.json
    node tools/test-linux-aot.mjs --architecture x64 --toolkit gtk4 --rebuild
    node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime-gtk4 reports/linux-aot-gtk4/validation.json
    # On ARM64 Linux, or with an explicit ARM64 sysroot/QEMU on x64:
    node tools/test-linux-aot.mjs --architecture arm64 --rebuild
    node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime-arm64 reports/linux-aot-arm64/validation.json
    node tools/test-linux-aot.mjs --architecture arm64 --toolkit gtk4 --rebuild
    node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime-gtk4-arm64 reports/linux-aot-gtk4-arm64/validation.json
    node tools/build-linux-native.mjs

Embedding requires passing machine-code and native-service acceptance evidence tied to the exact runtime hash, toolkit and source snapshot. Normal package builds check all four architecture/toolkit payloads and reject missing or stale evidence; changes to native sources cannot silently ship an older runtime. See [the full architecture and packaging guide](../../docs/LINUX-AOT.md) for API metadata, package layout, the four browser/MCP formats, two native Linux formats, and CI contracts.

GTK references: [compilation](https://docs.gtk.org/gtk3/compiling.html), [Linux packages](https://www.gtk.org/docs/installations/linux/), [Wayland position semantics](https://docs.gtk.org/gtk3/method.Window.get_position.html). ELF references: [program loading](https://gabi.xinuos.com/elf/07-pheader.html), [dynamic linking](https://gabi.xinuos.com/elf/08-dynamic.html).
