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

## Save and open in browser applications

The previous example wrote `/Document.rtf` before opening the Save dialog. The
browser dialog then downloaded the *chosen* filename's virtual contents, which
did not exist when users changed the suggested name. It consequently downloaded
an empty file; opening that file could not restore the document. The same
pre-dialog write also used the wrong destination in a native Windows application.

The sample now follows the native CommonDialog contract:

```vb
Dialog1.FileName = "Document.rtf"
Dialog1.ShowSave
rtbDocument.SaveFile Dialog1.FileName, rtfRTF
```

The browser runtime waits for the outer VB call to finish before downloading its
chosen file. Sequential writes and nested helper procedures can therefore
finish before any bytes leave the private disk. Existing browser applications
which write a source file before `ShowSave` retain that source's exact bytes
when Save As selects a new name. Repeated saves to the same destination inside
one handler produce its final bytes once. A selected name with no file produces
no fabricated empty download; intentionally written zero-byte files still work.

Cancelled and failed saves release pending transactions. The sample's error
handler reports cancellation without changing its document. Open continues to
use the actual browser file chooser and imports the selected bytes before
`LoadFile` executes. Renamed downloads reopen with formatting and Unicode intact.

`tests/runtime-file-downloads.test.mjs` executes authored VB against the actual
interpreter and VFS. The existing `tools/browser-parity-tests.py` suite now
changes the Save As filename, verifies exact downloaded bytes against the VFS,
reopens the real download, overwrites the same name with new Unicode/formatted
content, reopens again, and checks cancellation without downloads or new files.

Local validation for this change: 135 focused Node tests passed, including all
12 loader instruction cases and 11 file transaction cases; all eight RichText
Chromium acceptance cases passed on Chromium 153.0.8010.12 with Playwright 1.57.
The browser run used the suite's in-memory origin. Remote CI retains the normal
browser-origin and Windows execution coverage.
