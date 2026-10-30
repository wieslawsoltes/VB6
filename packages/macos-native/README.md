# VB6 native macOS compiler

VB6-to-Apple-Silicon AOT compiler, native runtime and AppKit host. The default browser/Node export emits real ARM64 procedures, links the bundled native SDK and produces a signed `.app.zip` directly, including offline. No Mac compiler or source-only intermediate is required. The older C++17/Apple Clang path remains an explicit alternative. The generated application does not embed JavaScript, Electron, a browser, Wine or MSVBVM60.DLL.

## Export from the IDE

Choose **File → Make Project.app (macOS Apple Silicon)…**. This is independent of Windows AOT, Microsoft VB6 runtime, VB.NET and HTML export.

**Export .app ZIP** is the default executable path and needs no Mac bridge, server, Clang or network. It supports O0–O3 project-code optimization with the embedded O2 native SDK, preserves executable permissions, and seals code pages and resources. Code and metadata segments grow independently in 16 KiB pages, bounded by the 64 MiB image budget and the native reader's 8 MiB metadata budget; overflow is diagnosed before image allocation. See [direct AOT architecture and APIs](../../docs/MACOS-DIRECT-AOT.md).

**Download Source Build Kit** works without a Mac connection. Extract the ZIP on macOS and run `node build.mjs`. The kit contains generated native source, the runtime SDK and build scripts; it is not an executable.

**Build via Mac Bridge** uses an explicitly approved local Mac compiler. In a terminal on the Mac, with Node.js 22+ and Xcode Command Line Tools installed:

```sh
npm run macos:bridge -- --origin https://wieslawsoltes.github.io
# For the local development server instead:
npm run macos:bridge -- --origin http://127.0.0.1:8080
```

Use the exact origin of the IDE. Paste the printed bridge URL and session token into the dialog, then approve the individual build by typing `YES` in the terminal. A standalone `file:` IDE requires explicit `--allow-file-origin`, which permits opaque file origins rather than identifying one particular file. Prefer an exact HTTP(S) origin when available. Browser local-network restrictions may require using the locally served IDE or the source-kit path.

The token is not saved in the project or settings. Closing the dialog cancels the request; project changes prevent stale downloads. A visible **Save ZIP** link supports manual retry. Neither the bridge nor the IDE executes the generated application.

## Command-line and reusable package

From the repository:

```sh
node tools/build-macos-native.mjs
node tools/build-macos.mjs MyProject.vb6web --out NativeOutput
# Explicit alternatives:
node tools/build-macos.mjs MyProject.vb6web --source-only --out ProjectSource
node tools/build-macos.mjs MyProject.vbp --clang --out ClangOutput
```

Direct export creates `NativeOutput/MyProject.app.zip` on any Node-supported host and refuses overwrite. The source-only destination must be new. Explicit Clang builds produce a signed `.app`, `.app.zip` and JSON build report. Node.js is a build-time requirement, not an application dependency.

Build first, then package with `npm pack ./packages/macos-native`. The packed compiler is independently usable and has no repository-relative imports. This command does not publish it to npm.

```js
import {exportMacOSApplication, verifyMacOSAOTArchive, createMacOSBuildKit} from '@vb6-studio/macos-native';
import {exportMacOSProject, buildMacOSProject} from '@vb6-studio/macos-native/node';
import {createMacOSBridge} from '@vb6-studio/macos-native/bridge';

const kit = createMacOSBuildKit(project, {
  name: 'MyApplication',
  bundleIdentifier: 'org.example.myapplication',
  minimumVersion: '11.0',
  optimization: 2
});
const archive = await exportMacOSApplication(project, kit.options);
await verifyMacOSAOTArchive(archive.bytes, archive.options);
// Durable direct output on Linux, Windows or macOS:
const direct = await exportMacOSProject(project, {compiler: kit.options, out: "./direct"});
// Explicit Apple Clang compilation on a Mac:
const report = await buildMacOSProject(project, {
  compiler: kit.options,
  out: '/path/to/native-output',
  jobs: 4
});
// createMacOSBridge requires an application-supplied authorization callback.
// Its default callback denies compilation. Never blindly approve untrusted input.
```

## Runtime and platform contracts

VB6 Integer/Boolean are 16-bit, Long is 32-bit, Currency is a scaled 64-bit value, and strings are counted UTF-16. These widths do not change with the LP64 host. Native objects use typed, generation-checked handles rather than truncated Cocoa pointers. File records are serialized explicitly instead of using host struct layout.

Project-defined `Implements` contracts support private method implementations, named and optional arguments, default/indexed properties, get/let/set, checked interface casts and ByRef aliases. Canonical object identity is retained across interface views; their reverse cache is weak. These are source-level VB contracts, not a Windows COM ABI.

The shared macOS/Linux runtime uses AOT ABI 5. Project records have an owner-qualified storage identity, so qualified aliases interoperate while same-named records from different modules remain distinct. Record and array display metadata preserves `TypeName`: a scalar reports its declared record name, while an array retains the element spelling used to create it through copies, `ByRef`, `ReDim Preserve`, and file reads. Dynamic record-array fields start unallocated; their lazy initializers retain a runtime lifetime guard without retaining the containing class instance. ABI checks reject older embedded runtime payloads before linking the new helper metadata.

The local compiler resolves Apple Clang through the installed Xcode SDK. It stages source privately, invokes tools without shell interpolation, caches runtime objects by source/toolchain, verifies the arm64 image and code signature, and preserves executable modes and original signed ZIP bytes. The bridge client checks archive structure and transport hashes. Direct export additionally verifies every code-page hash and bundle resource seal; neither browser path evaluates macOS trust.

Default signing is ad-hoc. **Ad-hoc signing is not notarization, Gatekeeper approval or Developer ID signing.** Configure a signing identity on the trusted local builder, never through project data. The explicit local `--distribute` CLI and `./distribution` API support Developer ID Application signing with Hardened Runtime, approved JSON entitlements, and optional `--notarize-profile` submission/stapling/Gatekeeper assessment. The user's local Keychain owns identities and credentials. See [distribution authority and usage](../../docs/MACOS-DISTRIBUTION.md). Native programs are not sandboxed by default.

## Validation and remaining boundaries

`node tools/test-macos-aot.mjs` validates actual generated ARM64 execution, strict Apple signature verification and sanitized helper-call conformance. The Direct macOS AOT workflow tests all four optimization levels, real large projects, offline browser downloads and exact-archive execution on Apple Silicon across macOS 14, 15 and 26. `node tools/test-macos-distribution.mjs` validates real ad-hoc signing and final-archive execution; notary-service transaction tests are explicitly synthetic unless valid developer credentials are used separately.

`npm run test:macos` tests compiler contracts, archive validation, bridge denial/cancellation, offline package extraction and cross-platform source determinism. `npm run test:macos:browser` tests IDE downloads, cancellation and stale-project protection over HTTP and file origins.

`node tools/test-macos-native.mjs` executes sanitized native values, generated programs, interface dispatch and view-lifetime tests. On Apple Silicon it additionally compiles, signs and executes the native app; creates 33 AppKit control types with selected event/API assertions; verifies a real bridge download; and checks runtime-cache reuse and durable reusable-API output. Linux execution and synthetic browser protocol fixtures are never labelled as macOS acceptance.

This backend does **not** certify full VB6 semantics or universal Win32 compatibility. Windows DLL/OCX binaries and arbitrary COM objects are not loaded. Full `Class_Terminate` semantics, design-time FRX/resource fidelity, all control members/events, locale behavior, native database/COM integration and GUI visual parity remain unfinished or unqualified. Unknown native declarations produce diagnostics; a successful compilation alone is not proof that every runtime path is supported.

See [the repository export guide](../../docs/MACOS-EXPORT.md) for architecture, security, verification and compatibility details.
