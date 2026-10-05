# Native numeric storage and Calculator export

The direct Win32 exporter compiles the **unchanged** `examples/calculator.vb6web` project. The previous rejection of `firstNumber As Double` was a compiler limitation, not a corrupt project. Changing the Calculator variables to Long would incorrectly lose fractional values, so this implementation extends the native backend instead.

## Supported operations

`Single` and `Double` are native 4-byte and 8-byte numeric storage types, respectively. Globals, locals, statics, function returns, exact-type ByRef parameters, mixed-width ByVal parameters, fixed arrays, dynamic arrays, ReDim Preserve and whole-array ByRef/copy operations use these widths. The existing array locking and one-MiB backing-storage limit also apply to floating arrays.

The backend lowers fractional literals, addition/subtraction/multiplication/division, power, numeric comparisons, Boolean tests of fractional values, numeric For loops and Select Case. Integer-consuming operations explicitly convert floating values using nearest-even checked conversion; division no longer silently truncates its result. Single values round to Single precision when stored or passed ByVal. Floating temporaries are immutable Double snapshots, so a later operand cannot mutate an earlier operand's value through ByRef.

`CDbl`, `CSng`, `CInt`, `CLng`, `CByte`, `CBool`, `CStr`, `Abs`, `Sgn`, `Fix`, `Int`, `Sqr`, `Round`, `Len` and `LenB` accept the implemented numeric types. `Val` parses decimal/exponent prefixes independently of the Windows decimal separator, supports hexadecimal/octal prefixes and numeric suffix conversion, and stops at the first unrecognized character. `InStr` supports the two-, three- and four-argument forms, binary/text comparison, explicit start positions, and embedded NULs in BSTR strings. `CDbl`/`CStr` use Windows Automation locale conversion; they are not replacements for `Val`'s period-only source convention.

Generated arithmetic uses x87 instructions and standard Windows OleAut32 conversion APIs. No JS engine, Microsoft VB6 runtime, downloaded executable template or compiler executable is bundled. A floating expression is materialized in memory before calls, error checkpoints and cleanup. Only native function ABI returns use ST(0), and the caller immediately consumes that result. Arithmetic temporarily sets/restores its precision/rounding control and clears generated exception flags before restoration. Division by zero, overflow, invalid conversion and invalid Sqr arguments participate in the existing On Error/Resume mechanism.

Scalar `stdcall Declare` now accepts Single/Double parameters and returns. ByVal Double consumes eight stack bytes; ByRef Double remains a pointer. Mixed arguments are evaluated once, left to right, before reverse-order ABI placement. The declaration must match the actual DLL function: foreign pointers, DLL exceptions and incorrect calling conventions are not sandboxed or repaired.

## Static control arrays and appearance

Designed intrinsic controls with an Index have separate native HWNDs, IDs and state. Event callbacks receive the appropriate ByRef Integer Index. Runtime `control(index)` access validates the index; a missing element raises error 340. Count/LBound/UBound/Index and the supported existing control properties/methods are available. Duplicate indices, mixed scalar/array names and heterogeneous element types fail compilation. This is static designer control-array support, not dynamic Load/Unload of arbitrary controls.

Native fonts inherit the authored form/control font properties and scale point heights using Windows DPI. The Calculator's edit control retains its right alignment and larger font. These mappings do not establish pixel-exact original VB6 styling on every Windows theme or monitor.

## Reproduce

```sh
npm run build
npm run build:win32 -- --project examples/calculator.vb6web --out release/calculator
node tools/win32-numeric-fixtures.mjs
npm run test:win32
```

In the standalone browser IDE, open Calculator and choose **File > Make Calculator.exe (Win32 AOT)**. Export is local and does not need a build service. The resulting EXE runs on Windows; exporting does not execute it in the browser.

`tools/test-win32-numeric.ps1` executes the generated Calculator through actual native button messages, tests each Index, decimal arithmetic, large Double values and recovery after a zero-divisor dialog. Separate self-checking PEs exercise mixed ABI slots, recursion, storage, rounding, floating arrays, error unwinding and repeated calls that would expose an unbalanced FPU stack. Browser/worker tests compare the original Calculator's emitted PE bytes against Node output. Compilation-only checks are not evidence that a PE executed.

## Still separate or unsupported

This remains the direct **PE32/x86 native-control/GDI** target, not a no-extraction WebGPU backend. Electron is the separate WebGPU-capable target. Variant/Currency/Decimal storage, records/classes, full control APIs, dynamic control creation, COM/OCX and unrestricted native ABI/callback support are not implemented here. Native image/resource rendering and physical-GPU certification are not implied. Do not use these tests as certification of the proprietary Microsoft VB6 compiler or every Windows locale.

Primary platform references: Microsoft Learn `VarR8FromStr`, `VarBstrFromR8`, `VarR8Pow`, x86 argument passing, VBA `Val` and `InStr` documentation. Windows API calls in the test harness are read/control operations on the harness's own child processes.
