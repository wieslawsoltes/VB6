# ChatGPT sign-in: no popup or browser window

Click **Sign in with ChatGPT**. A classic **ChatGPT sign-in** dialog opens immediately inside the IDE, including on first use with an empty relay-token field. Its `Browser handoff v2` text identifies this implementation. This dialog does not depend on `window.open`, browser popup permissions, or an asynchronously navigated blank tab. Enter the local relay URL and access token directly in the dialog; both are synchronized with Connection and remain in memory only.

The updated local relay asks the operating system to open OpenAI in the default browser after starting its PKCE callback listener. It uses argument-vector process launching without a shell: macOS `open`, Windows `rundll32`/`FileProtocolHandler`, and Linux `xdg-open`. Only the internally generated, validated OpenAI authorization address is accepted; neither a browser-supplied URL nor arbitrary commands can be launched. The management endpoint still requires its access token and exact allowed Origin and loopback Host. Status refresh never launches a browser. A pending attempt prevents duplicate launches.

**A launch acknowledgment is not a verified sign-in.** The dialog always retains a real **Open ChatGPT sign-in** hyperlink, a selectable URL, and **Copy sign-in link**, even when the system launcher reports success. Click that hyperlink to open a normal isolated browser tab, or paste the URL into your browser's address bar on the same computer. An old relay without OS launching uses this same fallback. No automatic JavaScript popup is needed. If clipboard access is denied, the full URL is selected for manual copying. Returning with **Back to IDE** preserves the current sign-in and fallback controls on Connection; it does not start a duplicate attempt or discard the project.

## Start sign-in without any IDE popup

From a local repository checkout with Node.js 22+, the following command starts the relay **and opens sign-in in the system browser**. It also prints the authorization link for manual opening on headless/unsupported systems. Keep that private, short-lived link and the relay access token out of issue reports.

```sh
# GitHub Pages IDE, macOS / Linux
VB6_AGENT_ORIGINS='https://wieslawsoltes.github.io' npm run agent:relay -- --sign-in
```

```powershell
# GitHub Pages IDE, Windows PowerShell
$env:VB6_AGENT_ORIGINS = 'https://wieslawsoltes.github.io'
npm run agent:relay -- --sign-in
```

For the local browser IDE use `npm run serve`, open `http://127.0.0.1:8080`, and run `npm run agent:relay -- --sign-in` in a second terminal with the default origin. After completing consent, paste the token printed by that relay into Connection and click **Refresh account status**. Do not start a second login while the terminal-started attempt is pending.

A static GitHub Pages site cannot start a local process. The relay is still required, even though no OpenAI API key is required for ChatGPT-account mode. Enter `http://127.0.0.1:4892` and the currently running relay's local access token. Allow local-network access when the browser asks. Never enable wildcard or null origins or expose the relay publicly.

## Errors and cancellation

Errors remain visible in the dialog, Connection and the footer. Missing/invalid tokens, unavailable/disabled/old relays, denied origins, invalid responses and deadlines have distinct recovery guidance. Status/cancel deadlines are eight seconds including streamed bodies; login preparation/logout have 45-second deadlines. Use **Refresh account status** after a failed poll or **Cancel sign-in** to abandon the attempt. **Clear Credentials** removes the retained link and browser pairing token; **Sign out** revokes an existing account session.

Downloaded `file:` HTML and packaged `vb6:` desktop origins remain unsupported by this browser relay. Their sign-in dialog explains how to use the served browser IDE. Desktop navigation/CSP and origin restrictions are not relaxed. No browser cookies, Codex credentials or OAuth tokens are imported, exposed to the browser or exported. API-key billing is never used as an automatic fallback.

## Validation scope

The three-engine browser suite exercises the actual dialog and user-clicked isolated tab while `window.open` is disabled. Management tests use a real loopback server and signed OpenAI fixtures, and verify authentication/Origin/Host checks before OS-launch requests. Platform-launch tests check command vectors, failures, cancellation and subprocess lifecycle, not actual interactive OS desktop visibility. OpenAI account eligibility and production inference require a live-account smoke test; passing fixture tests does not establish either. See [the account guide](CHATGPT-LOGIN.md).
