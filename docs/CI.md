# Validation and deployment

Three workflows own repository automation:

| Workflow | Responsibility |
| --- | --- |
| `validate.yml` | Read-only build, Node, browser, renderer, package and native-platform validation |
| `pages.yml` | Publish successfully validated current main; do not repeat the test suite |
| `macos-aot-runtime.yml` | Explicit runtime refresh restricted to `maint/macos-runtime-*`, with its existing narrow write permission and branch-head lease |

## One complete required check

The existing **test** check depends on every validation job, including matrix
instances. Its gate rejects missing, skipped, cancelled, neutral or failed
results. No PR path filters or `continue-on-error` exceptions hide required tests.
Administrators with additional old per-workflow required-check names should
replace those requirements deliberately; deleting YAML does not edit branch
protection. This change does not alter protection settings.

## Parallelism and deduplication

The complete `tests/*.test.mjs` set uses Node's four-way `--test-shard` partition,
with two test-file workers per job. Package/ABI checks and browser suites no longer
share that deadline. `tools/ci/suites.json` assigns each browser entrypoint to a
bounded group. Figma HTTP and standalone-file tests run in separate jobs in
Chromium, Firefox and WebKit. Each Figma engine/origin is further split into three
explicit, disjoint script owners: **figma-workspace** (the workspace suite's 22
independent IDE fixtures), **figma-authoring** (four editor, navigation and
presentation suites) and **figma-services** (three keyboard, Agent/MCP, Assets and
state suites). Each partition has its own runner and the same bounded 15-minute
job deadline. The combined `figma` CLI alias still runs all eight scripts locally
in their original order.
Unique artifact names include partition, engine and origin. Only the Firefox
partition containing the required-WebGL case installs Mesa/Xvfb dependencies.
This trades additional runner setup for lower end-to-end latency; it does not
claim reduced billed compute time. Native Apple jobs still execute the archives
exported by all three browsers.

The optional Monaco distribution is built once from locked dependencies and
passed to twelve jobs: three engines, two real origins and two disjoint script
owners. **advanced-editor-core** runs the 31 Monaco acceptance cases;
**advanced-editor-integration** runs the 25 Vim, four TUI and one Figma cases.
Every engine still runs all 61 cases on each origin against the real shared model,
with the optional editor enabled. Each partition retains the 20-minute job limit,
and artifact names include partition, engine and origin. The combined
`advanced-editor` CLI alias still runs all four scripts on both origins in their
original order. Agent transcript and Code GPU qualification share the existing renderer
API/display setup. Required backends, pixel assertions and native oracles remain
unchanged. Software GPU execution is not physical-hardware qualification.

Duplicate full/focused Node runs, repeated Classic layout runs and separate
fingerprint-only jobs are removed only where the owning job already performs
those checks. Source/provenance archives, package notices, x86/x64 Automation and
AOT execution remain covered. All 81 explicit tool entrypoints in the previous
11 workflows have retained owners, including the designer checks added on main
while PR #123 was open. The complete Node glob covers further unit tests.

The shared browser setup action caches pip downloads and pins both existing
Playwright profiles. It does not cache test results, successful verdicts or built
application files. Every checkout still performs the ordinary build that checks
all reviewed fingerprints. CI cannot regenerate its own expected fingerprints.
Browser binaries and system dependencies are installed for the exact profile.

## Failure evidence and local commands

`tools/ci/run.py` accepts fixed script basenames, engine and origin names, never
arbitrary shell commands. It records per-suite logs and atomic
`reports/ci/<group>-<browser>-<origin>/timings.json` before execution. Independent
suites continue after failure, but the job remains failed. There are no automatic
test retries. Cancellation stops the child process group and launches no
successor; a process timeout is not a pass. Per-suite timings appear in the job
summary, alongside the original screenshots and reports. Matrix-specific
artifact names avoid collisions.

Ordinary script processes have a 480-second deadline. WebKit's native-project
suite and its standalone-file Figma workspace suite have a 720-second process
deadline because their repeated independent IDE boots can outlast the ordinary
budget while cases continue passing. Other Figma origins and browsers retain
480 seconds. Only the WebKit/file Monaco and Vim scripts receive a 900-second
process deadline. Explicit caller limits take precedence, and `timeoutSeconds`
in each timing record identifies the effective bound. Scheduling changes leave
the scripts' interaction and startup deadlines intact.

The advanced-editor partition sizing uses a conditional timing estimate. In
[run 40769315828](https://github.com/wieslawsoltes/VB6/actions/runs/40769315828),
the completed WebKit HTTP scripts took 290.020 seconds. Successful native-project
cases in the same run had median file/HTTP intervals of 17.742/1.506 seconds.
Applying that observed difference to each advanced IDE fixture projects about
637 seconds for file Monaco, 528 for file Vim and 1,280 for all four file scripts
before runner setup. The cancelled advanced-file run yielded startup errors and
no completed file-script timing, so those projections are not measured advanced
file throughput or validation. Separate script owners keep each projected batch
within the existing job limit; the scoped process deadlines include headroom.

```sh
python -m pip install -r tools/ci/requirements-checks.txt
python tools/ci/check.py
python tools/ci/test_run.py
python tools/ci/test_case_shard.py
python tools/ci/test_check.py
python tools/ci/test_tui_acceptance.py
node --test tests/ci-gate.test.mjs
VB6_BROWSER=chromium VB6_TEST_TRANSPORT=http python tools/ci/run.py figma
# Reproduce one exact CI partition:
VB6_BROWSER=chromium VB6_TEST_TRANSPORT=http python tools/ci/run.py figma-services
VB6_BROWSER=webkit VB6_TEST_TRANSPORT=file VB6_TEST_ADVANCED=1 python tools/ci/run.py advanced-editor-integration
```

The audit rejects duplicate YAML keys, missing gate dependencies, cycles, missing
suite owners, missing engines/origins/platforms, omitted Figma or advanced editor partitions, matrix exclusions,
duplicate matrix values, extra `.yaml` workflows and failure suppression. It also
parses Bash blocks and requires the reference-admission/GPU-entrypoint tests to
execute unconditionally in the audit job. The pinned, SHA-256-verified actionlint binary checks Actions
syntax and expression types. Historical timings or results do not qualify a
later source revision.

## Bounded browser case workers

Validate #1474 completed all advanced-editor and rendering partitions, but the
WebKit native-project process exhausted 720 seconds and WebKit/file Figma services
exhausted 480 seconds while completed cases continued passing. Those two script
invocations now use **two concurrent, isolated unittest workers inside their
existing job**. Case workers add no workflow jobs and increase no job, process,
assertion or pixel budget. There are no retries and no newly skipped cases.

`tools/ci/case_shard.py` discovers the original complete unittest inventory,
including dynamic HTTP/file registration and each module's `load_tests` hook.
Sorted contiguous halves give native projects 30 cases per worker, each with
15 HTTP and 15 file cases. Figma services retains all 21 cases, partitioned 10/11,
including the existing engine/capability decorators. Each worker owns a browser,
contexts, server and a separate `case-shard-<index>-of-2` report directory. All
other scripts, Chromium/Firefox invocations, and the explicitly labelled local
memory mode retain their ordinary scheduling.

The parent admits success only when both workers exit successfully and their
atomic evidence agrees on the source hash, execution identity, browser, origin
and complete case inventory. Every assigned case must start and finish exactly
once; missing, stale, duplicated or truncated evidence fails the owning script.
Per-case skips remain explicit, and class-level setup skips cannot certify
unexecuted cases. Failures retain separate logs and do not cancel the other
partition; cancellation reaches both process groups and prevents successor
scripts. Each worker retains the original process deadline. Source URLs, test
methods, input fixtures, and assertions are not rewritten by the shard driver.

The Figma service-persistence reload uses the same bounded 60-second startup
readiness as its initial boot, still requiring the restored enabled workspace.
Its eight-second widget-interaction deadline remains unchanged. The named Node
regression `tests/ci-browser-case-shard.test.mjs` runs all 26 Python regressions
through the existing mandatory test glob, rejecting a missing interpreter in CI
and requiring completion without skips. These include independent inventory
checks and real subprocess failure/cancellation regressions. Local
memory-mode results are not HTTP/file-origin or WebKit qualification; that
requires the normal complete CI run for the exact published revision.

## Publication boundary

Pages accepts only successful **Validate** pushes to this repository's current
`main`. It checks the event, repository and exact SHA, then rebuilds that source
with read-only permissions. It does not execute uploaded PR artifacts. Manual
publication also requires successful push validation of current main. Only the
final deployment job receives Pages write and OIDC permissions; it checks the
main ref again before publishing. Older completed validations do not deliberately
redeploy stale source.

References: [GitHub workflow-run security](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run),
[Node test sharding](https://nodejs.org/api/cli.html#--test-shard), and
[Playwright CI/cache tradeoffs](https://playwright.dev/python/docs/ci).

## Windows package-extraction paths

The independent VB.NET npm-package check passes a read-only archive descriptor
as `tar`'s standard input and sets the extraction directory with the child process
working directory. No archive path is passed to `tar -f`: GNU tar interprets a
colon in that argument as a remote host, including Windows drive-letter paths
when the workflow runs under Git Bash. This keeps the independent extractor and
all standalone ESM, CLI, browser-bundle and archive assertions. The input closes
on success, extraction failure and process-start failure; a bounded child timeout
returns a failing result rather than accepting an incomplete package. Only locally
built, trusted package archives belong in this harness.

## DOS acceptance ownership

The full DOS workspace, runtime and palette/DPR matrix runs in its own
`tui-authoring` browser partition on Chromium, Firefox and WebKit. It no longer
shares a deadline with the general `integration-authoring` scripts. All existing
assertions, browser engines, per-job deadlines and the required `test` gate remain
unchanged. The coverage audit rejects omission of this partition or duplicate
entrypoint ownership among browser partitions.

## Appearance acceptance ownership

The `integration-appearance` browser partition owns the IDE theme, native
caption, macOS reference and WinUI suites. The separate
`application-appearance` partition owns `browser-application-theme-tests.py`.
Both run on Chromium, Firefox and WebKit with the original setup and bounded
15-minute job deadline. This expands the workflow from 89 to **92 jobs**; no
script deadline, browser version, assertion, or pixel threshold is relaxed.

In Validate #1487, the WebKit IDE-theme and application-theme scripts completed
successfully in 264.982 and 466.973 seconds. With native captions and macOS
reference checks, those consumed 774.688 seconds before WinUI finished. The job
was cancelled at its shared deadline. Separating the application-theme owner
removes that cumulative bottleneck while every script still executes exactly
once. The coverage audit rejects omission, duplicate ownership, recombination,
and changes to the browser job deadline.

The service-persistence reload readiness predicate reads
`globalThis.vb6Studio?.figmaMode?.enabled`: navigation commit can precede execution
of the inline IDE bundle. Optional chaining on the bare, undeclared identifier
would throw instead of polling. A mandatory Node regression evaluates the exact
browser predicate in an empty JavaScript context and through partial, disabled,
and restored-enabled states. The 60-second startup bound, eight-second widget
bound, and persisted-state assertions are unchanged.

## Offline-origin qualification

The export acceptance server stops its actual listening socket for every outage.
A fresh worker-free client must fail against that origin; a newly opened client
with the installed worker must receive a successful service-worker response and
execute the exported application. No request interception or replacement response
is used. Chromium and Firefox also enable browser offline emulation. WebKit
qualifies origin unavailability without that flag because of
[Playwright issue 42775](https://github.com/microsoft/playwright/issues/42775):
the flag can reject requests before service-worker fetch dispatch. This is not
certification that WebKit's offline emulation works. The report records the
transport distinction, worker response and negative control explicitly. All
update, cache isolation, integrity, actual ZIP and network-only API checks remain.

## Integration with the validated WinUI/XAML main branch

The Vim branch incorporates main commit `3b704daf7dd14722b369179a59f046e8c560094d`
(WinUI/XAML PR #157). The earlier timing discussion above describes the earlier
candidate; current effective bounds preserve the already validated main-branch
budgets: browser partitions 25 minutes, Figma partitions 30 minutes, and advanced
editor partitions 30 minutes. The 92-job graph still uses independent application
appearance, Figma workspace, and advanced-editor script owners. The strict gate
and all three engines, both real origins, assertions, and pixel thresholds remain.

The common runner preserves main's 1,200-second WebKit native-project and
file-origin Monaco bounds, and 900-second WebKit/file Figma workspace, editor,
and services bounds. The new file-origin Vim suite retains its 900-second bound.
Each isolated case worker uses its owner's existing bound. Every other process,
including memory-origin native-project execution, retains 480 seconds; explicit
caller overrides still win. Regressions exercise the complete script/engine/origin
cross-product and reject changes to the qualified job limits.

Real-URL setup now combines main's navigation-commit readiness boundary with the
Vim branch's guarded failed-setup cleanup and immediate error reporting. Memory
setup retains DOMContentLoaded because set_content does not navigate. Startup is
bounded at 60 seconds; interaction deadlines and actual IDE readiness predicates
remain separate. No functional test body is removed to reconcile the branches.

## Complete application-appearance budget

The WebKit application-appearance suite retains all 53 tests, including inherited
macOS/X11 checks, real HTTP/file navigation and unchanged ten-second interaction
deadlines. Validate #1493 completed 46 cases successfully before its 480-second
process deadline terminated the standalone-file case. The complete suite now has
a scoped 900-second process budget on WebKit's real-origin invocations, within its
existing 25-minute job. Chromium, Firefox and memory-mode budgets are unchanged;
explicit caller limits still take precedence. There are no retries or new skips.

Linux packaging cancellation fixtures wait for a complete newline-terminated PID
record before cancelling. A shell redirection can expose an empty file before
`printf` writes, so file existence alone is not readiness. The original two-second
polling bound, process-group termination and descendant-liveness assertions remain
unchanged. Deterministic tests cover absent, empty, partially written, malformed
and unreadable PID markers.
