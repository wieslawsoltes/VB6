# API-key coding agents in the classic VB6 IDE

Open **Tools → AI Coding Agents…**. The tool uses the existing VB6 MDI window,
classic toolbar, bevels, property-style fields and tabs. It also uses the existing
window layout and browser-window host rather than introducing a different app
shell. The existing **MCP Agent Access** tool remains server-only and independent.

## Connect an API account

The providers are OpenAI's **Responses API**, Anthropic's **Messages API**, and
Google's **Gemini generateContent API**. Choose a model that supports function
calling. **Refresh Models** queries the selected account; selecting an entry fills
Model ID. Manual model IDs are supported, so new compatible models do not require
an IDE update. Model catalogs can include models that do not support these APIs or
tools; listing a model is not a compatibility certification.

### Recommended: local relay

Use Node.js 22 or later. From the repository, run `npm run build`, then
`npm run serve`. Open `http://127.0.0.1:8080`, matching the relay's default origin
(the server also prints a localhost URL, but those are different origins).

In a second terminal, set only the provider keys you need using your normal local
secret-management method, then run:

```sh
# Environment variable names; do not put real keys in project files or commits:
# OPENAI_API_KEY       — OpenAI
# ANTHROPIC_API_KEY    — Anthropic
# GEMINI_API_KEY       — Google
npm run agent:relay
```

For PowerShell, environment variables use `$env:OPENAI_API_KEY`,
`$env:ANTHROPIC_API_KEY` and `$env:GEMINI_API_KEY`. The relay reads the environment
at startup. Restart it after changing keys.

The terminal prints the relay origin and a random **local access token**. In
Connection, choose **Local relay**, keep `http://127.0.0.1:4892`, and enter that local
token. Do **not** paste a cloud API key into the local-token field. Cloud keys stay
in the relay process; the browser's optional direct API-key field is ignored in
relay mode. Treat the local token as a credential too: an authorized holder can
spend your configured provider account quota through the relay.

The relay binds only to `127.0.0.1`. Optional configuration:

| Variable | Meaning |
| --- | --- |
| `VB6_AGENT_PORT` | Port; default `4892`. |
| `VB6_AGENT_ORIGINS` | Comma-separated exact allowed IDE origins; default `http://127.0.0.1:8080`. No wildcard, opaque/file origin, credentials or URL paths. |
| `VB6_AGENT_TOKEN` | Optional local token of at least 32 characters. Omit it to generate a fresh random token on every start. |

For GitHub Pages, the origin is `https://wieslawsoltes.github.io`, not the `/VB6/`
path. Add it deliberately to the origin allowlist when using that deployment.
Your browser can require local-network permission or restrict HTTPS-to-loopback
requests. Such policies are not bypassed. Serving the IDE locally is the fallback.
A `file://` standalone IDE cannot use the relay: opaque `Origin: null` is rejected
intentionally. Serve that HTML over local HTTP or use direct mode subject to its
browser/provider CORS constraints.

Only `/agent` with a valid token, permitted origin, loopback Host and JSON POST is
accepted. The relay sends requests exclusively to the three official HTTPS API
hosts, never to a model-selected or browser-supplied endpoint. Redirects are
rejected. It does not forward cookies, browser-supplied provider authorization, or
arbitrary headers. It limits request/response bytes, concurrent upstream requests
and duration. Disconnects cancel upstream work. Provider error bodies are not
returned or logged because they can contain confidential request data. The relay
has no shell, filesystem, generic HTTP proxy or MCP client endpoint.

### Direct API mode

Direct mode is for personal, trusted-browser use. Enter a provider key in the
password field and explicitly check **Accept browser key exposure**. A key in a
browser is accessible to the page and potentially extensions; a password field
and memory-only storage do not make it a server-side secret. Use the relay for
stronger key separation. Never deploy a shared provider key in an HTML file.

Keys are not put in URLs, localStorage/sessionStorage, project serialization,
transcripts, layout profiles, generated applications or source-control files by
this feature. Clear Credentials erases the fields; changing provider clears the
direct key; closing the tool or reloading the page clears credentials. Browser
password managers and extensions remain outside the application's control.
Direct requests depend on the provider's browser CORS support. Anthropic direct
mode uses its explicit browser-access header. A failed direct connection suggests
the local relay rather than an untrusted public CORS proxy.

## Run a task

Choose a connection and model. On Task, describe the change; **Send**, **Run**, or
**Enter** opens a confirmation naming the project, provider, model, permission mode
and session limits. Shift+Enter inserts a line; Ctrl+Enter also sends. IME
composition does not send. Starting sends the task, tool schemas and project inventory.
The model can then request additional source, project, designer or debugger data.
Review the project for secrets before granting read access. Model discovery sends
no project source, but does send the relevant credential to the selected endpoint.

The native provider loop preserves tool-call IDs, OpenAI encrypted reasoning
items, Anthropic signed thinking blocks, and Gemini thought signatures across
continuations. The Task tab displays a live conversation: public replies, waiting
status, collapsible tool operations, approvals, plans and questions. Private
reasoning and native signatures are never rendered or included in exported
transcripts. Completed messages use a bounded text-only Markdown subset with
copyable code and safe HTTP(S) links; model HTML, images and embeds are not executed.
The composer remains available for drafting while a reply runs. Scrolling upward
preserves the reading position; Jump to latest restores following. Interrupted
partial replies remain visible and are labelled as incomplete. See
[Conversation behavior and session budgets](CODING-AGENT-THREADS.md).

The agent inspects, edits and validates the **actual IDE project**. It uses all
125 existing typed tools, subject to the chosen permission mode:

| Area | Examples |
| --- | --- |
| Code | Source ranges, search, definitions, references, rename, formatting, procedures, atomic UTF-16 range edits and module replacement. |
| Projects | Modules, metadata, references, project settings, native project groups, active/startup project selection, original project files, archives and source formats supported by this IDE. |
| Designer | Forms, controls, control arrays, menus, properties, layout and selection. |
| Compiler/builds | Compile the active project, inspect real diagnostics, and produce inert project JSON, HTML, source ZIP or supported Win32 artifacts with SHA-256 verification and bounded chunk reads. Builds do not execute generated code. |
| Debugger/runtime | Inspect state, breakpoints, frames, watches, evaluate, step, continue, stop and use the supported runtime-control tools. |
| Data definitions | Public providers, connections and commands; validation, atomic renames and undoable definition edits under the separate data scope. No SQL/network execution or runtime credentials. |
| Files/workspace | Project virtual files, assets, resources, document/window layouts, editor views, normal Undo/Redo and the existing typed commands. |

Tool descriptions and exact schemas are available on the **Tools** tab. These
operations have the same compatibility boundaries as the IDE. They do not add
arbitrary host-shell commands, JavaScript evaluation, native filesystem access or
an external MCP client. Code that you approve for runtime execution can itself
access the application's configured data sources and integrations.

### Permission profiles and operation review

Use the composer permission selector or Permissions tab for **Ask for approval,
Read only, Plan, Auto edit, Full IDE access, and Custom / selected scopes**.
Full IDE access has a distinct unchecked acknowledgement on every Run/Continue.
Allow/Ask/Deny scope and exact-tool rules, Ask when needed / Never ask policy,
1–60-minute run leases, active exact-tool grants and a Revoke permissions & stop
control provide more precise control. Never ask denies instead of approving.
Full access never overrides deny rules, host restrictions or the browser/runtime
boundary. Defaults remain Ask for approval with a ten-minute maximum run lease.

Operation dialogs retain Before/After and full review export. **Allow once** is
invocation-only; **Allow tool for this run** covers this exact tool with any valid
arguments until the current run/lease ends. Cancel stays the default. Neither
choice bypasses revisions or extends authority to another task or external MCP.
See [permission profiles and security boundaries](CODING-AGENT-PERMISSIONS.md)
for complete precedence, host ceilings, lifecycle and execution/network caveats.

Changes recheck revisions and runtime state after approval. Stale edits are
rejected rather than blindly replacing user work. Atomic multi-module code edits
form one normal Undo entry. Earlier successful edits remain when a later operation
fails; Undo/Redo works through the normal IDE, and source undo labels identify
**AI Agent** rather than pretending the work came from an external MCP peer.

### Named tasks and follow-up conversations

The **Tasks** tab keeps up to **eight named tasks in memory**. Each has its own
provider/model, draft, native conversation, public activity, plan and cumulative
reported usage. Rename, select or delete tasks using the classic list and buttons.
Selecting a task sends no network request and preserves unsent drafts. All tasks
share the **live project**, not separate project copies or Git worktrees. Source
can change between turns; agents must re-read current revisions before editing.
No permission grant carries over from one task or run to another.

After a completed response, type a follow-up and select **Run**. The earlier
provider-native context is retained. **New Task** creates an independent blank
conversation; it does not clear older tasks or undo project edits. Changing a
used task's provider or model requires a new task. Switching between tasks with
different providers clears the direct API key. Closing/reopening the tool keeps
memory-only tasks and drafts, but clears credentials. Saved layouts contain only
window identity/geometry. Reloading the page loses all tasks and credentials.

**Delete Task…** asks for confirmation, discards that task's conversation and
plan, and leaves project edits in normal Undo history. Deleting the last task
creates a blank one. New Task refuses to exceed the eight-task bound.

**New Task with Context…** opens an editable, bounded excerpt of recent public
user messages, answers and assistant text. It is **not an automatic summary**.
Review/remove confidential content before copying it into the new task's draft,
then add the new instructions and select Run. No request is made while copying.
Connection credentials, tool results, native signatures and permission grants
are not copied. Public text may still contain source, personal data or secrets
entered by a user or echoed by a model; review is essential. The excerpt does not
prove the current project state. This is an explicit context handoff, not lossy
editing of a signed provider-native conversation.

### Task plans and local questions

Two local tools supplement the **125 IDE operations** in the shipped agent UI;
they do not change the independent external MCP tool catalog:

- **`vb6.agent.plan`** maintains a revision-checked plan on the **Plan** tab, with
  1–12 uniquely identified steps and at most one in-progress step. Pending,
  In progress and Completed are **model-reported progress**, not proof that a
  compile/test passed and not authorization to execute anything.
- **`vb6.agent.question`** opens a classic question dialog. Suggested answers are
  optional; a free-text answer is always possible. No default answer is sent.
  **Cancel** stops the task; Stop or project replacement dismisses the pending
  question and late answers are ignored. Never enter credentials. An answer is
  task information and **cannot authorize** project changes or execution.

Plans/answers stay in their own task. The question tool is exposed by the reusable
engine only when the embedding host supplies an `askUser` callback; headless
engines otherwise expose the IDE operations plus the plan tool.

### Stop, Continue and limits

One task runs at a time per IDE adapter. Task management and connection controls
are disabled during a run or pending local confirmation. Stop aborts provider I/O,
questions and tool approvals. Cancelling a review also stops the task. Closing a
detached window dismisses its modal through the shared window host. A project
replacement/reload invalidates all old tasks, even when it reuses the same ID;
the task list marks these as previous-project sessions. Start a new task rather
than reusing an old task's authority. In-place edits use current revision checks.

**Continue** is enabled when a run reaches its request/reported-token limit or a
provider request fails with a recognized transient connection/HTTP error. It opens
a fresh confirmation for the same provider/model, limits and permission scopes,
then sends the pending request with completed native tool results. It **does not
append the task prompt again or replay completed IDE tool operations**. The model
may still propose another operation in its next response; normal approval and
revision safeguards remain in force. Historical results are not assumed current.

Confirmed output-token stops, request-context limits and fully validated but unexecuted oversized tool batches now pause without losing the task. The Task tab provides **Review limits…** and **Resume task**. See [limit recovery](CODING-AGENT-THREADS.md#limit-recovery) for exact no-replay, stale-revision and provider-specific rules.

There are **no automatic retries**. HTTP 408, 429, 500, 502, 503, 504 and 529, and
pre-response connection failures and request timeouts (including timed-out
streaming responses), allow a manual Continue. A bounded
provider `Retry-After` suggestion is shown (at most five minutes); it schedules
nothing. The local relay forwards only this sanitized retry metadata, not error
bodies or arbitrary provider headers. An earlier request may already have been
processed/billed. Authentication/validation failures, cancellation, denied
operations, malformed native responses, unspecified incomplete responses and uncertain tool batches remain blocked and
require a new task. The engine never retries a possibly half-applied batch.

The new Extended default allows 128 provider requests and 1,024 tool calls per run,
32,768 output tokens per request, and a cumulative **4,000,000-token task budget**.
The Large preset allows 20,000,000 tokens; the configurable application ceiling is
100,000,000. All six limits, including context bytes and request timeout, are
independently editable on Permissions. Only validated numeric preferences can
persist in browser storage; tasks, keys, connection settings and grants do not.
Continue requires a new user decision and resets per-run request/tool allowances,
not the cumulative token budget. Raise an exhausted allowance explicitly or use
New Task. Unknown provider usage is separately labelled as a byte/public-text
safety estimate and counted against the allowance, not presented as billed tokens.
These limits are **not a hard billing cap or model capability guarantee**: one
request can exceed the remaining allowance. Review provider billing and spend
controls. Stop does not undo edits, reverse external data-source actions, or
guarantee immediate cessation of billing.

See the [complete presets, ranges and accounting rules](CODING-AGENT-THREADS.md#limits).
Generation requests default to ten minutes and can be configured up to thirty;
model discovery remains capped at two minutes. Longer generation timeouts do not
extend the separately selected permission lease (ten minutes by default).

The task status displays native context size in KiB, not a model-specific token
estimate. The request-context default is 6 MB, configurable up to 16 MB; provider
responses remain capped at 8 MiB. The public thread keeps at most 1,200 entries
and four million accounted characters, while the separate activity audit keeps
500 entries/approximately 512 KB. Thread previews are capped at 262,144 characters
per public field. Omissions and truncation are explicit. Individual activity text is
clipped with an explicit marker. Before executing a tool batch the engine reserves
space for bounded, explicitly marked tool results. Large results require smaller
ranges/pages. **Native reasoning/signatures are never truncated or rewritten.**
When that native context cannot fit, start a task with reviewed public context.
An oversized response/call batch or malformed stream never executes partial calls.
Returned tool batches are executed sequentially against the real revision checks.

## Example tasks

The Task tab includes editable examples; choosing one never starts a request.

**Explain:** “Read and explain Form1. Do not modify the project.” Choose Read only.

**Repair:** “Compile this project, inspect diagnostics, fix source errors without
changing intended behavior, and compile again. Show what changed.” Use review mode
or delegate only Code. A zero-diagnostic compile is compiler evidence, not proof
that every runtime behavior was exercised.

**Designer:** “Inspect the project and create a classic VB6 customer-entry form
with Name and Email fields, Save and Cancel, and input validation. Follow existing
control names and layout conventions.” Use review mode, or deliberately delegate
Project, Designer and Code.

**Debug:** “Inspect the code and debugger state. Set an appropriate breakpoint,
run to it, inspect locals and watches, then explain why the current calculation
is wrong.” Runtime/debugger effects require their own permission. Do not delegate
execution to an unreviewed project with sensitive data-source access.

## Reusable implementation

`src/agents/providers.js` implements native request/response mappings, authenticated
transport, bounded SSE/JSON parsing and model discovery. `agent.js` implements
provider-independent orchestration and `resume()`. `conversations.js` exports the
memory-only `AgentConversations` manager; `task-tools.js` implements local plans
and questions. `review.js` builds pure before/after data.
`thread.js` maintains bounded public presentation state independently of native
provider histories; `thread-view.js` renders keyed classic conversation entries,
safe formatting, copy actions and scroll anchoring. `limits.js` validates numeric
preferences and presets. `studio.js` is the classic IDE adapter/UI; `agents.css`
uses existing theme tokens.
`tools/agent-relay.mjs` exports `createAgentRelay` and provides the optional CLI.
No provider SDK, CDN script or new npm dependency is required.

`VB6StudioAPI.Agents` exposes the engine/transport installers for embedding and
testing. The engine operates on a `createIdeAdapter` compatible tool catalog. Its
scoped-mode API assumes the host has obtained local user consent; the shipped UI
enforces that consent before invocation. Same-origin application JavaScript is a
trusted application boundary, not an isolation boundary against hostile scripts.

## Validation and compatibility boundaries

```sh
npm run build
npm test
npm run test:agents
npm run test:agents:browser
```

The new Node suites cover native envelopes and stream boundaries, reasoning/tool
continuation, real IDE edit/compile/Undo, approval denials, stale revisions,
same-ID reload, independent permissions, concurrency, cancellation, size/budget
limits, credentials and a real localhost relay with mocked upstream providers.

The browser suite uses real classic controls and native wire-protocol test doubles
for all three providers. CI runs a **Chromium, Firefox and WebKit** matrix against
modular HTTP, standalone HTTP and standalone file origins. It checks consent, Before/After, edits, compilation,
Undo, scoped/read-only permissions, Stop, model discovery, inert model text,
credential clearing/export exclusion, tool catalog, task/draft switching, plans,
questions, reviewed context handoff, exact-once edit preservation across Continue,
manual retry and workspace lifecycle, plus live tool-only/streaming threads,
scroll/selection anchoring, formatting/copy, draft recovery, Enter/IME and budget
preferences.
Screenshots/results are retained as CI artifacts. Its explicit `--opaque` option
is UI-only fallback validation for locally managed browsers; it is not used by CI
and is not evidence of file/HTTP deployment coverage.

No paid provider keys are required or included in tests. Deterministic protocol
coverage does **not** certify every model/account/region, live provider CORS policy,
or paid API success. Validate a small task with your chosen account/model before
using an agent on important projects. This feature is not a clone of Codex CLI,
Claude Code or Gemini CLI; it is a native IDE coding agent using their providers'
model APIs and the IDE's own typed tools.

## Protocol references

Implementation references, checked 2026-10-05:

- [OpenAI function calling](https://developers.openai.com/api/docs/guides/function-calling)
- [OpenAI API-key safety](https://help.openai.com/en/articles/5112595-best-practices-for-api-key-safety)
- [Anthropic tool use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview)
- [Anthropic tool-result handling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/handle-tool-calls)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini FunctionDeclaration schema](https://ai.google.dev/api/caching#FunctionDeclaration)

Continuation-specific references:

- [OpenAI conversation state](https://developers.openai.com/api/docs/guides/conversation-state)
- [Anthropic extended thinking and signatures](https://platform.claude.com/docs/en/docs/build-with-claude/extended-thinking)
- [Gemini thought signatures](https://ai.google.dev/gemini-api/docs/generate-content/thought-signatures)

### Questions in task context

The public conversation and reviewed context handoff keep each validated agent question before its answer, so short answers such as “Yes” do not lose their meaning when switching tasks. Cancelling a question records the question but does not invent an answer or permit continuation. Questions remain inert text; the handoff is an editable excerpt, not authorization or proof of the current project state. Native provider signatures, raw tool results and permission grants remain excluded.

### Local change review and follow-ups

The classic agent **Changes** tab compares current module source/designer state
against task-start or latest-run checkpoints, with bounded diffs, patch export,
line-targeted feedback and revision-checked source-only restoration through normal
Undo. **Queue message** stores follow-ups locally while generation runs; Queue
supports editing/reordering and explicit fresh-confirmation dispatch without
replacing unsent composer drafts or inheriting Full-access grants. Nothing sends
automatically. See [the workbench guide](CODING-AGENT-WORKBENCH.md) for
coverage, memory limits, stale-workspace protection and non-Git boundaries.
