# Typed native Automation interoperability

The browser VM retains the scalar tags described in [SCALAR-COMPATIBILITY.md](SCALAR-COMPATIBILITY.md). The optional Windows host now carries those tags across actual `IDispatch` calls and native `SAFEARRAY` values, instead of asking the CLR to infer the original native type from an untyped object.

This host is an explicit, local native-code opt-in. It does not make native DLLs executable in a normal browser sandbox, and does not certify all original VB6 or OCX behavior.

## Implemented path

`VirtualMachine` -> `AutomationSession` -> `NativeAutomationClient` -> bounded UTF-8 stdio -> STA Windows PowerShell host -> native `IDispatch`.

- Byte, Integer, Long, Single, Double, Boolean, Currency, Date, String, Decimal, Empty, Null, Missing and Nothing have distinct wire descriptors. Both arguments and native results retain their VARTYPE. Currency and Decimal use exact decimal text rather than JSON binary floating-point numbers.
- Native calls use metadata-gated member names and modes. `GetIDsOfNames` receives explicit caller-sized native input/output arrays; a missing output DISPID is rejected. Arguments are in Automation's reverse formal order. Property puts supply `DISPID_PROPERTYPUT`; reference arguments use caller-owned native storage and return explicit copyback values.
- Typed multidimensional SAFEARRAYs carry element type and signed bounds. Values are read/written by explicit coordinates, not assumptions about flat native storage order. Variant arrays retain each element's own subtype. Native allocations, copied elements and call temporaries are cleared in `finally` paths.
- Enumeration uses `DISPID_NEWENUM` and raw `IEnumVARIANT::Next`, not the CLR `IEnumerator.Current` conversion that can erase Currency and other tags. It supports method/property enumeration contexts in a single invocation, validates the fetched count and HRESULT, and propagates the client's LCID. The enumerator acquisition and each fetched VARIANT are released. There is no automatic replay after an invocation failure.
- Object identity is based on canonical `IUnknown`; returning an existing native object reuses its session handle. Supported source calls, default properties, `CallByName`, property references and `For Each` use the typed transport. Public JavaScript adapter getters remain raw for embedding compatibility; internal scalar-aware calls retain tags.
- Source `Is` and native Boolean results print `True`/`False`; numeric conversion remains -1/0 and `VarType` remains 11. The native result is no longer relabelled as Double merely because its raw JavaScript representation is numeric.

## Real component validation

The read-only `Typed native interoperability` workflow runs separately on x86 and x64 Windows hosts. `tools/interop/test-native.mjs` compiles actual VB source and invokes installed `Scripting.Dictionary` and `Msxml2.DOMDocument.6.0`, with Unicode, object identity, property updates, returned Boolean type, exact full-range Currency and Decimal, and release checks.

The native test also round-trips nine SAFEARRAY element types with two dimensions and non-zero/negative bounds. Native-created `Dictionary.Keys` validates coordinates independently of the array importer. Currency, Decimal, Integer, Single and Boolean keys are then enumerated 25 times and compared with those independently returned native values. Host handle counts return to zero.

`tools/interop/test-activex.mjs` independently activates the installed `Shell.Explorer.2` control in a real AxHost window. It checks type information, property put, idle STA message pumping and disposal. It never navigates to a remote page. An unavailable/unlicensed component is reported explicitly as unavailable, not as a successful activation.

Windows run [37420150769](https://github.com/wieslawsoltes/VB6/actions/runs/37420150769) passed both architectures after correcting the native host variable collision, member-ID marshalling, and `_NewEnum` invocation context. Each architecture reported 24 native Automation checks and five ActiveX lifecycle checks. These are installed-component integration results, not licensed Microsoft VB6 compiler certification.

## Opt-in usage

```js
import {NativeAutomationClient} from '../tools/interop/native-automation.mjs';
import {VirtualMachine} from '../src/runtime/vm.js';
import {compileProject} from '../src/language/compiler.js';

const client = new NativeAutomationClient({
  allowNativeCode: true,
  allowed: ['Scripting.Dictionary'],
  architecture: 'x86',
  lcid: 1033
});
const program = compileProject({
  name: 'TypedNative', startup: 'Sub Main', modules: [{
    name: 'M', kind: 'module', code: `Sub Main()
Dim d As Object
Set d = CreateObject("Scripting.Dictionary")
d.Add "value", CCur("922337203685477.5807")
Debug.Print CStr(d("value")), VarType(d("value"))
End Sub`
  }]
});
if (!program.valid) throw new Error(JSON.stringify(program.diagnostics));
const vm = new VirtualMachine(program, {
  automation: client.registry(), print: text => console.log(text)
});
try {
  await vm.start();
} finally {
  vm.stop();
  await vm.automationClose;
  await client.close();
}
```

Create a separate native client for each VM session. `VB6_COM_ARCH=x86` or `x64` selects the architecture in the Windows test scripts. The host requires an installed, matching-bitness component and the Windows PowerShell/.NET facilities used by `automation-host.ps1`; a source project alone is not a native component installation.

## Security and lifetime boundaries

The ProgID allowlist, separate native-control grants, killbit checks, metadata/mode validation, process timeouts and bounded protocol remain enforced. The host exposes no HTTP listener, arbitrary script evaluation or automatic component registration. An approved native component nevertheless executes with the logged-in user's authority; it is not sandboxed.

The current limits remain 128 session handles, 1 MiB protocol messages, 16 levels of value nesting, 10,000 array/enumeration elements and eight SAFEARRAY dimensions. Enumeration is a bounded snapshot, not a retained live cursor. Session stop/close releases all tracked objects; this does **not** implement original per-variable COM AddRef/Release timing or certify `Class_Terminate` and circular-reference behavior. Native events, all default-property coercions, arbitrary records, callbacks and every third-party OCX interface are not covered.

Native argument conversions receive the client's LCID, but portable browser string parsing, code pages, DBCS and collation are still separate compatibility boundaries. Date values in the JavaScript VM retain its civil-time/millisecond representation; bitwise preservation of every DATE encoding and sub-millisecond value is not promised. Unsupported VARTYPE/SCODE values fail explicitly. Existing debugger live-edit checks are unchanged. Decimal virtual-file round trips and raw native VARIANT tests do **not** certify Microsoft VB6 `Put` file interoperability; that requires the separately licensed compiler/runtime gate.

## Reproduction and primary references

```sh
node --test tests/native-automation-scalars.test.mjs
# Windows, run once with VB6_COM_ARCH=x86 and once with x64:
node tools/interop/test-native.mjs
node tools/interop/test-activex.mjs
```

- [IDispatch::GetIDsOfNames](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nf-oaidl-idispatch-getidsofnames)
- [IDispatch::Invoke](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nf-oaidl-idispatch-invoke)
- [IEnumVARIANT::Next](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/nf-oaidl-ienumvariant-next)
- [VariantCopyInd](https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-variantcopyind)
- [SafeArrayGetElement](https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-safearraygetelement)
