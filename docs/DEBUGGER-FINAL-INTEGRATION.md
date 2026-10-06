# Debugger final integration — 2026-10-06

This record supersedes the publishing status, but not the historical measurements,
in [DEBUGGER-CONTINUATION-VALIDATION.md](DEBUGGER-CONTINUATION-VALIDATION.md).
The saved continuation is now published in PR #42.

## Source provenance

The recovered commits through `f5deadfc66eabd10cd6fb1cb7e1e5146db2dd8c8` were based
on PR revision `febf578e98ccb5e72c7f3d3e0f16c3ea8b54d4a2`. Their changes were replayed
and integrated with main `6aeeae789151397c58648cd9d99678105935979f`, preserving the
newer coding-agent permission/reading-state work and native calendar, array and
callback compiler work. Only the two generated IDE bundles conflicted; those
were regenerated from the combined source rather than resolving source files
with an older copy.

Published source integration: `b41eb8bb0b70f460633872816353ed73352a080d`.
Publication run: https://github.com/wieslawsoltes/VB6/actions/runs/37436425936
PR and final merge-gate evidence: https://github.com/wieslawsoltes/VB6/pull/42

Thirteen recovered source/test/tool/document files were checked against their
before/after SHA-256 values. A separate fresh worktree replay produced the exact
reviewed Git tree `3d424fda8cb19bad95a431bc023fe0fba6de7c3b` (including its temporary
read-only snapshot workflow). CI independently matched that tree before pushing.
The publishing payload and temporary workflows were then removed. The permanent
native and three-engine browser validation workflows retain read-only permissions.

## Completed continuation

F5, design-mode Immediate and event-mode promotion share one runtime-document
loading boundary. On the native desktop, approval precedes navigation and only
the host's private preview URL namespace is accepted. No transient or fallback
`srcdoc` navigation occurs after native refusal. Late approval or failure from an
obsolete session cannot navigate a discarded frame or reset a replacement run.
The shared loader is included in native packages.

Windows packaged-IDE smoke coverage now includes design-mode arithmetic without
project startup, promotion of the same approved document into event mode, an
actual button handler, Reset, and checks that the preview remains sandboxed and
has no native IPC bridge. Existing desktop windowing and F5 smoke checks remain.

The strict live-edit rejection regression requests the strict policy explicitly,
then verifies unchanged pause/frame identity, local/global values and continuation
of the original invocation. Independent versioned-retention tests remain enabled.

## Validation and merge gates

The complete combined Node suite passed locally and in the publication run:
**2,808 tests passed; zero failures, cancellations or skips**. Build and repeated
build reproducibility passed. The first publication attempt correctly failed the
new native staging regression because it had tested before rebuilding; the retry
fixed the build order, not the test or assertion.

The final clean PR head must independently pass these permanent workflows:

- `debugger-native.yml`: portable contracts, actual Microsoft CDB with independently
  compiled Windows x86/x64 EXE/DLL fixtures, and all twelve extension scenarios
  across Chromium/Firefox/WebKit and modular HTTP/standalone HTTP/standalone file
  origins (108 extension scenario executions).
- `debugger.yml`: the existing seventeen source-debugger scenarios on all three
  engines (51 scenario executions).
- Native Windows and ARM64 packaging/launch smoke, including the new preview and
  event-mode checks in both staged and portable IDEs.
- Repository-wide compiler/runtime, core/visual/editor, IntelliSense, MCP, agents,
  data/project, Win32 and reproducibility checks.

Final-head workflow identifiers and outcomes belong to the PR's merge-gate
comment, so this document does not mistake older or inline-only results for
Windows/deployment certification. The earlier 234 local inline Chromium passes
retain their historical scope; they do not replace any of the gates above.

## Equivalence limits

The implemented native debugger controls real Windows processes through an
explicitly approved host. CDB is installed separately and is not redistributed.
Machine-level debugging of a P-code host does not reconstruct native VB6 logical
interpreter frames, locals or bytecode. Versioned source retention is not
arbitrary live object/global storage migration or native binary hot patching.
The native fixtures initialize COM but do not certify every VB6 COM/OCX scenario.
No licensed Microsoft VB6 debugger/compiler or exact native-font/pixel equivalence
is claimed. An optional licensed compiler job may remain skipped by repository
configuration; it is not counted as a passing native VB6 oracle.

See [DEBUGGER-COMPATIBILITY.md](DEBUGGER-COMPATIBILITY.md) and the reusable
[native debugger package](../packages/native-debugger/README.md) for commands,
capabilities, permission boundaries and reproducible test instructions.
