# ChatGPT sign-in does nothing, opens a blank tab, or stays waiting

The Connection page shows progress immediately and repeats errors in its bottom status bar. Expand **Set up the local ChatGPT relay** for commands generated from this IDE's exact origin. Switching authentication mode no longer starts a hidden background status request that disables Sign in.

For the public GitHub Pages IDE, start the relay from a local repository checkout:

```sh
# macOS / Linux
VB6_AGENT_ORIGINS='https://wieslawsoltes.github.io' npm run agent:relay
```

```powershell
# Windows PowerShell
$env:VB6_AGENT_ORIGINS = 'https://wieslawsoltes.github.io'; npm run agent:relay
```

Then enter `http://127.0.0.1:4892` and paste the **currently running relay's local access token** into Connection. It is not an OpenAI API key. Allow local-network access when prompted by your browser. A static GitHub Pages site cannot start the Node process for you. Keep the relay local; do not use wildcard origins or expose it publicly.

A missing token or invalid relay URL is now diagnosed before any popup opens. An unreachable relay, rejected origin, old/disabled relay, invalid token, malformed response, or timeout produces an actionable message. Account-status/cancel requests time out after 8 seconds, including a response body stalled after headers. Login preparation and sign-out have 45-second deadlines, independent of the wait for your consent.

When popup creation, opener isolation or navigation is blocked, use **Open ChatGPT sign-in**. The manual link opens an isolated browser tab and remains available if a later status poll fails. Use **Refresh account status** to recover the existing attempt or **Cancel sign-in** before starting another one. Popup exceptions never bypass error reporting or strand busy controls. Clear Credentials also removes browser-side retry state and the sign-in URL; it does not revoke an existing ChatGPT session.

Downloaded `file:` HTML and the packaged `vb6:` desktop origin are not accepted by this browser relay. The IDE now explains that rather than attempting an impossible login. Run `npm run build` and `npm run serve`, open `http://127.0.0.1:8080`, and start `npm run agent:relay` with its default local origin. This fix does not relax the desktop navigation/CSP rules or introduce a native OAuth bridge.

Failure-path browser tests inject relay and popup failures; the separate existing integration tests still exercise a real loopback relay and callback. Neither uses a live ChatGPT account or production inference. See [the full sign-in guide](CHATGPT-LOGIN.md) for account storage, consent, plan limits and the official OpenAI protocol references.
