# Testing VB6 Studio Web

Tests exercise the current checkout and its generated artifacts. Historical
release totals, screenshots and recovery-session reports are not evidence that
the current code passes. Use the output of a fresh run and the checks attached to
the exact commit or pull request.

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
