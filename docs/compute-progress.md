# Optional compute backend — 0.2 integration checkpoint

PR #55 preserves the ordinary IDE and JavaScript/native backends. Its standalone
experimental package is documented in `packages/vb6-compute/README.md`.

The old reserved-WGSL renderer blocker was resolved by commit 842d459. Subsequent
work added GPU dynamic arrays, GoSub/computed branches and bounded recursive
continuation frames. CI run 37470387638 on cdcc683 passed 74 WebGPU scenarios,
including numeric and rendered-pixel readbacks, with zero retained GPU resources.
Main b6f623d was reconciled without changing that tested source tree.

The next integration adds typed event-driven applications, a standalone compiler
CLI, escaped single-file HTML export, decoded RGBA image paints, canvas content-box
input mapping and exported-application interaction tests. These stay optional and
are not a claim of complete VB6 language, numeric, forms, typography or native-host
compatibility. Current APIs and exact boundaries are in the package guide.

The compute CI workflow retains exact source, per-scenario progress, numeric and
pixel results, browser previews, and the independent package. Missing adapters,
shader failures, resource leaks and source regressions fail validation. All existing
assertions remain enabled. Local host tests and extracted-package checks are useful
but do not substitute for the WebGPU suite; the managed local browser blocks
localhost navigation, so GPU/browser evidence comes from the CI runner.

Before merge, inspect the latest PR-head workflow results rather than relying on
historical counts in comments. No physical-GPU benchmark, native VB6 certification,
or full feature-parity assertion is made by this checkpoint.
