# Rich Text Editor feedback: browser files and Windows 7 PE

This change addresses the Rich Text Editor feedback as one independently reviewable pull request.

## Native startup

The generated executable uses Windows' `msftedit.dll` RichEdit control. It does not
load `MSVBVM60.DLL` or the VB6 RichText OCX. A native runtime error is emitted by
the independent VB6 Studio runtime; its wording is not evidence of a VB6 DLL dependency.

Windows 7 needs KB2533623 for `LOAD_LIBRARY_SEARCH_SYSTEM32`. A PE installation
without that update rejects this flag with `ERROR_INVALID_PARAMETER` (87). The
old initialization path translated every loader failure to error 7. The new path
first retains the restricted modern loader; only error 87 permits a fallback to
`GetSystemDirectoryW` plus the explicit DLL filename. The fallback never searches
for a bare DLL name in the application directory. A missing DLL raises error 48
and preserves the Windows failure in `Err.LastDllError`.

The loader cannot supply an operating-system DLL stripped from a custom PE
image. The application remains independent of installed VB6 runtime DLLs.

## Validation

`tests/win32-richtext-library.test.mjs` executes the emitted IA-32 loader at O0,
O1 and O2 with explicit Win32 hooks: modern success, legacy flag rejection,
absolute-system-path fallback, missing DLL, and bounded-path failure. This is
instruction/ABI validation; it is not a claim of execution on Gandalf Windows PE.

Browser save/open transaction fixes and their real-download regression coverage
are being added in the same pull request.
