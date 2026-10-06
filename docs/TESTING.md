# Testing and validation

Run commands from the repository root. The source build requires **Node.js 22
or later** and has no root npm dependencies. Python and Playwright are needed
for browser checks; desktop and installed-provider tests have separate
prerequisites. Start with the [documentation index](README.md) for each subsystem.

## Build and portable tests

```sh
npm run build
npm test
python tools/test-package-notices.py
```

`npm test` runs the root `tests/*.test.mjs` suite; its pretest hook also rebuilds.
Builds verify generated IDE/runtime/sample bytes against the reviewed artifact
manifest. A second build must not alter tracked generated output:

```sh
npm run build
npm run verify:ide-artifacts
git diff --exit-code -- dist src/exporter/runtime-payload.js src/editor/diagnostics-payload.js examples
```

See [build artifact maintenance](IDE-BUILD-ARTIFACTS.md) before changing expected
fingerprints. Never update expectations just to make a failed build pass, and
never substitute stale prebuilt bundles for the changed source.

## Browser setup and checks

Use the Playwright version pinned in the checked-in
[validation workflow](../.github/workflows/validate.yml):

```sh
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium firefox webkit
npm run build
```

Some legacy Chromium runners require an explicit executable path. In a POSIX
shell, resolve the installed Playwright executable rather than assuming a path:

```sh
export CHROMIUM_PATH="$(python -c 'from playwright.sync_api import sync_playwright; p = sync_playwright().start(); print(p.chromium.executable_path); p.stop()')"
```

Core IDE/runtime checks used by the validation workflow:

```sh
python tools/browser-tests.py
python tools/browser-parity-tests.py
python tools/browser-features-04.py
python tools/recovery-browser-tests.py
python tools/browser-finalization-05.py
python tools/browser-boundaries-06.py
```

Historical suffixes in tool names do not make their current regression coverage
obsolete. Keep tests that exercise existing behavior. The active browser matrix
also exercises detached windows, IDE/application themes and exact downloaded
sample exports. Run it locally in a POSIX shell with:

```sh
for engine in chromium firefox webkit; do
  VB6_BROWSER="$engine" npm run test:windows
  VB6_BROWSER="$engine" npm run test:themes:browser
  VB6_BROWSER="$engine" npm run test:application-themes:browser
  VB6_BROWSER="$engine" npm run test:sample-exports
done
```

On PowerShell, assign `$env:VB6_BROWSER` before invoking a command. Harnesses
that take `--engine` instead of `VB6_BROWSER` document that interface in their
subsystem guide. Run `npm run test:visual` for visual interactions; golden-image
comparison needs the matching browser/font environment and an explicit review
of any changed baseline. See [visual validation](VISUAL-AUDIT.md).

## Select checks for the changed subsystem

Always run the portable suite, then the relevant integration checks. These are
entry points, not a claim that every suite runs in CI:

| Change | Portable checks | Integration guide/checks |
| --- | --- | --- |
| Language/runtime/debugger | `npm run test:debugger` | [Debugger](DEBUGGER.md), [extensions/native debugger](DEBUGGER-COMPATIBILITY.md) |
| Native files and save recovery | `npm run test:project-files`; `npm run test:interop` | `npm run test:project-browser`; [workspace/host setup](NATIVE-WORKSPACE-INTEROP.md) |
| Data providers and binding | `npm run test:data` | `npm run test:data:browser`; [installed-provider requirements](DATA-SOURCES.md) |
| Native builds and Win32 ABI | `npm run test:native`; `npm run test:win32` | [AOT](WIN32-AOT.md), [Windows targets](WINDOWS-BUILDS.md), [target validation](NATIVE-VALIDATION.md) |
| Browser Win32 package | `npm run test:win32-browser` | `npm run test:win32-browser:browser`; [package contracts](../packages/win32-browser/README.md) |
| Agents and sign-in | `npm run test:agents`; `npm run test:chatgpt` | `npm run test:agents:browser`; `npm run test:chatgpt:browser` |
| MCP server | `npm run test:mcp` | `npm run test:mcp:browser`; `npm run test:mcp:agent` |
| Layout extensions | `npm run test:layout` | `npm run test:layout:browser`; `npm run bench:layout` |
| Compute compiler/runtime | `npm run test:compute` | `npm run test:compute:browser`; [compute package](../packages/vb6-compute/README.md) |

`package.json` owns command definitions. The checked-in workflow owns the CI
matrix; removed workflows are not implicit merge gates. Specialist guides may
require additional OS, provider, graphics or native-toolchain checks that are
not covered by the default workflow.

## Evidence and compatibility boundaries

Record the exact source revision, commands, browser/OS versions, results and
skips in the PR or CI artifacts. Inspect checks for the final combined revision
before merging; results for an earlier branch or a pre-integration source ZIP
are not a substitute. Do not copy changing test totals into this guide.

Keep these distinctions explicit:

- Inline or memory-transport browser smoke is not HTTP/file-origin deployment
  evidence. Blocked navigation and unsupported filesystem APIs are not passes;
  OPFS tests do not automate a physical OS folder picker.
- Own screenshot goldens are not Microsoft VB6 reference pixels. Physical
  devices, native IME, fonts, accessibility and native controls need their own
  evidence. A software GPU or Canvas2D pass is not hardware WebGPU certification.
- Browser adapters and transport fixtures are not installed COM/OCX/provider or
  CDB execution. Test native architectures and installed dependencies separately.
  Licensed VB6 compilation needs an owner-supplied installation; staging, mocks
  and skipped licensed tests are not native compiler certification.

Release packaging requires its configured validation inputs; packaging success
only proves archive construction. It does not rerun tests or make an old report
current. Source archives generate their own `SOURCE-SHA256SUMS.txt`; use that
manifest to verify the bytes in that archive. Preserve license notices in source,
SDK, browser and example archives. See [compatibility](COMPATIBILITY.md) and
[build artifacts](IDE-BUILD-ARTIFACTS.md) for the remaining boundaries.
