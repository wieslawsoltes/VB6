# Source scalar and Variant compatibility

This work extends the browser source VM and its emitted HTML/Electron runtime.
It does not turn the separate native AOT target into a universal VB6 compiler,
load arbitrary native OCX components in a browser, or certify native VB6 files.

## Value representation and public API

Source values carry an immutable `VBScalar` with a scalar subtype and a separate
`variant` storage-origin flag. Byte, Integer, Long, Single, Double, Boolean,
Currency, Date, String, Decimal, Empty, Null and Error are represented explicitly.
The origin matters: a typed Integer operation can overflow, while an operation
on an Integer-valued Variant can promote to Long and then Double.

`RuntimeAPI` exports `VBScalar`, `tagScalar`, `scalarType` and `unbox` for embedding.
The established raw interfaces (`Cell.get()`, `VBArray.get()`, collection Item
and JavaScript adapter methods) remain raw JavaScript values. Internal
`getScalar()`/scalar iterators carry metadata without breaking existing hosts.
Tags validate their payload and are frozen; callers cannot attach a Byte tag to
an out-of-range number. Dates retain the existing JavaScript Date representation.

Metadata is preserved through literals and suffixes (including `#` suffixes in comma/colon-delimited statements), signed hexadecimal/octal
literals, variables, constants, optional defaults, procedure arguments/returns,
properties, ParamArray, events, typed `For` counters, arrays and records, collection items/dictionary keys, conditional
value intrinsics, debugger inspection and edits, and binary Variant descriptors.
`AddressOf` handles and declared Win32 function returns are Long where declared;
ByRef buffers keep array metadata and the existing Win32 marshalling contract.
Known built-in/control signatures and privately registered ADO/DAO field/parameter types supply subtype metadata. Null fields remain Null. JavaScript field getters remain raw; Variant/untyped adapter values without declared metadata still cannot recover a numeric subtype that the host discarded. Unknown numeric
JavaScript adapter results default to Double rather than inventing a declaration.

## Operators and conversions

The implementation distinguishes typed and Variant-origin comparison rules,
checked typed arithmetic, Variant promotion, Byte bitwise operations, Boolean
Null propagation, Single rounding, Currency/Decimal mixed arithmetic, and
Error/Error comparisons. Source `CStr(Boolean)` and Debug.Print Boolean values
use `True`/`False`, while numeric Boolean conversions retain the -1 convention
and the separately tested unsigned Byte conversion of True yields 255.

CDate and CVDate have distinct declared return origins despite sharing a raw implementation; per-alias/per-VM wrappers prevent shared-function metadata from leaking. Both reject Error values instead of interpreting error numbers as dates.

Single/Double string and Decimal conversion use VB-style 7/15 significant-digit
precision. Checked numeric parsing rejects JavaScript-only spellings, blanks,
non-finite values and trailing garbage; it accepts tested decimal/exponent,
hexadecimal/octal and invariant en-US grouping forms. String conversion input is
bounded to 4,096 code units. `IsNumeric` uses the same numeric recognizer rather
than JavaScript's permissive Number conversion.

This is **not every Windows locale or mixed-type edge case**. Numeric parsing and
formatting still use the invariant/en-US profile. Windows LCID/DBCS rules,
locale-specific date parsing/collation, complete object/default-property
conversion, aggregate Variant metadata, exceptional assignment side effects,
and all formatting/rounding boundaries remain outside the certified scope.

## By-reference arguments

Stored variables and array elements preserve aliasing. Typed scalar ByRef
arguments require the matching declaration. A parenthesized expression,
property-get or function result creates a temporary; those getters, receivers
and index expressions are evaluated once, not once to find a reference and then
again to obtain its value. The temporary is not copied back through a setter.

A Variant ByRef parameter can alias typed scalar storage: reads have Variant
origin, while writes still pass through the caller's declared-type conversion.
Invalid writes do not corrupt the caller. The existing permissive multi-argument
parenthesized-call extension remains. This does not implement every COM ABI or
object-reference copy-in/copy-out rule, or new native lifetime semantics.

Typed For counters retain their declaration; Variant counters use Variant promotion. Start, end and step are evaluated once with their original type, and a zero step is permitted with explicit Exit For. The execution budget still guards nonterminating programs. Immediate `Call Procedure(value)` preserves the normal Call argument alias rules.

## File input/output

Binary Variant descriptors retain Byte/Integer/Long/Single/Double/Boolean tags
rather than treating every number as Double. Array element metadata survives
round trips and subsequent copy/resize/iteration.

Sequential Write/Input supports the Boolean, Null, Error and Date markers,
quoted text and an individual field cursor. Successive Input statements can
consume one physical record. Typed String targets keep numeric lexemes; quoted
numeric text is not silently treated as a numeric Input value. Input # is not a
CSV parser: adjacent quoted strings remain separate fields as documented by
Microsoft. Unterminated fields and invalid typed input report errors. Existing
file modes, bounds, private-file locks and host isolation are retained.

The filesystem's existing code-page behavior remains; this is not DBCS parity.
Decimal's existing virtual tag-14 encoding is still **not certified against
Microsoft VB6 Put**. Self-round trips and OleAut32 structure tests cannot provide
that certification; the optional licensed compiler job is a distinct gate.

## Evidence and reproducible checks

The two fixtures in `tests/fixtures/scalar` contain actual Windows Automation
results with the original inputs, run URLs, operating system and DLL identity.
The additional boundary reference was captured in GitHub Actions run
`37299616935` (artifact SHA-256
`3d65c8a1e4565b57f9f37ea48289ad3256969d833aaab99382afaa1704952e2f`).

There are 2,158 operation inputs: **2,152 comparable cases** and **six explicitly
classified API/clock distinctions**. The latter are never counted as passes:
flags=0 VariantChangeTypeEx produces numeric Boolean BSTRs instead of VB's
alphabetic CStr; VarCmp's Byte/Boolean treatment differs from the language's
Integer effective type; and a short date without a year depends on capture time.
The project has a separate source-level regression for the language Boolean
comparison rule. Fixed-point/integral/Boolean comparisons are exact; Single
results compare float32 values, Double allows at most two ULPs, and Date allows
the native DateTime marshaller's one-millisecond precision.

The permanent read-only **Scalar conformance** workflow executes the entire
corpus through genuine Windows APIs again and compares it to the JS runtime.
Missing, duplicate and unexpected native results fail. Reports retain the DLL
version/hash and every mismatch. This is API differential evidence, **not a
licensed VB6 language/compiler or native Put certification**.

```sh
npm run build
npm test
node --test tests/scalar-runtime.test.mjs tests/scalar-boundaries.test.mjs tests/scalar-conformance.test.mjs
python tools/browser-compiler-runtime.py --http
# On Windows:
node tools/conformance/check-scalars.mjs prepare reports/scalar-conformance/vectors.json
powershell -File tools/conformance/windows-oracle.ps1 -Vectors reports/scalar-conformance/vectors.json -Output reports/scalar-conformance/windows-oracle.json
node tools/conformance/check-scalars.mjs check reports/scalar-conformance/vectors.json reports/scalar-conformance/windows-oracle.json reports/scalar-conformance/comparison.json
```

The existing compiler browser suite now also tests scalar execution in the
standalone IDE, separate SDK and exported HTML, file descriptors, debugger
edits, typed database fields and actual diagnostic-worker constant invalidation. Actual exported form/control properties retain their declared Long, Boolean, Single and Integer types.
Existing Boolean text assertions were updated to the Microsoft-documented True/False spelling; numeric conversions continue to assert -1/0 (and Byte True = 255). One pre-existing constant-ByRef test now verifies the required temporary rather than expecting a mutation error. The GDI fixture uses `&HFF00&` to request a positive Long rather than the signed Integer `&HFF00`. New tests independently assert both literal values. No test or isolation assertion was removed or disabled.

Local integrated validation on the main `29c77082` source: 2,505 Node tests (2,342 retained + 163 new), all passing without skips; all 17 emitted IDE/SDK/export/worker checks passed in inline Chromium mode. Direct-origin and Windows results must be read from the final PR CI, not inferred from these local checks.

## Primary references

- [MS-VBAL procedure argument semantics](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/1fb9af32-fc48-4c4f-998a-ed8047048ca5)
- [MS-VBAL arithmetic operators](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/e070115f-8d40-40cf-ac6d-ab18b9c6c906)
- [MS-VBAL comparison operators](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/f8acd631-55c1-4199-bc1e-022aaab6d9c8)
- [MS-VBAL Let coercion to String](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/00113388-401b-41c2-8107-dc3fc0485554)
- [MS-VBAL For statement](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/389b1dc4-e608-4ed0-ae64-d88f62f12ea3)
- [Microsoft Print method](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/print-method)
- [MS-VBAL CDate/CVDate](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/1f287742-e07f-4169-8ce7-5ddfe0f951fb)
- [Microsoft Variant type](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/variant-data-type)
- [Microsoft Input # statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/inputstatement)
- [Microsoft IsNumeric](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/isnumeric-function)
