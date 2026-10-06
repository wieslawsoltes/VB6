# Native per-property editor metadata

`tools/interop/ocx-property-browsing.mjs` exports
`browseNativeControlProperty(client, handle, member)`. The client must be an
explicitly granted `NativeAutomationClient`; the handle must already identify an
active hosted control. No additional component is activated by this query.

```js
import {browseNativeControlProperty} from '../tools/interop/ocx-property-browsing.mjs';
const metadata = await browseNativeControlProperty(client, client.handleOf(control), 'Appearance');
if (metadata.supported) {
  console.log(metadata.display, metadata.page);
  for (const choice of metadata.predefined) console.log(choice.label, choice.cookie, choice.value);
}
```

The native host resolves the name through the control's exposed property metadata
and `IDispatch::GetIDsOfNames` with the client's LCID. Methods, hidden/unexposed
names, raw DISPIDs and pointers cannot be supplied instead. The four native
`IPerPropertyBrowsing` operations return display BSTRs, page CLSIDs, predefined
label/cookie pairs and exact typed VARIANT wire values. Cookies retain the entire
unsigned DWORD range. Returned client snapshots are detached and immutable.

Each optional capability is explicit: a missing interface yields
`{supported:false}`; individual `E_NOTIMPL` results set the corresponding
`displaySupported`, `pageSupported` or `predefinedSupported` flag to false.
An advertised choice without a resolvable value is an error, not a partially
successful list. Unexpected positive HRESULTs and native failures propagate.
The helper does not invoke setters, change selection, open a property page or
install property-grid DOM. Applying a selected value remains a separate normal
Automation operation with existing conversion, edit-veto and event behavior.

## Ownership, limits and safety

Success transfers BSTR/task-allocated arrays and individual strings to the host;
all transferred allocations are released after copying or rejection. A failed
GetPredefinedStrings leaves its output descriptors undefined, so the host never
dereferences or frees those failure outputs. VARIANT payloads are cleared after
copying, including on downstream validation failures. All four vtable slots and
native output ABIs have repository-owned Windows fixture coverage.

A reply allows at most 256 choices, 4,096 UTF-16 units per label and 256 KiB of
serialized choices. Existing VARIANT rank/count/string limits still apply.
Native object values are rejected before handle adoption, including objects
inside arrays; primitive/typed array wire descriptors retain numeric subtypes,
Currency, Decimal and raw DATE precision. Native control release and reentrant
activation/browsing are rejected while the query is running. Other component
callbacks may still execute: the snapshot is not a component-wide transaction.

These bounds limit copied metadata; native code still has full user authority
and is not sandboxed. Invalid native pointers or a component violating allocator
contracts cannot be made safe by JavaScript validation. Existing consent,
allowlists, kill bits, architecture selection and event-token checks remain.
This is a native SDK/transport feature, not full automatic classic property-grid
integration, native PropertyPage authoring or licensed-control certification.

## Primary contracts

- Microsoft Windows SDK `ocidl.h`, `IPerPropertyBrowsing` vtable and counted arrays:
  https://github.com/microsoft/win32metadata/blob/main/generation/WinSDK/RecompiledIdlHeaders/um/ocidl.h
- https://learn.microsoft.com/windows/win32/api/ocidl/nn-ocidl-iperpropertybrowsing
- https://learn.microsoft.com/windows/win32/api/ocidl/nf-ocidl-iperpropertybrowsing-getpredefinedstrings
- https://learn.microsoft.com/windows/win32/api/ocidl/nf-ocidl-iperpropertybrowsing-getpredefinedvalue

Run `node --test tests/ocx-property-browsing.test.mjs` for client contract tests.
On Windows, `node tools/interop/test-container-contracts.mjs` compiles the host
and executes the COM fixtures; run once each with `VB6_COM_ARCH=x86` and `x64`.
A passing mock client test is not a passing native ABI test.
