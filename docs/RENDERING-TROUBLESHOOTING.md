# GPU startup and recovery

See [renderer architecture and scope](RENDERING.md) for the hybrid DOM/GPU contract.

## When WebGPU falls back

Open **Tools → Options → Rendering**. **Current renderer** updates while the
backend initializes, succeeds or falls back. The preferred selector is a draft;
the status describes the saved policy and the renderer that is actually active.

**Retry Renderer** rechecks the saved backend order in the main and detached IDE
windows. It does not apply draft options, write preferences, edit the project or
change exported-application settings. Closing Options during a retry removes its
status listeners; renderer recovery may still finish independently.

**Save Diagnostics...** downloads a local JSON report with secure-context/API
availability, attempted backends and their nested adapter/context errors, current
adapter details when exposed, and recovery advice. It does not probe additional
GPU contexts or include project contents, credentials or the page URL. **Save
Report...** under Local measurement remains the separate timing report.

A null WebGPU adapter and unavailable WebGL2 context do not identify one definite
cause. Check HTTPS or localhost, browser graphics acceleration and browser/OS/GPU
driver support. Chromium exposes detailed feature and process failures at
`chrome://gpu` (Edge: `edge://gpu`). Changes to browser graphics settings may
require a browser restart. The page cannot enable a disabled or blocklisted GPU.
Do not use the test harness's software-driver/unsafe flags as production advice.

## Browser reports `GL_VENDOR = Disabled`, `GL_RENDERER = Disabled`

These specific Chromium fields identify a disabled GL implementation, not a UI
shader compilation error. A generic `BindToCurrentSequence failed` or null
WebGPU adapter alone does not establish that diagnosis. Changing power hints
cannot turn on a disabled browser implementation, so repeated WebGL2 hints stop
when both explicit fields are present.

In Chrome, open `chrome://settings/system` (Edge: `edge://settings/system`), enable
**Use graphics acceleration when available**, save your work and relaunch the
browser. If the setting is already enabled or controlled by an administrator,
inspect `chrome://gpu` / `edge://gpu` and browser policy for driver, blocklist,
command-line or GPU-process failures. This web page cannot change those settings.
Browser-internal addresses must be copied into the address bar; a web link or
an in-page “Enable GPU” button cannot perform this repair.

Run **Measure Rendering**, then **Save Diagnostics...**. The report now includes
the saved policy/candidate order and the latest separate, timestamped measurement
from this IDE session. A WebGL2 failure in the measurement is retained even when
WebGL2 was omitted from the saved renderer order. The diagnosis labels whether
its evidence came from the live renderer or the last measurement. A subsequently
working live GPU takes precedence over earlier measurement failures. Saving the
report performs no additional GPU probes and sends no information to a server.

A successful Canvas2D measurement does not make Canvas2D the active renderer.
**Restore Default Backends** edits only the draft backend selectors; **OK** applies
WebGPU → WebGL2 → Canvas2D → HTML / CSS and **Cancel** preserves the saved order.
Text, snapping and exported-application options are not changed by this button.
An explicit GPU-only order still falls back to HTML safely; it is not silently
replaced. Current-frame geometry and timing summaries are empty/zero in HTML
mode instead of showing stale values from a previous canvas backend. Frame
counters remain explicitly labelled as renderer-lifetime totals.

## Canvas2D fallback work

The fallback reuses clipping and solid-fill state only for adjacent commands
with identical state. It does not reorder paints, combine paths or remove any
draws. A 10,000-quad scene with one clip/color needs one clip setup and one fill
assignment, rather than 10,000 of each. Gradients (including equal endpoints),
alpha, transparent holes, image revisions and fractional-DPI clipping retain
their original raster operations. Exceptions restore the saved clipping state.
`clipChanges` and `fillStyleChanges` report per-frame state changes, not GPU time.

## Stray tool-result labels or torn text in the coding-agent view

Closed tool-result disclosures must not contribute any GPU paint or native
clear rectangles. Chromium can return nonzero element and text-range geometry
for their hidden bodies: a nonempty rectangle is not evidence that content is
painted. Traversing those bodies produced stray **Arguments** / **Result** labels
and strips through later messages, especially with the optional GPU text atlas.

The scene adapter now visits only the first direct `summary` of closed `details`
and reads the current `open` state before using cached child order. Its native
overflow-bounds walk follows the same paint tree, so a themed/rounded ancestor
cannot expose hidden results or spend its bounds budget on thousands of hidden
nodes. `content-visibility:hidden` boxes retain their own paint, not their child
paint. Open tool bodies still use the selected renderer. Disclosure headings,
markers and the synthesized default summary remain browser-painted native
islands; keyboard expansion, selection and input stay on the original DOM.

After updating, reload the IDE (save/export the current project and transcript
first; agent task history is memory-only). WebGPU can remain selected. This is
a scene-visibility fix, not a browser GPU-driver or font-setting workaround.

The regression harness mounts the actual `AgentThreadView` and `AgentThread` with
synthetic public events, without contacting a provider or editing a project:

```sh
python tools/browser-rendering-agent-thread.py --require-webgpu --software-gpu
python tools/browser-rendering-agent-thread.py --require-webgl2 --software-gpu
python tools/browser-rendering-agent-thread.py --offline
```

The dedicated **Agent transcript rendering** workflow checks both GPU backends
in headed and headless Chromium, using native and atlas text at 100%, 125%, 150%
and 200% pixel ratios. It covers scrolling, narrow reflow, live streaming, retained
reader position, Jump to latest, pointer/keyboard and synchronous disclosure
changes, and nested large results inside native rounded ancestors. Removing and
restoring non-painted tool bodies must change zero displayed pixels, and a DOM
scene audit must record zero hidden geometry/text reads. Open and closed summary
pixels are compared with native HTML. Captures must stabilize independently of
the expected image; there are no pixel masks or widened tolerances. Reports and
screenshots are in `reports/rendering/agent-thread`. Required backends fail on
fallback, including with `--offline`. Software-driver execution is not physical
hardware certification; the existing full Validate matrix remains unchanged.

## Acquisition invariants

WebGPU tries high-performance, browser-default, low-power and finally a
browser-controlled compatibility request. Optional timestamp-query failure
reacquires an adapter without profiling. The requested texture extent is bounded
by the adapter's advertised limit and 16384; the existing 32-megapixel allocation
budget is unchanged. Output verification still rejects an unusable painter.

A shared per-window acquisition has a bounded lifetime. Timeout removes only
that cached operation; a late adapter cannot allocate a device and a late device
is destroyed without touching a newer shared device. A shorter consumer timeout
does not cancel another consumer's longer acquisition. WebGL2 retries only power
hints, preserves context-creation errors and never changes the canvas API.

## Regression checks

Run `npm run build`, `npm run test:rendering`, and the existing full rendering
suite. Additional real-API recovery cases run in the existing Validate matrix:

```sh
python tools/browser-rendering-recovery.py --require-webgpu --software-gpu
python tools/browser-rendering-recovery.py --require-webgl2 --software-gpu
```

Add `--headed` for visible-window execution. Reports and screenshots are under
`reports/rendering/recovery`. The additional negative-browser suite runs with
browser GPU implementations disabled and compares Canvas2D pixels against an
independent one-command-at-a-time reference across seven pixel ratios:

```sh
python tools/browser-disabled-graphics.py
python tools/browser-disabled-graphics.py --headed
```

Its reports are under `reports/rendering/disabled`. These test-only disabling
flags do not ship. This negative suite does not replace the required-GPU cases. Required GPU runs fail rather than silently skip an
unavailable API. `--offline` inlines local bundles for restricted environments;
it does not waive a requested GPU requirement. Software-backed API execution is
correctness evidence, not physical-hardware performance certification.

References: [Chrome GPU troubleshooting](https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips),
[WebGPU compatibility requests](https://developer.chrome.com/blog/new-in-webgpu-146),
[WebGL context attributes](https://registry.khronos.org/webgl/specs/latest/1.0/#5.2).
