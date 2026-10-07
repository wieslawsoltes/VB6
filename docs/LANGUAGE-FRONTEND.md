# Language front-end compatibility and performance

The language front end is shared by execution, native compilation, exported applications and editor diagnostics. The work in PR #74 is an incremental compatibility implementation, not certification of complete Microsoft VB6 conformance. Existing host/runtime restrictions remain in force.

## Module responsibilities

`source-scanner.js` owns lexical boundaries: strings with doubled quotes, escaped identifiers, comments, dates versus file-number prefixes, parentheses, named-argument separators and statement colons. It does not evaluate expressions or access host objects. `lexer.js` creates value tokens and physical-to-logical source lines. `expression.js` parses expression trees and call arguments. `statement-syntax.js` identifies control-flow delimiters without inspecting literal contents. `declarations.js` parses variables, parameters and procedure headers. `compiler.js` retains the public compilation entry points and instruction/source mapping. `binding.js` performs side-effect-free constant and enum binding; `diagnostics.js` owns incremental parsed-module caching.

The existing `compileModule`, `compileProject`, `parseDeclarations` and `parseParameters` exports remain available. Consumers do not need to replace their runtime, project format or IDE UI. Rebuild generated bundles after changing any front-end source; see [the reproducible artifact contract](IDE-BUILD-ARTIFACTS.md).

## Compatibility added and corrected

| Area | Behavior covered by the new regression suites |
| --- | --- |
| Lexical boundaries | Apostrophes and `Rem` comments; quoted colons/commas; bracketed names; multiple `#` file handles; doubled quotes; numeric exponents and overflow diagnostics. |
| Expressions | Bracketed keywords remain identifiers; leading `!member` addresses the current `With` object's default member; incomplete member access produces a VB diagnostic; chained powers associate left-to-right, while exponentiation still binds above unary negation. |
| Control flow | `Then`, `Else` and Case-range `To` inside strings are not syntax; nested single-line `If` binds each `Else` to its closest unmatched `If`; colon-separated branches retain source spans. Duplicate `Else`, `ElseIf` after `Else`, Case after Case Else, mismatched procedure exits, and conditions at both ends of a Do loop are diagnosed. |
| Declarations | Parameterless procedure headers without parentheses; escaped and non-ASCII identifiers; balanced array bounds; qualified declared types; the 60-dimension array limit; suffix/type mismatch and invalid `WithEvents`, `As New`, fixed-string and parameter modifier combinations. |
| Binding | Optional object defaults of `Nothing`; checked typed scalar defaults; module-qualified enums use Long storage and retain private visibility; fixed-string lengths bind module, procedure and forward constants, including UDT fields. |
| Conditional compilation | Quote-aware comments; Text comparison independent of Option Compare; typed numeric, Currency and Date constants; undefined flags are Empty; every `#If`/`#ElseIf` expression is checked, including excluded branches. Physical line positions remain intact. |
| Incremental diagnostics | Unique stable module IDs retain parsed trees across reorder operations. Duplicate IDs have isolated positional entries. Cross-module bindings are rebuilt after every snapshot, including visibility and fixed-length constant changes. |

The former exponentiation expectation `2 ^ 3 ^ 2 = 512` has been corrected to `64`; explicitly parenthesized `2 ^ (3 ^ 2)` remains `512`. The existing dead-branch fixture now uses an undefined conditional flag rather than an illegal function call. New negative tests separately require rejection of calls in excluded conditional expressions. No runtime/security assertion or CI job is removed.

## Robustness limits

Expression-parser recursive nesting is bounded at 256, recursive inline statements at 128, conditional expression evaluation at 256, and constant dependency depth at 256. Constant binding retains its 100,000-step budget and 1 MiB generated-string limit. Fixed-string lengths must resolve to integers in the implementation's 1..65,535 range. These are explicit implementation limits, not claims that every Microsoft compiler limit is identical. The parser depth bound does not make every arbitrary-size flat expression safe for every downstream consumer.

Malformed syntax and exceeded limits produce VB diagnostics rather than relying on incidental JavaScript exceptions. Constant/default binding does not execute user functions or instantiate a host object. Native object visibility, agent permissions, debugger execution budgets and optional layout gating are unchanged.

## Reproducible benchmark

Run each checkout in a separate process with the same Node version and machine:

```sh
node tools/bench-language.mjs --root /path/to/baseline > baseline.json
node tools/bench-language.mjs > current.json
```

The script supports `--modules`, `--locals`, `--tokens`, `--samples` and `--warmup`. It checks fixture validity and emits the runtime, CPU, workload parameters, raw samples and min/median/max milliseconds as JSON. It does not mutate source or record new artifact fingerprints. The benchmark is diagnostic, not a timing-sensitive CI assertion.

A local isolated-process run on Node v22.16.0 / Linux x64 / AMD EPYC 9V74 used 240 modules with 30 local declarations each, seven samples after three warmups, and 100,000 tokenizations per sample. The baseline source was main `e0af4dc59a0f797a3feb54de0f96fabeba23da37` (tree `99445cb18cde8498279c3221355663dcc8bb6ed3`); the implementation includes main through `62227337e6a78d957be25efc374ef95e91341f85`.

| Operation | Baseline median | Updated median | Ratio |
| --- | ---: | ---: | ---: |
| Compile the project | 69.220 ms | 44.764 ms | 1.55x faster |
| Check a warm diagnostic snapshot | 33.802 ms | 14.452 ms | 2.34x faster |
| Tokenize 100,000 expressions | 279.013 ms | 185.124 ms | 1.51x faster |

The gains come from ASCII lexical fast paths, once-per-validation constant/enum indexes, shared immutable enum namespaces and avoiding unnecessary reparsing/serialization. These measurements are workload- and machine-specific, not promises for all projects or browser startup. Raw timings vary with JIT compilation, garbage collection and other processes.

## Validation and remaining work

The three new `language-*-hardening.test.mjs` suites execute 158 regression cases. `npm test` builds and verifies outputs before running the full suite; `node --test tests/language-*-hardening.test.mjs` runs just these language cases. Benchmark CLI and generated-artifact negative tests are separate. The retained Validate workflow provides browser and Windows results for each exact PR head. Generated native compiler and diagnostics-worker bundles are now checked by the same strict fingerprint contract as other untracked generated outputs; built distributions still contain them.

Still needed for complete original-VB6 compatibility are exhaustive reference-compiler differential validation, completion of compile-time symbol/type checks, remaining token-aware statement/header grammars (including all Declare, Type/Enum/Event, For, Open and graphics edge cases), and complete agreement with host/runtime behavior across locales, code pages, Variants, native services and COM/OCX. The existing implementation supports portions of these areas; this PR does not certify them all. The Microsoft VB6 compiler was not available for a licensed differential run. Unsupported host services are not silently replaced or enabled by this front-end work.

## Semantic references

Microsoft's classic VBA documentation is used for shared classic Visual Basic semantics; it is not a substitute for a VB6 compiler oracle:

- [Exponentiation operator](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/caret-operator) and [operator precedence](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/operator-precedence).
- [If...Then...Else statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/ifthenelse-statement), [Rem statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/rem-statement), and [conditional compilation directives](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/ifthenelse-directive).
- [Dim statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/dim-statement), [Sub statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/sub-statement), [Function statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/function-statement), and [Type statement](https://learn.microsoft.com/en-us/office/vba/language/reference/user-interface-help/type-statement).
