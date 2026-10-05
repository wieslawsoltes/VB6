# GDI bitmaps and memory device contexts

Version 0.2.0 adds 41 named exports (211 total), including `msimg32` and its
`gdi32` aliases. This is a tested browser subset, not a native GDI implementation
or a promise that all flags and formats of an exported function work.

## Implemented surface

| Area | APIs and supported behavior |
| --- | --- |
| Memory DCs and objects | `CreateCompatibleDC`, `DeleteDC`, bitmap `SelectObject`/`DeleteObject`, `GetCurrentObject`, `GetObjectType`, `GetObjectA/W` |
| Bitmap allocation | `CreateBitmap`, `CreateCompatibleBitmap`, `CreateDIBSection`, `GetBitmapBits`, `SetBitmapBits`, `GetBitmapDimensionEx`, `SetBitmapDimensionEx` |
| DIB transfer | `GetDIBits`, `SetDIBits`, header queries and partial scan-line transfers, 24/32-bit BI_RGB conversion |
| Raster transfer | `BitBlt`, `StretchBlt`, `PatBlt`, `TransparentBlt`, `AlphaBlend`, `GdiTransparentBlt`, `GdiAlphaBlend`, `GdiFlush` |
| State and clipping | `SaveDC`, `RestoreDC`, `SetViewportOrgEx`, `OffsetViewportOrgEx`, `GetViewportOrgEx`, `GetMapMode`, `SetMapMode`, `IntersectClipRect`, `GetClipBox`, `PtVisible`, `SetStretchBltMode`, `GetStretchBltMode` |
| Pixel and state queries | `GetPixel`, `SetPixelV`, `GetCurrentPositionEx`, `GetTextColor`, `GetBkColor`, `GetBkMode`; existing pixel/line/rectangle/ellipse drawing now works in memory DCs |

The complete named-export count includes ANSI/Unicode aliases. Constants are
available through `WIN32_CONSTANTS`; importing the package alone requires no DOM.

## Storage and ownership

A new memory DC starts with a 1x1 monochrome default bitmap, not a full-size color
surface. Select a bitmap before drawing. `CreateCompatibleBitmap` inherits the
selected bitmap's format; a default memory DC therefore creates monochrome
bitmaps. A registered window DC creates a 32-bit color bitmap. Selecting a DIB
also propagates its true-color DIB format to a compatible bitmap.

Bitmaps can be selected into **one memory DC at a time**, never a window DC.
Selected bitmaps, pens and brushes cannot be deleted, including objects retained
by `SaveDC`. Restore/deselect them first. Deleting a memory DC releases its private
default bitmap and state stack, but **not** user-created bitmaps. `ReleaseDC`
releases a DC obtained from a window; `DeleteDC` releases a memory DC. Window
unregistration invalidates its window DCs; process disposal releases all storage.

`CreateDIBSection` exposes a stable virtual pointer through its `ppvBits` output.
The pointer remains valid until the bitmap is deleted or the process is disposed.
`GlobalFree` and `LocalFree` reject these owned pointers. Copying bytes directly
changes subsequent drawing/readback; the data is not an unrelated JS copy.

Supported bitmap formats are 1-bit monochrome DDBs and 24/32-bit true-color DDBs,
and **40-byte BITMAPINFOHEADER, 24/32-bit BI_RGB DIBs**. DIBs use DWORD-aligned
BGR/BGRA rows; a negative height requests top-down storage, a positive height
bottom-up storage. Native structure pointers are virtual 32-bit addresses even
when JavaScript runs on a 64-bit machine. `GetObject` returns BITMAP (24 bytes),
DIBSECTION (84 bytes), LOGPEN (16 bytes), or LOGBRUSH (12 bytes), not host ABI data.

`GetDIBits` and `SetDIBits` require an unselected bitmap and matching dimensions.
They support true-color format conversion, header queries, and a bounded range
of scan lines. Pixel buffers are validated before a transfer mutates memory.
Color tables, palette indexes, 16-bit/bitfield/compressed DIBs, V4/V5 color profiles,
file-mapped DIB sections, shared kernel handles and bitmap-resource loading are
not implemented; unsupported formats fail explicitly.

## Blits, clipping and alpha

The 15 implemented raster operations are `SRCCOPY`, `SRCPAINT`, `SRCAND`,
`SRCINVERT`, `SRCERASE`, `NOTSRCCOPY`, `NOTSRCERASE`, `MERGECOPY`, `MERGEPAINT`,
`PATCOPY`, `PATPAINT`, `PATINVERT`, `DSTINVERT`, `BLACKNESS`, and `WHITENESS`.
They evaluate the actual source/destination/solid-pattern Boolean operation.
Source-independent operations do not need a source DC. `PatBlt` rejects
source-dependent operations. Overlapping ordinary blits snapshot their source
before writing; alpha blending rejects overlapping rectangles on one surface.

`StretchBlt` implements nearest-neighbor `COLORONCOLOR` and signed-extent
mirroring. Select mode 3 explicitly before scaling. Other stretch filters and
mapping modes are not silently substituted: only `MM_TEXT` and a translated
viewport are supported. Bitmap coordinates and window GDI coordinates are CSS
pixels, independent of VB twips/ScaleMode; device-pixel-ratio scaling occurs only
at browser presentation. Only destination clipping applies to a blit. This
version requires the source rectangle to fit entirely within its source surface.

Rectangular clipping, current position, selected objects, colors, background
mode, viewport origin and stretch mode are saved/restored. Arbitrary regions,
world transforms, font objects and font metrics are not part of this release.
Memory-DC lines/rectangles/ellipses use bounded integer software rasterization;
native pen joins, pixel-exact ellipse edges and platform font rasterization are
not claimed. Text in a memory DC or software-clipped DC reports unsupported.

`TransparentBlt` applies a COLORREF key. `AlphaBlend` takes a packed 32-bit
BLENDFUNCTION: BlendOp=AC_SRC_OVER (0), BlendFlags=0, SourceConstantAlpha in bits
16..23, and AlphaFormat=0 or AC_SRC_ALPHA in bits 24..31. Per-pixel alpha requires
a **premultiplied 32-bit source bitmap**. Positive extents are required for both
operations; they use nearest-neighbor scaling. Alpha rounding may differ from
Windows by one channel value. GDI raster operations treat the high byte as
reserved except raw SRCCOPY/transparent copies and explicit alpha blending.

## Browser and VB6 use

The independent package accepts a window descriptor with a Canvas2D `context`,
or `getClientRect`, `readPixels(x,y,width,height)` and
`writePixels(x,y,{width,height,data})` adapters. Adapter pixel data is RGBA;
DIB storage remains BGR/BGRA. Window output is opaque. A tainted Canvas produces
access-denied rather than bypassing the browser's readback policy. Only explicitly
registered application surfaces are accessible, not the host desktop or screen.

In VB6 apps, forms, MDI forms and picture boxes expose a **read-only `hDC`** in
addition to `hWnd`. It is allocated lazily and stable while live; after explicit
`ReleaseDC`, the next property read obtains a fresh DC. Disposal/Stop invalidates
it. User-created memory DCs should still be explicitly deleted.

Open **Win32 API Workbench** and click **Bitmap blitting**. The example declares
BITMAPINFOHEADER, calls `CreateDIBSection`, copies a typed Long array into the
returned pointer with `RtlMoveMemory`, selects the bitmap into a memory DC, and
calls `StretchBlt` into `picCanvas.hDC`. It restores selections/state and frees
all transient resources. The same source is embedded in exported HTML apps.

The runtime's existing retained drawing surface supports raster readback and
ordered opaque patches. Surfaces receiving bitmap operations intentionally use
**Canvas2D**, identified as `Canvas2D · GDI bitmap`; this is not a claim of GPU
bitmap acceleration. Ordinary non-bitmap WebGPU/Canvas drawing remains on its
existing path. Repeated same-region frames coalesce; a full-surface opaque write
replaces prior commands. `Cls`/clear releases retained raster storage.

## Bounds and validation

Bitmap dimensions are at most 32,767 per axis and allocation is charged against
the process memory quota (32 MiB by default). Raster scratch operations are
limited to `maxRasterPixels` (default up to 4,194,304 pixels); invalid/out-of-range
buffers, formats and operations fail before mutation. Saved DC stacks are limited
to 256 states. Runtime window readback is limited to 4,194,304 pixels, individual
patches to 16 MiB, retained patches to 32 MiB and retained commands to 50,000.
Host code may configure the independent package's memory/pixel quotas explicitly.

The package suite covers raw layouts, ownership, failure rollback, scan-line
transfers, all 15 raster operations, overlap, alpha, clipping, and worker-safe
adapters. Compiler/VM tests exercise real VB declarations and pointer/UDT/array
marshalling. Browser CI checks displayed and read-back pixels, hDC lifecycle,
repeated frames and cleanup in the IDE and exported HTTP/file apps across
Chromium, Firefox and WebKit, plus global/ESM/worker package usage.

`tools/win32-gdi-oracle.ps1` and `tools/win32-gdi-contracts.mjs --compare` compare
a small deterministic set with actual installed Windows GDI. They do not run the
Microsoft VB6 compiler or certify all native GDI behavior. The alpha comparison
allows one channel value of rounding; other compared fields are exact.

Reference contracts: [CreateDIBSection](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createdibsection),
[CreateCompatibleDC](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createcompatibledc),
[SelectObject](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-selectobject),
[GetDIBits](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getdibits),
[GetObject](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getobject),
[BitBlt](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-bitblt),
[AlphaBlend](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-alphablend).
