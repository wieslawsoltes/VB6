# Language front end and static reference binding

The source compiler now validates statically known names and source-defined calls before execution, including uncalled procedures and unreachable statements. `compileProject`, Check Project Syntax, automatic worker diagnostics and the fallback checker share the same semantic pass. An invalid program still cannot start in the normal VM or native compiler.

This is an incremental compatibility improvement, not complete Microsoft VB6 parity or certification against a licensed VB6 compiler.

## Implemented behavior

| Area | Behavior |
| --- | --- |
| Numeric tokens | Hexadecimal and octal literals, including optional `O`, `%` Integer and `&` Long suffixes; signed 16/32-bit interpretation; located overflow. |
| Conditional compilation | Physical continuations for `#Const`, `#If` and `#ElseIf`; blank excluded/consumed lines retain physical debugger and diagnostic coordinates. Strings, comments and bracketed identifiers cannot introduce continuations. |
| Name identity | Case-insensitive, type-suffix-insensitive parameter/loop identity; later local declarations, Static/Const, implicit ReDim and function-result variables retain existing whole-procedure scope. |
| Static references | `Option Explicit` names, public imports and ambiguity, module/class private members, source UDT fields and enum members, nested With receivers, constants, source events and AddressOf targets. |
| Calls | Required/optional and omitted arguments, named parameter identity, duplicate or unknown names, positional-after-named order, excess arguments, ParamArray named restrictions, call-site ByVal for Declare only, Sub-as-value rejection. |
| Properties and arrays | Get/Let/Set selected using expression or assignment context; accessor-specific visibility; index arguments exclude the setter value; source default members; array-returning calls bind before result subscripts. |
| IDE metadata | Designer control/menu declarations and ambient form/source-control names; data-only external declarations and reference types; metadata-only edits invalidate semantic results without reparsing unchanged source. |

For example, neither `Debug.Print "started"` nor a later statement executes here:

```vb
Option Explicit
Sub Main()
    Debug.Print "started"
    Exit Sub
    misspelled = 1
End Sub
```

Compilation reports `VB_UNDEFINED_NAME` at the last assignment. `On Error Resume Next` cannot suppress compile-time errors. Without `Option Explicit`, implicit variables retain their existing behavior; known private members and malformed source-defined calls are still checked.

## Integration architecture

`reference-checks.js` reuses the constant binder's module/local declaration scopes and the existing `RecordTypeIndex`. Its descriptors, visibility maps, With receivers and call checks live only for the current validation. It neither evaluates an argument nor invokes a property/host getter. It adds no runtime instructions and does not change statement budgets or sequence points.

A source record field is resolved in the declaring record's module, not whichever module uses it. Source properties retain separate accessors rather than copying the visibility of their first declaration. Typed array returns distinguish calling the producer from indexing its result.

The diagnostic cache retains parsed modules, not live controls or provider connections. Ordered module identities, conditional settings, layout/form declarations, external symbols and reference metadata participate in semantic-cache identity. A dependency edit revalidates all modules; an identical snapshot reuses the completed semantic result. Interleaved/cancelled passes install their own detached metadata only when completing validation. Returned diagnostic arrays are caller-owned.

## Explicit host and compiler-extension declarations

A host that injects names into the runtime library must also describe them to the compiler. Pass declarations, not executable values:

```js
const compilerInput = {
  ...project,
  externalSymbols: [
    {name: 'HostClock', kind: 'function', type: 'Long'},
    {name: 'HostDevice', type: 'Object'}
  ]
};
const compiled = compileProject(compilerInput);
```

This acknowledges the name; it does not implement the host service or authorize it. The host remains responsible for its runtime implementation, permissions and supported argument/types. These declarations currently do **not** receive the full source-procedure signature checking described above.

`externalSymbolSnapshot` reads own data descriptors rather than getters, keeps only name/type/kind/array/readOnly/parameter declaration text, and bounds the number of symbols and parameters. The diagnostic worker receives no connection strings, credentials, image assets or live service adapters. Inputs otherwise follow the existing plain-data project contract; this is not a sandbox for arbitrary JavaScript project objects.

Compute compilation supplies its own typed intrinsic declarations; they never become ordinary VB6 globals. Application prevalidation temporarily describes `ComputeInput`, then checks the generated source module in the final program. Existing `COMPUTE_SYMBOLS` and `computeSymbolProject` exports remain available. Native internal kernels and the VM test oracles declare only their explicit host registries. Source UserControls and PropertyPages retain designer/ambient declarations when creating an isolated source class.

Migration plugins that introduce source names provide `externalSymbols` alongside their expression hook:

```js
const plugin = {
  id: 'device-migration',
  externalSymbols: [{name: 'Special', kind: 'function', type: 'Integer'}],
  expression({node}) {
    if (node.kind === 'id' && node.name.toLowerCase() === 'special') {
      return '42I';
    }
  }
};
```

Declaring an extension name does not disable checks for unrelated names. Source metadata is combined for compilation without replacing the original project in migration results.

## Validation

`tests/language-static-front-end.test.mjs` covers numeric widths, malformed tokens, suffix aliases, continuation boundaries and source locations. Its 31 cases reproduce 26 failures on the unchanged starting tree.

`tests/language-reference-checks.test.mjs` exercises names, calls, source classes/records/properties/events, extension metadata, startup rejection and cache invalidation. The initial 52 cases reproduce 42 failures on the unchanged starting tree. Additional cases cover backend symbol isolation, connection-secret exclusion and parser depth limits.

`tools/reference-browser-fixtures.mjs` runs through the built runtime and actual IDE, including its application host for real designer controls. `tools/browser-language-parity.py` also changes control metadata and source signatures through both the worker and fallback scheduler, asserting exact diagnostics and parse/cache counts. The existing browser fixtures remain in the suite.

Some existing tests intentionally exercise invalid runtime bytecode. Their test-only `runtimeBoundaryProgram` helper first asserts exact compile diagnostics, then constructs an explicitly unchecked program to reach the original runtime guard. The production startup check is unchanged. Native diagnostic tests now assert stable compiler codes and source locations when errors are caught earlier; lower-level native ABI, memory/lifetime, error and argument-plan checks remain intact.

Useful commands:

```sh
npm run build
node --test --test-concurrency=4 tests/*.test.mjs
python tools/browser-language-parity.py
```

Normal builds verify the committed artifact fingerprints. The existing explicit maintainer manifest-update command is used only after reviewing source changes; it is not enabled in ordinary builds or CI.

## Remaining compatibility boundaries

Object/Variant and incomplete native/reference metadata remain late-bound. This pass does not infer dynamic object flow or certify every native/COM/OCX member. Full static ByRef type compatibility, all implicit default-member/value conversions, complete assignment type/rank checking, external-library overload selection, exact full VB6 name-resolution priority in every host namespace, and licensed VB6 differential conformance remain further work. Runtime checks are still required.

Parser/compiler allocation and expression-depth limits remain deliberate safety boundaries. Locale/ANSI behavior, all host APIs, native array-return ABI, COM activation/destruction and debugger Edit-and-Continue parity are not completed by these changes. No overall compiler speedup is claimed: additional semantic checking has a cost, while completed diagnostic results can be reused.

## Primary language references

The Microsoft specifications below guide the supported syntax and checks. MS-VBAL also describes newer VBA features; its presence here does not imply that VB6 supports LongLong/LongPtr or every VBA extension.

- [MS-VBAL lexical tokens and numeric literals](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/685ad840-accb-4bdb-8bfd-f3d88498547a)
- [MS-VBAL simple name expressions](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/e3af3398-f090-40db-ade6-de3a93589c76)
- [MS-VBAL Option Explicit](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/e9253cf2-5139-4abd-8c1d-eaf390805cb8)
- [MS-VBAL call statements](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/f7c864a8-8fce-49dc-8347-30dc749d6576)
- [MS-VBAL conditional compilation](https://learn.microsoft.com/en-us/openspecs/microsoft_general_purpose_programming_languages/ms-vbal/a95f1a56-68ba-4a7a-8269-a5e9d96a7cbc)
- [Microsoft ParamArray named-argument restriction](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/a-procedure-with-a-paramarray-argument-cannot-be-called-with-named-arguments)
