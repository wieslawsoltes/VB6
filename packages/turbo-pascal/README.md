# @vb6/turbo-pascal

A dependency-free JavaScript frontend for **Turbo Pascal 7.0 source**, integrated with VB6 Studio's project model, forms, shared instruction representation, debugger, and native exporters.

This package compiles source; applications execute through the host's existing VM or AOT backend. It does not embed an external Pascal executable or evaluate authored Pascal as JavaScript. The language target is the final Borland Turbo Pascal release, not contemporary Delphi or Free Pascal. [Compatibility and implementation details](../../docs/TURBO-PASCAL.md) identify supported features and remaining differences.

## Build and use

From the repository root:

```sh
node tools/build-pascal.mjs
npm pack ./packages/turbo-pascal --ignore-scripts
```

The local package contains a self-contained ES module, a classic browser bundle, TypeScript declarations, and its license. It has no runtime npm dependencies and requires Node.js 22 or later when used in Node.

```js
import {compilePascalSource} from './packages/turbo-pascal/dist/index.js';

const program = compilePascalSource(`program Greeting;
var I: Integer;
begin
  for I := 1 to 3 do WriteLn('Hello ', I)
end.`, {name: 'Greeting'});

if (!program.valid) {
  console.error(program.diagnostics);
} else {
  console.log(program.modules.get('greeting').procedures.get('main').code);
}
```

In a browser, load `dist/browser.js` and call `globalThis.TurboPascal.compilePascalSource`. The bundle works in workers and isolated JavaScript contexts without DOM or network access. The repository build also writes `dist/turbo-pascal.js`.

## API

| Export | Purpose |
|---|---|
| `PASCAL_VERSION`, `PASCAL_DIALECT` | Package version and source dialect |
| `PASCAL_KEYWORDS`, `tokenizePascal`, `PascalError` | Positioned tokens, retained comments/directives, lexical errors |
| `parsePascalModule` | Pascal abstract syntax tree |
| `lowerPascalModule` | Typed lowering with generated shared-language source and source mapping |
| `compilePascalModule` | One Pascal module compiled to shared instructions |
| `createPascalProject` | Normalized project with Pascal as its default source language |
| `compilePascalSource` | Compile a complete Pascal source and explicitly supplied units |
| `compileModule`, `compileProject` | Mixed Pascal/Visual Basic dispatch through the shared compiler |

`createPascalProject(source, options)` accepts `name`, `moduleName`, `units`, `settings`, and an optional shared `form` model. Each supplied unit has at least `{name, code}`; `kind` and `language` can override its defaults. Module names are case-insensitive in the compiled `Map`.

```js
const program = compilePascalSource(`program Main; uses Arithmetic;
begin WriteLn(Twice(21)) end.`, {
  name: 'Main',
  units: [{name: 'Arithmetic', code: `unit Arithmetic;
interface
function Twice(Value: Integer): Integer;
implementation
function Twice(Value: Integer): Integer;
begin Twice := Value * 2 end;
end.`}]
});
```

Supply units explicitly. The compiler does not search a filesystem or fetch unresolved names. Form/control definitions use the existing VB6 Studio model. A Pascal form module is a unit containing handlers such as `procedure RunButton_Click;` and `procedure Editor_KeyPress(var KeyAscii: Integer);`.

Diagnostics retain Pascal source coordinates. Compiled Pascal modules expose `language`, original `source`, `generatedSource`, and Pascal/source-map metadata. Generated procedures use the reserved `__Pascal` prefix. Consumers should execute the shared instructions and display original-source diagnostics.

## Execution and export

Inside the repository, pass `createPascalProject(...)` to `VirtualMachine`, `compileWin32`, `compileMacOSAOT`, or the existing macOS/Linux application exporters. These APIs retain their existing target constraints. The SDK intentionally does not bundle the IDE or platform runtime.

For command-line work:

```sh
node tools/compile-pascal.mjs app.pas --target check
node tools/compile-pascal.mjs app.pas --target run
node tools/compile-pascal.mjs app.pas --target ir --out app.ir.json
node tools/compile-pascal.mjs app.pas --target win32 --out app.exe
```

Default `Read`/`ReadLn` requires the VM host's `inputBox` line-input adapter; the CLI supplies UTF-8 stdin. `Write`/`WriteLn` uses the shared print host. Named files use the shared filesystem. Browser and native GUI hosts keep their existing dialogs and file access model.

## Verification

`tests/pascal-sdk.test.mjs` imports only the packaged files from an isolated directory, runs the browser bundle without DOM/network/eval capabilities, and verifies source diagnostics, unit linking, forms, and mixed-language output. The compiler, debugger, IDE, file, object, CLI, and native suites are documented in [the language guide](../../docs/TURBO-PASCAL.md).
