# @vb6/win32-browser 0.6.0

A zero-dependency, MIT-licensed Win32 compatibility process for JavaScript browsers, module workers and Node.js. It does not require the VB6 compiler, IDE, a DOM framework or native DLLs. The same implementation is embedded in VB6 Studio's IDE runs, runtime SDK and single-file HTML exports.

**461 named exports**, including ANSI/Unicode variants and aliases. Version 0.6 adds 54 names for Gregorian/FILETIME conversions, aligned LONG operations, explicit locale/date/time formatting, private INI sections and bounded error-message formatting. Export presence does not imply every native flag, charset, structure or operating-system behavior.

## Build and install

From a repository source checkout (Node.js 22+):

```sh
npm run build
npm run pack:win32-browser
```

The installable archive is written under `release/`. Packaging verifies the committed output fingerprints, extracts the actual tarball outside the repository and runs the independent package test harness against it. No npm registry publication is performed.

```sh
npm install ./vb6-win32-browser-0.6.0.tgz
```

ES modules import `@vb6/win32-browser`; the standalone `dist/win32-browser.js` exposes `globalThis.Win32Compat`. Source checkouts must build first. Installable archives contain the full browser-global script and readable ESM sources.

## Independent usage

```js
import {createWin32} from '@vb6/win32-browser';
const win32 = createWin32({localeId: 0x409});
try {
  const pointer = win32.memory.alloc(4);
  win32.memory.writeI32(pointer, 41);
  const result = win32.invoke('kernel32', 'InterlockedIncrement', [pointer]);
  console.log(result); // 42
  win32.memory.free(pointer);
  console.log(win32.manifest()); // DLL, name, argument count, mode and exact notes
} finally {
  win32.dispose();
}
```

`invoke` returns each API's native-shaped return value. Implemented API failures set `lastError`; unknown DLLs/exports and invalid call arity throw explicit `Win32Error`s. Operations such as positive waits can return promises. Call `dispose()` to cancel pending work and release process-owned resources. See [foundation integration](FOUNDATION.md) for memory, windows, callbacks, file adapters and runtime ABI details.

## APIs and examples

[Complete generated inventory](API.md) lists every name, argument count, DLL and implementation mode. The public `manifest()` includes per-export restrictions.

[System services](SYSTEM-SERVICES.md) covers calendars, locale profiles, INI sections, FormatMessage and LONG operations. [Common services](SERVICES.md) covers file metadata, paths, UTF-8/Base64, synchronization, registry enumeration, GUIDs, task memory, atoms and window properties. Drawing contracts are in [GDI](GDI.md), [regions](REGIONS.md) and [advanced GDI](ADVANCED-GDI.md).

Eight ordinary VB6 service applications are included in the Studio catalog: Files and Paths, Unicode and Base64, Events and Semaphores, Registry Inspector, GUID Workbench, Window Properties, Calendar and Counters, and INI Sections and Messages. The separate Win32 API Workbench demonstrates primitive/bitmap/region/path/text drawing. Each is exported with the same complete runtime.

The independent JavaScript sample requires neither IDE nor compiler:

```sh
node node_modules/@vb6/win32-browser/examples/run.mjs
```

```js
import {runCommonServicesSample} from '@vb6/win32-browser/examples/common-services';
console.log(await runCommonServicesSample());
```

See [JavaScript sample contracts](JAVASCRIPT-SAMPLE.md). Repository `npm run test:sample-exports` downloads every catalog application from the actual IDE toolbar and reopens those exact bytes over HTTP and file origins. Remote REST/GraphQL examples still need their declared servers when requesting remote data; export is not a remote-data snapshot.

## Explicit compatibility boundaries

Memory, files, registry, environment, synchronization objects and window handles are scoped to the compatibility instance, not unrestricted host OS access. Interlocked operations are indivisible within its single JavaScript agent, not hardware fences on shared worker memory. Locale profiles are explicit en-US, en-GB and invariant; they are not inferred Windows user settings. FILETIME storage preserves 100 ns bits, while the default browser clock has only Date precision. Local-filetime bias uses the current offset, not historical DST rules.

Native DLL/COM activation, all locales/code pages, arbitrary process hooks and complete GDI/font/desktop-message behavior are not claimed. Unsupported options fail explicitly. Earlier release architecture and measured GDI differences remain documented in the guides. Conditional licensed/native/hardware tests do not certify unavailable platforms. No font files are distributed.
