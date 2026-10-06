# VB source PropertyPages and typed-array events

## Explicit source-page host

`SourcePropertyPage` executes actual imported `.pag` VB source in an isolated
compiler/VM, exposed by both `VB6StudioAPI` and `VB6Runtime.RuntimeAPI`. This is an
explicit SDK facility: importing a project never grants execution permission or
silently registers executable property pages. `allowDesignCode: true` is required.
The host supplies child-control objects and handles their visual presentation;
this is not a native `IPropertyPage` COM implementation or an OCX binary compiler.

```js
const {SourcePropertyPage} = VB6StudioAPI;
const pageControls = {txtValue: {Text: ''}};
const page = await SourcePropertyPage.create(project, 'GaugePage', {
  registry: controlAdapters,
  models: selectedControlModels,
  controls: pageControls,
  allowDesignCode: true,
  onApply(entries) {
    // Record one synchronous undo transaction for the complete selection.
    // Each entry has model, previous and changes. Throw to reject the commit.
    recordUndo(entries);
  }
});
try {
  pageControls.txtValue.Text = '73'; // Use the same object supplied in controls.
  await page.dispatchControlEvent('txtValue', 'Change');
  if (page.IsPageDirty) await page.apply();
} finally {
  await page.close();
}
```

Retain the supplied `controls` map when wiring visible UI events. Host objects are explicit capabilities, not a security
sandbox for arbitrary JavaScript. Existing VM restrictions and instruction/slice
budgets remain enforced for VB execution.

The example `examples/ocx-source/GaugePage.pag` is an original-format page included
in `ControlsLab.vbp`. Its VB `SelectionChanged`, `Change`, `KeyPress` and
`ApplyChanges` handlers execute in the regression tests without rewriting its
imported project or constructing/running unrelated forms and startup modules.

### Lifecycle and selection contracts

The host invokes `PropertyPage_Initialize` before installing an initial selection,
then `PropertyPage_SelectionChanged`. `SelectedControls.Count`, zero-based default
indexing (`SelectedControls(0)`) and `For Each` operate on property facades for the
selected models. Property lookup is case-insensitive and retains canonical
registry spelling in model storage. `Controls` exposes supplied children by
zero-based indexing; named children are available as VB fields.

`Changed = True` marks the page dirty. Supported child input events can be sent
through `dispatchControlEvent`, with declared scalar/array typing and ByRef
copyback. `editProperty(name)` forwards an explicit host request to
`PropertyPage_EditProperty`. `setObjects(models)` installs another validated
selection, discards unapplied edits and raises `SelectionChanged` again. References
to previous selection facades expire rather than targeting replacement objects.
`close()` is idempotent, drains queued work, calls `Terminate`, discards unapplied
changes and stops the VM. Further operations reject.

### Apply and failure behavior

`apply()` does nothing for a clean page. Otherwise `PropertyPage_ApplyChanges`
runs with staged selected-control writes. Reads see earlier staged writes in the
same call. Changes pass the registry's read-only, scalar and enumeration checks.
The underlying property-page transaction commits all selected models together;
a thrown VB error or rejected undo callback restores original property references.
The page remains dirty after a failed apply. Explicit `Changed = True` raised
during a successful apply is retained.

`onApply` must be synchronous; returning a Promise is rejected. Async work in a
callback can have external side effects that this transaction cannot undo. Model
snapshot checks reject intervening outside edits, and writes to selected controls
outside `ApplyChanges` fail instead of mutating project state. Selection snapshots
are data guards, not general rollback of external native/JavaScript effects.

The implementation bounds selections and child maps to 256 and queued operations
to 128. Defaults are one million VM instructions with eight-millisecond slices.
No arbitrary private procedure name is exposed as an input-event endpoint.

## Typed-array event compatibility

Portable event metadata accepts `{name: 'Values', type: 'Long', array: true,
byRef: true}`. Array parameters must be ByRef. Classic handler tooling writes
`ByRef Values() As Long`, alongside an independent control-array `Index` argument.

`OcxEventHub`, source-control input dispatch and compiled `RaiseEvent` retain typed
array storage, rank, nonzero bounds and numeric element tags. Dynamic empty and
native-imported zero-element arrays are supported. Incorrect element storage is
rejected before invoking a subscriber, including when notifications are frozen.
Event-hub inputs are detached snapshots; subscribers share a typed copyback cell,
including replacement/ReDim semantics. Compiled VB source outgoing events retain
the VB variable reference so valid subscriber changes reach the raising procedure.

This does not add arbitrary outgoing native vtable interfaces. Native SAFEARRAY
transport and binary-control contracts retain their separate validation path.

## Verification and boundaries

Run `node --test tests/ocx-source-page.test.mjs tests/ocx-array-events.test.mjs` and
`python tools/browser-ocx-tests.py`. The browser suite now has 14 scenarios for
each modular HTTP, standalone HTTP and standalone file origin. Its explicit
`VB6_OCX_ORIGINS=inline` mode is useful locally but is not real-origin evidence.
The companion source-control lab retains 12 checkpoints per browser/origin.

Native `IPerPropertyBrowsing` integration and ABI coverage are documented in
[OCX-PROPERTY-BROWSING.md](OCX-PROPERTY-BROWSING.md); container/persistence contracts
are documented in [OCX-CONTAINER-CONTRACTS.md](OCX-CONTAINER-CONTRACTS.md).

Remaining work includes automatic shared-VM UserControl/PropertyPage IDE binding,
full visual `.pag` authoring, binary OCX generation, native windowless/in-place OLE
and frame/menu negotiation, arbitrary native vtable events, proprietary FRX/CTX
and object-valued state, native OLE drag/data services and vendor/licensed-control
certification. Successful repository-owned fixtures do not certify all OCXs.
