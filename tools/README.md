# Build and maintenance tools

Run commands from the repository root. Node.js 22 or newer is required for the
JavaScript tools. Browser tests additionally need Python, Playwright and the
selected browser; some visual suites also need Pillow. Native checks explicitly
require Windows and, where applicable, an installed compiler, provider or OCX.

## Everyday commands

```sh
npm run build
npm test
npm run serve
node --test tests/tooling-references.test.mjs
python tools/test-package-notices.py
```

[`package.json`](../package.json) is the command index. The build generates the
IDE, browser runtime, standalone examples and reusable browser bundles. Normal
builds verify the reviewed fingerprints in [`ide-artifacts.json`](ide-artifacts.json);
use `npm run build:update-ide-artifacts` only after reviewing intentional output
changes. See [artifact maintenance](../docs/IDE-BUILD-ARTIFACTS.md) and
[testing](../docs/TESTING.md) for the validation contracts.

## What belongs here

| Purpose | Retained tools and entry points |
| --- | --- |
| Build and serve | [`build.mjs`](build.mjs), [`bundle.mjs`](bundle.mjs), [`serve.mjs`](serve.mjs), theme/icon CSS generators, OCX lab builder and artifact verification. Their small helper modules are build dependencies, not spare scripts. |
| Other compiler targets | `npm run build:windows`, `build:classic`, `build:win32`, `build:compute` and `compile:compute`; PE inspection and native project snapshot/round-trip helpers. See [Windows builds](../docs/WINDOWS-BUILDS.md) and [Win32 AOT](../docs/WIN32-AOT.md). |
| Packaging | `npm run package`, [`verify-release.py`](verify-release.py), `npm run pack:layout` and `pack:win32-browser`. Release packaging requires the reports and assets described in [testing](../docs/TESTING.md); it is not a substitute for fresh validation. [`test-package-notices.py`](test-package-notices.py) checks license retention in source, browser, examples and runtime SDK ZIPs. |
| Local service companions | `npm run agent:relay`, `mcp:bridge`, `mcp:stdio`, `data:examples` and `data:gateway`, with their authentication, transport and provider modules. These are optional product features, not disposable test servers. |
| Browser regressions | The `browser-*.py`, agent, ChatGPT, compute, MCP, native-project and recovery suites; their fixture builders and shared harnesses. Use the `test:*:browser` commands in `package.json` or run the focused script directly. |
| Native and provider validation | `interop/`, `data/`, `conformance/`, native debugger smoke helpers, `test-win32-*.ps1`, `win32-*-fixtures.mjs`, contracts and Windows oracle scripts. Tests not scheduled in default CI remain useful for extending platform compatibility. |
| Maintenance and diagnostics | `npm run bench:layout`, `probe:launch`, [`vendor-sqlite.mjs`](vendor-sqlite.mjs), [`win32-api-inventory.mjs`](win32-api-inventory.mjs), [`test-native-host.mjs`](test-native-host.mjs) and [`test-portable.mjs`](test-portable.mjs). Preserve version/license verification and explicit platform requirements. |

## Focused checks worth keeping

The input/designer suites share the emitted application bundler and exercise
actual browser events. They can be run independently when changing those areas:

```sh
python tools/browser-form-input.py
python tools/browser-designer-selection.py
python tools/browser-editor-control-list.py
python tools/browser-editor-event-selection.py
python tools/browser-data-layout.py
```

Use `VB6_BROWSER` to select a supported installed browser and `CHROMIUM_PATH`
when using a system Chromium executable. The production desktop GPU probe is
[`desktop/gpu-probe.mjs`](../desktop/gpu-probe.mjs), covered by
[`native-gpu-probe.test.mjs`](../tests/native-gpu-probe.test.mjs). For packaged
application checks, keep the native-host and portable smoke tools rather than
copying the GPU implementation into a separate flag experiment.

Conformance generators and oracle verifiers are a related toolchain even when
not imported by JavaScript. For example, `conformance/vectors.mjs` produces the
inputs for `conformance/windows-oracle.ps1`; `conformance/verify-oracle.mjs`
checks evidence completeness and `conformance/check-scalars.mjs` compares the
supported scalar operations. An oracle report is not full VB6 certification.

## Cleanup policy

Keep tools that build, package, run, diagnose or validate a supported feature, or
reproduce compatibility evidence needed to extend it. Absence from default CI,
no npm alias, an old release number in a regression filename, or a platform
requirement does **not** make a tool obsolete. In particular, historical browser
suite names still run against current code; do not remove their coverage.

Before deleting a tool, inspect its callers, imported helpers, workflow and npm
references, documentation, and replacement regression coverage. Remove a retired
one-off delivery or exploratory script only when no maintained entry point needs
it. Update its dependent tests in the same commit. The Node tooling-reference
checks run in `npm test` and catch dangling literal npm/workflow paths and guide
links; generated paths and platform behavior still require integration testing.

Keep generated logs, screenshots and local experiments out of this directory.
Use the existing ignored output locations and CI artifacts. Historical release
reports and source-checksum snapshots are evidence, not a list of current tool
dependencies; new distributions generate their own source manifests. Source ZIPs
retain `packages/`, `desktop/`, workflow files and `.gitattributes` so builds and
validation can run after extraction. Local dependencies, native-build scratch
files, Python caches, environment secrets and local data profiles are excluded.

## Exact TUI reference acceptance

`python tools/tui_reference.py manifest.json --actual candidate --output report --revision <commit>`
compares owner-supplied static PNG captures without tolerance, masks, alignment,
rescaling or reference updates. Install the existing pinned authoring requirements
for Pillow. Candidate files are named `<fixture-id>.png`; reference paths are
relative to the manifest. The candidate and capture must show the same explicitly
identified state, content, dimensions and display configuration.

```json
{
  "version": 1,
  "fixtures": [{
    "id": "menu-open",
    "state": "File menu open; second enabled item focused; 80 columns by 25 rows",
    "reference": {
      "path": "references/menu-open.png",
      "sha256": "<actual 64-character lowercase SHA-256 of that PNG>",
      "width": 640,
      "height": 400
    },
    "cell": {"width": 8, "height": 16},
    "provenance": {
      "product": "<reference application>",
      "version": "<exact version>",
      "platform": "<OS, display mode and scale>",
      "method": "<capture method and relevant configuration>",
      "source": "<authorized capture origin>"
    }
  }]
}
```

Placeholders above are deliberately not valid acceptance evidence. Supply an
actual reference image and digest. The tool does not download or generate native
references, redistribute vendor assets, authenticate declared provenance, or infer
whole-product parity from a few matching images. Capture provenance and fixture
coverage require independent review.

Each report records the candidate revision, manifest/reference/candidate digests,
exact changed-pixel and changed-cell counts, difference bounds and a diagnostic
mask. RGB and alpha are checked separately, including RGB differences under zero
alpha. Different dimensions fail rather than being normalized. A missing or
modified reference fails rather than skipping or updating a golden. Empty suites,
escaping paths, oversized images, output links onto input evidence and duplicate
fixture IDs are rejected. Exit status is 0 for all listed pairs equal, 1 for
comparison or missing-evidence failure, and 2 for invalid invocation/manifest.
No input or report path should be concurrently changed while a comparison runs.

`tools/ci/test_tui_acceptance.py` checks admission with only the Python standard
library. `tools/dos_precision_checks.py`, owned by the existing DOS browser suite,
checks actual Canvas2D partial-frame recovery and the comparator against explicitly
synthetic images. Its expected pixels are regression fixtures, **not native-vendor
reference captures**. Existing cross-engine and native acceptance remain separate.
