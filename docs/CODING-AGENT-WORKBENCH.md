# Local change review and queued follow-ups

Open **Tools → AI Coding Agents…**. The existing classic VB6 tool window now has
**Changes** and **Queue** tabs, plus **Queue message** beside the composer.
These are local user workflows, not new model-controlled permission tools.

## Queue messages without interrupting a run

Type the next request while the current agent is working and select **Queue
message**. This moves the exact draft into this task's local queue and clears
only that draft. The queue is not part of the current provider request, tool
results, or native conversation history. It never sends automatically and is not
live steering of the current turn.

The **Queue** tab displays the pending messages and the selected text. **Edit
selected message…**, **Remove selected message**, **Move up** and **Move down**
operate locally, including during generation. A queue edit dialog is independent
of the running request. Cancel discards that dialog edit, not the queued message.
Each task can hold 16 messages, at most 100,000 characters each and 200,000 total.
Exceeding a bound fails without dropping existing messages.

When the task is new or completed, **Send selected message…** opens the normal
provider/model, token budget and permission confirmation for that exact queued
message. Other unsent composer text is not included or overwritten. Cancelling,
missing the Full IDE access acknowledgment, stale queue contents, or failed
engine preflight keeps the message queued. It is removed only when accepted into
the task's public/native history. A later provider error can therefore leave the
message in history rather than in Queue; retry/Continue follows existing recovery
rules and must not duplicate that accepted prompt.

A paused, denied, cancelled, failed or previous-workspace task cannot dispatch a
queued follow-up instead of resolving/replacing its current run. Messages bind to
the workspace at enqueue time, even before the first provider request; editing an
old message does not retarget it to a replacement or reloaded project. Use **Continue**
where supported, or create a new task. Reordering messages does not cause FIFO
execution: the user selects and confirms each message. Nothing carries a run-wide
approval or Full-access acknowledgment into a subsequent run.

Queue contents and composer/review drafts are independent per task. They survive
closing/reopening the panel within the same page, but not a page reload. Closing
the panel still cancels running work and clears credentials. Deleting a task
clears its queued messages and review checkpoints; project edits remain in Undo.
Queues are not serialized into projects, layouts, browser storage or transcripts.

## Changes: current project against local checkpoints

A confirmed Run/Continue captures module source and serialized designer trees
locally just before the provider/tool loop. Choose **Since this task started** or
**Since the latest run started**. **Refresh changes** compares the current local
project against that checkpoint. Switching to Changes refreshes it too. Captures
are not repeated for each streamed token, and nothing is automatically sent to a
provider by opening/refreshing this view.

This is a project-state difference, **not agent-only attribution**. It includes
manual changes and edits made by other tasks after the checkpoint. Changes made
before the first run are the baseline, not changes to undo. Continued runs keep
the initial checkpoint and replace only the latest-run checkpoint.

The review includes module source, additions/removals/renames in the module
inventory, and form/control/menu designer JSON. It does **not** claim to cover
native project/FRX files, resources/assets, virtual disk, data definitions,
settings, runtime state, external effects, Git branches or staged/uncommitted
repository status. Designer paths ending in `.designer.json` are synthetic review
documents; source `.frm` paths represent module code, not complete native VB6 form
files. This is not a native-project export or a Git worktree.

Choose **Unified diff** or **Before / After**. Unified lines show old/new line
numbers and textual +/− markers; added lines use the classic information color
and removed lines are struck through. All source is inserted as text, never HTML.
Selecting a diff line targets feedback to that line. **Open document** opens the
current module in the regular code/form editor. **Save review patch…** exports a
text patch of the complete captured source/designer differences, including exact
line endings and missing-final-newline markers. Review exports may contain source
or secrets in that source; keep them private as appropriate.

Snapshots retain at most 2,000 documents and 4,000,000 text characters, with a
500,000-character per-document limit. Oversized documents are explicitly **not
compared**, not silently truncated. Capped inventories cannot prove an unlisted
document was added or deleted. Such entries are marked omitted in patch exports
and can never be restored. The two checkpoints share their initial snapshot;
all data is memory-only and bounded independently of provider context.

The line-diff matrix is capped at 250,000 cells. Large changed middles use exact
replacement lines rather than an unbounded quadratic diff. Newline-dense files
use bounded Before/After previews without allocating unbounded per-line DOM
objects; their patch export still contains the complete captured replacement.
The ordinary unified view initially renders 500 changed/context lines and supports
**Show more diff lines**. Side-by-side previews show at most 20,000 characters
per side, with an explicit notice and complete captured patch export available.

## Review feedback

Write feedback in Changes, optionally after selecting a diff line, then choose
**Queue review feedback**. This creates a local queued follow-up naming the review
document and old/current line. Quoted code is labelled untrusted snapshot data;
the message asks the agent to re-read current source/revision and preserve
unrelated edits. The feedback draft remains tied to its document and task, rather
than silently targeting a different file when selection changes.

Feedback does not authorize changes or immediately spend tokens. Send it from
Queue through the usual fresh permission confirmation. A previous-workspace review
cannot enqueue feedback into its stale task.

## Restore reviewed source

**Restore source…** is a manual local user action, not an agent permission tool.
It restores only the code of an existing, unrenamed module to the selected
checkpoint. The local confirmation explicitly warns that reviewed differences may
include manual/other-task changes. It preserves designer structure, every other
module, all other project fields and normal source bookmark remapping.

The project must still be in design mode with no active agent, and the exact
review revision, task, workspace epoch, module identity/type/name and reviewed
current source must still match after confirmation. Any intervening edit,
same-ID reload, replacement, active runtime or cancelled dialog refuses the
restore. Refresh and inspect the new diff instead of bypassing that protection.
A successful restore creates one ordinary **Restore reviewed source …** Undo
entry. Normal Undo/Redo still applies. Restoring does not rewrite a deferred model
tool's expected revision; it can correctly make a future deferred edit stale.

Structural module changes and designer changes cannot be restored by this action.
Use normal IDE editing/Undo after reviewing them. No whole-project reset, shell
command or automatic side-effect rollback is offered.

## Validation and references

`npm run test:agents` includes bounded queue/snapshot/diff tests, optimistic queue
versions, no automatic provider exposure, task isolation, exact line reconstruction,
stale/same-ID restore rejection and checkpoint lifecycle. The normal
`tools/coding-agents-browser-tests.py` suite adds actual queue dispatch for all
three providers, queue editing during generation, fresh Full acknowledgment,
queue confirmation races, task/panel persistence, source restore/Undo, stale/reload
refusal, inert source rendering, patch download and targeted review feedback.

Original implementation informed by these official design references, reviewed
2026-10-06; not copied Codex implementation code:

- Codex code review: https://developers.openai.com/codex/app/review/
- Queue versus Steer: https://developers.openai.com/blog/mastering-codex-remote-for-engineering

Unlike Codex's queued automatic-next-turn option, this implementation deliberately
requires an explicit local confirmation for each dispatched follow-up. It does
not implement live steering, Git staging/worktrees, cloud agents, OS sandboxing
or universal Codex parity. See CODING-AGENT-PERMISSIONS.md for the independent
permission boundary, revocation semantics and Full IDE access limitations.

## Desktop preview integration

Run and design-mode Immediate use the shared opaque-frame document loader
merged from debugger PR #42; this workbench integration preserves that implementation.
The desktop host supplies a `vb6://app/preview/` handle before any runtime HTML is
assigned to the iframe. Desktop frames never temporarily navigate through `srcdoc`,
which inherits the controller's restrictive script policy. The native host still
serves per-document script hashes; no `unsafe-inline`, same-origin sandbox flag,
Node integration, or broader IPC permission is added.

A delayed document reply cannot load a stopped/reset/replaced runtime. Host
rejections are displayed, and the frame is discarded instead of falling back to
inline execution. Browser builds retain their existing sandboxed `srcdoc` path.
The same loader serves debugger/runtime operations invoked through agent tools;
this changes document transport, not the selected permission profile.

The native smoke harness checks actual Run and Immediate execution, the absence
of `srcdoc` writes, opaque sandboxing, and lack of native bridge access. Browser
regressions cover the generic host hook, delayed replies across Stop and same-ID
project reload, and failed initialization. Generic browser-host doubles are not
represented as native Windows certification.

## Recovery and context compaction integration

The recovery controls and automatic/manual context compaction remain available
alongside Changes and Queue. A manual context checkpoint does not advance either
source-review baseline, consume queued messages, upload the composer draft or
grant tools. A confirmed new run/Continue still captures the latest-run baseline.

The local `/compact` command is handled only when sending directly from the
composer. Sending a selected queued message never reads the unrelated composer
draft as a command. Queue entries are literal messages, including `/compact` if
explicitly queued; the normal start confirmation previews that text. Use the
**Compact context** button for a separate, tool-free context checkpoint.

See [recovery and compaction](CODING-AGENT-RECOVERY.md) for retry accounting,
complete-turn retention, model-context limits and fallible checkpoint boundaries.


## Selective restoration and review state

The Changes tab includes **Previous change**, **Next change**, and **Restore selected
change…**. A change block is a consecutive run of inserted/deleted lines; unchanged
lines separate independently restorable blocks. Selecting an inserted/deleted diff
line also selects its block. A confirmation shows the exact current and checkpoint
block (large previews are labelled as shortened). Cancelling does not change source.
Restoring records one normal Undo entry and preserves every other source change in
the module, designer properties, other modules, and unrelated project fields.

This is local source restoration, not Git staging, an agent permission grant, or an
automatic provider operation. It has the same idle/design-mode, workspace-epoch,
revision and exact-current-source checks as complete module restoration. Concurrent
edits anywhere in the module reject the operation instead of fuzzy matching offsets.
Renamed/added/removed modules and omitted captures cannot be selectively restored.
Large diff middles may be shown as one explicitly labelled coarse replacement;
newline-dense sources over the interactive limit offer full-source restore only.
Exact UTF-16 offsets preserve Unicode, CRLF/LF, and missing-final-newline state.

The review now warns when the project or checkpoint changes. Restore and review
feedback actions are disabled until **Refresh changes**. Invalidation observes the
existing coalesced revision notifications: it does not serialize the project or
recompute a diff on each streamed token. Refresh keeps your feedback draft. A saved
line target survives unchanged refreshes, layout changes, task switching, and panel
reopening; if either captured text changes, the old target is cleared rather than
silently moved to another line. Select a current line again or queue file-level
feedback. An unchanged queued-message preview is not rebuilt on every update.

Each task retains its review scope, selected document/block, diff layout, expanded
line count, scroll position, feedback draft/target, and selected queued message while
this page remains open. New tasks start with independent defaults. Reset/deletion
releases the presentation state. Nothing is persisted across browser refresh or
exported with the project, and no credentials or grants are copied.

Validation includes randomized exact offset reconstruction, insertion/deletion and
mixed-ending cases, stale revision/workspace rejection, normal Undo and Cancel,
unchanged refresh/reopen targets, stale-feedback invalidation without recapturing,
and independent task/queue selections. Existing full permissions, manual queue
dispatch, provider recovery, and context-compaction tests continue to run.
