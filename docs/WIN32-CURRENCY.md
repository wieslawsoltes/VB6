# Native Currency export

The direct Win32 compiler now accepts explicitly declared `Currency` values,
`DefCur` declarations and `@` Currency literals. Storage is a signed 64-bit integer
scaled by 10,000, not a JavaScript Number or a disguised Double. The limits are
`-922337203685477.5808` through `922337203685477.5807`. Source literals and bound
Currency constants retain exact scaled bits, including values beyond the exact
integer precision of IEEE Double. Decimal literal rounding is nearest-even.

```vb
Private Function AddFee(ByVal balance As Currency, ByVal fee As Currency) As Currency
    AddFee = balance + fee
End Function

Public Sub Main()
    Dim balances() As Currency
    ReDim balances(-2 To 2)
    balances(-2) = 900719925474.0993@
    balances(-2) = AddFee(balances(-2), 0.0001@)
    ReDim Preserve balances(-2 To 4)
    ' balances(-2) retains exactly 900719925474.0994, including its last digit.
End Sub
```

## Arithmetic and conversions

Owned value snapshots preserve earlier operands across later calls and ByRef
mutation. Same-type addition, subtraction, multiplication, comparisons, negation,
`Abs`, `Fix`, `Int`, `Sgn` and `Round` use exact CY storage and Windows Automation
Currency helpers. Overflow becomes a catchable VB error rather than wrapping.
`Round` uses nearest-even rounding; precisions 4 through 28 preserve the unchanged
Currency value. Negative precision and precision above 28 raise error 5.

Addition/subtraction involving Currency and another supported numeric type use
Currency operands/results. Multiplication with Double produces Double;
multiplication with Single or integral types retains Currency. Division and power
use the documented floating result path. Comparing Currency with Single/Double
uses `VarCyCmpR8`: the floating operand is converted to Currency before comparison,
matching VB's documented comparison rule. Values such as `1.24999` and `1.25001`
therefore both compare equal to `1.25@`; the sub-four-decimal difference is lost.
Ordinary ordering is retained when the converted Currency values differ, and
reversing operands reverses that ordering. This is distinct from promoting the
Currency operand to Double.
Explicit `CCur` is required for mixed text/Currency arithmetic and comparisons.
These are typed-compiler rules, not a general mixed-Variant implementation.

`CCur`, `CStr`, `CDbl`, `CSng`, `CInt`, `CLng`, `CByte`, `CBool`, `Len` and `LenB`
accept Currency. Integer narrowing is checked and uses nearest-even conversion.
Boolean conversion inspects the complete 64-bit payload: `0.0001@` is true, not
zero rounded to an integer. Single conversion uses the direct CY-to-Single API
before widening the temporary, avoiding an intermediate Double-to-Single rounding
step. Native text parsing/formatting uses the Windows user locale, as the existing
Single/Double conversion path does; it is not `Val`'s period-only source convention.
Embedded NULs are rejected for numeric parsing. A successful English-hosted test is
not certification of every Windows locale.

`VarType` and `TypeName` expose the supported statically lowered primitive/array
representation, including Currency type 6, Currency array type 8198 and
`"Currency()"`. Typed Boolean values, comparison results and Boolean-only logical
expressions report Boolean (type 11), not the width of their machine register.
They evaluate non-array arguments once. They do not implement
Variant containers, dynamic object introspection, or automatic getter evaluation.
Direct numeric literals and Boolean keywords lowered to numeric literals without
retained frontend subtype metadata are diagnosed;
use a typed variable or explicit conversion instead of assuming the compiler can
reconstruct discarded literal suffix information. Integer-only intermediates
remain the existing checked-Long native representation, not full VB6 promotion
semantics.

## Storage, calls and arrays

Globals, locals, statics, return values and fixed/dynamic array elements occupy
exactly eight bytes. Runtime Currency expressions return an immutable memory
snapshot to the compiler's internal lowering; actual x86 scalar function returns
use EDX:EAX, not the floating ST(0) register. The caller captures both halves before
performing error checks or releasing borrowed array-element pins. ByVal Currency
uses eight stack bytes; ByRef uses a pointer to exact Currency storage. Mixed-width
arguments are evaluated left to right before reverse-order stdcall placement.

Typed `stdcall Declare` accepts scalar Currency parameters and returns. These
signatures are the author's responsibility: an incorrect foreign ABI can corrupt
memory or crash the process. A declaration does not sandbox native calls or create
a missing DLL. Whole SAFEARRAY arguments to arbitrary DLLs remain unsupported.

Currency fixed/dynamic arrays use VT_CY SAFEARRAY elements, with the same checked
bounds, up-to-eight dimensions, `ReDim Preserve`, independent whole-array copies,
ByRef forwarding, locks, `Erase` and error-unwind cleanup as the other supported
native arrays. The one-MiB backing limit allows at most 131,072 Currency elements.
Failed resizing leaves the previous descriptor intact. Borrowed element addresses
remain locked until the call finishes, including failed subsequent arguments.
Fractional Currency `For` loops and exact-value `Select Case` are also lowered.

## Reproduction and validation

```sh
npm run build
node --test tests/win32-currency.test.mjs
node tools/win32-currency-fixtures.mjs
npm run build:win32 -- --project validation/currency/AotCurrency.vb6web --out release/money
```

The last command uses a new output directory; it does not replace an existing EXE.
The standalone IDE's **File > Make EXE** and the DOM-free compiler SDK/Web Worker
share the same implementation. Exporting an EXE does not execute it in a browser.

`tools/test-win32-currency.ps1` runs the emitted test EXE alone in an empty Windows
directory. The program contains numbered checks for raw-bit limits/scale,
arithmetic, conversion, mixed comparisons/ABI, errors, loops, array ownership and
2,000 repeated recursive array lifetimes. A nonzero exit identifies the failed
assertion; timeouts retain native-dialog diagnostics. CI retains the project, EXE,
SHA-256 manifest and execution report. Browser tests independently compare IDE,
SDK and worker bytes with Node output. Compilation tests alone are not evidence
that Windows executed the output; the matching CI execution report is authoritative.

## Still separate

This is a JavaScript-written **PE32/x86, native-controls/GDI** compiler extension.
Generated applications need no extraction, Node, Electron or Microsoft VB6 runtime,
but import Windows system APIs including OleAut32. No Windows DLL is redistributed
here. The separate Electron target remains WebGPU-capable and self-extracting.
Variant/Decimal storage, UDTs/classes, arbitrary COM/OCX, callbacks/structure ABI,
full control parity, native machine-code debugging and no-extraction WebGPU remain
outside this feature. Licensed Microsoft VB6 execution and physical GPU rendering
are not established by the Currency test harness.

## Primary references

- Currency: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/currency-data-type
- Arithmetic APIs: https://learn.microsoft.com/en-us/previous-versions/windows/desktop/automat/currency-arithmetic-functions
- Currency/Single/Double comparison rules: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/comparison-operators
- Native comparison API: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varcycmpr8
- String conversion: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varcyfromstr
- Rounding: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varcyround
- x86 return/argument ABI: https://learn.microsoft.com/en-us/cpp/cpp/argument-passing-and-naming-conventions

### Comparison test correction

The initial native Windows run reached assertion 30, where the test incorrectly
expected a sub-four-decimal difference to remain after mixed comparison. That
expectation contradicted Microsoft's documented conversion rule. The test now
checks rounded equality, strict and inclusive ordering in both operand orders,
Single conversion and the complete signed range, plus direct OleAut32 comparison
calls from the emitted x86 program. The compiler's existing `VarCyCmpR8` lowering
was retained; no floating-comparison assertion was disabled.
