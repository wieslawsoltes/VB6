# Native Form and PictureBox drawing surfaces

The direct Win32 AOT compiler lowers supported Form/PictureBox surface operations to ordinary IA-32 procedures and GDI calls. The compiler-owned VB service is compiled, not embedded as source or interpreted in the executable. This is independent of the HTML/Canvas/WebGPU runtime.

## Device-context ownership

`AutoRedraw = True` uses an owned memory HDC and a top-down 32-bit DIB. Repeated `hDC` reads preserve that HDC. A larger client area allocates and initializes a replacement bitmap, copies the existing pixels, and only then publishes the replacement. Allocation/copy failures release unpublished resources and preserve the original HDC, dimensions and bitmap. Shrinking does not discard previously drawn pixels outside the current client rectangle. Backing allocations are bounded to 16,384 pixels per axis and 67,108,864 pixels in total.

Non-retained drawing uses an HWND-owned private display DC. Active surface Forms have `CS_OWNDC`; active PictureBoxes use a private superclass of `STATIC`, not a modification of Windows' shared class. Calling `ReleaseDC` does not recycle a private DC or reset its attributes. The HWND owns that DC until destruction. The compiler releases memory DCs with `DeleteDC` and restores/destroys their owned bitmaps; it never calls `DeleteDC` on a window DC.

An application may draw using the returned HDC, but must not delete the borrowed DC/backing bitmap or leave replacement GDI objects selected. Restore application-owned `SaveDC` frames and selected objects before a resize, AutoRedraw transition or destruction. A native pointer/handle import is not sandboxed, and arbitrary misuse of the Win32 ABI is not made safe by source compilation.

## Current surface contract

`hDC`, `AutoRedraw`, `ScaleMode`, `ScaleWidth`, `ScaleHeight`, `CurrentX`, `CurrentY`, drawing-color/style properties and `Cls` are lowered. Scale modes are Twips (1) and Pixels (3); unsupported modes raise an explicit error. Cursor and client-size properties retain their Single result type and fractional cursor values. `Cls` restores the authored background and any assigned Picture and resets the cursor.

Retained presentation uses the current native client size. PictureBoxes participate in native owner drawing; Forms use `BeginPaint`/`EndPaint`. `WM_PRINTCLIENT` can render into another HDC. Copying/clearing temporarily normalizes the source DC's origin, mapping, transform and clip, then restores the caller's attributes. Every error path balances a successfully acquired paint/save frame. HWND destruction disposes backing resources before picture/font teardown. Repeated disposal is harmless.

Indexed receivers are resolved once, before evaluating operands. Their surface generation is captured. An operand that destroys/recreates the receiver is rejected before publishing a property update, even when the operating system reuses a handle. `With` retains the existing compiler's capture semantics.

## Primitives and text

The shared source parser recognizes `Line (x1,y1)-(x2,y2)`, optional `B`/`BF`, `Circle (x,y),radius`, and `PSet (x,y)` structurally. Nested coordinate calls, named arguments inside those calls, and indexed receivers are preserved. Graphics-looking text inside a quoted argument remains text. Each receiver and each operand evaluates once in authored order.

Native drawing uses GDI pens, solid/hatch/hollow brushes and the current raster-operation mode. Rectangular endpoints are normalized before GDI's exclusive lower/right adjustment. `PSet` retains its width and all sixteen two-input Boolean raster modes. Primitive success updates the logical Single cursor; invalid dimensions, failed allocation and stale receivers do not publish a cursor update. Temporary pens and brushes are restored/destroyed on error as well as success. GDI draw errors can leave partially rendered pixels, just as a native call can; a failed draw is not advertised as transactional raster output.

Surface `Print` uses counted Unicode `TextOutW`, the current HWND font, foreground color, transparent background and measured line advance. Explicit CR, LF and CRLF are handled without truncating at an embedded NUL. `TextWidth` and `TextHeight` query current native font metrics, follow Twips/Pixels, and return Single values. A mutable PictureBox font is re-read rather than retaining a deleted replacement HFONT. The native text scanner is bounded by the BSTR count and separately tested at the instruction level.

The currently admitted surface Print call grammar supports positional expressions and comma-separated print zones. General semicolon/Tab/Spc surface statement grammar, automatic line wrapping, full typographic/bidirectional text parity and the platform's long-text GDI limits are not certified by the simple Graphics Lab sample. File and Debug Print retain their separate existing lossless statement grammar. The implementation does not silently turn unsupported surface grammar into a different output statement.

This is not a claim of complete VB6 graphics, scaling, printing, Paint-event or object-lifetime parity. Other documented AOT boundaries remain errors. Native GDI behavior is distinct from browser graphics and is tested separately.

## Validation

`tests/win32-surface-lifetime.test.mjs` executes emitted IA-32 and real native error-frame transfers against explicitly mocked GDI APIs. It tests allocation, stable-handle growth, pixel preservation, state restoration, disposal, size limits and injected failures. These are not executions on Windows.

`tools/win32-surface-fixture.mjs` adds `AotControlSurfaces`; `tools/win32-surface-drawing-fixtures.mjs` adds `AotControlSurfaceGraphics` and `AotControlSurfaceText`; `tools/win32-surface-picture-fixture.mjs` checks decoded background ownership with `AotControlSurfacePicture` to the existing Windows driver at O0/O1/O2. Its independent `GetPixel`, `GetObjectType`, client-rectangle, viewport and GDI-resource observations test actual Windows behavior. The text fixture additionally compares every pixel against a separately drawn GDI `TextOutW` bitmap. A compiled fixture is not a passed execution; inspect its `execution.json` for the exact source revision before claiming acceptance. All previous fixture families, assertions, size limits and timeouts remain enabled.

Primary contracts: [private display DCs](https://learn.microsoft.com/windows/win32/gdi/private-display-device-contexts), [GetDC](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-getdc), [memory DCs](https://learn.microsoft.com/windows/win32/gdi/memory-device-contexts), and [SelectObject](https://learn.microsoft.com/windows/win32/api/wingdi/nf-wingdi-selectobject).


## Concurrent surface work and acceptance preservation

The implementation also retains the earlier PR107 surface acceptance family,
including all 19 original checks and its failure-only destruction diagnostics.
The independently developed lifetime family has a separate name,
`AotControlSurfaceLifetime`; it does not replace the original failing check.
The matrix now contains 31 families / 93 executables / 1,425 assertions.

Form and PictureBox Paint events are routed only after Load and only for
non-retained surfaces. A per-instance paint-depth counter avoids hDC-triggered
paint loops; an epoch check prevents callback destruction from decrementing a
recreated instance's state. WM_SETFONT updates a retained HDC synchronously before
the existing font owner deletes its prior HFONT. Mere repeated hDC reads or
backing growth do not replace a caller-selected font. Private drawing-kernel
names stay isolated from authored modules and lexical With blocks remain
distinct from UDT fields.

These changes have compiler and explicitly mocked IA-32 callback tests. The
new integrated source has not been executed on Windows here. In particular,
the earlier published branch's HWND-destruction assertion failed at every
optimization level. Its assertion and diagnostic are kept intact and require a
fresh Windows run; local compilation or mocked execution is not a claimed fix
for that observed native failure.
