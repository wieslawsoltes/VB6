# Native dynamic arrays

The direct JavaScript-to-PE32 compiler lowers typed fixed and dynamic arrays to
owned Windows Automation SAFEARRAYs. Generated programs still run as one EXE with
no extraction or bundled interpreter. `OleAut32.dll` is an imported Windows system
library, not a redistributed VB6 runtime. This does not add WebGPU or general COM
object execution to the direct target.

## Supported source

```vb
Private Sub Grow(ByRef values() As Long)
    ReDim Preserve values(-2 To 20)
    values(20) = 42
End Sub

Public Sub Main()
    Dim values() As Long
    Dim snapshot() As Long
    ReDim values(-2 To 10)
    values(0) = 7
    Grow values
    snapshot = values
    Erase values
    ' snapshot still owns an independent array with snapshot(0) = 7.
End Sub
```

Element types are Byte, Integer, Boolean, Long, Single, Double and String. Single
and Double elements occupy four and eight bytes respectively. Floating element
reads produce value snapshots and Single stores round to Single precision; see
[Native numeric storage](WIN32-NUMERIC.md). Dynamic arrays begin unallocated.
`ReDim` accepts one through eight dimensions with runtime signed 32-bit bounds and
Option Base for omitted lower bounds. ReDim without Preserve creates
zero/empty-initialized storage and can change rank. ReDim Preserve retains existing
elements and allows only the final dimension's upper bound to change. All lower
bounds and other dimensions must match. Shrinking String arrays releases the
removed BSTR elements; growing initializes new elements. Fixed-length String
arrays pad new elements and truncate/pad assignments to the declared length.

`LBound` and `UBound` have a checked optional dimension. Unallocated arrays, invalid
indices, invalid rank and incompatible Preserve bounds raise catchable error 9.
Whole-array assignment to a dynamic destination creates an independent copy of
bounds, data and owned String elements. Assigning an unallocated array clears its
destination. Copying a fixed array does not make its dynamic copy fixed.

Whole-array parameters are borrowed `ByRef` descriptor slots with exact element
types. They accept both fixed and dynamic arrays and can forward the same slot to
another procedure. ReDim through a parameter updates the caller's dynamic array.
Attempting to resize/replace a fixed array through a parameter raises error 10;
Erase on a fixed array resets its elements without changing its bounds.

Dynamic local arrays are destroyed on normal return and error unwind, including
owned BSTRs. Static arrays retain their storage between calls. Form-owned arrays
are released when their default-form storage is reinitialized. Globals/statics
otherwise live until process exit.

## ByRef element lifetime

An array element passed ByRef is locked from address lookup until its call
completes. A second argument, a nested call, or an error handler therefore cannot
resize, replace or erase the same array while that element address is borrowed:
it receives error 10 instead of a dangling pointer. Locks acquired before a
later argument fails are released by the source-level error cleanup. Normal calls
release locks immediately, so a later operand in the same expression may resize
that array. Reads and assignments acquire only their own short-lived pins.
Subscript expressions are evaluated once, left-to-right, before looking up the
current descriptor.

## Limits and excluded forms

Backing data is limited to one MiB per array, excluding the separately bounded
BSTR contents. Rank is limited to eight. Procedure workspace remains limited to
512 KiB. Reversed bounds are errors, not zero-element arrays. Unsupported element
types, undeclared ReDim targets, ByVal whole arrays, array returns, fixed-length
String whole-array arguments and fixed-length String scalar ByRef copy-back are
not implemented. Native Declare array/SAFEARRAY signatures remain rejected;
project-to-project whole-array parameters are an internal compiler ABI.

Array dimensions and element type must not be modified through raw native pointers.
Unrestricted Declare calls are not sandboxed; incorrect signatures or native memory
writes can invalidate every managed lifetime guarantee. The implementation does
not trap arbitrary Windows access violations or claim full original VB6 behavior.

## Validation

`tests/win32-arrays.test.mjs` covers declaration layout, rejected type/ABI/rank forms,
parameter forwarding, deterministic PE bytes and required ownership APIs. The
`AotDynamicArrays` Windows fixture contains 44 numbered failure checks spanning
resizing, preservation, deep copies, locks, error recovery, recursion, statics,
Unicode/embedded NUL data, element widths and 2,000 repeated String-array lifetimes.
It runs alongside the existing storage/error, native-control and native-MDI EXEs in
`tools/test-win32-aot.ps1`. The `AotNumbers` fixture and
`tools/test-win32-numeric.ps1` additionally exercise Single/Double fixed/dynamic
arrays, multidimensional Preserve, ByRef mutation, pinned resize errors and size
limits. A source-level compile pass is not a Windows execution pass; consult the
matching GitHub Actions artifact for the tested commit.

Platform references:
- ReDim: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/redim-statement
- SAFEARRAY: https://learn.microsoft.com/en-us/windows/win32/api/oaidl/ns-oaidl-safearray
- Element locking: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-safearrayptrofindex
- Resizing: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-safearrayredim
- Deep copy: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-safearraycopy
