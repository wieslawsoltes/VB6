# Architecture and embedding

## Execution path

```text
.vb6web / supported VB text source
    → normalized project + form/control models
    → lexer / expression parser / module compiler
    → source-mapped instruction program
    → cooperative VM
    → browser host / controls / private filesystem
    → DOM, Canvas2D, optional WebGPU
```

The interpreter executes its own instruction and expression model. User VB expressions are not passed to JavaScript `eval` or `Function`. JavaScript is used to implement the runtime itself.

The same runtime bundle is embedded into the IDE's run iframe and exported HTML. There is no separate mock execution path for the editor. `tools/build.mjs` builds `src/runtime/entry.js`, writes the generated `src/exporter/runtime-payload.js`, exports all sample apps, and then bundles the IDE. Rebuild after changing runtime source; do not manually edit the generated payload.

## Module boundaries

`language` builds on core value/error conventions without DOM access. `runtime/vm.js` consumes the compiler output and a host interface. `runtime/host.js` provides browser interaction and lifecycle. `controls` adapts form/control models to DOM, input and drawing. `graphics` handles demand-rendered primitives. `project` is responsible for normalized models, text interchange and ZIPs. `designer`, `editor` and `ide` are absent from an exported runtime app.

The small zero-dependency bundler validates named import/export bindings and supports the module forms used in this repository. It is intentionally not a general npm bundler or arbitrary JavaScript parser. Full emitted files are readable, without minification; source modules remain separate in the source package.

## Shared theme and interaction layer (0.3.0)

`theme/theme.js` is the single profile/system-color source. `tools/theme-css.mjs` generates `theme/palette.css` during a normal build; do not independently maintain the palette CSS. `common.css` supplies shared classic borders, focus, input and menu styles. The original 16px SVG glyphs in `theme/icons.js` do not require an external font or asset request. `theme/menu.js` owns the retained submenu stack for both IDE commands and runtime VB menu events.

IDE `documents.js` binds live editor/designer instances to `mdi.js` windows. MDI geometry is serializable; activation does not replace another document's textarea. Code `projection.js` stores UTF-16 offsets and maps edits, selections, diagnostics, breakpoints and current execution between the full source and each pane. It is not a rope, semantic parser, or unrestricted edit-and-continue engine.

Runtime `controls/scrollbar.js`, `native-widgets.js` and `dialog.js` implement the classic scroll, combo, stepper and modal surfaces. They retain DOM accessibility attributes and clean up repeat timers/popups/listeners on disposal. Their APIs remain browser compatibility subsets.

Application theme is stored in `project.settings.theme`; IDE appearance is separate. System colors resolve against the nearest theme scope. Explicit RGB values are not rewritten during a theme switch. Graphics surfaces resolve system colors to actual RGB for their renderer instead of assuming the classic palette.

For SDK consumers, `RuntimeAPI.THEMES`, `RuntimeAPI.applyTheme(element, id)` and `RuntimeAPI.colorValue(oleColor, fallback, themeId)` expose the shared profiles and color resolver. Choose a host's initial theme through project/settings or mount options. `host.setTheme(id, themeOptions)` updates its local appearance without a VM restart; `RuntimeAPI.ApplicationThemeController` supports custom hosts and system-preference tracking. Arbitrary attribute writes alone do not substitute for lifecycle/graphics invalidation. See [application themes](APPLICATION-THEMES.md) and [the complete matching icon packs](THEME-ICON-PACKS.md).

## Runtime embedding

For a split-file page, copy `vb6-runtime.js` and `vb6-controls.css` from `dist/` and load a project JSON object:

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>My VB browser application</title>
  <link rel="stylesheet" href="vb6-controls.css">
  <style>html,body,#app { margin:0; width:100%; height:100%; } #app { position:relative; }</style>
</head>
<body>
  <div id="app"></div>
  <script src="vb6-runtime.js"></script>
  <script>
    // Supply a schema-1 project from a trusted .vb6web file.
    async function startProject(project) {
      return VB6Runtime.mountApplication(
        project,
        document.getElementById('app'),
        { persist: false }
      );
    }
  </script>
</body>
</html>
```

`mountApplication` returns a promise for an `ApplicationHost` after startup has returned. A startup procedure that displays a modal form can delay that promise. Embedders that need the host immediately can use:

```js
const host = new VB6Runtime.RuntimeAPI.ApplicationHost(project, container, {
  persist: false,
  instructionLimit: 5_000_000,
  onMessage(message) { console.log(message); }
});
const startup = host.start();
// Keep host available for lifecycle management while startup runs.
```

Call `host.dispose()` when removing the application. A standalone HTML export is easier for distribution because it contains both scripts, styles, project data and bootstrapping with safe JSON embedding.

For source consumers:

```js
import { compileProject } from './src/language/compiler.js';
import { VirtualMachine } from './src/runtime/vm.js';
import { normalizeProject } from './src/project/model.js';

const compiled = compileProject(normalizeProject(project));
if (!compiled.valid) throw new Error(compiled.diagnostics.map(d => d.message).join('\n'));
const vm = new VirtualMachine(compiled, hostServices);
await vm.start();
```

The runtime API is versioned with the application, not yet a stable compatibility SDK. Consult constructors and tests for the exact host contracts and behavior.

## Project data

Schema 1 contains `id`, `name`, `startup`, `modules`, `settings`, `assets`, `references`, `vfs` and `appSettings`. Each module has an ID, name, kind and code. Form modules also carry a form model with properties, controls and menus. Control models have IDs, names, types, parent names and properties; indexed controls carry an `Index` property.

The normalizer clones imported data, checks module/control names, indexed groups, sizes and parent graphs, repairs duplicate IDs, and preserves stable valid IDs across repeated normalization. It does not treat a successful import as full semantic compatibility validation.

Form layout uses 15 twips per CSS pixel. Browser text sizing converts point-like font sizes at 96 CSS pixels per inch. There is no redistributed Windows font. On narrow runtime viewports forms are scaled to fit; the IDE uses a property drawer and scrolling designer.

## Scheduler, events and debugger

The VM tracks instruction source module, line and procedure. Frames retain locals, error-handling state and return locations. It yields cooperatively during long execution. Event dispatch serializes handlers; timers can coalesce pending ticks. `DoEvents` and modal form loops explicitly pump queued handlers. Modal forms disable other form DOM with `inert` and await hide/unload before returning to the caller.

Custom WithEvents links connect an owning field to the declared event source and matching handler names. Assignment disconnects the prior source. RaiseEvent invokes handlers in connection order, sharing ByRef cells where applicable.

Breakpoints pause before the mapped instruction. Step operations track frame depth. Paused frames support expression inspection and assignment. The IDE receives state, pause locations, locals, stack and watch results over a message bridge.

## Isolation and persistence

IDE applications run in an iframe with `allow-scripts allow-downloads allow-modals`, without `allow-same-origin`. Bridge messages are checked against the actual frame/parent window and a per-run token. Runtime reflection only exposes approved public adapter members and rejects prototype/constructor/implementation-field access. Standalone exports do not have the outer IDE sandbox.

Project JSON embedded in HTML escapes closing-script sequences and other unsafe embedding characters. Native resource names do not grant host filesystem access. ZIP traversal, CRC and expansion checks are tested. These are defensive measures, **not a security audit or a guarantee against hostile projects**. Review untrusted inputs before executing them; downloads and browser permissions still involve user-controlled effects.

Virtual file and settings persistence uses browser storage when available. IDE runs use in-memory persistence and a snapshot transfer back to the editor. No project data is intentionally sent to a remote endpoint; integration tests observed no HTTP requests for the bundled projects. This observation does not certify every possible future adapter or embedded asset.

## Resource limits and performance

Default limits include 5 million VM instructions, 256 call frames, a bounded 1,000-entry event queue, 1 million array elements, 20 MiB per virtual file, 1,000 modules, 10,000 controls/menus per form, 5 million source characters per module, and 50,000 recorded drawing commands per surface. Oversized or unsupported operations produce errors; these are not original VB6 limits.

The editor builds line offsets once per edit, uses binary search for cursor-to-line mapping, and paints visible syntax/gutter rows. Each native textarea holds its selected module/procedure projection; a single complete source buffer owns all edits. Split panes retain independent scrolling and map offsets back to the full module. Text undo stores changed source strings, not copied form trees/assets; it does not implement a rope or incremental parser.

TreeView and ListView paint visible rows. Grid layout uses sparse values, visible row ranges and visible column ranges with spacers. Changing grid dimensions does not allocate every logical cell. Collection insertion and indexing still have costs; virtualization is not a claim that all collection operations are constant-time.

Graphics are demand-rendered with requestAnimationFrame invalidation. WebGPU batches 2D triangles, maintains a reusable vertex buffer and uses a text canvas overlay. Canvas2D is the fallback. This is not a fully GPU-computed UI/layout/text system.

## Release and deployment

For static hosting, use the single HTML file or the split `dist/` folder. The development server is optional. No runtime Node server is needed. Build-time example IDs are stabilized by example name and traversal order. Repeated builds of the same source are checked for byte-identical emitted dist/example files; newly created interactive projects still receive fresh IDs.

The bundled validation report records the exact tested browser and scope. Re-run the suite after modifying compiler, event, control or exporter code. Validate the WebGPU path on a secure browser/device before asserting GPU support for a deployment.

## New compatibility components

`runtime/values.js` owns exact-backed Currency, Nothing, cells, lazy references, records and arrays. Records/arrays are copied as values while true object references remain shared. `binary-codec.js` maps supported typed values to byte layouts without enabling native pointer access. `live-edit.js` prepares validated source-edit/relocation plans before VM mutation. `project/frx.js` decodes supported resources and preserves unknown bytes.

`controls/rtf.js` is a DOM-independent structured RTF/text model. `richtext.js` adapts it to contenteditable input without parsing user RTF as HTML. It uses bounded undo snapshots and linear run/paragraph rendering, not a fully virtualized document engine.

`data/recordset.js` provides typed disconnected row storage, validated queries and change subscriptions. Bound grids read cached provider views without copying every cell and validate writes after cancellable VB handlers. The exported RuntimeAPI exposes MemoryRecordset, VBCurrency, Cell/Ref/Nothing, structured rich text and the existing host/compiler controls for independent use. Public API contracts remain experimental.

Additional limits include 100,000 disconnected rows, 1,024 fields and 1,000,000 field slots; 128 flat filter clauses; bounded RTF source/text/run/depth sizes; and fixed-height virtualized grid rendering. These are browser-runtime protections, not native VB6 limits.

## 0.4.0 navigation and runtime boundaries

`editor/navigation.js` owns pure UTF-16 match/bookmark/source-change operations. `ide/virtual-list.js` bounds visible rows without replacing data models. `object-catalog.js` derives project declaration signatures/locations and explicitly implemented intrinsic/control metadata; `object-browser.js` owns modeless navigation/history/search. `project-search.js` keeps reviewed snapshots and validates every target before committing one history transaction. Tools participate in the MDI lifecycle rather than blocking the source editor through a modal overlay.

`language/errors.js` is a leaf error type shared by calendar/value modules. `runtime/calendar.js` implements civil Gregorian calculations and signed OLE serial conversion without replacing every interval with elapsed milliseconds. `runtime/signatures.js` lists the builtin signatures that permit named binding. Missing and VBErrorValue are explicit immutable values; Empty remains the existing undefined representation. They are not a complete tagged Variant system. The VM owns access checks, safe late-bound dispatch and per-instance static storage.

SDK exports through RuntimeAPI include MISSING, NOTHING, VBErrorValue, asDate, dateAdd, dateDiff, datePart, dateSerial, timeSerial, dateToSerial and serialToDate. For example, `RuntimeAPI.dateToSerial(RuntimeAPI.serialToDate(-1.25))` returns -1.25. The Error value's public numeric descriptor is `.number`; implicit runtime coercion rejects it. These experimental source APIs are separate from VB program member names.


## 0.5.0 editor services and persistence

`language/diagnostics.js` snapshots only compiler inputs and caches compiled modules by revision/content. `editor/diagnostics-worker.js` is bundled into the generated `diagnostics-payload.js`; `diagnostics-scheduler.js` owns debounce, request generations, timeout, disposal and fallback. `ide/diagnostics.js` binds published results to the current source and maps them into code panes. Compiler execution is separate from VM execution: syntax workers cannot run user VB code.

`editor/incremental.js` holds the canonical source index; `virtual-input.js` mounts a bounded native input window for large files. `projection.js` and `view-state.js` preserve logical source coordinates across full/procedure/split views. `find-index.js` supplies cached literal search and single-pass replacement. `assistance.js` owns guarded paused Data Tips and source drag transactions. Native DOM input is retained; this is not a GPU text editor, rope buffer or full semantic language server.

`ide/dock-layout.js` and `command-bar-model.js` are model layers. `window-profile.js` validates profiles against isolated models before live state changes; `workspace-state.js` adds project-guarded document/view snapshots. `keyboard-transaction.js` makes move/resize cancellation explicit. Best-effort origin storage and exported layout JSON are distinct mechanisms; neither should substitute for saving the editable project.

Build both payloads from source with `npm run build`. Changes to editor/diagnostics do not enter a runtime-only HTML export or SDK. `tools/verify-release.py` checks generated distribution bytes after extracting the actual source ZIP.

## 0.6.0 compatibility modules

`language/default-types.js` derives module-scoped letter defaults before declaration binding. `language/interfaces.js` validates project class contracts after compilation; `runtime/values.js` owns interface views that preserve object identity while exposing only their contract. Default-member metadata is resolved by the VM, not by arbitrary JavaScript property access.

`runtime/debug-evaluation.js` owns the temporary, explicitly requested paused-evaluation session. It snapshots the original execution/debug/error context, exposes cooperative abort/time/instruction limits, tracks evaluation-owned dialogs and restores the original session when finished. Source side effects persist; it is not a rollback transaction. `runtime/instruction-map.js` supplies bounded instruction alignment to the existing live-edit planner. The planner rejects unsupported changes before replacing executing modules.

`project/res.js` is a DOM-independent native resource container codec with immutable edit helpers. `runtime/resources.js` snapshots a resource model for string, typed byte-array and supported picture loads. `ide/resource-editor.js` is a modeless view that applies revision-checked edits to the canonical project. Resource payloads remain encoded bytes in project JSON; embedded image values do not introduce script execution. Unchanged native files/records preserve original bytes. There is no native resource-menu/dialog interpreter.

`runtime/mdi.js` owns a runtime parent client, active child tracking, arrangement, keyboard routes and coordinated unloading. `controls/form-window.js` provides reusable classic child-window dragging, resizing and window-state chrome. This is distinct from `ide/mdi.js`, which manages designer/code/tool documents. Parent/child form events still execute through the source VM. The MDI Resource Workspace example is ordinary project data and VB source, not a hardcoded host-only demonstration.

SDK resource usage (no DOM needed):

```js
import {RuntimeAPI as VB} from './src/runtime/entry.js';
let resources = VB.setResourceString(null, 101, 'Document title', 0);
resources = VB.setResource(resources, {
  type: 10, name: 201, language: 0, data: 'AAH/' // base64 bytes 00 01 FF
});
const nativeBytes = VB.writeRES(resources);
const store = new VB.ResourceStore(VB.readRES(nativeBytes));
console.log(store.string(101));
const independentByteArray = store.data(201, 10);
```

For running complete apps, use `mountApplication(project, container, options)`; see `examples/mdi.vb6web` for a complete MDI parent/child project with resources. Public contracts are experimental. The compatibility matrix is authoritative about unsupported native capabilities.
