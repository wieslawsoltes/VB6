# @vb6/com-ole

Dependency-free JavaScript contracts for COM identity, explicit reference ownership,
trusted class activation, connection points, enumeration and a scoped running object
table. Works in Node and modern browsers without the VB6 IDE. MIT licensed.

All objects begin with one owned reference. Successful `QueryInterface`, factory
activation and ROT lookup return an owned reference; the recipient calls `Release`.
Interfaces are fixed at construction, and all interfaces share one `IUnknown`
identity. Final release invalidates the object synchronously. Enumerators return
`{hresult, values, fetched}` and pointer-bearing results own references independently
of the enumerator. `ConnectionPoint.Fire` returns failures without skipping other sinks.

The portable registry never loads DLLs, imports project-supplied code, scans an OS
registry, opens a file or executes a moniker string. Its exact display names are
case-sensitive capabilities registered by trusted embedding code. This package is
not a binary COM ABI, DCOM transport, Windows OLE document server or a certification
of arbitrary third-party COM/OCX components. Native execution uses the separately
opted-in Windows companion.

Run `npm test` in this directory for standalone contract tests.

## Automation and OLE services

The `/com` entry also exposes `DispatchObject`, `ComByRef`, `DISPATCH` and
`DISPID`: case-insensitive names, named/reversed dispatch arguments, optional
parameters, default members, property puts and synchronous callbacks.

The `/ole` entry exposes `MemoryStream`, `StgMedium`, `OleDataObject`,
`OleClipboard`, `OleDragSession`, `DropSource` and `DropTarget`, with clipboard
format and effect constants. Streams are direct-mode and bounded; stream clones
share bytes but not cursors. Clipboard flush takes an independent snapshot.
Data objects support delayed rendering, format negotiation and bounded advisory
connections. Advisory callback media are borrowed until the callback returns.

`npm test` also works inside the installed package; the contract tests are shipped
with it. Build all three reusable packages from the repository using
`npm run package:com-ole`, and validate an offline external consumer using
`npm run test:com-ole:packages`. The other packages are `@vb6/automation` and
`@vb6/native-automation`; no npm publication is performed.

See [COM/OLE integration and support matrix](https://github.com/wieslawsoltes/VB6/blob/main/docs/COM-OLE.md)
for VB `GetObject` semantics, ownership examples, native permission grants and
remaining compatibility boundaries.
