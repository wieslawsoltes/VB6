# Native constant and DLL result typing

The direct PE32 exporter resolves a value's declared type separately from the
register or address used to transport it. This matters for both constants and
foreign function results: a Double temporary and a Currency temporary travel
through EAX as addresses internally, not as Long values.

## Constant expressions

Module-level and procedure-local constants retain their declared Byte, Integer,
Long, Boolean, Single, Double, Currency or String type. An integral-valued
`Const Rate As Double = 2` is still Double; it is not re-inferred as Long when
used. Currency constants retain their full scaled 64-bit payload. Public imports
and qualified module references resolve to the already-bound value instead of
trying to lower an import metadata object as an integer.

The native resolver respects local/module variable shadowing, private access,
ambiguous public names and enum namespaces. Constant expressions are evaluated
by the existing side-effect-free source binder; this code does not execute user
functions or inspect host objects. Unsupported constant types such as Date still
produce a diagnostic. This does not add Variant containers or redefine the source
compiler's complete constant-inference rules.

## Foreign function results

A scalar stdcall Declare uses its own return signature whether the call is
unqualified, module-qualified or a supported zero-argument invocation. Currency
results use the complete EDX:EAX pair; floating results use ST(0), are copied to
owned expression temporaries, and are checked for nonfinite values. Byte and
Integer/Boolean retain zero/sign extension. TypeName/VarType evaluate calls once
and report supported semantic types, not EAX's width. The same rules apply to
argument conversions, assignments, comparison and formatting of a returned value.

This is not general callback, struct, COM or OCX support. The author remains
responsible for matching a DLL's exact ABI. A declared external DLL is a deployment
dependency; it is never automatically downloaded, registered or bundled.

## Independent Windows tests

`tools/win32-bindings-fixtures.mjs` generates AotCurrencyBindings.exe directly from
JavaScript and records 30 numbered assertions. `tools/test-win32-bindings.ps1`
compiles **only the test oracle DLL** from `tests/fixtures/native/currency-abi.c`
and `.def` with installed Microsoft C++ x86 tools. The generated VB application
is not passed to that compiler. The DLL is not part of the compiler SDK or normal
application output and contains no Microsoft VB6 runtime.

This independently exercises 64-bit, floating and narrow return registers,
mixed-width calls, call-once queries, a nonfinite foreign result and subsequent
error recovery, plus 2,000 mixed-return cycles. It complements the existing
single-file Currency fixture, whose arithmetic uses Windows Automation and which
still runs alone in an empty directory. The new ABI fixture deliberately runs with
one specified test DLL; its report records both hashes and does **not** call that
a no-dependency test. Source-level constants and enum/shadowing tests run in the
same executable. Reports are written even on failed assertions.

```sh
npm run build
node --test tests/win32-bindings.test.mjs
node tools/win32-currency-fixtures.mjs
node tools/win32-bindings-fixtures.mjs
```

On Windows with installed C++ test tools:

```powershell
./tools/test-win32-currency.ps1
./tools/test-win32-bindings.ps1
```

Neither these tests nor the Windows Automation functions certify the licensed
Microsoft VB6 compiler. The direct exporter remains an x86/native-controls/GDI
backend; WebGPU is a separate desktop rendering backend.

## Primary references

- Const scope and declaration types: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/const-statement
- Currency representation: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/currency-data-type
- x86 calling convention: https://learn.microsoft.com/en-us/cpp/cpp/argument-passing-and-naming-conventions
- MSVC test tool environment: https://learn.microsoft.com/en-us/cpp/build/building-on-the-command-line
