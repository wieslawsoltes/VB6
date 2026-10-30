# OLE document container in browser applications

The intrinsic **OLE** control now hosts portable documents instead of displaying
`OLE — native control not implemented`. Add it from the toolbox, open its
**Property Pages**, or open **Examples → OLE Document Workbench**. The same
component runs in the IDE and self-contained HTML exports without a companion
process or downloaded control.

## Document servers

| Class | Content and behavior |
| --- | --- |
| `VB6.TextDocument` | Editable text; BOM-aware UTF-8/UTF-16 import with Windows-1252 fallback. Edited text is UTF-8. |
| `VB6.RichTextDocument` | RTF through the shared RichTextBox parser/editor, including character formatting, Unicode, clipboard and undo/redo. |
| `VB6.ImageDocument` | PNG, JPEG, GIF, BMP and ICO display using checked raster signatures. |
| `Package` | Arbitrary file bytes, retained and exported without executing or interpreting the file. |

Filename and byte signatures select a server when no class is supplied. HTML,
JavaScript and similar text files are shown as text. SVG, native compound storage,
Office documents and executable files remain byte-preserving packages. Native
Office applications, COM registration and an installed server are not available
inside a browser document. Supplying an unavailable class such as `Word.Document`
raises error 429 and retains the previous object.

This is a portable implementation of document embedding and linkage, not a claim
to implement the Windows COM binary ABI or native compound-document format.
Win32 AOT continues to diagnose OLE controls as unsupported; that exporter does
not silently replace them with a static label or require a Microsoft VB6 DLL.
The separate native Automation companion described in [COM-OLE.md](COM-OLE.md)
has its own Windows host and installed-server requirements.

## Authoring and interaction

Select an OLE control and choose **Property Pages…**. Create a text or rich text
document, import a local file, or load a source from the project's private disk or
assets. The editor owns a draft: Cancel leaves the project unchanged, and an
outdated form or selection is rejected before applying changes. Embedded content
is saved as `OLEDocument` in the browser project and survives HTML export.
Native `.frm` serialization cannot encode that structured property and reports
the existing explicit compatibility diagnostic.

At runtime, double-click a document to edit it. Press Escape or choose
**Document actions → Close editing** to leave editing while retaining the
document. The menu also creates/replaces documents, imports files, exports exact
bytes, removes objects, and updates or saves linked sources. Disabled controls
and the form designer do not run these actions. Keyboard focus and Enter support
activation without a mouse. `SizeMode` controls image clipping, stretching,
natural sizing or proportional zoom; `DisplayType = 1` presents the file icon.

For RTF containing unsupported structures, the original RTF remains available
for byte-preserving export, and interactive editing is read-only. Applications
may explicitly replace `Object.Text` to flatten that content before editing.
This prevents an edit from silently discarding embedded or unsupported content.

## VB API

```vb
Private Sub Form_Load()
    OLE1.CreateEmbed "", "VB6.RichTextDocument"
    OLE1.Object.Text = "Hello from an embedded document"
    OLE1.DoVerb
End Sub

Private Sub SaveDocument_Click()
    ' Write the underlying document bytes into the application disk.
    OLE1.SaveDocument "/notes.rtf"
    ' Download those same bytes to the user's operating system.
    OLE1.ExportDocument
End Sub
```

| Member | Contract |
| --- | --- |
| `CreateEmbed([SourceDoc], [Class])` | Copy a project-disk file or asset into independent owned bytes; an empty source creates a text/RTF/package document. |
| `CreateLink(SourceDoc, [Class])` | Load a source and retain its private-disk path and baseline for explicit update/save. |
| `InsertObjDlg` | Ask the user for a local file and embed it using the detected document class. Cancellation has no effect. |
| `DoVerb([Verb])` | Activate primary/show/open/UI/in-place verbs; the hide verb closes editing. Unknown verbs raise error 445. |
| `Close` | End editing; keep the embedded or linked document. |
| `Delete` | Remove the document and invalidate previously obtained `Object` references. |
| `Update` | Reload a linked source. Unsaved local edits are rejected instead of discarded. |
| `Object.Text`, `Object.TextRTF` | Access supported text and rich-text content; unsupported members raise error 438. |
| `Object.Save` | Save a linked object back to its source; reject external source changes or a nonwritable source. |
| `Object.SaveAs(Path)`, `SaveDocument(Path)` | Save underlying document bytes to the application disk. Saving a linked copy retains the original link's dirty state. |
| `ExportDocument` | Download the underlying bytes using the document's original name. |
| `SaveToFile(FileNumber)`, `ReadFromFile(FileNumber)` | Serialize/restore one portable document record at the current position of an open Binary file. |
| `OLEType`, `Class`, `SourceDoc` | Current embedding/linkage type, portable server class and source path. |
| `Modified`, `AppIsRunning` | Read-only dirty and active-editing state. |
| `Updated(Code As Integer)` | `0` for content/replacement/update changes, `1` for a save, `2` for closing editing. |

`OLETypeAllowed`, `AutoActivate`, `SizeMode` and `DisplayType` have validated
enum editors. The corresponding `vbOLE…` constants are shared by the editor and
runtime. `Controls.Add("VB.OLE", "Document1")`, control arrays and removal use
the existing control lifecycle.

## Linked files and persistence

Links resolve only against the application's virtual disk or packaged assets.
No path grants access to the real operating-system filesystem. Updates are
explicit. Saving a linked file compares the current source bytes with the last
loaded/saved baseline, rejects conflicts, and respects disk read-only attributes.
An asset-only source cannot be overwritten. Failed loads and malformed files do
not replace the current document.

```vb
Private Sub SaveObject_Click()
    Dim fileNumber As Integer
    fileNumber = FreeFile
    Open "/document.vb6ole" For Binary As #fileNumber
    OLE1.SaveToFile fileNumber
    Close #fileNumber
End Sub

Private Sub RestoreObject_Click()
    Dim fileNumber As Integer
    fileNumber = FreeFile
    Open "/document.vb6ole" For Binary As #fileNumber
    OLE1.ReadFromFile fileNumber
    Close #fileNumber
End Sub
```

A portable record consists of ASCII `VB6OLE01`, a little-endian unsigned 32-bit
JSON byte length, and a UTF-8 `VB6.OLE.Document` version-1 JSON snapshot. It is
not Windows structured storage. Multiple records can share a Binary file; one
read consumes exactly one record. Malformed data, access restrictions and locks
leave the existing object and file cursor intact. Linked dirty snapshots retain
both edited bytes and their conflict baseline; clean links omit the duplicate
baseline. Individual documents are limited to 8 MiB. Encoded records and virtual
files retain the filesystem's 20 MiB bound.

## Validation

`tests/ole-document.test.mjs` exercises byte ownership, server validation,
activation/disposal, object identity, linked conflicts, read locks, exact Binary
cursors, malformed data, encoding and large linked records. The existing
`tools/browser-com-ole-tests.py` CI entrypoint exercises intrinsic controls in
both ESM and the bundled runtime, then opens exported workbench HTML over HTTP
and file origins. Its actual browser actions cover text editing, private-disk
saves, text and binary downloads, file-picker imports, link saves and rich-text
keyboard formatting.
