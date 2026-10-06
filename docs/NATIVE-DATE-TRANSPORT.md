# Native DATE wire precision

The explicitly granted Windows Automation companion transfers numeric `date`
wire descriptors directly into a `VT_DATE` VARIANT. It does not route that
particular native dispatch path through CLR `DateTime`.

## Contract

`{t: 'date', v: serial}` requires a JSON number in the open interval
`(-657435, 2958466)`. Missing/null payloads, strings, Booleans, arrays, objects,
nonfinite values and out-of-range numbers are rejected before invocation.
The parser's supported numeric representations are checked before conversion;
`Convert.ToDouble(null)` must not silently turn malformed input into DATE zero.
This is validation of an already typed protocol value, not a replacement for
VB source `CDate` conversion rules.

The native payload is the complete IEEE binary64 value at offset eight of the
VARIANT on both x86 and x64. Scalar arguments, caller-owned ByRef storage,
SAFEARRAY(DATE), and dates nested in SAFEARRAY(VARIANT) share the same importer.
Native result export and `IEnumVARIANT` enumeration already read the raw DATE
payload; they now receive values that the importer has not rounded first.
Existing cleanup, resource limits, explicit native-code consent, ProgID
allowlisting and kill-bit checks are unchanged.

This matters even without an unusually precise timestamp: the negative
fractional DATE alias `-0.25` must not silently become `+0.25` during transport.
Converting through `DateTime.FromOADate` also rounds fractional milliseconds;
converting that managed result back cannot recover the original double.

## Reproduction and evidence

On Windows, with Node 22 and the installed Scripting.Dictionary component:

```powershell
$env:VB6_COM_ARCH = 'x86' # Repeat with x64.
node tools/interop/test-date-transport.mjs
node tools/interop/test-native.mjs
```

The read-only `Native DATE transport` workflow runs both architectures. The new
suite records exact expected/actual double bytes, scalar and multidimensional
array transport, ByRef copyback, native-created Keys arrays, repeated native
enumeration, rejection before Dictionary mutation, valid calls after rejected
requests, and zero remaining exported object handles. It preserves all failures
in `reports/native-date-transport/<architecture>.json` and exits nonzero if any
check fails. Existing compiled-VB/native Automation tests run separately even
when the new precision test fails. No additional component is activated and no
licensed compiler or remote navigation is used.

## Explicit limits

This is **raw companion-protocol precision**, not full source-runtime DATE
conformance. The higher-level JavaScript adapter still converts date wire
values to JavaScript `Date`; source-runtime, calendar and file behavior are not
made sub-millisecond precise by this change. Native event delegates that use
CLR `DateTime` retain their separate limitations. JSON.stringify normalizes
negative zero and nonfinite values, so negative-zero bit transport is not
certified. Calendar, locale, timezone, native VB6 P-code and Decimal `Put`
interoperability are not certified by Dictionary transport tests. The native
component itself may intentionally change a date; that is not overridden.

## Primary references

- [Microsoft DATE data type](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/date-data-type): IEEE 64-bit storage and calendar range.
- [Microsoft .NET Framework DateTime source](https://github.com/microsoft/referencesource/blob/main/mscorlib/system/datetime.cs): `DoubleDateToTicks`, `FromOADate`, and `TicksToOADate` conversion and millisecond rounding.
- [Microsoft VARIANT layout](https://learn.microsoft.com/en-us/windows/win32/api/oaidl/ns-oaidl-variant): type descriptor and DATE union member.
