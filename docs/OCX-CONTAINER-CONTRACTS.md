# OCX container contracts and VB-authored source controls

This follow-up is based on PR #52, main commit
`b6f623d5c9e55efd4f2da39c5b22e0a609427491` (tree
`133c9719085b54dac5cb42b03ff74637c369abb7`). It extends the portable
control SDK, classic property inspector, isolated VB source execution, and Windows
companion. These are distinct execution paths, not interchangeable OCX formats.

**Validation boundary:** JavaScript behavior and the inline Chromium demo are
locally tested. The new C# files, native persistence fixtures, and Windows workflow
are authored but have not been compiled or executed in the delivery environment.
Previous PR #52 Windows passes do not validate these new native changes. This is
not a claim that all original VB6 OCX features or binary compatibility are complete.

## What is connected to the IDE

The Components/toolbox adapter registry now creates a shared portable container for
opted-in controls. Its sites deliver Initialize, InitProperties or ReadProperties,
Resize, Show/Hide, ambient changes and Terminate. Geometry and visibility updates
are connected to the existing adapter update path. Errors still reach the caller;
termination runs once and cleanup is attempted even after a lifecycle error.

The property inspector exposes **Property Pages…** for a homogeneous multiple
selection when its trusted adapter supplies pages. The page factory receives its
existing detached first model, plus `options.objects`, a detached selection. Its
returned changes apply to all selected controls in a single existing IDE undo
transaction. Read-only/enumerated properties are validated, and a changed project,
revision, registry, or selection invalidates the asynchronous result. The browser
regression actually selects two controls, applies the page, and undoes both edits.

Source control execution below is a separate explicit host SDK. It is not
implicitly activated by opening a `.ctl`, and it is not an automatic conversion of
every imported UserControl into an executable toolbox adapter.

## Portable control-site and container APIs

The modular imports are in `src/controls/`; all public classes are also exported
through `RuntimeAPI` in `src/runtime/entry.js` and the generated runtime bundle.

`OcxControlSite` has explicit `unbound`, `loaded`, `in-place-active`, `ui-active`,
and `closed` states. `activate`, `deactivate`, `setFocus`, `LockInPlaceActive`, and
`FreezeEvents` maintain state and balanced counters. A lock prevents leaving
in-place activation, not switching UI focus. Hiding, disabling, or setting UIDead
retires UI focus. A failed focus hook attempts restoration of the previous site.
Destruction still releases a locked site.

Synchronous `control.ocxLifecycle` hook names are:

```text
initialize initProperties readProperties writeProperties resize show hide
terminate ambientChanged activate deactivate uiDeactivate focus paint
translateAccelerator mnemonic requestEdit propertyChanged
```

Hooks must not return promises. Use `SourceUserControl` for asynchronous VB
execution rather than placing asynchronous code in these hooks. An adapter's
`RequestEdit` hook/observers can veto a change; `PropertyChanged` marks dirty state,
updates its revision, and delivers notifications. `save({clearDirty:true})` clears
dirty only if no revision changed during persistence. Saving does not implicitly
serialize a project; the host still captures `model.ocxState` explicitly.

`OcxContainer` manages site enumeration, one active control, stable TabIndex
navigation, Shift+Tab, active accelerators, Alt mnemonics and default/cancel
activation. Design mode, disabled/hidden controls, UIDead and TabStop are honored.
`ocxContainerFor(form)` supplies a shared instance; `close()` disposes owned
controls, listeners, and invalidation observers. Hosts that create an explicit
container should close it when their document is destroyed.

`OcxAmbientProperties` provides immutable snapshots, case-insensitive names and
standard ambient DISPIDs. Updates validate the complete change set before changing
values; all notifications are attempted even if one listener fails. Supported
values include colors, Font, LocaleID, UserMode, UIDead, display flags and mnemonic
capability. This portable data model does not assert that every native control
implements or accepts these properties. `ocxTransformCoords` converts HIMETRIC,
twips, points and pixels with explicit horizontal/vertical DPI.

`OcxEventHub` offers IID-specific connections and ordered typed ByRef copyback.
Disconnecting a subscriber retires it during a pending delivery; new subscribers
join the next delivery. Event freeze counters are balanced. Unsupported native
vtable ABIs are not turned into synthetic IDispatch events.

`OcxPropertyPageSession` provides a separate trusted multi-model transaction API:

```js
import {OcxPropertyPageSession} from '../src/controls/ocx-pages.js';

const page = new OcxPropertyPageSession(registry, selectedModels, {
  onApply(entries) { recordSynchronousUndo(entries); }
});
page.edit({Value: 75});       // Validate and stage for the complete selection.
page.Apply();                // One synchronous commit; restore properties on error.
page.Cancel();               // Retire the page. Further edits are rejected.
```

`registry.editSelection(models, options)` is the inspector-facing asynchronous
factory path. `OcxPropertyPageSession` is the lower-level staging/transaction path;
its synchronous commit callback must not start an asynchronous commit. Rollback
restores model property references, not arbitrary external side effects in host
callbacks.

## Portable windowless painting

`OcxWindowlessSurface(container, canvas, options)` is a **Canvas2D** host for
trusted portable controls. It coalesces damaged rectangles, clips each control,
paints in site order, restores context after failures, hit-tests, and routes
primary pointer capture and VB mouse/modifier arguments in twips. Moving a control
invalidates both its old and new footprint; removal retires capture.

```js
const surface = new OcxWindowlessSurface(container, canvas, {
  onError(error) { reportHostError(error); }
});
surface.resize(600, 400, window.devicePixelRatio || 1);
// A registered adapter supplies a synchronous paint(context, dirty, site) hook.
// On shutdown:
surface.close();
container.close();
```

Canvas dimensions, scale, memory area, site count and event queues are bounded.
This is neither a native `IOleInPlaceSiteWindowless` implementation nor a WebGPU
renderer. Native HWND embedding, arbitrary binary OCX painting, native drag/data
objects, IME/accessibility bridges and the full OLE frame/UI negotiation contract
are not supplied by this surface.

## Executing VB UserControl source

`SourceUserControl` runs actual `.ctl` code in a separate existing VB interpreter.
It compiles public property procedures/methods and executes private lifecycle
procedures. Each instance has isolated module state. It never executes the parent
project startup or constructs its forms. A host supplies safe child-control
objects and its own rendering/input integration.

The executable example is `examples/ocx-source/Gauge.ctl`, referenced by
`ControlsLab.vbp`. `tools/build-ocx-lab.mjs` parses this native-format source and
builds `dist/OCX-Source-Control-Lab.html`. The generated lab embeds the complete
runtime and source without network dependencies.

```js
import {SourceUserControl} from '../src/controls/ocx-source.js';

// project is an already parsed project containing a UserControl named Gauge.
const readout = {Caption: ''};
const gauge = await SourceUserControl.create(project, 'Gauge', {
  controls: {Readout: readout},
  ambient: {LocaleID: 1033},
  instructionLimit: 1_000_000
});
const disconnect = gauge.subscribe(async (name, args, context) => {
  if (name.toLowerCase() === 'changing') {
    const previous = await context.get('Value');
    if (previous === 100) await args[1].ref.set(-1); // VB True, Cancel.
  }
});
try {
  await gauge.set('Value', 60);
  await gauge.invoke('StepUp');
  const snapshot = await gauge.save();
  await gauge.load(snapshot);
  console.log(readout.Caption, await gauge.get('Value'));
} finally {
  disconnect();
  await gauge.close();
}
```

Available operations include `get/getScalar`, `set`, `invoke`, `resize`, `show`,
`setAmbient`, `setDesignMode`, `subscribe`, `freezeEvents`, `save`, `load`, and
`dispatchControlEvent`. Event subscribers share declared typed ByRef cells.
Reentrant property/method access must use the callback's `context`, not the public
queued API. Context calls serialize, are drained before the event returns, and
unobserved failures abort dispatch. Expired or suspended contexts are rejected.
Do not close the control from an outgoing callback.

The private lifecycle includes Initialize, InitProperties, ReadProperties,
WriteProperties, Resize, Show, Hide, AmbientChanged and Terminate. Native `.ctl`
ClientWidth/ClientHeight are mapped to initial Width/Height. PropertyBag reads and
writes preserve numeric Variant tags, rather than inferring types from JS numbers.
The portable JSON envelope remains distinct from native `.ctx` or `.frx` bytes.
A failed load may already have changed VB state and therefore is not advertised as
an atomic rollback; errors are surfaced and dirty state is retained.

`dispatchControlEvent(name, args)` executes selected `UserControl_*` input/paint
procedures and returns typed ByRef changes. Supported names cover Paint, mouse,
keyboard, focus, hit-test and drag/OLE event procedures. The host must provide the
actual event source and objects; the existence of an OLEDragDrop procedure is not
an implementation of a native OS data-transfer service. Outgoing freeze suppresses
outgoing events, not incoming paint/input. UIDead or design mode suppresses input
other than Paint.

Design-time source execution requires **additional explicit**
`allowDesignCode:true` consent, both at creation and on a runtime-to-design toggle.
Imported data does not provide that consent. The demo separates this control from
its design-mode toggle. Instruction limits are cumulative for an instance's
lifetime; the default is one million, with bounded operation/reentrancy queues and
layout-stabilization iterations. This is bounded cooperative interpretation, not
an isolation claim for arbitrary host-supplied objects or callbacks.

Limitations of this source path: not an OCX binary compiler, not `.pag` visual
PropertyPage authoring, not the complete UserControl drawing/printing/data-binding
object model, and not project-global state shared with the application's main VM.
The sample's gauge graphics are host Canvas2D drawing based on VB properties;
its VB Paint callback is executed but does not implement every VB drawing method.

## Native Windows companion additions — pending Windows validation

The existing allowNativeCode grant, ProgID/control allowlists, architecture
selection, kill-bit checks, supplied-key licensing and event-token gates remain.
No downloaded or registered components, extracted keys, or automatically activated
objects are introduced.

New host-only client methods are `persistenceInfo`, `eventInterfaces`,
`subscribeInterface`, `observeControlProperties`, `setControlDesignMode`,
`freezeControlEvents`, `controlKeyboardInfo`, `sendControlMnemonic`, and
`setControlAmbient`. Additional outgoing IDispatch source interfaces are selected
by exact IID. Default WithEvents subscriptions are not disconnected when the last
additional subscriber retires. Native vtable-only sinks are diagnosed unsupported.

Property observers bridge IPropertyNotifySink Changed/RequestEdit with an awaited
veto. Native freeze depth maps to IOleControl transitions. The host changes its
mutable design site and notifies UserMode. Native ambient updates support
BackColor, ForeColor and a detached font, not every portable ambient DISPID.
WinForms font weights accept consistent normal/400 or bold/700 only; unsupported
weights fail explicitly. One UTF-16 mnemonic character is accepted; surrogate
pairs are rejected.

Persistence has explicit `auto`, `stream`, `storage`, `propertyBag` and
`propertyBag2` format selection. Query capabilities, choose a format, then retain
the returned envelope:

```js
const capabilities = await client.persistenceInfo(handle);
const state = await client.saveControlState(handle, {
  format: 'propertyBag2', saveAll: true
});
await client.loadControlState(handle, state);
```

The prior `loadControlState(handle, base64String)` stream API remains supported.
Automatic selection chooses from advertised interfaces; a failed component call is
**not retried** through a second format because it may already have mutated native
state. Errors and component IErrorLog information are preserved, not replaced with
successful empty state.

`OcxPersistence.cs` supplies data-only IPropertyBag/IPropertyBag2 adapters with
locale-aware VARIANT coercion, typed SAFEARRAY state, property hints, allocated
property information, per-property read errors and transactional batch writes.
Names permit native dotted/space-containing names; duplicate names, NULs, excess
payloads and executable object references are rejected. Object-valued LoadObject
fails with an access error. Encoded state is bounded to 512 KiB and 256 bag entries;
this is not a memory sandbox for an executing native component.

IPersistStorage uses ole32 in-memory structured storage with Save/Commit/
SaveCompleted and retained backing resources for loaded components. Streams stay
bounded. Saves do not clear a native component's dirty bit merely because bytes
were returned to a remote caller; that transport reply is not proof of durable
storage. Component callbacks may alter native state before an error; external
native effects cannot be rolled back by a JSON transaction.

Host teardown attempts every subscription, native object/window, backing resource
and owned font even if cleanup fails. JavaScript exit/abort cleanup also retires
additional event hubs, observers, adapters, active event contexts and license keys.

## Validation commands and scope

```sh
npm run build
npm test
node --test tests/ocx-container-contracts.test.mjs \
  tests/ocx-native-contracts.test.mjs tests/ocx-source.test.mjs
python tools/browser-ocx-tests.py
python tools/browser-ocx-source-lab.py
```

Browser scripts default to actual navigation, not inline substitution. The classic
IDE script has 12 scenarios per origin; the source lab has 12 checks per origin.
CI is configured for Chromium, Firefox and WebKit. The local delivery was tested
with inline Chromium only; origin and other-engine jobs must run on the follow-up
PR. To reproduce that explicitly labelled local mode:

```sh
VB6_BROWSER=chromium VB6_CHROMIUM=/usr/bin/chromium VB6_OCX_ORIGINS=inline \
  python tools/browser-ocx-tests.py
VB6_BROWSER=chromium VB6_CHROMIUM=/usr/bin/chromium VB6_OCX_LAB_ORIGINS=inline \
  python tools/browser-ocx-source-lab.py
```

On Windows, run both architectures in PowerShell:

```powershell
$env:VB6_COM_ARCH = 'x86'
node tools/interop/test-container-contracts.mjs
$env:VB6_COM_ARCH = 'x64'
node tools/interop/test-container-contracts.mjs
```

That runner compiles the complete host and fixture together. Fixtures exercise
COM structure layouts, real oleaut32 VARIANT conversions, SAFEARRAYs, callback
IErrorLog, bag hints/transactions and real ole32 structured storage. Fixtures use
managed test components and do not certify proprietary OCXs or licensed controls.
A non-Windows invocation fails rather than being reported as a native pass.

Before merge, also run existing native Automation/ActiveX/OCX tests, the full browser
matrix, and Windows packaged application/IDE smoke tests. No final-head GitHub CI,
PR publication, or merge was performed for this patch in the read-only session.

## Remaining compatibility work

Full native windowless/in-place OLE containment and frame negotiation; arbitrary
outgoing vtable interfaces; original binary `.ctl/.pag` OCX compilation and visual
PropertyPage authoring; proprietary FRX/CTX decoding and object-valued native
persistence; complete source UserControl object-model parity and automatic IDE
registration; native OLE drag/data services; and component-specific/licensed-control
certification remain open. Native code newly authored here also needs compilation
and execution before it can be called verified.

## Primary interface references

- [IOleControlSite](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nn-ocidl-iolecontrolsite)
- [LockInPlaceActive](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nf-ocidl-iolecontrolsite-lockinplaceactive)
- [IPropertyNotifySink](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nn-ocidl-ipropertynotifysink)
- [IOleControl](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nn-ocidl-iolecontrol)
- [IPropertyBag::Read](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nf-oaidl-ipropertybag-read)
- [PROPBAG2](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/ns-ocidl-propbag2)
- [IPersistPropertyBag::Save](https://learn.microsoft.com/en-us/windows/win32/api/ocidl/nf-ocidl-ipersistpropertybag-save)
- [IPersistStorage::Save](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-ipersiststorage-save)
- [IPersistStorage::SaveCompleted](https://learn.microsoft.com/en-us/windows/win32/api/objidl/nf-objidl-ipersiststorage-savecompleted)
