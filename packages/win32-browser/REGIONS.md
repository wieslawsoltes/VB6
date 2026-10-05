# Regions, complex clipping and painting

Version 0.3.0 adds **20 Win32 exports**, bringing the independently generated
inventory to **231 names**, including ANSI/Unicode aliases in other families.
This is an implemented, bounded region subset, not full native GDI certification.
The same source is used in the IDE, runtime SDK, browser globals, workers and
single-file HTML apps. No native DLL execution or host desktop access is added.

## API surface

| Area | Exports |
| --- | --- |
| Construction and mutation | `CreateRectRgn`, `CreateRectRgnIndirect`, `SetRectRgn`, `CombineRgn`, `OffsetRgn` |
| Queries and interchange | `EqualRgn`, `GetRgnBox`, `PtInRegion`, `RectInRegion`, `GetRegionData`, `ExtCreateRegion` |
| Copied application clipping | `SelectClipRgn`, `ExtSelectClipRgn`, `GetClipRgn`, `ExcludeClipRect`, `OffsetClipRgn`, `RectVisible` |
| Painting | `FillRgn`, `PaintRgn`, `InvertRgn` |

Existing `IntersectClipRect`, `GetClipBox`, `PtVisible`, `SelectObject`,
`DeleteObject`, `GetObjectType`, `SaveDC`/`RestoreDC`, primitive drawing and bitmap
transfers are integrated with the region engine. `OBJ_REGION`, `RGN_AND`,
`RGN_OR`, `RGN_XOR`, `RGN_DIFF`, `RGN_COPY` and complexity constants are exported
through `WIN32_CONSTANTS`.

## Geometry and performance

Regions use frozen canonical y-bands containing sorted, disjoint half-open x
intervals. Equal adjacent bands coalesce. Boolean operations depend on edge
complexity rather than coordinate area; a rectangle millions of pixels wide
never allocates a corresponding bitmap. Point queries binary-search bands and
span endpoints. Rectangle intersection queries inspect relevant spans.

Region coordinates are signed 27-bit integers, from -67,108,864 to 67,108,863.
Right and bottom edges are excluded. Reversed rectangle edges are normalized.
Empty geometry has bounds `[0,0,0,0]`. Boolean modes are AND, OR, XOR, DIFF and
COPY. Destinations may alias either input. COPY ignores its second source handle.
Failures validate before publishing new state; existing destination geometry is
preserved on invalid modes, overflow and quota errors.

Each context defaults to `maxRegionRectangles: 4096` and
`maxRegionWork: 1048576`. Host code can configure limits at construction;
excessive operations fail with `ERROR_NOT_ENOUGH_MEMORY`, without rasterizing
large shapes or partially changing a destination. Actual paint scratch buffers
remain limited by `maxRasterPixels` and the existing bitmap quota.

The standalone geometry class is also available without creating a Win32 context:

```js
import { RegionStore } from '@vb6/win32-browser';
const regions = new RegionStore();
const outer = regions.rectangle(0, 0, 100, 100);
const hole = regions.rectangle(25, 25, 75, 75);
const frame = regions.combine(outer, hole, 4); // RGN_DIFF
console.log(regions.contains(frame, 10, 10)); // true
console.log(regions.contains(frame, 50, 50)); // false
```

## DC coordinates, snapshots and lifetimes

`SelectClipRgn` and `ExtSelectClipRgn` take **device-unit region coordinates**.
They copy immutable geometry; mutating or deleting the source HRGN does not
change the selected clip. `GetClipRgn` copies application geometry into an
existing region and returns 1, 0 for no application clip, or -1 on failure.
`SelectClipRgn(hdc, 0)` removes the application clip; it is not an empty region.
An empty but explicitly selected region suppresses drawing. The same distinction
is preserved by nested `SaveDC`/`RestoreDC` snapshots.

Region painting, rectangle clipping, `PtVisible`/`RectVisible` and `GetClipBox`
use logical coordinates with the supported MM_TEXT viewport translation.
Geometry stored in an application clip is kept separately from bitmap/window
visibility: moving a clip off-screen does not destroy its region data.
Intersecting an initially absent clip stores the full rectangle, including the
part outside the current bitmap. GDI rectangle-clip calls may conservatively
report COMPLEXREGION; `GetClipBox` reports precise effective visible complexity.
`OffsetClipRgn` reports stored application complexity, not only visible pixels.
These edge behaviors are checked against actual Windows GDI.

Pixels are CSS pixels at the application boundary, independent of VB twips and
browser device-pixel ratio. Presentation scales logical pixels; browser tests
check displayed pixels at both scale factors 1 and 2. Window regions do not grant
access to unregistered windows or the operating-system screen.

Complex clipping is honored by line/rectangle/ellipse/pixel drawing, all supported
blits, transparent/alpha transfers and region painting. Only destination clipping
applies to blits. `FillRgn` uses the supplied solid/null brush; `PaintRgn` uses the
selected brush; `InvertRgn` inverts the destination color channels. Memory-DC
pixels and window pixel adapters share the same implementation. Window rendering
continues to use the explicit Canvas2D bitmap fallback; GPU region acceleration
is not claimed.

## RGNDATA interchange

`GetRegionData` writes a 32-byte RGNDATAHEADER followed by 16-byte RECT entries,
all little-endian. Its null-buffer query returns the required byte size. Too-small
or invalid buffers fail before any output mutation. `ExtCreateRegion` validates
headers, declared sizes, counts, rectangle order, nonoverlapping bands and bounds
before allocating a region. It accepts this canonical rectangle-band layout;
arbitrary overlapping rectangle soups are rejected rather than normalized with
unbounded work. Identity and **integral translation** XFORMs are supported;
rotation, shear, scaling and fractional transforms fail explicitly.

VB6 `Declare` calls use existing typed buffer marshalling. The regression fixture
`tests/fixtures/win32-regions.bas` roundtrips a Byte array through RGNDATA, copies
bounds into a RECT UDT, checks `Err.LastDLLError`, and releases all handles and
transient declaration memory. The example's **Region clipping** button creates a
region with a hole, selects the clip, deletes its source handle, and paints through
that still-live copied clip with `PatBlt`.

## Validation and remaining boundaries

Independent tests cover all Boolean modes, aliased destinations, deterministic
randomized point-set comparisons, immutable snapshots, quota rollback, raw data,
clipped pixels, painting and cleanup. The extracted npm archive runs the same
package tests outside the repository. Compiler/VM integration tests use ordinary
VB source. Browser CI checks HTTP/file exports, classic IDE run/stop, ESM SDK,
global script, module workers, repeated repaints and displayed high-DPI pixels.
Local `VB6_OFFLINE=1` is explicitly partial and must not be used for release CI.

`tools/win32-region-oracle.ps1` records installed Windows GDI behavior;
`tools/win32-region-contracts.mjs --compare` requires exact equality, including
region bytes, clipping snapshots, statuses and painted RGB pixels. It includes
37 edge checks for absent, empty, off-screen and enclosing clips. A captured
native fixture also runs offline in the package suite. These measurements cover
only the listed contracts and do not certify untested region combinations or all
Windows versions. The existing bitmap comparison remains separate.

No elliptic, rounded-rectangle, polygon or path-to-region constructors, `FrameRgn`,
window-shape regions, update/paint-region lifecycle, arbitrary XFORMs, font parity,
or memory-DC text are implemented by this release. Unsupported exports/flags
fail explicitly. Region handles remain private to one compatibility context.
No native VB6 compiler certification or npm registry publication is performed.

Reference specifications: [region functions](https://learn.microsoft.com/en-us/windows/win32/gdi/region-functions),
[CreateRectRgn](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createrectrgn),
[SetRectRgn](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setrectrgn),
[SelectClipRgn](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-selectcliprgn),
[ExtSelectClipRgn](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-extselectcliprgn),
[GetRegionData](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getregiondata),
[ExtCreateRegion](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-extcreateregion).
