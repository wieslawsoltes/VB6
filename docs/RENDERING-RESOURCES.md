# Rendering resource and fidelity contracts

This documents the reusable `src/rendering` layer. The default remains WebGPU
with WebGL2 and HTML fallbacks, and native browser text. Canvas2D remains an explicit backend/fallback choice.
The DOM remains the layout, input, focus, selection, IME and accessibility
source of truth. No DOM screenshot, font download or raster readback is used
by normal frame submission.

## Texture updates

`markTextureDirty(page, [x, y, width, height])` is exported by the ESM entry and
`VB6Rendering` browser bundle. Rectangles are positive integer **source pixels**
inside `page.width` and `page.height`. A page has a source `canvas`, dimensions
and a nonnegative safe-integer `revision`. Call the helper after changing its
pixels, then request a render; it does not schedule a frame itself.

```js
const page = {canvas: sourceCanvas, width: 256, height: 256, revision: 0};
const scene = new PaintScene(256, 256);
scene.add(scene.clip, [1, 1, 1, 1], {page});
scene.seal();
painter.render(scene);

sourceCanvas.getContext('2d').fillRect(10, 20, 12, 8);
markTextureDirty(page, [10, 20, 12, 8]);
painter.render(scene); // 384 texture bytes; no changed instance bytes.
```

Each painter owns its upload cursor. Sharing a page between windows/canvases
cannot consume another painter's pending changes. The bounded 64-change history
unions pending rectangles. A stale cursor, new source, changed size or revision
discontinuity forces a complete upload. Directly incrementing `revision` remains
compatible but cannot describe a partial update. Failed uploads do not advance
the cursor. Canvas2D draws the current source directly.

WebGPU uses `copyExternalImageToTexture` with source/destination origins. WebGL2
uses the DOM-source `texSubImage2D` overload and restores unpack skip state in a
`finally` block. No `getImageData`, staging canvas or per-frame GPU readback is
needed. Each RGBA upload is counted as four bytes per source pixel.

## Atlas lifetime

An atlas build is `begin()`, all `text(...)` requests, then `end()`. Submit that
build before beginning the next one. Reacquire glyph UVs for every new build;
old scenes must not be resubmitted after their atlas pages have been recycled,
compacted or reset. `UIRenderer` performs this lifecycle automatically.

Default storage is four 1024-square pages: 16 MiB of CPU RGBA pixels, plus GPU
copies in each painter using those pages. The configured steady-state pixel
budget is enforced. Compaction temporarily holds old and new CPU pages (up to
twice that budget); browser canvas/driver overhead is not included in the byte
counter. Pages touched in the current build are pinned. Only untouched pages
can be recycled. Pressure from fragmented, partly-live pages schedules one
additional demand frame and repacks live pixels between builds without shaping
those runs again. A genuinely over-budget all-live working set uses native text
without entering a compaction repaint loop.

Warm hits skip `measureText` and rasterization. Reset/dispose frees the retained
canvas backing stores and cache entries. `getStats()` exposes hits, misses,
measurements, page evictions, compactions, repacked entries, capacity misses,
pages, entries, allocated bytes and the configured budget. These are cumulative
atlas-lifetime counters, not a physical GPU memory measurement.

## Incremental geometry

The public instance layout remains 24 floats / 96 bytes. Sealed scenes compare
the exact fields encoded into GPU instances and upload only the changed
contiguous span. A one-command edit among 10,000 commands transfers 96 instance
bytes rather than 960,000. This is a byte-volume regression, not a claim of a
10,000-fold frame-time improvement: scene construction/comparison still costs
CPU time. Removing a tail or rebinding an otherwise identical texture page does
not require reuploading surviving instance data. Mutable scenes always repack;
new CPU/GPU storage and changed physical scales invalidate reuse.

Driver statistics separate `instanceUploadedBytes`, `textureUploadedBytes`,
`textureUploads` and `partialTextureUploads`. `uploadedBytes` retains their
combined workload meaning; uniform writes are not included. Startup WebGPU
verification is not counted as application workload.

## Text and paint fidelity

Optional atlas text supports Canvas-provided kerning, caps, stretch, text
rendering, letter spacing and word spacing only when the actual context exposes
the needed properties. Nonbreaking and intentional Unicode spaces are preserved.
Native text is retained for CSS case transforms, non-default OpenType/variation
rules without a Canvas equivalent, tab stops, justification, automatic hyphens,
contextual DOM-width disagreements, selection, transformed/multiline runs and
existing editor/IME cases. Unsupported does not mean invisible or approximated.

Opaque rounded boxes can keep GPU interiors, straight borders and descendant
painting. Small **native corner islands**, rather than analytic GPU curves,
preserve browser antialiasing. The corner resolver handles pixel/percentage
ellipses, CSS's common overlap factor, positive axis scaling, thick borders,
sharp outer shadows and rounded overflow. Native corners are cleared after
children so a child cannot refill an excluded corner.

Native paint bounds account for multiple shadow offsets, blur, spread and
outline offsets instead of assuming a four-pixel halo. Inherited positive scales
are included, and native text-shadow overflow is retained even when the glyph
layout rectangle itself lies outside the viewport. Unknown filter geometry
and rotated/perspective transforms conservatively preserve the enclosing clip.
The blur bound is intentionally conservative, not a reconstruction of the
browser's blur kernel.

Arbitrary CSS gradients/images, SVG/video/native controls, blur/compositing,
rotations, generated content and other unsupported paint continue through native
islands. The layer is not a replacement browser layout engine or a GPU-only CSS
implementation. `last.reasons`, `gpuRoundedBoxes`, `roundedCornerIslands`,
`gpuText` and `nativeText` explain the selected paths.

## Suspension, loss and verification

Direct/forced render requests do not measure or submit while hidden or printing.
Before print cancels queued work and hides the visual layer; after print clears
the retained frame and restores it through a fresh demand render. Canvas2D loss
now uses the same configured fallback hook as GPU loss; standalone CanvasPainter
also supports restoration notifications and idempotent listener cleanup.

A synchronous GPU frame failure invalidates its geometry and texture upload
cursors before returning the error. WebGL retries also allocate backing storage
again, because allocation errors are reported through `getError`, not JavaScript
exceptions. The normal successful-frame reuse path is unchanged. Direct
`UIRenderer.renderNow()` callers that catch an error can retry the same scene:
failed plans are not retained as already presented, and the failed overlay is
hidden so the semantic DOM remains visible. Asynchronous WebGPU validation and
device loss continue to use the existing fallback hook, not a per-frame wait.

Run `npm run build`, `npm run test:rendering`, and the normal repository tests.
`tools/browser-rendering-resources.py` is in the existing CI suites: Canvas2D in
Chromium/Firefox/WebKit and required WebGPU/WebGL2 in Chromium, the latter on
HTTP and file origins. It saves exact pixel comparisons and errors for shared
textures, single-instance updates, atlas churn, rounded overflow/shadows at four
DPRs, native text, print recovery, failed-frame retry and a simulated Canvas2D
loss event. Retry qualification injects a real WebGL invalid upload offset and
synthetic synchronous WebGPU/Canvas errors, then requires actual backend pixels
and renewed uploads; it does not claim to simulate asynchronous device loss. Simulated
loss is not a claim of physical device-loss testing; the existing real GPU
recovery suites remain in place. Software-driver qualification is not physical
GPU performance certification. No golden images, tolerances or existing cases
are removed by these additions.
