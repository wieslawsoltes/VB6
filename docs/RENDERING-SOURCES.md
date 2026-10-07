# Rendering and HTML performance sources

## Classic staircase bevels and attribution

Jordan Scales' comment at <https://news.ycombinator.com/item?id=49963404>
recommends inset shadows instead of four-color border joins for classic beveled
corners. The linked implementation and author's discussion are
<https://jdan.github.io/98.css/> and
<https://notes.jordanscales.com/98-css-reflections#when-buttons-were-good>.

`src/theme/bevels.css` adapts this technique to this project's authored controls.
Its source header preserves the full **Copyright 2020 Jordan Scales / MIT**
notice, also retained in `LICENSES/98.css.txt` and shipped CSS/standalone apps.
No third-party font files or unrelated 98.css components are included. Container
chrome uses equivalent border-box strips while retaining its original border
metrics: replacing a fractional-DPI border with nominal padding shifted WebKit
content. See `CLASSIC-HTML-RENDERING.md` for the exact tested scope.

The GPU adapter emits the supported solid background layers as ordered quads.
CSS background stacking, list repetition and percentage placement follow W3C
**CSS Backgrounds and Borders Level 3**:
<https://www.w3.org/TR/css-backgrounds-3/#layering> and
<https://www.w3.org/TR/css-backgrounds-3/#background-position>.
Unsupported background effects explicitly retain native paint.

## Read/write batching and stable HTML nodes

Jeremy Wagner, Paul Lewis and Barry Pollard, **Avoid large, complex layouts and
layout thrashing**, web.dev:
<https://web.dev/articles/avoid-large-complex-layouts-and-layout-thrashing>.

ToolList reads viewport geometry before DOM writes and retains visible rows and
SVG nodes instead of recreating them on every paint. The renderer batches
style-cache invalidation with frame construction and disconnects observers in
HTML-only mode, including a failed first draw. Source comments credit this
read-before-write guidance separately: the HN comment is about bevels, not list
performance. The benchmark compares the exact previous ToolList paint routine
with the retained implementation; it does not measure whole-IDE speed.

## WebGPU pixel coordinates and canvas texture lifetime

W3C GPU for the Web Community Group, **WebGPU**, editor's draft:
<https://gpuweb.github.io/gpuweb/#coordinate-systems> and
<https://gpuweb.github.io/gpuweb/#automatic-expiry-task-source>.

The two GPU painters clip at physical pixel centers. WebGPU readback is encoded
in the same command submission as its draw, using the same canvas texture before
its automatic expiry. Startup checks actual pixels, not just API availability.

## GPU test driver and presentation isolation

Jason Mayes and François Beaufort, **Supercharge Web AI testing**, Chrome for
Developers: <https://developer.chrome.com/blog/supercharge-web-ai-testing>.
The upstream vgpu investigation at <https://github.com/vercel-labs/vgpu/issues/109>
provided a coherent Vulkan compositor/ANGLE configuration for software WebGPU.

Driver flags are test-only and recorded in reports. WebGPU and WebGL2 are tested
in separate browser configurations because forcing the former's Vulkan
compositor can disable the latter. Each strict job must execute its required
backend and pass framebuffer/presentation checks without substituting a fallback.
SwiftShader CPU submission timings are not physical-GPU performance evidence.
The browser runner also accepts normal unforced adapters for hardware testing.

## CSSOM, scripted animation and timing APIs

`src/rendering/style-activity.js` is original code using the CSSWG CSSOM and W3C
Web Animations specifications, linked directly in its header. The subscription
layer preserves native object/Promise identity and restores descriptors on release.
`src/rendering/benchmark.js` and `webgpu.js` cite W3C WebGPU timestamp-query and
render-pass timestamp semantics. CPU submission and GPU pass timings are never
substituted for one another. No third-party implementation or font was imported.

## Runtime observation and measurement

CSSOM rule changes, observable adopted stylesheet arrays and Web Animations are
observed by original code in `src/rendering/style-activity.js`; native method
results, exceptions and object identities are preserved, with restoration on the
last subscriber release. References: https://drafts.csswg.org/cssom/ and
https://www.w3.org/TR/web-animations-1/. Closed shadow host treatment follows the
encapsulation contract in https://dom.spec.whatwg.org/#dom-element-attachshadow.
The local benchmark's optional GPU pass timestamps follow
https://www.w3.org/TR/webgpu/#timestamp-query and are not CPU-clock estimates.


## Native designer scrollbar paint

The classic designer's rectangular scrollbar strips and step arrows are original
code in `src/theme/bevels.css`, reusing its attributed bevel palette. Layer order,
size and placement follow CSS Backgrounds Level 3 (linked above); native scrollbar
parts are described in Chrome's [Scrollbar styling](https://developer.chrome.com/docs/css-ui/scrollbar-styling)
guide. The code leaves native scrolling and nonclassic/forced-color rendering
alone. These references explain the mechanism; they do not constitute a claim of
universal pixel or physical-GPU performance equivalence.
