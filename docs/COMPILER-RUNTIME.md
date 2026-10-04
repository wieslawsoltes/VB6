# Compiler and runtime compatibility workstream

This change extends the browser source compiler and VM; it does **not** claim
complete binary, COM, native VB6, or locale conformance. It builds on the 0.6.0
implementation and preserves the independently merged IDE/icon, detached-window
and MCP work.

## Implemented and regression-tested

- Computed `On expression GoTo` and `On expression GoSub`, including once-only
  evaluation, banker-rounded selectors, the 0..255 domain, out-of-list fall-through,
  nested returns, numeric targets and undefined-target diagnostics.
- Numbered executable labels, `If ... Then <line>`, `Erl`, `Resume 0`, the `Error`
  statement, error descriptions and `Err.Raise` help/source metadata. Numbered
  lines are VM metadata rather than extra breakpoint stops. Errors retain the
  innermost throwing line during stack propagation. Resuming consumes handler
  state. Existing live-edit restrictions also cover computed branches/labels.
- Side-effect-free compile-time constants, forward/cross-module dependencies,
  local constants, optional defaults, Enum expressions and implicit increments.
  Cycles, inaccessible/ambiguous declarations, overflow and nonconstant calls are
  rejected. Enums retain their declared names but use checked Long storage in
  variables, arrays, records, parameters and results. Worker/cached diagnostics
  rerun binding after every project revision without mutating cached source ASTs.
- `CDec` and the Variant Decimal subtype: signed 96-bit coefficient, scale 0..28,
  exact string/Currency conversion, four arithmetic operators, comparison, unary
  operators, `Abs`, `Fix`, `Int`, half-even `Round`, checked integer conversion,
  `TypeName`/`VarType`, read-only debugger inspection and binary value round trips.
  `As Decimal` is rejected: Decimal is a Variant subtype. Binary Double input is
  rounded through 15 significant decimal digits; string input remains exact.
- All thirteen financial intrinsics: `FV`, `PV`, `PMT`, `IPMT`, `PPMT`, `NPER`,
  `RATE`, `NPV`, `IRR`, `MIRR`, `SLN`, `SYD`, `DDB`. VM registration includes
  named arguments, optional holes, Missing versus explicit Empty, VB numeric
  coercion, one-dimensional typed cash-flow arrays with arbitrary lower bounds,
  error handling and independently exported runtime support.
- Whole-array `a()` arguments retain the array rather than indexing with no
  subscripts, including ByRef parameters.
- `InStr` arity-based overload binding and named arguments, validated comparisons,
  `InStrRev` end-position bounds, literal replacement, case-preserving bounded
  Split remainders, String-array Split/Filter results and array validation in
  Join/Filter. Automatic inspection uses the selected caller's comparison mode.

## Deliberate limits

Decimal conversion and arithmetic are tested against exact integer/rational
identities and documented OLE limits, **not** differential tests against a licensed
VB6 executable. Decimal is dominant in the supported mixed arithmetic operations;
complete native Variant promotion/coercion and all numeric subtypes remain open.
Nonboxed JavaScript numeric values still report Double through value-based
TypeName/VarType, even when their storage is checked Integer/Long/Enum.
The virtual-file tag-14 encoding wraps the documented 16-byte MS-OAUT Decimal
record; native VB6 `Put` interoperability for this case is not certified.

Financial functions use Double arithmetic. RATE/IRR use a bounded, guess-sensitive
sign-bracket solver in log(1+rate), not the native iteration algorithm. Multiple
roots and unbracketed roots can differ from native choices. The search log-domain
is -36..36; cash-flow inputs are capped at 1,000,000 elements. Input/sign/domain
errors and overflow are explicit. This is code compatibility, not financial advice.

Text comparison uses invariant ECMAScript case folding with UTF-16 source offsets,
not Windows LCID, linguistic collation, DBCS, Access database comparison or full
Unicode locale equivalence. Locale identifiers other than the documented binary,
text and module-default modes are rejected. Date and error descriptions continue
to use the existing invariant/Gregorian/English runtime conventions.

Constant binding is bounded to 256 dependency/expression levels, 100,000 evaluated
nodes and 1 MiB constant strings. This work does not add complete native static
type checking, declaration-time array bounds from arbitrary constants, native
lifetime/reference counting, all UDT restrictions, Declare/COM calls, arbitrary
live editing or every original intrinsic/control feature.

## Validation and reproduction

```
npm run build
npm test
python tools/browser-compiler-runtime.py
python tools/browser-compiler-runtime.py --http
```

The HTTP mode launches the real built standalone IDE and generated independent
apps through a loopback server. Inline mode is available for environments that
block navigation. The suite also runs the actual blob diagnostic worker after
an edit that creates a constant dependency cycle. No native VB6 compiler or
external service is substituted. `npm run validate` retains all older regressions;
the compiler/runtime CI runs those suites plus HTTP export/worker integration.

Recovery validation on the icon baseline initially passed 920 Node tests.
After current-main integration and additional ambiguity checks, **1,013 Node
tests pass** (820 current-main tests plus 193 new cases). The local browser
checks cover 219 retained IDE/runtime cases and 10 new integration cases.
Local browser checks use emitted HTML through inline loading; real-origin
launch claims depend on the separately recorded HTTP CI run.
Final PR CI validates the combined current-main source, real HTTP launch,
independent exports, the actual diagnostic worker and all retained regressions.
CI run results, rather than historic release reports, are the merge evidence.

The interrupted upload contained only 17 complete patch records. Missing VM,
value integration, regression tests and browser fixtures were reconstructed and
independently checked. Temporary transfer files/workflows are removed before
merging. This is not recovery of every unrecorded edit or a full-conformance claim.

## Primary references

Shared classic VB/VBA behavior was checked against Microsoft's VBA reference.
These references describe the intended contracts, not proof of whole-VB6 parity.

- [On...GoSub / On...GoTo](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/ongosub-ongoto-statements)
- [Const](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/const-statement)
- [Enum](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/enum-statement)
- [Resume](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/resume-statement)
- [Decimal data type](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/decimal-data-type)
- [MS-OAUT DECIMAL](https://learn.microsoft.com/en-us/openspecs/windows_protocols/ms-oaut/b5493025-e447-4109-93a8-ac29c48d018d)
- [RATE](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/rate-function)
- [IRR](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/irr-function)
- [InStr](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/instr-function)
- [InStrRev](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/instrrev-function)
- [Split](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/split-function)
- [Replace](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/replace-function)
- [Filter](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/filter-function)
