# Win32 browser export inventory

Version 0.4.0. 311 named exports, counting A/W variants and aliases.
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
| advapi32 | `RegEnumKeyExA` | 8 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegEnumKeyExW` | 8 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegOpenKeyExA` | 5 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegOpenKeyExW` | 5 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegQueryValueExA` | 6 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegQueryValueExW` | 6 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegSetValueExA` | 6 | emulated | Isolated application registry, not the operating-system registry. |
| advapi32 | `RegSetValueExW` | 6 | emulated | Isolated application registry, not the operating-system registry. |
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
| kernel32 | `CloseHandle` | 1 | emulated |  |
| kernel32 | `CopyFileA` | 3 | emulated |  |
| kernel32 | `CopyFileW` | 3 | emulated |  |
| kernel32 | `CopyMemory` | 3 | emulated |  |
| kernel32 | `CreateDirectoryA` | 2 | emulated |  |
| kernel32 | `CreateDirectoryW` | 2 | emulated |  |
| kernel32 | `CreateFileA` | 7 | emulated | Synchronous app-private disk. No device paths, native disk, overlapped I/O, or security descriptors. |
| kernel32 | `CreateFileW` | 7 | emulated | Synchronous app-private disk. No device paths, native disk, overlapped I/O, or security descriptors. |
| kernel32 | `DeleteFileA` | 1 | emulated |  |
| kernel32 | `DeleteFileW` | 1 | emulated |  |
| kernel32 | `FillMemory` | 3 | emulated |  |
| kernel32 | `GetCurrentDirectoryA` | 2 | emulated |  |
| kernel32 | `GetCurrentDirectoryW` | 2 | emulated |  |
| kernel32 | `GetEnvironmentVariableA` | 3 | emulated |  |
| kernel32 | `GetEnvironmentVariableW` | 3 | emulated |  |
| kernel32 | `GetFileAttributesA` | 1 | emulated |  |
| kernel32 | `GetFileAttributesW` | 1 | emulated |  |
| kernel32 | `GetFileSize` | 2 | emulated |  |
| kernel32 | `GetLastError` | 0 | emulated |  |
| kernel32 | `GetLocalTime` | 1 | emulated |  |
| kernel32 | `GetPrivateProfileIntA` | 4 | emulated |  |
| kernel32 | `GetPrivateProfileIntW` | 4 | emulated |  |
| kernel32 | `GetPrivateProfileStringA` | 6 | emulated |  |
| kernel32 | `GetPrivateProfileStringW` | 6 | emulated |  |
| kernel32 | `GetSystemTime` | 1 | emulated |  |
| kernel32 | `GetSystemTimeAsFileTime` | 1 | emulated |  |
| kernel32 | `GetTempPathA` | 2 | emulated | Path is in the application-private virtual filesystem. |
| kernel32 | `GetTempPathW` | 2 | emulated | Path is in the application-private virtual filesystem. |
| kernel32 | `GetTickCount` | 0 | browser | Elapsed milliseconds since this compatibility process was created, not host OS boot. |
| kernel32 | `GetTickCount64` | 0 | browser | JavaScript number; exact within the safe integer range. |
| kernel32 | `GlobalAlloc` | 2 | emulated |  |
| kernel32 | `GlobalFree` | 1 | emulated |  |
| kernel32 | `GlobalLock` | 1 | emulated |  |
| kernel32 | `GlobalSize` | 1 | emulated |  |
| kernel32 | `GlobalUnlock` | 1 | emulated |  |
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
| kernel32 | `QueryPerformanceCounter` | 1 | browser | Microsecond units; precision is limited by browser timer policy. |
| kernel32 | `QueryPerformanceFrequency` | 1 | emulated |  |
| kernel32 | `ReadFile` | 5 | emulated |  |
| kernel32 | `RemoveDirectoryA` | 1 | emulated |  |
| kernel32 | `RemoveDirectoryW` | 1 | emulated |  |
| kernel32 | `RtlFillMemory` | 3 | emulated |  |
| kernel32 | `RtlMoveMemory` | 3 | emulated |  |
| kernel32 | `RtlZeroMemory` | 2 | emulated |  |
| kernel32 | `SetCurrentDirectoryA` | 1 | emulated |  |
| kernel32 | `SetCurrentDirectoryW` | 1 | emulated |  |
| kernel32 | `SetEndOfFile` | 1 | emulated |  |
| kernel32 | `SetEnvironmentVariableA` | 2 | emulated |  |
| kernel32 | `SetEnvironmentVariableW` | 2 | emulated |  |
| kernel32 | `SetFilePointer` | 4 | emulated |  |
| kernel32 | `SetLastError` | 1 | emulated |  |
| kernel32 | `Sleep` | 1 | browser | Asynchronous cooperative delay; does not block the UI thread. |
| kernel32 | `WriteFile` | 5 | emulated |  |
| kernel32 | `WritePrivateProfileStringA` | 4 | emulated | Project-private INI files. Preserves unrelated lines; does not implement Windows registry IniFileMapping. |
| kernel32 | `WritePrivateProfileStringW` | 4 | emulated | Project-private INI files. Preserves unrelated lines; does not implement Windows registry IniFileMapping. |
| kernel32 | `ZeroMemory` | 2 | emulated |  |
| msimg32 | `AlphaBlend` | 11 | emulated | Packed BLENDFUNCTION; premultiplied 32-bit source alpha. |
| msimg32 | `TransparentBlt` | 11 | emulated | Color-key transfer; positive extents only. |
| shell32 | `ShellExecuteA` | 6 | browser | Only explicitly enabled http/https/mailto navigation; no executable launch. |
| shell32 | `ShellExecuteW` | 6 | browser | Only explicitly enabled http/https/mailto navigation; no executable launch. |
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
| user32 | `ScreenToClient` | 2 | browser |  |
| user32 | `SendMessageA` | 4 | browser |  |
| user32 | `SendMessageW` | 4 | browser |  |
| user32 | `SetClipboardData` | 2 | emulated | Application-private clipboard. Browser system clipboard requires explicit async synchronization and permission. |
| user32 | `SetFocus` | 1 | browser |  |
| user32 | `SetForegroundWindow` | 1 | browser | Activates only an app-local window, not the OS browser window. |
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
