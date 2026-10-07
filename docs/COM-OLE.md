# COM, Automation and OLE

The implementation has three reusable layers. Portable JavaScript contracts do
not pretend to be a Windows binary ABI. The native companion invokes installed
Windows COM/OLE services after explicit host consent. Both feed the existing VB
runtime rather than requiring a separate IDE.

## Packages and installation

| Package | Responsibility | Environments |
| --- | --- | --- |
| `@vb6/com-ole` | Identity, activation, dispatch, enumeration, connection points, streams, data objects, scoped clipboard and caller-driven drag/drop | Modern browsers and Node 22+ |
| `@vb6/automation` | Registry and sessions, VB values, bounded wire codec, portable COM-to-VB adapter | Modern browsers and Node 22+ |
| `@vb6/native-automation` | Node client and complete C#/PowerShell STA companion, including existing OCX hosting | Node 22+; native execution requires Windows |

From the source checkout:

```sh
npm run package:com-ole
npm run test:com-ole:packages
```

The first command creates three npm tarballs and a SHA-256 manifest in
`artifacts/com-ole/`. It does not publish to a registry. The second installs only
those tarballs outside the checkout, offline and without lifecycle scripts. It
runs the packaged portable tests and verifies cross-package type identity. On
Windows it also starts the installed companion and exercises native data/storage.

Install the three produced tarballs together in the consuming project:

```sh
npm install --offline --ignore-scripts /path/to/vb6-com-ole-0.1.0.tgz /path/to/vb6-automation-0.1.0.tgz /path/to/vb6-native-automation-0.1.0.tgz
```

The source package entrypoints intentionally use canonical repository modules.
Distribute the staged tarballs, not the unbuilt `packages/automation` or
`packages/native-automation` directories. The packager rewrites the complete
static import closure. Native and portable adapters share the same `VBArray`,
`Cell`, `VBError` and registry classes; the native package does not bundle duplicate
copies. `@vb6/automation/internal/*` is an exact-version companion interface, not a
stable application API.

## Portable contracts

`ComObject` implements a static interface set, a canonical `IUnknown` identity and
explicit reference ownership. `QueryInterface`, activation, ROT lookup and
pointer-bearing enumeration return owned references. The recipient calls
`Release`. Final release invalidates the object synchronously. Enumerator copies
rollback acquired results on failure without advancing their position.

`ComClassRegistry` only contains host-installed factories and explicit ProgIDs.
`RunningObjectTable` supports strong or weak registrations and exact-name
`DisplayNameMoniker` objects. Names are never parsed as file paths, URLs or scripts.

`DispatchObject` provides case-insensitive member/parameter lookup, reversed
`DISPPARAMS` arguments, named DISPIDs, optional arguments, default members,
`PROPERTYPUT` versus `PROPERTYPUTREF`, ByRef cells and exception metadata. Callbacks
are synchronous. Its type information is portable metadata, not native
`ITypeInfo`; numeric/VARIANT conversion belongs to the VM adapter.

`MemoryStream` implements bounded direct-mode reads, writes, seeking, resizing,
copying and cloning. Clones share storage but have separate cursors. Region locks
and transactional storage are not simulated. `OleDataObject` supports HGLOBAL-like
byte arrays and streams, format negotiation, delayed rendering, `GetDataHere`,
format/advisory enumeration and `NODATA`/`PRIMEFIRST`/`ONLYONCE`/`DATAONSTOP` callbacks.
`StgMedium.move()` transfers ownership and invalidates the old wrapper; release is
explicit. Medium data passed to an advisory callback is borrowed for that callback.

`OleClipboard` is scoped to the embedding host. It never accesses the OS clipboard.
Flush materializes independent bytes, including streams, and refuses to overwrite
a reentrant clipboard replacement. `OleDragSession` drives source/target callback
ordering, cancellation, effects and lifetime. The embedding application supplies
DOM/input events; it is not a native `DoDragDrop` message loop.

## Using portable Automation

```js
import {DispatchObject} from '@vb6/com-ole';
import {AutomationRegistry, registerComClass, automationInvoke} from '@vb6/automation';

const registry = registerComClass(new AutomationRegistry(), 'Example.Counter', () =>
  new DispatchObject([
    {name: 'Value', dispid: 1, params: [], get: () => 42}
  ])
);
const session = registry.createSession();
try {
  const counter = await session.create('Example.Counter');
  console.log(await automationInvoke(counter, 'Value', 2));
} finally {
  await session.close();
}
```

Factories transfer one owned interface reference. Callback object results and
new ByRef object assignments transfer owned references, commonly acquired with
`QueryInterface`. Incoming object arguments are borrowed interface views. Returning
an unchanged incoming view, including an unchanged ByRef value or array element,
acquires an independent return reference; it never consumes the VM's owning
reference. An explicit `AddRef` on such a view must be balanced or transferred.
Calling `Release` on a borrowed view without `AddRef` is rejected.

`registerActive` grants an existing-object resolver; `registerMoniker` grants an
exact display-name resolver. Sessions snapshot all grants and wait for late
factory cleanup during close. `createComAutomationRegistry` adapts explicitly
listed class registrations and ROT names into the same registry.

The runtime bundle exposes `RuntimeAPI.ComOle`, `AutomationRegistry`,
`registerComClass` and `createComAutomationRegistry`. Supply the resulting registry
through the existing VM/host `automation` option. Browser source imports and
standalone generated runtime exports use the same behavior.

### VB GetObject distinctions

| Expression | Meaning |
| --- | --- |
| `CreateObject("Example.Counter")` | Create an allowed class |
| `GetObject("", "Example.Counter")` | Create a new instance; an empty path is not omission |
| `GetObject(, "Example.Counter")` | Resolve an explicitly granted active object |
| `GetObject(class:="Example.Counter")` | The same omitted-path active lookup |
| `GetObject("Doc:One")` | Resolve an exact host-installed moniker capability |

Unknown/ungranted bindings raise VB error 429. The browser does not silently launch
an application or interpret the name as a URL. `Null` arguments preserve VB error
semantics. Tagged scalar types, multidimensional array bounds, object identity,
ByRef copyback and `_NewEnum` are preserved by the portable bridge.

## Native Windows services

`NativeComOleClient` extends the existing `NativeAutomationClient`. Native execution
uses matching x86/x64 installed COM components, Windows PowerShell 5.1, .NET
Framework and an STA message pump. All production C# files and the launcher are
included in the native tarball. Nothing is registered or activated merely by import.

```js
import {NativeComOleClient} from '@vb6/native-automation';

const client = new NativeComOleClient({
  allowNativeCode: true,
  allowed: [],
  architecture: 'x86'
});
try {
  const format = {cfFormat: 13, tymed: 4};
  const data = await client.createDataObject([
    {format, data: new Uint8Array([65, 0, 0, 0])}
  ]);
  try {
    console.log(await client.getData(data, format));
  } finally {
    await client.releaseHandle(data.id);
  }
} finally {
  await client.close();
}
```

This data-only example grants no class activation or system clipboard access.
Native APIs include canonical interface queries, active-object lookup and
publication/revocation, real `IDataObject` transfer and advisory connections,
registered clipboard formats, gated OS clipboard operations, IOleObject metadata,
verbs, HIMETRIC extents, host names, update/close and advisory callbacks.
In-place activation and deactivation require the session's own explicitly granted
AxHost preview; callers cannot supply arbitrary HWNDs or raw pointers.

`writeCompoundFile` and `readCompoundFile` use Windows `IStorage`/`ILockBytes` for
bounded nested streams, class IDs and Unicode names. These are data operations:
no `OleLoad`, path access or server activation is performed on the compound bytes.
Existing native IDispatch/VARIANT/SAFEARRAY transport, OCX persistence, licensing,
property pages, ambient properties and event handling remain in the same companion.

`client.registry()` supplies the VB Automation registry. `activeObjects` enables
native `GetObject` only for separately listed ProgIDs. Close the VM Automation
session before closing its client. Native handle cleanup is idempotent across
failed adoption, nested results and VM Stop.

### Trust boundary and limits

Native components have the full authority of the logged-in user. This is **not a
sandbox**; an allowed component can itself access other files, processes or COM
objects. `allowNativeCode: true` is mandatory. Activation/control allowlists,
`activeObjects`, `publishActiveObjects`, `clipboardRead` and `clipboardWrite` are
separate host grants, never inferred from imported projects or type libraries.
Publication and clipboard writes can affect other applications. Timed-out native
calls are not replayed, because their side effects may already have occurred.

The transport is local stdio, not a network listener. Typical native limits are
128 object handles, 64 class grants, 256 data formats/advisory connections, 512 KiB
medium/compound-file payloads, eight storage nesting levels and 1 MiB messages.
Notification snapshots are bounded; dropped notifications are reported. Portable
streams/data objects default to 16 MiB. Oversized or unsupported media fail explicitly.

## Validation and remaining scope

`npm run test:com-ole` runs the portable/runtime/native-client contracts.
`python tools/browser-com-ole-tests.py` checks ESM and generated runtime behavior;
set `VB6_BROWSER` to `chromium`, `firefox` or `webkit`.
`npm run test:com-ole:packages` validates the independently installed tarballs.
Windows validation runs the system Automation suite, native OLE service suite,
native container/error fixtures and installed-package consumer in both bitnesses.
These are jobs in the existing Validate workflow, not new deployment workflows.

This is not universal VB6/COM/OLE compatibility certification. Remaining areas
include arbitrary custom-vtable/aggregation ABI support, DCOM security and remote
transport, native system drag/drop registration, general OLE linked/embedded
compound-document containers and menu negotiation, browser execution of binary
servers, and compatibility validation of proprietary third-party components.
Only bytes/streams cross the new medium transport; GDI handles, file/storage
handles and target-device descriptors are explicitly unsupported there. The
freestanding Win32/compute compiler targets do not gain arbitrary COM server
execution through these JavaScript runtime services.

### Native interface declaration compatibility

The companion declares the SDK `IEnumSTATDATA` IID (`00000105`) explicitly.
.NET Framework's reference-source declaration uses `00000103` (the format
enumerator IID), which cannot be used as the return interface of the native
advisory holder. The custom `IDataObject`, holder and `IOleObject` signatures
share the corrected type, and the native fixture checks enumeration after
`ONLYONCE` expiration and subsequent re-registration.

## Primary contracts

- [COM interface rules](https://learn.microsoft.com/windows/win32/com/rules-for-implementing-queryinterface)
- [IDispatch::Invoke](https://learn.microsoft.com/windows/win32/api/oaidl/nf-oaidl-idispatch-invoke)
- [IDataObject::DAdvise](https://learn.microsoft.com/windows/win32/api/objidl/nf-objidl-idataobject-dadvise)
- [IDataAdviseHolder::Advise](https://learn.microsoft.com/windows/win32/api/objidl/nf-objidl-idataadviseholder-advise)
- [ReleaseStgMedium](https://learn.microsoft.com/windows/win32/api/ole2/nf-ole2-releasestgmedium)
- [Marshal error-information behavior](https://learn.microsoft.com/dotnet/api/system.runtime.interopservices.marshal.getexceptionforhr)

- [Windows SDK object interface IDL](https://github.com/microsoft/win32metadata/blob/75ec935a4f1ac56345daa9f7f0bc21db3e68ac68/generation/WinSDK/RecompiledIdlHeaders/um/ObjIdl.Idl)
- [.NET Framework advisory enumerator declaration](https://github.com/microsoft/referencesource/blob/ec9fa9ae770d522a5b5f0607898044b7478574a3/System/compmod/system/Runtime/InteropServices/ComTypes/IEnumSTATDATA.cs)
