# Native workspace validation checkpoints

## Source integration

PR #17 extends the interchange work from #1 and #12. Its reviewed integration commit is `0d9b79ecd353223b0fbfdbe9c82cedb16aa5bfb2`, including main `48442f0b925dc3c136b1a0b74184f31f4d6263c2`.

The merged source retains both Automation and DAO default-member dispatch and both trusted control adapters and disabled/nonvisual-control selection. Build products were regenerated rather than choosing one side's stale bundles. The independently rebuilt local checkout and downloaded CI integration agree on every source, test and generated file; only the temporary publication workflow differed. That workflow is removed in the final documentation/cleanup commit.

## Reproduced defects resolved

- The real Windows MSXML chain `doc.documentElement.text` originally returned an intermediate callable instead of its object-valued property. Three compiled-VB regressions cover chained reads, nested writes, With receivers and object identity. The native system test then passed on x86 and x64.
- Restoring a native save journal changed disk content without invalidating the IDE's prior saved JSON. Recovery now invalidates it before writing, keeps discard protection on partial failure and rechecks design mode after user confirmation. The browser regression recalculates dirty state after rollback rather than checking a transient flag alone.

## Executed checkpoints

| Check | Result |
| --- | --- |
| Integrated Node regression suite | 1,819 passed; zero failures/skips |
| Focused project/workspace/recovery/archive/snapshot suite | 217 passed |
| Automation and trusted-control adapter suite | 54 passed |
| Local new-feature browser smoke in memory transport | Four passed |
| Original/round-tripped native and p-code staging | Four variants; source bytes preserved; compiler/IDE not run |
| Immutable native ZIP snapshot | Independently readable with Python zipfile; no CRC errors |

Source integration/build/tests: https://github.com/wieslawsoltes/VB6/actions/runs/37308811469

Earlier actual x86/x64 system Automation and ActiveX checks: https://github.com/wieslawsoltes/VB6/actions/runs/37305180433

Those native reports distinguish the JavaScript VB compiler/runtime driving installed Windows components from licensed Microsoft VB6 execution. The ActiveX report covers an installed Shell.Explorer.2 AxHost window, inspected type information, native property setting, idle STA pumping and release; it does not navigate to network content.

The final PR's checks and conversation record are authoritative for the exact final head and subsequent merge. The checkpoints above do not predeclare later workflow results.

## Reproduce

```sh
npm run build
npm test
npm run test:project-files
npm run test:interop
VB6_BROWSER=chromium npm run test:project-browser
VB6_BROWSER=firefox npm run test:project-browser
VB6_BROWSER=webkit npm run test:project-browser
```

On Windows, set `VB6_COM_ARCH` to `x86` or `x64`, then run `npm run test:interop:windows` and `node tools/interop/test-activex.mjs`. These tests explicitly opt into native code. The owner-run licensed harness and its consent requirements are documented in `NATIVE-WORKSPACE-INTEROP.md`.

## Scope and explicit skips

Local browser policy blocks HTTP/file navigation, so local memory smoke is not substituted for permanent CI's real-navigation matrix. Browser folder/recovery tests use writable origin-private filesystem handles over HTTP; file-origin directory cases and platforms without those APIs are explicit skips, not OS-picker certification.

No licensed Microsoft compiler/IDE run has been performed at these checkpoints. The manual main-only licensed job needs an owner-configured trusted runner. Arbitrary COM vtables, connection-point event sinks, proprietary persistence wrappers, native reference-count timing, machine-specific IDE/tool state, physical GPU behavior and atomic multi-file filesystem transactions are not certified by these tests. See the feature guide for implemented contracts and safety boundaries.
