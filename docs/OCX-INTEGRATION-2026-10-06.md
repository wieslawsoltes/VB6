# OCX source and current-main integration

The container continuation retains main `f3ca87b91baa8225a8a2635b2fa12103e0f638a4`
(Win32 services, exact build fingerprints, native debugger and sign-in recovery).
Large outputs are generated from authored source rather than merged as snapshots.
The source-control lab is generated **before** fingerprint verification and joins
the exact reviewed inventory, which now has 27 outputs. Normal builds and CI
cannot update expectations; the explicit authoring command remains forbidden in
CI. The manifest regressions also reject a missing, mutated, truncated or
non-file lab output. Source-only checkouts build the complete lab using
`npm run build`; no prior local generated files are required.
