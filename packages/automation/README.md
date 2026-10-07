# @vb6/automation

Standalone trusted Automation registry, lifecycle, tagged VB values, bounded wire
codec and adapter for `@vb6/com-ole`. No DOM, IDE, registry lookup or native activation
is required. MIT licensed; ESM for Node 22+ and modern browsers.

The repository's `npm run package:com-ole` stages the complete static import closure
into the tarball. The source checkout entry intentionally points at the canonical
runtime implementation; distribute the produced tarball, not this directory alone.

Stable imports are the root API and `/values`, `/wire`, `/com`. `/internal/*` exists
only for the exact-version native companion to share the same classes rather than
shipping duplicate `VBArray`, `Cell`, `VBError` or registry identities. It is not a
version-stable application API.

Use `AutomationRegistry.register` with trusted factories, `registerActive` for
explicit existing-object access, and `registerMoniker` for exact case-sensitive
host-owned capability names. A session snapshots the registry. `session.close()`
waits for late acquisition cleanup and releases every adopted adapter. GetObject
never resolves unregistered file paths, URLs, scripts, COM classes or OS monikers.

`registerComClass(registry, progId, factory)` consumes one owned COM interface from
the factory. The bridge retains canonical `IUnknown` identity per VM session and
preserves tagged numeric values, typed array bounds, ByRef cells and enumeration.
