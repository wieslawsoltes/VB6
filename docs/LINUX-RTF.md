# Native Linux RichTextBox documents

The Linux AOT runtime uses native GTK text buffers, Pango text layout and GTK
widgets for RichTextBox. The GTK3 and GTK4 targets share the parser, document
model, serializer, selection logic and VB6 control implementation. This document
defines the admitted RTF document model and its compatibility boundaries.

Importing an admitted construct preserves its visible content and represented
formatting through `TextRTF`, `SelRTF`, `LoadFile` and `SaveFile`. RichTextBox is
a continuous editable document surface. Page headers, footers, notes, comments
and embedded-object previews appear as labelled document blocks; there is no
Word page layout or field evaluation engine.

## Text and paragraph formatting

The shared reader supports escaped RTF syntax, hexadecimal byte escapes,
Unicode `\u` / `\uc` fallback handling, surrogate pairs, declared ANSI and font
code pages, font and color tables, and scoped character and paragraph changes.
Malformed syntax, truncated binary data, invalid encoding, invalid table
references and out-of-range values fail before the active buffer changes.

| Formatting | Native representation |
| --- | --- |
| Font family, point size, bold, italic and small caps | Pango font properties on text tags; `\fs` half points and `\fsmilli` millipoints are retained |
| Single, double and wave underline, strikeout, superscript and subscript | GTK text tag decorations, scale and rise |
| Explicit baseline displacement and character spacing | Pango rise and letter spacing |
| Foreground, character background, hidden and protected text | GTK text tag colors, visibility and interactive editability |
| Left, center, right and justified paragraphs | GTK paragraph justification |
| Left/right/first-line indentation and paragraph direction | GTK margins, indentation and direction |
| Space before/after paragraphs and additional line spacing | GTK text tag paragraph and wrapped-line spacing |
| Left, right, center and decimal tab stops | Pango tab arrays; aligned tabs require Pango 1.50 or later |
| Default tab interval | Explicit native tab positions derived from the document interval |
| Multiple and physical line spacing | GTK4 line-height factors; GTK3 font metrics and additional native line spacing |

GTK4 can represent compressed line-height factors with its `line-height`
property. GTK3 cannot compress native glyph line boxes: an import requesting
spacing below the body or list marker's native metrics raises VB error 453 before
replacement. Physical dimensions are converted from twips using the runtime's
native logical-pixel convention and necessarily round to pixel boundaries.
Language identifiers are retained in the interchange model. Font selection and
text shaping use the installed Pango fonts and Unicode text; this is not a
Windows font installation or Word proofing-language service.

Legacy Symbol-font byte text is converted to its Unicode Greek, mathematical
and punctuation characters using the Unicode Consortium's Adobe Symbol
mapping. Unicode escapes remain Unicode text even under a Symbol font.
Undefined Symbol bytes are invalid; font-private glyphs without a portable
Unicode representation raise error 453. The mapping and its required notice
are in `packages/linux-native/native/gtk-symbol.hpp`.

## Lists and fields

Legacy `\pn` list definitions support decimal, uppercase/lowercase Roman,
uppercase/lowercase alphabetic numbering and literal bullet markers. Prefixes,
suffixes, start values, hanging indentation and explicit `\pntext` markers are
retained. Marker font, size, weight, italic style, color and alignment are
represented separately from the paragraph's body text and drawn with Pango.

Modern `\listtable`, `\listoverridetable`, `\ls` and `\ilvl` definitions
support up to nine levels. Decimal, upper/lower Roman and upper/lower alphabetic
placeholders can be combined with literal Unicode affixes and ancestor-level
values. Literal bullet and unnumbered patterns are also admitted. Counters
remain independent for each list override; start-at overrides, complete level
format overrides, legal ancestor numbering and subordinate restart/no-restart
behavior determine the actual displayed marker. Explicit `\listtext` results
are retained when present. The parser checks level-text lengths, placeholder
offsets and ancestor references before installing a document.

Marker font, half-point size, bold, italic, automatic or explicit color and
left/center/right marker alignment reach the native drawing path. A larger
marker reserves native line space and shares the body text's baseline.
Inherited marker color remains distinct from an explicit automatic color.
Paragraph indentation and tab overrides remain independent of the list
definition. The admitted marker separator is a tab (`\levelfollow0`). Mixed
character formatting inside one marker, non-tab separators, picture bullets,
unsupported number formats and unrepresented list-layout controls raise
error 453; invalid list identifiers or references raise error 380.

Serialization normalizes modern lists to explicit per-paragraph markers and
the shared legacy paragraph numbering model. It preserves the displayed
numbers, formatting and independently restarted sequences. It does not retain
the original list-table identifiers or provide Word outline editing commands.
After normalization, editing an existing paragraph retains its stored marker;
the editor does not maintain the source application's mutable outline graph.

`\field` preserves its `\fldinst` instruction, editable `\fldrslt` result,
locked/dirty flags and nested result formatting. GTK text marks track the
result range as text is edited. Field instructions are stored as data: a field
does not run a command, open a URL, read an external file, fetch a linked
resource or recalculate itself. Selecting part of a result produces an RTF
selection containing the corresponding result text; complete retained fields
are serialized with their instructions.

## Inline pictures

PNG (`\pngblip`), JPEG (`\jpegblip`) and supported Windows DIB
(`\dibitmap0`) payloads are admitted in hexadecimal or `\bin` form. The
reader validates image headers and geometry, and the native image loader
validates the complete payload before the document is installed. Original
encoded bytes, source dimensions, goal dimensions, scale and crop values are
retained for serialization.

GTK3 inserts a native GdkPixbuf in the text buffer. GTK4 inserts a native
GdkTexture paintable. Goal dimensions, scaling and cropping produce the
rendered pixel image; a selected picture can be saved as `SelRTF` and restored
without replacing its original payload with a screenshot. Positive cropping
removes pixels and negative cropping can add transparent padding. Native
fixtures inspect both the actual displayed dimensions and decoded pixel
colors.

A `\shppict` primary image suppresses its matching sibling `\nonshppict`
fallback. The selected image is serialized once. An unpaired fallback remains
a real image and must use an admitted format; an unrelated preceding picture
cannot cause it to disappear. Both alternative wrappers must contain exactly
one picture result.

WMF, EMF, device-dependent bitmaps, Apple PICT and picture formats without an
implemented native representation raise error 453. A corrupt supported image
raises error 380. Native insertion of an arbitrary foreign pixbuf, paintable
or child anchor is not an RTF import API and is rejected unless it belongs to
the runtime's validated document model.

## Tables, document regions and embedded previews

Table rows are native GTK grids containing independently editable rich text
views. The model retains cell boundaries, row gap, admitted row indentation
and alignment, automatic/minimum row heights, cell background colors,
vertical alignment and horizontal merges. Each cell can contain formatted
text, fields, pictures and nested supported table rows. Each of its four
borders supports solid, double, dashed or dotted lines, width and color.

These are continuous document rows. There is no page-spanning table layout,
repeating table-header pagination, vertical cell merging, floating table
positioning or arbitrary Word table-layout engine. Exact clipped row heights
and other unrepresented visible table controls are rejected instead of being
silently reduced to minimum heights.
Negative row offsets, nondefault auto-fit or preferred-width controls and
page-keeping/repeating-header flags are also explicit error 453 boundaries.
Horizontal merge continuation cells must contain no independent visible
document. Rows retain their declared widths; narrow controls scroll or wrap
their cell contents according to native GTK layout, without a Word auto-fit
calculation.

Header/footer variants, footnotes, endnotes and annotations are retained as
labelled editable document regions. The complete nested region document is
serialized in its original destination. The editor displays these regions in
document order; it does not repeat them on physical pages or generate
automatic note-reference numbering.
An automatic `\chftn` reference is rejected; literal reference text can be
stored and edited like other Unicode text.

RTF `\object` groups with a supported cached `\result` preserve object class,
mode and binary data alongside that visible result. Their previews are
rendered as labelled nested document blocks and remain editable. Binary OLE
data is inert. There is no Windows COM/OLE server, activation, linking,
automation, Windows application embedding or binary compatibility guarantee.
An object without a usable cached visible result is rejected.
Nondefault OLE scale controls are rejected. Object size metadata is retained,
but the labelled editable preview follows continuous GTK document layout; it
is not an active embedded application's window or a clipped OLE page surface.

## Editing, selection and persistence

The outer RichTextBox uses UTF-16 indexes, matching the other native runtimes.
GTK's scalar offsets are converted at the VB property boundary and a
selection cannot split a surrogate pair.

| Outer document element | `Text` representation and selection size |
| --- | --- |
| Ordinary text | Its Unicode text, measured in UTF-16 code units |
| Inline picture | One object replacement character, U+FFFC |
| Table row | U+FFFC followed by LF, forming one outer paragraph; two UTF-16 code units |
| Labelled region or embedded preview | U+FFFC followed by the line separator U+2028; two UTF-16 code units |
| Text inside a table cell or labelled region | A separate nested document; it is not flattened into the outer `Text` |

`SelStart`, `SelLength`, `SelText`, `Find` and outer text operations address
this outer buffer. Structured objects are atomic at that boundary. A
programmatic replacement which cuts through a block object's two-character
representation fails with error 380 before mutation. Native deletion expands
to the complete object, and native insertion inside its anchor/separator
pair moves to the position after the object. Formatting intersecting an
object respects the complete object's range.

A table row starts at an outer paragraph boundary. If imported RTF places a
row directly after ordinary text, import inserts a preceding LF, so
`Before{row}After` has the outer text `Before` + LF + U+FFFC + LF + `After`.
The row's own paragraph allows left, center and right row alignment to affect
its actual native position. Typing after its two-unit representation edits
the following normal paragraph. Native typing immediately before a row moves
before the existing preceding paragraph separator; at the start of the
document a paragraph break must be inserted first. Native deletion does not
join surviving row anchors onto preceding ordinary text. Programmatic
`SelText` or `SelRTF` replacements must leave every surviving or inserted row
at a paragraph boundary; invalid placement fails before mutation.

Users can edit actual table-cell and region text views. Their nested
documents are read back when the outer RichTextBox is serialized. An edit
sets the outer control's `Modified` property and raises one outer `Change`
event. Retained field ranges and object anchors move with edits through GTK
marks. Plain-text persistence saves the outer `Text` representation above;
use RTF persistence to retain and recover nested documents and images.

Whole-document RTF import and selected RTF replacement are transactional.
Parsing, recursive validation, native image decoding, text tags and nested
widgets are prepared before replacing the active buffer. Failure preserves
the prior content, selection, formatting and modification state. Successful
replacement follows the normal RichTextBox change notification path.

The model does not promise arbitrary third-party structured clipboard
interchange or preserve every unknown RTF destination. Unknown visible
content and unsupported visible formatting fail explicitly. The admitted
metadata destinations remain bounded and retained by the shared serializer.

## Resource limits and errors

Limits apply to one complete document, including all nested table cells,
regions and cached object results. They protect native allocation and the
bounded serializer; they are not an extension mechanism for silently dropping
content.

| Resource | Bound |
| --- | --- |
| Encoded RTF input or serialized output | 16 MiB |
| Aggregate UTF-16 document text | 4 Mi code units |
| Aggregate formatting runs | 65,536 |
| Aggregate retained fields | 4,096 |
| Aggregate structured objects | 1,024 |
| Aggregate table cells | 4,096 |
| Cells in one row | 64 |
| Recursive structured-document depth | 16 |
| Aggregate embedded binary data | 16 MiB |
| Image side length | 8,192 pixels |
| Aggregate decoded source and additional transformed image pixels | 16 Mi pixels |
| List levels in one modern list | 9 |
| Font, stylesheet, list and list-override table entries | 4,096 each |
| Color table entries | 4,096 including the automatic entry; at most 4,095 explicit output colors |
| Explicit tab stops in a paragraph | 64 |
| List counter/start value | 1 through 1,000,000 |
| Modern generated or explicit marker text | 64 visible UTF-16 units; the parser separately bounds trailing separators |
| Legacy numbering prefix or suffix | 64 UTF-16 units each |
| RTF group nesting / tokens | 256 groups / 4 Mi tokens |
| One retained field instruction | 65,536 UTF-16 units |

Normal edits inside nested cells are checked against the aggregate document
text budget. An unsupported visible operation raises VB error 453; malformed
input, invalid values and invalid selection boundaries raise error 380.
Allocation and input/model resource limits raise error 7. File operations
additionally retain the runtime's normal file error codes.

## Implementation and qualification

`gtk-rtf.cpp` and `gtk-rtf.hpp` implement the bounded parser, shared document
model and deterministic writer. `gtk-richtext.cpp` and `gtk-richtext.hpp`
implement GTK buffers, native rendering, recursive object views, selection,
edits and persistence. The GTK4 adapter supplies the native text-view snapshot
hook; list markers and RichTextBox custom drawing use the same shared drawing
function on both toolkits.

`packages/linux-native/tests/gtk-richtext-contracts.cpp` exercises parser
errors and canonical round trips, UTF-16 selection, native tag properties,
actual image and list-marker pixels, marker font geometry, compressed line
advance, allocated table width/alignment, GTK grid children, nested edits and
change events, transactional failure, and structured-object
selection/persistence. GTK3 verifies that unsupported compressed spacing
preserves the complete previous document and notification state.
`packages/linux-native/tests/richtext.mjs` extends the shared native VB6
RichTextBox acceptance program. Its Linux cases exercise pictures, tables,
regions, fields, generated multilevel lists, numbering restarts, Symbol text,
selection, failed-import transactions and persistence from generated native
executable code.

Native qualification must use runtime objects built from the same source
snapshot and selected GTK toolkit. Run widget fixtures under a display server
such as Xvfb, with `G_DEBUG=fatal-criticals`, so GTK critical errors fail the
probe. Rebuilding a fixture against stale runtime objects does not qualify
changed native source.

From the repository root, the full export proof rebuilds the selected runtime,
links native fixtures from those exact objects, exports the VB programs and
executes the ELF bytes recovered from the application archives:

```sh
G_DEBUG=fatal-criticals node tools/test-linux-aot.mjs --toolkit gtk3 --rebuild --report reports/linux-aot
G_DEBUG=fatal-criticals node tools/test-linux-aot.mjs --toolkit gtk4 --rebuild --report reports/linux-aot-gtk4
```

These commands require the native SDK dependencies described in
[LINUX-AOT.md](LINUX-AOT.md), plus Xvfb and the selected GTK toolkit. They run
the whole Linux acceptance suite, including the compiled RichTextBox tests.
For an isolated grammar and serializer check, the same C++ fixture has a
parser-only entry point. This intentionally does not qualify native rendering:

```sh
g++ -std=c++17 -O0 -ffunction-sections -fdata-sections \
  -DVB6_RTF_PARSER_ONLY \
  -I packages/macos-native/native -I packages/linux-native/native \
  $(pkg-config --cflags gtk4) \
  packages/linux-native/tests/gtk-richtext-contracts.cpp \
  packages/linux-native/native/gtk-rtf.cpp \
  packages/macos-native/native/values.cpp \
  -Wl,--gc-sections $(pkg-config --libs glib-2.0) \
  -o /tmp/vb6-rtf-parser
/tmp/vb6-rtf-parser
```

The parser emits `LINUX_RTF_PARSER_OK`; the native fixture additionally emits
`LINUX_GTK_RICHTEXT_OK`. The generated VB program emits
`LINUX_RICH_LISTS_OK`, `LINUX_RICH_DOCUMENTS_OK` and
`LINUX_RICH_PERSISTENCE_OK` after the respective assertions pass.

## Primary references

- [GTK text widget model](https://docs.gtk.org/gtk4/section-text-widget.html)
- [GTK4 text-tag line height](https://docs.gtk.org/gtk4/property.TextTag.line-height.html)
- [Pango tab alignment](https://docs.gtk.org/Pango/enum.TabAlign.html)
- [Unicode Consortium Adobe Symbol mapping and notice](https://www.unicode.org/Public/MAPPINGS/VENDORS/ADOBE/symbol.txt)
- [Microsoft-authored RTF 1.7 specification, archived PDF](https://latex2rtf.sourceforge.net/RTF-Spec-1.7.pdf)
