# Testing VB6 Studio Web

Tests exercise the current checkout and its generated artifacts. Historical
release totals, screenshots and recovery-session reports are not evidence that
the current code passes. Use the output of a fresh run and the checks attached to
the exact commit or pull request. The maintained porting contracts are indexed
in [reports/README.md](../reports/README.md).

## Build and Node tests

Node.js 22 or newer is required. The root build does not require npm dependencies.
Run from the repository root:

```sh
npm run build
npm test
npm run verify:ide-artifacts
```

`npm test` also runs the build through its `pretest` hook. The build verifies the
committed generated-artifact fingerprints; do not update them merely to make a
verification failure disappear. Production source changes may require an
intentional, reviewed artifact update.

The Node runner discovers `tests/*.test.mjs`. Suites are named for current
subsystems rather than release or finalization milestones. The maintained test
scope and fixture policy are documented in [tests/README.md](../tests/README.md).
For focused validation after building:

```sh
node --test tests/editor-*.test.mjs
node --test tests/debugger-*.test.mjs
node --test tests/language*.test.mjs tests/runtime-*.test.mjs
npm run test:project-files
npm run test:mcp
npm run test:agents
npm run test:data
npm run test:layout
npm run test:compute
npm run test:win32-browser
```

A focused pass does not replace the full suite. Recovery, cancellation, atomic
save, malformed-input and compatibility tests protect existing product features
and belong in the maintained suite.

## Browser validation

Browser suites require Python, Playwright and the selected browser; pixel tests
also require Pillow. Use the Playwright version and installation steps selected
in [the validation workflow](../.github/workflows/validate.yml).

```sh
python tools/browser-tests.py
python tools/browser-parity-tests.py
npm run test:classic-html
npm run test:windows
npm run test:themes:browser
npm run test:application-themes:browser
npm run test:sample-exports
```

Additional subsystem runners are exposed by `package.json`, including debugger,
project-file, MCP, coding-agent, data, layout and compute browser checks. Some
older browser runners retain historical filenames, but the useful assertions
must exercise the current implementation, not copied predecessor code.

The classic HTML runner imports the production `ToolList` directly. It checks
retained row identity, sparse updates, bounded visible rows, keyboard navigation,
ARIA and transfer between documents, alongside independent bevel pixels and
layout geometry. It does not require a historical painter or a before/after
performance benchmark.

## Fixtures, evidence and platform boundaries

Browser entry points and shared helpers in `tests/` are consumed by runners in
`tools/`; they are not discovered by the Node glob. Preserve native scalar
reference corpora, ABI fixtures and visual goldens while current tests consume
them. Check dynamic consumers before deleting apparent orphans.

Generated reports are run evidence, not executable tests. Keep local evidence out
of source changes unless it is an intentionally reviewed compatibility fixture.
The validation workflow is the source of truth for the CI matrix and uploads.

Use Windows/native runners for native compiler, debugger, COM/OCX and Win32 ABI
claims. A Node mock or browser fallback pass does not establish native parity.
Likewise, pixel results depend on the browser, fonts, DPI and rendering backend;
record those conditions rather than treating one environment as universal
certification. Report skipped or unavailable platforms explicitly.

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
