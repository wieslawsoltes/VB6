# IntelliSense validation record

Recorded during [PR #23](https://github.com/wieslawsoltes/VB6/pull/23), 2026-10-05. See [IntelliSense documentation](INTELLISENSE.md) for commands, reference descriptors and compatibility boundaries.

## Reproduced results

The implementation was integrated with main revision `5f64aea7b9b54d90043096a90128439399da9615`, preserving the separately landed coding-agent, data-source and native-build changes.

- `npm run build` succeeded and the generated distributions were committed.
- The full combined Node suite passed **1,617 tests**, with zero failures or skipped tests, both in CI and locally from the uploaded source snapshot.
- [Integrated browser run 37301331303](https://github.com/wieslawsoltes/VB6/actions/runs/37301331303) passed **54 scenarios**: 18 in each of Chromium 143.0.7499.4, Firefox 144.0.2 and WebKit 26.0.
- The final read-only [IntelliSense matrix run 37301864385](https://github.com/wieslawsoltes/VB6/actions/runs/37301864385), at head `776ffe894ebddecf5dd1fa86786a9b8111202883`, repeated those browser checks and verified generated-bundle reproducibility in each browser job.

The 18 scenarios cover member completion; Enter/indent/undo; punctuation chaining; identifier suffix replacement; nested With in split/procedure views; constant lists and parameter hints; nested-call hints; comments/literals; qualified types; options/read-only guards; accessible virtual lists; stale candidates; a 50,000-line source; guarded break-mode data tips; Immediate completion without execution; reference import/Object Browser integration; selected-frame expression completion without runtime calls; and IME completion resumption.

The broader detached-window regression explicitly checks **Tab commit, undo, Enter commit plus indentation, and caret position**. Its former assertion expected Enter to commit without inserting a line, which is no longer the classic source-editor contract. The existing Object Browser signature regression now asserts the complete typed DateDiff signature, including Optional enum parameters and its Long return type, rather than the previous untyped display. Neither test is disabled or skipped.

## Observed large-source behavior

In the integrated same-runner test, the first completion query in a 50,000-line module took 27.6 ms in Chromium, 28 ms in Firefox and 32 ms in WebKit. Subsequent prefix typing reused the declaration index. The native source projection remained at 256 rows and completion rendering is bounded to 13 rows.

These are individual CI observations, not hardware-independent latency guarantees or a claim that full-buffer edits have constant cost. Browser reports retain the measurements from every run.

## Reproduction and merge checks

```sh
npm run build
npm test
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium firefox webkit
VB6_BROWSER=chromium python tools/browser-intellisense-tests.py
VB6_BROWSER=firefox python tools/browser-intellisense-tests.py
VB6_BROWSER=webkit python tools/browser-intellisense-tests.py
```

The repository's existing Validate, compiler/runtime, project compatibility, data, coding-agent, MCP, icon and native build workflows remain separate checks. Consult the [PR checks](https://github.com/wieslawsoltes/VB6/pull/23/checks) for final-head results; this record of the focused suite does not substitute for those checks. The IntelliSense workflow is read-only; no temporary test-migration or source-integration helper remains in the reviewed tree.

No native Microsoft VB6 screenshot/type-library certification, physical-IME certification, or native COM/OCX execution is claimed by these tests. Automatic completion is metadata-only; supplying a reference descriptor does not implement its runtime objects.
