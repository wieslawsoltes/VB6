# Coding-agent conversations and session budgets

Open **Tools > AI Coding Agents > Task**. The conversation is a chronological thread of user messages, public agent replies, tool operations, questions, plans and lifecycle notices. It uses the IDE's classic VB6 palette, beveled controls, fonts, tabs, MDI host and detachable window support—not a separate modern chat skin.

## Conversation behavior

A request has a visible waiting entry before its first public text arrives. Text deltas update that entry in place; the provider's completed reply reconciles the same entry, rather than appending a duplicate. A tool-only response displays its pending/executing operation in the Task tab without requiring a switch to Activity. Expand a tool step to read its arguments and confirmed result. Operation approval, denial, failure and interruption have distinct states. Plans are explicitly model-reported, not validation evidence.

The message composer stays available for drafting while a task runs. Enter sends after the existing Start Task confirmation; Shift+Enter inserts a line. IME composition does not send. Stop generation cancels the runner and outstanding authorization. Closing/reopening the panel keeps the task's public partial reply and unsent draft in memory, but clears connection credentials as before. Partial replies are labelled interrupted, not final answers. Save Transcript includes this public thread and the activity audit; it does not serialize opaque provider histories, signatures, credentials or grants.

Completed replies support a bounded, text-only Markdown subset: paragraphs, headings, lists, inline code, bold text, fenced code blocks and HTTP(S) links. Copy buttons copy messages or code without executing them. Model HTML, images, embeds and script links are not rendered as active content. Very large formatting workloads fall back to literal text. The renderer neither requests nor displays private reasoning or opaque native signatures.

Following the newest message scrolls automatically. Scrolling upward freezes the visible window and preserves existing message elements, text selection and expanded tool details. **Jump to latest** or scrolling to the bottom restores following immediately, including replies that finished while you were reading an older window. Task switching, hidden tabs and panel reopen retain each task’s reading position and expanded tools in memory. Pruning anchors to the actual visible message; resetting the same task clears its old view. Initially the latest 150 entries are mounted; **Show earlier messages** loads another 100. The public task model keeps at most 1,200 entries and four million accounted characters; each public field preview is capped at 262,144 characters. Omission/truncation is explicit and does not rewrite native provider context or undo project changes.

## Limits

**Permissions > Session budget and run limits** has Conservative, Extended session and Large session presets plus independently editable integer fields. Extended session is the new default:

| Setting | Previous default | Extended default | Large preset | Application maximum |
| --- | ---: | ---: | ---: | ---: |
| Session token allowance | 200,000 per run | 4,000,000 per task | 20,000,000 | 100,000,000 |
| Requests per run | 16 | 128 | 512 | 2,048 |
| Tool calls per run | 128 | 1,024 | 4,096 | 16,384 |
| Output tokens per request | 8,192 | 32,768 | 65,536 | 262,144 |
| Request context bytes | 1,500,000 | 6,000,000 | 12,000,000 | 16,000,000 |
| Generation timeout | 2 minutes | 10 minutes | 15 minutes | 30 minutes |

These are application ceilings, **not a promise of a model's capabilities or a hard billing cap**. A provider may impose smaller output/context limits, account quotas or shorter upstream/proxy timeouts. The byte ceiling is a UTF-8/JSON safety bound, not a tokenizer-derived model context window. The eight-MiB provider response cap remains unchanged. A model-catalog request is capped at two minutes even with a longer generation timeout. Use a smaller output limit when the selected model rejects a larger request.

The token allowance is cumulative within a task. Follow-ups and Continue retain usage; they do not silently replenish it. The composer displays cumulative reported tokens, remaining allowance, requests, tools and context size. After exhaustion, raise the task's allowance explicitly or create a new task. Per-run request/tool ceilings and permissions are separately reviewed by Continue. It sends completed native tool results without reapplying those operations.

Usage is taken from provider-reported totals (including relevant cache/reasoning usage fields), not merely from visible text. Reported usage on failed/incomplete responses is retained. Missing usage is **unknown, not zero**: the UI separately labels a conservative request-byte/public-text safety estimate, includes it in the allowance, and does not call it billed usage. Actual input and hidden output usage are not known before a request completes, so one request can exceed the allowance. An explicit retry can also incur charges for the failed request. Review provider billing separately.

Numeric limit preferences alone can persist in browser storage under `vb6.codingAgents.limits.v1`. Each in-memory task keeps independent settings; new tasks inherit the latest preferences. No task messages, API keys, model history, connection settings or permissions are stored with them. Corrupt/unavailable storage falls back safely to defaults. Token-limit changes do not extend the separately confirmed permission lease, remove its approval rules or enable external MCP access. Permission leases default to ten minutes and are independently configurable under the host ceiling.

The local relay accepts the same bounded context size and validated generation timeout, but retains fixed official provider destinations, loopback-only binding, exact-origin checks, authentication, no credential forwarding from the browser, four concurrent requests and bounded responses.

## Limit recovery

The Task tab shows a classic **Review limits… / Resume task** notice when work pauses. Review limits focuses the relevant numeric setting. Resume task uses the existing Continue confirmation; there are no automatic limit increases or implicit permission grants. Separately, recognized transient generation failures receive bounded automatic retries; see [recovery and compaction](CODING-AGENT-RECOVERY.md).

| Pause | Recovery behavior |
| --- | --- |
| Request context is too large | Compact complete older turns automatically when enabled, or pause before sending. Use Compact context, review context/output settings and Continue with retained goal and recent history. New Task with Context remains a fallback when a useful checkpoint cannot fit. |
| A complete tool batch exceeds the run allowance or result-space reserve | Retain the validated native response in memory, but execute **none** of that batch. Continue uses it without asking the provider to generate it again or double-counting its reported usage. |
| Provider explicitly reports its output-token cap | Keep public partial text labelled Interrupted, but discard the unfinished native response and execute no partial tools. Increase the effective output allowance, then explicitly retry the pending request from the last complete native history. Prior usage remains counted. |
| Request, tool-call or cumulative session-token allowance is exhausted | Keep completed tool results. Review limits/permissions and Continue; a session-token allowance must be explicitly increased rather than reset. |

Deferred operations retain their **original arguments**. Continue rechecks the current tool catalog, permission mode, workspace epoch and normal revision guards. The IDE changes revisions when authority is reopened: an old mutating operation can therefore be rejected as stale even without source edits. Its error is returned to the model, which must re-read current state before proposing a new edit. The runner never changes `expectedRevision` to make an old operation succeed. Prior successful edits are never replayed. A denial, Stop, project replacement or failure after a batch starts cannot become a resumable partially applied batch. A new prompt cannot accidentally replace a deferred batch; use Continue or a new task.

A final response with no tool calls needs no result-space reservation. It is retained as a completed answer even if its added native context would make a future request too large; that subsequent request pauses before I/O. Unknown/unavailable tool attempts also count against the run limit, rather than triggering repeated billed requests outside the tool cap.

Only confirmed provider output-cap markers are recoverable this way: OpenAI `response.incomplete` / `incomplete_details.reason = max_output_tokens`, Anthropic `stop_reason = max_tokens`, and Google `finishReason = MAX_TOKENS`. Safety blocks and malformed protocol data remain terminal. Transport EOF is a retryable interruption, while a valid but unspecified OpenAI failure/incomplete event allows manual Continue without executing partial tools. Output-cap retry requires a larger **effective** output allowance (also constrained by remaining session budget); retrying the same insufficient cap does not send another request. Native signatures/reasoning from incomplete responses are not reconstructed or appended. Provider context/output restrictions and billing still apply.

Protocol references checked October 6, 2026:

- [OpenAI Responses streaming events](https://developers.openai.com/api/reference/resources/responses/streaming-events).
- [Anthropic streaming messages](https://platform.claude.com/docs/en/build-with-claude/streaming) and [stop reasons](https://platform.claude.com/docs/en/build-with-claude/handling-stop-reasons).
- [Google GenerateContent FinishReason](https://ai.google.dev/api/generate-content#FinishReason).

Anthropic streaming deltas must match their content-block type. Private thinking/tool-input blocks cannot feed the public-text renderer through a mismatched text delta. Nonsequential, negative, noninteger or oversized sparse block indices are rejected before allocation/rendering.

## Validation

Run `npm run build`, `npm run test:agents`, and `python tools/coding-agents-browser-tests.py`. The browser suite covers native-protocol doubles for OpenAI, Anthropic and Google against the real IDE adapter, with no paid API requests. CI runs Chromium, Firefox and WebKit against HTTP modules, HTTP standalone and file standalone builds. The optional `--opaque` mode is only an inline UI fallback for environments that prohibit navigation; it is not a substitute for real-origin CI.

Focused regressions cover waiting/streaming/tool-only turns, authoritative final reconciliation, denial/interruption, safe rendering/copy, draft and partial-response recovery, IME/Enter behavior, selection/scroll anchoring, bounded history, presets/storage validation, cumulative budgets, failure estimates and no-replay continuation.

Recovery regressions also cover all three native output-cap envelopes, unchanged-cap retry prevention, exactly-once deferred batches, stale edits, denied operations, read-only downgrade, workspace replacement, complete-answer context boundaries, hidden-tab/panel reading state, automatic catch-up and bounded-history pruning.

## Permission profiles

The composer now includes Codex-style permission profiles, full IDE access with
explicit per-run acknowledgement, granular rules and revoke controls. See
[Permission profiles](CODING-AGENT-PERMISSIONS.md) for the complete behavior.

Recovery-specific tests also cover automatic reconnects, safe relay classifications, full Retry-After deadlines, permission cancellation, atomic public checkpoints for all three protocols, pending-batch preservation and failure rollback. See [the recovery guide](CODING-AGENT-RECOVERY.md#validation).
