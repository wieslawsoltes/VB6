# Native Windows debugger

A reusable, dependency-free JavaScript adapter for Microsoft CDB, plus a permission-gated loopback HTTP bridge. Requires Node 22 or newer and an installed Microsoft Debugging Tools for Windows engine. CDB is not bundled or redistributed by this package.

`CdbSession` supports native process attachment/launch, break/continue/step, symbols, native stacks across processes/threads, registers, memory, breakpoints and non-terminating detach. Addresses are hexadecimal strings so 64-bit values are never rounded by JavaScript numbers. A serialized command stream and pause identities reject stale mutations. Raw CDB commands, shells, extensions and scripts are not exposed over HTTP.

Run the repository bridge from an interactive Windows terminal:

```sh
node tools/native-debugger.mjs --origin https://wieslawsoltes.github.io
```

Use `--allow-file-origin` only for a deliberately trusted standalone IDE. The bridge prints a fresh in-memory token and asks for local approval of every target. It binds only 127.0.0.1, checks exact origins and Host, uses bearer headers rather than query tokens, and detaches expired browser sessions. The reusable bridge defaults to denying target control until the embedding host supplies an authorization callback.

```js
import {CdbSession} from '@vb6/native-debugger';
const session = new CdbSession();
await session.start({pid: 1234}); // Caller must have permission to debug this PID.
const stack = await session.request('stack');
await session.request('stepOver', {pauseId: session.pauseId});
await session.waitPaused();
await session.request('detach'); // Leaves the target running.
```

Native source lines require matching symbols/source. DLLs and COM components are debugged in their host processes. Debugging a P-code executable at the native machine level does not reconstruct the VB6 interpreter's logical frames, local storage or bytecode instructions. No licensed native VB6 debugger certification is claimed.

Validation uses portable protocol/security tests and separate Windows x86/x64 real EXE/DLL fixtures. A mock transport test is not a native-engine test.
