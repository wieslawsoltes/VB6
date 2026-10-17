# @vb6/xaml-compiler

Dependency-free JavaScript XAML syntax, schema, semantic compiler, construction IR,
explicit host object writer and UTF-16 language services. ES modules run in Node.js,
browsers and workers without a DOM or a .NET runtime. TypeScript declarations are
included. This package does not import the VB6 application.

**Development version 0.1.0.** This is an independent implementation informed by
Microsoft's public XAML documentation, not a complete translation of Microsoft's
C# compiler, WinMD system, XBF format, MSBuild tasks or C#/C++ generated bindings.
The built-in schema contains a representative WinUI vocabulary, not the complete
WinUI API inventory. Constructing an object description is not implementing that
control's rendering, layout, dependency properties or binding engine.

## Compile and construct

```js
import {
  compileXaml, instantiateXaml, createObjectHost, XamlLanguageService
} from '@vb6/xaml-compiler';

const text = `<Button
  xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
  xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
  x:Name="SaveButton" Width="120" Content="Save" />`;
const result = compileXaml(text);
if (!result.success) throw new Error(result.diagnostics.map(d => d.message).join('\n'));

// Tooling/data host, deliberately not a WinUI renderer.
const instance = instantiateXaml(result.program, createObjectHost());
console.log(instance.root.properties.Content); // Save
console.log(instance.names.get('SaveButton') === instance.root); // true
instance.dispose();

const language = new XamlLanguageService();
language.openDocument('file:///Main.xaml', text, 1);
console.log(language.diagnostics('file:///Main.xaml'));
console.log(language.symbols('file:///Main.xaml'));
language.closeDocument('file:///Main.xaml');
```

## Compiler and host contracts

`parseXaml` builds a recovering namespace-aware syntax tree with exact source
spans, comments, CDATA, attributes and tokens. `parseMarkupExtension` handles
nested extensions and binding function arguments. `compileXaml` resolves types
and members through `XamlSchemaContext`, converts scalar values and produces a
serializable construction program only when compilation succeeds. Failed results
still expose the syntax, semantic nodes and diagnostics for an editor.

Custom types use `schema.registerType(uri, name, {base, members, contentProperty})`.
Property metadata supports literal converters, enums, collections, dictionaries,
attached properties, events and nullable values. `emitXamlModule` emits a data ES
module whose `build(host, options)` calls the object writer; it does not evaluate
user input as JavaScript.

The object writer requires `host.create` and `host.set`. Collection, binding,
event, template and theme semantics require explicit `add`, `bind`, `listen`,
`template` and `resource` hooks. External dictionary loading and deferred x:Load
require host preprocessing. Missing capabilities throw rather than creating
nonfunctional placeholders. Construction is transactional, with rollback and
reverse-order subscription/object disposal. Namescopes and resource identity are
retained, with cyclic resource construction detected.

`parseBindingPath`, `evaluateBindingPath` and `assignBindingPath` use expression
data. Calls require an explicit `invoke` callback; static types and casts require
host callbacks. They are not a complete C#/VB expression/type checker and do not
supply observable dependency tracking. Getters and callbacks are trusted host
code; this is not a sandbox for executing arbitrary application object graphs.

## Language service

`XamlLanguageService` owns immutable URI/version text snapshots. It supplies
completion, diagnostics, hover, namescope-aware element references/rename,
conservative resource references/rename, document symbols, folding ranges,
semantic tokens and formatting. Ranges and offsets use UTF-16; positions are
zero-based. Edits reject stale versions. Analysis is cached per document and
schema revision; parsing is not incremental subtree reuse. Resource rename
rejects ambiguous declarations and XML-encoded references instead of guessing.

The formatter preserves mixed-content and xml:space subtrees. It is not a
canonicalizing serializer. The independent VB6 integration lives in `src/xaml`
and `src/ide/xaml.js`, outside this package.

## Limits and validation

Defaults bound source size to 2,000,000 UTF-16 code units, XML nodes/attributes to
50,000, XML nesting to 256, and markup/binding nesting to 64. DTDs, external entity
resolution and arbitrary markup execution are rejected. Unsafe prototype member
names are rejected. Hosts remain responsible for the behavior of their callbacks.

From the repository, run `node --test tests/xaml-compiler.test.mjs` and
`node tools/test-xaml-package.mjs`. The latter packs the actual package, verifies
an isolated import and exercises TypeScript consumers when `tsc` is available.
No npm registry publication is performed by these commands.

## Optional macOS 26 vocabulary

`createMacOS26Schema()` adds the independent `urn:vb6:macos26` namespace to the
presentation base schema. `registerMacOS26Schema(schema)` adds it to an existing
schema without replacing the presentation types. This vocabulary is for host
authoring; it is not an Apple XAML language, SwiftUI compiler or AppKit ABI.

```js
import {compileXaml, createMacOS26Schema} from '@vb6/xaml-compiler';

const schema = createMacOS26Schema();
const result = compileXaml(`
  <mac:Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
              xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
              xmlns:mac="urn:vb6:macos26"
              x:Name="Form1" Title="Preferences">
    <mac:Button x:Name="Save" Title="Save" ControlSize="large"
                ControlStyle="default" IsDefault="True"
                mac:Accessibility.Label="Save preferences"
                Foreground="{ThemeResource macOS.labelColor}" />
  </mac:Window>`, {schema});

if (!result.success) throw new Error(JSON.stringify(result.diagnostics));
console.log(result.program.root.type.namespaceURI); // urn:vb6:macos26
```

The schema covers window/container/grid/stack, button/label/text/password/search,
checkbox/radio/switch, popup/combo/list, slider/scrollbar/progress/stepper,
table/outline/tab, box/image/date and separator descriptions. `MACOS26_CONTROLS`
exports the audited presentation/native type mapping; typed table/outline/tab
item descriptions are schema values, not placeholder controls. The VB6 adapter
outside this package lowers supported values to its existing native model and
diagnoses unsupported behavior. Another host must implement its own semantics.

`ControlSize`, `ControlStyle`, `Material`, foreground/background role fields and
the `mac:Appearance`/`mac:Accessibility` attached properties carry typed metadata.
Member `aliasFor` metadata gives aliases a canonical assignment identity while
retaining their original spelling in IR. `Title` and `Content` on a button are
therefore duplicate assignments. Collection metadata records its declaring/item
namespace so inheritance across namespaces retains type checks. Hosts still
receive the original bound member and are responsible for applying the alias.

Language services using this schema provide type/member/enum completion, alias
hover details and `macOS.<role>` intrinsic theme-resource suggestions. The schema
exposes `markupExtensionNamespaces` and `themeResourceKeys`; changing these sets
after a document has been analyzed requires advancing the schema revision.
The macOS namespace supports the standard built-in markup extensions when used
as a default namespace; use a presentation prefix for `Style`, `Setter` and brush
helper objects in that case.

The host must supply theme resolution. The VB6 application adapter preserves
supported semantic colors as live role metadata plus portable OLE color fallback,
including styles and opaque brush chains. The standalone object writer continues
to require an explicit host `resource` implementation for live theme values.
Neither schema registration nor `createObjectHost()` renders an AppKit control.

The implementation is informed by Apple's public
[macOS 26 design session](https://developer.apple.com/videos/play/wwdc2025/310/)
and [design-resource listing](https://www.figma.com/community/file/1543337041090580818/apple-design-resources-macos-26).
No Apple code, SF Symbols payload or Figma assets are included in this package.

References: Microsoft Learn's XAML syntax, XAML namespaces, x:Bind, Binding,
StaticResource and TemplateBinding documentation; Microsoft's public
`microsoft/microsoft-ui-xaml/src/XamlCompiler` source layout. No Microsoft source
files or generated WinMD inventory are included here. License: MIT.
