# Compute backend checkpoint — 2026-10-06

PR #55 remains a draft and must not be merged at this checkpoint.

The recovered compiler plus the GPU device/program/kernel wrappers, scene encoder,
compute rasterizer implementation, standalone package builder and regression
harnesses are preserved on the feature branch. Existing application backends and
their generated distributions are not changed.

The local corrected working tree passed `npm run build`, all 3,121 root Node tests
(including 98 compute tests), and the independent ESM/browser bundle build. This
is host-side validation, NOT evidence that the shaders have executed successfully.

A correction to `packages/vb6-compute/src/render-wgsl.js` could not be published:
the GitHub tool repeatedly returned an undetermined safety-status block. That
file in this checkpoint still contains reserved WGSL identifiers, while the
corresponding protocol and runtime helper corrections were accepted. The reserved
identifier regression is deliberately retained and is expected to fail on this
remote checkpoint. It must not be skipped, removed, or treated as passing.

Local managed Chromium rejected localhost/file navigation with
ERR_BLOCKED_BY_ADMINISTRATOR. No local browser restriction was bypassed.
The CI workflow collects independent numeric/pixel WebGPU diagnostics even after
a host assertion fails; any failure still fails the job. Browser validation is
not complete, and no physical GPU performance or cross-vendor claim is made.

This implementation remains a typed-standard-module experimental subset, not the
requested full VB6 language, object/control, host-service, typography and event
runtime. See the package README for supported APIs and remaining boundaries.
