# Native project compatibility review

## Scope and provenance

This audit starts from `92a955acd6ad0c21b41d43a606c9adcc5e16ff49` (the merged native-project, Win32 and server-only MCP work). It addresses project interchange rather than claiming complete VB6 language/runtime, COM or proprietary designer compatibility. All changes are additive to that integrated baseline.

## Reproduced gaps and fixes

| Area | Failure before the change | Corrected contract |
| --- | --- | --- |
| Hidden attributes | Edits inserted attributes between continued signature lines; Event/variable owners could be lost; same-named conditional procedures collided | Track logical declarations, accessor/branch ownership and all module variables; emit attributes after the complete declaration and reject stranded/ambiguous ownership |
| Fresh native export | A property's metadata could be duplicated across Get/Let, and unplaceable metadata silently disappeared | Emit once on the appropriate declaration; validate new export metadata rather than dropping it |
| Native path parsing | An apostrophe in an unquoted VBP/VBG filename was mistaken for a comment | Preserve embedded/leading apostrophes while retaining whitespace-delimited manifest comments |
| Resource relocation | Moving a form left an unchanged opaque FRX reference relative to the old folder | Record original references and source path, rebase retained references, honor explicit edits and reject a missing companion |
| Folder conflicts | The save plan forgot byte-unchanged dependencies after confirmation | Observe all output files, check them before mutation/manifest publication and verify final bytes, preserving unsaved state on conflicts |
| ZIP interoperability | Non-UTF-8 names were decoded as UTF-8; ZIP64 and legacy Unicode metadata were not supported | CP437, validated Unicode Path fields, bounded single-disk ZIP64 and streaming descriptors, without raising import limits |
| ZIP consistency | Local/central mismatches, descriptor errors and archive metadata were not fully preflighted | Check the complete directory and local records before inflating, reject unsafe aliases/overlaps and validate payload CRC/length |

The logical declaration mapper is not a compiler and does not evaluate conditional expressions. It distinguishes imported textual branch ownership. Editing a conditional structure so its original metadata owner cannot be identified is rejected. Unknown imported attributes can still be preserved byte-for-byte on a no-op save; modifying their source requires an identifiable owner or explicit metadata removal.

Old browser snapshots without the new resource-reference record use the retained VBP membership path when available. An old standalone snapshot lacking both original path and VBP membership cannot reconstruct an unknown original directory. The feature does not pretend otherwise.

## Regression and interoperability checks

The 64 new Node regressions consist of 26 source/project/resource cases, 34 ZIP cases and four directory concurrency cases. The full suite passes 1,334 tests on the audited baseline; no pre-existing test is removed. A before-change run of 80 audit/directory cases (prior to the last two additions) produced 49 failures and 31 passes, demonstrating regressions rather than only self-round-trip assertions.

The ZIP unit fixtures assemble records with independent test CRC/DEFLATE code. Browser fixtures are produced and inspected with Python's standard-library `zipfile`, including CP437 filenames, Unicode Path metadata and forced small ZIP64 members. Browser tests perform actual file-input import, visible code editing, native ZIP download, independent byte inspection and reimport. The native browser suite contains 32 HTTP/file-origin cases per engine, including the prior workflows; the OPFS directory test intentionally skips on file origins. A separate memory-transport smoke run does not certify HTTP or file-origin behavior.

The permanent Project compatibility workflow runs the complete Node suite, checks deterministic committed bundles, and runs these native workflows in Chromium, Firefox and WebKit. The pull request's exact-head runs are the authoritative CI record. Source/materialization workflows used to transfer a tested patch are temporary and must be removed before merge.

Reproduce from a complete checkout:

```sh
npm run build
npm test
npm run test:project-files
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium firefox webkit
VB6_BROWSER=chromium npm run test:project-browser
VB6_BROWSER=firefox npm run test:project-browser
VB6_BROWSER=webkit npm run test:project-browser
```

## Primary format references

- PKWARE, [APPNOTE 6.3.10](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT), sections 4.3 (records/descriptors), 4.5.3 (ZIP64), 4.6.9 (Unicode Path) and Appendix D (character encoding).
- Microsoft, [Too many line continuations](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/too-many-line-continuations), for physical versus logical declaration lines. This reference is shared-language context, not a claim of licensed VB6 compiler validation.
- Rubberduck maintainers, [VB_Attribute annotations](https://github.com/rubberduck-vba/Rubberduck/wiki/VB_Attribute-Annotations), for module/member, property and variable metadata conventions.

## Boundaries

Original VB6 IDE reopening/compilation with a licensed Microsoft installation, arbitrary COM/OCX persistence, cross-project COM execution and native IDE window-state restoration are not certified by this audit. ZIP64 support is deliberately bounded and single-disk; archive filename decoding cannot identify arbitrary unmarked legacy code pages. Folder saves still are not atomic transactions and cannot exclude an external change after the final check. Partial writes are reported, not described as rollback. Use ZIP or a new destination folder for isolated export.
