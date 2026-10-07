# @vb6/native-automation

Reusable Node client plus the complete Windows PowerShell/.NET STA companion for
COM Automation, opt-in AxHost OCX containment, native OLE data transfer, clipboard,
active objects, object lifecycle and data-only structured storage. MIT licensed.
The package includes the production C# source files and the PowerShell entrypoint;
no checkout, generated binary, registration step or IDE is required.

Build all local tarballs using `npm run package:com-ole` at the repository root, then
install them together with `npm install --offline --ignore-scripts <tarballs...>`.
No package is published to the npm registry by this command. The companion starts
only on Windows and uses installed Windows PowerShell 5.1/.NET Framework. Node 22+
and matching x86/x64 installed COM components are required for native activation.

`NativeComOleClient` extends `NativeAutomationClient` and shares the canonical
`@vb6/automation` registry/value types. All clients require `allowNativeCode: true`.
Native code has full logged-in-user authority: this is NOT a sandbox. Class
allowlists are not transitive restrictions on what a granted object can access.

Existing-object access (`activeObjects`), publication (`publishActiveObjects`),
system clipboard reads (`clipboardRead`) and writes (`clipboardWrite`) require
separate grants. Clipboard access and publication can affect other applications.
No grant is inferred from project files, type libraries, references or monikers.
Data-only sessions can use `allowed: []` without granting class activation.

The transport is local stdio, not a network service. It never retries a timed-out
native operation because side effects may already have occurred. Close clients in
`finally`; close their VM Automation session first when one has been created.

This is not arbitrary vtable/aggregation/DCOM transport, a full OLE document/link
container, a native system drag loop or third-party component certification.
Unsupported interfaces, media and privileges fail explicitly. See `docs/COM-OLE.md`
in the source repository for the support matrix and API examples.
