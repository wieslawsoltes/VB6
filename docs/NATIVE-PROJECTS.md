# Original VB6 projects and project groups

VB6 Studio Web can open native `.vbp` projects and `.vbg` project groups alongside `.vb6web`, `.vb6proj`, and recognized JSON browser snapshots. The native interchange layer preserves imported source and companion files rather than converting the entire project into freshly generated text on every save.

## Open a complete workspace

Use **File > Open Project** and select a ZIP containing the project tree, or select the project and its source/resource files together. **Open Project Folder** reads a user-selected directory where supported, with a directory-input fallback. Drag-and-drop accepts the same selected files and ZIPs. The native/web import dialog selects the entry project or group and the original source encoding. Importing never follows a path to an unselected file or downloads a dependency.

Include source files and their companions: `.frm/.frx`, `.bas`, `.cls`, `.ctl/.ctx`, `.pag/.pgx`, `.dob/.dox`, `.dsr/.dsx`, `.res`, `.vbw`, related documents and other project data. Arbitrary selected companion files are retained, including formats the browser cannot interpret. A folder scan skips `.git` and `node_modules`.

Relative paths are resolved case-insensitively inside the selected workspace. Keep the common parent directory when projects share files. An absolute, parent-escaping, or missing relative source reference can be relocated to a uniquely named file that was explicitly selected; diagnostics report the relocation and export updates that reference. Ambiguous or absent files are not guessed or fabricated. Missing entries and unparseable files remain in the native manifest, with diagnostics and a bounded read-only viewer for retained files that could not be opened as modules.

## Save without losing the original format

**Save Project** uses the active save format. Native imports initially save a ZIP of original-format files; browser snapshots initially save `.vb6web`. **Save Project As** offers a browser snapshot, native ZIP, or native folder. Explicit **Save Native VB6 Project**, **Save Native VB6 Folder**, and **Save Browser Project** commands are also available. A ZIP can be extracted and opened in the original IDE when its dependencies and features are supported there.

Browser snapshots retain the native preservation metadata and binary companions, so opening a snapshot and exporting native sources does not require importing the original files again. **Export Sources** includes both native files and a browser snapshot. Saving one source module includes available companions in a ZIP when needed.

Unchanged imported files are returned byte-for-byte, including their BOM, line endings, comments, attribute records and opaque data. Edited supported form properties and source text are patched into the original designer/source envelope. Membership additions, removals and path changes update the VBP while unrelated settings, duplicate records and vendor sections remain intact. **Project > Native Project Settings** edits native `key=value` settings, including duplicate records. Project name/startup, membership and references use their dedicated project tools or the project model APIs.

Hidden module, procedure and property-accessor attributes are retained and can be edited through module metadata. An edit that removes or renames a declaration owning hidden attributes is rejected unless the attributes are also removed or retargeted. Unsupported structured browser-only property values are rejected on native export instead of silently discarded; a browser snapshot remains available for such projects.

## Encodings and resources

Select the original Windows code page for projects created in another locale. Auto mode recognizes BOMs, treats non-ASCII valid UTF-8 as UTF-8, and otherwise defaults to Windows-1252; ASCII source also defaults to Windows-1252. Auto-detection cannot identify every legacy code page. UTF-8/UTF-16 and the listed Windows and East Asian encodings are supported. Unchanged bytes are retained even where multiple byte sequences decode to the same text. An edited character that cannot be represented in the selected encoding causes the whole native export to fail; it is never silently replaced with `?`. Unicode BOM support is an interchange feature, not a claim that every original VB6 installation accepts those encodings.

Known FRX-family text/list/image bindings and RES entries are decoded for the supported editors. Edited known FRX-family values are appended and their source offsets updated, leaving opaque portions intact. Unknown binary blobs remain unchanged. This is not a general editor for every OCX persistence format.

## Project groups

The project toolbar's **Active project in group** selector switches projects without discarding changes to peers. **Project > Project Group** selects the active and startup projects. Saving writes the group, its projects, shared source and retained companions together. A single changed copy of a shared file is used; divergent edits to the same shared path are rejected rather than resolved arbitrarily. Per-project undo history does not restore stale versions of other projects. The browser executes one active project at a time; it does not provide native cross-project COM debugging.

## Filesystem safety and limits

Folder writes require an explicitly granted directory handle. Output paths are validated before writing, and Windows-reserved names, traversal and case-insensitive collisions are rejected. All existing target bytes are compared before the first write and checked again before each file. Sources/resources are written before VBP files, and VBG files last. Unrelated destination files are not deleted. Cancelled or failed saves leave the project dirty, and choosing Save in a discard prompt only proceeds when saving succeeds.

A directory save is **not an atomic transaction**. Another process can change files during writing, and an I/O error can occur after some files have completed. Such failures report the number completed and keep the project unsaved. Review the destination before retrying; use a new folder or ZIP for an isolated export. A successful browser download means the download was initiated, not that the application can verify the user's eventual destination file.

Imports are bounded to 20 MiB per file, 50 MiB total and 2,000 files; groups are bounded to 32 projects and 50 MiB of referenced source across projects. Folder nesting is limited to 16 levels. Individual source modules and designer trees also have parser/normalizer limits. These are explicit safeguards, not unlimited project-size support.

## Compatibility boundary and validation

File preservation is separate from execution compatibility. The browser does not activate COM/OCX dependencies, install type libraries, or host proprietary designers. UserControl, PropertyPage and UserDocument source/envelopes are preserved with editable supported properties, but their native COM designer behavior is not implemented by this feature. Custom DSR designers are retained; unsafe edits are rejected. Missing dependencies still require the original files and environment. `.vbw` and other opaque companion state is preserved, not translated into full native IDE window state.

Run `npm test` for the complete regression suite, `npm run test:project-files` for focused interchange/filesystem tests, and `npm run test:project-browser` after `npm run build` for real browser import, editing and download workflows against HTTP and standalone `file://` builds. Set `VB6_BROWSER=firefox` or `webkit` for those engines. The directory integration test uses a real origin-private filesystem handle over HTTP; it does not automate an OS folder picker. `VB6_TEST_TRANSPORT=memory` is an explicitly separate sandbox smoke mode and does not certify HTTP or file-origin behavior.

Regression fixtures cover native byte preservation, project groups, encodings, attributes, resources, membership, folder conflicts and malformed input. No proprietary Windows VB6 IDE is bundled or run by these tests; passing them is not proof of universal or pixel-exact VB6 compatibility.
