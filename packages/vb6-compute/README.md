# VB6 Compute 0.3 — optional experimental backend

A standalone JavaScript compiler, WebGPU runtime and compute-only renderer.
VB standard modules compile into WGSL. JavaScript schedules GPU work and collects
host events; it does not interpret the VB handlers or rasterize their pixels.
Existing IDE, JavaScript, browser-control, Electron and Win32 backends are unchanged.
This package is an explicit opt-in, **not complete VB6 runtime compatibility**.

## Build, compile and package

```sh
npm run build:compute
npm run test:compute
npm run test:compute:browser
npm run compile:compute -- sample.bas --out sample.wgsl
npm run compile:compute -- sample.bas --out sample.json
npm run compile:compute -- sample.bas --out sample.html
cd artifacts/vb6-compute
npm pack
```

The independently installable `@vb6/compute` archive contains `index.js` (ESM with
no global pollution), `vb6-compute.js` (the `VB6Compute` browser global), a Node CLI,
`playground.html`, `events.html`, `events.bas`, `strings.bas` and this guide. There are no external
runtime imports or npm dependencies. The build does not publish to npm. With the
package installed, `vb6-compute --help` lists the compiler options.

The CLI accepts `.bas`/`.vb` source, `.vb6web`/`.json` projects, or `-` for source
from standard input. Output formats are WGSL, JSON artifacts, and single-file HTML.
Repeated `--event load=Module1.Main --event pointerDown=Module1.OnPointer` bindings
produce an event application. Without events, WGSL/JSON compile a plain entry Sub;
HTML always compiles an application dispatcher. `--entry`, `--precision`,
`--max-call-depth`, `--max-string-length`, `--workgroup-size`,
`--dynamic-array-capacity` and the state,
framebuffer and fuel limits are explicit options. Existing output files require
`--force`; input/output aliases are rejected and source errors do not truncate
existing outputs. HTML exports escape titles and serialized data, embed their
runtime, and require no CDN or external resource.

Serve browser apps over HTTPS or localhost in a supported browser. No adapter
raises `GPU_UNAVAILABLE`; the package does not silently fall back to CPU execution.

## Compiler and numeric contract

`compileCompute(sourceOrProject, options)` uses the existing shared frontend;
`compileComputeIR(program, options)` accepts its compiled IR. Artifacts are JSON
serializable and contain WGSL, a versioned storage ABI, globals, array layouts,
procedure/source metadata and diagnostics. The entry is a parameterless Sub.

Supported scalar storage is Boolean, Byte, Integer, Long, Single and String. Numeric
operations include checked narrowing/arithmetic, division errors, ties-to-even
integer conversion and VB Boolean values. Use `&` Long and `!` Single literals
where their type matters. Strict mode rejects Double storage and operations that
require Double promotion. `precision: 'single'` explicitly replaces these with f32
and emits a warning; it is **not** exact Double emulation or VB6 numeric certification.

Subs and Functions support ByVal/ByRef, aliased variables, optional/named arguments,
return values, branches, loops, Select Case, static locals and error handlers.
Bounded direct/mutual recursion uses resumable private GPU frames and a flat
continuation dispatcher, avoiding recursive WGSL calls and exponential shader
inlining. `maxCallDepth` defaults to 16 (range 1–64); exhausted calls report VB error
28. `GoSub`/`Return`, computed `On ... GoTo/GoSub`, catchable user error codes,
`On Error` and `Resume` are supported. GoSub depth defaults to 64. Fuel exhaustion
and draw-capacity faults are fatal, not catchable ways to evade limits.

Fixed and dynamic typed arrays support one to four dimensions. `ReDim`,
`ReDim Preserve`, `Erase`, `LBound` and `UBound` execute on the GPU. Dynamic arrays
reserve a bounded capacity per declaration (`dynamicArrayCapacity`, default 256
cells); this is not an unbounded GPU heap. Preserve can resize only the final
dimension and cannot change lower bounds/rank. Invalid resizes preserve old state.
ByRef element aliases lock array shape during calls and release locks on error
unwinding. Fixed Erase retains bounds and zeros cells; dynamic Erase deallocates.

## GPU UTF-16 Strings

Variable-length and fixed-length (`As String * N`) Strings now execute in WGSL.
Each String cell points to a compiler-owned bounded block containing length,
capacity, fixed-length metadata and UTF-16 code units. These are **not native BSTR
pointers**. Embedded NULs, supplementary-character surrogate pairs and isolated
surrogate units survive host input, execution and readback without sanitization.
`Len` counts UTF-16 units; `LenB` returns twice that count for String inputs.

String assignment copies into the destination's stable block. ByVal parameters,
parenthesized ByRef temporaries, function results and intermediate values preserve
copy semantics, including multiple calls in one expression and bounded recursive
calls. Explicit ByRef aliases still refer to the same variable. Automatic locals
reset per call, statics persist, and fixed Strings pad/truncate on assignment.
String arrays support fixed/dynamic multidimensional storage, ReDim/Preserve,
Erase and ByRef access. Fixed String array elements are space-padded on Erase;
dynamic arrays deallocate their shape without losing their backing descriptors.

Supported operations include `&`, String+String, binary relational operators and
String Select Case; `Len/LenB`, `Left/Right/Mid`, `Trim/LTrim/RTrim`, `StrReverse`,
`Space`, `String` with a String character argument, `ChrW/AscW`, `StrComp`,
`InStr/InStrRev`, `Replace` and one-dimensional String-array `Join`. `$` aliases
are supported where the shared frontend accepts them. Mid assignment replaces
characters without extending the destination; LSet/RSet use its current length.
`CStr` formats integers/Booleans, and `Str` formats integers with the positive sign
space. Integer/Boolean values can also be concatenated or assigned to Strings.
Built-in String calls currently accept positional arguments and optional holes;
user-defined procedures retain named/optional argument support.

Comparison defaults to `Option Compare Binary`. An explicit `vbBinaryCompare`
works in Text modules. Locale-dependent comparison is **not** approximated as
ASCII case folding: unsupported defaults are diagnosed at compile time and dynamic
unsupported compare modes raise error 5. Trim removes U+0020 spaces only.
ANSI/code-page Chr/Asc, numeric-character String, case mapping, Like/Split,
floating-point formatting, String-to-number coercion, Null/Variant behavior and
the full String library remain outside this release. Use `ChrW` for explicit
UTF-16 characters. String computation does not add font shaping or glyph rendering.

`maxStringLength` / CLI `--max-string-length` defaults to **256 UTF-16 units**,
range 1–4096. It bounds variable values, intermediate results and fixed declarations.
Exceeding it at runtime raises catchable VB error **14**; failed String assignments
retain the destination. A too-long source literal or fixed declaration is rejected
by the compiler. These limits also apply when a longer RHS could ultimately be
truncated into a fixed destination; this is a bounded target, not an unlimited heap.

String dynamic arrays reserve **16 elements by default** to avoid multiplying the
numeric default of 256 by large per-element String blocks. Explicit
`dynamicArrayCapacity` overrides both defaults. Each element reserves
`maxStringLength + 3` u32 words (or `fixedLength + 3` for fixed Strings), in addition
to its handle and array header. Snapshots and per-call-depth scratch also count
against `maxStateWords`. Reduce capacities or call depth when a program exceeds
that compile-time budget. No new GPU memory is allocated on each loop iteration
or dispatch: reserved blocks are reused and persistent state remains lane-private.

Character scanning/copying consumes the same execution fuel as VB statements.
Fuel faults remain fatal even under On Error, whereas capacity and argument errors
are catchable. Host `writeGlobal` accepts strings/String arrays and
`initializeArray` accepts initial String values; inputs are copied/validated before
queueing. Readback returns JavaScript strings and validates descriptor lengths and
UTF-16 units. String artifacts carry `stringABI: 1`; legacy numeric artifacts are
still supported without this extension.

```sh
npm run compile:compute -- packages/vb6-compute/examples/strings.bas --out strings.json --max-string-length 64
```

The playground's **UTF-16 String processing** example shows diagnostic String and
array readbacks plus GPU-drawn code-unit bars. The bars are not shaped text.

Fixed-length String values may be read, assigned, passed ByVal, or passed as a
parenthesized temporary. Direct fixed-length scalar/array arguments to ByRef String
parameters produce `GPU_FIXED_STRING_BYREF`: native temporary/copy-back semantics
are not yet implemented or certified. Use an explicit variable-length temporary
and assignment back when required. Variable-length ByRef aliasing is supported.

## Persistent program runtime

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
  console.log(await program.run());
  await renderer.render(program);
  await program.run({readback: false});
  await renderer.render(program);
} finally {
  await renderer?.dispose();
  await program?.dispose();
  await gpu.dispose();
}
```

`count` is the number of isolated invocations, each with lane-private globals.
This does **not** automatically parallelize normal shared VB module state.
`writeGlobal(name, value, lane)`, `initializeArray(name, bounds, values, lane)`,
`readState`, `run`, `reset`, `writeShared` and `readShared` serialize through the
device. Arrays are flat with the first dimension varying fastest. Dynamic-array
writes must match their current allocated length; readback includes runtime bounds.

Supply `sharedBuffer`/`sharedWords` to chain kernels without CPU readback. The
buffer stays caller-owned and requires STORAGE usage; host writes/reset need
COPY_DST and readback needs COPY_SRC. Reset does not clear borrowed shared memory
unless explicitly requested with `clearShared: true`.

Intrinsics include invocation/group indexes and counts, `ComputeWidth/Height/Time`,
`ComputeLoadLong/Single`, `ComputeStoreLong/Single`, and
`ComputeAtomicAdd/Sub/Exchange/And/Or/Xor/CompareExchange`. Atomic word operations
wrap at 32 bits, unlike checked VB arithmetic, and have no implicit cross-workgroup
barrier. `ComputeSin/Cos/Tan/Atan/Sqrt/Exp/Log/Min/Max` explicitly use f32 math.

`run` normally reads source-located runtime error cells and throws on failures.
`readback: false` submits without inspecting them; call `readState` explicitly as
needed. Failed lanes are skipped by the renderer. Default per-lane fuel is 100,000;
aggregate requested dispatch fuel is capped at 50 million. Resource limits are
checked before allocation. Device loss and shader errors are reported explicitly.

## Event-driven compute applications

`compileComputeApplication(sourceOrProject, {events, ...compilerOptions})` builds
one dispatcher and one persistent storage layout for all handlers. Event bindings
name public parameterless Subs: `load`, `frame`, `pointerDown`, `pointerMove`,
`pointerUp`, `pointerCancel`, `keyDown`, `keyUp`, `wheel`, `timer`.

```js
const descriptor = compileComputeApplication(source, {
  events: {load: 'Main', pointerDown: 'OnPointer', keyDown: 'OnKey'}
});
const app = await ComputeApplication.create(descriptor, {
  canvas, programOptions: {width: 640, height: 320},
  onError: error => console.error(error)
});
await app.dispatch('pointerDown', {PointerX: 100, PointerY: 50});
await app.reset();
await app.dispose();
```

Handlers read typed fields from the reserved `ComputeInput` module: `PointerX/Y`,
`Buttons`, `PointerId`, `Pressure`, `KeyCode`, Unicode `Character`, `Modifiers`,
`WheelX/Y`, `WheelMode`, `Elapsed`, `DeltaTime`, `Frame`, `EventId`. Modifier bits
are Shift=1, Ctrl=2, Alt=4, Meta=8. WheelMode preserves the browser's delta units.
Canvas borders, padding and axis-aligned scaling are removed from pointer mapping;
rotated/skewed CSS canvases are not mapped by this host adapter.

DOM input collection, focus and frame scheduling are explicit host operations;
VB handlers execute in compute. This is not a full classic forms/control runtime.
The application owns listeners and scheduling, borrows an optional supplied GPU,
and defaults to a bounded 128-event queue. Overflow is reported, not silently
ignored. Inputs are immutable snapshots delivered in order. `start`/`stop` control
animation; scheduling the next frame only after GPU completion prevents a growing
backlog. `timerInterval` is in seconds and delivers at most one timer event per
completed frame. Reset is serialized and reruns load. Empty drawing events do not
erase the previous framebuffer. Default readback surfaces event errors; disabling
it explicitly also disables this error/empty-draw inspection.

`exportComputeHTML(descriptor, {runtimeSource, ...options})` is a pure exporter;
pass the trusted `vb6-compute.js` bundle as runtimeSource. The CLI does this for you.
The included `events.html` demonstrates pointer/keyboard handlers and reset/dispose.

## Compute-only rendering and decoded images

`ComputeScene` encodes rectangles, circles, round-segment strokes, lines,
quadratic/cubic paths, nonzero/even-odd fills, solid/linear-gradient paints, affine
transforms, alpha and rectangular device clips. `ComputePath` provides `moveTo`,
`lineTo`, `quadraticCurveTo`, `bezierCurveTo`, `closePath`. Open stroke contours are
not implicitly closed. RGBA paints are in [0,1]; readPixels returns premultiplied
RGBA8. VB drawing intrinsics are `ComputeClear(color)`,
`ComputeRect(x,y,w,h,color)`, `ComputeLine(x1,y1,x2,y2,width,color)` and
`ComputeCircle(x,y,radius,color)`; supported classic drawing syntax also lowers.

`ComputeImage(width, height, rgbaBytes, {premultiplied: false})` copies decoded
RGBA8 bytes into an immutable image. `scene.image(image, x, y, width, height,
{source: [sx,sy,sw,sh], filter: 'linear', opacity: 1, transform, clip})` supports
integer source cropping, nearest/bilinear filtering, mirroring/transforms and
clipping. Image sampling, premultiplication and compositing execute in compute;
PNG/JPEG decoding is a separate host responsibility. Bilinear interpolation uses
premultiplied texels to avoid transparent fringes. Scene encoding deduplicates
reused images and bounds image storage to 64 MiB. Images currently enter through
ComputeScene, not through a VB LoadPicture implementation.

Stages: encoded curves/commands → GPU curve flattening → GPU transformed bounds →
ordered 16×16 tile bins → GPU coverage/compositing into an RGBA8 storage texture →
texture copy to canvas. No render pipeline or fragment shader is used. Curves have
fixed 32-edge subdivision; antialiasing uses 1 or 4 samples. Tile-list overflow
uses an ordered scan rather than dropping geometry. Full stroke styles, adaptive
curves and production sparse-strip performance remain outside this version.

This original JavaScript/WGSL implementation is informed by Vello's original
compute-centric research renderer, not a Rust port, Vello API clone, or performance
or image-quality equivalence claim. The newer vello_gpu preprocesses paths on CPU
and does not require compute shaders. Primary references:

- https://github.com/linebender/vello#vello-compute-renderer
- https://github.com/linebender/vello/tree/main/research
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/mid-statement
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/replace-function
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/chr-function
- https://www.w3.org/TR/WGSL/
- https://www.w3.org/TR/webgpu/

## Raw WebGPU kernels

`ComputeKernel.create(gpu, {code, entryPoint, constants, layout})` exposes arbitrary
WGSL with inferred/explicit layouts. `bind(index, entries, {dynamicOffsets})`,
`dispatch(x,y,z)` and `dispatchIndirect(buffer,offset)` support buffers, textures,
workgroup memory, barriers and atomics under WebGPU validation. Advanced resource
and query APIs remain available through `gpu.device`. Required features/limits are
requested explicitly through `ComputeDevice.request`. Raw kernels are caller code;
the VB instruction budget does not instrument arbitrary WGSL.

## Remaining compatibility boundaries

Not implemented: the remaining String/code-page/locale library, tagged Variants,
exact Double/Currency/Decimal/Date
semantics, locale behavior, UDT/object/class/COM/OCX lifetimes, native Declare and
filesystem/network services, full classic forms/controls/events, font parsing,
text shaping/rasterization, advanced path clips/blends, and IDE/debugger/EXE target
integration. These are not silently delegated to the existing runtime. The event
adapter and HTML export are additions to the standalone compute package, not
full application migration or the requested complete VB6 compatibility claim.

Validation requires actual WebGPU numeric and pixel readbacks and exported-browser
interaction tests. Missing adapters fail, not skip. Software-adapter execution
verifies shader behavior, not physical-GPU speed or cross-vendor certification.
