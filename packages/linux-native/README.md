# VB6 native Linux compiler

This package compiles VB6 projects into native Linux x86_64 ELF executables with GTK 3 controls. Compilation and linking run in JavaScript, including entirely offline in the browser. The exported application's procedures are x86_64 machine code; the executable does not contain a JavaScript engine, browser, Wine, VB6 bytecode interpreter, or Microsoft VB6 runtime.

The compiler reuses the VB6 parser, binder, native lowering graph, resource catalog, and portable C++ value/runtime implementation already used by the macOS exporter. The Linux backend adds the System V x86_64 calling convention, ELF linking and native GTK host. O0–O3 control optimization of project machine code; the bundled runtime is compiled at O2.

## Export from the IDE

Choose **File → Make MyProject (Linux GTK AOT)…** to open **Make Linux GTK Application**, select a project name and optimization level, and export the application ZIP. The menu uses the current project's name. The ZIP contains an executable under **NAME/bin/NAME**, a **Resources** directory, source map, build report and integrity manifest. Extract the entire application directory, then run **./NAME/bin/NAME**.

The download works without a Linux compiler, compiler bridge or network connection. The browser never executes the Linux application.

## Reusable Node API

Build the package in the repository before packing it:

    node tools/build-linux-native.mjs
    npm pack ./packages/linux-native

The resulting npm package is independent of the repository. It includes bundled ESM/browser compilers, the verified compressed native runtime, a CLI, and the native SDK sources used to build that runtime.

    import { exportLinuxApplication, verifyLinuxAOTArchive } from '@vb6-studio/linux-native';
    import {
      readLinuxProject,
      exportLinuxProject,
      exportLinuxExecutable
    } from '@vb6-studio/linux-native/node';

    const project = await readLinuxProject('./MyProject.vbp');
    const compiler = { name: 'MyApplication', optimization: 2 };

    // In-memory browser/Node export, with no filesystem effects.
    const result = await exportLinuxApplication(project, compiler);
    await verifyLinuxAOTArchive(result.bytes, result.options);

    // Write an application ZIP; refuse an existing file.
    const archive = await exportLinuxProject(project, {
      compiler,
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

In a repository checkout, use **node tools/build-linux.mjs** in place of **vb6-linux** after building the package.

## Runtime requirements and portability

The initial target is **Linux x86_64, GTK 3.24, glibc 2.39 or a compatible newer system**. Ubuntu 24.04 is the native build and acceptance environment. System GTK and its dependencies, including the compatible GNU C++ runtime, must be installed on the destination. The runtime manifest records the compiler, GTK version and required GLIBC/GLIBCXX symbol versions. Applications remain fully AOT compiled when they dynamically link system GUI libraries.

GTK supplies X11 and Wayland display backends. A console-only project can run without a display; a forms application needs a working graphical session. Window position requests follow the display server: Wayland does not expose global top-level window coordinates, so desktop-wide Left/Top behavior cannot match Win32.

Controls use native GTK widgets with the VB6 forms/property model, including real events, form lifetimes and native drawing. The toolkit catalog describes the mapped control types. Acceptance tests establish concrete implemented behavior; they do not certify every property/event of every VB6 OCX. Windows DLLs, COM servers and OCX binaries cannot be loaded into this Linux process. Unsupported native declarations receive compiler diagnostics.

The GTK host has these explicit API limits:

| API | Linux behavior |
| --- | --- |
| `RichTextBox.LoadFile` / `SaveFile` | UTF-8 plain text only, using format `1`; an omitted format also defaults to `1`. Other formats, including RTF format `0`, raise VB error `453`. RTF formatting is not preserved. |
| `Printers` collection | Enumeration raises VB error `453`. Native `Printer` output uses the GTK system print dialog for printer selection. |
| `App.PrevInstance` | Raises VB error `453` because this host has no registered application identifier for previous-instance detection. |

The initial executable target does not include Linux ARM64, a static GTK distribution, AppImage, Flatpak, or DEB/RPM installers. The ELF application directory is directly runnable when its recorded system-library requirements are satisfied.

## Runtime architecture

The pinned runtime is an ordinary position-independent ELF executable with native GTK and the shared C++ runtime. Export appends separate load segments for generated machine code and declarative project metadata. Code is readable/executable and metadata is read-only; no writable executable mapping is needed. The linker preserves existing segment addresses, dynamic relocations, immediate symbol binding, RELRO and the nonexecutable stack.

The program header table resides in the new metadata mapping. The Linux loader validates the tagged segments, metadata marker, ABI and procedure offsets before passing function pointers to the shared native runtime. It resolves /proc/self/exe before locating resources, so launching by PATH or from another working directory works correctly.

The package verifies the bundled runtime SHA-256, source provenance, ELF architecture, helper symbols and system-library imports. Generated archives have deterministic timestamps, executable modes and integrity manifests.

## Native acceptance and runtime refresh

Maintainers need Node.js 22+, Clang or GCC, pkg-config, GTK 3 development headers, Xvfb and Xauth. On Ubuntu:

    sudo apt-get install clang g++ pkg-config libgtk-3-dev xvfb xauth
    node tools/test-linux-aot.mjs

This runs actual generated ELF machine code, including all optimization levels, shared language/runtime conformance, resources, lifetimes, project-segment growth and GTK forms under Xvfb. It fails when native Linux x86_64 execution is unavailable. Reports are written to **reports/linux-aot**.

To rebuild and qualify the SDK after a native-source change:

    node tools/test-linux-aot.mjs --rebuild
    node tools/embed-linux-aot-runtime.mjs artifacts/linux-aot/runtime reports/linux-aot/validation.json
    node tools/build-linux-native.mjs

Embedding requires passing native acceptance evidence tied to the exact runtime hash. Normal package builds reject a stale payload; changes to native sources cannot silently ship the previous runtime.

GTK references: [compilation](https://docs.gtk.org/gtk3/compiling.html), [Linux packages](https://www.gtk.org/docs/installations/linux/), [Wayland position semantics](https://docs.gtk.org/gtk3/method.Window.get_position.html). ELF references: [program loading](https://gabi.xinuos.com/elf/07-pheader.html), [dynamic linking](https://gabi.xinuos.com/elf/08-dynamic.html).
