# Application export

The exporter packages the **full matching browser runtime**. It does not maintain
a separate reduced implementation of VB6 and does not tree-shake features based
on static source inspection. Existing `exportApplication(project, options)` calls
continue to produce a standalone HTML string.

## IDE and command line

Use **File > Make … .html** for a single file, or **File > Make Deployment Archive
(.zip)** for a deployable folder. The archive contains `index.html`, `app.css`,
`runtime.js`, `bootstrap.js` and `manifest.json`. Extract all files together; do
not open the HTML inside an archive viewer. The new command is available in
Design mode, uses the current classic/platform IDE menu appearance, and reports
export failures and dependency warnings. `vb6Studio.lastApplicationExport` holds
the latest archive manifest or error diagnostics.

The archive command is a local download action. It does not add arbitrary command
execution to the MCP allowlist or bypass the existing structured export tools'
consent/revision checks. Importing `VB6Studio` directly rather than using the
standard studio entry point requires calling `installApplicationExport(ide, api)`
from `src/ide/application-export.js` to install this optional extension.

Build the matching payload before running the CLI:

```sh
npm run build
node tools/export-application.mjs examples/calculator.vb6web --check
node tools/export-application.mjs examples/calculator.vb6web --out Calculator.html
node tools/export-application.mjs examples/calculator.vb6web --out Calculator-app --format directory
node tools/export-application.mjs examples/calculator.vb6web --out Calculator-app.zip --format zip
```

The CLI reads a canonical JSON `.vb6web` project. Import a classic `.vbp`, its
source files and binary sidecars in the IDE and save `.vb6web` first. It does not
silently normalize project names, IDs, themes or authored layout. `--options FILE`
accepts JSON runtime options, and `--document FILE` accepts the document settings
below. `--check` prints a JSON preflight report and exits nonzero for errors.
Inputs are limited to 64 MiB per file. Output paths must not already exist,
including symlinks; there is no destructive overwrite switch. Parent directories
must exist. An I/O failure can leave incomplete newly-created output, which must
be reviewed before reuse; preflight errors create no output.

## Public APIs

```js
import {
  exportApplication, exportApplicationFiles, inspectApplicationExport,
  createApplicationExporter, ApplicationExportError
} from './src/exporter/exporter.js';

const options = {persist: false, nativeWindows: false};
const document = {title: 'Orders', language: 'pl-PL', direction: 'ltr'};
const report = inspectApplicationExport(project, options, document);
if (!report.valid) throw new ApplicationExportError(report.diagnostics);

const html = exportApplication(project, options, document);
const deployment = exportApplicationFiles(project, options, document);
// deployment.entry === 'index.html'
// deployment.files: filename -> UTF-8 source string
// deployment.manifest: runtime version, project identity, inventory,
//                      dependencies, diagnostics and file byte counts
```

`jsonForHTML` and `RUNTIME_VERSION` remain available. The standard IDE also exposes
`exportApplicationFiles`, `inspectApplicationExport` and `createApplicationExporter`
on `VB6StudioAPI`.

The factory can be imported directly from `application-exporter.js`, without the
generated `runtime-payload.js` import. Supply `{runtimeSource, runtimeCSS, version,
compile}` to obtain `{inspect, html, files}`. A custom runtime must expose
`VB6Runtime.mountApplication` and use a matching compiler/runtime contract; the
factory does not certify mismatched or truncated payloads.

Document settings are separate from runtime options. Supported keys are `title`,
`description`, `language`, `direction` (`ltr`, `rtl`, `auto`), and `scripts`.
Runtime options, including theme options, renderer-independent host configuration,
IDE bridge/debugger options and persistence, remain in the runtime option object.
Application themes remain independent of the IDE theme; authored colors, fonts
and geometry are not rewritten.

## Runtime adapters and callbacks

A callback cannot survive JSON serialization. Instead of silently dropping
`dataFetch`, `dataCredential`, `onMessage`, automation registries or control
registries, export now diagnoses non-JSON option values. Install actual runtime
objects from **trusted deployment JavaScript**:

```js
const document = {
  scripts: {
    'integration.js': `
      globalThis.vb6ConfigureApplication = async ({project, options, runtime}) => {
        return {
          dataFetch: globalThis.fetch.bind(globalThis),
          onMessage: message => console.debug(message.type)
        };
      };
    `
  }
};
const deployment = exportApplicationFiles(project, {}, document);
```

The optional hook runs after the runtime and supplied scripts load, and before
mounting. It may initialize registries using `runtime.RuntimeAPI`, mutate the
provided project/options, or return runtime option overrides. It may be async.
This is a deployment-code extension point, not a sandbox or a permission grant.
Native COM/OCX providers still require an appropriate host/adapter. Request
credentials at runtime; never put secrets in project source, integration scripts
or exported files. Configuration checks are not a general source-code secret
scanner.

At most 32 trusted scripts are accepted. Names are portable local `.js` basenames;
traversal, reserved output names, Windows device names and case-insensitive
collisions are rejected. In split deployments the exact script bytes are retained
and loaded using ordered `defer` scripts. In single-file HTML, literal HTML
raw-text delimiters (closing script tags or legacy comment openers) are rejected.
Escape those source literals deliberately, or use the split format: the exporter
does not blindly rewrite JavaScript regexes, strings or tagged templates. Closing
style delimiters likewise require escaping or split CSS deployment.

## Startup and lifetime

Exports retain `globalThis.vb6Application` and add:

```js
const host = await globalThis.vb6ApplicationReady;
console.log(globalThis.vb6ApplicationStatus.phase); // loading, ready, error
addEventListener('vb6:message', event => console.log(event.detail));
addEventListener('vb6:ready', event => console.log(event.detail.host));
addEventListener('vb6:error', event => console.error(event.detail));
```

Install event listeners in a deployment script when initial events matter; the
promise also works for late observers. A nonblocking startup banner is hidden on
successful startup, debugger pauses and interaction requests. Missing runtimes,
rejected adapters, JavaScript startup exceptions and VMs resolving in an error
state produce a visible text-only alert and reject the public promise. A handler
is attached internally to avoid an unattended unhandled rejection; callers still
receive the original rejected promise. A failed returned host remains inspectable.
This startup status is not a continuous replacement for the VM's later runtime
error/debugger events.

On `pagehide` the host saves through its existing persistence policy. It is
disposed for non-cached departures, but retained for a back/forward-cache entry.
`persist: false` still prevents storage reads/writes. Browser storage may be
unavailable, especially for local-file origins; the runtime's in-memory fallback
and storage warning remain in effect. Native/browser-window restrictions and
user-gesture requirements are unchanged.

## Preservation, diagnostics and boundaries

All enumerable JSON project fields are copied without mutating the caller.
This includes modules/classes, forms, control arrays, menus, source UserControls,
project settings, references, assets, resources, VFS state, data configurations and
opaque native-import metadata. Their **supported execution semantics come from
the existing browser runtime**, including layout, MDI, drawing backends, source OCX
adapters and Win32-browser services. Packaging native metadata does not execute an
arbitrary Windows DLL or OCX. This change is not universal VB6/native compatibility,
physical WebGPU certification or a compute/Win32-AOT target implementation.

The snapshot accepts plain/null-prototype JSON objects and arrays. Undefined
object members are omitted, and sparse/undefined array slots become null, as in
JSON. Functions, symbols, BigInts, non-finite numbers, custom host objects,
accessors, circular data and named array properties are diagnosed rather than
silently erased or converted. Getters and `toJSON` are not invoked. Use the
project's existing base64 resource/VFS formats for binary data. The snapshot is
bounded to 128 nesting levels and one million nodes, including sparse slots.

`ApplicationExportError` includes stable `code`, `path`, `number` where applicable,
and a `diagnostics` array. Compiler source/line locations are retained. Preflight
checks public configuration in data sources, runtime options, forms, controls,
menus and remote asset URLs. A report is not a proof of all runtime behavior.

Remote assets and configured data services are listed as deployment dependencies
and warnings; they are not fetched or made offline by the exporter. Transient
`blob:`/`file:` assets must be imported as embedded assets first. `Declare` imports
are inventoried without claiming they are all supported by the selected host.
Data services must remain reachable and allow the deployed origin; native
providers and optional licensed components need their normal host setup.

HTML, split files and manifest are deterministic for the same project/options,
document settings and runtime payload. The manifest records UTF-8 byte sizes for
other output files, not a cryptographic attestation or itself. ZIP output uses the
existing interoperable STORE writer and includes creation timestamps, so ZIP bytes
are not promised deterministic.

The split format has no inline executable bootstrap/runtime scripts and does not
fetch project JSON. It supports an external-script CSP; styles, images, network,
workers or optional runtime services may still require their own policy rules.
It does not promise arbitrary restrictive CSP compatibility or offline data APIs.

## Modules and validation

`diagnostics.js` owns structured errors; `serialization.js` owns portable copying
and JSON escaping; `preflight.js` owns validation/inventory; `document.js` owns
markup and document options; `bootstrap.js` owns the launch lifecycle;
`application-exporter.js` composes the reusable factory; `exporter.js` supplies the
full build-matched payload. The IDE extension and Node CLI consume those APIs.

```sh
npm run build
node --test tests/exporter-*.test.mjs
python tools/browser-exporter-tests.py
npm test
```

The exporter browser suite covers every split catalog sample, the control/theme
gallery, asynchronous adapters, binary VFS/settings, actual File-menu ZIP download
and reopen, startup failures, HTTP reload persistence and external-script CSP.
The retained Validate workflow runs it in Chromium, Firefox and WebKit alongside
the existing single-file export/IDE suites. `VB6_OFFLINE=1` is an explicitly
supplemental local test mode; CI forbids using it instead of HTTP/file/CSP checks.
Reviewed generated-output fingerprints remain enforced by the normal build.
