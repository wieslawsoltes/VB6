# @vb6/win32-browser

A zero-dependency, MIT-licensed JavaScript compatibility process for commonly used
Win32 APIs. Use the ES module in a browser, module worker, or Node.js, or the
self-contained browser bundle. No VB6 compiler, IDE, DOM framework, native DLL,
server, or installation on the user's machine is required.

**Version 0.3.0 is a common-API foundation, not complete Win32 emulation.** Its 231
registered export names include ANSI/Unicode variants and aliases. An export's
presence does not imply support for every flag, message, structure, or operating
system behavior. See [the exact API inventory](API.md) and the boundaries below.

## Distribution

From the repository root:

```sh
npm run build
npm run pack:win32-browser
```

This produces `release/vb6-win32-browser-0.3.0.tgz`. Install that archive in another
project with `npm install /path/to/vb6-win32-browser-0.3.0.tgz`, or copy
`packages/win32-browser/src/` as an independent ES-module library. For a script tag,
copy `packages/win32-browser/dist/win32-browser.js`; its global is `Win32Compat`.
The archive includes the source, browser bundle, license, and API documentation.
The build does not publish anything to npm.

```js
import { createWin32 } from '@vb6/win32-browser';

const win32 = createWin32();
const buffer = win32.memory.alloc(64);
try {
  win32.invoke('kernel32.dll', 'WritePrivateProfileStringA',
    ['Preferences', 'Theme', 'Classic', 'demo.ini']);
  const copied = win32.invoke('kernel32', 'GetPrivateProfileStringA',
    ['Preferences', 'Theme', '', buffer, 64, 'demo.ini']);
  console.log(copied, win32.memory.string(buffer)); // 7, Classic
} finally {
  win32.memory.free(buffer);
  win32.dispose();
}
```

Plain JavaScript strings are accepted for input string pointers. Output buffers
are numeric pointers into `win32.memory`, not host pointers. `A` APIs use explicit
Windows-1252 by default; `W` APIs use little-endian UTF-16. Capacities are in the
units of the original function, generally characters for text and bytes for I/O.

## GDI bitmap support

Version 0.2.0 adds memory DCs, writable DIB sections, bitmap transfer and blitting,
15 raster operations, color-key/alpha blending, rectangular clipping and saved DC
state. Forms and picture boxes expose read-only `hDC`. See [GDI.md](GDI.md) for
formats, ownership, usage, quotas, Canvas2D fallback and explicit limitations.

## Regions and complex clipping

Version 0.3.0 adds 20 exports (231 total): rectangle-based region construction,
all five Boolean combinations, point/rectangle queries, RGNDATA interchange,
copied complex DC clips, and region painting. The immutable `RegionStore` is also
exported for independent JavaScript use. See [REGIONS.md](REGIONS.md) for API
contracts, coordinate semantics, resource quotas, native comparisons and limits.
Click **Region clipping** in **Win32 API Workbench** to run ordinary VB6 calls
in the IDE or exported HTML. The clip survives deletion of the original HRGN;
its excluded center remains untouched by the subsequent full-surface PatBlt.

## Process infrastructure

Every context has its own bounded byte-addressable memory, monotonically
allocated typed handles, registry, environment, timers, clipboard and API table.
DLL lookup is case-insensitive and tolerates paths and `.dll`; export names are
case-sensitive. Unknown modules and exports throw `Win32Error` with codes 126 and
127. Registered API failures use that API's return convention and set
`lastError`; registry functions return `LSTATUS` directly. `GetLastError` is local
to this compatibility process, not a real Windows thread.

Memory defaults to 32 MiB; file size defaults to 20 MiB; handles are limited to
16,384; timers to 1,024. Configure `maxBytes`, `maxFileBytes`, and `maxHandles` at
creation. All memory operations validate allocation boundaries. Freed storage is
zeroed before reuse. Addresses may be reused, as with a native allocator; stale
pointers must never be retained. Handles are not reused during a context's life.

`Sleep`, `MessageBox`, `SendMessage`, `EnumWindows` and `ShellExecute` can return
promises. Callers that do not statically know an API's return behavior should use
`await win32.invoke(...)`. `Sleep` yields to the browser instead of busy-waiting.
`dispose()` stops timers, aborts delays, and releases handles and memory. Do not
reuse a disposed context or retain a pointer past its documented lifetime.

### Register a window or callback

Windows are explicitly registered application objects, not desktop HWNDs. Only
these objects can be discovered or manipulated. Descriptors can wrap DOM controls,
canvas surfaces, another UI framework, or headless test objects.

```js
const input = document.querySelector('input');
const hwnd = win32.registerWindow({
  node: input,
  input,
  parent: 0,
  className: 'Edit',
  controlId: 100,
  getText: () => input.value,
  setText: text => { input.value = text; },
  getRect: () => input.getBoundingClientRect(),
});
await win32.invoke('user32', 'SendMessageW', [hwnd, 12, 0, 'Hello']);
win32.unregisterWindow(hwnd);
```

Use `registerCallback(fn, {onTimer})` for callback addresses. `onTimer` defaults to
`fn`; a language runtime can provide a queueing implementation. Enumeration
callbacks are awaited sequentially. Timer callbacks are coalesced while busy.
Unregistering a window cancels its timers and releases its DCs.

### Add another API module

```js
import { Win32Error } from '@vb6/win32-browser';
win32.register('example', 'CheckedSquare', n => {
  if (!Number.isSafeInteger(n)) throw new Win32Error('Invalid integer', 87);
  return n * n;
}, { arity: 1, failure: 0, mode: 'emulated', notes: 'Example host extension.' });
console.table(win32.manifest());
```

Extensions are trusted host code, not loaded from VB projects. Replacing a
registered export requires `replace: true`. `resolve()` exposes metadata for
signature validation before allocation or invocation.

## Implemented families

| Family | Implemented surface | Important boundary |
| --- | --- | --- |
| Kernel and memory | Error state, clocks, SYSTEMTIME/FILETIME, performance counters, MulDiv, cooperative Sleep, global/local allocations and locks, overlapping memory copy/fill/zero, string primitives | Virtual 32-bit addresses; process-relative clocks, browser precision |
| Files and settings | Synchronous private files, read/write/seek/truncate, sharing checks, directories, environment variables, INI strings/integers/enumeration/update/delete | Not the host disk; no devices, overlapped I/O, ACLs or IniFileMapping |
| Registry | Open/create/close/delete, set/query values, subkey enumeration, size probes, ANSI/Unicode text, binary/DWORD/QWORD | Per-app store; no OS registry, security, WOW64 views or notifications |
| User32 | Registered window discovery, text/class, visibility/enabled/focus, geometry, positioning, control IDs/user data, selected edit/button messages, callbacks/timers, RECT helpers | No desktop enumeration, subclassing, arbitrary messages or global hooks |
| GDI | Solid/null pens, brushes, selected stock objects, DCs, lines/rectangles/ellipses/pixels/text, selected device metrics | Memory DCs, 1-bit DDB/24-32-bit true-color bitmaps, DIBs, blits, alpha, saved state and complex region clipping; see GDI.md and REGIONS.md for the exact format/flag subset |
| Clipboard | Text formats, open/close/owner, ownership transfer, ANSI/Unicode synthesis, sequence and format enumeration | Private by default; no delayed rendering or arbitrary formats |
| Shell | Explicitly enabled URL opening | HTTP, HTTPS and mailto only; never executable launch |

### Browser permissions

No code reads the system clipboard automatically. To opt in, pass
`{allowClipboard: true, clipboard: navigator.clipboard}` and call
`readSystemClipboard()` or `writeSystemClipboard()` from a user gesture. Browser
permission, secure-context and activation restrictions still apply. These async
operations are separate from the synchronous, application-private clipboard APIs.

URL navigation is disabled unless both `allowNavigation: true` and an `openURL`
callback are supplied. The host callback is responsible for handling popup denial
and returns a truthy value only when it performed the navigation. Native process
launch, DLL loading, COM/OCX execution, filesystem access outside the private disk,
OS registry access and desktop input interception are not provided by this package.

Registry snapshots can be passed as `registry` and saved through
`onRegistryChange(snapshot)`. A `fs` adapter may replace the memory filesystem;
providing such an adapter is an explicit host capability grant, not an operation
a VB program can perform. `messageBox(text, flags, title)`, `window`, `clock`,
`now`, `onError`, and `onDiagnostic` provide additional host integration points.

## VB6 adapter

The repository's `src/runtime/win32.js` integrates this independent package with
browser IDE runs, the reusable runtime SDK, and single-file HTML exports.
`Declare` statements now compile into structured declarations. The adapter
validates arity, marshals typed scalar/array/UDT storage, handles call-site `ByVal`
for `As Any`, copies writable buffers back, and releases call-scoped allocations.
`Err.LastDLLError` mirrors the compatibility error state. Unsupported DLL/export
calls produce VB errors 48/453; unsupported ABI shapes produce error 49.

`Declare As String` retains VB6's ANSI convention, including `ByVal String` output
buffer copyback. It does **not** silently reinterpret a declaration as Unicode
because the export name ends in `W`. For Unicode entry points use explicit
Integer/Byte buffers or pointers obtained from the virtual allocator. Persistent
`VarPtr`/`StrPtr`/`ObjPtr`, SAFEARRAY/Variant native descriptors, BSTR/COM lifetime,
UDTs containing dynamic strings, unrestricted subclassing and ABI-compatible
native function pointers are not implemented.

Native numeric UDT fields use little-endian storage with alignment capped at four
bytes, distinct from the packed VB `Put` file representation. Fixed-length strings
and nested fixed records/arrays are supported. An array-element reference exposes
the remaining contiguous array; buffer overruns are rejected. Array aliasing across
different simultaneous references to the same storage is not yet fully modeled.

`AddressOf` supports standard-module callbacks with `ByVal Long` parameters.
Timer callbacks enter the existing VM event queue rather than reentering an active
VB stack. Visual, windowed controls expose read-only `hWnd`; windowless controls
return zero. Basic GDI line/rectangle/pixel commands use the existing
WebGPU/Canvas2D surface. Bitmap transfers use the explicit Canvas2D raster path
and forms/picture boxes expose read-only hDC. The standalone Canvas adapter additionally supports
ellipses and opaque text; unsupported surface operations fail explicitly.

Private registry data persists with application settings. Win32 file APIs share
the VB virtual disk; sharing is enforced between Win32 handles. Full cross-API
locking with concurrently open VB `Open` handles is not implemented.

Open **Win32 API Workbench** in the classic examples list, or run
`dist/examples/win32.html`. It uses ordinary VB declarations and demonstrates INI
buffer copyback, window handles, window text, enabled state and GDI drawing.

## Validation and reference contracts

`npm test --prefix packages/win32-browser` runs the independent API suite.
From the repository, `npm run test:win32-browser` adds compiler/VM tests and
`npm run test:win32-browser:browser` exercises exported apps, IDE execution,
modular runtime, browser global and module-worker usage. The CI browser matrix
uses Chromium, Firefox and WebKit. `VB6_OFFLINE=1` explicitly skips navigation and
module-import checks on systems whose browser policy blocks HTTP/file URLs; it
must not be used for release CI.

Implemented contracts are tested against documented behavior, not certified
against native VB6 on Windows. Reference specifications:

- [GetWindowTextA](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-getwindowtexta), [SetWindowPos](https://learn.microsoft.com/en-us/windows/win32/api/winuser/nf-winuser-setwindowpos), [GetLastError](https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror).
- [GetPrivateProfileStringA](https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getprivateprofilestringa), [CreateFileA](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-createfilea), [GetTickCount](https://learn.microsoft.com/en-us/windows/win32/api/sysinfoapi/nf-sysinfoapi-gettickcount).
- [Clipboard API restrictions](https://developer.mozilla.org/en-US/docs/Web/API/Clipboard_API).

The next compatibility layers are extended messages/control classes, richer
GDI text/fonts/palettes, curved/polygon region constructors and additional bitmap formats, broader file enumeration and locale/code-page behavior,
more registry APIs, pointer pinning and more complete native structure marshalling.
Extend the module table and shared tests instead of adding IDE-only shims.
