# Optional compute backend — 0.4

PR #62 extends the separately shippable WGSL backend with finite binary64 Double,
scaled 64-bit Currency, Gregorian Date operations, binary Like, bounded direct
Split/Filter assignments and explicit Windows-1250/1252 byte mappings.

The prior Windows-reference failures in Currency-to-Double and OLE Date field
rounding were fixed without removing or relaxing their tests. Stored Date words
remain distinct from rounded calendar-field views.

The standalone package contains the complete compiler frontend, runtime, compute
renderer, CLI and source examples. Normal application backends remain independent.
Use the package README for implemented operations, ABI/host IO, capacity choices
and the explicit unsupported Variant/Decimal/native/GUI/typography contracts.

Before merge, use exact-head CI results and downloaded source/package checks. The
WebGPU workflow requires a Windows numeric/code-page oracle, actual GPU word/error
and pixel results, and working exported applications. Missing adapters, leaks,
mismatched words and browser failures are not skipped. SwiftShader evidence is
shader validation, not physical-GPU performance or licensed VB6 certification.
