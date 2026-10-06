# Optional anchoring and automatic layout

## Enable it for one project

Open **Tools → Options → General → Layout Extensions** and select **Enable anchoring and automatic layout (this project)**. Save the project. The setting is `settings.anchoring: true`; all other values, including missing values and strings, are disabled.

Classic projects remain unchanged by default: no Anchor/Dock properties, anchor dialog, guides, layout completions, enum constants or layout methods are added to ordinary controls. Known control references to these members are compiler errors while disabled; late-bound runtime access fails with error 438. User-defined classes with an `Anchor` member are not reserved or changed. The state is project-scoped, including diagnostics caches and concurrent runtime instances.

Turning the option off hides and disables the extension but preserves dormant authored layout metadata. Source that still uses extension members must be changed before it can compile in disabled mode. Enabling invalid dormant metadata is rejected before applying the setting.

## Designer and properties

Select a visual control and use **Format → Anchoring…**, the designer context menu, or the **Anchor** editor in Properties. The four accessible edge buttons and presets edit the same bit mask. Multiple selected controls can be edited together. Selection guides show enabled edges relative to each control's immediate container. Existing classic property categories and dialogs remain in use.

The Layout property category exposes Anchor, Dock, MinimumWidth/Height, MaximumWidth/Height, LayoutMode, LayoutPadding, LayoutMargin, LayoutGap, LayoutGrow, LayoutShrink, LayoutAlign and LayoutJustify where applicable. Forms expose the container layout settings, not an anchor to a nonexistent design parent. Nonvisual components such as Timer, ImageList and CommonDialog do not acquire the extension.

Form resize handles, control/container resize handles, keyboard resizing, property changes and structural edits use the same model adapter. Results are written into the designer model inside the edit transaction so Undo, save and export agree. Pointer resizing solves from the original gesture snapshot. Explicit control moves or changes to Anchor/Dock re-establish that control's distances; passive resizes do not erase them. New and reparented controls capture their current parent size.

## Anchor behavior

Flags match Windows Forms: None=0, Top=1, Bottom=2, Left=4, Right=8. Top|Left (5) is the default after opting in. All 16 combinations are supported. The behavior on each axis is independent:

| Selected edges | Resize behavior |
| --- | --- |
| Near edge only | Keep position and size. |
| Far edge only | Keep the distance from the far edge. |
| Both | Stretch/shrink while respecting min/max sizes. |
| Neither | Move by half the parent size delta; preserve the original center offset. |

Zero maximum means unlimited. The solver retains unclamped baselines: shrinking below a minimum and growing back does not accumulate drift. Browser/runtime model geometry uses the project's existing twip convention, including fractional values; drawing ScaleMode is separate. The engine itself is unit-agnostic. Native HWND bounds are rounded at the final twip-to-pixel boundary; fractional results can differ by one raster pixel.

Setting Anchor exits docking. Setting Dock resets Anchor to Top|Left. Docking processes controls in **declaration order**, deliberately shared across the designer, browser and native adapter; this is not WinForms' reverse z-order docking convention. Fill sees the space remaining at its position. Visible docked controls consume space before flow; anchors remain relative to the parent's client rectangle.

## VB code

```vb
Private Sub Form_Load()
    Dim edges As AnchorStyles
    edges = vbAnchorLeft Or vbAnchorRight Or vbAnchorTop
    Text1.Anchor = edges
    Command1.Anchor = vbAnchorRight Or vbAnchorBottom
    Text1.MinimumWidth = 1800
    Text1.MaximumWidth = 0

    Me.SuspendLayout
    Frame1.LayoutMode = vbLayoutHorizontal
    Frame1.LayoutPadding = 120
    Frame1.LayoutGap = 120
    Command2.LayoutGrow = 1
    Command3.LayoutGrow = 1
    Me.ResumeLayout True
End Sub
```

`AnchorStyles`, `DockStyle` and `LayoutMode` are actual opt-in Long-backed enum namespaces, not just editor labels. `vbAnchor*`, `vbDock*`, `vbLayout*`, alignment and justification constants are project-scoped. Layout methods are available on forms and visual containers. Suspend/Resume nesting is counted; `ResumeLayout False` defers until `PerformLayout`. Container-level calls currently suspend the owning form's layout transaction.

Runtime geometry is updated synchronously before Resize/user code reads it. Browser paints are collected in one animation-frame batch, using changed-node indices. Runtime layout does not overwrite the saved design model. Browser `Controls.Add`, removal, control-array instances, `Move` and `Container` reparenting update the layout graph. Cyclic or foreign runtime containers are rejected. Maximized opted-in browser forms follow host viewport resizing; ordinary forms retain the existing windowing behavior.

Horizontal/vertical flow and horizontal wrapping support explicit preferred sizes, padding, margins, gaps, grow/shrink weights, limits, alignment and justification. Version 0.2 adds browser text-measured Hug/Fill, both wrap directions, grid and the optional [Auto Layout designer](auto-layout-designer.md). These advanced features target HTML/Electron; a general constraint language is not included. It is not full Windows Forms API parity.

## Export and compatibility

| Target | Behavior |
| --- | --- |
| `.vb6web` / project JSON | Saves the flag and authored properties normally. |
| Standalone HTML | Embeds the shared solver and runtime; no network dependency. |
| Electron-packaged EXE | Uses the same embedded browser runtime and project flag. |
| Freestanding Win32 PE32 EXE | Compiles a private layout kernel to x86. Windows resizing, live properties, limits, nesting, docking, flow/wrap and suspension use native geometry; no JS engine or CLR is added. |
| Native `.vbp` / `.frm` sources | Layout metadata is stored in a versioned `.vbp.vb6layout.json` companion. Unsupported properties are not injected into `.frm` designer envelopes. VB source code itself is preserved. |
| Licensed Microsoft VB6 compiler | Opted-in projects are rejected with a clear diagnostic. This extension is not implemented by `MSVBVM60.DLL`; no silent loss of behavior or licensed-compiler certification is claimed. |

The freestanding compiler retains its existing supported control/language/interop set. Adding anchoring does not make unsupported OCX controls, dynamic native control creation, classes or other previously diagnosed native features executable. Native layout has a checked 20,000-node compilation limit. Existing MDI arrangement/Align behavior is retained; layout does not replace the MDI window-manager's client-area allocation.

The companion is UTF-8 JSON, versioned and size-limited. Import matches form/control names and control-array indices, not session IDs. Loading is validated atomically. It preserves disabled metadata without enabling a project implicitly. Keep it alongside the `.vbp` when transferring native source projects. Opening those files in Microsoft's original IDE will not provide this extension.

## Standalone package and performance

The independent package is `packages/auto-layout` (`@vb6/auto-layout`). It contains the ES module, browser IIFE, TypeScript declarations, README and MIT license. `npm run pack:layout` produces and independently tests a local tarball; it does not publish to npm.

The solver compiles parent graphs into typed numeric columns and an iterative parent-first order. Resizes of anchored/docked trees are O(n), use reusable geometry/change buffers, and make no per-control allocation in the hot pass. Identical sizes take an O(1) fast path. Non-topological property changes update one validated record without rebuilding the tree. Graph changes rebuild in O(n). The capped flex algorithm sorts saturation thresholds in O(n log n) worst-case work per line; no universal sub-millisecond guarantee is made.

Run `npm run bench:layout` to produce machine-labelled median/p95 measurements in `reports/layout/benchmark.json`. These numbers measure the solver, not DOM/native rendering or complete application frame time.

## Validation

`npm run test:layout` covers all masks, restore/clamping, nested/unsorted graphs, deep trees, dirty buffers, flow/docking, atomic updates, opt-in isolation, source companions, code/diagnostics and native-vs-JavaScript differential cases. `npm run test:layout:browser` exercises the actual IDE, runtime and exported HTML. The retained Validate workflow tests layout in Chromium, Firefox and WebKit over HTTP and the existing native layout subset on Windows. The newer designer has a separate `test:layout:designer` command within that same workflow. Generated evidence is retained as Actions artifacts rather than checked-in transient screenshots.

References: [Microsoft AnchorStyles](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.anchorstyles), [Control.Anchor](https://learn.microsoft.com/en-us/dotnet/api/system.windows.forms.control.anchor), and [Windows Forms DefaultLayout implementation](https://github.com/dotnet/winforms/blob/main/src/System.Windows.Forms/System/Windows/Forms/Layout/DefaultLayout.cs). Anchor semantics informed this independent implementation; no WinForms source was copied.
