# Language front-end compatibility and performance

The language front end is shared by execution, exported applications, editor diagnostics and the native compiler's common parsing stage. Native lowering and host services also have independent restrictions. This is an incremental compatibility implementation, not certification of complete Microsoft VB6 conformance.

## Module responsibilities

| Module | Responsibility |
| --- | --- |
| `source-scanner.js`, `lexer.js` | Opaque strings, escaped names, dates/file prefixes, comments, balanced delimiters, tokens and physical-to-logical source lines. |
| `expression.js` | Expression/call trees, precedence, ByRef grouping and bounded tree complexity. |
| `declaration-cursor.js`, `declarations.js` | Shared token cursor; variables, parameters, UDT fields and procedure headers. Parameters reuse their token stream rather than parsing a second declaration string. |
| `module-syntax.js` | Declare, Event, Enum, Type and Implements headers, plus enum members. |
| `statement-syntax.js`, `statement-headers.js` | Literal-aware conditional, loop, branch and file-statement delimiters; the existing VM instruction format is retained. |
| `compiler.js` | Public compilation entry points, structured instructions, labels and source mapping. |
| `binding.js`, `semantic-checks.js` | Side-effect-free constants, enum storage, fixed strings, declaration/property constraints and statically known loop-control types. |
| `diagnostics.js` | Incremental parsed-module caching with fresh cross-module binding after each snapshot. |

The existing `compileModule`, `compileProject`, `parseDeclarations` and `parseParameters` exports remain available. The project format and IDE UI are unchanged. Rebuild generated bundles after changing language source; see [the reproducible artifact contract](IDE-BUILD-ARTIFACTS.md). Normal build/CI verifies committed fingerprints and cannot refresh its own expectations.

## Implemented compatibility

| Area | Behavior covered by regression tests |
| --- | --- |
| Lexical boundaries | Apostrophe/Rem comments, doubled quotes, escaped names, quoted colons/commas, multiple file handles, numeric exponents and physical continuation locations. |
| Expressions | Bracketed keywords stay identifiers; leading `!member` uses the current With receiver; malformed member access has a VB diagnostic. Powers associate left-to-right: `2 ^ 3 ^ 2 = 64`; parentheses still give `2 ^ (3 ^ 2) = 512`. Call parsing preserves implicit argument parentheses as a ByRef temporary. |
| Declarations | Parameterless procedure, Event and Declare headers; escaped/Unicode names in module headers, UDT fields, enum members and Implements targets. Declare Lib/Alias strings, default export names without VB type suffixes, and `As Any` restricted to external parameters. VBA7-only PtrSafe is explicitly rejected. |
| Declaration checks | Empty or duplicate Enum/Type members, duplicate type names, invalid UDT initializers/As New, missing field types, optional/ParamArray events, invalid external parameters and duplicate/conflicting member/return-variable declarations are diagnosed. Existing array-dimension, fixed-string and modifier checks remain. |
| Properties | Get/Let/Set index counts, parameter types, passing modes, optional/array flags and Let/Get value types are checked. Set requires an object-reference/Variant value; its type may differ from Get/Let. These are targeted checks, not a complete property-signature type checker. |
| Loops | Token-aware For/Each headers, To/Step/In delimiters outside literal/nested/member expressions, escaped/Unicode counters, multiple Next counters and active-counter reuse checks. Known numeric For counters must be writable numeric scalars or Variant; known array For Each controls require Variant. |
| Branches | Unicode/escaped labels, GoTo/GoSub, computed branches, On Error and Resume targets; an escaped `[Next]` label is distinct from the Resume Next statement. |
| File statements | Open modes/access/sharing/Len, nested-comma file-number expressions, Get/Put/Seek/Lock/Unlock and Print/Write/Input/Line Input parse into existing VM instructions. Quoted words and nested calls do not become delimiters. Line Input requires one assignable target. |
| Binding | Checked scalar/optional defaults, Nothing, qualified enum identity and Long storage, private visibility and constant-bound fixed strings including UDT fields. Private immutable intrinsic tables are cached separately for classic and layout-enabled projects. |
| Conditional compilation | Text comparison independent of Option Compare, typed numeric/Currency/Date constants, undefined flags as Empty, and validation of excluded branch expressions while retaining physical locations. |
| Incremental diagnostics | Stable unique module IDs preserve syntax across reorder operations; duplicate IDs are isolated. Public variable/type/enum changes are rebound even when the dependent module's syntax is cached. |

Constant/default binding and semantic checks do not execute user procedures, instantiate objects or open host services. Runtime permissions, native visibility, debugger budgets and optional layout gating are unchanged.

## Explicit robustness limits

Expression recursive nesting and resulting AST depth are bounded at **256**. Long flat binary/postfix chains receive an iterative tree check too, rather than bypassing the depth bound and overflowing a downstream JavaScript stack. Expression trees are also limited to **100,000 nodes**; large shallow calls below that budget remain supported. Small token streams avoid the extra traversal. These limits apply to parser-produced trees, not arbitrary host-supplied AST objects.

Recursive inline statements remain bounded at 128, conditional-expression evaluation at 256 and constant dependency depth at 256. Constant binding retains its 100,000-step budget and 1 MiB generated-string limit. Fixed-string lengths use the implementation's 1..65,535 range. Limits produce source-located VB diagnostics and are implementation safety boundaries, not assertions that Microsoft's compiler has identical limits. Input tokenization still requires memory proportional to source size.

## Reproducible benchmark

Use the same updated benchmark driver for both checkouts, in separate Node processes on the same machine:

```sh
node tools/bench-language.mjs --root /path/to/baseline > baseline.json
node tools/bench-language.mjs > current.json
```

Options are `--modules`, `--locals`, `--tokens`, `--parses`, `--samples` and `--warmup`. The JSON contains runtime/CPU details, workload parameters, raw samples and min/median/max milliseconds. Fixtures are validated; source and fingerprints are not modified. Timing thresholds are deliberately not CI assertions.

A local Node v22.16.0 / Linux x64 / AMD EPYC 9V74 run used 240 modules with 30 local declarations, seven samples after three warmups, 100,000 tokenizations and 10,000 parameter/call parses per sample. The baseline was main `366539b30e68d5cdf03db66d727c3befcb01620e`, tree `20c3f9bd12fa2a62ba941a0cea8de3d6b7882af5`, which already includes the earlier language optimizations.

| Operation | Baseline median | Updated median | Baseline / updated |
| --- | ---: | ---: | ---: |
| Compile project | 40.862 ms | 38.433 ms | 1.06x |
| Warm diagnostic snapshot | 9.936 ms | 9.269 ms | 1.07x |
| 100,000 tokenizations | 164.479 ms | 159.463 ms | 1.03x |
| 10,000 parameter-list parses | 109.852 ms | 67.729 ms | 1.62x |
| 10,000 explicit call parses | 40.899 ms | 30.305 ms | 1.35x |

Parameter/call improvements come from token-stream reuse and avoiding AST serialization. Precompiled procedure terminators and immutable intrinsic tables reduce repeated compilation/binding work. The small project/tokenization differences are workload-specific observations, not universal speed guarantees. JIT, garbage collection and other processes affect timings; the benchmark does not measure browser startup or native execution.

## Validation and remaining work

The module-syntax, statement-headers, semantics and expression-limits suites add **199 cases**, alongside the earlier hardening suites and full repository regressions. They include actual VM event/interface/property dispatch, ByRef behavior, nested file operations, cached dependency changes, malformed input and native-generation boundary checks. Run:

```sh
npm test
node --test tests/language-module-syntax.test.mjs tests/language-statement-headers.test.mjs tests/language-semantics.test.mjs tests/language-expression-limits.test.mjs
```

The retained Validate workflow supplies browser and Windows checks for the exact PR revision. Its Windows API/layout comparisons are not a licensed VB6 language oracle. Generated-bundle fingerprints are updated with the existing local maintainer command only after inspecting source changes, then independently enforced by ordinary builds.

Remaining work includes exhaustive licensed-VB6 differential validation, general symbol/type checking beyond the targeted checks above, typed-array return and property-signature edge cases, residual graphics/statement grammar, and complete locale/code-page/Variant/native/COM/OCX agreement. File Print still follows the existing runtime's semicolon-oriented output behavior; this parser change does not implement full comma tab-zone semantics.

The separate native Declare extractor still requires parentheses and its supported native signatures. A regression verifies that a parameterless Declare runs through the browser VM, is explicitly rejected by native lowering, and produces a PE only after using the supported parenthesized form. PE byte generation/inspection is not execution of that new fixture. Escaped keyword counters and arbitrary host types likewise do not gain universal native support simply because the common parser accepts them. No licensed Microsoft VB6 compiler was available for a differential run. Unsupported host behavior remains diagnosed, not silently enabled.

## Semantic references

Microsoft's classic VBA documentation describes shared classic Visual Basic semantics; it does not replace a VB6 compiler oracle:

- [Declare](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/declare-statement), [Event](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/event-statement), [Enum](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/enum-statement), [Type](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/type-statement).
- [For...Next](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/fornext-statement), [For Each control types](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/for-each-control-variable-must-be-variant-or-object), [Open](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/open-statement).
- [Property signature consistency](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/definitions-of-property-procedures-for-the-same-property-are-inconsistent), [Property Let](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/property-let-statement), [Property Set](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/property-set-statement).
- [Exponentiation](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/caret-operator), [operator precedence](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/operator-precedence), [If...Then...Else](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/ifthenelse-statement), [conditional compilation](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/ifthenelse-directive).
