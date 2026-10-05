# Native procedure call arguments

The direct JavaScript-written PE32/x86 compiler supports early-bound named
arguments, typed Optional parameters, and caller-owned scalar ByRef value
copies. These use the same compiler in Node, the classic File > Make EXE command,
the standalone HTML IDE and the DOM-free Web Worker SDK. They do not require a
new IDE interface or an embedded JavaScript/VB6 execution engine.

## Typed Optional arguments

Sub and Function parameters can be declared Optional with Byte, Integer, Long,
Boolean, Single, Double, Currency, Date or String. Both ByVal and ByRef forms are
supported. A constant default is bound in the **declaring module**, not the
caller's scope, and checked for the declared type before machine code is emitted.
An omitted scalar without an explicit default receives zero, False or an empty
String. Each omitted ByRef argument gets its own writable caller-frame variable;
changes to it do not persist into the next call. Recursion has independent frames.

```vb
Private Const DefaultRate As Currency = 1.125@

Public Function Price(ByVal count As Long, _
                      Optional ByVal rate As Currency = DefaultRate, _
                      Optional ByRef note As String = "standard") As Currency
    note = "computed"
    Price = count * rate
End Function

Public Sub Main()
    Dim answer As Currency, text As String
    answer = Price(2)                       ' 2.25; omitted note is a private copy
    answer = Price(count:=3, note:=text)    ' actual text receives "computed"
End Sub
```

Empty positional slots and trailing omitted parameters are supported. Names are
case-insensitive and parameter type suffixes are removed when matching names to
parameter declarations. Explicit type conversions remain subject to the existing
native numeric rules. In particular, use CLng/CInt/CBool explicitly where the
native numeric backend requires conversion from String text.

An unsupported default expression, out-of-range default or unsupported type is
a compile diagnostic. Call-specific default errors identify the declaration's
module and line. The compiler does not evaluate user procedures or variables to
obtain a default. Optional Variant/objects/arrays, ParamArray, and IsMissing
semantics remain outside the native typed target. Startup Main and native event
handlers retain their fixed signatures; they cannot gain Optional parameters.

## Named argument evaluation and layout

The entire argument list is validated before its argument code is emitted.
Unknown names, duplicate bindings, too many arguments, missing mandatory values,
and positional values after a named argument are diagnosed. An explicitly empty
positional slot already occupies that parameter; naming it later is a duplicate.

Supplied expressions evaluate once in written order. Values are staged in the
caller's frame and then pushed in formal-parameter order required by stdcall,
not in the order that named arguments appeared. Double/Currency ByVal slots are
eight bytes; other supported scalar slots/references are four. The compiler also
bounds the argument area against the x86 RET immediate limit.

This applies to project Sub/Function procedures and supported early-bound Declare
signatures. It does not add named-argument metadata to every built-in function,
late-bound COM call, unsupported control method or Property procedure.

## ByRef variables versus values

An unparenthesized addressable scalar variable still requires the exact declared
ByRef type and aliases its original storage. Array elements retain a backing-store
pin through the call, and failure during a later argument releases earlier pins
before recovery continues.

A scalar expression, a supported intrinsic control property, or an explicitly
grouped argument is converted into its own writable typed temporary. Changes to
that temporary do **not** copy back. Use an extra pair of parentheses inside an
explicit Call argument list to request a value copy unambiguously:

```vb
Private Sub Adjust(ByRef number As Integer)
    number = number + 1
End Sub

Private Sub Example()
    Dim original As Double
    original = 2.5
    Call Adjust((original))  ' Integer copy starts at 2; original remains 2.5.
    Call Adjust(1 + 2)       ' Writable temporary, not a pointer into constant data.
End Sub
```

These examples rely on groups retained by the shared expression parser. This
extension does not redefine the shared parser's acceptance/normalization of every
legacy bare-Sub parenthesis spelling. Calls that require a value copy should use
the explicit syntax above; full VB6 call-syntax conformance is not certified.

String references get zero-initialized owned BSTR slots. The callee may replace
the BSTR; the caller releases the resulting allocation after the call, or during
error cleanup if argument evaluation or the callee fails. String function results
are retained independently before these temporary references are destroyed.
Fixed-length String sources can be read into an explicitly grouped value copy,
but native fixed-length String **copy-back** is still unsupported. Parenthesized
whole-array values are rejected instead of silently aliasing their source.

## Explicit native pointer/value overrides

For a supported external scalar Long parameter declared ByRef, call-site `ByVal`
sends the Long value directly rather than the address of a local variable:

```vb
Private Declare Function GetCurrentProcess Lib "kernel32" () As Long
Private Declare Function GetProcessId Lib "kernel32" (ByRef process As Long) As Long

Private Sub Example()
    Dim id As Long
    id = GetProcessId(ByVal GetCurrentProcess())
End Sub
```

This is intentionally limited to an external **ByRef Long** declaration. It is
not a general reinterpret-cast for Currency, Double, String, arrays, records,
callbacks or project procedures. For project ByRef value copies, use parentheses.
As with all native Declare calls, the author's signature must match the real API;
incorrect native pointers/calling conventions are not sandboxed or repaired.

## Validation

`tests/win32-calls.test.mjs` checks argument planning, supported declaration types,
constant binding, diagnostics, immutability, callback guards, return-stack bounds
and deterministic executable construction. The fixtures emitted by
`tools/win32-call-fixtures.mjs` contain numbered assertions for the eventual real
Windows execution job: AotCalls covers numeric/String defaults, calls, pins and
errors; AotCallProperties exercises actual control properties and Form_Load.

```sh
npm run build
node --test tests/win32-calls.test.mjs
node tools/win32-call-fixtures.mjs
```

On Windows, execute the newly emitted artifacts with:

```powershell
./tools/test-win32-calls.ps1
```

The test harness runs each EXE alone in a fresh directory, checks its exit code
against its manifest, detects unexpected adjacent extracted files, captures
runtime-error dialog text on timeout and writes reports on success or failure.
The PowerShell/C# probe is test-only, not compiled into the shipped EXE or SDK.
A successful JavaScript test or browser download is **not** a Windows execution
pass. Native execution of these new fixtures is a required validation gate before
merging. The read-only workflow `.github/workflows/win32-calls.yml` supplies that
gate once this patch has been pushed to GitHub.

## Primary language references

- Argument lists and call-site ByVal: https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/5b35d806-1305-4427-a120-d25a71c45c02
- Procedure invocation argument processing: https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/1fb9af32-fc48-4c4f-998a-ed8047048ca5
- Parameter lists and omitted parameters: https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/78bcb344-4966-4401-bb55-72729790ebee
- ByRef mismatch and explicit grouping: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/byref-argument-type-mismatch

This remains the direct native-controls/GDI target. It does not add WebGPU,
Variant containers, Decimal storage, arbitrary classes/COM/OCX, full native
callback/structure interoperability, or licensed Microsoft compiler certification.
