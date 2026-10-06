# OCX controls: designer, browser adapters and Windows hosting

The IDE preserves the classic toolbox, Components dialog, property grid and event
editor. There are two execution paths, not a Windows DLL loader inside JavaScript:
trusted browser control adapters, and the explicitly granted Windows Automation
companion. This implementation is **not certification of every original VB6 OCX**.

## Container-contract follow-up

See [OCX-CONTAINER-CONTRACTS.md](OCX-CONTAINER-CONTRACTS.md) for the added
portable lifecycle/container/windowless APIs, multi-selection property pages,
actual VB-authored source execution, executable lab, and extended native APIs.
The guide explicitly separates local JavaScript/inline Chromium passes from
**new native C# code that has not been compiled or run in this delivery**.
The historical Windows evidence below describes PR #52, not certification of the
new native code. Universal original VB6 OCX compatibility is not complete.

## Classic IDE integration

`ControlAdapterRegistry` accepts trusted runtime/designer factories plus immutable
metadata. Installed designer adapters appear in the extended toolbox and Components
dialog. Metadata supplies a valid instance base name, display name, descriptions,
default property values, numeric enumeration choices, read-only properties, outgoing
events and a default event. Double-clicking a control creates its typed handler;
control-array handlers include `Index As Integer`, and cancellation parameters retain
`ByRef`. Metadata lookup does not execute factories or native code.

The property grid supports descriptions, enumeration selectors and a classic
**Property Pages…** button. Trusted property pages receive a detached model and
return property changes; cancellation returns `null`. Changes are validated before
one undoable transaction. An asynchronous page cannot overwrite a changed project,
selection, registry or revision. Read-only properties remain protected when the
inspector temporarily enters and leaves debugger read-only mode.

Register adapters from trusted embedding code, not from imported project data:

```js
const registry = new VB6StudioAPI.ControlAdapterRegistry();
registry.register('Acme.Gauge.1', {
  runtime: makeGauge,             // synchronous BrowserControl-compatible factory
  designer: makeGauge,
  lifecycle: true,
  metadata: {
    baseName: 'Gauge',
    displayName: 'Acme Gauge',
    properties: [
      { name: 'Value', default: 25, description: 'Current instrument reading.' },
      { name: 'Mode', default: 0, choices: [
        { value: 0, label: 'Automatic' }, { value: 1, label: 'Manual' }
      ] },
      { name: 'Serial', default: 'ABC', readOnly: true }
    ],
    events: [{ name: 'Changing', params: [
      { name: 'Value', type: 'Long' },
      { name: 'Cancel', type: 'Boolean', byRef: true }
    ] }],
    defaultEvent: 'Changing'
  },
  propertyPages: async model => ({ Value: model.properties.Value + 1 })
});
vb6Studio.installControlAdapters(registry);
```

Factories must implement the component's actual rendering and behavior; registering
metadata alone is not an implementation of the named OCX. The registry is not
serialized into projects or automatically copied to published HTML. Trusted hosts
must install the corresponding runtime adapters in each execution environment.

## Portable property bags and control sites

`OcxControlSite` gives opted-in adapters `Ambient`, `Extender`, `PropertyChanged`,
`Dirty`, `RaiseEvent` and lifecycle hooks. `Ambient.UserMode` is VB False at design
time and VB True at runtime. Design-mode event delivery is suppressed. Disposal
terminates the site once and still disposes the control when termination fails.

A factory can attach synchronous hooks to its returned control:

```js
control.ocxLifecycle = {
  initProperties(site) { control.Value = 25; },
  readProperties(bag, site) { control.Value = bag.ReadProperty('Value', 25); },
  writeProperties(bag, site) { bag.WriteProperty('Value', control.Value, 25); },
  terminate(site) { /* release component-owned resources */ }
};
```

The trusted host explicitly captures persistence with
`model.ocxState = registry.save(control)` before serializing its model, then passes
that model when recreating the adapter. This is not automatic decoding or rewriting
of imported OCX state. `OcxPropertyBag.Contents` uses the versioned
`VB6.OCX.PropertyBag` JSON envelope. It retains typed Automation values, dates,
Currency/Decimal, array bounds, Empty/Null/Nothing and Boolean wire tags. Names are
case-insensitive; matching default values can be omitted. Updates are transactional.
Native object handles are rejected. Limits are 256 properties and 1 MiB of encoded
UTF-8 state. Lifecycle hooks are synchronous by contract.

Ordinary portable adapter events use the existing browser-control event queue.
The separate `SourceUserControl` runner awaits typed VB event callbacks with shared
ByRef cells; that does not imply binary COM execution inside the browser.

## Native Windows OCX path

`tools/interop/native-automation.mjs` launches the x86 or x64 STA companion only
with `allowNativeCode: true`. The application separately supplies the exact ProgID
allowlist and control-preview allowlist. Imported VBP/FRM/FRX files do not grant this
permission, register DLLs, discover/download plug-ins or extract license keys.
Existing ActiveX kill-bit checks remain in force.

```js
import { NativeAutomationClient } from './tools/interop/native-automation.mjs';
import { automationInvoke, automationSubscribe } from './src/runtime/automation.js';

const client = new NativeAutomationClient({
  allowNativeCode: true,
  architecture: 'x86',
  allowed: ['Shell.Explorer.2'],
  controls: ['Shell.Explorer.2']
});
const session = client.registry({ hostControls: true }).createSession();
try {
  const control = await session.create('Shell.Explorer.2');
  const detach = automationSubscribe(control, async (event, args) => {
    if (event.toLowerCase() === 'beforenavigate2') {
      await args[6].ref.set(-1); // VB True: cancel this navigation
      await automationInvoke(control, 'ReadyState', 2, []); // nested STA call
    }
  });
  await automationInvoke(control, 'Navigate2', 1, ['about:blank']);
  detach();
} finally {
  await session.close();
  await client.close();
}
```

The same Automation event subscription is connected to compiled VB `WithEvents`
fields. Assignment disconnects the prior source; subscribers run in connection
order and share ByRef cells without mutating ByVal arguments. Runtime stop/session
close disconnects sinks. Reentrant native callbacks use the active event token to
permit nested Automation calls while the control is waiting for cancellation.
Unrelated requests cannot use that token to enter the callback. Reentrant calls
into a paused debugger are rejected rather than silently executing user code.

The Windows host discovers the **default outgoing IDispatch event interface**,
advises connection points, creates typed event delegates, marshals arguments and
copies ByRef changes back before returning to the control. The root adapter is
automatically advised when event metadata is available. The follow-up additionally
implements explicit selection of discovered outgoing IDispatch interfaces by IID,
with native execution still pending validation. Arbitrary outgoing vtable
interfaces and automatic subscription to every returned child COM object are not
implemented. Event metadata is bounded to 256 events and 64 parameters; nesting,
queues, payload sizes and timeouts are bounded. Timed-out native operations are not
replayed because they may already have changed OS state.

Host-only operations include `controlInfo`, `showPropertyPages`,
`setControlBounds`, `setControlVisible`, `setControlEnabled`, `focusControl`,
`saveControlState`, `loadControlState`, `licenseInfo` and `handleOf`.
The property-page method invokes the installed control's own native pages.
Windows preview controls live in separate native windows, **not inside browser DOM**.
Stream persistence uses the existing bounded `IPersistStream` / `IPersistStreamInit`
path. The follow-up adds explicit property-bag and structured-storage host paths;
these new C# paths and their fixtures are authored but not Windows-validated here. A control can expose an interface but reject a save or load; its HRESULT is
reported, not replaced by invented state. These methods are host APIs, not an
unrestricted Automation surface available to VB programs.

For licensed controls, the host may supply an in-memory `licenseKeys` mapping keyed
by an allowed ProgID. Activation uses `IClassFactory2.CreateInstanceLic` with that
supplied key. The implementation does not call `RequestLicKey`, recover design-time
keys, write licenses into project files or bypass component licensing. The bitness,
installation, dependencies and valid license must match the installed component.
No proprietary licensed-control fixture is included or certified.

## Compatibility boundaries

The existing importer/exporter continues to preserve unsupported native OCX/FRX
bytes opaquely. The portable bag is **not** the native VB6 PropertyBag/FRX binary
format. Complete proprietary property decoding, native windowless/in-place OLE hosting,
every ambient interface and accelerator/focus rule, arbitrary outgoing vtable
interfaces, native binary UserControl/PropertyPage compilation and universal VB6
binary compatibility remain outside the verified implementation. The follow-up
provides portable container behavior and an isolated VB source runner, not all of
these native contracts. Its new native property-bag/storage persistence and design
site changes require Windows validation. Portable pages and native pages are
distinct paths; in-browser native-window embedding is not claimed.

## Validation

Run `npm run build && npm test` for portable regressions. The OCX-specific Node
suites cover compiled WithEvents/ByRef handling, sink lifecycle, invalid metadata,
property bags, trusted metadata, pages and typed editor handlers.

`python tools/browser-ocx-tests.py` now exercises twelve classic IDE/SDK workflows on modular
HTTP, standalone HTTP and standalone file origins. CI runs Chromium, Firefox and
WebKit. `VB6_OCX_ORIGINS=inline` is an additional local harness mode, not a substitute
for those navigation tests. Screenshots and JSON results go to
`reports/ocx-browser`.

The Windows interoperability workflow runs Automation, ActiveX and OCX suites on
x86 and x64. The OCX test uses the installed `Shell.Explorer.2` system component,
without remote navigation or component registration. It checks outgoing events,
ByRef cancellation, nested property calls, containment and teardown. Missing or
unlicensed components are explicitly marked skipped. When the system component
returns `E_FAIL` for stream persistence, the report records a rejected operation
and `roundTripCertified: false`, not a successful persistence round trip. No
licensed original Microsoft VB6 compiler or third-party OCX certification is implied.

## Protocol references

The implementation follows Microsoft's published contracts rather than proprietary
OCX resources or extracted binaries:

- [ActiveX controls](https://learn.microsoft.com/en-us/windows/win32/com/activex-controls)
- [IClassFactory2](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nn-ocidl-iclassfactory2)
- [IProvideClassInfo2](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nn-ocidl-iprovideclassinfo2)
- [ISpecifyPropertyPages](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nn-ocidl-ispecifypropertypages)
- [IPersistStream::Save](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-ipersiststream-save)

### Scalar-Variant interoperability

The OCX integration retains typed native Automation from PR #44. Scalar-aware
adapters carry Byte, Integer, Long, Single, Double and Boolean tags through event
arguments and ByRef copyback; native HRESULT source/help information and per-client
LCID are retained on reentrant calls. `OcxPropertyBag.ReadProperty` keeps the raw
JavaScript embedding contract; `ReadPropertyScalar` returns preserved Variant
subtypes for compiler-aware adapters. Wire snapshots retain those tags without
changing opaque native FRX data.


### Declared event parameter types

Event metadata now retains the declared Byte, Integer, Long, Single, Double,
Currency, Decimal, Date, String, Boolean, Object or Variant type. The Windows
companion resolves bounded TYPEDESC pointers, aliases and enum declarations; a
Variant remains Variant regardless of the value currently stored in it. Typed
ByRef cells use that declaration, so compiled `ByRef Cancel As Boolean` handlers
work without relaxing the VM's ordinary ByRef type checks. Invalid types and
case-insensitive duplicate event parameter names are rejected before subscription.
The native OCX suite also exercises a compiled VB handler against the installed
system control, rather than testing cancellation only from JavaScript.

Type contracts: [TYPEDESC](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/ns-oaidl-typedesc)
and [VARENUM](https://learn.microsoft.com/en-us/windows/win32/api/wtypes/ne-wtypes-varenum).

### Desktop preview transport

The native IDE selects its preview-document transport before assigning iframe
content. It prepares the hash-authorized `vb6://app/preview/...` document and then
navigates once, rather than starting and cancelling a competing `srcdoc` load.
Browser-only IDEs still use `srcdoc`. Late successful or failed native responses
cannot navigate a detached/stopped frame or interfere with a newer run. Invalid
preview URLs fail closed; the existing sandbox, document CSP, and native IPC
sender checks are unchanged. Node transport regressions and the native IDE smoke
assert this distinction; timeout reports include bounded frame/state diagnostics.


The shared loader is also used by native design-mode Immediate and its promotion
into event debugging. Session guards prevent stale responses from a retired run;
per-frame request guards additionally prevent an older approval or failure from
overwriting or stopping a newer document request on the same active iframe.
Independent frames do not cancel one another. Preview loading does not change
sandbox permissions, CSP, or native IPC authorization. The native smoke covers
F5/Reset/restart and Immediate/event-mode promotion through this shared path.
