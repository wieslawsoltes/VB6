# Native compiler and optimization

The JavaScript native backend emits x86 PE32 programs using installed Windows DLLs, without an embedded JavaScript VM. All existing native source modules are retained. This document describes the implemented subset, not complete VB6/runtime/Win32/COM/OCX parity.

## Build and use

```sh
npm run build
npm run build:win32 -- --project example.vbp --out release/native --optimization 2
# Optional removal of unreachable generated procedures:
npm run build:win32 -- --project example.vbp --out release/pruned --optimization 2 --prune-unused-procedures
```

```js
import {compileWin32, X86, PE32Image, mem32} from './src/native/entry.js';
const {bytes, report} = compileWin32(project, {
  optimization: 2,
  pruneUnusedProcedures: true,
  maxGoSubDepth: 1024
});
console.log(report.optimization, report.records);
```

Level 0 retains baseline instruction selection. Level 1 shortens tagged same-section branches after relocation analysis. Level 2 additionally folds safe typed integer expressions, selects immediate arithmetic and removes branches to the immediately following instruction. It propagates constants through conservative basic blocks of unaliased local Long storage, lowers comparisons directly to conditional branches, and uses relocated jump tables for computed branches. The propagation pass preserves original instruction indices and source checkpoints, excludes escaped locals, and handles calls, joins, loop headers and error continuations conservatively.

Overflow, division errors, eager Boolean evaluation, statement recovery and source identities remain observable. Raw `PE32Image.finish()` defaults to level 0. These levels do not provide global register allocation, inlining, advanced loop optimization, vectorization, LTO or PGO.

## Source, generated code and pruning

`dist/vb6-native.js` and `src/editor/diagnostics-payload.js` are generated from retained source. Their exact inventory and fingerprints are verified by `tools/ide-artifacts.json`; normal builds cannot update their own expectations. Built distributions still include the standalone `VB6Native` browser/worker SDK. The earlier removal of a tracked generated bundle did not remove its compiler implementation.

`pruneUnusedProcedures` is an opt-in Boolean requiring optimization 2. It removes unreachable **generated procedure code**, never source modules. It follows code/data relocations and callback references, retains address-taken procedures, rebases addresses and marks removed source-map entries with `optimizedOut: true` and `rva: null`. All procedures are still lowered and checked before pruning, so unsupported constructs cannot disappear silently. Imports and shared runtime helpers are intentionally retained. The low-level `pruneNativeProcedures` API requires closed code-unit metadata and relocation-described addresses; arbitrary numeric code pointers are outside that opt-in contract.

## Integer semantics

Byte, Integer, Long and Boolean expression widths and authored literal type characters are preserved independently of the physical EAX register width. Intermediate narrow overflow checks are not postponed until assignment. For example, `2000 * 365` overflows Integer, while `2000& * 365` uses Long. Boolean arithmetic promotion, Byte bitwise masks, signed literal endpoints and Long-minimum `Mod -1` retain their explicit semantics. Constant folding respects the same intermediate widths and never cancels an overflowing subtree.

Expression-type caching is scoped to an instruction and reset on compiler-context changes. It does not retain stale local types or With bindings across statements.

## Native records and pointers

POD records support numeric fields, nested records and fixed inline array fields, checked indexing, copies, typed ByRef parameters, isolated parenthesized copies, Len/LenB, VarPtr and typed Win32 declarations. As Any accepts addressable unmanaged storage; explicit call-site ByVal passes pointer values. Native pointers require correct layouts, byte counts and lifetimes and are not sandboxed. Indexed Len/LenB arguments retain receiver/subscript evaluation and bounds checks.

Managed records, fixed-String record fields, SAFEARRAYs of records, record function returns and ByVal record parameters are not fully lowered. Complete Variant/Decimal semantics, classes/interfaces, COM/OCX ownership and remaining runtime/control services are also incomplete. Unsupported features produce explicit diagnostics.

## Control flow and With

Native `GoSub`/`Return`, `On ... GoSub` and `On ... GoTo` have explicit lowering. Computed selectors are evaluated once and converted to Long; 0 and selectors beyond the label list fall through, while values outside 0..255 raise error 5. GoSub return addresses use a bounded per-activation stack separate from ESP. `maxGoSubDepth` is available through the API and `--max-gosub-depth` CLI option (default 1,024; allowed 1..65,536, subject to the existing 512 KiB procedure workspace budget). Overflow raises error 28; Return without GoSub raises error 3. This is a resource policy, not a claim about the original VB6 depth limit.

`Do Until` and `Loop Until` honor the frontend's inverted branch polarity. Nested `With` supports addressable POD records, forms and supported intrinsic controls. Indexed receivers are captured once, including the control-array Index and HWND slot. Structured exits clear the active binding without changing lexical lowering; entry into an unentered binding raises error 91 before dereference or mutation. General class/COM With receivers are not implied by these supported cases.

## Counted String runtime

BSTR helpers support `Trim`/`LTrim`/`RTrim`, `StrReverse`, `LCase`/`UCase`, `String`, `StrComp` and `InStrRev`, including applicable `$` forms. Added intrinsic signatures accept named and omitted arguments while preserving authored evaluation order and formal ABI slot order. Results have per-statement ownership.

Trimming removes U+0020 only. Reversal operates on UTF-16 code units and preserves embedded NULs. Repetition preserves counted lengths, including NUL characters; numeric character codes use the installed ANSI code page rather than a Latin-1 approximation. Case conversion retains Windows `LCMapStringW` with explicit lengths and queried output capacity, including length-changing mappings. `StrComp` supports binary/text comparison, caller defaults and `vbUseCompareOption`; String operators and String Select Case support Option Compare Text through Windows collation. Locale-identical behavior across other platforms is not claimed.

## Checked assembler

The SDK exports checked registers, immediates, ModR/M/SIB memory operands and symbolic relocations; integer, x87, SSE/SSE2 and locked atomic families; indirect calls; and explicit stdcall/cdecl helpers. Additional instructions include INC/DEC, bit scans/tests/modifications, double shifts, MOVD/MOVQ and MXCSR transfers. Low-level callers remain responsible for register preservation, CPU feature availability and floating-point control state. Raw `emit` is deliberately unchecked.

Legacy packed SSE/SSE2 memory arithmetic can require 16-byte alignment. `sseUnaligned(name, destination, memory, scratch)` explicitly loads packed memory through MOVDQU and applies the register operation. It requires a distinct scratch XMM register and validates both plans before emitting either. It does not silently change raw `sse` semantics or realign arbitrary caller pointers.

## Validation

```sh
npm test
node tools/verify-x86-encodings.mjs
node tools/test-x86-cpu.mjs
node tools/win32-optimizer-fixtures.mjs
```

On Windows:

```powershell
./tools/test-win32-optimizer.ps1
```

The existing Validate workflow retains all build, browser, Windows-system and COM/OCX jobs. Its native-compiler job requires 23 distinct executables: seven fixture families at O0/O1/O2 plus pruned O2 continuation-language and String-library variants. Original compiler/records, arithmetic, language and assembler checks are retained. Added fixtures cover typed overflow, evaluated-once With, real HWND controls, named arguments, counted NUL strings and pruning. The driver verifies hashes, exit statuses, matrix completeness, timeouts and absence of adjacent extracted files. Reports and executable evidence stay in CI artifacts.

GNU assembler/objdump differential validation covers 3,905 encodings. The separate Linux x86-64 CPU check tests equivalent SSE2 instructions at all 16 byte alignments and reproduces the unsafe legacy form's fault; it is not a Windows ABI or PE32 oracle. Node tests compare 4,624 typed integer binary combinations to the shared runtime, with additional unary, encoding, linking, ownership and diagnostic checks.

Compilation and earlier-head CI do not establish native execution of a new revision. Check the actual final-head `native-optimizer-execution` artifact and `execution.json`, alongside the other validation jobs. Historical conversation claims without retrievable matching artifacts are not validation evidence.
