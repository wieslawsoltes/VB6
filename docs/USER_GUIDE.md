# User guide

## Create and run a project

Open `dist/VB6-Studio-Web.html`. The initial Order Entry project has a form plus a standard module. Press F5 to run. The application appears in its own embedded window. Use its controls normally; the event handlers execute VB-style source. Shift+F5 ends execution and returns the editor to design mode.

File → New Project opens the template dialog. Standard EXE creates a blank form-based **browser** project. The other entries are editable examples. The Project menu can add forms, standard modules and classes. Project Properties selects the startup form or Sub Main.

Save Project downloads a `.vb6web` file. The browser cannot silently overwrite the original downloaded file. Keep the saved project in your own backup/version-control workflow.

## Design a form

Choose a control from the toolbox and drag on the form, or double-click the toolbox icon for a default-sized instance. The toolbox category selector switches between general and extended controls. Select a placed control to edit its properties. Captions support ampersand mnemonics.

Drag a control to move it and use its selection handles to resize. Ctrl-click selects multiple controls. Arrow keys move selection; Shift+arrow changes size; Ctrl+arrow uses a one-pixel step. The Format menu provides alignment, sizing, spacing and related layout actions. Containers such as Frame support nested child positioning. Tab Order mode lets you set focus order.

Properties use twips: 15 twips equals one CSS pixel. Enter commits a property; Escape restores the edited field. Text/list ellipsis buttons open larger editors. Changes participate in project undo/redo.

Double-click a designer control to navigate to or create its default event. A command button creates a handler such as:

```vb
Private Sub CommandButton1_Click()
    Label1.Caption = "Hello from Visual Basic"
End Sub
```

Control names in source must match the model. Option Explicit reports undeclared names on the implemented execution paths. Adding a model control does not guarantee that every original VB6 member for that control exists; consult the compatibility matrix and examples.

## Edit source

F7 switches to code and Shift+F7 switches to the form. The object/procedure selectors navigate handlers. Ctrl+Space opens lexical completion. Ctrl+F finds text, Ctrl+H enables replacement, and F3 repeats the search. Edit → Format Code indents the current module.

The editor's native text input remains editable on top of viewport-painted highlighting. Source history retains changed text rather than copying the entire project at each keystroke. This is not a full semantic language server or original VB6 code editor implementation.

## Browse symbols, search projects and bookmark code

**F2** opens Object Browser as a modeless MDI tool. Select a library and class, then inspect members and signatures. Search preserves a results list; Back/Forward returns to earlier selections. Toggle private members as needed. View Definition jumps to the exact source declaration, or the represented form/control. F5 while the browser has focus refreshes it rather than running the project. The tool supports code edits while open, keyboard list navigation and pointer/keyboard column resizing. Native COM type libraries and unavailable members are not fabricated.

Use **Ctrl+Shift+F** for Find in Project, or **Ctrl+Shift+H** for Replace in Project. Choose project/module scope and case/whole-word options, then **Find All**. Enter or double-click opens the exact source span. Review the matches before **Replace All**: the tool refuses outdated source snapshots, changed options or a truncated result set. One undo restores all replaced modules. Replacement text is literal, including `$` and backslashes; this is not a regex replacement editor. Running projects cannot be bulk-replaced through this tool.

**Ctrl+F2** toggles a bookmark at the active source line. **Ctrl+Alt+F2** goes forward and **Ctrl+Alt+Shift+F2** backward through project bookmarks. **Shift+F2** goes to Definition and **Ctrl+Shift+F2** returns to Last Position. Ctrl+click in a source gutter toggles a bookmark without replacing an ordinary breakpoint. Both split panes share markers. Edits move tracked positions; source undo/redo restores them. **Edit → Bookmarks → Clear All** removes them. Save a `.vb6web` project to retain bookmark metadata.

## Runtime Workbench

Choose **File → New Project → Runtime Workbench** and press F5. Its output demonstrates omitted optional arguments versus explicit Empty, named argument binding, string assignment statements, CVErr and negative date serial conversion. Counter A and Counter B retain separate static values. The year/date controls demonstrate leap-day clamping; the caption action uses CallByName. Open its form code and Counter class to change the behavior, then export it using the normal Make HTML command.

## Debug

Put the caret on an executable source line and press F9. Press F5 to run. At a breakpoint the execution line is yellow, and the application window collapses into a toolbar strip so it does not obstruct the independent debugger panes.

F8 steps into the next instruction. Shift+F8 steps over a call; Ctrl+Shift+F8 steps out. F5 resumes, and Shift+F5 ends. The Debug menu exposes breakpoint conditions, watches and other supported commands. Locals and Call Stack show the paused frame. Double-click a stack row to navigate to its source.

In Immediate, use `?` to print an expression:

```vb
? n * 6
n = 11
```

These evaluate and assign within the paused context. They are not arbitrary JavaScript. Some side-effectful function evaluation can change application state; treat it as executing program code. While paused, edit compatible source and use Apply Code Changes, F5 or a step command. The compatibility planner rejects active signature, declaration-layout and unsafe control-flow changes without partially changing execution state. Stop before making incompatible changes. Ctrl+F9 requests Set Next Statement at the caret; it must be an eligible executable line in the current procedure and cannot cross unsafe regions.

## Export an independent app

File → Make `<project>.html…` downloads one HTML document. It contains the project model, runtime and CSS, with no reference to the IDE. Open that file independently or deploy it as a static page. Test the exported app's behavior, not just whether it opens.

File → Export Source Project produces a ZIP with a `.vb6web` project plus supported native-style text sources. The `.vb6web` project is the authoritative browser version. Native text export is not a guarantee of successful compilation in Microsoft VB6.

## Open existing files

Open Project accepts `.vb6web`, ZIP, or a selection of supported `.vbp/.frm/.bas/.cls` files. For VBP imports, include the referenced files; opening the VBP alone does not give the browser permission to read arbitrary neighbors. Folder selection is available where the browser supports it. Dragging files onto the IDE also imports them.

Check the Errors/diagnostics panel after import. Replace unsupported OCX controls and native references with browser equivalents. Supported FRX text, lists and raster pictures decode automatically when the referenced files are included. Unknown property bags and native OLE/metafiles remain opaque and are not activated. Existing arbitrary VB6 projects are not expected to run unchanged.

## Files and data

Runtime `Open`, `Print #`, `Input #` and related operations use a project-private virtual filesystem. They do not create files on the host machine automatically. The IDE's Virtual Files dialog lets you inspect, edit, import and download private text or binary files. Binary files have a hexadecimal editor up to 64 KiB; larger files can still be downloaded. Open For Binary/Random and typed Get/Put use the same private byte disk. Browser-native file chooser/download actions are explicit, not unrestricted host access.

The Data Browser example uses an in-memory Recordset. It does not connect to Access, SQL Server or a remote database. Editing a bound grid cell now writes through to the typed Recordset. Invalid values, cancelled validation, deleted/filtered rows and stale concurrent edits are rejected. Grid hover text and LastDataError describe a rejected edit. Provider changes and navigation update the grid automatically. Use Recordset.AddNew/Delete for bound rows; bound grid dimensions/headers are provider-owned. Unbind with Set grid.DataSource = Nothing before using Rows/Cols as an unbound sparse grid.

## Rich Text Editor

Choose File → New Project → Rich Text Editor. Select text and use its formatting controls or Ctrl+B/I/U. Ctrl+Z/Y changes the document through structured undo/redo. Open/save RTF retains supported formatting; plain-text save intentionally drops formatting.

Text, SelStart and SelLength use UTF-16 character indices and CRLF line breaks. A mixed selection returns Null for differing formatting attributes. SelRTF inserts/retrieves supported formatted fragments; Find supports whole-word, match-case and no-highlight flags. LoadFile/SaveFile use 0 for RTF or 1 for text.

RTF tables, native OLE or unknown structures are not silently activated or discarded. An unchanged imported document can be saved with its original RTF. Editing a document containing unsupported structures causes RTF export to refuse loss. Assigning `RichTextBox1.Text = RichTextBox1.Text` is an explicit flattening operation; use it only when discarding unsupported formatting/structures is intentional. Keep an original backup. MaxLength and malformed clipboard input are rejected without corrupting the model.

## Typed disconnected data

A basic provider setup is:

```vb
Dim rs As Object
Set rs = CreateObject("ADODB.Recordset")
rs.Fields.Append "ID", adInteger
rs.Fields.Append "Amount", adCurrency
rs.Open
rs.AddNew Array("ID", "Amount"), Array(1, CCur("12.3456"))
Set DataGrid1.DataSource = rs
```

Field assignment starts a pending edit; Update commits and CancelUpdate restores it. Navigation commits pending changes. AddNew with field/value arguments commits immediately; AddNew without arguments remains cancellable. Schema types, string sizes and numeric bounds are checked. The provider is local in-memory data, not a native ADO component or a connection to an external database.

## Window layout and touch

Resize docking areas using divider bars. Double-click supported tool-window captions to float/dock them inside the browser page. Open several modules or forms to keep live MDI documents. The Window menu provides Cascade, Tile Horizontally, Tile Vertically, Arrange Icons and the open-document list. Ctrl+F6 / Ctrl+Tab cycles documents, Ctrl+F4 closes the active document, and Ctrl+F10 toggles its maximized state. Window → Tile Code and Designer opens and arranges the active form and its source. Reset Window Layout restores defaults.

A code window has Procedure View and Full Module View buttons at its lower edge. Drag the split grip down, double-click it, or use its keyboard action to open a second pane; each pane scrolls independently. The object/procedure selectors follow the active pane. Closing the split retains the shared module. Edits and breakpoints in Procedure View still use the full module's source locations.

Choose Tools → Options → General → Appearance for Windows Classic, Windows Standard (2000), High Contrast Black, or Fluent WinUI 3/macOS 26/X11 in light and dark variants. IDE and application themes can differ. The application theme is included in exported HTML. An explicit RGB BackColor remains the chosen color; a system BackColor changes with the theme. Editor Format changes the local code font and size. Docking controls panel visibility and optional document/debug tabs.

In Properties, use Alphabetic or Categorized tabs, arrow keys and F2 to edit a value. Escape cancels an uncommitted edit; Enter commits it. Color fields open with Alt+Down and offer System and Palette tabs. Expand Font for subproperties or use the font editor. Drag or keyboard-adjust the name/value splitter. Browser font fallback means a requested face may not exist on the current machine.

F10 or Alt activates the menu bar. Arrows, mnemonic letters, Home/End, Enter and Escape operate the retained menu hierarchy; closing a submenu returns to its parent. Dialog tabs support keyboard navigation, and cancelling Options leaves settings unchanged.

On narrow screens the Properties button opens a drawer. Runtime forms scale to fit, and pointer/touch input is supported. Desktop keyboard workflows and small classic controls remain present; this is not a separate touch-first IDE.

## Keyboard reference

| Shortcut | Action |
|---|---|
| Ctrl+N / Ctrl+O / Ctrl+S | New, open, save project |
| F5 / Shift+F5 | Run or continue / end |
| F8 / Shift+F8 / Ctrl+Shift+F8 | Step into / over / out |
| F9 | Toggle source breakpoint |
| Ctrl+F9 | Guarded Set Next Statement while paused |
| F7 / Shift+F7 | Code / form |
| F4 / F2 | Properties / Object Browser |
| Ctrl+G | Immediate window |
| Ctrl+Shift+G | Go to source line |
| Ctrl+Space | Completion |
| Ctrl+F / Ctrl+H / F3 | Find / replace / find next |
| Ctrl+Shift+F / Ctrl+Shift+H | Project-wide find / replace |
| Ctrl+F2 | Toggle bookmark |
| Shift+F2 / Ctrl+Shift+F2 | Next / previous bookmark |
| Ctrl+Z / Ctrl+Shift+Z | Undo / redo in source |
| Ctrl+Y | Delete the current source line; redo outside the source editor |
| Ctrl+Up / Ctrl+Down | Previous / next source procedure |
| Ctrl+F6 / Ctrl+Tab | Cycle live MDI documents |
| Ctrl+F4 / Ctrl+F10 | Close active MDI document / maximize or restore |
| F10 / Alt | Activate menu bar |

Operating-system/browser shortcuts may take precedence. On macOS, source editing also recognizes the platform modifier for several commands; not all platform key combinations have been validated.


## 0.5.0 editor and workspace additions

**Tools → Options → Editor** controls Auto Syntax Check, Auto Data Tips and Drag-and-Drop Text Editing. Automatic syntax checks are debounced; the status bar shows checking, ready or diagnostics. Error markers do not take focus or automatically reveal the Errors pane. Use the Debug menu’s next/previous syntax-error commands to navigate. Turning auto checking off clears its markers; explicit Check still works.

Hover a stored variable while paused to inspect it in the selected call frame. Moving the pointer, editing source, changing frames or resuming discards the tip. These tips deliberately do not invoke procedures or getters. Select text before dragging it; hold Ctrl to copy rather than move. A move between two code windows can be undone as one operation. Escape cancels a drag or keyboard window move/resize.

The local find bar uses literal matching. Replacement text such as `$&` is inserted literally. Shift+F4 finds the next match. Ctrl+Y cuts the current complete logical line. Clipboard permissions may be unavailable; same-IDE Copy/Cut/Paste use the retained source clipboard. A delayed external paste is cancelled if the source or selection changes before it arrives.

Use the **Window** layout commands to save, restore or manage named profiles. The manager imports/exports JSON files and rejects malformed or oversized files without partially applying them. Profiles include dock groups, customized command bars and editor view state. A profile from another project applies tools/toolbars but not unrelated documents. Layouts contain view metadata, not a replacement for the project source file: save `.vb6web` backups separately.

Toolbars are configurable through the toolbar/customization commands. In-page floating remains available. Use the ↗ caption button or **Float in Browser Window** in a caption/toolbar context menu to move a live pane into a separate browser window. The **Window** menu can float the active document, focus detached windows, return all windows, or reopen saved windows one at a time. **Return to IDE** or the popup’s native Close button restores its pane; **Close Document** closes the document itself. The main IDE must remain open. See [Browser windows](BROWSER-WINDOWS.md). Keyboard move/size operations stop on Escape or loss of focus rather than remaining armed. Reset Layout restores default toolbars as well as docking.

### In-page MDI window setting

Under **Tools → Options → Docking**, set **IDE window mode** to **In-page MDI only** to keep all IDE panes inside the page. Move, resize, minimize, maximize, cascade, tile, and cycle document windows as before. **MDI with optional browser windows** keeps MDI available while also allowing individual panes to detach. You can also switch from **Window → Window Mode**. Switching to MDI returns live panes without closing documents; switching back never automatically opens popups. The preference is saved with the workspace and is not changed by named layouts or project switching.

Application appearance has its own preview, system light/dark matching and reduced effects. Matching built-in icon packs follow the local IDE/application choice automatically. See [Application themes](APPLICATION-THEMES.md) and [Theme icon packs](THEME-ICON-PACKS.md) for settings, runtime switching, export and native-platform boundaries.
