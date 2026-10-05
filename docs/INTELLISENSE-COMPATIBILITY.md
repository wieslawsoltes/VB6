# Browser IDE IntelliSense compatibility

This follow-up extends the implementation introduced in PR #23. It uses the same classic code window, Object/Procedure dropdowns, References dialog and Object Browser. No replacement editor or alternate IDE layout is introduced.

## Object/Procedure dropdowns and generated handlers

Form/class module-level `WithEvents` variables now appear in the Object dropdown. Their public events are obtained from the same tolerant declaration/type-library index as member completion. Class lifecycle events, form events, menu events and control events remain available. Control-array names are deduplicated and handler signatures include the `Index As Integer` parameter.

Implemented project interfaces appear in the Object dropdown too. Function/Sub and Property Get/Let/Set members produce separate, correctly typed private implementation stubs, preserving ByVal/ByRef/Optional/ParamArray declarations. The existing compiler/runtime remains responsible for validating and executing an implementation. A descriptor for an unavailable external interface is not a runtime implementation.

The Procedure dropdown initially has no selected event, so an event with only one available item can still be explicitly selected. Selecting a member creates its handler once, or navigates to the existing handler. Creation is a source-editor transaction, supports Undo, rejects read-only/running contexts, and does not execute the event. Changes to WithEvents/Implements declarations update the dropdown without scanning on every ordinary completion-prefix keystroke.

## Expression and declaration resolution

The service now resolves call hints for indexed/chained receivers without parentheses, such as `customers(0).Find Key`. Single-line If Then/Else branches have independent call contexts, and `Rem` comments do not incorrectly suppress identifiers such as `Remote`. Array subscript hints retain declared rank, including nested expressions in bounds. Label lists and definition navigation are restricted to the current procedure, with source offsets distinguishing same-line procedures.

Enum-typed assignments preserve their expectation through flag expressions and explicit line continuations. A Select Case branch derives its enum constants from the innermost selector. Nested RHS calls take precedence over the assignment target's type when selecting argument constants. Imported enum values remain scalar values rather than acquiring object methods.

Property Get results that are collections or arrays support the appropriate default/indexed access. User-defined record members resolve relative to their declaring module, not a same-named record in the consuming module. Project-qualified class names do not fabricate default instances. Events are offered for RaiseEvent or handler generation, not as invocable instance methods; named arguments are not suggested for events or array subscripts.

Typed intrinsic suffixes such as `Left` and `Left$` remain distinct list entries. VBA namespace subgroups constrain member lists, and return metadata now includes additional numerical, financial, date, string and filesystem intrinsics. BrowserForm Controls collections and Win32-backed hWnd properties have declarative metadata. Generic Object/Variant receivers are still not assigned guessed concrete types.

The shared lexical scanner distinguishes `fields!Name` and `fields![Display Name]` from a terminal Single type suffix such as `amount!`, allowing the browser compiler/runtime and IntelliSense to interpret the string-key shorthand consistently.

## Portable references

The References dialog adds Move Up/Move Down and an Enabled checkbox for portable descriptors. Ordered enabled libraries determine unqualified type-name priority. Changes are transactional: OK applies them; Cancel does not. Existing native Reference/Object identities are left untouched.

Portable descriptors support `class`, `interface`, `module`, `enum`, `type` and `alias` kinds, relative return/parameter types, default members, predeclared objects, creatable flags and hidden/restricted members. For example:

```json
{
  "name": "Example",
  "types": [
    {"name": "Choice", "kind": "enum", "members": [
      {"name": "FirstChoice", "value": 1},
      {"name": "SecondChoice", "value": 2}
    ]},
    {"name": "Client", "members": [
      {"name": "Find", "type": "Client", "params": ["Key As Choice"]}
    ]},
    {"name": "ClientAlias", "kind": "alias", "target": "Client", "members": []}
  ]
}
```

Here `Find` returns `Example.Client` and accepts `Example.Choice`. Enum constants and library module members participate in unqualified and qualified resolution. Interface and non-creatable descriptors do not appear as New candidates. Alias cycles terminate safely. Registration validates names, members and parameter descriptors before replacing an existing library; it rejects functions, accessors, cyclic objects, excessive depth/size/count and duplicate type names. Getter/toJSON callbacks are not invoked by registration. Disposing an old registration cannot remove its newer replacement.

The Object Browser retains variables/constants while source is incomplete and uses the same type/reference metadata. Importing or completing a descriptor never loads a native library, invokes a constructor or opens a database connection.

## Classic list and debugger-field interaction

A single mouse click selects a completion; a double-click inserts it. Tab and Enter retain the previously documented source-versus-expression behavior. Completion hints are bounded to the owning viewport and stale results cannot modify a read-only expression input.

Edit-menu IntelliSense commands target the focused Immediate/Watch/Evaluation expression rather than silently editing the source pane. Focusing source switches commands back to source. Committing a manual expression completion does not reopen a global list, and completion does not issue an evaluation command. Context validation dismisses outdated expression assistance on debugger/project changes.

## Follow-up hardening and DAO metadata

Portable parameter descriptors are checked against a complete, non-executable declaration grammar before storage or handler generation. Statements, comments, unclosed literals, call-valued defaults, duplicate parameter names and unvalidated internal accessor arrays are rejected. Property accessor entries use separate `accessor: "get"`, `"let"` or `"set"` members and are coalesced for member lists while retained individually for handler generation. A failed replacement retains the previous library. A known target with an invalid handler signature cannot fall through to a generic form handler.

Bracketed names with spaces are replaced as whole tokens even when the caret is inside the name. Numeric line labels leave the following call/comment in statement scope. An opening date delimiter suppresses completion, without treating multiple file channels as a date. Zero-argument array properties supply subscript hints. Project MDI forms, singleton runtime objects and child collections do not appear as browser `New` factories.

Public scalar/object interface fields generate their get/let or get/set contracts, including the ByRef setter required by the existing compiler. These generated stubs are compiled in regression tests. Menu arrays are deduplicated and preserve Index arguments; the existing Timer single-option/Enter behavior and module-owned handler routing are retained.

DAO no longer aliases its Recordset type to ADODB.Recordset. Workspace, Database, QueryDef, TableDef, Index, Field, Parameter and typed collections describe the shipped DAO adapter, including explicit Edit, Find/Seek, Clone and CopyQueryDef. DAO argument enums use the shared runtime constants. The metadata does not implement Jet/ACE providers, native catalog security or unsupported forced/batch cursor operations. GDI-backed Form/MDIForm/PictureBox hDC metadata does not acquire a live DC. RDO metadata for unmerged runtime work is not added.

## Qualified type paths, implicit arrays and project-reference snapshots

Type lists now project one namespace segment at a time. `As Models.` lists that
module's visible UDTs/enums, and `As Project1.Models.` retains the same identity.
`As Project1.` offers module paths rather than inventing `Project1.Point` for a
record actually declared in `Models`. Private records remain visible only in
their declaring module. Same-named records retain their declaring module when
selected. `As New` and `Implements` filter terminal types before emitting their
namespace paths, so unavailable factories do not create misleading branches.

Portable library names and aliases can include nested paths. For a library
`Vendor.Api` containing `Nested.Record`, completion follows `Vendor` → `Api` →
`Nested` → `Record`; it does not insert `Vendor.Record`. The tolerant language
service preserves Unicode/bracketed type qualifiers and spaces inside bracketed
names. This does not relax the separate project loader's existing module-name
validation or certify Windows locale behavior.

An otherwise undeclared, procedure-local `ReDim items(...) As Customer` now
provides `items(index).Name` member assistance and ranked subscript hints.
Explicit local, parameter, control-array, module and accessible public module
symbols take precedence, including declarations later in the source. A resize
does not retype an explicitly declared `Variant` or turn it into an assumed
concrete object. `ReDim Preserve`, multiple declarators, nested bound expressions,
DefType and active conditional compilation are indexed without evaluating bounds.
Repeated declarations are deduplicated using sets; source indexes remain cached.
This is declaration-based assistance, not control-flow analysis of runtime array
sizes or a guarantee that a resize with incompatible types is executable.

Project reference snapshots now share the same data-only boundary as explicit
registration. Source completion, expression-field revision checks and the type
resolver read own data descriptors before serializing. Callback-bearing entries,
getters, cyclic graphs and malformed arrays are rejected without invoking their
callbacks; unrelated valid entries remain usable. Missing native references and
disabled portable libraries remain excluded. In-place descriptor edits still
invalidate stale suggestions. Native reference identity strings are not rewritten.
The snapshot accepts at most 4,096 entries per input list and 4 MiB of enabled
serialized descriptor data; an over-budget snapshot is ignored. Host integrations
must supply ordinary non-proxy data objects, not active JavaScript proxy objects.

The classic language rules are documented in Microsoft's retained
[ReDim statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/redim-statement)
and [Avoiding naming conflicts](https://learn.microsoft.com/en-us/office/vba/language/concepts/getting-started/avoiding-naming-conflicts)
references. Nested portable-library namespaces are this implementation's metadata
convention, not a claim that native VB6 creates nested project modules.

## Declaration-context correctness

Argument metadata and hints preserve the declaring module's `DefType` defaults,
including coalesced indexed properties. Inferred types are shown in parameter
help without rewriting the stored source signatures. Qualifying an explicit
`As` type never searches inside bracketed parameter names, bounds, or literal
defaults: `Optional value = "As Point"` remains unchanged. The same rule applies
to portable reference metadata.

Nested `With` and `Select Case` receivers carry canonical source offsets, so
multiple procedures on one physical line cannot borrow another procedure's
locals. Declarative `ReDim` statements are also indexed inside single-line
`If ... Then ... Else` branches, including nested conditionals and continuations.
Bounds are not executed; explicit declarations still take precedence. Original
physical positions are retained for navigation. Empty host modules without a
`code` field now cache an empty index safely.

See Microsoft's retained [DefType contract](https://learn.microsoft.com/en-us/office/vba/language/concepts/getting-started/deftype-statements): defaults apply in their declaring module, including formal arguments and function/property return types. Static declaration metadata does not certify runtime numeric subtype tagging.

## Validation

`tests/intellisense-compatibility.test.mjs` adds service, metadata and executable generated-handler regressions. `tools/browser-intellisense-compatibility.py` runs all 18 original browser scenarios plus 21 new scenarios, including handler generation/undo, a single-event Timer, live declaration changes, interface accessors, mouse selection, menu routing, no-evaluation commits, read-only guards, labels, namespaces/suffixes, Select Case constants and reference priority. The permanent read-only IntelliSense workflow runs the complete 55-case suite in Chromium, Firefox and WebKit over modular HTTP, standalone HTTP and standalone file URLs, with no inline-content fallback or scenario skips. Each browser job checks committed generated distributions. The follow-up adds 10 browser workflows for qualified module/project/library paths, Unicode library qualifiers, ReDim members/rank/shadowing, callback-free source/Immediate snapshots and rejection of stale reference commits (49 scenarios × 3 browsers × 3 origins = 441 executions before this audit). `tests/intellisense-qualified-arrays.test.mjs` adds 39 focused cases, including an executable object-array runtime regression and a cached 5,000-array declaration index.

The declaration-context audit adds 28 focused Node cases and six browser scenarios
covering inferred parameter display, literal-preserving qualification, same-line
With/Select scope, inline conditional arrays and reference signatures. The full
matrix now runs **55 × 3 browsers × 3 origins = 495 scenario executions**.

```sh
npm run build
npm test
VB6_BROWSER=chromium VB6_INTELLISENSE_ORIGIN=http python tools/browser-intellisense-compatibility.py
```

`VB6_INTELLISENSE_ORIGIN` selects `modular`, `http`, `file`, or the explicitly separate local `inline` mode. HTTP tests host the application beneath a repository-name subpath. Each report records its actual URL and mode; inline runs are not deployment validation.

An optional `VB6_CHROMIUM` environment variable selects a local Chromium executable for development; CI uses Playwright's matched browser. Results and screenshots are written to `validation/intellisense*`.

This regression matrix is evidence for implemented browser workflows, not certification of every possible VB6 source program, native type library, external provider or physical IME. Runtime/compiler limitations remain separate from static metadata and source assistance.

## Behavioral references

Microsoft's retained classic-editor documentation describes [list selection and insertion](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/edit-menu), [event procedures and dropdowns](https://learn.microsoft.com/en-us/office/vba/excel/concepts/events-worksheetfunctions-shapes/control-and-dialog-box-events), and [Event declaration constraints](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/event-statement). These establish interaction/semantic contracts; test screenshots are of this browser implementation, not native VB6 reference captures.

The continuation was recovered from its interrupted publishing run and integrated with main `16c8ef706c525de141e1d5d547b3cf14b45beeea`. Locally the combined Node suite passed 2,117 tests, including 106 IntelliSense tests; the 39-case inline Chromium suite passed separately. Eighteen initial hardening regressions and four further DAO/reference regressions were reproduced failing before their fixes. The local browser policy blocks HTTP/file navigation; release deployment validation is performed by CI, not substituted with inline content. Final commit-specific results are recorded in the pull request.
