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

Choose a connection and model. On Task, describe the change; **Run** or
**Ctrl+Enter** opens a confirmation naming the project, provider, model and
permission mode. Starting sends the task, tool schemas and project inventory.
The model can then request additional source, project, designer or debugger data.
Review the project for secrets before granting read access. Model discovery sends
no project source, but does send the relevant credential to the selected endpoint.

The native provider loop preserves tool-call IDs, OpenAI encrypted reasoning
items, Anthropic signed thinking blocks, and Gemini thought signatures across
continuations. Only public assistant text is displayed; private reasoning is not
rendered or included in the downloadable activity transcript. Model-provided text
is displayed as plain text, not executable HTML or automatically trusted Markdown.

The agent inspects, edits and validates the **actual IDE project**. It uses all
125 existing typed tools, subject to the chosen permission mode:

| Area | Examples |
| --- | --- |
| Code | Source ranges, search, definitions, references, rename, formatting, procedures, atomic UTF-16 range edits and module replacement. |
| Projects | Modules, metadata, references, project settings, native project groups, active/startup project selection, original project files, archives and source formats supported by this IDE. |
| Designer | Forms, controls, control arrays, menus, properties, layout and selection. |
| Compiler/builds | Compile the active project, inspect real diagnostics, and produce inert project JSON, HTML, source ZIP or supported Win32 artifacts with SHA-256 verification and bounded chunk reads. Builds do not execute generated code. |
| Debugger/runtime | Inspect state, breakpoints, frames, watches, evaluate, step, continue, stop and use the supported runtime-control tools. |
| Files/workspace | Project virtual files, assets, resources, document/window layouts, editor views, normal Undo/Redo and the existing typed commands. |

Tool descriptions and exact schemas are available on the **Tools** tab. These
operations have the same compatibility boundaries as the IDE. They do not add
arbitrary host-shell commands, JavaScript evaluation, native filesystem access or
an external MCP client. Code that you approve for runtime execution can itself
access the application's configured data sources and integrations.

### Review, read-only and delegated Agent modes

**Review each change / execution** is the default. An operation dialog shows the
provider, operation, arguments and expected revision. Source replacement and
atomic multi-module edits show Before/After using the same pure edit function
as the actual undo transaction. Large previews are explicitly marked as truncated;
Save full review downloads the full arguments and source comparisons. Cancel is
the default button. A denial terminates the task instead of letting the model try
another operation to bypass it.

**Read only** removes mutators and execution tools from the provider catalog. A
model hallucinating a removed tool gets an error, not access. It may still inspect
requested project/source/debugger data and run the non-executing compiler tool.

**Agent mode** authorizes only checked scopes: code, project, designer, files,
debugger, runtime, public data definitions or workspace. Start Task explicitly lists those scopes. Grants
last for this run, at most ten minutes; non-granted effects still require review.
They are revoked on completion, failure, Stop, project replacement/reload, expiry
or page unload. Permissions are local UI decisions; no model tool grants them.
The provider agent has its own adapter and cannot inherit external MCP grants or
enable MCP sharing by starting a task.

Changes recheck revisions and runtime state after approval. Stale edits are
rejected rather than blindly replacing user work. Atomic multi-module code edits
form one normal Undo entry. Earlier successful edits remain when a later operation
fails; Undo/Redo works through the normal IDE, and source undo labels identify
**AI Agent** rather than pretending the work came from an external MCP peer.

### Stop, continue and limits

One task runs at a time per IDE. Stop aborts provider I/O and pending tool consent.
Cancelling a review also stops the task. Closing a detached window dismisses its
modal through the shared window host. A project reload invalidates old authority,
even when the replacement project reuses the same ID. A cancelled or failed run
requires **New Task**, avoiding replay of a half-finished provider conversation.
Changing provider/model or reloading the project also requires New Task.

Run again continues a completed or request/token-limited conversation. New Task
clears in-memory context and activity, not project edits. Closing/reopening the
tool in the same page retains conversation history but clears credentials. Saved
window layouts retain only tool identity and geometry; a page reload restores an
empty connection/task with no grants.

Default run limits are 16 provider requests, 128 tool calls, 8,192 output tokens
per request and 200,000 **reported** tokens per run. The UI exposes request/output/
reported-token limits; the reusable engine also accepts a tool-call limit. There
are additional request, response, context and transcript size caps. Oversized or
incomplete responses do not execute partial tool calls. OpenAI and Anthropic are
asked for serial tool calls; any returned batch is validated then executed
sequentially against the real revision checks.

The reported-token limit is not a hard billing cap. Usage arrives after a request,
input context also costs tokens, and provider reporting can differ. Use provider
account spending limits. Requests are not automatically retried after a transport
error or rate limit, avoiding hidden charges or replayed writes. Stop does not
undo completed edits, reverse external data-source actions, or guarantee that a
provider stopped billing immediately.

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
provider-independent orchestration. `review.js` builds pure before/after data.
`studio.js` is the classic IDE adapter/UI; `agents.css` uses existing theme tokens.
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
for all three providers. CI runs it against modular HTTP, standalone HTTP and
standalone file origins. It checks consent, Before/After, edits, compilation,
Undo, scoped/read-only permissions, Stop, model discovery, inert model text,
credential clearing/export exclusion, tool catalog and workspace lifecycle.
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
