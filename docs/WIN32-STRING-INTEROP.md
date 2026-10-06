# Native Declare String interoperability

The JavaScript PE32 exporter supports scalar String arguments and returns in
`Declare` statements. This is the classic **Declare ANSI byte-BSTR** convention,
not .NET P/Invoke, a Unicode type-library import, or arbitrary C string ownership.
The IDE's Make EXE command and browser/worker SDK use the same compiler.

```vb
Private Declare Function GetEnvironmentVariableA Lib "kernel32" _
    (ByVal name As String, ByVal buffer As String, ByVal capacity As Long) As Long

Sub ReadSetting()
    Dim text As String, length As Long, lastError As Long
    text = Space$(256)
    length = GetEnvironmentVariableA("TEMP", text, Len(text))
    lastError = Err.LastDLLError
    If length > 0 And length < Len(text) Then
        text = Left$(text, length)
    End If
End Sub
```

Declare line continuations preserve physical source-line positions. Underscores
inside aliases, string literals and comments do not join unrelated statements.
Declarations still need supported scalar stdcall prototypes. The author must
match the real export, parameter types, buffer sizes and calling convention.

## String ABI and ownership

Internally, String storage is an owned UTF-16 BSTR. Before each explicit DLL call,
String arguments are converted using the installed Windows **CP_ACP**, with
explicit lengths. The marshaler queries the actual output byte count; it does not
assume one ANSI byte per UTF-16 unit. Code-page conversion may be lossy. An `A` or
`W` export suffix does not change the declared ABI.

| Declaration | DLL receives | Ownership |
| --- | --- | --- |
| `ByVal value As String` | Pointer to ANSI byte-BSTR data | Borrowed writable temporary; DLL must not free or retain it. |
| `ByRef value As String` | Pointer to the ANSI byte-BSTR owner slot | DLL may replace it using compatible BSTR allocation/free rules. |
| Function `As String` | ANSI byte-BSTR returned in EAX | Ownership transfers to the caller for conversion and release. |
| `ByVal pointer As Long` with `StrPtr(text)` | Raw UTF-16 data address | Explicit borrowed pointer; no automatic ANSI conversion. |

A returned String or replaced ByRef String must be allocated as an ANSI byte-BSTR,
for example with **SysAllocStringByteLen**. Returning `char*`/static text, a pointer
inside an allocation, or a Unicode BSTR through this declaration is incorrect.
A DLL replacing a ByRef BSTR must free the old BSTR and must not share ownership
with another argument or return value. C prototypes and allocation rules are
shown in `tests/fixtures/native/string-abi.c`.

Unparenthesized String variables and String array elements receive copy-back for
both ByVal and ByRef declarations. Copy-back decodes the full byte length,
including embedded NULs; it does not trim at the first NUL. Fixed-length Strings
pad or truncate to their declared UTF-16 width. A parenthesized argument such as
`Api((text))` is a private value copy, so DLL writes do not replace `text`. Literals
and expressions are also writable private temporaries, never executable read-only
data. The existing project-procedure fixed-String ByRef limitation is unchanged.

The call-site form `Api ByVal text` is supported only when the external parameter
is declared ByRef String: it passes the byte buffer instead of its owner slot.
This does not add an unrestricted cast for records or whole arrays.

Each argument has its own conversion snapshot and owner. Named arguments are
evaluated once in written order; copy-back follows that same order. Repeated
aliases therefore do not share a mutable ANSI buffer. Exact original-runtime
alias behavior across malicious/incorrect ownership or asynchronous native code
is not certified.

`vbNullString`, an uninitialized String, and NULL String return/copy-back retain
a NULL pointer. An allocated empty String is distinct. `Space`/`Space$` produce
owned buffer text with checked length. Read/write buffers must be sized correctly
before the call; passing a capacity larger than the allocation can corrupt the
process. Positive return lengths must be checked against capacity before use.

## Errors, callbacks and bounded lifetimes

`Err.LastDLLError` is a read-only Long snapshot of GetLastError immediately after
each explicit Declare invocation, before marshaling cleanup can overwrite it.
It is not an automatic VB exception and is meaningful only according to the
called API's return-value contract. Read it immediately; a subsequent explicit
DLL call replaces the snapshot. Compiler-internal allocation/conversion APIs do
not publish their last-error values. This implementation leaves the snapshot
unchanged by Err.Clear; that detail is not original-runtime certification.

Floating and Currency results are captured before cleanup calls. Each conversion
allocation is adopted before a later conversion can fail. The ordinary statement
and procedure cleanup releases temporary byte-BSTRs on normal and VB error paths.
A failed decode/allocation does not replace that argument's original destination;
this is not an all-or-nothing transaction across multiple output arguments or
external effects. Earlier DLL effects cannot be undone.

A String array-element destination is captured once and its SAFEARRAY remains
pinned across argument evaluation, the foreign call and copy-back. Same-thread
numeric callbacks may call String DLL functions and mutate ordinary String
variables; the suspended call retains its independent ANSI snapshot. The callback
wrapper preserves the caller's LastDLLError snapshot alongside its other Err
state. String callback signatures, worker-thread callbacks and foreign SEH remain
unsupported; see [native callbacks](WIN32-CALLBACKS.md).

Existing String limits remain **1,048,576 UTF-16 units**; temporary ANSI storage is
bounded to **4,194,304 bytes** to accommodate Windows ACP configurations including
UTF-8. These checks do not sandbox native writes or validate arbitrary pointers.
The optional maxArrayBytes setting is not a cumulative String or process budget.

## Ownership edge cases

The native ownership suite also checks aliased output arguments with named-order
reordering, grouped private copies, a successful first output followed by a
rejected oversized second output, and repeated failure cleanup. These are explicit
marshaler contracts, not a claim that every original VB6 alias behavior is identical.
An authored constant named `vbNullString` retains its lexical binding even inside
`StrPtr`; only the actual intrinsic maps to a null pointer.

## Independent validation

`node tools/win32-string-fixtures.mjs` generates two programs:

- **AotStringInterop** checks byte-BSTR allocation, NULL/empty distinctions,
  embedded NULs, ByVal/ByRef/fixed/element copy-back, mixed numeric returns,
  explicit error snapshots, named order, partial-argument failures, callback
  reentry and 5,000 normal/error lifetime cycles against an independent C DLL.
- **AotWin32Strings** calls real kernel32 ANSI and explicit Unicode APIs without
  a test DLL, including environment input/output and module file-name buffers.

`node tools/win32-string-edge-fixture.mjs` additionally emits **AotStringOwnership**
for the ownership/binding edge cases. Its test DLL is also explicitly declared.

`tools/test-win32-string-interop.ps1` builds only the independent oracle DLL using
installed MSVC, runs all three JavaScript-generated EXEs in separate temporary folders,
checks their hashes and exit codes, and records the actual ANSI code page. The
compiler and SDK do not require MSVC or that oracle. CI also reruns the existing
scalar callback ABI suite and verifies Node/IDE/SDK/Blob-worker byte equality.

Test outcomes and installed code pages are in the execution artifacts. Tests on
one ACP are not a certificate for every Windows DBCS/locale configuration. This
extension does not implement Variant/UDT/Class AOT storage, complete Win32 APIs,
COM/OCX/type-library String ABI, arbitrary native pointer safety, or licensed VB6
compiler/runtime equivalence.

## Primary contracts and attribution

The original implementation follows Microsoft's **VB5DLL.TXT, section 5**,
[republished with Microsoft's permission](https://classicvb.net/tips/vb5dll/).
API contracts: [SysAllocStringByteLen](https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-sysallocstringbytelen),
[WideCharToMultiByte](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte),
[MultiByteToWideChar](https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar),
[LastDLLError](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/lastdllerror-property)
and [Space](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/space-function).
