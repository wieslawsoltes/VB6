# Direct Win32 executables and desktop window integration

The direct Win32 target adds a **JavaScript-written PE32 linker and x86 code generator**. It compiles a deliberately restricted, typed VB subset to machine code. It is not Electron wrapped in a different launcher, does not extract a runtime, and does not call an external compiler. Generated applications still require Windows and any DLLs explicitly named in their imports.

This is an **experimental target, not a complete VB6 compiler**. It does not inherit every feature of the browser VM. Unsupported types, instructions, controls, events and ABI forms fail compilation instead of producing a misleading successful EXE. Some design-time appearance properties use Windows defaults; native control styling is not pixel-identical VB6 styling.

## Choose the target

| Target | Appropriate use | Single-file behavior | Graphics / language |
| --- | --- | --- | --- |
| `build:win32` | Native applications within the typed subset below | One PE32 EXE, no unpacking and no JS/VB engine installed or bundled | Real Win32 controls/GDI; x86 machine code |
| `build:windows` | Applications using the existing browser VM and controls | One distributed Electron portable EXE; private runtime extraction | WebGPU where validated, otherwise explicit Canvas2D when permitted; DOM controls |
| `build:classic` | Original VB6 compiler/runtime compatibility | One application EXE plus the original runtime and project dependencies | Licensed local VB6 compiler, native-code or P-code |

The direct target **does not support WebGPU**. Passing `--graphics webgpu` or an architecture other than `x86` is an error. The Electron target does not gain genuine Win32 MDI child/control handles from the AOT implementation. These are different execution backends, not interchangeable compatibility claims.

## Build and run

No npm packages are required for the direct compiler. From a checkout with Node.js 22 or later:

```sh
npm run build
npm run build:win32 -- --project examples/calculator.vb6web --out release/calculator
npm run build:win32 -- --project examples/native/AotWindows.vb6web --out release/aot-windows
npm run build:win32 -- --project examples/native/AotMDI.vb6web --out release/aot-mdi
npm run build:win32 -- --project MyApp.vbp --source-root path/to/sources --out release/myapp
```

The builder writes `Name.exe`, `Name.build.json` and `Name.sha256`, and refuses to replace an existing EXE. Use a fresh output directory. The build report contains PE section/import metadata, instruction-to-source RVAs, size, architecture and compatibility boundaries. `.vbp` inputs use the existing native project importer; the source exporter/importer remains responsible for that format's compatibility.

Build on any supported Node platform, then run the resulting EXE on Windows. The verified x86 execution path is Windows x64/WOW64. ARM64 desktop validation described below concerns the Electron target, **not an ARM64 AOT code generator**.

In the browser IDE, open Calculator or one of `examples/native/*.vb6web` and choose **File → Make <project>.exe (Win32 AOT)…**. The compiler runs locally inside the browser, including the single HTML app. It needs no server, account, Node installation or native compiler. Building an EXE does not execute it in the browser. Stop the project before exporting. The unchanged Calculator project is supported; changing its Double variables to Long is neither necessary nor correct for fractional calculations.

### Standalone compiler SDK

`npm run build` also produces `dist/vb6-native.js`. Loading it defines `globalThis.VB6Native` without creating an IDE or touching the DOM:

```js
// After loading dist/vb6-native.js in a browser or worker:
const { bytes, report } = VB6Native.compileWin32(project, {
  arch: 'x86',
  graphics: 'gdi'
});
// bytes is a Uint8Array containing the entire executable.
// In a worker, transfer it rather than copying it:
postMessage({ bytes, report }, [bytes.buffer]);
```

ES module consumers can import `compileWin32` from `src/native/compiler.js`. The SDK also exports `NativeCompileError`, `extractNativeDeclarations`, `PE32Image`, `BinarySection`, `PE32_BASE` and `X86`. The latter APIs are low-level emitters: they do not make arbitrary machine code safe. The SDK itself is original JavaScript source plus the repository's compiler dependencies, not a compiler executable encoded as a blob.

## Implemented language contract

Storage types are **Byte, Integer, Long, Boolean, Single, Double, Currency and String**. Integer intermediates are checked signed 32-bit values, with narrower range checks on assignments/arguments. Single/Double storage retains its native 4/8-byte width; floating expressions use immutable Double snapshots, with Single rounding on assignment and ByVal calls. Fractional division, power, numeric comparisons, Boolean tests, For loops and Select Case are lowered alongside integer division, remainder, bitwise operations, branches, Sub/Function calls, recursion and globals/locals/statics. Arguments are evaluated left-to-right before exact-width stdcall stack ordering. Typed Optional parameters, early-bound named arguments and explicitly grouped scalar ByRef value copies are supported; ParamArray remains unsupported. See [Native call arguments](WIN32-CALLS.md) for defaults, temporary ownership, syntax limits and external ByVal overrides. See [Numeric storage and Calculator export](WIN32-NUMERIC.md) for math, conversion, precision and ABI details.

Stored Unicode Strings use owned BSTR allocations from the Windows Automation system library. Globals, locals, statics, ByVal copies, ByRef mutation and String function return values have explicit ownership. Expressions snapshot stored values before evaluating a later operand that could mutate them. Each expression temporary is released at the next lowered instruction and procedure exit; recursive calls have independent ownership slots. Fixed-length Strings (1–65,535 UTF-16 units) pad/truncate on assignment and initialize with spaces. `Len`, `LenB`, `Left$`, `Right$`, `Mid$`, `ChrW`, `AscW`, `CStr`, explicit numeric conversions and ordinal comparisons preserve explicit String lengths, including embedded NULs. Strict numeric conversion rejects embedded NUL rather than silently accepting a numeric prefix; `Val` deliberately parses a prefix using a period as the decimal separator. `InStr` uses explicit BSTR lengths. `StrPtr(variable)` reads its current storage pointer without creating a copy; pointers to computed text are only valid through the current statement.

Fixed arrays support up to eight dimensions, explicit constant lower/upper bounds and Option Base. The first dimension is contiguous; Byte/Integer/Boolean/Long/Single/Double/Currency elements use their native widths, and String elements own their BSTRs. Indexes are checked before access. `LBound`/`UBound` accept an optional checked dimension; `Erase` resets numeric elements and frees/resets String elements. Each array is limited to one MiB of backing storage and each procedure workspace to 512 KiB. The compiler probes stack pages. Dynamic arrays, ReDim/Preserve and exact-type whole-array ByRef calls/assignment use owned SAFEARRAY storage; see [Native arrays](WIN32-ARRAYS.md). Variants, Decimal, records and class instances remain unsupported. Fixed-length String ByRef copy-back is explicitly rejected.

Text allocations are bounded to 1,048,576 UTF-16 units. Native window text getters retain a separate 4,095-unit bound. These are diagnosed runtime limits, not unlimited VB6 String compatibility.

### Error recovery

`On Error GoTo label`, `On Error Resume Next`, `On Error GoTo 0`, `Resume`, `Resume Next`, `Resume label`, `Error number`, `Err.Raise(number)`, `Err.Clear`, `Err.Number`, `Err.Description`, `Err.Source` and `Erl` are lowered. A procedure has separate enabled/active handler state. A fault in an active handler propagates to its caller; a failed callee unwinds its owned Strings before the caller handles the failed call. Resume restores the recorded instruction, not the current handler location. Interrupted expression/argument stacks are discarded without discarding addressable locals. Floating values are materialized before calls and error checkpoints, with no live x87 values spanning a nonlocal error transfer. Handled bounds, overflow, division and conversion faults do not terminate the process.

Error numbers are restricted to 1–65,535; runtime diagnostics include 5, 6, 7, 9, 10, 11, 13, 20 and 340. Custom source/description/help arguments and signed COM HRESULT error numbers are rejected/not supported. Unhandled errors show a native diagnostic and exit nonzero. This is structured VB procedure recovery, not arbitrary Windows SEH or native DLL exception trapping. Windows callback boundaries are isolated: an unhandled event error terminates rather than performing an unsafe non-local jump through user32 into a suspended caller. Full classic VB6 cross-component error behavior is not certified.

Public/private procedure, declaration and variable access is checked. Default form initialization is guarded separately from HWND creation: a public member can initialize a form without displaying/loading it, and self-UI access from `Form_Initialize` cannot recurse indefinitely. This is a singleton-form implementation, not full VB6 object lifetime/reference-counting semantics.

Exact scaled Currency storage, arithmetic, conversions, scalar ABI and typed arrays are described in [Native Currency](WIN32-CURRENCY.md). Currency values are never stored as Double.

## Native controls and windowing

Supported form designers are `Form` and `MDIForm`. Supported intrinsic controls are CommandButton, Label, TextBox, Frame, CheckBox, OptionButton, ListBox, ComboBox and Timer. These are actual Windows control classes, not HTML controls. Frames are native parent HWNDs; nested control notifications are forwarded to the owning form. IDs remain stable even when model declaration order places a child before its parent.

Static designer control arrays retain independent HWNDs, IDs, state and their ByRef Integer Index event arguments. `control(index)` validates the element, with missing indices raising error 340. Count/LBound/UBound/Index and supported control properties/methods are mapped. Duplicate indices, mixed scalar/array names and heterogeneous element types are compilation errors. Dynamic control Load/Unload is not implemented.

Implemented operations include caption/text, visibility/enabled state, focus, window state, client-size queries in Twips/Pixels, checkbox/radio values, list selection/count/add/remove/clear, timers, static native menus, and the supported control events. Nested frame geometry, basic edit styles, list sorting and text limits are mapped. Authored form/control font properties produce native DPI-scaled fonts with a stock-font fallback; edit/static alignment is retained. Other design-time colors/metrics, extended controls, picture/icon resources, KeyPreview, drag/drop, printing and broad intrinsic API parity are not implemented. Unsupported executable operations and control types are errors; appearance properties outside the mapped set are not a promise of visual parity.

`MDIForm` creates a genuine `MDICLIENT`. `MDIChild` forms are created with `CreateMDIWindowW` and use `DefMDIChildProcW`; parent frames use `DefFrameProcW` and MDI accelerator translation. Closing one child preserves the frame and sibling; frame shutdown requests child unload and honors cancellation.

`Show vbModal, owner` uses a native nested message loop, remembers which windows were enabled, disables non-modal windows, and restores their prior state when the modal form is hidden or unloaded. `Form_QueryUnload` and `Form_Unload` receive cancellable ByRef values. Native child windows are destroyed through `WM_MDIDESTROY`, not hidden DOM elements. This is not a claim that every original VB6 event ordering or nested-modal edge case is certified.

## Native Declare ABI and safety

The compiler links named/aliased/ordinal **stdcall** imports with scalar Byte/Integer/Long/Boolean/Single/Double/Currency parameters and returns. ByVal Double and Currency occupy eight stack bytes; Single occupies four; a ByRef argument is an address of the exact declared type. Floating returns use ST(0); Currency returns use EDX:EAX. Both are immediately captured by the caller. `StrPtr(text)` supplies a UTF-16 pointer for synchronous Unicode APIs, for example:

```vb
Private Declare Function SetWindowText Lib "user32" Alias "SetWindowTextW" (ByVal hwnd As Long, ByVal text As Long) As Long

Private Sub Form_Load()
    SetWindowText Me.hWnd, StrPtr("Native Unicode caption")
End Sub
```

Use `Long` for Win32 `BOOL` and x86 handles/pointers; VB Boolean/Integer storage is 16-bit. The developer is responsible for the imported function's exact ABI. Passing the wrong signature or retaining a temporary text pointer can crash a native process. Unrestricted native calls are not sandboxed by the browser's compilation step. Build/run only trusted source and audit imported DLLs. DLL names must be basenames; the tool does not copy, download or register third-party binaries. Declaring a non-system DLL creates an external deployment dependency.

Native DLL String/BSTR ABI parameters, C calling convention, structs, callbacks, dynamic library discovery, COM/IDispatch and OCX hosting are not implemented. Supporting a scalar Declare is not equivalent to full Win32 API or ActiveX compatibility.

## Executable structure

The linker builds headers, import descriptors, lookup/address tables, resources and fixups directly from JavaScript arrays. Deterministic output has no timestamp randomization or downloaded PE template. Absolute addresses have HIGHLOW base relocations; relative branches do not. Code is RX, constants are R, mutable data/IAT are RW, and no section is simultaneously writable and executable. ASLR and NX flags are enabled. The manifest requests ordinary user privileges and Windows common controls. No compiler/runtime/OCX binary is redistributed by this target.

## Desktop IDE and ARM64

The existing browser-window manager has a native transport in the Electron desktop IDE. It reserves an approved top-level window, adopts the live pane/editor DOM, and restores it on OS-close or a switch to MDI-only mode. It does not clone the editor model or create another VB VM. Properties and code-document detachment, exact editor identity, restoration, and direct child-to-root IPC rejection are exercised by desktop smoke tests.

Native ARM64 Node/Electron execution is verified on `windows-11-arm`, including a built ARM64 portable IDE launched after copying only that EXE to an empty directory. The runtime report asserts `arch: arm64`; this is not an x64 process merely running on an ARM machine. As on x64, the hosted runner used the explicitly reported Canvas2D fallback. Neither runner establishes physical hardware WebGPU certification.

## Validation and remaining boundaries

`npm run test:win32` exercises binary layout, relocations, import validation, compiler diagnostics/scope/ABI, fixtures and CLI output protection. `tools/test-win32-aot.ps1` executes the emitted PEs on Windows from isolated single-file folders, checks real control/MDI parent handles, fires native commands, checks text/captions, tests modality/unload, and verifies arithmetic/conversion error exits. Its C#/PowerShell interop is **test-harness code only**; the generated applications contain no CLR dependency.

`tools/test-win32-numeric.ps1` additionally executes the unchanged Calculator, its indexed buttons, native fonts, fractional arithmetic and division-error recovery. Numeric self-checks exercise mixed-width calls, arrays, rounding and repeated recursion. `tools/browser-native-build-tests.py` compares browser-generated/downloaded and worker-generated EXE bytes against Node output. It also verifies disabled build commands during execution and diagnostics without a download for unsupported source. The standalone SDK works in a dedicated worker with no DOM.

CI keeps execution reports, build metadata and EXEs; desktop jobs keep native x64/ARM64 launch reports. Consult the workflow for the exact source revision: compilation-only checks are not execution evidence. Existing compiler/runtime, browser, MCP, native-project and icon suites remain in CI.

**Still open:** full AOT VB6 language/control/lifetime parity; a no-extraction WebGPU backend without a native embedded engine; arbitrary COM/OCX/full Declare ABI; execution of arbitrary existing EXEs inside a browser; physical GPU certification; and actual licensed Microsoft compiler validation. The classic compiler integration is unchanged, and its opt-in real-compiler job was not run. Direct AOT tests do not establish that the proprietary compiler or classic runtime executed.

### Primary platform references

- PE/COFF format: https://learn.microsoft.com/en-us/windows/win32/debug/pe-format
- Native MDI creation: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-createmdiwindoww
- Cross-process text retrieval: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtextw
- Native window subclassing: https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowlongw
- stdcall ABI: https://learn.microsoft.com/en-us/cpp/cpp/stdcall
- Double conversion: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varr8fromstr
- Double formatting: https://learn.microsoft.com/en-us/windows/win32/api/oleauto/nf-oleauto-varbstrfromr8
