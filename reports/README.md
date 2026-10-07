# Porting and compatibility tracking

This directory is an entry point to the maintained VB6 porting trackers, not an
archive of test runs. Keep the detailed contracts with their owning documentation
instead of copying status tables here and letting them diverge. A passing browser
suite is not proof of complete native VB6 compatibility.

## Trackers

| Area | Maintained contracts and remaining work |
|---|---|
| Overall port | [Compatibility matrix](../docs/COMPATIBILITY.md) |
| Language and runtime | [Compiler/runtime workstream](../docs/COMPILER-RUNTIME.md), [scalar and Variant semantics](../docs/SCALAR-COMPATIBILITY.md) |
| Application export | [Exporter contracts, deployment formats and compatibility limits](../docs/APPLICATION-EXPORT.md) |
| Native compiler and Windows builds | [Win32 AOT](../docs/WIN32-AOT.md), [Windows build targets](../docs/WINDOWS-BUILDS.md) |
| Win32 browser API | [Standalone package and API boundaries](../packages/win32-browser/README.md) |
| Compute backend | [Standalone compute contracts and remaining work](../packages/vb6-compute/README.md) |
| Native project interchange | [Project formats and interchange contracts](../docs/NATIVE-PROJECTS.md), [workspace interoperability](../docs/NATIVE-WORKSPACE-INTEROP.md) |
| COM and OCX | [OCX support and limits](../docs/OCX-SUPPORT.md), [container contracts](../docs/OCX-CONTAINER-CONTRACTS.md), [scalar interoperability](../docs/NATIVE-SCALAR-INTEROP.md) |
| Data providers | [Data sources, provider contracts and compatibility limits](../docs/DATA-SOURCES.md) |
| Debugging and live editing | [Debugger compatibility](../docs/DEBUGGER-COMPATIBILITY.md) |
| Editor language services | [IntelliSense compatibility](../docs/INTELLISENSE-COMPATIBILITY.md) |
| Forms, controls and rendering | [Visual audit and remaining differences](../docs/VISUAL-AUDIT.md), [classic HTML rendering](../docs/CLASSIC-HTML-RENDERING.md), [optional layout](../docs/anchoring-layout.md) |

## What belongs in version control

Keep this index and deliberately reviewed, durable porting contracts. New tracker
files in this directory need an explicit `.gitignore` exception; prefer extending
the linked documents. Test inputs, fixtures and reviewed visual golden hashes
belong in `tests/`, not here.

Generated JSON, TAP, logs, screenshots, benchmarks, exports, binary round trips,
release summaries and recovery attempts are ignored. Existing test commands may
continue writing them under `reports/`; ignoring output does not disable tests or
CI artifact uploads. Inspect the exact commit's CI run for fresh evidence.

See [Testing and validation](../docs/TESTING.md) for reproduction and packaging.
Historical snapshots removed from this directory remain in Git history. They must
not be reused as evidence that a different source revision passed validation.
