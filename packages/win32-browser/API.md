# Win32 browser export inventory

Version 0.5.0. 407 named exports, counting A/W variants and aliases.
See README.md, GDI.md and REGIONS.md for per-family restrictions and the VB6 ABI boundary.
Arity counts 32-bit arguments; PtInRect expands a by-value POINT into two scalars.

| DLL | Export | Arity | Mode | Specific notes |
| --- | --- | ---: | --- | --- |
| advapi32 | `RegCloseKey` | 1 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegCreateKeyExA` | 9 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegCreateKeyExW` | 9 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegDeleteKeyA` | 2 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegDeleteKeyW` | 2 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegDeleteValueA` | 2 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegDeleteValueW` | 2 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegEnumKeyA` | 4 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegEnumKeyExA` | 8 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegEnumKeyExW` | 8 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegEnumKeyW` | 4 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegEnumValueA` | 8 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegEnumValueW` | 8 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegFlushKey` | 1 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegOpenKeyExA` | 5 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegOpenKeyExW` | 5 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegQueryInfoKeyA` | 12 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegQueryInfoKeyW` | 12 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegQueryValueExA` | 6 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegQueryValueExW` | 6 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegSetValueExA` | 6 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegSetValueExW` | 6 | emulated | Isolated application registry, not the operating-system registry. |
| crypt32 | `CryptBinaryToStringA` | 5 | emulated | Raw Base64 only. Supports size queries, CRLF/LF/no-wrap, strict validation and explicit byte counts. No certificate or encryption APIs. |
| crypt32 | `CryptBinaryToStringW` | 5 | emulated | Raw Base64 only. Supports size queries, CRLF/LF/no-wrap, strict validation and explicit byte counts. No certificate or encryption APIs. |
| crypt32 | `CryptStringToBinaryA` | 7 | emulated | Raw Base64 only. Supports size queries, CRLF/LF/no-wrap, strict validation and explicit byte counts. No certificate or encryption APIs. |
| crypt32 | `CryptStringToBinaryW` | 7 | emulated | Raw Base64 only. Supports size queries, CRLF/LF/no-wrap, strict validation and explicit byte counts. No certificate or encryption APIs. |
| gdi32 | `AbortPath` | 1 | emulated |  |
| gdi32 | `BeginPath` | 1 | emulated |  |
| gdi32 | `BitBlt` | 9 | emulated |  |
| gdi32 | `CloseFigure` | 1 | emulated |  |
| gdi32 | `CombineRgn` | 4 | emulated |  |
| gdi32 | `CombineTransform` | 3 | emulated |  |
| gdi32 | `CreateBitmap` | 5 | emulated |  |
| gdi32 | `CreateCompatibleBitmap` | 3 | emulated |  |
| gdi32 | `CreateCompatibleDC` | 1 | emulated |  |
| gdi32 | `CreateDIBSection` | 6 | emulated |  |
| gdi32 | `CreateEllipticRgn` | 4 | emulated |  |
| gdi32 | `CreateEllipticRgnIndirect` | 1 | emulated |  |
| gdi32 | `CreateFontA` | 14 | emulated |  |
| gdi32 | `CreateFontIndirectA` | 1 | emulated |  |
| gdi32 | `CreateFontIndirectW` | 1 | emulated |  |
| gdi32 | `CreateFontW` | 14 | emulated |  |
| gdi32 | `CreatePen` | 3 | emulated |  |
| gdi32 | `CreatePolygonRgn` | 3 | emulated |  |
| gdi32 | `CreatePolyPolygonRgn` | 4 | emulated |  |
| gdi32 | `CreateRectRgn` | 4 | emulated |  |
| gdi32 | `CreateRectRgnIndirect` | 1 | emulated |  |
| gdi32 | `CreateRoundRectRgn` | 6 | emulated |  |
| gdi32 | `CreateSolidBrush` | 1 | emulated |  |
| gdi32 | `DeleteDC` | 1 | emulated |  |
| gdi32 | `DeleteObject` | 1 | emulated |  |
| gdi32 | `DPtoLP` | 3 | emulated |  |
| gdi32 | `Ellipse` | 5 | emulated |  |
| gdi32 | `EndPath` | 1 | emulated |  |
| gdi32 | `EqualRgn` | 2 | emulated |  |
| gdi32 | `ExcludeClipRect` | 5 | emulated |  |
| gdi32 | `ExtCreateRegion` | 3 | emulated |  |
| gdi32 | `ExtSelectClipRgn` | 3 | emulated |  |
| gdi32 | `ExtTextOutA` | 8 | browser |  |
| gdi32 | `ExtTextOutW` | 8 | browser |  |
| gdi32 | `FillPath` | 1 | emulated |  |
| gdi32 | `FillRgn` | 3 | emulated |  |
| gdi32 | `FlattenPath` | 1 | emulated |  |
| gdi32 | `FrameRgn` | 5 | emulated |  |
| gdi32 | `GdiAlphaBlend` | 11 | emulated |  |
| gdi32 | `GdiFlush` | 0 | emulated | Memory operations and host pixel transfers are synchronous. Browser presentation is independently scheduled. |
| gdi32 | `GdiTransparentBlt` | 11 | emulated |  |
| gdi32 | `GetBitmapBits` | 3 | emulated |  |
| gdi32 | `GetBitmapDimensionEx` | 2 | emulated |  |
| gdi32 | `GetBkColor` | 1 | emulated |  |
| gdi32 | `GetBkMode` | 1 | emulated |  |
| gdi32 | `GetClipBox` | 2 | emulated |  |
| gdi32 | `GetClipRgn` | 2 | emulated |  |
| gdi32 | `GetCurrentObject` | 2 | emulated |  |
| gdi32 | `GetCurrentPositionEx` | 2 | emulated |  |
| gdi32 | `GetDeviceCaps` | 2 | emulated |  |
| gdi32 | `GetDIBits` | 7 | emulated |  |
| gdi32 | `GetGraphicsMode` | 1 | emulated |  |
| gdi32 | `GetMapMode` | 1 | emulated |  |
| gdi32 | `GetObjectA` | 3 | emulated |  |
| gdi32 | `GetObjectType` | 1 | emulated |  |
| gdi32 | `GetObjectW` | 3 | emulated |  |
| gdi32 | `GetPath` | 4 | emulated |  |
| gdi32 | `GetPixel` | 3 | emulated |  |
| gdi32 | `GetPolyFillMode` | 1 | emulated |  |
| gdi32 | `GetRegionData` | 3 | emulated |  |
| gdi32 | `GetRgnBox` | 2 | emulated |  |
| gdi32 | `GetStockObject` | 1 | emulated |  |
| gdi32 | `GetStretchBltMode` | 1 | emulated |  |
| gdi32 | `GetTextAlign` | 1 | emulated |  |
| gdi32 | `GetTextCharacterExtra` | 1 | emulated |  |
| gdi32 | `GetTextColor` | 1 | emulated |  |
| gdi32 | `GetTextExtentExPointA` | 7 | browser |  |
| gdi32 | `GetTextExtentExPointW` | 7 | browser |  |
| gdi32 | `GetTextExtentPoint32A` | 4 | browser |  |
| gdi32 | `GetTextExtentPoint32W` | 4 | browser |  |
| gdi32 | `GetTextExtentPointA` | 4 | browser |  |
| gdi32 | `GetTextExtentPointW` | 4 | browser |  |
| gdi32 | `GetTextFaceA` | 3 | emulated |  |
| gdi32 | `GetTextFaceW` | 3 | emulated |  |
| gdi32 | `GetTextMetricsA` | 2 | browser | Metrics come from the selected Canvas font; native GDI hinting/font mapper values are not guaranteed identical. |
| gdi32 | `GetTextMetricsW` | 2 | browser | Metrics come from the selected Canvas font; native GDI hinting/font mapper values are not guaranteed identical. |
| gdi32 | `GetViewportExtEx` | 2 | emulated |  |
| gdi32 | `GetViewportOrgEx` | 2 | emulated |  |
| gdi32 | `GetWindowExtEx` | 2 | emulated |  |
| gdi32 | `GetWindowOrgEx` | 2 | emulated |  |
| gdi32 | `GetWorldTransform` | 2 | emulated |  |
| gdi32 | `IntersectClipRect` | 5 | emulated |  |
| gdi32 | `InvertRgn` | 2 | emulated |  |
| gdi32 | `LineTo` | 3 | emulated |  |
| gdi32 | `LPtoDP` | 3 | emulated |  |
| gdi32 | `ModifyWorldTransform` | 3 | emulated |  |
| gdi32 | `MoveToEx` | 4 | emulated |  |
| gdi32 | `OffsetClipRgn` | 3 | emulated |  |
| gdi32 | `OffsetRgn` | 3 | emulated |  |
| gdi32 | `OffsetViewportOrgEx` | 4 | emulated |  |
| gdi32 | `OffsetWindowOrgEx` | 4 | emulated |  |
| gdi32 | `PaintRgn` | 2 | emulated |  |
| gdi32 | `PatBlt` | 6 | emulated |  |
| gdi32 | `PathToRegion` | 1 | emulated |  |
| gdi32 | `PolyBezier` | 3 | emulated |  |
| gdi32 | `PolyBezierTo` | 3 | emulated |  |
| gdi32 | `Polygon` | 3 | emulated |  |
| gdi32 | `Polyline` | 3 | emulated |  |
| gdi32 | `PolylineTo` | 3 | emulated |  |
| gdi32 | `PolyPolygon` | 4 | emulated |  |
| gdi32 | `PolyPolyline` | 4 | emulated |  |
| gdi32 | `PtInRegion` | 3 | emulated |  |
| gdi32 | `PtVisible` | 3 | emulated |  |
| gdi32 | `Rectangle` | 5 | emulated |  |
| gdi32 | `RectInRegion` | 2 | emulated |  |
| gdi32 | `RectVisible` | 2 | emulated |  |
| gdi32 | `RestoreDC` | 2 | emulated |  |
| gdi32 | `SaveDC` | 1 | emulated |  |
| gdi32 | `ScaleViewportExtEx` | 6 | emulated |  |
| gdi32 | `ScaleWindowExtEx` | 6 | emulated |  |
| gdi32 | `SelectClipPath` | 2 | emulated |  |
| gdi32 | `SelectClipRgn` | 2 | emulated |  |
| gdi32 | `SelectObject` | 2 | emulated |  |
| gdi32 | `SetBitmapBits` | 3 | emulated |  |
| gdi32 | `SetBitmapDimensionEx` | 4 | emulated |  |
| gdi32 | `SetBkColor` | 2 | emulated |  |
| gdi32 | `SetBkMode` | 2 | emulated |  |
| gdi32 | `SetDIBits` | 7 | emulated |  |
| gdi32 | `SetGraphicsMode` | 2 | emulated |  |
| gdi32 | `SetMapMode` | 2 | emulated |  |
| gdi32 | `SetPixel` | 4 | emulated |  |
| gdi32 | `SetPixelV` | 4 | emulated |  |
| gdi32 | `SetPolyFillMode` | 2 | emulated |  |
| gdi32 | `SetRectRgn` | 5 | emulated |  |
| gdi32 | `SetStretchBltMode` | 2 | emulated |  |
| gdi32 | `SetTextAlign` | 2 | emulated |  |
| gdi32 | `SetTextCharacterExtra` | 2 | emulated |  |
| gdi32 | `SetTextColor` | 2 | emulated |  |
| gdi32 | `SetViewportExtEx` | 4 | emulated |  |
| gdi32 | `SetViewportOrgEx` | 4 | emulated |  |
| gdi32 | `SetWindowExtEx` | 4 | emulated |  |
| gdi32 | `SetWindowOrgEx` | 4 | emulated |  |
| gdi32 | `SetWorldTransform` | 2 | emulated |  |
| gdi32 | `StretchBlt` | 11 | emulated |  |
| gdi32 | `StrokeAndFillPath` | 1 | emulated |  |
| gdi32 | `StrokePath` | 1 | emulated |  |
| gdi32 | `TextOutA` | 5 | browser | Canvas font shaping/rasterization on window and memory DCs, with complex clipping and affine transforms. |
| gdi32 | `TextOutW` | 5 | browser | Canvas font shaping/rasterization on window and memory DCs, with complex clipping and affine transforms. |
| gdi32 | `WidenPath` | 1 | emulated |  |
| kernel32 | `CloseHandle` | 1 | emulated | Closes file or synchronization handles. Closing a pending wait fails it with INVALID_HANDLE rather than leaving an unresolved promise. |
| kernel32 | `CopyFileA` | 3 | emulated |  |
| kernel32 | `CopyFileW` | 3 | emulated |  |
| kernel32 | `CopyMemory` | 3 | emulated |  |
| kernel32 | `CreateDirectoryA` | 2 | emulated |  |
| kernel32 | `CreateDirectoryW` | 2 | emulated |  |
| kernel32 | `CreateEventA` | 4 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `CreateEventW` | 4 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `CreateFileA` | 7 | emulated | Synchronous app-private disk. No device paths, native disk, overlapped I/O, or security descriptors. |
| kernel32 | `CreateFileW` | 7 | emulated | Synchronous app-private disk. No device paths, native disk, overlapped I/O, or security descriptors. |
| kernel32 | `CreateSemaphoreA` | 4 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `CreateSemaphoreW` | 4 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `DeleteFileA` | 1 | emulated |  |
| kernel32 | `DeleteFileW` | 1 | emulated |  |
| kernel32 | `DuplicateHandle` | 7 | emulated | Current compatibility instance only. File duplicates share the cursor; synchronization duplicates share the object. No OS process access or inheritance. |
| kernel32 | `ExpandEnvironmentStringsA` | 3 | emulated | Single-pass expansion of process-private variables; unknown names are preserved. No host environment access. |
| kernel32 | `ExpandEnvironmentStringsW` | 3 | emulated | Single-pass expansion of process-private variables; unknown names are preserved. No host environment access. |
| kernel32 | `FillMemory` | 3 | emulated |  |
| kernel32 | `FindClose` | 1 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `FindFirstFileA` | 2 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `FindFirstFileW` | 2 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `FindNextFileA` | 2 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `FindNextFileW` | 2 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `FlushFileBuffers` | 1 | emulated | Writes to the private memory disk are immediate. Calls fs.flush(path) when supplied; no claim of host disk durability. |
| kernel32 | `GetACP` | 0 | emulated | UTF-8 and process Windows-1252 only; bounded buffers, no host locale or best-fit table. |
| kernel32 | `GetCurrentDirectoryA` | 2 | emulated |  |
| kernel32 | `GetCurrentDirectoryW` | 2 | emulated |  |
| kernel32 | `GetCurrentProcess` | 0 | emulated | Current compatibility instance only. File duplicates share the cursor; synchronization duplicates share the object. No OS process access or inheritance. |
| kernel32 | `GetEnvironmentVariableA` | 3 | emulated |  |
| kernel32 | `GetEnvironmentVariableW` | 3 | emulated |  |
| kernel32 | `GetFileAttributesA` | 1 | emulated |  |
| kernel32 | `GetFileAttributesExA` | 3 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `GetFileAttributesExW` | 3 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `GetFileAttributesW` | 1 | emulated |  |
| kernel32 | `GetFileInformationByHandle` | 2 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. BY_HANDLE_FILE_INFORMATION has zero timestamps/volume/file identifiers and one link. No host identity is invented. |
| kernel32 | `GetFileSize` | 2 | emulated |  |
| kernel32 | `GetFileSizeEx` | 2 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `GetFileType` | 1 | emulated | Current compatibility instance only. File duplicates share the cursor; synchronization duplicates share the object. No OS process access or inheritance. |
| kernel32 | `GetFullPathNameA` | 4 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `GetFullPathNameW` | 4 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `GetLastError` | 0 | emulated |  |
| kernel32 | `GetLocalTime` | 1 | emulated |  |
| kernel32 | `GetPrivateProfileIntA` | 4 | emulated |  |
| kernel32 | `GetPrivateProfileIntW` | 4 | emulated |  |
| kernel32 | `GetPrivateProfileStringA` | 6 | emulated |  |
| kernel32 | `GetPrivateProfileStringW` | 6 | emulated |  |
| kernel32 | `GetSystemTime` | 1 | emulated |  |
| kernel32 | `GetSystemTimeAsFileTime` | 1 | emulated |  |
| kernel32 | `GetTempFileNameA` | 4 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `GetTempFileNameW` | 4 | emulated | Application-private filesystem only. Snapshot enumeration, no 8.3 aliases/reparse points; unavailable file timestamps are zero. |
| kernel32 | `GetTempPathA` | 2 | emulated | Path is in the application-private virtual filesystem. |
| kernel32 | `GetTempPathW` | 2 | emulated | Path is in the application-private virtual filesystem. |
| kernel32 | `GetTickCount` | 0 | browser | Elapsed milliseconds since this compatibility process was created, not host OS boot. |
| kernel32 | `GetTickCount64` | 0 | browser | JavaScript number; exact within the safe integer range. |
| kernel32 | `GlobalAddAtomA` | 1 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| kernel32 | `GlobalAddAtomW` | 1 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| kernel32 | `GlobalAlloc` | 2 | emulated |  |
| kernel32 | `GlobalDeleteAtom` | 1 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| kernel32 | `GlobalFindAtomA` | 1 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| kernel32 | `GlobalFindAtomW` | 1 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| kernel32 | `GlobalFree` | 1 | emulated |  |
| kernel32 | `GlobalGetAtomNameA` | 3 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| kernel32 | `GlobalGetAtomNameW` | 3 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| kernel32 | `GlobalLock` | 1 | emulated |  |
| kernel32 | `GlobalSize` | 1 | emulated |  |
| kernel32 | `GlobalUnlock` | 1 | emulated |  |
| kernel32 | `IsValidCodePage` | 1 | emulated | UTF-8 and process Windows-1252 only; bounded buffers, no host locale or best-fit table. |
| kernel32 | `LocalAlloc` | 2 | emulated |  |
| kernel32 | `LocalFree` | 1 | emulated |  |
| kernel32 | `LocalLock` | 1 | emulated |  |
| kernel32 | `LocalSize` | 1 | emulated |  |
| kernel32 | `LocalUnlock` | 1 | emulated |  |
| kernel32 | `lstrcpyA` | 2 | emulated |  |
| kernel32 | `lstrcpynA` | 3 | emulated |  |
| kernel32 | `lstrcpynW` | 3 | emulated |  |
| kernel32 | `lstrcpyW` | 2 | emulated |  |
| kernel32 | `lstrlenA` | 1 | emulated |  |
| kernel32 | `lstrlenW` | 1 | emulated |  |
| kernel32 | `MoveFileA` | 2 | emulated |  |
| kernel32 | `MoveFileW` | 2 | emulated |  |
| kernel32 | `MoveMemory` | 3 | emulated |  |
| kernel32 | `MulDiv` | 3 | emulated |  |
| kernel32 | `MultiByteToWideChar` | 6 | emulated | UTF-8 and process Windows-1252 only; bounded buffers, no host locale or best-fit table. |
| kernel32 | `OpenEventA` | 3 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `OpenEventW` | 3 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `OpenSemaphoreA` | 3 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `OpenSemaphoreW` | 3 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `QueryPerformanceCounter` | 1 | browser | Microsecond units; precision is limited by browser timer policy. |
| kernel32 | `QueryPerformanceFrequency` | 1 | emulated |  |
| kernel32 | `ReadFile` | 5 | emulated |  |
| kernel32 | `ReleaseSemaphore` | 3 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `RemoveDirectoryA` | 1 | emulated |  |
| kernel32 | `RemoveDirectoryW` | 1 | emulated |  |
| kernel32 | `ResetEvent` | 1 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `RtlFillMemory` | 3 | emulated |  |
| kernel32 | `RtlMoveMemory` | 3 | emulated |  |
| kernel32 | `RtlZeroMemory` | 2 | emulated |  |
| kernel32 | `SetCurrentDirectoryA` | 1 | emulated |  |
| kernel32 | `SetCurrentDirectoryW` | 1 | emulated |  |
| kernel32 | `SetEndOfFile` | 1 | emulated |  |
| kernel32 | `SetEnvironmentVariableA` | 2 | emulated |  |
| kernel32 | `SetEnvironmentVariableW` | 2 | emulated |  |
| kernel32 | `SetEvent` | 1 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `SetFilePointer` | 4 | emulated |  |
| kernel32 | `SetFilePointerEx` | 5 | emulated | Split low/high signed LARGE_INTEGER input, 8-byte output. Exact virtual positions up to Number.MAX_SAFE_INTEGER; actual file allocations remain quota-bound. |
| kernel32 | `SetLastError` | 1 | emulated |  |
| kernel32 | `Sleep` | 1 | browser | Asynchronous cooperative delay; does not block the UI thread. |
| kernel32 | `WaitForMultipleObjects` | 4 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `WaitForSingleObject` | 2 | emulated | Process-private events/semaphores. Positive waits yield a Promise; VB Declare awaits it. No threads, kernel objects, security descriptors or cross-process namespace. |
| kernel32 | `WideCharToMultiByte` | 8 | emulated | UTF-8 and process Windows-1252 only; bounded buffers, no host locale or best-fit table. |
| kernel32 | `WriteFile` | 5 | emulated |  |
| kernel32 | `WritePrivateProfileStringA` | 4 | emulated | Project-private INI files. Preserves unrelated lines; does not implement Windows registry IniFileMapping. |
| kernel32 | `WritePrivateProfileStringW` | 4 | emulated | Project-private INI files. Preserves unrelated lines; does not implement Windows registry IniFileMapping. |
| kernel32 | `ZeroMemory` | 2 | emulated |  |
| msimg32 | `AlphaBlend` | 11 | emulated | Packed BLENDFUNCTION; premultiplied 32-bit source alpha. |
| msimg32 | `TransparentBlt` | 11 | emulated | Color-key transfer; positive extents only. |
| ole32 | `CLSIDFromString` | 2 | emulated | GUID values only. No COM activation, registry ProgID lookup or native allocation. |
| ole32 | `CoCreateGuid` | 1 | browser | GUID values only. No COM activation, registry ProgID lookup or native allocation. Uses Web Crypto random values (version-4 UUID); never Math.random. |
| ole32 | `CoTaskMemAlloc` | 1 | emulated | Owned bounded virtual task memory. NULL free is harmless; failed realloc retains its original allocation. No native COM heap. |
| ole32 | `CoTaskMemFree` | 1 | emulated | Owned bounded virtual task memory. NULL free is harmless; failed realloc retains its original allocation. No native COM heap. |
| ole32 | `CoTaskMemRealloc` | 2 | emulated | Owned bounded virtual task memory. NULL free is harmless; failed realloc retains its original allocation. No native COM heap. |
| ole32 | `IIDFromString` | 2 | emulated | GUID values only. No COM activation, registry ProgID lookup or native allocation. |
| ole32 | `StringFromGUID2` | 3 | emulated | GUID values only. No COM activation, registry ProgID lookup or native allocation. |
| shell32 | `ShellExecuteA` | 6 | browser | Only explicitly enabled http/https/mailto navigation; no executable launch. |
| shell32 | `ShellExecuteW` | 6 | browser | Only explicitly enabled http/https/mailto navigation; no executable launch. |
| shlwapi | `PathAddBackslashA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathAddBackslashW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathCanonicalizeA` | 2 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathCanonicalizeW` | 2 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathCombineA` | 3 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathCombineW` | 3 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathFileExistsA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathFileExistsW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathFindExtensionA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathFindExtensionW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathFindFileNameA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathFindFileNameW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsDirectoryA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsDirectoryW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsRelativeA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsRelativeW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsRootA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsRootW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsUNCA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathIsUNCW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathRemoveBackslashA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathRemoveBackslashW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathRemoveExtensionA` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathRemoveExtensionW` | 1 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathRenameExtensionA` | 2 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| shlwapi | `PathRenameExtensionW` | 2 | emulated | Bounded MAX_PATH lexical helpers. Filesystem predicates use only the private disk; no shell/network/host access. |
| user32 | `BeginPaint` | 2 | browser |  |
| user32 | `ClientToScreen` | 2 | browser |  |
| user32 | `CloseClipboard` | 0 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `CopyRect` | 2 | emulated |  |
| user32 | `CountClipboardFormats` | 0 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `DrawTextA` | 5 | browser |  |
| user32 | `DrawTextW` | 5 | browser |  |
| user32 | `EmptyClipboard` | 0 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `EnableWindow` | 2 | browser |  |
| user32 | `EndPaint` | 2 | browser |  |
| user32 | `EnumClipboardFormats` | 1 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `EnumPropsExA` | 3 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `EnumPropsExW` | 3 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `EnumWindows` | 2 | browser |  |
| user32 | `EqualRect` | 2 | emulated |  |
| user32 | `FindWindowA` | 2 | browser |  |
| user32 | `FindWindowExA` | 4 | browser |  |
| user32 | `FindWindowExW` | 4 | browser |  |
| user32 | `FindWindowW` | 2 | browser |  |
| user32 | `GetClassNameA` | 3 | browser |  |
| user32 | `GetClassNameW` | 3 | browser |  |
| user32 | `GetClientRect` | 2 | browser |  |
| user32 | `GetClipboardData` | 1 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `GetClipboardOwner` | 0 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `GetClipboardSequenceNumber` | 0 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `GetDC` | 1 | browser |  |
| user32 | `GetDCEx` | 3 | browser |  |
| user32 | `GetDlgCtrlID` | 1 | browser |  |
| user32 | `GetDlgItem` | 2 | browser |  |
| user32 | `GetFocus` | 0 | browser |  |
| user32 | `GetForegroundWindow` | 0 | browser |  |
| user32 | `GetOpenClipboardWindow` | 0 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `GetParent` | 1 | browser |  |
| user32 | `GetPropA` | 2 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `GetPropW` | 2 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `GetSystemMetrics` | 1 | browser | CSS-pixel app viewport metrics, not physical desktop measurements. |
| user32 | `GetUpdateRect` | 3 | browser |  |
| user32 | `GetUpdateRgn` | 3 | browser |  |
| user32 | `GetWindowLongA` | 2 | browser |  |
| user32 | `GetWindowLongW` | 2 | browser |  |
| user32 | `GetWindowRect` | 2 | browser |  |
| user32 | `GetWindowRgn` | 2 | browser |  |
| user32 | `GetWindowRgnBox` | 2 | browser |  |
| user32 | `GetWindowTextA` | 3 | browser |  |
| user32 | `GetWindowTextLengthA` | 1 | browser |  |
| user32 | `GetWindowTextLengthW` | 1 | browser |  |
| user32 | `GetWindowTextW` | 3 | browser |  |
| user32 | `InflateRect` | 3 | emulated |  |
| user32 | `IntersectRect` | 3 | emulated |  |
| user32 | `InvalidateRect` | 3 | browser |  |
| user32 | `InvalidateRgn` | 3 | browser |  |
| user32 | `IsChild` | 2 | browser |  |
| user32 | `IsClipboardFormatAvailable` | 1 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `IsRectEmpty` | 1 | emulated |  |
| user32 | `IsWindow` | 1 | browser |  |
| user32 | `IsWindowEnabled` | 1 | browser |  |
| user32 | `IsWindowVisible` | 1 | browser |  |
| user32 | `KillTimer` | 2 | browser |  |
| user32 | `MessageBoxA` | 4 | browser |  |
| user32 | `MessageBoxW` | 4 | browser |  |
| user32 | `MoveWindow` | 6 | browser |  |
| user32 | `OffsetRect` | 3 | emulated |  |
| user32 | `OpenClipboard` | 1 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `PtInRect` | 3 | emulated | POINT is passed by value as two 32-bit arguments. |
| user32 | `RedrawWindow` | 4 | browser |  |
| user32 | `ReleaseDC` | 2 | browser |  |
| user32 | `RemovePropA` | 2 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `RemovePropW` | 2 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `ScreenToClient` | 2 | browser |  |
| user32 | `SendMessageA` | 4 | browser |  |
| user32 | `SendMessageW` | 4 | browser |  |
| user32 | `SetClipboardData` | 2 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `SetFocus` | 1 | browser |  |
| user32 | `SetForegroundWindow` | 1 | browser | Activates only an app-local window, not the OS browser window. |
| user32 | `SetPropA` | 3 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `SetPropW` | 3 | emulated | Process-private atom names and registered application windows only. Names are case-insensitive; property data is borrowed, never freed by this API. |
| user32 | `SetRect` | 5 | emulated |  |
| user32 | `SetRectEmpty` | 1 | emulated |  |
| user32 | `SetTimer` | 4 | browser | Browser timers are throttled in background tabs; callbacks are coalesced. |
| user32 | `SetWindowLongA` | 3 | browser |  |
| user32 | `SetWindowLongW` | 3 | browser |  |
| user32 | `SetWindowPos` | 7 | browser | App-local position and CSS stacking; no desktop topmost guarantee. |
| user32 | `SetWindowRgn` | 3 | browser |  |
| user32 | `SetWindowTextA` | 2 | browser |  |
| user32 | `SetWindowTextW` | 2 | browser |  |
| user32 | `ShowWindow` | 2 | browser |  |
| user32 | `UnionRect` | 3 | emulated |  |
| user32 | `UpdateWindow` | 1 | browser |  |
| user32 | `ValidateRect` | 2 | browser |  |
| user32 | `ValidateRgn` | 2 | browser |  |
| winmm | `timeGetTime` | 0 | browser | Process-relative monotonic browser time. |
