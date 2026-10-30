# Direct macOS Apple Silicon AOT

The default macOS export produces an actual arm64 Mach-O executable in a signed `.app.zip`, directly in the browser or Node.js. It does not export only source, call a Mac compiler service, run Clang for the project, or embed a VB/JavaScript interpreter in the application. The complete standalone IDE includes the verified native SDK, so this path also works offline in a secure file context.

## Use it

Choose **File → Make Project.app (macOS Apple Silicon)… → Export .app ZIP**. Select project-code optimization O0, O1, O2 (default), or O3. Application name, bundle identifier and deployment target are configurable. The visible **Save ZIP** link retries the same archive when automatic download is suppressed. Closing the dialog cancels publication; changing the project rejects a stale result. Export does not launch the application.

From a checkout, on Linux, Windows or macOS with Node.js 22:

```sh
node tools/build-macos-native.mjs
node tools/build-macos.mjs Project.vb6web --out NativeOutput
# NativeOutput/Project.app.zip contains the executable application.
```

`.vbp` and project-directory input use the existing native project importer. Output archives are created exclusively: an existing file or symlink is not overwritten. Node.js is needed for command-line export, not for running the resulting application.

**Build via Mac Bridge** remains an explicitly approved Apple Clang alternative. The CLI selects that toolchain with `--clang`; `--jobs` requires that explicit mode. Local release signing uses the separate `--distribute --identity` path described in [distribution](MACOS-DISTRIBUTION.md). **Download Source Build Kit**, or `--source-only`, remains a separate source artifact. No failing direct export silently changes into one of these other modes.

## Reusable APIs

Build and pack `packages/macos-native` to obtain `@vb6-studio/macos-native`. Packing does not publish to npm. Its bundled entry point includes the frontend and compressed native SDK; it does not import files outside the package.

```js
import {
  exportMacOSApplication,
  verifyMacOSAOTArchive
} from '@vb6-studio/macos-native';

const result = await exportMacOSApplication(project, {
  name: 'Demo',
  bundleIdentifier: 'org.example.demo',
  minimumVersion: '11.0',
  optimization: 2
}, {
  signal: abortController.signal,
  resources: {'Resources/notes.txt': 'Packaged application data'}
});
// result.bytes: complete .app.zip; result.executable: Mach-O bytes.
// Save result.bytes using the application's own file/download UI.
await verifyMacOSAOTArchive(result.bytes, result.options);
```

For durable Node output, `exportMacOSProject(project, {compiler: options, out, signal, resources})` is exported from `@vb6-studio/macos-native/node`. The older `buildMacOSProject` deliberately retains its Apple Clang behavior. `exportMacOSDistribution` in the Node entry point signs a direct export on a trusted Mac; `distributeMacOSApplication` from the `./distribution` entry point accepts an already exported, verified application archive. These operations do not run in the browser. Lower-level APIs include `compileMacOSAOT`, `linkMacOSAOT`, `exportMacOSAOT`, `loadMacOSAOTRuntime` and `macOSAOTRuntimeInfo`. Loading returns defensive copies; callers cannot poison later exports by mutating their template or manifest.

## Reuse and code generation

```text
VB6 project
  → existing project normalization, parser, semantic binder and bound IR
  → shared native constant/reference binding + ARM64 procedure lowering
  → checked AArch64 instructions and relocations
  → prelinked native value/runtime/AppKit SDK
  → Mach-O project sections, entry metadata and deployment target
  → SHA-256 code signature + sealed bundle resources
  → deterministic ZIP with Unix executable permissions
```

`src/native/binary-section.js` is shared with the Win32 PE32 linker and the ARM64 assembler. Win32 retains its PE format, x86 backend and runtime. Shared frontend binding and the existing macOS native runtime are reused instead of duplicating VB type widths, arrays, records, object/interface dispatch, files and AppKit controls.

Project procedures are real ARM64 instructions. Conditions, loops, calls, error continuations and `GoSub`/`Resume` destinations become native control flow. Helper ABI 5 retains [typed array results, nested references and lexical scope ownership](MACOS-ARRAYS.md) and separates nominal record identities from their authored `TypeName` spelling. Qualified and unqualified references to the same record therefore share storage safely; equally named records from different modules retain distinct identities. The metadata also distinguishes unallocated dynamic record-array fields from scalar fields.

A fixed integer-only helper ABI transfers native runtime values via checked handles. Generated frames preserve the Apple ARM64 calling convention and stack alignment. Helpers catch exceptions before they could unwind through generated frames; propagation resumes through ordinary compiled C++ frames. The metadata section contains literals, declarations, form properties and entry offsets, not an executable AST or bytecode stream. Dynamic value/member dispatch remains where VB semantics require it. [Native RES/FRX resources and pictures](MACOS-RESOURCES.md) are packaged as sealed bundle data, outside that metadata.

The maintainer-built SDK already contains linked system imports and AppKit runtime code. Export sizes separately protected trailing `__VB6CODE` (read/execute) and `__VB6META` (read-only) segments to the actual project, resolves branches against verified helper symbols, moves `__LINKEDIT` file metadata, and creates a new ad-hoc signature. The addresses and segment indices of the already linked native runtime remain unchanged. The loader obtains the actual project-section sizes through `getsectiondata`, including the image slide; it does not use fixed-capacity pointers. The linker rejects unknown offset-bearing load commands and native relocations into project-owned segments rather than silently corrupting the image. Reserved-section SDKs with the current helper ABI remain readable with their original capacity; obsolete helper ABIs are rejected. It does not request writable-executable memory, JIT entitlement, shell commands, or a native compiler from the browser.

## Integrity, determinism and signing

Runtime decompression is bounded and requires matching SHA-256, ABI, section layout, helper symbols and source provenance. Mach-O validation rejects unsupported architecture, writable executable segments, overlapping/out-of-range sections, missing helpers and non-system dylib dependencies. ARM64 encoders and relocations reject invalid registers, immediates, missing symbols, range overflow and alignment errors rather than truncating silently.

The executable has a SHA-256 CodeDirectory with 4 KiB page hashes and signed Info.plist/resource-envelope slots. Every packaged resource is sealed. `verifyMacOSAOTArchive` independently checks a downloaded ZIP, execute permissions, Mach-O structure, all code-page hashes and the resource seal; it rejects injected, missing or changed resources. ZIP timestamps are fixed, allowing exact byte comparison across hosts and browsers for the same project, options, resources and SDK.

**Ad-hoc signing is not Developer ID signing, notarization, Gatekeeper acceptance or App Store qualification.** Browser cryptographic byte verification is not macOS trust evaluation. Actual Apple `codesign --verify --strict` is a separate CI gate. The [trusted local distribution API](MACOS-DISTRIBUTION.md) can apply the developer's Keychain identity, Hardened Runtime and approved entitlements, optionally submitting to Apple and stapling a ticket only after acceptance. No credentials are embedded or accepted through project metadata. Native applications are not sandboxed by default; entitlements must be explicitly supplied and tested by their developer.

## Deliberate limits

Code and metadata capacities are independent multiples of **16 KiB**, sized for the actual project rather than fixed 2 MiB reservations. The existing **64 MiB complete-image budget** (including signature reserve) and **8 MiB native JSON metadata-reader budget** remain hard safety limits; there is no unbounded allocation. Capacity errors are diagnosed before image allocation. Minimum target is macOS 11 on arm64, not Intel/Rosetta or a universal binary.

Project optimization is distinct from the native SDK's own O2 compilation:

| Level | Project-code transformation |
| --- | --- |
| O0 | Baseline emission with all helper-result spills. |
| O1 | Remove unconditional jumps to the following label or epilogue. |
| O2 | Additionally omit result spills for slots never read in the function. |
| O3 | Additionally forward a still-live helper result in the return register instead of loading its spill. |

These conservative passes retain every native helper call, error check and source checkpoint. Reused temporary slots, labels, exception continuations and indirect dispatch constrain liveness/forwarding. Reports expose `projectOptimization` with the selected level and transformation counts and `runtimeOptimization: 2`. They do not imply that O3 is universally faster or equivalent to Apple Clang's O3 pipeline.

This completes a direct executable-export path, not universal VB6/Win32/COM compatibility. The existing [macOS compatibility boundaries](MACOS-EXPORT.md#unfinished-compatibility) still apply: Windows DLL/OCX binaries and arbitrary COM servers are not loaded; some control members and native services fail at runtime rather than at frontend validation. Retain source and test actual application behavior on a Mac. The native test runner's host/SDK version is not proof of every supported deployment OS version.

## Validation and SDK maintenance

`tests/macos-arm64.test.mjs`, `macos-aot.test.mjs` and `macos-aot-package.test.mjs` cover encoding, native compiler output, signatures, tampering, determinism, offline SDK loading, CLI output and cancellation/overwrite boundaries. Structural fixtures are explicitly nonexecutable and are not used as native runtime evidence.

`tools/test-macos-aot.mjs` runs the helper-call oracle with AddressSanitizer/UndefinedBehaviorSanitizer, builds the native SDK on Apple Silicon, then exports and executes conformance, RichText, normal-root cleanup, abrupt End, default-form lifecycle, native resource/form pictures and a real program exceeding both former 2 MiB limits at all four optimization levels. It verifies the generated app signature without re-signing or compiling the project's source. The portable oracle is diagnostic only, not a replacement for ARM64 execution.

`tools/browser-macos-aot-tests.py` uses genuine Web Crypto in Chromium, Firefox and WebKit. Each browser downloads the real application at O0–O3 from HTTP and file origins while offline, compares bytes to Node, and checks manual-save, cancellation and stale-project behavior. `tools/test-macos-browser-artifacts.mjs` runs those exact 24 downloaded archives on Apple Silicon after strict native signature verification. The workflow qualifies native execution on macOS 14, 15 and 26; this matrix does not prove behavior on macOS 11–13. `tools/test-macos-distribution.mjs` exercises actual ad-hoc Hardened Runtime signing, final-archive extraction and native execution without claiming Developer ID or notary-service access. Existing Win32, macOS source/bridge, repository and artifact-fingerprint validation remain separate gates.

Ordinary builds reject a stale or missing native SDK. After editing native runtime or AOT C++ sources, a maintainer can run on Apple Silicon:

```sh
node tools/test-macos-aot.mjs
node tools/embed-macos-aot-runtime.mjs artifacts/macos-aot/runtime reports/macos-aot/validation.json
node tools/build.mjs --update-ide-manifest
```

The embedding tool requires successful native execution and signature verification for the exact runtime bytes plus matching current source hashes and, for growable SDKs, successful large-project execution at every optimization level, native scope-ownership acceptance, and actual AppKit resource/pixel and lifecycle tests; a source kit or portable-only report is insufficient. Commit the generated payload and fingerprints, review the diff, and run all exact-head checks.

SDK refresh retains an exact tracked-source archive, executable modes, commit/tree identifiers and checksum before native compilation so interrupted runs are recoverable.

The **Refresh verified macOS runtime** workflow runs on explicit dispatch or pushes to a `maint/macos-runtime-*` branch only. Its read-only native job builds and validates; the publication job can commit only the generated payload with a branch-head lease. It never writes `main`, changes project source, or runs from a pull-request trigger. An automated token commit still needs a reviewed follow-up commit or explicit validation run before merge.
