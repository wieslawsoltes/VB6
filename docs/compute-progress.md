# Optional compute backend — GPU Strings increment

PR #55 merged the experimental 0.2 backend. The next increment adds bounded
UTF-16 String storage and operations to the separately built package. The existing
IDE, JavaScript runtime and native backends are unchanged.

Variable/fixed Strings, fixed/dynamic String arrays, copy-preserving procedure
calls, common String intrinsics, binary comparisons, Mid assignment and LSet/RSet
are implemented in WGSL. Host writes/readbacks preserve UTF-16 units and canonical
storage descriptors. Per-character operations consume the same fatal execution
fuel as other compute work. The package guide documents capacities, the String
ABI extension and unsupported locale/code-page/Variant operations.

Validation uses shared independent String fixtures in host lowering tests and
actual WebGPU execution. Existing numeric/array/recursive/rendering/image/event
checks remain enabled. The String playground example validates readback results
and persistent reruns alongside the existing exported-application checks. An
extracted npm package must compile the example through the independent CLI.

Inspect the final-head CI result and artifact when evaluating readiness; host
compilation alone is not GPU execution evidence. The software WebGPU adapter is
not a physical-GPU performance certification. Exact broader numeric, Variant,
object/native-host, forms, typography and IDE/debugger/EXE integration remain
future compatibility work, not claimed features of this increment.
