# Native workspace and interoperability

These facilities extend native project interchange. Importing a project **does not grant native-code permission**, install components, evaluate plug-in code, or connect to a local service. The classic IDE keeps its existing document, dialog, and menu chrome.

## Explicit archive filename code page

Use **File → Open ZIP with Filename Encoding…** for an archive whose unmarked filenames were written in a Windows code page. Choose Windows-1250 for Central European filenames, Windows-1251 for Cyrillic, Shift-JIS, GBK, Big5, EUC-KR, or another listed encoding. The usual subsequent native-project dialog still chooses the **source text** encoding separately.

The precedence is the ZIP UTF-8 flag, a valid CRC-checked Unicode Path extra field, then the explicit filename encoding. Normal opening defaults to CP437; an explicit choice stays in this IDE session until changed. It is not stored in the project or exported application. Malformed selected encodings, path collisions, traversal, and inconsistent headers are rejected using the existing bounded ZIP preflight. No heuristic promises to distinguish arbitrary unmarked encodings. Extract an archive externally when its producer used an unsupported mapping.

The core API is `readZip(bytes, {filenameEncoding: 'windows-1250'})` in `src/project/zip.js`. `ZIP_FILENAME_ENCODINGS` lists the supported choices. These use the browser's supported encoding tables, not a claim that every historic Windows NLS mapping is identical.

## Original VBW document windows

A sibling `.vbw` file is preserved byte-for-byte on an unchanged native save. Recognized five-field code-window and ten-field code/designer records restore corresponding in-page document windows when opening a project. Rectangle coordinates and the known normal, closed (`C`), and maximized (`Z`) states are mapped to the existing MDI document manager. Imported projects never spawn external browser/OS windows by themselves.

**Window → Restore Native Document Windows** reapplies the imported snapshot. **Window → Save Current Native Document Windows** explicitly captures current document visibility, geometry, and maximized state; the next project save writes the companion. Closing a document then capturing records it as closed. Module identity links survive supported renames; an exported VBP relocation uses its sibling VBW path.

Unknown records, extension fields, ambiguous names, and unrecognized flags remain preserved rather than guessed. Unsupported records are not used to rearrange windows. An entirely opaque VBW does not close the IDE's default documents. Browser snapshots also retain the native state. Imported records and captures have bounded counts and geometry; browser viewport/layout constraints still apply.

This is document-window interoperability, not restoration of machine-specific VB6 registry settings, add-in windows, tool docking, monitor topology, native edit-selection state, or every undocumented VBW extension.

## Recoverable multi-file folder saves

Folder saving now stages every observed output dependency's original and intended bytes in `.vb6-save-journal` before writing destination files. A bounded manifest records paths, sizes, and SHA-256 digests. Existing external-change checks and dependency-before-manifest publication remain in force. Completed bytes are verified before success is reported.

On a caught write failure, rollback is attempted only while destination bytes still equal the recorded original or intended content. A third-party edit stops recovery rather than being overwritten. Original backups are not discarded on an unresolved conflict. Cleanup failure after a verified successful publication does **not** roll back the completed project; the IDE reports a pending journal instead.

After an interruption, use **File → Recover Native Folder Save…**, explicitly select the folder, inspect the result, and choose **Restore Original**, **Complete Save**, or **Cancel**. Both recovery directions validate staged data, preflight all destinations, and recheck each write. They do not overwrite unrelated concurrent bytes. The current IDE workspace is marked unsaved after recovery; reopen the folder to synchronize its actual recovered state.

Incomplete staging without a valid journal remains for manual inspection. Do not delete it without reviewing its contents and destination files. A persistent conflicting journal deliberately blocks another save until recovered or explicitly resolved by the owner.

This is **not an atomic directory transaction**. Other processes may observe intermediate writes, process crashes can leave a journal, operating-system durability varies, and a final external edit can always race a filesystem check. Web Locks serialize this application's cooperating saves within an origin when available; they do not lock arbitrary native applications. Staged before/after sets each retain the existing bounded import-size contract. Read-folder traversal excludes the journal.

For an immutable single-file alternative on Node, publish a new ZIP snapshot:

```sh
npm run snapshot:native -- path/to/project path/to/backups/snapshot-001.zip
```

The destination must be new and outside the source tree. The tool rereads the input snapshot, writes and flushes a private sibling temporary file, then uses an exclusive hard link to publish a completed file without replacing an existing backup. Unsupported hard-link filesystems fail explicitly. This provides a single-file publication boundary, not an in-place VBP-folder transaction or a power-loss durability certificate.

## Trusted browser control and Automation adapters

`RuntimeAPI.ControlAdapterRegistry` and `StudioAPI.ControlAdapterRegistry` accept **host-installed functions**, never functions or URLs from project data. Register runtime and designer factories separately. A factory must synchronously return a BrowserControl-compatible object with the same model identity, node, refresh, and dispose contract.

```js
const registry = new VB6Runtime.RuntimeAPI.ControlAdapterRegistry()
  .register('Vendor.Widget', {
    runtime: (model, options) => new MyRuntimeWidget(model, options),
    designer: (model, options) => new MyDesignerWidget(model, options)
  });
const app = new VB6Runtime.RuntimeAPI.ApplicationHost(project, container, {
  persist: false,
  controlRegistry: registry
});
await app.start();
```

A trusted IDE embedding can call `vb6Studio.installControlAdapters(registry)` while stopped. Existing designers are refreshed and new designers receive the registry. Registered runtime types also support `Controls.Add` through the standard form/control lifecycle. Normal VB events, properties, selection, and disposal remain available through compatible adapters. Projects and snapshots do not serialize factories or automatically grant them to exported applications; the trusted application embedding must install its adapters independently. These are JavaScript implementations, **not browser execution of binary OCX files**.

`RuntimeAPI.AutomationRegistry` similarly registers exact ProgIDs as asynchronous factories returning `{metadata, invoke, release}` adapters. Metadata exposes bounded method/property modes and parameter names. The VM uses opaque per-session object identities, normal VB argument binding, default/indexed properties, `CallByName`, ByRef copyback, and bounded enumeration snapshots. Stop closes the session; late results cannot copy back into a stopped frame. Native wrapper internals and prototype members are not exposed to VB.

An adapter's `invoke(member, mode, args, byRefIndices)` returns `{value, args}`. `args` is the copyback array and must match the supplied argument count. Modes are method=1, get=2, let=4, set=8. Optional arguments retain the VM's Missing sentinel. The session owns adapters until stop; assignment of a single VB variable to Nothing is not a claim of native reference-count timing.

## Opt-in native Windows Automation and ActiveX

`tools/interop/native-automation.mjs` launches an isolated local **Windows PowerShell STA** process using the supplied C# host. Choose x86 for normal VB6-era components, or x64 only for matching installed registrations. Nothing is downloaded, registered, installed, or exposed through HTTP. A browser page cannot discover or connect to this stdio process automatically.

```js
import {NativeAutomationClient} from './tools/interop/native-automation.mjs';
import {VirtualMachine} from './src/runtime/vm.js';

const native = new NativeAutomationClient({
  allowNativeCode: true,
  architecture: 'x86',
  allowed: ['Scripting.Dictionary', 'Msxml2.DOMDocument.6.0']
});
try {
  const vm = new VirtualMachine(compiledProject, {
    automation: native.registry(),
    print: console.log
  });
  try { await vm.start(); }
  finally { vm.stop(); await vm.automationClose; }
} finally { await native.close(); }
```

Each client supports one VM session. This is an explicit trusted Node/native embedding API; a hosted browser IDE does not gain OS authority. Installed COM code has **the full authority of the user**, is not sandboxed, and may have external side effects that cancellation cannot undo. Review both project code and components before granting activation. Exact allowlists govern root activation, not a sandbox around objects returned by an allowed component.

The host inspects `IDispatch` type information, checks invocation modes, retains stable object handles, bounds requests/results/arrays, and releases its session handles on close. The wire supports strings (including Unicode/NUL), numbers, Boolean values, Missing/Empty/Null/Nothing, OLE dates, exact decimal/currency text, errors, and bounded arrays with nonzero lower bounds. Runtime metadata and .NET COM marshaling do not provide universal Variant-subtype, typed SAFEARRAY, arbitrary vtable, locale, or native event-sink ABI equivalence. Components without usable dispatch type information fail explicitly.

For native control inspection, additionally include the ProgID in `controls` and explicitly send `{op:'create', progId:'Vendor.Control', preview:true}` using the client. A separate Windows `AxHost` window and idle STA message pump host the installed control; it is not composited into a browser DOM canvas. Existing ActiveX killbit checks are respected. `saveState` and `loadState` operate only on the component's supported raw `IPersistStream`/`IPersistStreamInit` stream, bounded to 512 KiB. They do not deserialize arbitrary .NET objects or guess proprietary FRX/OcxState wrappers. Component-specific adapters are still required for such wrappers, custom designer services, and native connection-point event interfaces.

## Owner-run licensed VB6 oracle

No Microsoft compiler binary, license, runtime redistribution, or activation information is supplied. A default portable run only imports, exports, reopens, verifies unchanged source/companion hashes, and stages original/round-tripped native and p-code configurations:

```sh
npm run verify:classic -- --project examples/classic/HelloRuntime.vbp --out reports/my-stage
```

Its report states `compilerStatus: "not-run"`. On a trusted Windows installation with a licensed VB6 compiler, explicitly enable compilation:

```sh
node tools/verify-classic-roundtrip.mjs --project examples/classic/HelloRuntime.vbp --out reports/my-licensed-run --compiler "C:\Program Files (x86)\Microsoft Visual Studio\VB98\VB6.EXE" --compile --allow-native-code --ide-smoke
```

The harness works on isolated copies, requires fresh output paths, checks all original source and companion bytes on no-op interchange, builds both source copies in native/p-code modes through the existing compiler runner, and retains executable hashes/logs. `--ide-smoke` is limited to the supplied self-terminating HelloRuntime fixture: it opens/runs original and round-tripped native configurations in the licensed IDE and requires a fresh expected smoke marker. It does not automate arbitrary project GUI journeys or claim that preserved metadata was accepted by every proprietary designer.

The `Native workspace interoperability` workflow includes a **manual, main-only** licensed job for a separately configured `[self-hosted, Windows, vb6]` runner. Normal PRs do not execute on that runner. Configure `VB6_COMPILER` on the trusted host as supported by the existing compiler finder. Licensed results are only certified when an actual owner-run job records them; a skipped job or a successful staging test is not compiler certification. Current native staging supports EXE/OleExe targets rather than every VB6 project type.

## Verification and references

The portable tests cover malformed/unknown VBW records, captures and round trips, interrupted folder writes, third-party conflicts, staged-byte tampering, cleanup failures, code-page precedence, opaque Automation identities, named/default/ByRef calls, late stop, and exclusive snapshot publication. Browser integration covers visible classic dialogs, document restoration, designer/runtime factories and dynamic controls; persistent journal tests use real origin-private filesystem handles over HTTP, not an automated OS picker. Native Windows tests separately exercise actual system Automation components and an explicitly granted installed ActiveX control; their reports distinguish unavailable-component skips.

- ZIP filename flags and Unicode extras: PKWARE APPNOTE, https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
- Microsoft COM type information: https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nn-oaidl-itypeinfo
- Microsoft Windows Forms AxHost: https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.axhost
- Microsoft stream persistence: https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nn-ocidl-ipersiststreaminit
- Observed classic VBW records (not a universal format specification): https://github.com/yereverluvinunclebert/Panzer-CPU-Gauge-RC5-VB6/blob/main/Panzer-CPU-Gauge-RC5-VB6.vbw

Full arbitrary COM/OCX/designer parity, original registry/tool-window restoration, every undocumented VBW extension, atomic in-place folder transactions, and universal licensed VB6 certification remain outside these implemented contracts.
