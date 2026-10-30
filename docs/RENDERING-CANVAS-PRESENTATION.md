# Retained Canvas2D workspace presentation

The retained document layer requests `willReadFrequently: true` on its **first**
Canvas2D context acquisition. This is the standard readback-optimization hint;
the browser may choose software storage. It is not a GPU synchronization API or
a guarantee of presentation. The layer does not perform readbacks, serialize the
canvas, reset its bitmap, recreate its painter, or submit unchanged frames to
make a screenshot pass. WebGPU and WebGL2 keep their existing selection policy.
Direct `CanvasPainter` / `createPainter` consumers and the isolated painter
benchmark keep `willReadFrequently: false` unless explicitly requested. The
`driver.readbackRequested` statistic describes the request, not a verified claim
about the browser's actual CPU/GPU allocation.

This targets a reproduced WebKit publication defect: after a workspace theme
change the retained scene and bitmap contained the new colors, while the
composited screenshot still showed old tiles. Resetting the bitmap or disabling
adjacent clip/fill-state reuse did not eliminate failures. The selected hint was
qualified without changing the original pixel equality assertions, rendering
backend, primitive order, or interaction deadlines. Software storage can cost
performance; this is a correctness fallback, not a claim of a speedup.

The comparison used product source `727f2bdbfb5000daad02b11334988cf7733c322d`:

- [Initial four-way comparison](https://github.com/wieslawsoltes/VB6/actions/runs/40851175099):
  the readback-context variant passed eight independent trials per HTTP/file
  origin. Other HTTP variants still failed at least one first-frame verdict.
- [Independent confirmation](https://github.com/wieslawsoltes/VB6/actions/runs/40852180007):
  three runners per variant/origin, eight trials each. The selected variant
  passed all **48 trials** (24 HTTP, 24 file); baseline HTTP failed **15 of 24**.
  Each trial preserved the original four alternating theme transactions. These
  are bounded observations, not proof that every WebKit/device combination is
  free of compositor defects. The diagnostic workflows remain off the PR branch.

`tools/figma-presentation-browser-tests.py` exercises the actual product path,
checks context settings and painter identity, compares composited pixels exactly,
and retains the separate no-idle-repaint check. Failure diagnostics remain
strictly post-verdict and cannot turn a failed frame into a successful result.

Specification: [Canvas readback optimization](https://html.spec.whatwg.org/multipage/canvas.html#concept-canvas-will-read-frequently).
