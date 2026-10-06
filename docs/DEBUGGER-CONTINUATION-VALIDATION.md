# PR #42 continuation — local validation, 2026-10-06

## Source and publishing status

This continuation is based on PR #42 head
`febf578e98ccb5e72c7f3d3e0f16c3ea8b54d4a2`, not the subsequently advanced main
branch. The recovered baseline passed **2,664** root unit tests; the earlier
conversation count of 2,428 was stale. The final source passes **2,680** tests,
with no failures, cancellations or skips.

Executable/source changes are committed locally as:

- `0e04f7e38c25940e64a9c642bfb3a542b43c0e98` — shared approved preview loading,
  lifecycle guards, native packaging/smoke coverage and browser regressions.
- `7266afc727d8eb46883c20a764ba01b4cdc0c5d1` — explicit strict live-edit policy
  regression with unchanged stack, locals, global state and continued execution.

The subsequent documentation commit does not change the tested executable code.
The GitHub connection in this session exposed read/search actions but no write
or merge action. A direct, non-force push to the existing PR branch was attempted
and failed with `Could not resolve host: github.com` (exit 128). **These local
commits were not pushed, and PR #42 was not merged.** Current-main reconciliation
and final remote CI remain required.

## Reproduced issues and changes

The native adapter intercepted only `studio.run()` and inspected its newly set
`srcdoc`. A design-only Immediate session does not call that method and therefore
bypassed document approval entirely. The pre-fix browser probe recorded zero
loader calls and `srcdoc` present. The fixed probe records one loader call, a
host-supplied URL and no `srcdoc`.

The new shared boundary runs before navigation for both session types. Native
URLs are restricted to the host's exact private preview namespace; malformed or
refused responses remain inert. Late success/failure from an old run cannot
navigate its disconnected frame or stop/reset a replacement session. The native
IDE no longer patches the run method. Its packaging includes the loader and the
portable smoke requires native design/event Immediate to work.

The older control-flow edit browser test implicitly expected strict in-place
migration, while PR #42 deliberately makes the IDE prefer versioned retention.
The test now explicitly requests `policy: 'strict'` and still requires rejection.
It additionally checks stack/pause identity, local/global values and completion
of the original invocation. Existing independent versioned-retention scenarios
remain enabled. No failed assertion was replaced by a skip or an unconditional
success.

## Final local results

Node.js 22.16.0; Chromium 144.0.7559.96 through Python Playwright.

| Check | Result |
| --- | --- |
| Full root Node suite | 2,680 passed; 0 failed/skipped/cancelled |
| Preview and native staging focused suite | 26 passed, included in the full suite |
| Core browser/IDE/runtime scenarios | 36 passed |
| Visual/browser interaction scenarios | 42 passed |
| Editor/tools scenarios | 30 passed |
| Docking/recovery scenarios | 20 passed |
| Editor/workspace finalization scenarios | 39 passed |
| Runtime/strict live-edit boundary scenarios | 38 passed |
| Existing debugger scenarios | 17 passed |
| Extended debugger/preview scenarios | 12 passed |
| Total of the eight browser suites above | 234 scenario executions passed |
| Build and second-build generated-output reproducibility | Passed |
| Native-smoke source fixture in Chromium | Arithmetic, no startup, promotion, button event, Reset passed |

The sixteen new unit cases comprise fifteen loader/lifecycle/URL contracts and
one native IDE staging integration case. Four new browser scenarios cover shared
approved loading, obsolete F5 failures, obsolete Immediate failures and active
approval refusal/recovery. The existing eight extension scenarios are retained.

All local browser passes above use inline/generated HTML. The embedding-loader
fixture uses blob documents; it is **not Electron protocol or native CDB evidence**.
The extension runner still defaults to its strict modular HTTP, standalone HTTP
and standalone file matrix in CI. A local attempt at that matrix was blocked by
managed Chromium with `ERR_BLOCKED_BY_ADMINISTRATOR`; it is not counted as passing.
The new native portable smoke has not been executed on Windows in this session.

An initial parallel browser sweep caused local page crashes. The suites counted
above were subsequently rerun serially and passed. The unrelated parity suite
was stopped after stalling during its binary-download workflow; that incomplete
run is not counted as passing. Historical CI reports and older passing native
runs do not validate these new commits.

## Remaining gates

Apply/reconcile the commits on the PR branch without replacing newer main
changes, run the full real-origin browser matrix, and run actual Windows native
and packaged-IDE workflows on the final combined revision before merging. No
native P-code interpreter frames, arbitrary global/object storage migration,
licensed VB6 oracle or native pixel/font equivalence is claimed by this patch.

## Reproduction

```sh
npm test
npm run build
git diff --exit-code -- dist src/exporter/runtime-payload.js src/editor/diagnostics-payload.js examples
node --test tests/runtime-document.test.mjs tests/native-build.test.mjs
CHROMIUM_PATH=/path/to/chromium VB6_DEBUGGER_ORIGINS=inline python tools/browser-debugger-boundaries.py
```

Run the default extension browser matrix without `VB6_DEBUGGER_ORIGINS=inline`
on an unrestricted validation host. Real Windows smoke remains in the existing
native packaging workflows; browser fixtures must not replace that gate.
