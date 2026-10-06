# Calendar, locale, INI sections and messages (0.6.0)

This layer adds 54 registered export names to the independent package. ANSI/Unicode variants and legacy aliases count separately. It shares the existing bounded memory, error conventions and lifetime model with IDE runs, the runtime SDK and single-file HTML exports. No native DLL, unrestricted host resource, cross-process synchronization or full Win32 equivalence is implied.

## Calendar and integer operations

`SystemTimeToFileTime`, `FileTimeToSystemTime`, `CompareFileTime`, `DosDateTimeToFileTime`, `FileTimeToDosDateTime`, `FileTimeToLocalFileTime`, `LocalFileTimeToFileTime`, and `GetSystemTimePreciseAsFileTime`.

FILETIME storage, comparisons and bias arithmetic use BigInt, preserving all 100 ns bits. SYSTEMTIME conversion intentionally discards sub-millisecond units. Gregorian validation rejects impossible dates; input day-of-week is ignored and output day-of-week is recomputed. Calendar conversion accepts the documented positive signed FILETIME range and SYSTEMTIME years 1601–30827. DOS conversion uses the 1980–2107 packed format, with upward two-second quantization; boundary behavior is regression-tested locally, not newly certified on Windows.

The two local FILETIME conversions use the **current** UTC-minus-local offset, or explicit `timeZoneBiasMinutes`. They do not implement historical DST rules. The `Precise` API defaults to one JavaScript Date snapshot (millisecond resolution): its name does not manufacture a higher-resolution host clock. An embedder can supply `nowFileTime: () => bigint` for an exact clock source.

`InterlockedIncrement`, `InterlockedDecrement`, `InterlockedExchange`, `InterlockedExchangeAdd`, `InterlockedCompareExchange`, `InterlockedAnd`, `InterlockedOr` and `InterlockedXor` operate on aligned 32-bit LONG storage. Increment/decrement return the updated value; the others return the original value. Arithmetic wraps to signed 32 bits. Operations cannot yield within one compatibility instance, but its memory is private, not SharedArrayBuffer-backed; these calls do not claim hardware fences or native cross-thread/process atomicity.

## Explicit locale profiles

`GetDateFormatA/W/Ex`, `GetTimeFormatA/W/Ex`, `GetLocaleInfoA/W/Ex`, default LCID/LANGID/name queries, `GetThreadLocale`, `SetThreadLocale`, `IsValidLocale`, `LCIDToLocaleName` and `LocaleNameToLCID` support **en-US (0x409), en-GB (0x809) and invariant (0x7f)** profiles. The default is en-US unless `localeId` is explicitly supplied. It is not inferred from the browser or advertised as the host Windows user locale. Thread locale is instance-local.

Count-zero output queries return the required count including NUL. Successful date/time output counts also include NUL. W capacities count UTF-16 code units; A capacities count configured ANSI bytes. `LOCALE_RETURN_NUMBER` writes a DWORD and uses the documented A=4/W=2 count. Invalid flags, unknown locales/types and undersized buffers fail explicitly before output mutation.

Supported pictures include numeric and English named day/month/year fields; hour/minute/second/AM-PM fields; quoted literals and doubled apostrophes. Date formatting ignores SYSTEMTIME time fields; time formatting ignores date fields. Default short/long/year-month date styles and default time field suppression are supported. Alternate calendars, era names, OS overrides, arbitrary locales, dynamic enumeration, custom-picture suppression and every native flag are not implemented. These are deliberately stable portable profiles, not a silently approximated general NLS layer.

## Private complete-section INI operations

`GetPrivateProfileSectionNamesA/W`, `GetPrivateProfileSectionA/W`, `WritePrivateProfileSectionA/W`; plus `GetProfileStringA/W`, `GetProfileIntA/W`, `WriteProfileStringA/W`, `GetProfileSectionA/W`, `WriteProfileSectionA/W`.

These use the same parser and storage as the existing individual-key private-profile APIs. Section input/output is NUL-separated with a final extra NUL. Full-section writes validate the complete input before replacing any data. Truncation returns capacity minus two and preserves double termination. Null section input deletes; an empty double-NUL list retains an empty section. Names are case-insensitive. Unrelated sections remain intact. Existing UTF-16LE-BOM files retain Unicode; new files default to the package ANSI codec. Malformed Unicode, unterminated lists and quotas are rejected without a partial file write.

Bare private-profile names and legacy WIN.INI resolve within the compatibility instance's private Windows directory. No host WIN.INI, registry IniFileMapping, cross-process transactions, comment-preserving whole-section replacement or complete duplicate-section behavior is claimed.

## FormatMessageA/W

Supports `FROM_STRING` and a selected portable English `FROM_SYSTEM` error table, `IGNORE_INSERTS`, `ARGUMENT_ARRAY`, `ALLOCATE_BUFFER`, width zero/255 and percent escapes. Insert arguments are **32-bit virtual DWORD_PTR arrays**. String and signed/unsigned/hex integer inserts support bounded literal widths; string precision is supported. Native va_list, module resource tables, star widths, wide/ANSI cross-conversion specifiers, 64-bit inserts and automatic line wrapping are explicitly unsupported.

Direct output validates capacity before writing. Allocated output writes an allocation pointer through the supplied DWORD pointer and must be freed with `LocalFree`. Invalid output pointers, unknown message IDs (317), missing message language (1815), quotas and unsupported operations do not leak allocations or overwrite output with partial text. The buffer is bounded to 64 KiB. Successful return excludes the final NUL. System language accepts zero or 0x409; a literal template does not require a system message language.

## Samples and export validation

**Win32 Calendar and Counters** demonstrates ordinary VB6 SYSTEMTIME/FILETIME declarations, exact roundtripping, formatted dates/times and an interlocked ByRef LONG. **Win32 INI Sections and Messages** writes/reads a NUL-separated section and copies/frees a LocalAlloc-owned system message.

All eight service examples are exercised twice by compiler/VM tests with transient handle/memory cleanup. `npm run test:sample-exports` drives the actual IDE export toolbar for **every authored catalog example**, captures its browser download, compares the embedded project to the current IDE project and reopens the exact downloaded bytes over HTTP and file origins. It exercises the eight services and all Workbench graphics buttons, and checks self-contained startup for other examples. External REST/GraphQL examples still require their declared servers when the user requests data; export does not turn remote services into offline snapshots.

The retained Validate browser matrix runs this test in Chromium, Firefox and WebKit. `VB6_OFFLINE=1` exists only for local supplemental inline checks and is prohibited in GitHub Actions. It reports `realOriginVerified:false`; it is not a substitute for actual origin tests. Download checksums, output values, screenshots and result JSON are retained, not dozens of duplicate HTML binaries.

## Reproduction and primary contracts

```
npm run build
npm test
npm run pack:win32-browser
VB6_BROWSER=chromium npm run test:sample-exports
```

Installable archives retain the standalone script even though its two repository copies are now generated, just like the main runtime. Both copies have committed byte-length/SHA-256 expectations, checked on every build and before packaging. The existing public ESM/global export-parity test remains enabled. Normal build/CI cannot refresh its own expectations.

Primary Microsoft contracts (consulted October 6, 2026):
- https://learn.microsoft.com/en-us/windows/win32/api/timezoneapi/nf-timezoneapi-systemtimetofiletime
- https://learn.microsoft.com/en-us/windows/win32/api/timezoneapi/nf-timezoneapi-filetimetosystemtime
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-filetimetodosdatetime
- https://learn.microsoft.com/en-us/windows/win32/sysinfo/file-times
- https://learn.microsoft.com/en-us/windows/win32/api/datetimeapi/nf-datetimeapi-getdateformatw
- https://learn.microsoft.com/en-us/windows/win32/api/datetimeapi/nf-datetimeapi-gettimeformatw
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-getprivateprofilesectionnamesw
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-writeprivateprofilesectionw
- https://learn.microsoft.com/en-us/windows/win32/api/winbase/nf-winbase-formatmessage

New tests are implementation/reference-contract tests, not a new native Windows differential certification. Existing documented GDI, native backend and compute limitations remain unchanged. No npm registry publication or fonts are included.
