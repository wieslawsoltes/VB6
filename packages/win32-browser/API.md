# Win32 browser export inventory

Version 0.6.0. 461 named exports, counting ANSI/Unicode variants and aliases.
Parentheses give the number of 32-bit arguments; PtInRect expands a by-value POINT into two scalars.

Group headings identify the DLL and implementation mode. Export presence does not imply every native flag or behavior.
The public `createWin32().manifest()` also returns specific notes for each export.
See [README](README.md), [system services](SYSTEM-SERVICES.md), [common services](SERVICES.md),
[GDI](GDI.md), [regions](REGIONS.md), and [advanced GDI](ADVANCED-GDI.md) for contracts and boundaries.

## advapi32 / emulated

`RegCloseKey(1)`, `RegCreateKeyExA(9)`, `RegCreateKeyExW(9)`, `RegDeleteKeyA(2)`, `RegDeleteKeyW(2)`, `RegDeleteValueA(2)`, `RegDeleteValueW(2)`, `RegEnumKeyA(4)`, `RegEnumKeyExA(8)`, `RegEnumKeyExW(8)`, `RegEnumKeyW(4)`, `RegEnumValueA(8)`, `RegEnumValueW(8)`, `RegFlushKey(1)`, `RegOpenKeyExA(5)`, `RegOpenKeyExW(5)`, `RegQueryInfoKeyA(12)`, `RegQueryInfoKeyW(12)`, `RegQueryValueExA(6)`, `RegQueryValueExW(6)`, `RegSetValueExA(6)`, `RegSetValueExW(6)`

## crypt32 / emulated

`CryptBinaryToStringA(5)`, `CryptBinaryToStringW(5)`, `CryptStringToBinaryA(7)`, `CryptStringToBinaryW(7)`

## gdi32 / emulated

`AbortPath(1)`, `BeginPath(1)`, `BitBlt(9)`, `CloseFigure(1)`, `CombineRgn(4)`, `CombineTransform(3)`, `CreateBitmap(5)`, `CreateCompatibleBitmap(3)`, `CreateCompatibleDC(1)`, `CreateDIBSection(6)`, `CreateEllipticRgn(4)`, `CreateEllipticRgnIndirect(1)`, `CreateFontA(14)`, `CreateFontIndirectA(1)`, `CreateFontIndirectW(1)`, `CreateFontW(14)`, `CreatePen(3)`, `CreatePolygonRgn(3)`, `CreatePolyPolygonRgn(4)`, `CreateRectRgn(4)`, `CreateRectRgnIndirect(1)`, `CreateRoundRectRgn(6)`, `CreateSolidBrush(1)`, `DeleteDC(1)`, `DeleteObject(1)`, `DPtoLP(3)`, `Ellipse(5)`, `EndPath(1)`, `EqualRgn(2)`, `ExcludeClipRect(5)`, `ExtCreateRegion(3)`, `ExtSelectClipRgn(3)`, `FillPath(1)`, `FillRgn(3)`, `FlattenPath(1)`, `FrameRgn(5)`, `GdiAlphaBlend(11)`, `GdiFlush(0)`, `GdiTransparentBlt(11)`, `GetBitmapBits(3)`, `GetBitmapDimensionEx(2)`, `GetBkColor(1)`, `GetBkMode(1)`, `GetClipBox(2)`, `GetClipRgn(2)`, `GetCurrentObject(2)`, `GetCurrentPositionEx(2)`, `GetDeviceCaps(2)`, `GetDIBits(7)`, `GetGraphicsMode(1)`, `GetMapMode(1)`, `GetObjectA(3)`, `GetObjectType(1)`, `GetObjectW(3)`, `GetPath(4)`, `GetPixel(3)`, `GetPolyFillMode(1)`, `GetRegionData(3)`, `GetRgnBox(2)`, `GetStockObject(1)`, `GetStretchBltMode(1)`, `GetTextAlign(1)`, `GetTextCharacterExtra(1)`, `GetTextColor(1)`, `GetTextFaceA(3)`, `GetTextFaceW(3)`, `GetViewportExtEx(2)`, `GetViewportOrgEx(2)`, `GetWindowExtEx(2)`, `GetWindowOrgEx(2)`, `GetWorldTransform(2)`, `IntersectClipRect(5)`, `InvertRgn(2)`, `LineTo(3)`, `LPtoDP(3)`, `ModifyWorldTransform(3)`, `MoveToEx(4)`, `OffsetClipRgn(3)`, `OffsetRgn(3)`, `OffsetViewportOrgEx(4)`, `OffsetWindowOrgEx(4)`, `PaintRgn(2)`, `PatBlt(6)`, `PathToRegion(1)`, `PolyBezier(3)`, `PolyBezierTo(3)`, `Polygon(3)`, `Polyline(3)`, `PolylineTo(3)`, `PolyPolygon(4)`, `PolyPolyline(4)`, `PtInRegion(3)`, `PtVisible(3)`, `Rectangle(5)`, `RectInRegion(2)`, `RectVisible(2)`, `RestoreDC(2)`, `SaveDC(1)`, `ScaleViewportExtEx(6)`, `ScaleWindowExtEx(6)`, `SelectClipPath(2)`, `SelectClipRgn(2)`, `SelectObject(2)`, `SetBitmapBits(3)`, `SetBitmapDimensionEx(4)`, `SetBkColor(2)`, `SetBkMode(2)`, `SetDIBits(7)`, `SetGraphicsMode(2)`, `SetMapMode(2)`, `SetPixel(4)`, `SetPixelV(4)`, `SetPolyFillMode(2)`, `SetRectRgn(5)`, `SetStretchBltMode(2)`, `SetTextAlign(2)`, `SetTextCharacterExtra(2)`, `SetTextColor(2)`, `SetViewportExtEx(4)`, `SetViewportOrgEx(4)`, `SetWindowExtEx(4)`, `SetWindowOrgEx(4)`, `SetWorldTransform(2)`, `StretchBlt(11)`, `StrokeAndFillPath(1)`, `StrokePath(1)`, `WidenPath(1)`

## gdi32 / browser

`ExtTextOutA(8)`, `ExtTextOutW(8)`, `GetTextExtentExPointA(7)`, `GetTextExtentExPointW(7)`, `GetTextExtentPoint32A(4)`, `GetTextExtentPoint32W(4)`, `GetTextExtentPointA(4)`, `GetTextExtentPointW(4)`, `GetTextMetricsA(2)`, `GetTextMetricsW(2)`, `TextOutA(5)`, `TextOutW(5)`

## kernel32 / emulated

`CloseHandle(1)`, `CompareFileTime(2)`, `CopyFileA(3)`, `CopyFileW(3)`, `CopyMemory(3)`, `CreateDirectoryA(2)`, `CreateDirectoryW(2)`, `CreateEventA(4)`, `CreateEventW(4)`, `CreateFileA(7)`, `CreateFileW(7)`, `CreateSemaphoreA(4)`, `CreateSemaphoreW(4)`, `DeleteFileA(1)`, `DeleteFileW(1)`, `DosDateTimeToFileTime(3)`, `DuplicateHandle(7)`, `ExpandEnvironmentStringsA(3)`, `ExpandEnvironmentStringsW(3)`, `FileTimeToDosDateTime(3)`, `FileTimeToLocalFileTime(2)`, `FileTimeToSystemTime(2)`, `FillMemory(3)`, `FindClose(1)`, `FindFirstFileA(2)`, `FindFirstFileW(2)`, `FindNextFileA(2)`, `FindNextFileW(2)`, `FlushFileBuffers(1)`, `FormatMessageA(7)`, `FormatMessageW(7)`, `GetACP(0)`, `GetCurrentDirectoryA(2)`, `GetCurrentDirectoryW(2)`, `GetCurrentProcess(0)`, `GetDateFormatA(6)`, `GetDateFormatEx(7)`, `GetDateFormatW(6)`, `GetEnvironmentVariableA(3)`, `GetEnvironmentVariableW(3)`, `GetFileAttributesA(1)`, `GetFileAttributesExA(3)`, `GetFileAttributesExW(3)`, `GetFileAttributesW(1)`, `GetFileInformationByHandle(2)`, `GetFileSize(2)`, `GetFileSizeEx(2)`, `GetFileType(1)`, `GetFullPathNameA(4)`, `GetFullPathNameW(4)`, `GetLastError(0)`, `GetLocaleInfoA(4)`, `GetLocaleInfoEx(4)`, `GetLocaleInfoW(4)`, `GetLocalTime(1)`, `GetPrivateProfileIntA(4)`, `GetPrivateProfileIntW(4)`, `GetPrivateProfileSectionA(4)`, `GetPrivateProfileSectionNamesA(3)`, `GetPrivateProfileSectionNamesW(3)`, `GetPrivateProfileSectionW(4)`, `GetPrivateProfileStringA(6)`, `GetPrivateProfileStringW(6)`, `GetProfileIntA(3)`, `GetProfileIntW(3)`, `GetProfileSectionA(3)`, `GetProfileSectionW(3)`, `GetProfileStringA(5)`, `GetProfileStringW(5)`, `GetSystemDefaultLangID(0)`, `GetSystemDefaultLCID(0)`, `GetSystemDefaultLocaleName(2)`, `GetSystemTime(1)`, `GetSystemTimeAsFileTime(1)`, `GetSystemTimePreciseAsFileTime(1)`, `GetTempFileNameA(4)`, `GetTempFileNameW(4)`, `GetTempPathA(2)`, `GetTempPathW(2)`, `GetThreadLocale(0)`, `GetTimeFormatA(6)`, `GetTimeFormatEx(6)`, `GetTimeFormatW(6)`, `GetUserDefaultLangID(0)`, `GetUserDefaultLCID(0)`, `GetUserDefaultLocaleName(2)`, `GlobalAddAtomA(1)`, `GlobalAddAtomW(1)`, `GlobalAlloc(2)`, `GlobalDeleteAtom(1)`, `GlobalFindAtomA(1)`, `GlobalFindAtomW(1)`, `GlobalFree(1)`, `GlobalGetAtomNameA(3)`, `GlobalGetAtomNameW(3)`, `GlobalLock(1)`, `GlobalSize(1)`, `GlobalUnlock(1)`, `InterlockedAnd(2)`, `InterlockedCompareExchange(3)`, `InterlockedDecrement(1)`, `InterlockedExchange(2)`, `InterlockedExchangeAdd(2)`, `InterlockedIncrement(1)`, `InterlockedOr(2)`, `InterlockedXor(2)`, `IsValidCodePage(1)`, `IsValidLocale(2)`, `LCIDToLocaleName(4)`, `LocalAlloc(2)`, `LocaleNameToLCID(2)`, `LocalFileTimeToFileTime(2)`, `LocalFree(1)`, `LocalLock(1)`, `LocalSize(1)`, `LocalUnlock(1)`, `lstrcpyA(2)`, `lstrcpynA(3)`, `lstrcpynW(3)`, `lstrcpyW(2)`, `lstrlenA(1)`, `lstrlenW(1)`, `MoveFileA(2)`, `MoveFileW(2)`, `MoveMemory(3)`, `MulDiv(3)`, `MultiByteToWideChar(6)`, `OpenEventA(3)`, `OpenEventW(3)`, `OpenSemaphoreA(3)`, `OpenSemaphoreW(3)`, `QueryPerformanceFrequency(1)`, `ReadFile(5)`, `ReleaseSemaphore(3)`, `RemoveDirectoryA(1)`, `RemoveDirectoryW(1)`, `ResetEvent(1)`, `RtlFillMemory(3)`, `RtlMoveMemory(3)`, `RtlZeroMemory(2)`, `SetCurrentDirectoryA(1)`, `SetCurrentDirectoryW(1)`, `SetEndOfFile(1)`, `SetEnvironmentVariableA(2)`, `SetEnvironmentVariableW(2)`, `SetEvent(1)`, `SetFilePointer(4)`, `SetFilePointerEx(5)`, `SetLastError(1)`, `SetThreadLocale(1)`, `SystemTimeToFileTime(2)`, `WaitForMultipleObjects(4)`, `WaitForSingleObject(2)`, `WideCharToMultiByte(8)`, `WriteFile(5)`, `WritePrivateProfileSectionA(3)`, `WritePrivateProfileSectionW(3)`, `WritePrivateProfileStringA(4)`, `WritePrivateProfileStringW(4)`, `WriteProfileSectionA(2)`, `WriteProfileSectionW(2)`, `WriteProfileStringA(3)`, `WriteProfileStringW(3)`, `ZeroMemory(2)`

## kernel32 / browser

`GetTickCount(0)`, `GetTickCount64(0)`, `QueryPerformanceCounter(1)`, `Sleep(1)`

## msimg32 / emulated

`AlphaBlend(11)`, `TransparentBlt(11)`

## ole32 / emulated

`CLSIDFromString(2)`, `CoTaskMemAlloc(1)`, `CoTaskMemFree(1)`, `CoTaskMemRealloc(2)`, `IIDFromString(2)`, `StringFromGUID2(3)`

## ole32 / browser

`CoCreateGuid(1)`

## shell32 / browser

`ShellExecuteA(6)`, `ShellExecuteW(6)`

## shlwapi / emulated

`PathAddBackslashA(1)`, `PathAddBackslashW(1)`, `PathCanonicalizeA(2)`, `PathCanonicalizeW(2)`, `PathCombineA(3)`, `PathCombineW(3)`, `PathFileExistsA(1)`, `PathFileExistsW(1)`, `PathFindExtensionA(1)`, `PathFindExtensionW(1)`, `PathFindFileNameA(1)`, `PathFindFileNameW(1)`, `PathIsDirectoryA(1)`, `PathIsDirectoryW(1)`, `PathIsRelativeA(1)`, `PathIsRelativeW(1)`, `PathIsRootA(1)`, `PathIsRootW(1)`, `PathIsUNCA(1)`, `PathIsUNCW(1)`, `PathRemoveBackslashA(1)`, `PathRemoveBackslashW(1)`, `PathRemoveExtensionA(1)`, `PathRemoveExtensionW(1)`, `PathRenameExtensionA(2)`, `PathRenameExtensionW(2)`

## user32 / browser

`BeginPaint(2)`, `ClientToScreen(2)`, `DrawTextA(5)`, `DrawTextW(5)`, `EnableWindow(2)`, `EndPaint(2)`, `EnumWindows(2)`, `FindWindowA(2)`, `FindWindowExA(4)`, `FindWindowExW(4)`, `FindWindowW(2)`, `GetClassNameA(3)`, `GetClassNameW(3)`, `GetClientRect(2)`, `GetDC(1)`, `GetDCEx(3)`, `GetDlgCtrlID(1)`, `GetDlgItem(2)`, `GetFocus(0)`, `GetForegroundWindow(0)`, `GetParent(1)`, `GetSystemMetrics(1)`, `GetUpdateRect(3)`, `GetUpdateRgn(3)`, `GetWindowLongA(2)`, `GetWindowLongW(2)`, `GetWindowRect(2)`, `GetWindowRgn(2)`, `GetWindowRgnBox(2)`, `GetWindowTextA(3)`, `GetWindowTextLengthA(1)`, `GetWindowTextLengthW(1)`, `GetWindowTextW(3)`, `InvalidateRect(3)`, `InvalidateRgn(3)`, `IsChild(2)`, `IsWindow(1)`, `IsWindowEnabled(1)`, `IsWindowVisible(1)`, `KillTimer(2)`, `MessageBoxA(4)`, `MessageBoxW(4)`, `MoveWindow(6)`, `RedrawWindow(4)`, `ReleaseDC(2)`, `ScreenToClient(2)`, `SendMessageA(4)`, `SendMessageW(4)`, `SetFocus(1)`, `SetForegroundWindow(1)`, `SetTimer(4)`, `SetWindowLongA(3)`, `SetWindowLongW(3)`, `SetWindowPos(7)`, `SetWindowRgn(3)`, `SetWindowTextA(2)`, `SetWindowTextW(2)`, `ShowWindow(2)`, `UpdateWindow(1)`, `ValidateRect(2)`, `ValidateRgn(2)`

## user32 / emulated

`CloseClipboard(0)`, `CopyRect(2)`, `CountClipboardFormats(0)`, `EmptyClipboard(0)`, `EnumClipboardFormats(1)`, `EnumPropsExA(3)`, `EnumPropsExW(3)`, `EqualRect(2)`, `GetClipboardData(1)`, `GetClipboardOwner(0)`, `GetClipboardSequenceNumber(0)`, `GetOpenClipboardWindow(0)`, `GetPropA(2)`, `GetPropW(2)`, `InflateRect(3)`, `IntersectRect(3)`, `IsClipboardFormatAvailable(1)`, `IsRectEmpty(1)`, `OffsetRect(3)`, `OpenClipboard(1)`, `PtInRect(3)`, `RemovePropA(2)`, `RemovePropW(2)`, `SetClipboardData(2)`, `SetPropA(3)`, `SetPropW(3)`, `SetRect(5)`, `SetRectEmpty(1)`, `UnionRect(3)`

## winmm / browser

`timeGetTime(0)`
