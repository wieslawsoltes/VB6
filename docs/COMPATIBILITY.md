# Compatibility contract — 0.6.0

This release implements an independent HTML/CSS/JavaScript IDE, source runtime and browser control library. It does **not** deliver the Microsoft IDE, `msvbvm60.dll`, registered OCX binaries or a fully compatible replacement for all three original VB6 deliverables. Familiar control names, successful parsing and passing regressions do not establish complete product compatibility.

## Language/runtime

| Area | Implemented | Still incomplete or different |
|---|---|---|
| Compilation | Tokenizer, expression parser, instruction compiler, source lines, module/class/form procedures, declarations and diagnostics; conditional directives, project constants and module-scoped DefType letter ranges. | Complete VB6 grammar/binding/accessibility, every compile-time rule, native machine code/P-code, type libraries, full conditional-expression compatibility. Some errors are caught during execution rather than static binding. |
| Values | Numeric and string coercions, fixed strings, distinct Nothing/Null/Empty/Missing, checked Variant/Error, integer ranges and backed Currency. | Complete tagged Variant subtypes, all promotion/coercion rules, locale behavior, exact floating/date/native currency conversion edge cases. Plain numeric rvalues still lose some native subtype identity; for example TypeName may report Double for a declared Integer value. Mixed Currency/non-Currency calculations may use binary floating point. |
| Arrays and records | Bounds, ReDim/Preserve, Erase, value copying, typed UDT arrays and returns, nested fields and binary record encoding; stable ByRef record-field storage. | All native SAFEARRAY flags/locks/lifetimes, fully qualified UDT binding, every UDT-to-Variant rule, all exceptional alias/lifetime cases and unrestricted native memory layouts. Browser allocation/depth limits apply. |
| Procedures | Subs/functions/properties, recursion, named arguments for supported signatures, distinct omitted optional values/defaults, ParamArray, ByRef/ByVal paths, instance statics, errors, common control flow, With and Select Case. | Every native signature/default-member/member-access edge case and unexposed adapter/native named parameters. UDT/typed-array ByVal is explicitly rejected; Variant arrays use value copies. |
| Objects | Classes, fields, methods, properties, TypeOf checks, lazy As New recreation, initialization, Collection/Dictionary adapters and guarded CallByName, validated project-defined Implements contracts, interface identity/dispatch and supported VB_UserMemId default members. | Native COM interfaces/vtables, reference-counted termination/cycles, native factories, every default-instance lifetime rule, arbitrary COM creation or DLL calls. |
| Events | Form/control handlers, indexed handlers, declared events, class and Automation WithEvents, shared ByRef cancellation, and default outgoing IDispatch connection points in the opt-in Windows host. | All outgoing/vtable interfaces, exact native ordering, every control sink and complete apartment/message-loop parity are not certified. See [OCX support](OCX-SUPPORT.md). |
| Files | Private text and binary disk, sequential and random modes, typed Get/Put, record lengths, seeks, copy/rename, access/locking checks and byte snapshots. | No host-drive/device mapping, OS locks, cross-tab coordination, every binary Variant/UDT layout or code page. Windows-1252 is the implemented byte-text encoding. |
| Scheduling/forms | Cooperative instruction execution, timers, DoEvents, modal pumping, Show/Hide, Load/Unload, QueryUnload cancellation, form collections and runtime MDI parent/child windows with coordinated unloading. | Default form instances still initialize eagerly; last-form unload does not automatically End. Full native ownership/activation/termination, all MDI activation, ownership, menu-merge and thread/apartment behavior remain incomplete. |
| String statements | Mid/Mid$ assignment, UTF-16 spans without expansion, string LSet/RSet, explicit string-returning intrinsic aliases. | UDT-overlay LSet/native memory operations, full ANSI/code-page and every fixed-string coercion rule. |
| Calendar | Gregorian DateAdd/DateDiff/DatePart, civil week rules, leap/month clamping, DateSerial/TimeSerial, OLE negative fractions and matching date binary codec. | Full Windows NLS, Hijri and locale/system-default settings; exact local-date parsing across all locales. System defaults here use invariant Gregorian/en-US conventions. |
| Libraries | Many common string, math, date, conversion, format, Err/Debug/App/Screen and collection functions. | Not the entire original runtime library or OS abstraction. Localization and all side-effect/error cases are not differential-tested against native VB6. |

## IDE and debugger

The classic shell, menus/toolbars, Project Explorer, property grid, form designer, menu editor, source navigation, project dialogs and HTML exporter work. Designer selection, drag/resize, nested containers, snapping, alignment, tab order, clipboard and undo/redo are implemented. Source highlighting and completion are lexical; they are not a complete semantic IntelliSense/refactoring engine.

The debugger supports conditional breakpoints, stepping, locals, stack, watches, Immediate evaluation/assignment, compatible paused source edits and guarded Set Next Statement. Live edits preserve active storage only when the compatibility planner accepts the change. Incompatible active topology/signature/layout changes require stopping. Relocation stays inside an eligible current procedure and does not cross unsafe compiler regions. Explicit paused function/adapter evaluation is supported with independent instruction/time budgets, cancellation and error-context restoration. Automatic inspection remains side-effect-free. Straight-line suspended instruction/caller remapping is supported; unsafe topology/storage changes still require restart. Side effects of explicit evaluation are retained, not rolled back. Native thread stacks, instruction-address breakpoints, native debug formats and unrestricted evaluation/relocation are absent.

IDE MDI documents and tool windows support four-edge docking, linked tabs, in-page floating/resizing, cascade/tiling, customizable command bars and independent debugger panes. Complete window profiles additionally retain toolbar order, project-specific MDI bounds, split/procedure views, logical selections and scroll offsets. Import is validated atomically, with limits on profile/file size. Profiles also retain detached browser-window geometry. Reload/restore docks panes safely and offers one-click reopening per window rather than bypassing popup policies. A separate HTTP-origin browser suite covers persistence and lifecycle. IDE tool groups, documents, modeless tools and command bars support real top-level browser windows; native chrome and final placement remain browser/OS controlled. Runtime MDIForm child windows remain within the runtime page, independently of IDE detachment. See [Browser windows](BROWSER-WINDOWS.md). Registered modeless project tools reopen from same-project profiles; cross-project profiles do not reopen those tools.

Unimplemented native MDI details, native UserControl/UserDocument and report/data-environment designers, native add-ins, arbitrary type libraries, every original command/dialog and unrestricted workspace behavior remain unfinished. Form-designer changes are disabled during execution. The project tree and whole designer are not virtualized for arbitrary project sizes.

The editor retains one complete canonical module string and one or two logical full/procedure/declarations views. Large-module native input is bounded to a window (tested at 50,000 lines and no more than 256 textarea rows); line indexing, highlighted rows and local literal searches are cached. Copy/cut/replace/split selection uses global UTF-16 offsets, not just the visible input window. Replace All avoids repeated whole-source copies; compact undo distinguishes typing from command transactions. This is not a rope or full semantic editor, and every native selection/IME/accessibility/latency case is not certified.

Automatic syntax checking runs the implemented compiler in a revision-safe cached worker with debouncing and fallback. It does not execute project code and does not steal focus or open error panes automatically. The compiler generally reports one primary parser error per module. Auto-check limits are 2,048 modules and 16 Mi UTF-16 source units; manual Check remains available. The fallback yields between modules, so one very large module can still block while compiling.

Paused Auto Data Tips inspect guarded stored values in the matching selected frame, without arbitrary getter/procedure evaluation. Text drag/drop supports guarded same/cross-module move/copy, autoscroll and atomic undo, not all native/OLE drag protocols. Clipboard read permissions and external file operations remain browser-controlled.

Version 0.4.0 adds a modeless, theme-aware Object Browser with library/class/member views, signatures, source navigation, search, private-member filtering, history, refresh and virtual keyboard lists. It describes implemented browser adapters and project declarations, not arbitrary native type libraries. The UI is reconstructed, not a complete original-field/command or pixel specification.

Project-wide literal find/replace supports project/module scope, case/whole-word options, reviewed snapshot replacement, stale-source/option guards and one atomic undo unit. Results are capped at 20,000 and truncation is explicit; this is not a regex or semantic rename engine. Edit-aware bookmarks are cross-module, shared by split views and preserved in browser metadata/undo, not inserted into native source files.

**Visual identity is not certified pixel-exact.** Three shared theme profiles use browser/local font substitutes, not distributed Microsoft fonts. Original SVG recreations replace font-dependent toolbox symbols; they are not copies of Microsoft's bitmaps. Native widgets, focus, DPI, text metrics and layout can differ. The 34 repeatable own screenshots are regression baselines, not native reference pixels. [VISUAL-AUDIT.md](VISUAL-AUDIT.md) identifies the tested states and remaining differences. The 390 × 844 touch-emulation checks are not physical mobile-device certification or a separate touch-first product.

## Controls and extended-runtime replacements

The 37 offered control types initialize in the tested browser. This does not imply complete API coverage.

Intrinsic-style controls: PictureBox, Label, TextBox, Frame, CommandButton, CheckBox, OptionButton, ComboBox, ListBox, HScrollBar, VScrollBar, Timer, DriveListBox, DirListBox, FileListBox, Shape, Line, Image and Data. Pointer is a designer tool; native OLE is not a supported runtime control.

Extended-style controls: TreeView, ListView, ProgressBar, Slider, StatusBar, Toolbar, TabStrip, SSTab, RichTextBox, MSFlexGrid, MSHFlexGrid, DataGrid, DTPicker, MonthView, UpDown, ImageList, CommonDialog and MSChart.

| Family | Implemented | Boundaries |
|---|---|---|
| Standard controls | Twip layout, captions/text/value, focus, visibility/enabled, default/cancel buttons and selected keyboard/mouse events. | All native styles, accessibility/focus/IME rules, control-specific methods/events and drag/drop protocols are not complete. |
| Classic interaction widgets | Retained ComboBox popup and simple/list-only styles, bounded visible items, two-arrow UpDown, and keyboard/pointer scrollbars with repeat, thumb dragging and reversed ranges. | Full native owner-draw/IME/selection/event equivalence and every edge style are not certified. Native date-picker and OS chooser popups remain platform-dependent. |
| Dynamic controls | Supported control-array Load/Unload and Controls.Add/Remove with guards. | No automatic registered OCX loading or arbitrary ProgID activation in browser projects. Native activation requires an explicit host allowlist. |
| Tree/List | Collections, selected subitem/selection/expansion behaviors and visible-row rendering. | Full icon modes, image masks, editing/sorting/search and all collection APIs are incomplete. |
| Grids | Sparse unbound cells, horizontal/vertical virtualization, selection, fixed-height editing; live recordset views and typed writeback with cancellation/stale-edit checks. | 21px row height, limited frozen-column/merge/hierarchy behavior, incomplete grid APIs and event semantics. Bound headers/dimensions belong to the provider. Scalar DataField binding is not implemented. |
| Data provider | Disconnected typed rows/fields, pending changes, Update/CancelUpdate, bookmarks, navigation, field-array updates, GetRows, validated flat AND/OR/LIKE criteria and multi-column sort. | No external SQL/provider/database, transactions/batches/clones, complete ADO Properties/Errors, bookmark-array/grouped/batch filters or every field type. Defaults are browser client-static/immediate-optimistic; unsupported cursor/lock modes are rejected. Empty GetRows returns an unallocated browser array, not a native empty SAFEARRAY representation. |
| RichTextBox | Supported RTF character/paragraph structure, UTF-16/CRLF selections, mixed selection, formatting, undo/redo, find, file load/save and safe clipboard handling. | Native OLE, tables, full Unicode shaping/bidi/layout, pagination and every RichEdit/RTF feature remain incomplete. Unknown structures are preserved unchanged, but edited export is blocked until explicitly flattened. GetLineFromChar counts hard lines, not visual wraps. Physical IME behavior is unverified. |
| Tabs, toolbar, status, images | Browser collections and selected events. | Complete native tab containers, image-list/mask behavior, persisted OCX properties and exact drawing styles are incomplete. |
| Dialogs/dates | Theme-scoped MsgBox/InputBox with default/cancel mapping, nested inertness/focus restoration and dragging; actual browser chooser/downloads including binary and RTF files; date/calendar controls. | OS dialog identity, all flags, runtime printer/font/color dialogs and native integration are incomplete. The IDE has its own font and color property editors; these are not complete CommonDialog implementations. |
| Chart/graphics | Theme-aware basic charts (including initial paint) and VB-style drawing on Canvas2D/optional WebGPU. Raster pictures can combine with drawing via Canvas2D. | Not all MSChart/GDI/scale/printer/image-processing semantics. DOM UI and browser text are not rendered entirely on the GPU. |

## Source/resources and persistence

`.vb6web` remains the canonical browser project. VBP/FRM/BAS/CLS import/export preserves the tested project/module/form metadata, nested property records, attributes and unknown assets. Supported FRX text/list/raster pictures decode; unchanged blobs remain byte-identical, and edited supported resources append new records without rewriting old ones. Unsupported ItemData/OCX/OLE/metafile resource formats remain opaque. Full FRX/OCX property decoding and arbitrary native-project fidelity are not established.

Windows-1252 source is kept when representable; lossy export is refused. Other legacy encodings and full native reference/link/build behavior remain unsupported. Native exports are not certified to compile unchanged in Microsoft VB6.

Virtual disk snapshots encode bytes and read old text snapshots. Local browser storage is best effort, not a durable database. Origin/profile/project-ID changes can change storage identity. The UI supports text editing, bounded hex editing and explicit import/download. It never receives unrestricted host-filesystem access.

The single-file exporter embeds project, runtime and styles, without the IDE or a CDN dependency. ZIP import/export applies path, expansion, entry-count and CRC checks; encrypted/unsupported legacy archives are rejected. These protections are not a security certification. Execute untrusted source only after review.

## Verification limits

508 Node tests and 122 Chromium behavior cases pass. The optional same-environment comparison of 34 own screenshot goldens is an additional case, not native pixel certification. There was no exhaustive native-VB6 differential run, third-party security audit, full accessibility audit or multi-browser certification. Test coverage is detailed in `TESTING.md` and raw reports.

Hardware WebGPU, vendor/device-loss behavior, Safari/Firefox and physical mobile devices remain unverified. Canvas2D was exercised. Separate direct `file://` and local-HTTP launch probes were blocked by the test environment's administrator policy before application startup; generated HTML and downloaded exports were executed through inline document loading. Do not interpret this as native file-launch or persistence certification.

## References

The implementation is independent. Shared VBA/ADO documentation informed specific rules; those documents do not establish complete VB6 equivalence. RTF/FRX references cover supported formats, not every native control's persistence.

- Microsoft VB6 support statement: https://learn.microsoft.com/en-us/previous-versions/visualstudio/visual-basic-6/visual-basic-6-support-policy
- Currency: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/currency-data-type
- Get: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/get-statement
- UDT arguments: https://learn.microsoft.com/en-us/office/vba/language/how-to/user-defined-type-may-not-be-passed-byval
- ADO Filter: https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/filter-property-ado
- ADO Update: https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/update-method-ado
- ADO CancelUpdate: https://learn.microsoft.com/en-us/office/client-developer/access/desktop-database-reference/cancelupdate-method-ado
- RTF text handling: https://learn.microsoft.com/en-us/openspecs/exchange_server_protocols/ms-oxrtfex/205e1abf-b794-4fd0-b1e4-5210882233ab
- Microsoft RTF 1.5 specification mirror: https://www.biblioscape.com/rtf15_spec.htm
- FRX format research: https://scriptandcompile.github.io/vb6/vb6parse/documentation/frx-format.html

### 0.4.0 behavior references

Shared VBA references inform the specifically implemented rules; they are not an exhaustive VB6 conformance suite.

- Named arguments: https://learn.microsoft.com/en-us/office/vba/language/concepts/getting-started/understanding-named-arguments-and-optional-arguments
- IsMissing: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/ismissing-function
- Static storage: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/static-statement
- CVErr: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/cverr-function
- CallByName: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/callbyname-function
- DateAdd: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/dateadd-function
- DateDiff: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/datediff-function
- Object Browser: https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/object-browser

## New resource and MDI contracts (0.6.0)

Native 32-bit .res containers support named/ordinal types and IDs, metadata, language IDs, aligned records, unchanged-byte preservation and string-table edits. Resource Editor applies validated undoable transactions and preserves opaque payloads. It does not execute resource dialogs, menus or OCX property data. Limits are 20 MiB and 10,000 entries; editable hexadecimal previews are capped at 64 KiB. Language resolution is selected/exact, neutral, then file order—not complete Windows locale fallback. LoadResData yields independent zero-based Byte arrays; LoadResPicture supports validated DIB/group-icon image values, not cursors or native StdPicture. Empty slots in existing string blocks return empty strings; absent blocks report missing resources.

Runtime MDI supports one project-defined parent, new child form instances, nested client areas, independent state, tiling/cascade, resizing/moving/min/max/restore, WindowList, keyboard activation/close and coordinated unload cancellation. MDIForm event prefixes are routed separately. Child modal displays and New MDIForm reject. Parent-aligned controls use the implemented Align values. Original MDI menu merging, maximized-child native chrome, all direct-control designer restrictions and complete lifecycle/default-instance behavior are not promised. Runtime UserControls, UserDocuments, native DataEnvironment/DataReport and every original add-in/designer are still absent.

## Scalar compatibility update

Scalar subtype/origin preservation and the tested mixed-operation matrix supersede earlier statements that all VM numeric values are unboxed Doubles. See [SCALAR-COMPATIBILITY.md](SCALAR-COMPATIBILITY.md). Unknown JavaScript adapter results may still default to Double. This update does not certify universal COM/OCX lifetimes, Windows LCID/DBCS equivalence, unrestricted live editing, or Microsoft VB6 Decimal Put bytes.
