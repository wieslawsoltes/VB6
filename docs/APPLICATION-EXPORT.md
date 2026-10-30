# Application export

The exporter packages the **full matching browser runtime**. It does not maintain
a separate reduced implementation of VB6 and does not tree-shake features based
on static source inspection. Existing `exportApplication(project, options)` calls
continue to produce a standalone HTML string.

## IDE and command line

Use **File > Make … .html** for a single file, or **File > Make Deployment Archive
(.zip)** for a verified deployable folder, or **File > Make Offline Application
(.zip)** for the installable/offline variant. A standard archive contains
`index.html`, `app.css`, `runtime.js`, `bootstrap.js` and `manifest.json`; offline
archives add the web manifest, worker, registration script and application icons.
Extract all files together; do not open the HTML inside an archive viewer. Both
archive commands are available in Design mode, prevent duplicate concurrent
exports, use the current classic/platform IDE menu appearance, and report
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
node tools/export-application.mjs examples/calculator.vb6web --format zip --offline --out Calculator-offline.zip
node tools/export-application.mjs examples/calculator.vb6web --format directory --deployment deployment.json --check
node tools/export-application.mjs Calculator-offline.zip --verify
node tools/export-application.mjs Calculator-app --verify --expected-build "$TRUSTED_BUILD_ID"
```

The CLI reads a canonical JSON `.vb6web` project. Import a classic `.vbp`, its
source files and binary sidecars in the IDE and save `.vb6web` first. It does not
silently normalize project names, IDs, themes or authored layout. `--options FILE`
accepts JSON runtime options, `--document FILE` accepts the document settings
below, and `--deployment FILE` accepts the asset/offline settings described below.
`--offline` is valid only for directory/ZIP output and conflicts with an explicit
`offline: false` in deployment settings. `--check` prints a JSON preflight report
and exits nonzero for errors; for directory/ZIP output it validates the complete
bundle and prints its verified manifest. `--verify` reads a directory or ZIP
without running application code and needs no generated runtime. It cannot be
combined with export flags. Failed verification exits nonzero.
Inputs are limited to 64 MiB per file. Output paths must not already exist,
including symlinks; there is no destructive overwrite switch. Parent directories
must exist. An I/O failure can leave incomplete newly-created output, which must
be reviewed before reuse; preflight errors create no output.

## Application desktop and private files

Standalone HTML and deployment archives include a desktop bar. After the last
form closes, **Launch application** starts it again without reloading the page.
The previous runtime is disposed before the new instance starts; private files
and application settings carry over in memory, including when browser storage is
denied or `persist: false` is selected. A hidden or minimized form still belongs
to a running application and does not enable a second instance.

**Private disk** opens the application's folders and files even after its forms
have closed. Use **Download** to copy a file to the operating system, or
**Download all (.zip)** to preserve the complete folder hierarchy, including
empty folders. Downloads preserve binary bytes and the Windows-1252 encoding of
VB text files. For example, Northwind's saved order is under `Orders`.

The private disk remains isolated from the operating system. Downloads require
an explicit button click; they do not grant the application access to other local
files. Download a copy before closing the browser page when persistent storage
is unavailable. Browser storage is scoped to the application's project identity
and browser origin; a downloaded copy is the durable backup.

Embedder integrations can set the runtime option `desktop: false` to omit the
bar. Authenticated IDE runtime frames omit it automatically, since their lifetime
belongs to the IDE. The exported `vb6RestartApplication()` function returns the
new host when the application has closed, or the existing host while it is still
running. Concurrent restart calls share one pending launch. Each completed
relaunch replaces `vb6ApplicationReady` and emits the usual `vb6:ready` event.

## Public APIs

```js
import {
  exportApplication, exportApplicationFiles, inspectApplicationExport,
  exportApplicationBundle, exportApplicationArchive, verifyApplicationBundle,
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
//                      dependencies, diagnostics and file byte counts (schema 1)

const bundle = await exportApplicationBundle(project, options, document, {offline: true});
const archive = await exportApplicationArchive(project, options, document, {offline: true});
// bundle.files: portable relative path -> UTF-8 string or Uint8Array
// bundle.manifest: schema 2 with SHA-256 fingerprints and buildId
// archive also contains bytes: Uint8Array (a deterministic STORE ZIP)
const verified = await verifyApplicationBundle(bundle.files, {
  expectedBuildId: bundle.manifest.buildId
});
if (!verified.valid) throw new ApplicationExportError(verified.diagnostics);
```

`jsonForHTML` and `RUNTIME_VERSION` remain available. The standard IDE also exposes
the files, bundle, archive, verification, inspection and factory APIs on
`VB6StudioAPI`. Existing HTML/files APIs stay synchronous with their schema-1
contract. New bundle/archive APIs are asynchronous and return schema 2; the CLI
and IDE archive commands use these new APIs.

The factory can be imported directly from `application-exporter.js`, without the
generated `runtime-payload.js` import. Supply `{runtimeSource, runtimeCSS, version,
compile}` to obtain `{inspect, html, files, bundle, archive}`. A custom runtime must expose
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
      globalThis.vb6ConfigureApplication = async ({project, options, runtime, signal}) => {
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
The hook also receives an `AbortSignal` that aborts on a non-cached page
departure; use it for cancellable initialization. Startup checks departure again
before mounting even when a hook ignores cancellation.
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
console.log(globalThis.vb6ApplicationStatus.phase); // loading, ready, error, disposed
addEventListener('vb6:message', event => console.log(event.detail));
addEventListener('vb6:ready', event => console.log(event.detail.host));
addEventListener('vb6:error', event => console.error(event.detail));
addEventListener('vb6:cancelled', event => console.log(event.detail));
addEventListener('vb6:lifecycle-error', event => console.error(event.detail));
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

Page lifetime is owned before asynchronous configuration/mounting starts. On
non-cached departure, pending readiness rejects immediately with `AbortError` /
`EXPORT_STARTUP_CANCELLED`; a host returned late is disposed exactly once and
never emits a false ready event. On `pagehide`, existing hosts save through their
persistence policy. Persistence failures emit `vb6:lifecycle-error` but do not
suppress disposal, including for failed startup hosts. Hosts and pending startup
are retained for a back/forward-cache entry.
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

HTML and split files are deterministic for the same project/options, document
settings and runtime payload. New deployment archives also have sorted paths and
a fixed DOS timestamp of 1980-01-01 00:00:00. The shared ZIP writer retains its
previous timestamp behavior unless `{reproducible: true}` is requested; native
source/project archive consumers are not silently changed.

The split format has no inline executable bootstrap/runtime scripts and does not
fetch project JSON. It supports an external-script CSP; styles, images, network,
workers or optional runtime services may still require their own policy rules.
It does not promise arbitrary restrictive CSP compatibility or offline data APIs.

## Portable assets and release verification

The fourth argument of `bundle`/`archive` (or `--deployment FILE`) has these keys:

```json
{
  "assets": {
    "data/catalog.json": "{\"items\":[]}",
    "images/example.bin": {"base64": "AP+A"}
  },
  "offline": {
    "name": "Orders",
    "shortName": "Orders",
    "display": "standalone",
    "themeColor": "#24364b",
    "backgroundColor": "#c0c0c0"
  },
  "dependencyPolicy": "warn"
}
```

Assets are copied verbatim and available at relative URLs. Text uses UTF-8;
binary descriptors use canonical padded base64. Packaging never fetches URLs or
rewrites arbitrary VB/HTML strings to point at assets. Use relative paths in your
application or trusted integration code. Keep secrets and private data out of all
packaged files: the entire static deployment is public, including offline caches.

The complete release is limited to **512 files and 64 MiB**, including generated
runtime, icons and manifest. Paths have at most 16 segments, 255 characters per
segment and 1,024 characters overall. Each segment starts with an ASCII letter or
digit and otherwise contains letters, digits, dots, underscores or hyphens.
Traversal, absolute paths, URL escapes/query/fragment markers, backslashes,
Windows device names, trailing dots, case aliases, file/directory collisions and
reserved generated names are rejected. Large base64 values are scanned linearly,
not with a recursive repeated-group expression. Unknown settings are errors.

`offline` defaults to `false`; `true` uses defaults. Display modes are
`standalone`, `minimal-ui`, `fullscreen` and `browser`. Colors use six-digit hex.
Optional `icons` descriptors contain `src`, `sizes`, `type` and optional `purpose`;
all sources must refer to explicitly packaged assets. Default icons are original,
deterministic 192/512-pixel RGBA PNGs and an SVG, not OS artwork or fonts. Supplying
icons replaces defaults. Browser installation UI/eligibility remains browser- and
platform-dependent; the exporter cannot force an installation prompt.

`dependencyPolicy: "error"` rejects projects with the preflight inventory's
external assets, services or Declare imports. The default is `"warn"`. This is
not arbitrary program analysis: dynamically constructed URLs and custom adapter
network calls cannot be proved offline by inspecting project configuration.

Schema-2 `manifest.json` lists every other release file in sorted path order with
its exact byte size and lowercase SHA-256. `buildId` is the SHA-256 of the compact
JSON encoding of those `{path, bytes, sha256}` records. The manifest excludes its
own bytes to avoid a self-hash cycle. Descriptive manifest fields (project labels,
diagnostics, dependency descriptions) are not authenticated by `buildId`.

`verifyApplicationBundle` checks exact inventory, sizes, hashes and build ID,
rejecting missing/additional/aliased files. It snapshots bytes before awaiting
hashes and does not invoke getters or execute project code. The CLI also rejects
symbolic links, special files and noncanonical ZIP entry names and bounds expanded
ZIP data. Directory verification applies the same aggregate limits. Supply an
independently trusted `expectedBuildId` to pin a release. Without that pin, a
self-consistent manifest detects accidental corruption, **not publisher identity
or malicious replacement**. This is not code signing or a digital signature.

## Offline installation, updates and hosting

Offline bundles add `app.webmanifest`, `service-worker.js` and
`offline-register.js`. Manifest identity, launch URL and scope are relative to
the deployment directory; the worker derives its actual scope from registration.
Different application directories on one origin have separate cache names.
Serve the complete directory over HTTPS, or a browser-trusted localhost origin.
Opening `index.html` directly via `file:` still runs the normal application, but
reports offline registration as unavailable rather than failing startup.

Serve JavaScript with an appropriate JavaScript MIME type, the web manifest as
`application/manifest+json`, and icons with their image MIME types. Do not rewrite
release bytes, substitute login/error HTML, redirect asset requests or mark these
public static resources `Cache-Control: no-store`. Install requests omit
credentials, reject redirects and verify decoded byte lengths and SHA-256
before any release cache is opened. Publish a complete version atomically; a
partial upload fails installation and leaves the prior release intact. Normal
HTTP compression is supported because hashes apply to decoded response bytes.

External scripts allow a `script-src 'self'` policy; offline use additionally
requires `worker-src 'self'`, `connect-src 'self'` and manifest/image rules. The
runtime may need inline style, data/blob image, font or application-service rules.
No arbitrary restrictive-CSP compatibility is claimed. For a static application,
a starting point to review for the actual host is:

```text
Content-Security-Policy: default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'
```

Registration begins only after successful application startup. Observe it through
`globalThis.vb6OfflineReady`, `globalThis.vb6OfflineStatus` and `vb6:offline` events.
Status phases are `registering`, `ready`, `unavailable`, `disposed` and `error`, with
`updateAvailable` and `error` details. The public promise rejects failed
registration/installation; an internal handler prevents unattended rejection.
`ready` means the release was installed, not that the current page was forcefully
replaced or that the user installed an OS application.

The first open page is **not claimed**. Reload after installation to obtain an
offline-controlled page. Updates install in a waiting worker and never call
`skipWaiting`, `clients.claim` or force reload; close all pages using that
application, then reopen to use the update. Application data is not migrated by
this mechanism; retain your existing compatible persistence policy.

Only explicitly packaged static files are cached. Unlisted API routes, remote
origins, POST requests, Authorization-bearing requests and byte ranges go through
the normal browser/network path. Only the directory entry and `index.html`
navigation (including launch queries) receive the application shell; missing API
routes never receive an HTML fallback. Cache-evicted files can be restored only
from the same release's verified bytes. A mismatched or unavailable response
returns 503 and requests update discovery rather than mixing releases. After
reconnecting, close all application pages and reopen a complete release.

The offline worker does not turn remote databases, credentialed APIs, native
providers or dynamic network operations into offline services. Those capabilities
retain their runtime/host requirements and diagnostics.

## Modules and validation

`diagnostics.js` owns structured errors; `serialization.js` owns portable copying
and JSON escaping; `preflight.js` owns validation/inventory; `document.js` owns
markup and document options; `bootstrap.js` owns the launch lifecycle;
`application-exporter.js` composes the reusable factory; `exporter.js` supplies the
full build-matched payload. `deployment-assets.js` owns portable asset limits;
`deployment-icons.js` generates original icons; `deployment.js` owns SHA-256
release packaging/verification; `offline-worker.js` owns emitted worker and
registration lifecycles. The IDE extension and Node CLI consume those APIs; the
CLI separates bounded local filesystem I/O in `application-deployment-files.mjs`.

```sh
npm run build
node --test tests/exporter-*.test.mjs
python tools/browser-exporter-tests.py
python tools/browser-exporter-offline-tests.py
npm test
```

The exporter browser suite covers every split catalog sample, the control/theme
gallery, asynchronous adapters, binary VFS/settings, actual File-menu ZIP download
and reopen, startup failures, HTTP reload persistence and external-script CSP.
The retained Validate workflow runs it in Chromium, Firefox and WebKit alongside
the existing single-file export/IDE suites. `VB6_OFFLINE=1` is an explicitly
supplemental local test mode; CI forbids using it instead of HTTP/file/CSP checks.
Reviewed generated-output fingerprints remain enforced by the normal build.

The separate offline browser suite uses a real origin and actual service workers,
network-offline reload/control input, update waiting/natural activation, sibling
cache isolation, corrupted upload recovery, version-mismatch eviction, file-origin
degradation and a real IDE download. It independently verifies ZIP bytes/hashes
and compares the browser archive byte-for-byte with Node CLI output. The suite is
registered in the three-engine `authoring-exports` CI group and refuses
`VB6_OFFLINE=1`; a policy-blocked local HTTP run is not offline-browser validation.
