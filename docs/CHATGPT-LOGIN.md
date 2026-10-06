# ChatGPT account sign-in for coding agents

VB6 Studio Web supports **API-key billing** and **ChatGPT account / plan usage** as separate OpenAI connection modes. API keys remain the default. ChatGPT mode uses OpenAI's documented Sign in with ChatGPT flow for locally run and open-source tools; it does not read Codex credentials, impersonate the Codex CLI, scrape ChatGPT, or silently fall back to API billing.

## Start and connect

Use Node.js 22 or newer. From the repository, run:

```sh
npm run build
npm run serve
```

In another terminal, run the local coding-agent relay:

```sh
npm run agent:relay
```

Open **http://127.0.0.1:8080**. This exact origin matches the relay's default allowlist; `localhost` is a different origin. In **Tools → AI Coding Agents → Connection**, select OpenAI and **ChatGPT account — ChatGPT plan usage**. The IDE selects the local relay connection. Enter the relay origin (normally `http://127.0.0.1:4892`) and the access token printed by the relay. This token protects your local relay; it is **not** an OpenAI API key.

Choose **Sign in with ChatGPT**, complete sign-in and consent in the OpenAI window, then return to the IDE. A manual sign-in link is available when popups are blocked. Select an account, click **Refresh Models**, and choose an eligible model. Review the normal IDE permissions and start a task. No `OPENAI_API_KEY` is required for this mode.

Identity sign-in and permission to use plan allowance are separate. If only identity was granted, the IDE displays **plan consent required** and blocks model requests. Use **Enable plan usage…** to request explicit consent again. Select **Add a ChatGPT account** to add another account. Existing registrations are reused when signing back into a saved account.

Existing API-key workflows, including Anthropic and Google, are unchanged. Switching billing mode or ChatGPT account does not retarget an existing task: create a new task and explicitly review any context handoff. A continuing task must use its original billing mode and relay account.

## Local relay and deployment

The browser never receives OAuth access, refresh, or identity tokens. Its token-authenticated local relay performs registration, code exchange, identity verification, refresh, model discovery, and streaming inference. The existing IDE agent still owns tool execution and its permission/revision checks. ChatGPT sign-in grants no extra project, debugger, native, shell, or filesystem permissions.

The relay binds to loopback and accepts only configured exact IDE origins. Configure `VB6_AGENT_ORIGINS` as described in [coding-agents.md](coding-agents.md) for a different served IDE origin. A GitHub Pages IDE still needs the user's local relay and browser local-network permission. Serve standalone HTML over HTTP rather than enabling the opaque `null` origin used by `file:` pages. Do not expose this relay publicly or use wildcard origins.

Configuration:

| Variable | Meaning |
| --- | --- |
| `VB6_CHATGPT_ENABLED=0` | Disable ChatGPT support; retain the API-key relay. |
| `VB6_CHATGPT_HOME` | Explicit local credential/registration directory; defaults to `~/.vb6-agent/chatgpt`. Keep it outside projects and synced folders. |
| `VB6_CHATGPT_REMEMBER=1` | On Unix, explicitly opt into storing renewable tokens in the owner-only local file. Default is memory-only. |

By default, tokens remain only in relay memory. The per-host identity and issued application registrations are retained so subsequent sign-in uses the same client rather than creating a new one every time. Restarting the relay requires sign-in again.

Unix persistent storage uses a private directory, owner checks, mode `0600` files, exclusive locking, and atomic writes. It is **not an encrypted operating-system keychain**. Persistent-token mode is intentionally rejected on Windows until an OS-protected store is supplied; normal Windows memory-only sign-in and inference are supported. Never copy these files into a project, paste their contents into an agent, or commit them. If a crashed process leaves `session.lock`, first verify that no relay is using the directory before removing the stale lock; the application never removes another process's lock automatically.

**Sign out** stops account requests, clears local tokens and revokes the renewable session at OpenAI. Registrations remain available for later sign-in. If remote revocation cannot be confirmed, the IDE says so and directs you to disconnect the app in ChatGPT settings. **Clear Credentials** only clears the browser's provider/relay inputs; it does not revoke a ChatGPT session. Close the relay to discard memory-only tokens.

## Plan usage and recovery

ChatGPT mode consumes the signed-in account's eligible allowance, subject to app, workspace and provider restrictions. It is neither unlimited access nor a promise of availability on every plan. The displayed model catalog comes from that account's authorized endpoint, keeps provider ordering/display names, and omits hidden models.

The documented preview does not accept `max_output_tokens`. The Permissions control therefore becomes **Output reserve (not a cap)**: it helps local context planning, but is not sent as a hard provider limit. Session usage accounting, request/tool-call limits, timeout, Stop, and permission leases remain active. A single request can exceed the remaining locally estimated token budget. The IDE does not pretend its session counter is your remaining ChatGPT allowance; use **ChatGPT Settings → Usage** for account usage.

A provider output truncation pauses without executing partial tools. An explicit Continue may retry it without requiring an unsupported larger output cap; a smaller task or compaction of completed context may be more useful. Completed tool operations are never automatically replayed. An incomplete or disconnected stream is not treated as a completed response.

Subscription-sharing quota errors pause without automatic retries or API-key fallback. Authentication errors require reviewing sign-in; missing plan consent requires consent; eligibility restrictions require resolving the account/workspace restriction. Transient provider errors retain the existing bounded retry and cooldown behavior. Terminal refresh errors clear that session's credentials while retaining its registration, and direct the user back to sign-in.

## Protocol and security details

The relay uses a stable per-host ID, dynamic public-client registration, a fresh loopback callback port, random state and nonce, and PKCE S256. It validates the issued client, exact redirect, one-time state, and signed identity claims using OpenAI discovery/JWKS. Identity verification checks issuer, audience, authorized party where applicable, subject, nonce and times, and accepts only the implemented RSA/ECDSA signature algorithms. No shared client secret is embedded in the repository.

Accounts are separately addressed; model and inference calls require an explicit account. Refresh is serialized per session and credential writes are serialized and atomic. Cancellation, late callbacks and sign-out cannot silently replace another account. Logout during rotation revokes the newly rotated renewable credential rather than an obsolete one. Browser responses and errors omit OAuth credentials and raw provider error bodies.

Inference uses fixed OpenAI endpoints and a restricted request profile: streaming, `store: false`, array input and a `vb6` function namespace. Only registered local IDE function definitions are forwarded. Unsupported API fields are omitted; foreign or unqualified tool namespaces are rejected before execution. Existing native reasoning blocks, complete-turn accounting, approvals, compaction and debugger/project tooling remain in the same agent loop.

## Validation and remaining verification

```sh
npm run test:chatgpt
npm run test:agents
npm run build
npm test
# Install the Playwright/browser dependencies used by the repository first:
npm run test:chatgpt:browser
```

The Node tests cover OAuth, signed identities, rotation, cancellation, protected storage, relay isolation, model selection, namespace/tool continuations, output truncation and the real IDE permission-gated agent loop. Browser fixtures exercise sign-in, account/model controls, two-turn tool execution, usage, billing-mode guards and sign-out in the served and standalone builds. They use a deterministic mock OpenAI service, **not a real ChatGPT account or paid inference**. The optional `--opaque` browser harness is only for restricted test environments; it does not establish real navigation/CORS behavior. CI uses normal HTTP navigation in Chromium, Firefox and WebKit.

Live sign-in, account entitlement and production inference must still be checked by the user with their own account. No live-account certification is claimed by fixture results. This integration targets the documented local/open-source flow, not a commercially hosted subscription gateway; deployment models that require OpenAI approval still require it.

## Official references

Protocol reviewed on 2026-10-06:

- [Open-source/local ChatGPT plan usage](https://developers.openai.com/siwc/token-sharing-open-source)
- [Registration and sign-in](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
- [Accounts and sessions](https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions)
- [Models and inference](https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference)
- [Token reference](https://developers.openai.com/siwc/token-sharing-open-source/token-reference)
- [Errors and recovery](https://developers.openai.com/siwc/token-sharing-open-source/errors-and-recovery)
- [Preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations)
