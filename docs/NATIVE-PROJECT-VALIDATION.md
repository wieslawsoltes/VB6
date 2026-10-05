# Native project integration validation

Validated on 2026-10-05. See [Original VB6 projects and groups](NATIVE-PROJECTS.md) for user commands, file formats, safeguards and compatibility boundaries.

## Integration and provenance

PR #1 implements native VBP/VBG opening and saving alongside browser project formats. The interrupted implementation was recovered with input/output digest checks and committed as `00e442b5db6b86853999b4508a4c1d31ef977d57`. Application sources were pushed separately from workflow changes; both temporary recovery workflows were then removed.

While PR #1 was undergoing final checks, PR #9 merged as `693485b52593855645229f8902b24cc26b393306`, already incorporating the same recovered native-project implementation. The final reconciliation retains that integrated main tree, including its Win32 build and desktop-window changes. The native project modules and tests were compared against the recovered source digests; the IDE entry changes retain both native-project and native-build installation. The existing FRX regression uses the scoped native entry/encoding dialog and retains its original resource and runtime assertions.

The reproducible project-compatibility source artifact includes `LICENSE`, which is required by the native staging regression. Downloaded artifacts are not complete Git clones and do not contain repository history.

## Validation performed

| Check | Result |
| --- | --- |
| Browser/runtime and standalone builds | Passed |
| Focused native project and directory tests | 90 passed, 0 failed |
| Full combined source Node suite, including integrated Win32 tests | 1,209 passed, 0 failed |
| Existing FRX, RichTextBox, binary file and data-grid browser regressions | 14 passed, 0 failed |
| Native HTTP and standalone file-origin workflows | Passed in Chromium, Firefox and WebKit |
| Generated distribution reproducibility | Passed in project-compatibility CI |

The native browser workflows exercise actual file-input imports, ZIP downloads/reopening, source editing, designer changes, native settings, browser snapshot conversion, project-group switching and per-project undo/redo, missing and opaque files, cancelled operations, failed-save discard protection and edits during asynchronous reads. Directory coverage uses writable origin-private filesystem handles where available and checks overwrite cancellation and external-edit conflicts. It does not automate a physical OS directory picker. Directory tests on file origins are explicitly skipped; this is not recorded as filesystem certification.

Evidence:

- Recovered source, build and Chromium HTTP/file validation: https://github.com/wieslawsoltes/VB6/actions/runs/37279948330
- PR #1 cross-browser native project and reproducibility checks: https://github.com/wieslawsoltes/VB6/actions/runs/37280128089
- Integrated source cross-browser validation before PR #9 merge: https://github.com/wieslawsoltes/VB6/actions/runs/37274159651
- Integrated compiler/runtime regression suite: https://github.com/wieslawsoltes/VB6/actions/runs/37274159622

The final PR and main checks remain authoritative for their exact commit; the run links above record the implementation checkpoints rather than claiming future runs passed.

## Reproduce

```sh
npm run build
npm test
npm run test:project-files
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium firefox webkit
VB6_BROWSER=chromium npm run test:project-browser
VB6_BROWSER=firefox npm run test:project-browser
VB6_BROWSER=webkit npm run test:project-browser
```

Set `CHROMIUM_PATH` when a specific Chromium executable is required. `VB6_TEST_TRANSPORT=memory` is a separate restricted-environment smoke mode, not a substitute for HTTP/file validation.

## Scope of the result

These checks validate native file preservation and the implemented browser open/edit/save workflows. They do not certify every proprietary OCX/designer persistence format, native cross-project COM debugging, original VB6 IDE window-state restoration, Windows locale behavior, or a licensed Microsoft VB6 compile/reopen cycle. Opaque data remains preserved and unsupported destructive edits are rejected. A multi-file folder save is not an atomic filesystem transaction; errors retain unsaved state and report partial completion.
