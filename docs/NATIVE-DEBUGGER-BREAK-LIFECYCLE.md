# Native debugger break lifecycle

The native debugger requires both a successful Windows break-helper acknowledgement and an actual CDB stop before a pause request succeeds. A CDB prompt alone never converts a failed helper into a pass.

## Failure evidence

On the DATE integration candidate d1da52b66976dd658d0aa8113432d77475c82643, Actions run 37470941837 / x86 job 112293938154 passed 18 native checks before the nested PowerShell break helper was killed at its 15-second deadline. The captured CDB output reached an x86 breakpoint, but execFile reported `killed: true`, `signal: SIGTERM`, `code: null`. Its stderr contained first-use PowerShell progress, not a native permission-denied error. This establishes a helper-completion timeout; it does not establish exactly which internal startup or shutdown operation consumed the time.

The original failing artifact 11416986999 has SHA-256 `4c6d2c22b0fe49b28fa0fb229a2c191764d4af30ec209a8f75169ed57c8542de`. No unchanged retry, skipped assertion or raised deadline is counted as its repair.

## Direct ownership and protocol

The native system PowerShell now either issues the fixed API call itself or returns a strictly typed WOW64 routing response. Node starts any required system x86 helper directly; there is no nested PowerShell command or child whose lifetime is hidden behind a parent shell. Both phases consume the same existing 15-second budget. No retry issues a second speculative break. Progress serialization and unnecessary management-module loading are avoided.

A routing response carries the exact PID and hexadecimal GetProcessTimes creation identity. The x86 helper reopens the target, rechecks that identity and bitness, requires an attached debugger, issues DebugBreakProcess, closes its handle and acknowledges completion. Invalid, duplicate, wrong-PID, wrong-identity or wrong-bitness responses are rejected. Existing native-consent and HTTP authorization remain unchanged; these checks do not replace them.

CdbSession observes helper and stop promises concurrently. Abort, debugger exit, transport failure or a stop timeout cancel the helper and release the stop waiter. A helper error after a genuine stop still rejects the request while retaining the accurate paused state. A closure cannot return an old paused snapshot. Cancellation cannot undo an OS call already issued; the implementation does not claim transactional rollback of native effects.

## Regression coverage

`node --test tests/native-debugger*.test.mjs tests/debugger-boundaries.test.mjs` covers direct ownership, one-phase native and two-phase WOW64 responses, shared deadlines, malformed replies, exact identity, no automatic retry, cancellation before delayed dispatch, both completion orders, helper failure after a stop, timeout and cleanup.

The existing Windows native debugger workflow keeps all original process, DLL, thread, memory, watchpoint, detach and authenticated HTTP checks. Its smoke now requires three successive acknowledged native breaks, records phase durations, and preserves helper exit/timeout/error fields on failure. These are real matching-architecture Windows tests, not substitutes based on host doubles. Current-head Actions results, not local Linux tests or earlier green heads, determine native validation.

Scope remains the installed x86/x64 Windows CDB path. IsWow64Process does not qualify all ARM64 emulation combinations, and CDB machine/source frames are not universal VB6 P-code interpreter frames.

## Primary references

- https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-debugbreakprocess
- https://learn.microsoft.com/windows/win32/api/wow64apiset/nf-wow64apiset-iswow64process
- https://learn.microsoft.com/windows/win32/api/processthreadsapi/nf-processthreadsapi-getprocesstimes
- https://learn.microsoft.com/windows/win32/api/debugapi/nf-debugapi-checkremotedebuggerpresent
- https://nodejs.org/docs/latest-v22.x/api/child_process.html#child_processexecfilefile-args-options-callback
