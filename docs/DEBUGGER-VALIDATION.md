# Debugger continuation validation — 2026-10-05

This report supersedes the intermediate 1,600- and 1,738-test snapshots in the earlier debugger notes.

## Verified source

The integrated executable source is commit `7f3ddca9c84bba2ca89ff412d39e33cc86613181`, including main through `16c8ef706c525de141e1d5d547b3cf14b45beeea`. The documentation-only continuation does not alter the tested executable source or generated bundles.

The recovery was replayed in a fresh local Git worktree and in GitHub Actions. All 23 changed source/test/tool/guide file hashes matched the reviewed local tree. Large source files are read through the filesystem rather than bounded synchronous subprocess output buffers. Both merges preserved current native automation/control registration, automation cleanup on Reset, Win32/GDI, data, coding-agent, MCP, and editor changes. All temporary debugger recovery workflows and payloads were removed from the resulting tree.

Primary run: https://github.com/wieslawsoltes/VB6/actions/runs/37326022168

## Results

| Check | Result |
| --- | --- |
| Complete root Node unit suite | 2,122 passed; 0 failed; 0 skipped |
| Debugger/browser exported-app scenarios — Chromium 143.0.7499.4 | 17 passed |
| Debugger/browser exported-app scenarios — Firefox 144.0.2 | 17 passed |
| Debugger/browser exported-app scenarios — WebKit 26.0 | 17 passed |
| Existing core Chromium browser workflows | 36 passed |
| Existing IntelliSense browser suite | Passed in the same CI job |
| Existing Win32 browser compatibility suite | Passed in the same CI job |
| Existing MCP agent browser workflows | Passed in the same CI job |
| Build and regenerated-output reproducibility | Passed |
| Local syntax checks of changed JavaScript modules | 19 passed |
| Local standalone Win32 compatibility package tests | 93 passed |

The 73 focused debugger unit tests comprise 50 execution/error/inspection regressions, 20 design-mode Immediate regressions, and 3 integration regressions. The latter preserve queued-event settlement and native automation cleanup on Reset, verify that design Immediate does not run startup, and reject invalid stepping modes without resuming execution.

The CI artifact `debugger-verified-integration` contains the full unit log, three browser JSON reports, core/MCP reports, screenshot evidence, and a Git bundle plus the published source SHA. Local HTTP-based ancillary browser tests encountered managed-browser loopback restrictions; those same suites were run successfully in GitHub Actions rather than being disabled or counted as local passes.

## Delivered behavior

Design-mode Immediate uses the existing classic Immediate window and a separate opaque-origin application runtime. It prepares module storage without running Sub Main or form startup events; preserves module-specific temporary state; supports expressions, calls, assignments, comments and multiline commands; and resets on edits, project replacement, F5 or Reset. Explicit evaluation has instruction/time limits, cancellation and concurrent-command guards. Background events are not dispatched by the design-only session.

The continuation retains statement-level stepping, executable breakpoints, source-column highlighting, Run to Cursor, guarded Set Next Statement, scoped watches, caller/ByRef inspection, recoverable runtime errors and the classic End/Debug/Help dialog. Existing standalone exports retain noninteractive Stop/Assert behavior. The generated standalone IDE, runtime and 16 example applications are rebuilt.

## Boundaries

This validates the shared JavaScript source debugger, not complete native Microsoft VB6 binary equivalence. Native machine-code/P-code debugging, attaching to arbitrary Windows EXE/DLL/COM processes, cross-process native stacks, unrestricted Edit and Continue, full event-driven design-mode execution, and exact native font/pixel certification are not claimed. Automatic inspection intentionally avoids executing getters or source procedures; explicit bounded evaluation remains available. No licensed native VB6 debugger oracle was used.

See [DEBUGGER.md](DEBUGGER.md) for commands, contracts, shortcuts and recovery examples.
