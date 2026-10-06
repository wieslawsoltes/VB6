# Debugger extensions: source integration evidence

This report covers the native-debugger UI/bridge, event-mode Immediate and versioned Edit and Continue continuation in PR #42. It does not replace the historical source-debugger report for PR #24.

## Exact integrated source

Source commit: `d5b81ff00139b8a8a9a2d9ca711237e41e004885`.
Integrated main: `f4ee8d47bed69ae26b65d20637b8f5f8da13d815`.
Integration run: https://github.com/wieslawsoltes/VB6/actions/runs/37381626652

All 49 changed source, test, documentation and generated-distribution files were byte-compared against an independently replayed local worktree. Both source manifests retained their before/after SHA-256 checks. Only generated bundles conflicted with main; they were regenerated from the merged sources. The final tree has no temporary debugger recovery manifests or integration workflows.

| Integration check | Result |
| --- | --- |
| Complete root Node suite | 2,618 passed; zero failed, cancelled or skipped |
| Focused extension/protocol/client/lifecycle tests, additional local run | 68 passed |
| Existing debugger Chromium cases | 17 passed |
| Extension cases, multi-file HTTP `dist/index.html` | 8 passed |
| Extension cases, standalone HTTP | 8 passed |
| Extension cases, standalone file URL | 8 passed |
| Build and second-build reproducibility | Passed |
| Diff whitespace check relative to integrated main | Passed |
| Native package dry-run packing | Six package files; no runtime dependencies or bundled CDB |

CI used Chromium 143.0.7499.4. The multi-file entry point loads the built JavaScript and CSS separately; it is not an unbundled-ES-module claim. The eight extension cases cover retained executing source, form/timer Immediate events, project replacement/reset, native controls and token privacy, memory operations, hardware-watch UI, reordered stop/command responses, and rejected non-loopback destinations.

The native UI cases use an explicitly labelled transport fixture. They are not evidence of native Windows engine execution. Local inline browser testing is separately labelled and was not substituted for the three CI deployment origins.

## Final PR merge gates

The permanent `debugger-native.yml` workflow independently runs the extension cases in Chromium, Firefox and WebKit, and runs actual Microsoft CDB against compiled x86/x64 Windows EXE/DLL fixtures with matching symbols. It validates native launch arguments, independent-process attach, child processes, process/thread stacks, source/machine stepping, memory writes/readback, hardware data breakpoints, stale pause rejection, authenticated HTTP authorization/origins and detach preserving the target.

Both native architectures must pass; an unavailable debugger, symbol, target or required operation fails rather than becoming a skipped certification. The ordinary repository-wide debugger, compiler/runtime, browser, native packaging, data, editor, input and MCP workflows remain enabled. Consult PR #42's final-head check results and merge-gate comment for completion of those later checks; this source integration report alone does not authorize a merge.

## Recovery regressions addressed

A delayed native command reply can no longer overwrite a newer polled pause. The adapter exposes monotonic state revisions and the UI defers inspection until a busy command finishes without losing the newly observed stop. Existing Static storage is protected across strict and versioned edits, even in inactive procedures. Compatible additional Static slots remain permitted. Native requests capture their arguments and bound the queue; memory writes invalidate pause identities even when partially unsuccessful. Hardware watches retain their requested width/access rather than silently downgrading.

The recovery workflow initially used an incorrect decompressor and the new browser harness initially selected a nonexistent root entry page. These were corrected without changing source integrity hashes or relaxing failing assertions. The successful run above repeats every affected test. Missing entry-point resources now produce an explicit preflight error.

## Equivalence boundaries

Native process debugging of a VB6 P-code host does not reconstruct the interpreter's logical frames, locals or P-code instructions. Versioned code retention is not arbitrary live global/object storage migration or native binary patching. The Windows fixture initializes COM but does not certify all native VB6/COM/OCX combinations. No licensed Microsoft VB6 compiler/debugger oracle or exact native font/pixel certification is claimed. The browser requires an approved Windows bridge for OS process control.

Commands and implementation contracts: [DEBUGGER-COMPATIBILITY.md](DEBUGGER-COMPATIBILITY.md). Package API and host setup: [native-debugger README](../packages/native-debugger/README.md).
