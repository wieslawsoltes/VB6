# VB6 Compute — experimental optional backend

An independently built JavaScript package that compiles typed VB standard modules
into WGSL and executes them on WebGPU. It does **not** replace the existing VB6
JavaScript, browser-control, Electron, or Win32 runtimes. No GPU interpreter in
JavaScript and no Canvas2D/fragment-shader rasterization is hidden behind this API.

**This is not complete VB6 runtime compatibility.** Unsupported language and host
features fail compilation. The initial compiler supports Boolean, Byte, Integer,
Long and Single storage, fixed arrays (one to four dimensions), acyclic Sub and
Function calls, ByVal/ByRef aliases, named/optional arguments, branches, loops,
Select Case, static locals, structured runtime errors and an instruction budget.
Double is rejected by default. `precision: 'single'` explicitly permits f32
approximation and emits a warning; it is not Double precision or full VB6 numeric
certification. Programs have lane-private module state, **not** automatically
parallelized shared VB globals. Use explicit shared atomic operations for exchange.

## Build and standalone use

From the repository root:

```sh
node tools/build-compute.mjs
node --test tests/compute.test.mjs
python tools/compute-browser-tests.py
cd artifacts/vb6-compute
npm pack
```

The build produces `index.js` (ESM, no global pollution), `vb6-compute.js` (browser
`VB6Compute` global), a standalone `playground.html`, license and package metadata.
The package includes its frontend, has no external runtime imports or npm
dependencies, and does not require the IDE or repository to execute. Serve the
playground over HTTPS or localhost in a WebGPU-capable browser. Missing adapters
raise `GPU_UNAVAILABLE`; the package never silently falls back to CPU execution.
No npm publication is performed.

```js
import {compileCompute, ComputeDevice, ComputeProgram, ComputeRenderer}
  from './index.js';
const artifact = compileCompute(`
Option Explicit
Public count As Long
Sub Main()
  count = count + 1&
  ComputeClear RGB(24, 28, 40)
  ComputeRect 16!, 16!, 100!, 60!, RGB(255, 80, 40)
End Sub`);
const gpu = await ComputeDevice.request();
let program, renderer;
try {
  program = await ComputeProgram.create(gpu, artifact,
    {width: 640, height: 480, fuel: 100000, capacity: 256});
  renderer = await ComputeRenderer.create(gpu,
    {width: 640, height: 480, canvas: document.querySelector('canvas')});
  console.log(await program.run()); // typed globals, lane, VB error/line and steps
  await renderer.render(program);   // GPU commands go directly to GPU rendering
  await program.run({readback: false}); // persistent state, no CPU state transfer
  await renderer.render(program);
} finally {
  await renderer?.dispose();
  await program?.dispose();
  await gpu.dispose();
}
```

`compileCompute` accepts a source string or the existing project model, with
`entry`, `moduleName`, `workgroupSize`, `maxStateWords` and `precision` options.
`compileComputeIR` accepts the shared frontend's compiled program. Artifacts are
JSON-serializable and retain their storage ABI, globals and runtime source locations.

## Runtime and GPU memory

`ComputeProgram.create(gpu, artifact, options)` allocates state, draw commands and
shared words, validates device limits and compiles the WGSL. `count` is the number
of isolated invocations. `writeGlobal(name, value, lane)` supports scalars and flat
fixed arrays (first dimension varies fastest). `readState`, `run`, `reset`,
`writeShared` and `readShared` are asynchronous and serialized across the device.
Caller input arrays are copied before queueing. Integer host writes must already
be in range; GPU conversions implement explicit checked narrowing and ties-to-even.

Supply `sharedBuffer` and `sharedWords` to chain kernels without readback. The
buffer remains caller-owned and must have STORAGE usage. Host writes/reset need
COPY_DST; readback needs COPY_SRC. Default `reset()` does not erase caller-owned
shared memory. `reset({clearShared:true})` explicitly opts into clearing it.

Intrinsic functions:

- Invocation: `ComputeIndex`, `ComputeCount`, `ComputeLocalIndex`,
  `ComputeGroupIndex`, `ComputeGroupCount`, `ComputeWorkgroupSize`,
  `ComputeWidth`, `ComputeHeight`, `ComputeTime`, `ComputeSharedLength`.
- Shared words: `ComputeLoadLong/Single`, `ComputeStoreLong/Single`,
  `ComputeAtomicAdd/Sub/Exchange/And/Or/Xor/CompareExchange`.
- f32 math: `ComputeSin/Cos/Tan/Atan/Sqrt/Exp/Log/Min/Max`.
- GPU scene output: `ComputeClear(color)`, `ComputeRect(x,y,w,h,color)`,
  `ComputeLine(x1,y1,x2,y2,width,color)`, `ComputeCircle(x,y,radius,color)`.

Atomic operations are explicit 32-bit word operations with wraparound, not VB's
checked scalar arithmetic. CompareExchange returns the previous value. Independent
lanes have no implicit global barrier. Use separate dispatches or a raw WGSL kernel
for inter-workgroup algorithms. Limits are checked before allocation; the default
per-lane fuel is 100,000 and total dispatch fuel is capped at 50 million. Fatal fuel
and draw-capacity faults cannot be swallowed by `On Error`. `run({readback:false})`
submits work but does not return runtime error cells; inspect `readState()` when
needed. The renderer skips failed lanes, rather than presenting partial commands.

`ComputeKernel.create(gpu, {code, entryPoint, constants, layout})` exposes arbitrary
WGSL compute shaders with inferred or explicit WebGPU layouts. `bind(index,
entries, {dynamicOffsets})`, `dispatch(x,y,z)` and `dispatchIndirect(buffer,offset)`
cover host binding and dispatch. Raw kernels can use workgroup memory, barriers,
textures and atomics directly, subject to WebGPU validation. GPUDevice is available
as `gpu.device` for advanced resource/query creation. Features must be requested
explicitly through `ComputeDevice.request({requiredFeatures,requiredLimits})`.

## Compute rendering and Vello research

This implementation was informed by the **original compute-centric Vello research
renderer**, not the newer CPU-preprocessed Sparse Strips GPU renderer:

- https://github.com/linebender/vello#vello-compute-renderer
- https://github.com/linebender/vello/tree/main/research
- https://www.w3.org/TR/WGSL/
- https://www.w3.org/TR/webgpu/

The code is an original JavaScript/WGSL implementation, not a Rust Vello port,
not Vello API parity and not a claim of matching Vello's performance or quality.
Its stages are encoded curves/commands → compute curve flattening → compute
transformed bounds → ordered 16×16 tile bins → compute coverage/compositing into
an RGBA8 storage texture → texture copy to the canvas. There is no render pipeline.

`ComputeScene` encodes rectangles, circles, round-segment strokes, straight lines,
quadratic/cubic paths, nonzero/even-odd fills, solid/linear-gradient paints, affine
transforms, alpha and rectangular device clips. `ComputePath` provides `moveTo`,
`lineTo`, `quadraticCurveTo`, `bezierCurveTo`, `closePath`. `scene.path(path, paint,
{fill:false,strokeWidth:2})` strokes without implicitly closing open subpaths.
RGBA color channels are in [0,1]. `readPixels()` returns premultiplied RGBA bytes.

Curves currently use fixed **32-edge subdivision** and rasterization uses **1 or
4 samples per pixel**, with round segment caps/joins rather than a full stroke
style model. Tile-list overflow takes a correct ordered fallback scan rather than
dropping commands. Scene/resource limits are explicit, but this is not yet a
production sparse-strip renderer or a performance-certified backend.

## Compatibility still outside this backend

Strings, tagged Variants, Currency/Decimal, exact Double emulation, Date/locale
semantics, recursive calls, dynamic/ReDim arrays, UDT/object/class lifetimes,
COM/OCX/Declare, filesystem/network/DOM services, full forms/controls/event runtime,
text shaping/font parsing, image paints, advanced clipping/blending and IDE debugger
integration are not implemented in GPU compute. Such services are not silently
executed through the existing runtime. Classic graphics syntax follows the current
shared frontend's supported syntax; the explicit Compute drawing intrinsics avoid
its legacy graphics parser limitations. Full application migration requires these
remaining features; existing backends continue to be the compatible path.

Browser tests must obtain a real WebGPU adapter and validate numeric readbacks and
rendered pixels. A software GPU adapter demonstrates shader execution and API
correctness, not physical GPU speed or cross-vendor certification.
