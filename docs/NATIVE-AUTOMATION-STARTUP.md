# Native Automation startup and deadlines

Cold initialization has a separate bounded `startupTimeout` (60 seconds by default) for PowerShell/.NET startup and host compilation. Individual calls still use `timeout` (15 seconds by default); both options accept 100–120,000 milliseconds. A timeout aborts the client without retrying native operations. Error codes distinguish initialization from invocation timeouts, and `diagnostics()` exposes bounded stderr and transport state without request arguments. Native probe reports retain this information on failures as well as successes.

## Validation

The x86 hosted probe twice exceeded the previous shared 15-second deadline during cold startup, while x64 and earlier x86 system probes succeeded. Initialization now has its own bounded budget rather than extending every native call. Reports always record startup/elapsed time, completed checks, error phase and bounded diagnostic state. No failed assertion is skipped, and neither the host nor client automatically retries a potentially side-effecting native operation.

Portable regressions cover option bounds, a slow initialization with a shorter invocation deadline, both timeout codes, pending-call cleanup, and rejection of calls after timeout without replay. Run `node --test tests/native-automation-client.test.mjs`; the complete `npm test` suite includes it. Actual system-component evidence still comes from the x86/x64 Windows workflow, not these transport fixtures.

See [Native workspace and interoperability](NATIVE-WORKSPACE-INTEROP.md) for activation consent, component limitations and the separate licensed VB6 harness.
