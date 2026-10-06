# Coding-agent recovery and context compaction

Open **Tools > AI Coding Agents**. This retains the classic VB6 Task, Connection
and Permissions tabs, beveled controls, MDI/detached window behavior and existing
approval workflow. It does not install a shell agent or change MCP permissions.

## Recovering a failed turn

A provider failure is not necessarily a failed project. The agent distinguishes a
recoverable generation request from IDE operations which may already have run.
Completed edits and their native results stay in memory. Retrying a generation
request does not resubmit those operations. The model can still propose a new
operation; normal permission and revision checks apply to every proposal.

Recognized transient HTTP/SSE failures, network errors, request timeouts and
premature stream EOF receive bounded retries with exponential backoff and jitter.
The Task thread shows each interrupted attempt and its reconnect delay separately,
not as a fabricated successful answer. A partial tool call never executes. After
the retry allowance is exhausted, **Continue** offers a new reviewed run from the
last complete context. Unknown valid provider failures require manual Continue
rather than blind automatic retries.

Authentication/access, quota/billing and invalid-request/model-setting failures
pause for manual repair. Correct the Connection/Permissions settings and review
Continue; do not repeatedly send an unchanged request. Safety rejections, malformed
JSON/UTF-8/protocol blocks, cancellation, denied operations and uncertain partially
applied batches stay blocked. The runner never changes revision guards to make a
stale edit succeed. It does not switch models or providers to evade a rejection.

Only exact allowlisted error codes and a few bounded context-limit message forms
are classified. Raw upstream error messages, IDs and bodies are not displayed or
logged. The loopback relay returns the same canonical classifications, retaining
its fixed official endpoints, server-side keys, exact-origin/token checks and
concurrency/size bounds. Missing relay credentials are a configuration error, not
an endlessly retried HTTP 503. The old generic failure log cannot establish the
upstream cause retrospectively; an omitted error code cannot be recovered.

**Retry-After is a deadline, not permission to run longer.** Automatic waits are
bounded; a cooldown longer than five minutes is kept as a full future deadline
and requires a later Continue. A deadline beyond the current permission lease
pauses without sending or renewing authority. Stop, revoke, workspace replacement
and lease expiry cancel both active I/O and backoff. Continue always requires the
normal fresh confirmation, including full-access acknowledgement where applicable.

## Compacting a long task

Use **Compact context**, or type **`/compact`** alone into the message composer.
The command is handled locally, not sent as a provider prompt. Confirmation
explains that generating a checkpoint can incur usage and lose older detail.
Other unsent draft text is not uploaded by the toolbar action. Manual compaction
makes no IDE tool calls; it returns to a paused task for reviewed Continue.

Automatic compaction is enabled by default. Before a request, the runner considers
estimated active input size, the latest reported input usage plus subsequent
history growth, the configured byte bound and an optional model context window.
A recognized provider context-overflow response permits one checkpoint-and-retry
recovery within a run. A repeated overflow pauses instead of looping. Setting
Automatic compaction input tokens to zero disables automatic compaction, including
that overflow recovery; manual Compact context remains available.

A checkpoint request contains the exact original user goal and latest request,
the current model-reported plan, and a bounded projection of public conversation
text and completed tool requests/results. Large historical records are explicitly
excerpted; oldest records can be omitted with a count. The summary is requested
without tool definitions and instructed to separate confirmed operations from
claims, preserve constraints and next steps, and re-read live state before edits.
Opaque reasoning, encrypted content and native thought signatures are **not**
summary input. The original goal/latest request are not silently truncated.

The summary is only a historical aid, never a new user instruction, permission
grant or proof of success. It can omit or misstate older details. The retained
native suffix preserves recent complete turns, including paired tool calls/results
and signatures. If a smaller suffix is needed to fit, cuts occur only at recorded
complete-turn boundaries, never halfway through a native tool batch. Recent
native signature blocks are not rewritten or reconstructed.

**Replacement is atomic.** The complete nonempty tool-free summary must produce a
smaller request within the configured bounds before history is changed. Failed,
malformed, cancelled, tool-bearing or non-shrinking checkpoints leave the original
history intact. A fully validated but unexecuted deferred batch remains deferred,
with its original arguments and revision guards; neither summary generation nor
Continue re-bills/re-generates that batch. A request which reached an output limit
still requires a larger effective output allowance after compaction.

Compaction does not change project Undo history, reset the public transcript,
clear the plan, reset cumulative usage, increase limits or renew permissions.
An enormous original goal, static tool catalog, output reserve or pending batch
can still prevent a useful checkpoint from fitting. Review settings and reduce
scope; **New Task with Context** remains an explicitly reviewed fallback.

## Settings and accounting

**Permissions > Recovery and context compaction** adds independently validated integer
preferences. Only numeric preferences persist; no credentials or task content do.

| Setting | Default | Range | Meaning |
| --- | ---: | ---: | --- |
| Automatic generation retries | 3 | 0–10 | Additional attempts for a recognized transient generation failure; zero selects manual recovery. |
| Automatic compaction input tokens | 64,000 | 0–2,000,000 | Active-context trigger, not cumulative billed usage; zero disables automatic compaction. |
| Model context window tokens | 0 | 0–4,000,000 | Optional user-specified input plus output capacity; zero means unspecified, not unlimited model capacity. |
| Recent complete turns to retain | 2 | 0–16 | Preferred native suffix after a checkpoint; fewer complete turns may be retained to fit. |
| Checkpoint output tokens | 2,048 | 256–8,192 | Summary output allowance, also constrained by normal output/session limits. |
| Tool result bytes | 16,000 | 512–120,000 | Maximum bounded tool-result JSON budget; actual available space can require less. |

The active-context estimate uses serialized UTF-8 bytes divided by three. It is
**not a model tokenizer or capacity guarantee**. Providers tokenize differently;
set the optional model context window from the actual selected provider/model's
specification and choose a compatible output limit. The native request byte cap
is a separate application safety bound. Last reported input tokens, native KiB
and checkpoint count are displayed separately from cumulative task usage.

Every generation attempt—including a failed attempt, reconnect and checkpoint—
consumes a request allowance and its reported input/output usage. Unknown usage
retains the existing separately labelled conservative byte/public-text estimate;
it is not treated as zero or billed-token evidence. Budget exhaustion prevents a
new attempt/wait; compaction cannot clear spending. A request can exceed remaining
allowance and cancellation need not stop upstream billing. Use provider billing
controls for monetary limits. Per-run retry/request allowances are not infinite
background jobs, and the permission lease remains independently binding.

## Codex CLI comparison and sources

Reviewed October 6, 2026, using primary sources:

- [Codex CLI compaction implementation](https://github.com/openai/codex/blob/main/codex-rs/core/src/compact.rs).
- [Codex configuration reference](https://developers.openai.com/codex/config-reference): retry controls, `model_context_window` and `model_auto_compact_token_limit`.
- [Codex slash commands](https://developers.openai.com/codex/cli/slash-commands): explicit `/compact` workflow.
- [Unrolling the Codex agent loop](https://openai.com/index/unrolling-the-codex-agent-loop/): active context, compaction and the evolving native compaction path.

The transferable behaviors are bounded reconnects, cancellation-aware waits,
independent active-context accounting, manual/automatic checkpointing, preservation
of the user's goal, and staged replacement only after successful compaction.
This is an original JavaScript implementation adapted to the browser IDE's
three native provider protocols and revision/permission model, not copied Rust.

Codex also has an OpenAI-native `/responses/compact` path with opaque encrypted
compaction output. This implementation instead uses a tool-free public checkpoint
through each configured provider's normal generation API. It does **not** claim
full Codex CLI parity, encrypted remote compaction, host shell/disk access,
provider-side exactly-once billing, arbitrary tool replay, or durable CLI resume.

Tasks and checkpoints remain **memory-only**. Save/export the project before
refreshing the browser to load an update. Refreshing cannot reconstruct an old
failed task's omitted native context from a screenshot or public transcript;
start a new task against the saved live project and ask it to inspect existing
work instead of repeating completed edits. A saved transcript is an audit, not a
credential-bearing resumable session file.

## Validation

Run `npm run build`, `npm test` and `npm run test:agents`. The dedicated
`tests/coding-agents-compaction.test.mjs` exercises all three provider protocols,
retry exhaustion, request/budget accounting, terminal safety/protocol failures,
Stop/revocation/lease expiry, full retry deadlines, private-field filtering,
checkpoint rollback, output-limit guards and deferred-batch no-replay behavior.
Relay tests verify canonical error classification without forwarding private data.

Run `python tools/coding-agents-browser-tests.py --browser chromium`, and repeat
with `firefox` and `webkit`. The normal CI matrix tests HTTP, standalone HTML over
HTTP and standalone file origins. Cases include real IDE mutations followed by
reconnect, all-provider Compact context, `/compact`, unsent-draft protection,
accounting, approval review and Stop during backoff. Native provider fixtures are
deterministic test doubles; these tests make no paid provider calls. The existing
`--opaque` option is only a UI fallback for restricted test environments, not
proof of HTTP/file-origin coverage and not used by the normal CI matrix.
