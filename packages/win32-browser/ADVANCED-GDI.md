# Advanced GDI and window painting — 0.4.0

This release implements the previously unavailable API families in browser JavaScript. It does **not** promise every native GDI flag, every raster edge, or a Windows font mapper. The same modules run in the IDE, exported HTML, module workers and the independently installable package. The original classic IDE layout is unchanged.

## Curves, polygons and path regions

`CreateEllipticRgn[Indirect]`, `CreateRoundRectRgn`, `CreatePolygonRgn`, `CreatePolyPolygonRgn` and `FrameRgn` extend the immutable band engine. Polygon edges use bounded integer scan conversion with ALTERNATE/WINDING rules, negative coordinates, self-intersections and exact high-coordinate arithmetic. Regions do not allocate a bitmap proportional to coordinate area. Work/rectangle limits still apply and failed construction publishes no handle.

Curves use deterministic **analytic rasterization**. The Windows comparison distinguishes exact polygon contracts from curved-edge measurements. In the recorded 32-case Windows matrix, all 10 polygon cases matched, while 12 of 22 curve cases matched exactly and 10 differed. These differences are retained in `reports/win32-geometry/comparison.json`; neither curve API registration nor a green geometry workflow means native curve-pixel certification. No native or third-party curve implementation was copied into this MIT package.

Path APIs include Begin/End/AbortPath, CloseFigure, GetPath, FlattenPath, WidenPath, PathToRegion, SelectClipPath, FillPath, StrokePath and StrokeAndFillPath. Rectangle, Ellipse, MoveToEx, LineTo, Polygon/Polyline, PolyPolygon/PolyPolyline and PolyBezier/PolyBezierTo can build paths. PolylineTo/PolyBezierTo continue the current figure. Paths store device points; GetPath converts them using the current inverse transform. Paths are independent of SaveDC/RestoreDC. Successful render/conversion consumes the completed path; validation/quota failure preserves it.

Cubic paths flatten to a bounded 0.25-device-pixel flatness target (maximum 16 subdivisions). Solid-stroke widening uses bounded segment quads. Native cosmetic-pen joins, caps, miter rules, text-to-outline paths and all arc/path entry points are not certified or provided. Explicit point budgets prevent unbounded subdivision and stroke expansion.

## Affine and mapping transforms

Set/Get/ModifyWorldTransform, CombineTransform, Set/GetGraphicsMode, LPtoDP, DPtoLP, Window/Viewport origin and extent APIs, extent scaling and mapping modes MM_TEXT through MM_ANISOTROPIC are implemented. SetWorldTransform requires GM_ADVANCED; reset the world matrix before switching back to GM_COMPATIBLE. Singular/non-finite matrices fail without replacing the old state. The browser has a 96-logical-DPI mapping model. Isotropic mapping uses the smaller absolute scale. This is not a physical printer/display calibration API.

Region data accepts finite affine transforms, including rotations, reflection, shear, scale and fractional translation. Vertices round to integer region coordinates. Primitive/text/bitmap drawing applies the full mapping matrix, with inverse-sampled nearest-neighbor bitmap transfers and mandatory window/paint clipping. Rotated source blits are a browser extension, not a claim that native BitBlt accepts every transform. COLORONCOLOR remains the supported bitmap scaling policy; HALFTONE and palettized/compressed DIB formats are outside this increment.

## Logical fonts and real memory-DC text

CreateFontA/W, CreateFontIndirectA/W, LOGFONTA/W GetObject, stock-font selection, saved-state ownership and deletion are implemented. TextOutA/W, ExtTextOutA/W, GetTextExtentPoint[32]A/W, GetTextExtentExPointA/W, GetTextFaceA/W, GetTextMetricsA/W, text alignment/character-extra and DrawTextA/W now share a real Canvas font backend for **both window and memory DCs**.

The backend uses OffscreenCanvas when available, otherwise a DOM canvas, or `createWin32({createCanvas(width,height) {...}})`. Pure Node without a supplied Canvas implementation fails text rendering/measurement with ERROR_NOT_SUPPORTED rather than returning fabricated glyphs. Unicode uses the browser's font shaping and fallback; ANSI remains the package's documented Windows-1252 encoding. No system font files are shipped.

Font height/width, weight, italic, underline, strikeout and escapement feed the backend. Positive heights fit the requested cell height using measured browser metrics; negative heights specify the em size. Font metadata remains the requested logical font, and GetTextFace reports that request; browser font substitution may select another physical face. Separate glyph orientation, native charset mapping, OpenType glyph-index/outline APIs, font enumeration/install APIs and GDI hinting parity remain outside the Canvas contract. They are not inferred from CreateFont success.

Text supports opaque and clipped rectangles, baseline/top/bottom/left/center/right alignment, current-position updates even when fully clipped, RTL reading, explicit x or x/y advances, affine transforms and complex clip regions. Unsupported ETO flags (including ETO_GLYPH_INDEX) fail explicitly before changing pixels. Explicit per-character spacing can break complex shaping, just as the native API documentation cautions; natural whole-string rendering preserves browser shaping. DrawText supports common horizontal/vertical alignment, word wrapping, single-line conversion, expanded tabs and CALCRECT. Mnemonic markers are stripped (escaped ampersands are preserved); mnemonic underlining, ellipsis, edit-control, prefix-only and other extended DrawText options are not native-equivalent. Unsupported flags fail with ERROR_NOT_SUPPORTED.

Native text measurements additionally verify NUL-inclusive GetTextFace buffer counts, one character-extra advance per UTF-16 unit (including the final unit), empty extents, and vertically aligned DrawText return offsets. Real-browser tests check those font-independent contracts using actual Canvas metrics; the exact physical face and glyph metrics remain browser-dependent.

## Owned window shapes and painting

SetWindowRgn transfers region ownership on success and clips the actual registered DOM element (including browser hit testing). An explicit `setRegion(rectanglesOrNull)` adapter can replace DOM presentation; `allowVirtualRegion:true` deliberately enables geometry-only windows. Failed adapter validation retains caller ownership. Replacing/resetting/destroying the window releases owned regions. GetWindowRgn returns copied geometry; window and client coordinates are distinct, including dynamically resolved client offsets.

Invalidate/ValidateRect/Rgn, GetUpdateRect/Rgn, BeginPaint, EndPaint, UpdateWindow, RedrawWindow and a documented GetDCEx subset are implemented. Pending update regions union/subtract independently of active paint snapshots. BeginPaint writes a **32-bit 64-byte PAINTSTRUCT**, creates a paint DC and applies the snapshot as a non-removable clipping boundary. EndPaint matches the HDC (not the transient marshalling address) and preserves invalidations received during painting. Paint DCs require EndPaint, not ReleaseDC. No process-wide or desktop window operations are provided.

Registered window adapters can supply `requestPaint`, `requestNonClientPaint`, `eraseBackground`, `getBackgroundColor`, parent, and client-origin information. RedrawWindow recursively maps affected child update regions and honors cancellation/immediate/internal flags. Nonclient redraw requires an actual callback/message adapter and fails explicitly without it. Background erasing honors the active region; callbacks may invalidate additional areas without losing the new update. Runtime descriptors resolve hidden-control client sizes from layout properties so Form_Load invalidation is not discarded before the DOM becomes visible.

The browser VB interpreter queues Paint events to avoid reentering an awaited active VB frame. Consequently an in-VB UpdateWindow schedules the handler rather than recursively executing arbitrary VB statements synchronously. JavaScript host callbacks can be awaited. Native modal-loop reentrancy, all WM_NCPAINT/nonclient-HDC flags and exact Z-order/occlusion semantics are not claimed. GetDCEx currently accepts DCX_CACHE, DCX_INTERSECTRGN and DCX_EXCLUDERGN and consumes the supplied clipping handle when applicable.

## Reusable GPU presentation

The package exports `GPURasterPresenter`. Use `await GPURasterPresenter.create(device, format)` (or await an instance's `ready`) before rendering. It validates the shader and creates the pipeline asynchronously, caches one texture, uploads only changed revisions, performs device-pixel-correct sampling, replaces resized textures and deterministically destroys owned resources. It never destroys the caller's GPU device.

```js
import {GPURasterPresenter} from '@vb6/win32-browser';
const presenter = await GPURasterPresenter.create(device, format);
// context is configured with the same device/format. source is a readable canvas.
presenter.render(context, source, revision, canvas.width, canvas.height);
// On teardown:
presenter.dispose();
```

GraphicsSurface uses this shared presenter for retained GDI rasters and labels the actual backend `WebGPU · GDI texture`. Initialization failure, unavailable WebGPU, oversized device textures and device loss fall back to the explicitly labeled Canvas2D path. Clear/dispose releases GDI GPU resources. **Raster operations, region construction and font shaping are still CPU/browser work**; this release accelerates presentation, not all synchronous Win32 computation. The CI GPU job reads back actual rendered texels and validates an exported VB app; it does not represent a benchmark on every GPU/driver.

## Validation and authoritative references

The package's independent tests exercise ownership, budgets, transforms, curve/polygon/path construction and paint state. Real-browser tests check Unicode glyph pixels, high-DPI clipping, window hit testing, PAINTSTRUCT marshalling, exported examples and worker fonts. The live Windows oracle records both exact contracts and explicit raster differences. No optional licensed Microsoft VB6 compiler installation was added; its validation job remains conditional on the user's licensed environment.

Primary contracts: [SetWorldTransform](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-setworldtransform), [GetPath](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-getpath), [CreateFontW](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-createfontw), [SetTextCharacterExtra](https://learn.microsoft.com/en-us/windows/win32/api/wingdi/nf-wingdi-settextcharacterextra), [SetWindowRgn](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowrgn), [BeginPaint](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-beginpaint), [RedrawWindow](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-redrawwindow).

There is no npm registry publication in this change. `npm run pack:win32-browser` creates and independently validates an installable archive.
