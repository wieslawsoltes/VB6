# Native target validation

Use [Windows builds](WINDOWS-BUILDS.md) for target setup and
[Win32 AOT](WIN32-AOT.md) for the separate direct compiler/ABI. This guide records
what to check, not historical run totals. Capture the exact source revision,
platform, payload architecture and actual graphics backend in the PR or report.

## Build and staging checks

```sh
npm run build
npm run test:native
npm run test:win32
npm --prefix desktop ci
npm run build:windows -- --project examples/calculator.vb6web --graphics auto --out release/calculator
npm run build:windows -- --graphics auto --out release/studio
npm run build:classic -- --project examples/classic/HelloRuntime.vbp --stage-only
```

Desktop builds use the committed dependency lockfile. Stage-only output checks
source preservation and packaging, not execution. A real portable smoke must
copy each EXE alone into a fresh directory, launch it on the target architecture
and exercise actual HWNDs, form events, focus, geometry, min/max/restore,
modality, QueryUnload cancellation, hide/show, unload/reopen and the IDE preview.
Distinguish the portable launcher architecture from the embedded process.

For the IDE, exercise detached tool/document restoration, F5, design-mode
Immediate without startup, promotion to event mode, a button handler and Reset.
The preview must retain its sandbox and have no native IPC bridge. Preserve
blocked remote navigation/popups and direct child-IPC rejection. See
[preview lifecycle](NATIVE-PREVIEW-LIFECYCLE.md) and
[debugger contracts](DEBUGGER-COMPATIBILITY.md).

## Graphics and window lifetime

Omitting `--graphics auto` selects strict WebGPU. Startup must render and read
back a pixel before reporting WebGPU availability; adapter enumeration alone
is insufficient. A failed strict probe must stop project startup with a visible
diagnostic. `auto` permits Canvas2D and records the failure reason;
`canvas2d` explicitly disables GPU acquisition for application and IDE surfaces.
A successful strict-startup rejection is not a successful GPU-rendering test.

Keep per-window device caches, generation-checked asynchronous initialization
and document-transfer hooks. Stale shader completion or closing an old window
must not dispose a replacement surface. Per-surface cleanup must not destroy
the shared window device. Preserve drawing performed in `Form_Load` before the
DOM moves to a shown native window.

Record hardware and software GPU results separately. Do not disable production
sandboxing or driver blocklists to obtain a pass. Hosted fallback or SwiftShader
measurements are not physical hardware-WebGPU certification.

## Licensed compiler and installed services

A real classic build requires a separately installed licensed `VB6.EXE` and its
development references. Run native and P-code modes on trusted Windows input;
never expose a licensed host to untrusted PR code. Preserve VBP/source bytes in
the staged copy and verify a fresh PE32/x86 output importing `MSVBVM60.DLL`.
Check arguments, diagnostics, timeout, checksums and unrepresentable path/output
errors. A zero exit without a fresh valid executable is a failure. Mock output,
staging and skipped licensed execution are not compiler certification.

Windows Automation/ActiveX, installed providers and CDB require independent
checks with the actual components and matching architectures. Browser transport
fixtures do not replace them. Use the [workspace host guide](NATIVE-WORKSPACE-INTEROP.md),
[data provider guide](DATA-SOURCES.md), [OCX guide](OCX-SUPPORT.md) and
[native debugger package](../packages/native-debugger/README.md) for setup,
consent, fixtures and commands. The checked-in CI workflow, not a retired
workflow name in an old report, determines what runs automatically.

## Keep target boundaries explicit

Modern portable output distributes one EXE but extracts Electron and stores
user data; it is not the no-extraction AOT target. Its application MDI children
are browser controls inside the native parent, not direct Win32 MDI child HWNDs.
Direct Win32 AOT uses its own compiler, supported ABI and native controls.
Classic output uses the installed original runtime and project dependencies.
None of these targets implies universal VB6/COM/OCX compatibility.

No Microsoft compiler, runtime, proprietary fonts or third-party OCX binaries
are redistributed by this source implementation. Existing EXE inspection is
read-only PE metadata inspection, not binary emulation or a complete dependency
audit. See [Testing](TESTING.md) for general evidence and reproduction rules.
