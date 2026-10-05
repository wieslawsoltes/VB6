# Extended debugger compatibility

This guide extends the source-debugger contracts in [DEBUGGER.md](DEBUGGER.md). It distinguishes implemented operations from native VB6 equivalence; a supported machine-code operation is not automatically a VB6 interpreter operation.

## Event-driven Immediate

Choose **Debug > Enable Events in Immediate Session**. The IDE prepares an isolated application runtime and reuses the classic Immediate, Locals, Watches, Call Stack, execution controls and error dialog. It does not run `Sub Main` or show the project's startup form automatically.

Enter `Form1.Show` in Immediate to initialize and show a form. Form initialization precedes Load. Button, keyboard, pointer and timer events use the ordinary source-runtime queue after the explicit Immediate command finishes. Those queued handlers support breakpoints, stepping, inspection and error recovery. Explicit Immediate evaluation retains its time/instruction budget and does not recursively suspend at breakpoints inside the evaluation itself.

Reset ends this session, settles pending events and discards its scratch virtual filesystem. Replacing the project also disposes the frame. Press F5 after Reset to start the project normally. Application code remains in an opaque-origin iframe and receives no IDE-origin access or native-debugger credentials.

## Versioned Edit and Continue

The IDE first attempts the existing in-place live edit. Compatible changes take effect at the pending instruction without replaying earlier side effects.

When the active statement, loop/control region, local declaration layout or procedure signature cannot be migrated safely, the **versioned** policy retains the executing invocation's previous code. Future calls use the edited procedures. Existing locals, ByRef references, loop temporaries and program counters are not reconstructed or reset. Active procedures can be removed from the future procedure graph while their retained invocations finish.

The classic **Executing Source** window shows the retained revision read-only. Call Stack rows identify retained revisions. Stepping follows that code; breakpoints and Run to Cursor in the newly edited source do not accidentally stop on unrelated old line numbers. Set Next Statement refuses to redirect a retained invocation using coordinates from the new source.

The standalone runtime API keeps the conservative default:

```js
vm.applyEdits(project); // Strict, in-place migration only.
vm.applyEdits(project, {policy: 'versioned'});
```

Invalid source and incompatible changes remain atomic. Changing module membership, global/object storage, form layouts, interfaces or project execution settings still requires a restart. Versioned code retention is not arbitrary storage-layout migration, native binary hot patching, or unrestricted Edit and Continue.

## Native Windows process debugging

Install **Microsoft Debugging Tools for Windows** and Node.js 22 or newer on the Windows host. CDB is an external Microsoft dependency, not a redistributed part of this repository. `VB6_CDB_PATH` can select the installed `cdb.exe`.

Start the bridge in an interactive Windows terminal, with the exact browser IDE origin:

```sh
node tools/native-debugger.mjs --origin https://wieslawsoltes.github.io
```

For a deliberately trusted standalone file-origin IDE, add `--allow-file-origin`. Do not enable an origin merely because an untrusted page asks for access.

Open **Debug > Native Debugger**, choose **Connect**, and enter the loopback URL and temporary token printed by the bridge. Use **Attach** for an existing process or **Launch** for an absolute Windows EXE path and JSON argument array. The terminal requests `YES` approval for each target; child-process debugging must also be requested explicitly.

The native window provides break/continue, instruction or symbol-backed source stepping, native stacks, process/thread selection, all-process stack snapshots, registers, memory, disassembly, modules, symbol paths, expression inspection, breakpoints and exception policy. Memory/register changes are explicit operations, not undoable source edits. Detach leaves the target running. Windows permissions still control which targets can be debugged; the bridge does not elevate privileges.

DLLs and COM components are inspected in their hosting processes. Matching symbols/source are required for useful native source lines and local variable names. An optimized binary can legitimately omit values or frames. Unreadable memory is shown as `??`, not fabricated zeroes. A P-code executable can be inspected as a native process, but this does not reconstruct its VB6 logical interpreter frames, local variables or P-code instructions.

## Native transport boundaries

The reusable package is `packages/native-debugger` (`@vb6/native-debugger`). It has no npm runtime dependencies. The HTTP service binds only `127.0.0.1`, checks exact Host/origin values, uses a private in-memory bearer token, defaults to denying target control, and bounds requests, output, session count and event history. Browser disconnects expire a short session lease and trigger detach.

No raw CDB command, extension-loading interface or shell command is exposed over HTTP. Typed mutations require a current pause identity. Command serialization and connection generations reject stale work. Credentials are not saved in projects, layout state, exported applications, or MCP capabilities. The CLI requires local human consent; embedding hosts must provide their own explicit authorization callback.

## Validation and equivalence

`tests/debugger-boundaries.test.mjs` tests source event delivery and versioned state preservation. `tests/native-debugger*.test.mjs` covers native protocol/transport and browser client contracts. `tools/browser-debugger-boundaries.py` tests actual source-runtime DOM workflows; its native UI cases explicitly use a transport fixture and are not evidence of native-engine execution.

`tools/native-debugger-smoke.mjs` runs separately on Windows with compiled x86/x64 EXE and DLL fixtures and matching symbols. It verifies actual CDB behavior and fails rather than skipping when a required engine, target or operation is unavailable. Its fixture initializes COM but is not a licensed Microsoft VB6 compiler/debugger oracle.

Native VB6 P-code interpreter debugging, arbitrary live storage migration, exact native fonts/pixels and exhaustive licensed VB6 debugger certification are not implemented or certified by these tests. Existing historical validation reports describe their own commits; use the PR's final-head workflow results for this continuation.

## Microsoft references

- [CDB command-line options](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/cdb-command-line-options)
- [Debugging a user-mode process using CDB](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/debugging-a-user-mode-process-using-cdb)
- [Child-process debugging](https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/-childdbg--debug-child-processes-)
- [Ending a debugging session in CDB](https://learn.microsoft.com/en-us/windows-hardware/drivers/debugger/ending-a-debugging-session-in-cdb)
