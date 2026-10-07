# Testing and validation

Run commands from the repository root. The source build requires **Node.js 22
or later** and has no root npm dependencies. Python and Playwright are needed
for browser checks, plus Pillow for image checks. Desktop and installed-provider
tests have separate prerequisites. Start with the [documentation index](README.md)
for each subsystem.

## Build and portable tests

```sh
npm run build
npm test
python tools/test-package-notices.py
python tools/test-report-retention.py
```

`npm test` runs the root `tests/*.test.mjs` suite; its pretest hook also rebuilds.
Builds verify generated IDE/runtime/sample bytes against the reviewed artifact
manifest. A second build must not alter tracked generated output:

```sh
npm run build
npm run verify:ide-artifacts
git diff --exit-code -- dist src/exporter/runtime-payload.js src/editor/diagnostics-payload.js examples
```

See [build artifact maintenance](IDE-BUILD-ARTIFACTS.md) before changing expected
fingerprints. Never update expectations just to make a failed build pass, and
never substitute stale prebuilt bundles for the changed source.

## Maintained suite and fixture scope

The Node runner discovers `tests/*.test.mjs`. Suites are named for current
subsystems rather than release or finalization milestones. Follow the maintained
[test scope and fixture policy](../tests/README.md). After building, focused
source checks include:

```sh
node --test tests/editor-*.test.mjs
node --test tests/debugger-*.test.mjs
node --test tests/language*.test.mjs tests/runtime-*.test.mjs
```

A focused pass does not replace the full suite. Recovery, cancellation, atomic
save, malformed-input and compatibility tests protect existing product features
and belong in the maintained suite. Browser entry points and shared helpers in
`tests/` are consumed by runners in `tools/`, not the Node glob. Preserve native
scalar reference corpora, ABI fixtures and visual goldens while tests consume
them; check dynamic consumers before deleting apparent orphans.

## Browser setup and checks

Use the Playwright version pinned in the checked-in
[validation workflow](../.github/workflows/validate.yml):

```sh
python -m pip install playwright==1.57.0 pillow
python -m playwright install --with-deps chromium firefox webkit
npm run build
```

Some legacy Chromium runners require an explicit executable path. In a POSIX
shell, resolve the installed Playwright executable rather than assuming a path:

```sh
export CHROMIUM_PATH="$(python -c 'from playwright.sync_api import sync_playwright; p = sync_playwright().start(); print(p.chromium.executable_path); p.stop()')"
```

Core IDE/runtime checks used by the validation workflow:

```sh
python tools/browser-tests.py
python tools/browser-parity-tests.py
python tools/browser-features-04.py
python tools/recovery-browser-tests.py
python tools/browser-finalization-05.py
python tools/browser-boundaries-06.py
```

Historical suffixes in tool names do not make their current regression coverage
obsolete. Keep tests that exercise existing behavior. The active browser matrix
also exercises detached windows, IDE/application themes, opt-in layout editing,
and exact downloaded sample and modular deployment exports. Run it locally in a POSIX shell with:

```sh
for engine in chromium firefox webkit; do
  VB6_BROWSER="$engine" npm run test:windows
  VB6_BROWSER="$engine" npm run test:themes:browser
  VB6_BROWSER="$engine" npm run test:layout:browser
  VB6_BROWSER="$engine" npm run test:layout:designer
  VB6_BROWSER="$engine" npm run test:application-themes:browser
  VB6_BROWSER="$engine" npm run test:sample-exports
  VB6_BROWSER="$engine" npm run test:exporter:browser
done
```

On PowerShell, assign `$env:VB6_BROWSER` before invoking a command. Harnesses
that take `--engine` instead of `VB6_BROWSER` document that interface in their
subsystem guide. Run `npm run test:visual` for visual interactions; golden-image
comparison needs the matching browser/font environment and an explicit review
of any changed baseline. See [visual validation](VISUAL-AUDIT.md).

`npm run test:classic-html` exercises the production `ToolList` directly:
retained row identity, sparse updates, bounded visible rows, keyboard navigation,
ARIA and transfer between documents, alongside independent bevel pixels and
layout geometry. It does not require a historical painter or a before/after
performance benchmark. Older runner names do not justify keeping copied
predecessor implementations.

## Select checks for the changed subsystem

Always run the portable suite, then the relevant integration checks. These are
entry points, not a claim that every suite runs in CI:

| Change | Portable checks | Integration guide/checks |
| --- | --- | --- |
| Language/runtime/debugger | `npm run test:debugger` | [Debugger](DEBUGGER.md), [extensions/native debugger](DEBUGGER-COMPATIBILITY.md) |
| Native files and save recovery | `npm run test:project-files`; `npm run test:interop` | `npm run test:project-browser`; [workspace/host setup](NATIVE-WORKSPACE-INTEROP.md) |
| Data providers and binding | `npm run test:data` | `npm run test:data:browser`; [installed-provider requirements](DATA-SOURCES.md) |
| Native builds and Win32 ABI | `npm run test:native`; `npm run test:win32` | [AOT](WIN32-AOT.md), [Windows targets](WINDOWS-BUILDS.md), [target validation](NATIVE-VALIDATION.md) |
| Browser Win32 package | `npm run test:win32-browser` | `npm run test:win32-browser:browser`; [package contracts](../packages/win32-browser/README.md) |
| Agents and sign-in | `npm run test:agents`; `npm run test:chatgpt` | `npm run test:agents:browser`; `npm run test:chatgpt:browser` |
| MCP server | `npm run test:mcp` | `npm run test:mcp:browser`; `npm run test:mcp:agent` |
| Layout extensions | `npm run test:layout`; `npm run pack:layout` | `npm run test:layout:browser`; `npm run test:layout:designer`; `npm run bench:layout`; [designer contracts](auto-layout-designer.md) |
| Compute compiler/runtime | `npm run test:compute` | `npm run test:compute:browser`; [compute package](../packages/vb6-compute/README.md) |

[Application export](APPLICATION-EXPORT.md) documents modular output, startup,
persistence and Content Security Policy checks.

`package.json` owns command definitions. The checked-in workflow owns the CI
matrix; removed workflows are not implicit merge gates. Specialist guides may
require additional OS, provider, graphics or native-toolchain checks that are
not covered by the default workflow.

## Evidence and compatibility boundaries

Record the exact source revision, commands, browser/OS versions, results and
skips in the PR or CI artifacts. Inspect checks for the final combined revision
before merging; results for an earlier branch or a pre-integration source ZIP
are not a substitute. Do not copy changing test totals into this guide.

Generated reports are run evidence, not executable tests. Keep local evidence
out of source changes unless it is an intentionally reviewed compatibility
fixture. The checked-in workflow owns the current CI matrix and uploads.

Keep these distinctions explicit:

- Inline or memory-transport browser smoke is not HTTP/file-origin deployment
  evidence. Blocked navigation and unsupported filesystem APIs are not passes;
  OPFS tests do not automate a physical OS folder picker.
- Own screenshot goldens are not Microsoft VB6 reference pixels. Physical
  devices, native IME, fonts, accessibility and native controls need their own
  evidence. A software GPU or Canvas2D pass is not hardware WebGPU certification.
- Browser adapters and transport fixtures are not installed COM/OCX/provider or
  CDB execution. Test native architectures and installed dependencies separately.
  Licensed VB6 compilation needs an owner-supplied installation; staging, mocks
  and skipped licensed tests are not native compiler certification.

## Report retention

The root `.gitignore` keeps only `reports/README.md` in version control by
default. Add an explicit exception only for a reviewed, durable porting tracker;
prefer extending the owning documents linked by the index. Existing commands
continue writing generated JSON, logs, screenshots, benchmarks, exports and
round-trip output beneath `reports/`. Ignoring them does not disable tests or
artifact uploads.

The Validate workflow uploads core validation reports, cross-browser evidence
and Windows system contracts with the run that produced them. Download artifacts
before their retention period expires. Historical reports and the obsolete root
`SOURCE-SHA256SUMS.txt` remain in Git history; do not use their old totals to
certify a different revision. Reviewed visual input hashes remain in
`tests/visual-goldens.json` and are not Microsoft VB6 reference pixels.

## Regenerate release evidence and verify archives

```sh
python tools/validate-release.py
python tools/package-release.py --out <release-directory> --git-bundle
python tools/verify-release.py --release-dir <release-directory> --work <new-empty-directory> --version 0.6.0
```

The release validator runs the build, Node tests and all seven core browser
suites, recording fresh logs and `reports/release-validation.json`. Add
`--check-goldens` only in the recorded browser/font environment. Failed or
interrupted runs do not retain a passing summary. A passing default CI run is
not a substitute for every release check; the extra visual suite must also pass.
Launch probes (`npm run probe:launch`) remain separate from inline validation.

Packaging requires a passing integrated summary, generated report files and
previews. Missing evidence produces reproduction instructions, not a fallback to
deleted snapshots. The historical manual `visual-review-06.json` is no longer
required. Source archives contain the porting index and its linked package
documentation, not disposable reports. Each source archive gets a newly generated
`SOURCE-SHA256SUMS.txt`; removing the obsolete root copy does not disable hashing.

The archive verifier extracts the actual source ZIP, checks its manifest and
path/font restrictions, rebuilds generated files, compares delivered bytes,
reruns Node/browser tests and checks the SDK, archive integrity and optional Git
bundle. Its result is separate evidence, not native VB6 certification.

Run report-retention and packaging regressions independently with:

```sh
python tools/test-report-retention.py
python tools/test-package-notices.py
```

These tests use isolated, explicitly synthetic fixtures to exercise the runner
and actual ZIP writers. They never manufacture passing production evidence.
