# Validation and deployment

Four workflows own repository automation:

| Workflow | Responsibility |
| --- | --- |
| `validate.yml` | Read-only build, Node, browser, renderer, package and native-platform validation |
| `pages.yml` | Publish successfully validated current main; do not repeat the test suite |
| `macos-aot-runtime.yml` | Explicit runtime refresh restricted to `maint/macos-runtime-*`, with its existing narrow write permission and branch-head lease |
| `linux-aot-runtime.yml` | Explicit x64/ARM64, GTK3/GTK4 runtime refresh restricted to `maint/linux-runtime-*`, with native execution proofs and a branch-head lease |

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
Chromium, Firefox and WebKit. Each Figma engine/origin is further split into two
explicit, disjoint script owners: **figma-authoring** (five designer, editor and
presentation suites) and **figma-services** (three keyboard, Agent/MCP, Assets and
state suites). They run on separate runners, not competing browser processes in
one job. The combined `figma` CLI alias still runs all eight scripts locally.
Unique artifact names include partition, engine and origin. Only the Firefox
partition containing the required-WebGL case installs Mesa/Xvfb dependencies.
This trades additional runner setup for lower end-to-end latency; it does not
claim reduced billed compute time. Native Apple jobs still execute the archives
exported by all three browsers.

The optional Monaco distribution is built once from locked dependencies and
passed to the Chromium, Firefox and three WebKit jobs, which collectively test
both origins and the real shared model. Agent transcript and Code GPU
qualification share the existing renderer API/display setup. Required backends,
pixel assertions and native oracles remain
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

### Measured WebKit partitions

Five measured slow WebKit workflow cells use three exhaustive, disjoint owners. Other
engine/origin cells retain their full inventories. The 15-minute browser-job
deadline, 480-second script deadline, interaction deadlines and all assertions
remain unchanged.

| WebKit cell | Ownership |
| --- | --- |
| Project authoring | Native cases keep each HTTP/file pair together; workspace review runs only on shard 1 |
| Figma authoring, file | Sorted case inventories split across three shards; a script with no owned cases is not launched |
| Figma services, file | The same exact case partition applies independently to the services scripts |
| Advanced editor, both origins | Monaco/TUI/Figma cases partition across three shards; full Pascal HTTP acceptance belongs to shard 2 and full Pascal file acceptance to shard 3 |
| Integration appearance | Whole scripts partition as described below; their internal case inventories remain intact |

The audit permits only these explicit matrix replacements and requires all three
owners, unique job/artifact names, unchanged required dependencies and exhaustive
coverage. The runner rejects unsupported shard/engine/origin combinations. It
clears the case-shard environment when launching a whole-script owner, and never
accepts an empty case suite as successful coverage.

## Failure evidence and local commands

`tools/ci/run.py` accepts fixed script basenames, engine and origin names, never
arbitrary shell commands. It records per-suite logs and atomic
`reports/ci/<group>-<browser>-<origin>[-shard-N]/timings.json` before execution.
Independent suites continue after failure, but the job remains failed. There are no automatic
test retries. Cancellation stops the child process group and launches no
successor; a process timeout is not a pass. Per-suite timings appear in the job
summary, alongside the original screenshots and reports. Matrix-specific
artifact names avoid collisions.

```sh
python -m pip install -r tools/ci/requirements-checks.txt
python tools/ci/check.py
python tools/ci/test_run.py
python tools/ci/test_check.py
python tools/ci/test_tui_acceptance.py
node --test tests/ci-gate.test.mjs
VB6_BROWSER=chromium VB6_TEST_TRANSPORT=http python tools/ci/run.py figma
# Reproduce one exact CI partition:
VB6_BROWSER=chromium VB6_TEST_TRANSPORT=http python tools/ci/run.py figma-services
VB6_BROWSER=webkit VB6_TEST_TRANSPORT=http VB6_BROWSER_SHARD=2 python tools/ci/run.py integration-appearance
```

The audit rejects duplicate YAML keys, missing gate dependencies, cycles, missing
suite owners, missing engines/origins/platforms, omitted Figma partitions,
unapproved matrix exclusions, incomplete audited shard replacements,
duplicate matrix values, extra `.yaml` workflows and failure suppression. It also
parses Bash blocks and requires the reference-admission/GPU-entrypoint tests to
execute unconditionally in the audit job. The pinned, SHA-256-verified actionlint binary checks Actions
syntax and expression types. Historical timings or results do not qualify a
later source revision.

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

The `integration-appearance` browser partition owns the IDE theme, application
theme, native caption, macOS reference, WinUI and WinUI3 XAML suites. It runs independently
from the layout, diagnostics and export checks in `integration-authoring`, so
those groups each receive the inherited 25-minute job deadline. Both partitions
run on Chromium, Firefox and WebKit with the same browser setup and transport.
Chromium and Firefox run all six scripts in one job. WebKit uses three
whole-script owners to avoid accumulating all six durations against one job
deadline:

| WebKit shard | Complete scripts |
| --- | --- |
| 1 | IDE theme and native captions |
| 2 | Application theme and WinUI3 XAML |
| 3 | macOS reference and WinUI |

All six appearance scripts and every existing assertion retain coverage under
the required `test` gate. The fixed assignment must exactly match `suites.json`:
missing, extra, duplicate or empty ownership fails validation. Each child runs
its original complete test inventory with no case-shard environment. The
coverage audit also rejects duplicate entrypoints across browser partitions.

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
