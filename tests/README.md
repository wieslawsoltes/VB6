# Current-code tests

This directory covers the current `src/`, `packages/`, `desktop/` and maintained
build/validation tools. It is not an archive of release milestones or recovery
work sessions.

## Run the tests

From the repository root, `npm test` builds and verifies the generated artifacts,
then runs every top-level `tests/*.test.mjs` file. Use Node.js 22 or newer.
For a focused run after building:

```sh
node --test tests/editor-*.test.mjs
node --test tests/debugger-*.test.mjs
npm run test:project-files
npm run test:agents
```

Browser runners live in `tools/`; see [the testing guide](../docs/TESTING.md).
The `compute-*-browser.js` entries are browser tests, not unused Node suites.
`helpers/` contains shared test adapters, and `fixtures/` contains inputs and
browser entry points consumed by Node, browser or native validation runners.
Native reference data and visual goldens are independent expected results, not
retired product implementations.

## Keep coverage tied to supported behavior

Name suites after the subsystem or behavior they exercise, without release
numbers, implementation phases or finalization labels. Put new regressions in
the owning suite rather than creating another milestone file. Retain a regression
when the bug is fixed: it protects the current behavior.

Remove one-off checks of development history, copies of retired implementations,
and assertions about another test script's wording. Exercise the implementation
or generated output instead. When consolidating suites, move useful assertions
and their inputs into the owning suite rather than losing coverage.

Recovery is also a product feature. Tests of native save journals, rollback,
coding-agent retries and compaction, cancellation, disposal and corrupt-input
handling remain necessary while that behavior is implemented. Do not delete
those tests merely because their names contain "recovery" or "legacy"; supported
file-format compatibility is different from temporary development scaffolding.

Before removing a helper or fixture, check consumers in both `tests/` and
`tools/`, including native runners and dynamically selected corpora. Run the full
Node suite and any affected browser/native runner. Do not add a replacement
meta-test that merely asserts this cleanup happened, or rewrite expected results
to hide a failing implementation.
