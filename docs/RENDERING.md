# UI rendering backends

## Status and scope

The UI renderer is a **hybrid DOM/GPU implementation**. Supported classic
backgrounds, solid border edges, axis-aligned gradients, zero-blur shadows and
classic staircase background layers become clipped instanced GPU quads. Eligible
text can use a cached browser-shaped atlas. This is not an HTML screenshot,
`foreignObject` snapshot or full-screen bitmap uploaded every frame.

The DOM remains the layout, input, accessibility and editing authority. Native
text is the default. Inputs, selection/IME, the code editor, SVG icons, pictures,
tables, existing graphics canvases, focus outlines and unsupported CSS remain
native. Transparent holes expose those browser pixels; fractional border strips
retain native rasterization where CSS and GPU rounding differ. GPU-atlas text is
experimental, not a substitute for native editing.

Acceptance checks compare the selected renderer with fixed HTML references.
Revision-specific results belong in CI artifacts and the pull request. **These
checks do not certify complete native VB6 parity, GPU-only rendering, physical-
device performance or a whole-IDE speedup.** See [source attribution](RENDERING-SOURCES.md)
for implementation references; each change must pass the current-source gates below.

## Classic Options dialog

Open **Tools → Options → Rendering**. WebGPU is the preferred default in this
release; HTML/CSS remains selectable. The first and second fallback
selectors define an ordered list. Duplicate entries and the preferred backend
are removed; HTML/CSS is always the final safety net. The default chain is:

```
WebGPU → WebGL2 → Canvas2D → HTML / CSS
```

Switching backends applies without reloading or recreating the project, editor,
controls or debugger. HTML removes the overlay and disconnects paint observation.
Cancel does not change the policy. Text and pixel-snapping choices are independent.
The status reports requested and active backends plus failed-attempt reasons;
it never labels a Canvas2D fallback as WebGPU.

IDE preferences use `vb6-studio-web.rendering.v1`; corrupt or denied storage does
not stop startup. **Use these settings in exported applications** explicitly
writes `project.settings.rendering` and participates in the Options undo
transaction. Otherwise the change is only an IDE preference. Exported apps
without an explicit policy prefer WebGPU with the default fallback chain.
General → Graphics still configures separate VB drawing surfaces.

## Runtime and window lifecycle

`ApplicationHost` retains a renderer for its owner document. Hosts in the same
document share one reference-counted renderer. Disposing one host does not remove
another's layer. `rendering: false` opts out of automatic retention. The first
host establishes policy; explicit `setOptions()` changes it for all document owners.

Standalone HTML embeds the same renderer with the runtime. The browser/Electron
IDE uses the same integration. Native Win32 AOT/GDI controls are not replaced.
Detached IDE documents have document-bound canvases, contexts and device
acquisition, inherit live policy changes, and release resources on reattach/close.
Renderer installation neither opens windows nor changes MDI settings.

Device/context loss advances through configured fallbacks. Each attempt uses a
new canvas because incompatible context types cannot share one. Generation checks
discard late startup results. Forced colors use HTML/CSS; printing hides the
overlay. Teardown and first-frame failure disconnect mutation/resize observers,
clear retained nodes/scenes, cancel callbacks and dispose buffers/textures without
destroying another renderer's shared WebGPU device.

## Reusable API

The dependency-free modules are exposed through `src/rendering/entry.js` and the
standalone `dist/vb6-rendering.js` global `VB6Rendering`. The DOM adapter has no
IDE or VB runtime dependency.

```js
const session = VB6Rendering.retainRenderer(document, {
  backend: 'webgpu',
  fallbacks: ['webgl2', 'canvas2d', 'html'],
  text: 'native',
  pixelSnap: true
});
await session.renderer.ready;
console.log(session.renderer.getStats());
await session.renderer.setOptions({ backend: 'html' });
session.release(); // Idempotent; last owner tears down the renderer.
```

`createPainter(backend, canvas)` and `PaintScene` support standalone non-DOM use.
Coordinates are CSS pixels and colors are unpremultiplied sRGB. Rectangles, clips,
two-color axis gradients and atlas regions produce premultiplied output.
`scene.native()` explicitly clears alpha for native islands; it is not a claim
that those pixels were GPU-painted. Low-level painters install no event loop.
`scene.seal()` creates an immutable geometry snapshot that painters can reuse.

Texture pages provide `canvas`, `width`, `height` and `revision`. Increment
`revision` after changing pixels within an existing source canvas. Replacing the
source canvas or changing its dimensions also invalidates the texture upload.
Image-only changes preserve retained geometry and draw-batch caches.

## Resolution, invalidation and retention

Backing stores use the actual device pixel ratio, including fractional scaling
and DPR 4, without arbitrary DPR-2/DPR-3 caps. Device limits or the 32-megapixel
allocation budget cause explicit fallback rather than silent downscaling.
Adjacent snapped edges share a rounded device boundary. Native holes round outwards
to preserve antialiased glyph edges.

Mutation/input/scroll/theme/font events coalesce into one pending animation-frame
callback. ResizeObserver tracks encountered elements and removes obsolete targets,
including when CSSOM geometry changes without an attribute mutation. CSS
transition/animation events wake rendering; while document animations are active,
styles are resampled and frames scheduled as needed. Rendering returns to idle
when they complete. CSSOM rule edits and programmatic animation APIs now wake rendering through
realm-scoped subscriptions which are removed in HTML mode. Pre-captured native
references and direct indexed adopted-sheet array edits require
`renderer.invalidateStyles()`. Observers preserve native return values, promises,
exceptions and declaration identity. The last subscriber restores only its own
wrappers, preserving later getter/setter changes made by another integration.
Closed shadow roots created before observation require `data-vb-native-render`
on their host; observed shadow hosts remain native-painted.

Each scene build is compared exactly with the retained immutable snapshot,
including command order, clips, colors, texture identities and dimensions. No
probabilistic hash or approximate tolerance decides equality. Identical geometry
reuses its snapshot, packed instances, GPU upload and compatible draw batches.
Unchanged pixels skip submission entirely. Image revisions/source replacements
are tracked separately. `renderer.renderNow({force: true})` explicitly submits
for diagnosis/measurement; ordinary `renderNow()` may skip unchanged output.

This avoids redundant uploads/submissions, not all DOM reads or scene construction.
Computed styles/parsed paints are cached. Buffers grow geometrically, consecutive
compatible primitives batch, and atlas pages/resources are bounded and released
when unused. Production frames do not wait on `queue.onSubmittedWorkDone()`.

`getStats()` reports requested/active backend, adapter, fallback attempts,
`frames` (actual submissions), `sceneBuilds`, `unchangedFrames`, native-island
counts, CPU scene-build/submission percentiles and allocation/upload/draw counters.
These are not GPU timestamps, presentation latency or FPS. An idle UI submitting
zero frames is expected, not evidence of a fixed fabricated FPS.

## Reproduction and acceptance

```
npm run build
npm test
npm run test:rendering:browser
python tools/browser-rendering-tests.py --require-webgpu --software-gpu
python tools/browser-rendering-tests.py --require-webgl2 --software-gpu
```

Tests require Python Playwright and Pillow. `CHROMIUM_PATH` selects the browser;
`--headed` enables a visible window (use Xvfb on Linux CI). Restricted local mode
may use `set_content` and reports unavailable GPUs as skipped. Strict mode serves
localhost and fails unless the selected API actually draws. Software-driver flags
are test-only, not production configuration or physical-device qualification.
The harness removes Playwright's default `--hide-scrollbars` switch so headless
runs verify real scrollbar gutters and interactions instead of omitting them;
this excluded default is recorded in the report.

The rendering jobs in the existing **Validate** workflow test WebGPU and WebGL2
in headed and headless configurations; **Pages** remains the deployment workflow. It covers direct framebuffer readback, presentation screenshots,
exact primitive/clip/texture pixels at DPR 1/1.25/1.5/2/3/4 and exact existing-HTML
IDE comparisons at DPR 1/1.25/1.5/2. **The IDE fixture gate requires zero changed
pixels**, not an error budget. Other cases cover Options behavior, fallback/loss,
startup races, ownership, resize/animation/idle cleanup, retained image replacement
and isolated forced-IDE/10,000-quad CPU workloads. Reports are in `reports/rendering`.

The user's full target additionally needs approved native VB6/control-state
references, representative physical desktop/mobile measurements against HTML/CSS,
and completion of the remaining GPU-painted surfaces. Passing these bounded
fixtures must not be described as universal pixel-perfect or GPU-only rendering.

## Local measurement

The Rendering tab offers **Measure Rendering**, cancellation and **Save Report**.
`VB6Rendering.benchmarkRendering(document, {frames:30, quads:10000, signal})`
returns bounded per-backend CPU submission samples, actual adapter identity and
optional WebGPU render-pass timestamps, leaving project/preferences/DOM unchanged.
No normal frame pays the cost of diagnostic queries or readbacks. This is not an
HTML compositor comparison or a whole-IDE performance certification.

## Deferred resize registration and presentation readiness

`renderNow()` may run synchronously inside a caller's ResizeObserver callback.
It paints immediately but defers registration of newly encountered elements to
one owning-window task after resize delivery, not a microtask inside that loop.
The task snapshots the latest targets, unobserves departed nodes and avoids work
for identical sets. Task identity plus backend generation reject stale callbacks.
HTML mode, first-frame failure and disposal cancel the task and clear references.
MDI resize callbacks similarly coalesce into an owning-window animation frame;
explicit reflow cancels a pending frame. Valid callback handle zero is cancellable.

A resolved renderer/options promise confirms paint submission, not operating-
system presentation. Screenshot tests therefore capture each backend independently
until three consecutive frames are identical, with a bounded attempt limit. The
fixed HTML reference is never replaced with renderer output. A stable wrong image
and an image that never stabilizes both fail; do not mask pixels, accept a tolerance,
or retry comparison until an expected image appears. The capture/comparator unit
tests independently cover stability, sparse changes and backend identity.

Persisted pagehide suspends rather than releases Studio ownership; final pagehide
releases it. Detached documents own their contexts and receive live settings.
The native runtime-document loader chooses registered-URL navigation before
assigning a source; it rejects stale asynchronous replies without weakening iframe
sandbox, CSP or native-bridge permissions. See [preview lifecycle](NATIVE-PREVIEW-LIFECYCLE.md).

## Extending and testing the renderer

Keep same-backend no-op settings from resetting the atlas or resubmitting unchanged
pixels. Changed text/snapping settings must submit updated paint before their
promise resolves. Textures separately track source identity, dimensions and revision;
replacing a canvas at the same dimensions must not retain stale pixels or repack
unchanged geometry. Duplicate hover notifications with an unchanged target do not
invalidate paint, but application event delivery is never intercepted.

Focused checks remain available in `tests/rendering-*.test.mjs` and the browser
harness. Run `python tools/test_rendering_pixels.py` and
`python tools/test_rendering_capture.py`, then the required backend suite and
`python tools/verify-rendering-report.py reports/rendering/report.json --backend webgpu`
(or `webgl2`). Unavailable backends may be explicit skips only in restricted local
runs, not required-backend CI. Keep every distinct case in the report validator.
The required suite includes control states, input selection, fractional DPI,
optional themes, mobile viewports, detached ownership, startup/loss recovery,
standalone execution, resize/animation wakeups and retained-resource checks.

Source-only builds use reviewed output sizes and SHA-256 fingerprints. CI verifies
these expectations and does not refresh them. Regenerate them explicitly while
reviewing a source change, then repeat an ordinary build and require no differences.
See [build artifacts](IDE-BUILD-ARTIFACTS.md). Keep run-specific screenshots, native
adapter measurements and validation logs out of source documentation; retain them
as CI artifacts instead of creating dated continuation guides.


## Classic designer scrollbars

The designer keeps browser-native scrollbar mechanics. For a **classic-family
application canvas**, its thumb and button bevels are painted as opaque background
strips; the four directional arrows use four rectangular steps rather than
antialiased diagonal gradients. This changes only paint: dimensions, hit targets,
scroll extents, native wheel/button/drag behavior and project colors are retained.
Modern application-theme scrollbars are excluded. Operating-system forced colors
retain the existing native paint instead of depending on author background layers.

The dedicated scrollbar browser case checks actual gutter dimensions, native
wheel/button/thumb interaction, complete HTML-to-backend screenshot equality,
and the modern/forced-color exclusions. The optional-theme case separately checks
all current theme paths, including legacy X11 migration. A stable CSS-only scene
is a prerequisite for comparison, not evidence that the overlay painted native
scrollbar pixels. Keep the native-island distinction in reports.

The strip construction and its CSS background-layer references are documented
beside the implementation in `src/theme/bevels.css`. It reuses the attributed
classic bevel colors without adding font assets, DOM nodes or a JavaScript scroll
implementation. Recheck platform/browser coverage after changes to native chrome;
software-adapter evidence cannot certify every operating-system rasterizer.
