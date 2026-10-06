# Coding-agent permission profiles

Open **Tools → AI Coding Agents…**. Select a profile directly below the conversation
or open **Permissions** for rules and lease duration. The controls retain the
classic VB6 window, tabs, palette, font and bevels. This extension implements
Codex-style access and approval choices in the existing three-provider agent;
it is not the Codex desktop runtime or complete Codex feature parity.

## Profiles and approval policy

| Profile | Without a per-operation approval | Boundary |
| --- | --- | --- |
| Ask for approval | Inspection, compilation without running code, local plans/questions | Changes/execution require approval unless explicitly allowed |
| Read only | Inspection and non-executing tools | Project mutation and execution are forbidden even with allow rules |
| Plan | Same inspection boundary, with planning instructions | Proposes a plan; implementation requires a separately confirmed editing run |
| Auto edit | Non-destructive code/designer/virtual-file/public-data-definition/workspace operations | Destructive changes, project replacement, execution and open-world actions ask |
| Full IDE access | All registered IDE operations | Requires an additional unchecked confirmation on every Run/Continue; deny rules and host limits still apply |
| Custom / selected scopes | Operations in deliberately checked scopes or allow rules | Other actions ask, or are denied under Never ask |

**Ask when needed** permits local approval dialogs for operations not already
allowed. **Never ask — deny actions requiring approval** refuses those operations
rather than granting them. Never ask is not Full access. Plan/local question tools
may still ask requirements questions; answers never authorize effects.

Profiles and rules are **per-task memory-only preferences**, not durable grants.
New tasks start with Ask for approval (or a permitted host-constrained default).
Switching tasks or reopening a panel restores that task's preference but never an
old active lease or credentials. No profile/rule is read from project files,
model output, provider context, localStorage or external MCP state.

All runs retain explicit local Start/Continue confirmation naming the project,
provider, token budget, profile, duration, rules and host restrictions. Full IDE
access additionally requires checking **Confirm Full IDE access for this run**.
Selecting Full in a menu, a natural-language answer, or a model tool call cannot
grant it. Programmatic embedding hosts must deliberately pass
`fullAccessConfirmed: true` on every full-access `run`/`resume` call.

## Rules, precedence and scope

Eight effect scopes cover code, project, designer, virtual files/resources, public
data definitions, debugger, runtime and workspace. Each scope can use the profile
or override it with **Allow / Ask / Deny**. Exact tool-name overrides additionally
cover individual inspection operations, for example `vb6.module.read` or
`vb6.debug.snapshot`. Select an actual registered tool and choose **Set tool rule**;
**Remove tool rule** restores the profile/scope decision. Wildcards and arbitrary
names are rejected, not treated as command-prefix grants.

Precedence is: host prohibition, hard Read only/Plan boundary, explicit deny,
exact tool rule, scope rule, then profile. **Deny always wins over Allow**, including
Full IDE access and remembered approvals. Denials on combined effects are
conservative: whole-project replacement/import/selection and Undo/Redo honor
code/designer/files/data/workspace denials; code-changing designer renames honor
code denials; executing debugger tools honor runtime denials. A combined-effect
tool may therefore be unavailable even when a particular argument would not use
all of those effects. Explicit denials and Never ask violations stop a tool batch;
the engine does not try another operation to bypass the denial.

A scope controls **tool effects**, not data confidentiality. For example, denying
code edits does not deny code reads. An exact deny blocks that exact tool, not
every other tool capable of returning similar information. The initial provider
request still contains the reviewed project inventory and the retained native
conversation; rules do not erase previously disclosed source. Do not interpret
these controls as a per-file information-flow or operating-system sandbox.

## Approve once or for this run

Operation review keeps the Before/After source preview and Save full review.
Choose **Allow once** for that invocation or **Allow tool for this run** to allow
that exact tool with any schema-valid arguments until the existing lease ends.
The broader choice is stated explicitly in the dialog; Cancel remains the default.
A run approval never authorizes an entire scope and never renews the lease.

**Active run approvals** lists remembered exact-tool approvals. **Revoke selected
tool approval** makes future invocations ask again (it does not reverse a call
already authorized). **Revoke permissions & stop** cancels the agent's provider
request, pending reviews, and ongoing permission-checked work. **Stop generation**
and closing the panel also revoke the lease. Neither action rolls back completed
edits/external effects, stops an already-started application automatically, or
promises cessation of provider billing. Use the IDE's application Stop and Undo
controls as appropriate.

Leases last **1–60 minutes**, default 10, and always end with this Run/Continue,
failure, cancellation, project replacement/reload (even the same project ID),
page unload, or expiry. Expiry cancels pending work rather than silently falling
back to another approval path. There is no automatic renewal. A limit-paused task
requires fresh consent on Continue. A cancelled or denied partially executed batch
remains non-resumable; inspect the project and start a new task.

The bounded Activity transcript records permission profile, allow/deny decisions,
exact-tool approvals and revocations. Permission audit events contain no tool
arguments or credentials; the separate existing tool transcript can include source
and user/model text. Treat exports as potentially confidential. The composer badge
shows the selected profile, whether authority is active and its expiry. Selection
is deliberately distinguishable from an active grant.

## Enforcement and host restrictions

`AgentPermissionSession` is reusable, immutable-configuration, project/task-bound
and independent of the provider protocol. Every real IDE tool, including reads
and the enriched debugger snapshot, enters the shared adapter authorization
wrapper. Schema/revision checks run before approval; cancellation, project/runtime
identity and revision checks run again before effects. A private invocation receipt
prevents inner consent from becoming a second approval prompt. Remembering a tool
approval does not itself change project revision. Direct resource access on the
coding-agent adapter is denied in favor of policy-checked tools. The separate
external MCP adapter retains its existing permissions and never inherits these
leases. Agent/security windows cannot be manipulated through document tools.

Embedding hosts can supply an immutable ceiling at installation:

```js
installCodingAgents(ide, studioAPI, {
  permissionConstraints: {
    allowedModes: ['review', 'readonly', 'plan', 'autoedit', 'scoped'],
    deniedScopes: ['runtime'],
    deniedTools: ['vb6.project.import'],
    maxMinutes: 15,
    allowRunApprovals: false
  }
});
```

The engine also accepts `permissionConstraints` in its constructor. Unknown keys,
profiles, tools, scopes, durations and actions fail validation before provider I/O.
Full access cannot override host prohibitions. A normal user cannot change host
constraints through the agent UI. As before, trusted same-origin application
JavaScript is the host boundary; this is not protection from a malicious embedding
host, compromised page script, extension, or native integration.

## Full IDE access is not unrestricted host access

No generic shell, process launch, arbitrary JavaScript/DOM evaluation, host disk
read/write tool, network proxy, credential-management tool or MCP permission tool
is added. Existing popup/file-dialog user-gesture rules, runtime/native bridge
validation, provider transports and supported IDE operation boundaries remain.
**Approved execution of project code can still use that application's configured
networks, data sources and native integrations.** These profiles do not install a
network firewall or restrict the side effects of approved project code. Do not use
Full IDE access or delegate execution for an untrusted project.

The 4M default / 20M Large preset / 100M configurable task-token ceiling is unchanged.
Permissions do not increase provider/model capacity or form a hard billing cap.
There is no automated reviewer, OS sandbox, Git worktree manager, cloud executor,
background task scheduler or live paid-provider certification in this extension.

## References and validation

Behavioral reference (reviewed 2026-10-06): OpenAI's
[Codex sandbox and approvals](https://developers.openai.com/codex/concepts/sandboxing)
and [Codex app features](https://developers.openai.com/codex/app/features).
The implementation is original and uses no Codex source, branding or dependencies.

Run `npm run build`, `npm test`, `npm run test:agents`, and
`python tools/coding-agents-browser-tests.py --browser chromium` (also `firefox`
and `webkit`). The normal three-browser workflow exercises modular HTTP,
standalone HTTP and standalone file origins with native-protocol doubles, not paid
provider calls. Tests cover full-mode confirmation, scope/exact/host precedence,
read/tool/resource boundaries, alternative-effect routes, expiry/revoke/late
approval, revision preservation, task/credential separation, Plan/Auto edit and
Never ask, plus all preceding conversation/recovery cases.
