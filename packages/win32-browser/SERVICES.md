# Common services — version 0.5.0

This release adds 86 export names (397 total, including ANSI/Unicode pairs), selected
as useful cross-area building blocks, not as an empirical ranking of API usage.
The implementation remains a zero-dependency, MIT-licensed browser compatibility
process. It runs independently, and the same package is embedded in the VB6 IDE,
SDK and published single-file HTML applications.

## Coverage and contracts

| Area | APIs | Scope |
| --- | --- | --- |
| File utilities | FindFirstFile/FindNextFile A/W, FindClose, GetFileSizeEx, FlushFileBuffers, GetFullPathName/GetTempFileName A/W | Existing private disk or supplied disk adapter; snapshot immediate-child enumeration; 32-bit WIN32_FIND_DATA A/W layout. |
| Encoding/environment | GetACP, IsValidCodePage, MultiByteToWideChar, WideCharToMultiByte, ExpandEnvironmentStrings A/W | UTF-8 and deterministic Windows-1252; explicit input counts, NUL-inclusive -1 conversions, size queries, strict invalid-sequence errors and private environment expansion. |
| Synchronization | Create/OpenEvent A/W, SetEvent, ResetEvent, Create/OpenSemaphore A/W, ReleaseSemaphore, WaitForSingleObject/WaitForMultipleObjects | Private named objects, access checks, reference lifetime, auto/manual events, semaphore counts, lowest-index wait-any and atomic wait-all. |
| Shell paths | PathFindFileName/FindExtension, Remove/RenameExtension, Add/RemoveBackslash, IsRelative/IsRoot/IsUNC, Canonicalize/Combine, FileExists/IsDirectory A/W | Lexical MAX_PATH helpers and queries against the private disk; never host filesystem or network discovery. |
| GUID values | CLSIDFromString, IIDFromString, StringFromGUID2, CoCreateGuid | Mixed-endian 16-byte GUID layout, canonical uppercase output, HRESULTs, Web Crypto random UUIDs. No COM activation or ProgID lookup. |
| Base64 | CryptBinaryToString/CryptStringToBinary A/W | Raw Base64, query and terminator counts, CRLF/LF/no-wrap output, whitespace decoding, bounded strict validation. Serialization only, not encryption or certificate support. |
| Registry | RegEnumValue/RegEnumKey/RegQueryInfoKey A/W, RegFlushKey | Private keys/values, name-character versus data-byte counts, case-preserved names, query rights, LSTATUS returns independent of last error. |
| Atoms/properties | GlobalAddAtom/FindAtom/GetAtomName A/W, GlobalDeleteAtom, SetProp/GetProp/RemoveProp/EnumPropsEx A/W | Private reference-counted atoms and registered-window properties, borrowed numeric data, retained name atoms, callback scratch buffers and automatic destruction cleanup. |

See [API.md](API.md) for the exact DLL/name/arity inventory. `A` functions default
to Windows-1252, `W` to little-endian UTF-16; that is not a claim about the browser
machine's native code page. Capacity units follow each API rather than one generic
string convention. `StringFromGUID2` returns 39 including the terminator;
`CryptBinaryToString` size queries include a terminator but successful output sizes
exclude it. Pointer-returning path helpers return offsets into the same allocation.

## Cooperative waits

```js
import { createWin32, WIN32_CONSTANTS as C } from '@vb6/win32-browser';
const win32 = createWin32();
const call = (name, ...args) => win32.invoke('kernel32', name, args);
const ready = call('CreateEventA', 0, 0, 0, 'Download.Ready');
try {
  const pending = call('WaitForSingleObject', ready, 1000);
  // A browser/host operation signals the same compatibility process.
  setTimeout(() => call('SetEvent', ready), 0);
  console.log(await pending === C.WAIT_OBJECT_0); // true
} finally {
  call('CloseHandle', ready);
  win32.dispose();
}
```

Zero-timeout waits return immediately; positive/infinite waits return promises and
do not block browser rendering. Wait-all does not consume any object until all are
ready. Closing a waited handle settles its pending wait with failure/error 6;
Windows calls this situation undefined, so this explicit cleanup rule is a browser
safety extension, not a measured Windows equivalence. Disposal settles pending
waits with error 995. Named objects are private to one `createWin32()` instance,
not cross-process or automatically shared between workers/tabs. Security attributes,
inheritance, native threads, mutex abandonment and waitable timers are not provided.

**VB6 execution is serialized.** The bridge awaits these promises; it does not run a
queued VB timer/input handler on top of the waiting VB stack. Use zero-timeout polls
from VB events, or a host JavaScript producer that signals the same API instance.
Do not wait forever for another queued VB event in the same VM. The synchronization
sample intentionally demonstrates polling, not an invented native thread scheduler.

## Six runnable VB6 samples

Choose the named example from the IDE or open its generated HTML directly. Click
**Run sample**; each sample can run repeatedly and releases its transient handles and
buffers. The status label explicitly signals completed Form_Load and event runs.

| Example | Project | Standalone HTML |
| --- | --- | --- |
| Win32 Files and Paths | `examples/win32-files.vb6web` | `dist/examples/win32-files.html` |
| Win32 Unicode and Base64 | `examples/win32-text.vb6web` | `dist/examples/win32-text.html` |
| Win32 Events and Semaphores | `examples/win32-sync.vb6web` | `dist/examples/win32-sync.html` |
| Win32 Registry Inspector | `examples/win32-registry.vb6web` | `dist/examples/win32-registry.html` |
| Win32 GUID Values | `examples/win32-guid.vb6web` | `dist/examples/win32-guid.html` |
| Win32 Atoms and Window Properties | `examples/win32-properties.vb6web` | `dist/examples/win32-properties.html` |

Sources are declared in `src/project/win32-service-examples.js` and are compiled as
normal VB6, not special JavaScript sample shortcuts. The common service functions
use ordinary Declare statements, fixed structures, Byte/Integer arrays and ByRef
outputs. The files/registry examples modify only their private sample paths/keys.
The independent JS example above needs no IDE or VB compiler.

## Bounds and explicit limitations

`maxFindEntries` defaults to 16,384 snapshot entries, `maxPendingWaits` to 1,024,
and `maxWindowProperties` to 1,024 per registered window. Existing memory, file-size
and handle quotas apply. Invalid pointers, unsupported flags and quota failures are
reported instead of granting extra browser or operating-system permissions.

File enumeration supports `*`, `?`, `*.*` and extensionless matching of trailing
`.*`; it does not reproduce every DOS wildcard/8.3-name rule. Its snapshot is stable
through later mutation, and unknown timestamps are zero. Private disk normalization
is case-insensitive and may lowercase file/path output. UNC/device access is rejected.
`FlushFileBuffers` invokes an optional adapter `flush(path)` or confirms immediate
memory-disk writes; it does not promise physical host disk durability. `RegFlushKey`
invokes the application's registry persistence hook, not an OS registry flush.
Registry security descriptors and native timestamps remain unsupported explicitly.

NLS supports UTF-8 and Windows-1252, not every ACP/OEM/DBCS page or native best-fit
mapping. Use `WC_NO_BEST_FIT_CHARS` for deterministic replacement. Base64 decoding
rejects malformed padding/trailing junk, including legacy permissive cases some
Windows versions accept; PEM/certificate/hex formats are not provided. GUID parsing
does not resolve ProgIDs. Shell paths implement the documented subset, not every
legacy malformed-path quirk or modern PathCch long-path feature.

Atoms and properties are isolated from host windows. Property values are borrowed
32-bit numbers, not managed object roots or native pointers. EnumPropsEx copies
entry names into temporary buffers, awaits the registered callback, and frees those
buffers; callbacks must not retain their pointers after returning. Window destruction
releases retained name atoms, never the application's borrowed data values.
Existing [advanced GDI limits](ADVANCED-GDI.md), the separate native AOT backend and
licensed-Microsoft-VB6 certification boundaries are unchanged.

## Validation and reproduction

```sh
npm run build
npm test
npm run pack:win32-browser
BROWSER=chromium python tools/browser-win32-services.py
# Windows PowerShell, from the repository root:
pwsh -File tools/win32-services-oracle.ps1
node tools/win32-services-contracts.mjs reports/win32-services-native/windows.json
```

The read-only common-services workflow requires all recorded native fields to match
and 21 real sample/IDE/SDK/worker cases per browser, without inline mode or skips.
The native probe invokes installed Windows DLLs, creates an owned message-only
window, and removes its temporary files/registry key. Comparisons normalize only
unobservable host identifiers/locations and compare deterministic outputs, not
physical timing. Pure unit tests also cover failure paths, private isolation, quota
behavior and repeat execution. Actual completed results belong in the PR validation
record; the presence of a workflow is not itself a pass.

## Primary contract references

Original implementations based on the Microsoft API descriptions, not copied SDK
source or redistributed binaries:
- [MultiByteToWideChar](https://learn.microsoft.com/windows/win32/api/stringapiset/nf-stringapiset-multibytetowidechar) and [WideCharToMultiByte](https://learn.microsoft.com/windows/win32/api/stringapiset/nf-stringapiset-widechartomultibyte).
- [WaitForMultipleObjects](https://learn.microsoft.com/windows/win32/api/synchapi/nf-synchapi-waitformultipleobjects).
- [FindFirstFile](https://learn.microsoft.com/windows/win32/api/fileapi/nf-fileapi-findfirstfilea) and [WIN32_FIND_DATA](https://learn.microsoft.com/windows/win32/api/minwinbase/ns-minwinbase-win32_find_dataa).
- [CryptBinaryToString](https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptbinarytostringa) and [CryptStringToBinary](https://learn.microsoft.com/windows/win32/api/wincrypt/nf-wincrypt-cryptstringtobinarya).
- [PathCombine](https://learn.microsoft.com/windows/win32/api/shlwapi/nf-shlwapi-pathcombinea), [PathRemoveBackslash](https://learn.microsoft.com/windows/win32/api/shlwapi/nf-shlwapi-pathremovebackslasha), [CLSIDFromString](https://learn.microsoft.com/windows/win32/api/combaseapi/nf-combaseapi-clsidfromstring).
- [RegEnumValue](https://learn.microsoft.com/windows/win32/api/winreg/nf-winreg-regenumvaluea), [RegQueryInfoKey](https://learn.microsoft.com/windows/win32/api/winreg/nf-winreg-regqueryinfokeya).
- [GlobalAddAtom](https://learn.microsoft.com/windows/win32/api/winbase/nf-winbase-globaladdatoma), [SetProp](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-setpropa), [EnumPropsEx](https://learn.microsoft.com/windows/win32/api/winuser/nf-winuser-enumpropsexa).
