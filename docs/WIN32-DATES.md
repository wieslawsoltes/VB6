# Native Date storage and calendar functions

The direct JavaScript Win32 compiler supports eight-byte Automation `Date`
values without embedding a JavaScript engine or a Microsoft VB6 runtime. Date
is distinct from Double even though both use IEEE binary64 storage and the x86
ST(0) scalar return convention. This is a civil date/time value, not a Unix
millisecond timestamp or a timezone-aware instant.

## Implemented

Date globals, locals, statics, constants, literals, scalar `ByVal`/`ByRef` calls
and function returns are lowered directly. Optional ByVal/ByRef Date defaults,
early-bound named calls and explicitly grouped Date value copies are supported.
Defaults bind in the declaring module; grouped copies use eight-byte caller-owned
storage, never a four-byte pointer-sized value slot. Read-only literals and
expressions become writable temporaries without copy-back. An ungrouped Double
variable still cannot alias a Date reference. Fixed and dynamic Date arrays use
`VT_DATE` (7), preserve their element type through copying and `ReDim Preserve`,
and retain existing bounds, one-MiB backing limits, element locks and error
cleanup. An array or reference of Double is not interchangeable with Date.

`CDate`, `IsDate`, `CStr`, `DateValue`, `TimeValue`, `DateSerial`, `TimeSerial`,
`Year`, `Month`, `Day`, `Hour`, `Minute`, `Second`, and `Weekday` are implemented.
`Now`, `Date`, `Time`, and `Timer` read the local Windows clock. They do not set
the operating system clock. `Timer` returns Single seconds since local midnight;
Date/time clock getters have the resolution of Windows Automation conversion.

Date addition and mixed numeric subtraction retain Date; Date-Date subtraction
returns Double. Multiplication/division/power use Double. Explicit numeric and
Currency conversions, comparisons, fractional `For`/`Select Case`, `Len`/`LenB`,
`VarType`/`TypeName`, exact-once source evaluation and immutable operand snapshots
use the same compiler as File > Make EXE and the browser/worker SDK.

Dates before 1899-12-30 have a signed day and an absolute fractional time. For
example, `CDate(-1.25)` is 1899-12-29 at 06:00, not the preceding day's 18:00.
Negative zero-day aliases are not silently rewritten. Arithmetic uses the raw
serial representation; do not assume it is a linear UTC timestamp.

## Calendar, locale, and failures

Calendar operations are Gregorian. `DateSerial` uses signed Integer arguments,
nearest-even numeric conversion and Gregorian normalization. The month is
normalized first; the resulting short year is expanded with the Windows user's
Gregorian calendar window. That expanded year must not exceed 9999 before
normalizing the day. A sub-100 intermediate year can become valid after a large
positive day offset, but the final date must be within years 100 through 9999.
The month decrement retains the legacy signed-Integer wrap: month -32768 is
normalized after decrementing to 32767. These boundary rules are measured by the
independent installed Script Host reference, not inferred from ordinary dates.
`DateSerial(99,13,1)` therefore denotes year 0100, while
`DateSerial(9999,13,-30)` fails: a negative day cannot rescue normalized year
10000. The separate installed Script Host suite measures these edge cases;
ordinary-calendar tests alone did not expose the earlier normalization-order bug.
Two-digit years use the Windows user's Gregorian calendar window;
`Weekday(date, 0)` uses the user's first-day setting. Explicit `Weekday` starts
are 1 (Sunday) through 7 (Saturday). Four-digit years avoid ambiguous windows.

Text conversion uses the installed user's locale through OleAut32, with an
explicit Gregorian calendar. It is not per-project locale or Hijri emulation.
Embedded NUL strings are rejected instead of truncating input. Invalid data
returns False from `IsDate`; errors evaluating its argument still propagate.
Overflow and bad conversions are catchable through the existing native `On
Error` machinery and must not overwrite the destination value on failure.

Source Date literals retain the shared frontend's civil-date parser. Ambiguous
literal formats and daylight-saving gaps are not certified across all locales
and compiler-host timezones. Use unambiguous four-digit literals and DateSerial
for portable authored dates. Runtime clock getters are intentionally local.

## Native calls and verification

Scalar `Declare` Date arguments and results use their declared ABI, including
qualified calls, 8-byte `ByVal` values, 4-byte `ByRef` pointers, mixed argument
widths, nonfinite/out-of-range result rejection and error recovery. Authors must
supply a correctly matching DLL and signature. This does not add callback,
structure or arbitrary COM support.

`tools/win32-date-fixtures.mjs` produces the self-contained Date regression EXE.
A separate `AotDateABI` fixture deliberately depends on a small test DLL, built
independently from `tests/fixtures/native/date-abi.c`. The Windows job compiles
**only that oracle DLL** with installed C++ tools. The generated VB application
and compiler SDK never invoke C++. Tests compare Date returns, NLS settings,
negative date components and 4,800 Gregorian dates with Windows APIs, alongside
2,000 call/array-lifetime cycles. That is not licensed VB6 compiler certification.

```sh
npm run build
node --test tests/win32-date.test.mjs
node tools/win32-date-fixtures.mjs
npm run build:win32 -- --project validation/dates/AotDates.vb6web --out release/dates
```

Unsupported interval/formatting APIs such as native `DateAdd`, `DateDiff`,
`DatePart`, and `FormatDateTime` are still diagnosed; they are not stubbed.
Variant/Decimal, UDT/classes, general native COM/OCX, native machine-code
debugging and no-extraction WebGPU remain separate work. Direct AOT uses Win32
controls/GDI. The Electron target is the separate WebGPU-capable distribution.

## Primary references

- Date: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/date-data-type
- DateSerial: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/dateserial-function
- TimeSerial: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/timeserial-function
- Weekday: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/weekday-function
- Conversion: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-vardatefromr8
- Civil fields: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varianttimetosystemtime
- NLS window: https://learn.microsoft.com/en-us/windows/win32/api/winnls/nf-winnls-getcalendarinfow

## Date and call integration validation

`AotDateCalls` adds 29 numbered native assertions for optional/defaulted Date
arguments, negative serials, named mixed-width calls, reference/value distinction,
array-element pins, failure unwinding and 2,000 repeated recursion/error cycles.
The permanent Windows matrix runs basic storage, independent C ABI, Windows
Script Host reference and call-lifetime suites independently; a failure in one
does not prevent the others from writing their own diagnostics.

The Script Host suite retains its original 177 expressions and adds 195 probes
for negative years, cutoff-adjacent years and extreme signed month/day offsets.
Expected values and errors are obtained from the installed host on each run,
not recomputed using the native compiler's arithmetic. The ordinary Date fixture
also checks both intermediate-year and final-date rejection without overwriting
the assignment target. This reference is not licensed Microsoft VB6 certification.

Every reference probe captures the actual native error before comparing its value.
An unexpected error therefore exits with the probe number instead of displaying
a modal error until timeout. Neither expected errors nor successful results can
pass by accidentally reusing a preceding probe's value.
