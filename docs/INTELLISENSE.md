# Classic IntelliSense

The source editor, Immediate window, Watch/Quick Watch expression fields and explicit Evaluation editor share a typed, side-effect-free language service. The existing classic menus, colors, source panes and editor options remain in use; this is not an embedded replacement editor.

## Commands and typing

| Command | Shortcut | Behavior |
|---|---|---|
| List Members | Ctrl+J | Lists the accessible symbols or members of the receiver. |
| List Constants | Ctrl+Shift+J | Uses an enum/Boolean assignment or argument type when known; otherwise lists visible constants. |
| Complete Word | Ctrl+Space | Inserts a unique match, or opens the list. |
| Quick Info | Ctrl+I | Shows the nearest call's signature or the declaration at the caret. |
| Parameter Info | Ctrl+Shift+I | Shows the outer call when calls are nested. |
| Definition | Shift+F2 | Uses the typed source resolver to navigate to a project declaration. |

Tab commits a completion. In a source pane, Enter commits it and inserts a newline with the current indentation. In Immediate, Watch and Evaluation fields, Enter commits the open suggestion **without evaluating the expression**; another explicit Enter or the host's command is needed to evaluate. A period, opening parenthesis, comma or space commits a selected completion and continues typing. Escape dismisses the list and information. Arrow keys, Home/End and Page Up/Down navigate the list. Clicking a row also commits it.

**Tools → Options → Editor** controls Auto List Members, Auto Quick Info and Auto Data Tips. Disabling automatic assistance does not disable the manual commands. Automatic suggestions are suppressed in comments, strings, date literals, composition input and read-only source. Data tips remain break-mode-only and use the existing guarded debugger inspector.

Lists and hints operate on canonical source offsets in full-module, procedure, split and virtualized source views. Insertion replaces the whole identifier, including the suffix to the right of a caret in the middle of a word. A changed project, referenced declaration, type-library descriptor or receiver invalidates a stale completion before it can be committed.

## Resolution

The tolerant declaration index accepts unfinished procedure bodies. It records module/procedure scope, local shadowing, Public/Private/Friend visibility, `Declare`, events, Property Get/Let/Set, UDTs, enums, constants, arrays, fixed-length strings, `DefType`, type suffixes, bracketed/Unicode identifiers, explicit line continuations and colon-separated statements. Conditional compilation follows the project's conditional constants. Get/Let/Set locals do not leak into one another.

Receiver resolution includes nested `With` blocks, arrays/control arrays, indexed default members, object-returning functions/properties and array-returning functions. For example:

```vb
Dim rs As ADODB.Recordset
Dim tree As TreeView
Dim customers() As Customer

rs.Fields(0).Value
rs.Clone().MoveNext
tree.Nodes(1).Parent.Text
customers(0).Name

With customers(0)
    With .Parent
        .Name = "Example"
    End With
End With
```

Argument help understands nested calls, calls without parentheses, named arguments, omitted arguments, Optional/ByRef/ByVal and ParamArray. It bolds the active parameter and displays Optional parameters in brackets. `As`, `As New`, `New` and `Implements` offer type names. Expected enum types narrow constants for calls such as `MsgBox` and properties such as a CheckBox's Value. Named parameters can be inserted as `Name:=`.

During a pause, expression fields use the **selected call-stack frame**, not merely the visible source module. Resolving a signature or member list does not inspect values or run a procedure.

## Runtime metadata and Object Browser

`src/editor/type-catalog.js` shares the runtime's registered built-in signatures and VB/data constants, plus declarative return/member types for the implemented adapters. This covers intrinsic controls, common-control item collections, Err/App/Screen/Clipboard, Collection/Dictionary, project-private FileSystemObject/TextStream, ADO/DAO adapters and configured Data Environment connections/commands/recordsets.

The Object Browser consumes the same metadata, project UDT/enum declarations and imported descriptors. Data Environment member names come from configuration; listing them does not open connections or expose credential values. The catalog describes implemented browser adapters, not all members of native Windows libraries.

Unknown late-bound `Object` and `Variant` receivers are not assigned guessed members. An explicit declaration or supplied type descriptor is required to know their members statically.

## Portable reference metadata

Choose **Project → References → Browse…** to import a JSON descriptor. The file is parsed as data, validated, limited to 4 MiB in the dialog, and applied only with OK. Cancel makes no project changes. Importing a library with the same case-insensitive name replaces its descriptor. Remove removes the selected portable descriptor.

A sample is included at `examples/type-libraries/sample-automation.json`:

```json
{
  "name": "ExampleAutomation",
  "types": [
    {
      "name": "Client",
      "members": [
        { "name": "Title", "type": "String" },
        { "name": "Ready", "type": "Boolean" },
        {
          "name": "Find",
          "type": "ExampleAutomation.Client",
          "params": ["Key As String", "Optional Exact As Boolean = True"]
        }
      ]
    }
  ]
}
```

This makes `Dim client As ExampleAutomation.Client` available to code assistance. **It does not implement or instantiate Client at runtime.** A corresponding runtime adapter must exist separately.

Descriptors are saved in `project.typeLibraries` in the browser project format. Existing native `Reference=`/`Object=` identities are left intact. Portable descriptors are not written as fictitious native library references and are not embedded into a native type library by `.vbp` export. A native reference object can also carry an explicit `typeLibrary: {name, types}` descriptor for embedded hosts. A missing reference's attached descriptor is not used.

For a reusable service without the IDE:

```js
import {EditorIntelligence} from './src/editor/intelligence.js';
const service = new EditorIntelligence();
const unregister = service.registerTypeLibrary(descriptor.name, descriptor.types);
const result = service.completions(project, module, line, source, caretOffset);
const signature = service.parameterInfo(project, module, line, source, caretOffset);
unregister();
```

Types can declare `defaultMember: "Item"`; members can include `description`, `hidden`, `restricted`, `array`, `kind` and parameter signatures. Project `VB_UserMemId`, `VB_Description` and member flags contribute default-member/description/visibility metadata. Imported JSON is not interpreted as JavaScript, HTML, a URL or a native library path.

## Safety and performance

Automatic IntelliSense never uses JavaScript `eval`, invokes user procedures/getters, executes native constructors, loads DLL/OCX files, scans the Windows registry or performs database/HTTP operations. Existing explicit debugger evaluation remains a separate, deliberate command. Break-mode data tips use the guarded inspector, which can refuse unsafe expressions.

Declaration indexes are reused until source or relevant metadata changes. Completion prefix filtering reuses candidates, and rendered completion rows are bounded to 13 rather than proportional to the result count. The expression AST cache is bounded to 128 entries with input-length/depth limits. The source editor continues to use its existing 256-row virtual input window for large files; the canonical source is still a full string, not a rope.

## Validation and compatibility boundaries

```sh
npm run build
npm test
python -m pip install playwright==1.57.0
python -m playwright install --with-deps chromium firefox webkit
VB6_BROWSER=chromium python tools/browser-intellisense-tests.py
VB6_BROWSER=firefox python tools/browser-intellisense-tests.py
VB6_BROWSER=webkit python tools/browser-intellisense-tests.py
```

The dedicated browser suite records JSON reports and screenshots under `validation/intellisense*`. It covers keyboard commits/undo, typed chains, split/procedure views, literal suppression, constants/parameter hints, settings, accessible virtual lists, stale candidates, a 50,000-line source module, break-mode data tips, Immediate expressions and reference import/Object Browser integration. Broader existing IDE/runtime and detached-window suites remain separate checks.

This is a browser implementation of the classic IntelliSense workflows, not certification of every native VB6 type library, add-in, OCX binary, Windows locale, physical device/IME or Microsoft screenshot. The tolerant index is not a replacement for compiler diagnostics. Supplying metadata does not remove the runtime's documented compatibility boundaries.

Behavioral references: Microsoft's retained classic Visual Basic editor documentation for the [Edit menu](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/edit-menu) and [Options dialog](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/options-dialog-box). These describe the classic editor interaction model; the automated screenshots here are of this implementation, not native VB6 reference captures.
