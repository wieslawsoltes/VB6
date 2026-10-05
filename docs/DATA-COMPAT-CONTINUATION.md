# Data compatibility continuation — 2026-10-05

## Published source and integration

The saved local continuation `352ebd6f961c4f199d2db07af7f831f615cc7fbd`
is now published in the RDO feature branch. Publication commit
`110d7e3b53e26604b63c83fae84d480dd6b4c049` preserves installed-provider
PR #29 (merged as `676a68eb154106363559728d9382eb03dc403d21`) and main
through `29c77082c9bf854c7f6fbbf3ed63d5277036b761`.

The restored source delta was verified against SHA-256
`98e324b928b6ca151f7ae5a67c3c031980956d621bee302e2aa46c52d9f83ba6`.
Only generated application files conflicted with main; they were rebuilt from
the combined source. The updated Win32 calls and GDI region validation workflows
were retained without dropping debugger, IntelliSense, coding-agent or runtime
changes. No force-push was used.

All 733 tracked files in the locally validated combined tree matched the
publication artifact's Git blob and mode inventory. The artifact additionally
contained the one-time publication workflow, which was subsequently removed by
`4e7c3614c604a6d1f76c2b13420ed44dc1b6c3cd`. This document replaces the older
pre-publication report; implementation and application bundles are unchanged.

The source transport, completed diagnostic workflow, temporary publisher and
source-recovery capture job are removed. Permanent native-provider and browser
checks remain enabled. The classic IDE design and Data Environment styling are
unchanged.

## Compatibility corrections

- Preserve signed/unsigned ADO field widths and exact 64-bit values during
  assignment, sorting, change detection and integer criteria. Reject unsafe
  already-rounded Number inputs. Failed validation preserves the previous
  field and rowset state.
- Preserve ArrayBuffers from other browser realms and bounded binary views
  without including bytes outside their selected range.
- Inventory both Windows host architectures before testing installed providers;
  collect all provider outcomes instead of stopping at the first failure.
  Access ODBC uses its own disposable fixture. Cleanup failures are reported.
- Retain ASCII-safe legacy PowerShell source while testing genuine Unicode
  values over UTF-8 transport.
- Retain canonical Windows snapshot paths and fileURLToPath-based source
  inventories. Filesystem containment is not a security boundary against a
  concurrently hostile filesystem.
- Wait for the deferred REST conflict-label repaint while retaining the error
  3197 assertion and the server-side lost-update protection assertion.

## Combined validation

The publication workflow rebuilt the integrated apps and passed the complete
Node suite before pushing source:
https://github.com/wieslawsoltes/VB6/actions/runs/37354027515

| Check | Result |
|---|---|
| Full Node suite, local and publication runner | 2,400 passed; zero failures or skips |
| Data-specific Node suite, included above | 173 passed |
| Exported applications and Data Environment, Chromium | 6 scenarios passed |
| Data Link Properties keyboard, persistence, Cancel and geometry | 2 cases passed, 1440px and 580px |
| Compiled ADO, DAO and RDO exported programs | All passed in the Chromium harness |
| Core IDE/browser scenarios, Chromium | 36 passed |
| Repeat build | Tracked generated apps remained byte-identical |
| Published source inventory | All 733 local tracked files matched before this report update |

Local environment: Linux, Node.js 22.16.0 and Chromium. The previous report's
2,303-test total described the saved pre-publication snapshot; the 2,400-test
result includes newer main changes.

## Native validation provenance and boundaries

Before its integration, PR #29 head
`d7a987f6a915cdad011319e1a0672607853bdb9b` passed all 18 workflows,
including native providers and live database gateways:

- https://github.com/wieslawsoltes/VB6/actions/runs/37346951503
- https://github.com/wieslawsoltes/VB6/actions/runs/37346951367

Those runs precede the additional saved continuation and are not certification
of the combined head. Exact final-head checks and their installed-provider
reports are recorded in PR #27 before its main merge:
https://github.com/wieslawsoltes/VB6/pull/27

Portable and Chromium results do not substitute for installed Jet, ACE, OLE DB,
MSDASQL, ODBC, other browser engines or Windows/ARM64 execution. Provider reports
must distinguish unavailable architecture/provider combinations from tested
passing combinations. Proprietary providers and the Microsoft VB6 compiler
require their own installations and applicable licenses; they are not
redistributed or universally certified here.

This work does not assert complete ADO/DAO/RDO/native VB6 parity, native server
cursor or pessimistic-lock equivalence, output/return parameter support, or
arbitrary data-object execution in the separate standalone Win32 AOT compiler.
