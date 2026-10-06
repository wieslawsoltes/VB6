# VB6 Compute 0.4 — optional standalone backend

Compile typed VB standard modules to WGSL, execute them on WebGPU, and render
vectors/images with compute shaders. JavaScript owns device submission, browser
input and explicit host-clock collection; it does not interpret VB handlers or
rasterize their pixels. Existing IDE, JavaScript, Electron and Win32 execution
backends are independent and unchanged by this package. **This experimental,
bounded target is not complete VB6 compatibility.**

## Build and standalone use

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

The independently installable `@vb6/compute` archive contains dependency-free ESM
`index.js`, browser-global `vb6-compute.js`, the `vb6-compute` Node CLI, a single-file
playground, an exported event application, and numeric/String/event source examples.
It embeds its shared VB frontend and requires neither the IDE nor repository at
runtime. The build does not publish to npm. Serve browser applications over HTTPS
or localhost; no adapter raises `GPU_UNAVAILABLE`, never a silent CPU fallback.

The CLI accepts `.bas`/`.vb` source, `.vb6web`/`.json` projects or `-` for source on
stdin, and emits WGSL, JSON artifacts or single-file HTML. Repeated
`--event load=Module1.Main --event pointerDown=Module1.OnPointer` bindings compile an
application dispatcher. HTML always uses this application model. Options include
`--entry`, `--precision`, `--workgroup-size`, `--max-call-depth`, `--max-state-words`,
`--max-string-length`, `--dynamic-array-capacity`, `--code-page`,
`--two-digit-year-max`, framebuffer dimensions and execution limits. Run
`vb6-compute --help` for usage. Existing outputs require `--force`; input/output
aliases are rejected, and compilation errors do not truncate existing output.
HTML embeds the trusted runtime and escapes titles/serialized data; no CDN is used.

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
  await program.run({readback: false}); // persistent GPU state, no state readback
  await renderer.render(program);      // GPU commands feed GPU rasterization
} finally {
  await renderer?.dispose();
  await program?.dispose();
  await gpu.dispose();
}
```

## Compiler, values and precision

`compileCompute(sourceOrProject, options)` uses the shared frontend;
`compileComputeIR(program, options)` accepts its IR. Artifacts are JSON-serializable
and include WGSL, the versioned storage layout, source locations, globals and
explicit diagnostics. A plain entry must be a parameterless Sub in a standard module.

Supported scalar types are Boolean, Byte, Integer, Long, Single, Double, Currency,
Date and String. Use `&`, `!`, `#` and `@` literal suffixes where types matter.
Checked integer arithmetic/narrowing and ties-to-even conversions preserve errors.
Strict mode represents Double with two integer words and integer WGSL algorithms,
not two approximate f32 components. Finite binary64 add/subtract/multiply/divide,
square root, comparisons, Int/Fix/Abs/Sgn, integer/Single conversion, arrays, calls
and loops are supported. Tests compare exact output bits for normal/subnormal
values, signed zero, rounding and overflow. NaN/Infinity inputs are rejected.
`precision: 'single'` explicitly permits f32 approximation and emits a warning.
Mixed Single/Double comparison rounds Double to Single, following VB's documented
comparison rule. Exact binary64 transcendental functions and `^` remain diagnosed
in strict mode; `ComputeSin/Cos/Tan/Atan/Sqrt/Exp/Log/Min/Max` explicitly use f32.
This is not certification of every native x87/VB6 expression or numeric conversion.

Currency is a signed 64-bit integer scaled by 10,000. Shaders implement checked
addition/subtraction, negation/Abs, Int/Fix, multiplication with wide intermediates,
comparison and numeric conversion. Currency-to-Double preserves Automation's
integer-conversion then division rounding sequence. `/` promotes to Double, not
an invented fixed-point division. Full-range literals use `@`. Host writes accept
invariant decimal text, raw scaled bigint or safe Numbers; use text when low
Currency bits matter. Readback returns canonical four-decimal strings, including
`-922337203685477.5808` and `922337203685477.5807`, rather than losing bits in Number.

Date retains the original finite OLE binary64 serial in years 100–9999. Numeric
host IO preserves negative fractions; JS Date inputs capture local civil fields,
not UTC timestamps. Gregorian DateSerial/TimeSerial, Year/Month/Day/Hour/Minute/
Second, Weekday, DateAdd/DateDiff/DatePart and numeric DateValue/TimeValue are
implemented. Intervals must currently be source string literals; arguments are
positional without holes. Calendar field extraction follows Windows
VarUdateFromDate rounding without changing stored Date words. `twoDigitYearMax`
(default 2029) is recorded in the artifact. First-day/week defaults are Sunday and
January 1; explicit `vbUseSystem` (0) raises error 5 because machine calendar
preferences are not imported. Hijri and locale String parsing remain unsupported.
Now/Date/Time/Timer share one host-clock snapshot per dispatch;
`program.run({now: oleSerial})` injects a deterministic snapshot. These selected
Gregorian operations are not full legacy calendar or timezone/DST certification.

Subs/Functions retain ByVal/ByRef aliases, optional/named arguments, return values,
branches, loops, Select Case, static locals, GoSub/computed jumps and On Error/Resume.
Bounded recursive calls use private continuation frames, never recursive WGSL
calls or an exponentially inlined shader graph. `maxCallDepth` defaults to 16,
range 1–64, with error 28 on exhaustion. GoSub stack depth defaults to 64.
Unsupported object/Variant instructions fail explicitly.

Fixed/dynamic typed arrays support 1–4 dimensions, ReDim/Preserve/Erase and bounds
queries. `dynamicArrayCapacity` defaults to 256 numeric or 16 String elements;
explicit configuration overrides both. Preserve resizes only the last dimension
and cannot change lower bounds/rank. Invalid resizing preserves old contents.
ByRef element arguments lock array shape until return/error unwinding. Fixed
Erase zeros values but retains bounds; dynamic Erase deallocates its shape.

## UTF-16 Strings, binary patterns and code pages

Variable/fixed Strings use stable, bounded compiler-owned blocks with UTF-16 units,
length, capacity and fixed-length metadata, not native BSTR pointers. Embedded NUL,
surrogate pairs and isolated units survive host IO and shader execution. Assignment,
ByVal, parenthesized ByRef temporaries, intermediate values and recursive returns
copy values; variable ByRef aliases share storage. Fixed Strings pad/truncate.
Direct fixed-length String/array ByRef arguments are diagnosed as
`GPU_FIXED_STRING_BYREF`; native temporary copy-back remains unimplemented.

Supported: concatenation, binary comparisons/String Select Case, Len/LenB,
Left/Right/Mid, Trim/LTrim/RTrim, StrReverse, Space/String, ChrW/AscW, StrComp,
InStr/InStrRev, Replace, one-dimensional String-array Join, integer/Boolean CStr,
integer Str, Mid assignment and LSet/RSet. Dollar aliases follow the frontend.
Len counts UTF-16 units and LenB twice that count. Trim removes U+0020 only. Mid
assignment does not extend a destination. Calls use positional arguments/optional
holes; user procedure named arguments remain supported.

Binary Like supports `*`, `?`, `#`, bracket lists/ranges and negation. Malformed
patterns raise error 93. Polynomial dynamic programming and fuel accounting avoid
unbounded exponential wildcard backtracking. Direct `a = Split(...)` and
`a = Filter(...)` assignments target dynamic String arrays; general nested array
expressions and Variant array values are not implemented. Split supports optional
delimiter/limit/binary compare; Filter supports include/exclude and rank-one String
sources. Preflight sizes/capacity and source snapshots preserve destinations on
failure. Results are zero-based, including allocated empty `0 To -1` arrays.

`codePage: 1250` or `1252` (CLI `--code-page`, also in the playground) explicitly
enables Chr, Asc and numeric-character String. CI compares all 256 byte mappings
for each page with Windows NLS. No host ACP is inferred. Unrepresentable Unicode
raises error 5 rather than best-fit/replacement substitution. This is not full
DBCS/ANSI conversion or locale collation. ChrW/AscW need no code page. Comparisons
default to Binary; explicit binary mode works in Text modules. Unsupported locale
modes are diagnosed, not approximated by ASCII case folding. Case mapping,
floating formatting, String-to-number/Variant conversion and the remaining String
library are not supplied by this version.

`maxStringLength` defaults to 256 UTF-16 units (1–4096) for values, temporaries and
fixed declarations. Runtime overflow is catchable error 14 and preserves the
assignment destination; oversized literals/declarations fail compilation. Each
array cell reserves its capacity plus three u32 metadata words and a handle.
Snapshots/call frames also count against `maxStateWords` (default 16384, max 65536).
These are explicit bounded storage budgets, not an unbounded heap. No per-loop or
per-dispatch GPU heap allocations are hidden behind String operations. Character
scanning/copying uses the same fatal execution fuel as VB statements.

## Runtime, events and shared memory

`ComputeProgram.create(gpu, artifact, options)` owns persistent lane-private state,
draw commands and optional shared memory. `count` means independent invocations;
it does not automatically parallelize ordinary shared VB globals. Host methods
`writeGlobal(name, value, lane)`, `initializeArray(name, bounds, values, lane)`,
`readState`, `run`, `reset`, `writeShared`, `readShared` serialize through the device.
Inputs are copied before queueing. Flat arrays use first-dimension-fastest order;
dynamic writes match current allocated length, and readback includes bounds.

Borrowed `sharedBuffer`/`sharedWords` require STORAGE; host writes/reset also need
COPY_DST and readback COPY_SRC. Default reset does not erase caller-owned shared
memory; use `clearShared: true` explicitly. Invocation/group intrinsics expose
indexes, counts, workgroup size, width/height/time and shared length.
ComputeLoadLong/Single, ComputeStoreLong/Single and ComputeAtomicAdd/Sub/Exchange/
And/Or/Xor/CompareExchange operate on shared words. Atomic operations wrap at 32
bits, unlike checked VB arithmetic; independent lanes have no implicit barrier.

Default fuel is 100,000 per lane; aggregate requested fuel is limited to 50 million.
Resource limits are checked before allocation. Fuel/draw-capacity faults are fatal.
Run normally reads and throws source-located errors; `readback: false` submits
without inspecting errors, so call readState explicitly when needed. Failed lanes
are not rendered. Device loss and shader errors are surfaced; dispose owned objects.

`compileComputeApplication(source, {events, ...compilerOptions})` builds one GPU
state/dispatcher for public parameterless load/frame/pointerDown/pointerMove/
pointerUp/pointerCancel/keyDown/keyUp/wheel/timer handlers. `ComputeApplication.create`
accepts canvas, programOptions, renderOptions, optional borrowed gpu, onError,
autoStart, maxQueuedEvents (default 128), and timerInterval in seconds. Typed
`ComputeInput` fields carry pointer coordinates/buttons/id/pressure, KeyCode,
Unicode Character, Modifiers (Shift=1,Ctrl=2,Alt=4,Meta=8), wheel deltas/mode,
Elapsed/DeltaTime/Frame/EventId. Borders/padding and axis-aligned CSS scale are
removed from pointer mapping; rotated/skewed CSS canvases are unsupported.

Dispatch snapshots are ordered and queue overflow reported. Start/stop use
backpressured frame scheduling; timers deliver at most once per completed frame.
Reset is serialized and reruns load; dispose removes listeners and respects GPU
ownership. Empty drawing events retain the previous image unless readback is
explicitly disabled. DOM collection/focus/clock/scheduling are host tasks, while
VB event code runs in shaders. This is not a classic forms/control hierarchy.
`exportComputeHTML(descriptor, {runtimeSource, ...options})` embeds the trusted
standalone bundle; the CLI supplies it automatically. The event example exercises
pointer/key input, reset and disposal without repository dependencies.

## Compute renderer and arbitrary WGSL

ComputeScene/ComputePath encode rectangles, circles, round segment strokes, lines,
quadratic/cubic paths, nonzero/even-odd fills, solid/linear gradients, transforms,
alpha and rectangular device clips. Path API: moveTo, lineTo, quadraticCurveTo,
bezierCurveTo, closePath; open stroke contours are not implicitly closed. RGBA paint
channels are in [0,1]; readPixels returns premultiplied RGBA8. VB intrinsics:
ComputeClear(color), ComputeRect(x,y,w,h,color),
ComputeLine(x1,y1,x2,y2,width,color), ComputeCircle(x,y,radius,color).

ComputeImage(width,height,rgbaBytes,{premultiplied:false}) copies decoded bytes.
`scene.image(image,x,y,width,height,{source:[sx,sy,sw,sh],filter:'linear',opacity:1,
transform,clip})` supports integer crops, nearest/bilinear filtering and mirrors.
Sampling/premultiplication/compositing are shaders; image decoding is explicitly
host work. Filtering uses premultiplied texels, avoiding transparent fringes.
Reused images are deduplicated and scene pixel storage bounded to 64 MiB.
Images enter through ComputeScene, not an implemented VB LoadPicture service.

Pipeline: compute curve flattening → transformed bounds → ordered 16×16 tile bins
→ compute coverage/compositing → RGBA8 storage texture → canvas texture copy.
There is no render pipeline/fragment shader or Canvas2D raster fallback. Curves use
32-edge subdivision, AA uses 1/4 samples and tile overflow uses an ordered scan
rather than dropping commands. Adaptive curves, advanced stroke styles, path clips,
blend modes and production sparse-strip performance are not implemented.

ComputeKernel.create(gpu,{code,entryPoint,constants,layout}), bind(index,entries,
{dynamicOffsets}), dispatch(x,y,z) and dispatchIndirect(buffer,offset) expose raw
WGSL with WebGPU validation, buffers/textures, workgroup memory/barriers and atomics.
Advanced resources/queries are available through gpu.device. Required features and
limits must be requested explicitly. Raw WGSL is not instrumented by the VB budget.

## Validation and remaining work

The Windows reference job uses OleAut32 and Kernel32 NLS, not a licensed VB6
compiler. Linux WebGPU compares exact numeric words/errors, calendar fields,
code-page mappings, compiled program results and rendered pixels. Host tests also
pack/extract the standalone archive and run independent CLI/ESM consumers. Missing
adapters, mismatches, leaks and browser errors fail CI. SwiftShader execution is
shader correctness evidence, not physical-GPU speed or cross-vendor certification.

Not implemented: tagged Variants, Decimal, remaining numeric/transcendental/locale
contracts, UDT/class/COM/OCX/native service lifetimes, full classic forms/controls,
font parsing/shaping/glyph rasterization, advanced clips/blends, and IDE debugger/
EXE compute-target integration. Unsupported operations are explicitly diagnosed,
not silently interpreted on the CPU. The playground code-unit bars are not fonts.

The `compatibility.bas` example combines wide values, month-end arithmetic,
Split/Filter and Like; drawing intentionally converts geometry to Single.

```sh
vb6-compute compatibility.bas --out compatibility.json
vb6-compute sample.bas --out sample.html --code-page 1250 --two-digit-year-max 2029
```

This is original JS/WGSL code informed by Vello's original compute-centric research
renderer, not a Rust port or a Vello API/performance/image-quality parity claim.
Primary contracts and research:

- https://github.com/linebender/vello#vello-compute-renderer
- https://github.com/linebender/vello/tree/main/research
- https://www.w3.org/TR/WGSL/
- https://www.w3.org/TR/webgpu/
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/comparison-operators
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/like-operator
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/split-function
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/filter-function
- https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/weekday-function
- https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varr8fromcy
- https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varudatefromdate
- https://learn.microsoft.com/en-us/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte
