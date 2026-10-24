# AppImage and Flatpak AOT distribution

The Linux Node SDK and `vb6-linux` command build real type-2 AppImages and Flatpak single-file bundles from the same sealed native application used by ZIP, tar.gz, Debian, and RPM export. Project code is compiled to x86-64 or AArch64 instructions before a packaging tool runs. Packaging does not interpret VB code, execute the generated application, contact a server, or install a platform runtime.

AppImage and Flatpak require local Linux packaging tools. The four existing browser formats remain available offline in the IDE, browser SDK, and MCP build API. `LINUX_NATIVE_DISTRIBUTION_FORMATS` describes the additional formats with `authority: "node-native"`, architectures, MIME types, and required tools. Browser capability discovery provides the Node/CLI route explicitly.

## Install packaging tools

On Ubuntu 24.04:

```sh
sudo apt install squashfs-tools binutils flatpak ostree
```

AppImage additionally needs the selected toolkit and the target application's system libraries in the host or specified sysroot. Install GTK 3 (`libgtk-3-0t64`) or GTK 4 (`libgtk-4-1`), CUPS (`libcups2t64`), `iso-codes`, their dependencies, runtime data, and package copyright files. The exporter follows the actual ELF dependency graph and reports missing libraries or a wrong architecture. It never invokes `ldd` or target programs during dependency resolution.

The upstream AppImage execution headers for x64 and ARM64 are included in the SDK. They are pinned to official release `20251108` and source commit `dd6cebedcbddde9c82f89b011e8e1d40b6e43868`. Their SHA256 hashes, machine type, static linkage, type-2 marker, and exact SquashFS offset are checked before use. Export does not download a runtime.

## AppImage

```sh
npm run build:linux-package
npm run build:linux -- examples/calculator.vb6web \
  --out NativeOutput --format appimage --architecture x64 \
  --package-name vb6-calculator --version 1.0.0
```

The command writes `NativeOutput/vb6-calculator-1.0.0-x86_64.AppImage` with executable permissions. `--toolkit gtk4` selects the GTK 4 AOT payload. Both toolkits use the same packaging pipeline.

The image contains an official static type-2 runtime followed by a SquashFS 4 filesystem. Its AppDir includes:

- The exact sealed ELF, resources, source map, build report, and original application manifest under `usr/lib/<package-name>/`.
- The non-glibc transitive shared-library graph, including GTK, Cairo, Pango, CUPS, the GNU C++ library, and target image/text libraries.
- GTK input/print modules, GdkPixbuf image loaders, GIO modules, available schemas, MIME data, Adwaita icons, ISO language data, selected translations, and DejaVu fonts.
- A desktop entry, icon, and `AppRun` launcher. The launcher relocates loader caches, forwards signals, preserves the application's exit status, and removes temporary cache files on normal exit.
- Available target package copyright notices, common license texts, the AppImage runtime's complete third-party notices and source references, and a file-digest manifest at `usr/share/vb6/<package-name>/distribution.json`.

The image keeps the host's glibc and dynamic loader. It records the highest required `GLIBC_*` symbol version across the bundled ELF libraries; the supplied AOT payload requires at least glibc 2.39. Graphics drivers, the compositor, host font configuration, and printing services remain desktop facilities. Bundling newer libraries can raise the glibc floor, reported as `nativePackaging.minimumGlibc`.

Each output is extracted with `unsquashfs` before returning to the caller. The exporter compares application and dependency hashes and permissions with the staged files. This validation executes neither the application's ELF nor the AppImage header.

To run without FUSE, use the upstream runtime's supported mode:

```sh
./vb6-calculator-1.0.0-x86_64.AppImage --appimage-extract-and-run
```

To inspect or replace bundled libraries:

```sh
./vb6-calculator-1.0.0-x86_64.AppImage --appimage-extract
./squashfs-root/AppRun
```

### GTK 4 language-data relocation

The Linux GTK FontChooser embeds an absolute ISO XML directory in its shared library. `GTK_DATA_PREFIX` does not change that lookup. AppImage export makes a narrowly scoped modification to the bundled GTK 4 copy: the single complete NUL-terminated `/usr/share/xml/iso-codes` constant becomes `/proc/self/fd/9`, with the remaining bytes zero-filled. `AppRun` opens its bundled ISO XML directory read-only on inherited file descriptor 9. The chooser consequently reads the bundled data independently of the host's ISO package.

Before changing bytes, the exporter validates the ELF machine type, bounded section/program tables, the unique complete string, an allocated non-writable/non-executable data section, and its read-only load segment. It rejects incompatible or ambiguous library layouts. The application's sealed executable and the source sysroot's GTK library are preserved.

The manifest records the exact byte offset, original/replacement hex bytes, original/patched SHA256 hashes, and upstream lookup source. `gtk-data-relocations.txt` provides readable reproduction and restoration instructions alongside GTK's license notices. The inherited descriptor is reserved by this launcher for the lifetime of the application. Native qualification opens the real FontChooser in an isolated mount namespace with the host ISO directory masked, proving that the bundled data is sufficient.

### Cross-architecture AppImages

Packaging an ARM64 ELF on an x64 host requires an ARM64 sysroot. SquashFS creation runs on the build host; neither ARM emulation nor an ARM C++ compiler is needed for packaging.

```sh
npm run build:linux -- examples/calculator.vb6web \
  --out NativeOutput --format appimage --architecture arm64 \
  --sysroot /opt/vb6-sysroots/ubuntu-24.04-arm64 \
  --package-name vb6-calculator --version 1.0.0
```

Keep the sysroot's libraries, GTK/GIO/GdkPixbuf modules and caches, `/usr/share` runtime data, and package licenses. Debian/Ubuntu notices reside under `/usr/share/doc/*/copyright` and `/usr/share/common-licenses`; `/usr/share/licenses` layouts are also supported. GTK 4 requires `iso_639.xml` and `iso_639_3.xml` under `/usr/share/xml/iso-codes`.

Absolute links such as `/lib -> /usr/lib` resolve inside the target root. Escaping links, unsupported paths, and mismatched architectures are rejected. If separate `$ORIGIN` dependency trees resolve the same library name to different target files, export rejects the ambiguity instead of silently choosing one for the shared bundle directory. Loader caches may use target-absolute paths or paths prefixed with the selected sysroot, provided every module corresponds to an actual bundled target file.

## Flatpak

```sh
npm run build:linux -- examples/calculator.vb6web \
  --out NativeOutput --format flatpak --architecture arm64 \
  --app-id org.example.Calculator --package-name vb6-calculator \
  --version 1.0.0 --license MIT
```

The command writes `NativeOutput/org.example.Calculator-1.0.0-aarch64.flatpak`. Both application architectures can be packaged on either Linux build architecture: Flatpak exports existing AOT binaries without executing target code.

The exporter creates application metadata, a desktop entry, icon, and AppStream metadata; runs `flatpak build-finish`; exports an OSTree commit; and creates the bundle with `flatpak build-bundle`. It imports the actual output into a second private repository, compares the destination commit, and runs `ostree fsck`.

The default dependency is `org.gnome.Platform/<architecture>/50`, containing GTK 3 and GTK 4 and a compatible system-library platform. `--runtime-version` selects a stable GNOME release 50 or newer. `--runtime-repository` changes the default HTTPS Flathub `.flatpakrepo` URL.

The platform is a separately installed Flatpak dependency. The build machine does not need it installed. To install and run an application bundle on a desktop:

```sh
flatpak remote-add --user --if-not-exists flathub \
  https://dl.flathub.org/repo/flathub.flatpakrepo
flatpak install --user flathub org.gnome.Platform//50
flatpak install --user org.example.Calculator-1.0.0-aarch64.flatpak
flatpak run org.example.Calculator
```

Use an application and runtime architecture supported by the desktop. For offline desktop installation, distribute the platform through Flatpak's repository/USB mechanisms along with the application bundle.

Application IDs have at least three ASCII reverse-DNS components and are limited to 242 characters so generated desktop/icon/metainfo filenames fit filesystem component limits. Long bundle filenames use a truncated stem plus a stable identity hash; embedded application identity remains complete.

### Sandbox permissions

Defaults are `share=ipc`, `socket=wayland`, `socket=fallback-x11`, `socket=cups`, and `device=dri`. The app receives Wayland access, an X11 fallback, local printing, and graphics rendering. It receives no broad home-directory access or shared network namespace by default. File operations remain subject to the sandbox; file chooser portals and explicitly granted paths provide document access.

`--flatpak-permissions` supplies a complete replacement list. For a project intentionally accessing Documents and TCP networking:

```sh
--flatpak-permissions share=ipc,socket=wayland,socket=fallback-x11,socket=cups,device=dri,filesystem=xdg-documents,share=network
```

Use `--flatpak-permissions none` or Node `flatpakPermissions: []` for no grants. The allowed set is bounded to documented display, printing, audio, graphics, network, home, Documents, and Downloads choices. Arbitrary D-Bus policy, environment injection, `filesystem=host`, duplicates, and conflicting X11 grants are rejected. Selected grants appear in both bundle metadata and the report.

Some build containers prohibit the additional namespace used by Flatpak's icon validator. `--flatpak-icon-sandbox off` (Node: `toolchain.flatpakIconSandbox: false`) explicitly allows validation of this exporter's fixed generated SVG without that helper namespace. The normal default keeps upstream validator isolation. This option never changes the application's sandbox or permits application execution where its namespaces are unavailable.

### Sign with an existing publisher key

```sh
npm run build:linux -- examples/calculator.vb6web \
  --out SignedOutput --format flatpak --app-id org.example.Calculator \
  --gpg-key-id FULL_SIGNING_KEY_FINGERPRINT \
  --gpg-home /path/to/publisher-keyring \
  --gpg-public-key /path/to/publisher-public.asc
```

The exporter signs the OSTree commit with the selected existing GPG key and includes the supplied public key. It imports the bundle and uses a fresh repository with `ostree pull-local --untrusted --gpg-verify` to require a valid signature before returning `signed: true`. Unsigned commits and a mismatched public key are rejected by this verification path. It does not generate a publisher identity, retrieve credentials, publish keys, or contact a key server. Unsigned export is the default. A successful signature verifies the supplied key; it does not establish independent publisher trust.

## Node API

```js
import {readLinuxProject, exportLinuxProject} from '@vb6-studio/linux-native/node';

const project = await readLinuxProject('Calculator.vb6web');
const controller = new AbortController();
const report = await exportLinuxProject(project, {
  compiler: {architecture: 'arm64', toolkit: 'gtk4', optimization: 3},
  distribution: {
    format: 'flatpak', appId: 'org.example.Calculator',
    packageName: 'vb6-calculator', version: '1.0.0', license: 'MIT'
  },
  out: 'NativeOutput', signal: controller.signal
});
console.log(report.archive, report.nativePackaging.ref);
```

`packageLinuxApplicationNative(application, distribution, {signal, toolchain})` accepts an existing `exportLinuxApplication` result and returns container bytes, filename, MIME type, compiler/distribution options, and verified packaging report. It rechecks the archive seal using a private byte snapshot. Caller-supplied report/file objects do not replace that evidence.

`toolchain` supports paths for `mksquashfs`, `unsquashfs`, `readelf`, `flatpak`, and `ostree`, plus `sysroot`, `temporaryDirectory`, signing settings, and the icon-validator option. A custom AppImage runtime requires an explicit file, matching `appimageRuntimeSha256`, and UTF-8 `appimageRuntimeLicense` notice file (`--appimage-runtime-license`). Unused or incompatible toolchain options are rejected.

The exporter uses argument arrays and does not create shell commands from project metadata. Private work directories are removed after success, failure, or cancellation. Cancellation terminates the owned packaging process group. Tool output/time, dependency bytes, file counts, paths, and traversal depth are bounded. Final output creation is exclusive, preserving existing files. AppImages use executable permissions; Flatpak bundles use data-file permissions.

## Native qualification

`tools/test-linux-native-distribution.mjs` uses independent SquashFS and OSTree readers, verifies the original ELF/resources/modes, rejects damaged containers, and tests actual AppImage and sandboxed Flatpak execution. Native controls, clipboard, Cairo graphics, PNG/ICO loaders, file I/O, timers, modal FontChooser, and cross-launch `App.PrevInstance` are exercised by fully compiled VB fixtures. AppImage instance launches use separate temporary extraction roots; fixture-owned extraction caches are removed after their processes stop. An isolated fixture signing key verifies the real signed-bundle path. Maximum-length accepted Flatpak identities are tested through the real exporter.

Install GNOME Platform 50 into an isolated `FLATPAK_USER_DIR`, then run on matching native hardware. Export that variable before starting the private D-Bus session: its activated Flatpak portal must resolve the same installation when GTK requests a sandboxed image decoder.

```sh
export FLATPAK_USER_DIR=/path/to/isolated-flatpak-user
dbus-run-session -- xvfb-run -a \
  node tools/test-linux-native-distribution.mjs \
  --architecture x64 --toolkit gtk4 \
  --flatpak-user-dir "$FLATPAK_USER_DIR" \
  --report reports/linux-native-distribution-gtk4-x64
```

The CI matrix runs both architectures and both toolkits with execution, GUI checks, instance checks, signatures, and icon isolation enabled. GTK 4 fixtures select software rendering with the appropriate switches for the bundled GTK4.14 or GNOME Platform's GTK4.22; production launchers retain user rendering/accessibility choices. The GTK 4 AppImage FontChooser check requires a private mount namespace to mask the host ISO data inside that test process. Flatpak execution retains its normal application and image-decoder sandboxes.

On hosts that restrict unprivileged user namespaces, the explicit `--iso-mount-namespace privileged` option prepares only that ISO-data mask through noninteractive `sudo` in a private mount namespace. It makes mount propagation private, hides the host language tables, and drops to the original UID/GID with no supplementary groups and `no-new-privs` before running the AppImage. The child checks its identity and restores only the selected display/session and fixture variables. CI uses this option; the default `user` method requires no `sudo`. Both methods require the host-data absence assertion and actual FontChooser execution. No runner-wide namespace policy or Flatpak sandbox is changed.

For development environments that can only inspect containers, `--execute off` is explicit and the resulting report is labelled `containers-only`. It does not qualify native execution. No container-only result substitutes for the native release matrix.

`--format appimage` or `--format flatpak` permits focused local debugging through the same fixtures. The default is `all`, and every report records its selected formats. Native CI uses the default and requires both formats for each architecture/toolkit pair.

## References

- [AppImage type-2 architecture](https://docs.appimage.org/reference/architecture.html)
- [AppImage manual AppDir packaging](https://docs.appimage.org/packaging-guide/manual.html)
- [Pinned AppImage runtime release](https://github.com/AppImage/type2-runtime/releases/tag/20251108)
- [AppImage extraction and FUSE-free execution](https://docs.appimage.org/user-guide/troubleshooting/fuse.html)
- [GTK Linux ISO language-data lookup](https://github.com/GNOME/gtk/blob/4.14.5/gtk/language-names.c)
- [GdkPixbuf module installation and loader caches](https://docs.gtk.org/gdk-pixbuf/struct.PixbufModule.html)
- [Flatpak single-file bundles](https://docs.flatpak.org/en/latest/single-file-bundles.html)
- [Flatpak command reference](https://docs.flatpak.org/en/latest/flatpak-command-reference.html)
- [GNOME 50 platform component inventory](https://gitlab.gnome.org/GNOME/gnome-build-meta/-/blob/gnome-50/elements/sdk-platform.bst)
