# Native AddressOf callbacks

The direct JavaScript PE32 exporter supports `AddressOf` an authored standard-
module Sub/Function as a **ByVal Long** argument to an early-bound call. The
pointer refers to one static, relocated x86 stdcall thunk per target procedure.
No executable heap allocation, runtime JIT, or proprietary compiler is used.
Pointers can be forwarded through ByVal Long procedure arguments; an arbitrary
Long is not callable from VB code. Private accessibility and ambiguous procedure
names retain the normal compiler checks.

```vb
Private Declare Function EnumWindows Lib "user32" _
    (ByVal callback As Long, ByVal data As Long) As Long

Private Function Visit(ByVal hwnd As Long, ByVal data As Long) As Long
    On Error Resume Next
    ' Inspect the HWND using an explicitly declared matching Windows API.
    Visit = 0  ' Stop enumeration.
End Function
```

The Declare reader supports physical line continuations while preserving source
positions. Invoke the example with
`result = EnumWindows(AddressOf Visit, 0)`.

## ABI and ownership

Callback parameters and return types may be Byte, Integer, Long, Boolean, Single,
Double, Currency or Date, with fixed parameter counts. Numeric ByRef parameters
borrow the external caller's storage. String, arrays, Optional, ParamArray, form
methods, class methods and foreign DLL functions are rejected as callback targets.
The real external prototype must match: this cannot infer or repair a bad pointer
or calling convention. Narrow results are sign/zero extended, Single/Double/Date
return through ST(0), and Currency returns through EDX:EAX.

The wrapper preserves EBX/ESI/EDI/EBP, its stack layout and the caller's x87 control
word. Nested callbacks on the application thread are supported. A callback gets
an independent VB error-frame boundary: its handled errors do not overwrite a
suspended caller's Err state, including its LastDLLError snapshot. Its owned local Strings/arrays are cleaned by the
normal procedure lifecycle. Unhandled callback errors use the ordinary fatal
native diagnostic rather than jumping across the suspended DLL/Windows stack.
Handle expected callback errors inside that procedure with On Error.

## Thread boundary

The compiler's runtime globals and error frames are single-threaded. A thunk
checks GetCurrentThreadId against the thread recorded at application startup
**before accessing VB state**. Foreign-thread entry exits the process with error
code 5 without executing user callback code. This is an explicit fail-closed
boundary, not arbitrary asynchronous/thread-pool callback support. Do not use
these pointers with APIs that invoke them on worker threads. Same-thread event-
loop callbacks remain callable while the executable lives; lifecycle of their
Windows registrations is the application's responsibility.

## Independent validation

`tools/win32-callback-fixtures.mjs` emits AotCallbacks and a separate foreign-thread
rejection fixture. `tools/test-win32-callbacks.ps1` compiles **only an independent
test DLL** with installed MSVC tools, then runs the JavaScript-generated EXEs with
that explicitly declared DLL. The C oracle checks native return registers, exact
Currency low bits, numeric references, nonvolatile registers, ESP and x87 control
state; the application also calls real user32 EnumWindows. Repeated nested and
handled-error callbacks test suspended state and cleanup. The thread-rejection
fixture expects exit 5, not a successful application exit.

The test DLL, C compiler and PowerShell harness are not part of the compiler SDK
or normal application output. This does not certify SEH, arbitrary DLL callbacks,
COM events, OCX hosting, P-code, or the original VB6 debugger.

Primary language contract: Microsoft's retained [AddressOf operator](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/addressof-operator).
