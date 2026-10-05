> Historical validation for the original portable/classic target work. See [Win32 AOT and desktop windows](WIN32-AOT.md) and PR #9 for the later no-extraction target, real MDI/control HWNDs and ARM64 execution evidence.

# Native executable validation and remaining boundaries

The executable targets are documented in [Windows builds](WINDOWS-BUILDS.md). This implementation adds a modern portable Windows host and a separate classic-compiler integration; it does not claim complete Microsoft VB6 or Win32 API parity.

## Reproducible builds

Install desktop build dependencies with the committed lockfile:

```sh
npm --prefix desktop ci
npm run build:windows -- --project examples/calculator.vb6web --graphics auto --out release/calculator
npm run build:windows -- --graphics auto --out release/studio
npm run build:classic -- --project examples/classic/HelloRuntime.vbp --stage-only
```

Omitting `--graphics auto` selects strict WebGPU. Startup now renders a pixel to a GPU canvas and reads it back before advertising WebGPU availability. Adapter enumeration alone is insufficient. A failed probe prevents strict builds from starting project code and displays a diagnostic; `auto` uses Canvas2D with the actual failure reason recorded. Explicit `canvas2d` disables GPU acquisition for both application and IDE surfaces.

Graphics surfaces use per-window device caches, generation-checked asynchronous initialization and document-transfer hooks. Closing a previous window or finishing a stale shader compilation must not dispose a new window's surface. Per-surface cleanup destroys buffers and contexts, not the shared window device. Drawing done in `Form_Load` before native `Show` is retained when its DOM moves to the new window.

## Recorded validation

On 2026-10-04, the combined source including the graphics-policy and ANSI-path refinements passed **860 Node tests**, with 40 native-target-specific tests. The six existing Chromium inline suites passed **177 cases**: core browser integration 36, parity 14, feature suite 30, recovery 20, finalization 39, and runtime boundaries 38.

The earlier Windows packaging validation at commit `0932d21eb28f0d34d3686ff1f015248765d93ebf`, [run 37235428064](https://github.com/wieslawsoltes/VB6/actions/runs/37235428064), built and launched both actual x64 portable EXEs after copying each EXE alone into a fresh temporary directory. It verified independent HWNDs, live DOM/VM event routing, painted control values, focus/Screen.ActiveForm, min/max/restore, native caption and resize updates, modal ownership, QueryUnload cancellation, unload/reopen, hide/show, blocked network/popups, and the IDE's sandboxed debugger preview. Later changes add native InputBox interaction and direct child-IPC rejection checks; consult the latest PR checks for that exact head's results.

**These Windows runs used the explicit Canvas2D fallback.** The hosted runner enumerated a SwiftShader adapter, but even an isolated stock Electron 44.5.1 canvas failed during readback with a device-loss/external-instance error. The diagnostic tested multiple backend configurations and retained JSON/log evidence. Passing the fallback launch tests is not evidence of hardware WebGPU rendering. Production does not disable the Chromium sandbox or override driver blocklists. The separate diagnostic program is opt-in through the workflow's `diagnostics` input.

The normal workflow also exercises strict startup. Its `strict-startup-rejection` report means unavailable graphics were correctly rejected with a visible message; it does not mean GPU rendering succeeded. On a working GPU, the same smoke suite instead checks native-window GPU pixel readback.

## Classic VB6 target

The JavaScript driver preserves original VBP/source bytes in a staged copy, invokes a separately installed licensed `VB6.EXE`, selects preserved/native/P-code compilation, and validates a fresh PE32/x86 output importing `MSVBVM60.DLL`. It rejects a zero compiler exit with no output and records compiler arguments, diagnostics and checksums. Windows-1252 filenames are decoded for filesystem lookup without rewriting original source bytes; unsupported output characters fail rather than being corrupted.

**The Microsoft compiler has not been run by the hosted validation.** Driver integration tests use explicitly labelled mock output. The optional `classic` workflow input runs native-code and P-code examples only on a trusted self-hosted Windows runner with a licensed toolchain. A skipped job is not a passing compiler test. Existing EXE inspection is read-only PE metadata inspection, not binary emulation or decompilation.

## Delivery boundaries

The modern output is one **distributed portable EXE**, not a no-extraction binary: Electron extracts its embedded runtime and stores user data. Project host/adapters/build tools are JavaScript; the embedded Electron/Chromium platform contains native code. Generated applications still use the repository's VB language/control compatibility layer. WebGPU accelerates drawing primitives, not every control/text/image pixel. ARM64 is a configurable build target but has not been executed on ARM64 hardware in this validation.

Top-level application forms are native windows. MDI children remain inside their native parent as browser controls, not Win32 MDI child HWNDs. Arbitrary Declare/COM/OCX hosting, every native control API and complete detached IDE-tool integration remain outside this change. The desktop protocol is offline by default; browser MCP support merged on main does not automatically grant the native host access to arbitrary remote or local servers.

Classic output uses the external original 32-bit runtime and project-specific dependencies. No Microsoft compiler/runtime or third-party OCX binary is redistributed by this source implementation. A genuine original-compiler build depends on the user's licensed Windows toolchain and installed development references.
