# Data compatibility continuation validation — 2026-10-05

## Source and integration

This continuation preserves the original classic IDE design and the existing
Data Environment. It integrates main through
`a344a8fa8d667adbd934e595dd618836930b2120` with the RDO branch at
`33808fb0a53fea0906347079fae9e20a67dd1ba0`, then integrates those sources with
the native-provider branch at `2fd0fad63e1df36b57321ace49472af03a3c3d11`.
Only generated files conflicted in the initial main integration; they were
rebuilt from the combined source. A final refresh incorporates remote RDO
`2d7591ca10067ea39699f98ff07ace4f86b1399d` and native-provider
`0a0b6448718e4836074b2acf1912fa1dab3c9563`. Overlapping schema-width edits
retain both signed/unsigned extensions, and all three new remote numeric sorting
tests are preserved alongside the additional mixed-Variant regression. Finished, one-time integration/transport workflows were removed.
The permanent native-provider regression and real-provider jobs remain enabled.

The previously staged native-type and Windows-path correction was recovered
against its recorded SHA-256:
`0849222e3f2e0d64893160a91e6442e8ce12b3ed7a1a5f99938beca9367e78df`.

## Corrections

- Preserve native signed/unsigned ADO schema widths and range checks. Represent
  signed and unsigned 64-bit fields with exact Decimal values, including cursor
  sorting, change detection and integer criteria. Reject already-rounded unsafe
  Number values and keep the old field/rowset unchanged when validation fails.
- Retain binary ArrayBuffer and bounded view transport, including buffers from
  another browser realm. Do not include adjacent backing-buffer bytes.
- Inventory both Windows process architectures before provider tests and execute
  every installed-provider case despite earlier failures. Keep Access ODBC's
  disposable database independent of Jet's test; report cleanup failures.
- Keep legacy Windows PowerShell fixture source ASCII-safe. Unicode test data
  remains present through explicit character construction and UTF-8 transport.
- Canonicalize native snapshot destination ancestors and use fileURLToPath for
  source inventory on Windows. Snapshot containment is not a security boundary
  against concurrently hostile filesystem changes.
- Wait for the deferred REST error-label repaint without weakening either the
  required error 3197 assertion or the server-side lost-update check.

## Local results

Environment: Linux, Node.js 22.16.0, Python 3.13.5, Chromium 144.0.7559.96.

| Check | Result |
|---|---|
| Full Node suite | 2,303 passed, 0 failed, 0 skipped |
| Data-specific Node suite | 173 passed; included in the full count |
| Exported application / Data Environment scenarios | 6 passed in Chromium |
| Data Link Properties geometry, keyboard, persistence and Cancel | 2 passed, 1440px and 580px |
| Compiled ADO / DAO / RDO exported programs | All three programs passed in the Chromium harness |
| Core IDE/browser regression scenarios | 36 passed |
| Repeat build | 51 tracked generated/example files byte-identical |

The RDO-only integration also passed 2,272 Node tests and its exported
ADO/DAO/RDO Chromium harness before native-provider changes were added.

## External validation still required

Remote native-provider run 37329393271 on `2fd0fad...` passed its actual Linux
SQLite ODBC job. Its Windows job failed on unsupported schema field types and
Windows path regressions. Those results precede the changes above; they are not
validation of this continuation.

The corrected Windows Jet/ACE/OLE DB/MSDASQL jobs, current Linux ODBC job, current
PostgreSQL/MySQL/SQL Server jobs, Firefox/WebKit matrix, Windows/ARM64 packaging
and optional licensed Microsoft VB6 compiler have not been executed for these
local commits. The portable tests and provider-orchestration unit tests do not
certify those native integrations.

The additional local commits still require publication and successful exact-head
CI before merge. PR #27 and PR #29 remain open. The latest retrieved remote PR
#29 checks on `0a0b644...` report `action_required`, not a passing validation.
The RDO source tree at `2d7591c...` is byte-identical to the separately validated
local RDO integration; it does not need an additional code-only update. No complete ADO/DAO/RDO/native VB6 or standalone Win32 AOT data parity is
claimed. Installed proprietary providers still require matching architecture,
installation and applicable licenses; they are not redistributed here.
