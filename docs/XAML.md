# Optional XAML form authoring

## Enable and open

Open **Tools > Options > General > Layout Extensions** and check **Enable XAML
form authoring (this project)**. Confirm with OK and save the project. The single
gate is `settings.xaml === true`; omitted, false and string values are disabled.
It is independent of `settings.anchoring`. Grid/StackPanel lowering additionally
requires the anchoring/automatic-layout extension.

With a form active, choose **View > XAML Source**, or the form designer's **XAML
Source** context-menu command. The source opens in an ordinary MDI document tool.
Disabling the feature closes/removes its tools and commands without deleting the
stored source. Existing projects stay classic by default. The opt-in checkbox is
always available in Options; XAML editing UI is hidden when disabled.

## Data flow and editing

The standalone `@vb6/xaml-compiler` package parses XML/markup into syntax nodes,
resolves an extensible type schema, binds members and emits typed construction IR.
The separate `src/xaml/forms.js` adapter lowers supported IR into the **existing
VB6 form model**. It does not replace the designer, Properties grid, runtime,
Win32 or macOS compiler, or HTML export renderer with a WinUI renderer.

Valid source edits update the form, property inspector and conventional VB6
names/event procedures in one shared undo transaction. Revisions and exact
canonical model stamps prevent stale proposals from replacing newer models.
Designer/Properties changes update XAML before the existing history transaction
captures its after state. Typed edits are coalesced through the same history.
Control-array renames require all same-name members to change together.
Code renaming reuses the IDE's `EditorIntelligence` declaration/type/With-block
resolver. Bound form/control references, event-shaped procedure declarations and
calls, native member attributes, bracketed identifiers and typed form instances
are updated simultaneously. Other forms' controls, local shadows, unrelated
object members, comments and strings remain unchanged. Name capture and symbol
collisions reject the entire proposal. Inactive conditional branches containing
a candidate name require review rather than being guessed from the active build.

Invalid or incomplete source is retained as a **draft**; the last valid controls
remain intact. An active unresolved draft blocks Run/build/export rather than
silently building different controls. Designer changes while a draft is pending
preserve that draft and mark a conflict. **Apply Draft** explicitly overwrites the
model after successful compilation; **Use Designer** explicitly regenerates the
source. The previous source is retained for **Restore Previous** recovery.
Disabling XAML makes its metadata dormant, so the ordinary form model can run.

Native scalar/property-element/JSON edits, additions, subtree deletions and flat
z-order changes patch original source spans, retaining unaffected comments,
namespace aliases, quote delimiters and line endings. New native controls and menu
collections can be inserted into self-closing or explicit collection containers.
Presentation and macOS scalar edits retain their authored tree and resources; editing a shared
style's value on one control creates a local value instead of modifying the
shared Setter. Native-only changes remain explicit `vb:Designer.Properties` data.
Every candidate is recompiled and its complete canonical model compared with the
designer before acceptance. Reparenting, type changes, rich property content or
other changes that cannot be preserved safely regenerate native XAML with an
original-source backup. This is not arbitrary lossless textual round-tripping.

The source editor has syntax highlighting, diagnostics, completion (Ctrl+Space),
hover (Ctrl+I), definition (F12), references (Shift+F12), rename (F2), formatting
(Shift+Alt+F), outline navigation, literal find/replace, indentation, shared undo,
IME/native selection and read-only run/lock states. Cursor/designer selection
synchronizes with Properties without stealing focus. The language service also
exports folding ranges; the custom textarea editor does not project folded text.
Analysis caches whole-document snapshots, not incremental syntax subtrees.
File imports and confirmation dialogs recheck project identity, editor/source
revision, designer revision and writability after awaiting user/file activity.
Document state validation is shared by editing and build/export preflight; source,
applied source, backup and model stamp are bounded, revisions cannot overflow,
and multi-form synchronization publishes no partial authoring-state updates.
Lowering also counts each expanded native node before retaining it or visiting
further children, including JSON escaping, so repeated resources stop at the
model budget rather than first constructing an oversized complete model.

## Native vocabulary and persistence

Native forms use `xmlns:vb="urn:vb6:forms"`, for example:

```xml
<vb:Form xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
         xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
         xmlns:vb="urn:vb6:forms"
         Name="Form1" Caption="Example" Width="6000" Height="4500">
  <vb:CommandButton Name="Command1" Caption="Save"
                    Left="240" Top="240" Width="1200" Height="375" />
</vb:Form>
```

Native geometry remains **twips**; native Boolean flags remain **0/-1**. Native
Name/Index pairs preserve control arrays. Stable `vb:Designer.Id`, flat storage
order, menu ownership, parent IDs and native metadata remain round-trippable.
Unknown/custom controls use a generic native Control plus explicit Type metadata;
this preserves their model data, it does not manufacture runtime support for a
previously unsupported OCX. Unknown properties/state use bounded JSON metadata.
Original property ordering is retained where it affects `.frm` serialization.

The versioned document is stored in `module.xaml` inside `.vb6web`, including the
current/applied text, revision, model stamp, conflict and previous-source backup.
Native `.frm`/`.vbp` export uses the compiled form model. There is currently **no
XAML-source companion sidecar for native project file saves**; save `.vb6web` or
use Download XAML to retain authoring text when working with native exports.
Standalone application export strips authoring state from its private project
snapshot; it neither leaks drafts nor mutates the saved project.

The shared VB compiler facade adds a cheap authoring-state preflight for VM/AOT
callers; its original compiler is unchanged in `compiler-core.js`. This contract
has no XAML schema/parser/IDE dependency. Existing export/runtime limits remain.

## WinUI conversion boundary

The package recognizes a representative built-in schema vocabulary. Its
host object writer supports extensible construction and explicit resource,
binding/event/template hooks; these contracts are not a WinUI UI implementation.
The VB6 adapter supports selected forms/containers/basic controls, scalar text,
geometry, flags, colors, typography, conventional native event method names,
static resources/styles and selected Grid/StackPanel layout metadata.
WinUI dimensions convert at the existing 96-DPI convention (15 twips per DIP),
font size at 0.75 points per DIP; native attributes do not undergo that conversion.

Unsupported members, dynamic bindings/x:Bind execution, control/data templates,
animations, arbitrary live theme resources, deferred loading, arbitrary handler forwarding,
unsupported control APIs and unlowered layout behavior are **diagnostics**. They
are not discarded or replaced with blank controls. No XBF/WinMD compatibility,
MSBuild integration, C#/C++ binding generation, complete WinUI type inventory,
WinUI dependency-property/rendering runtime or full Microsoft compiler parity is
claimed. This is an independent JavaScript implementation, not a verbatim port
of Microsoft's C# compiler sources.

### Static styles and resources

Explicit/implicit/inline styles, `BasedOn`, base-class target compatibility, local
value precedence and explicit `Style="{x:Null}"` suppression are supported.
Setters are converted to the consuming member's type. Implicit matching uses the
resolved namespace/type identity, not an XML prefix spelling. Merged dictionaries
are recursive: local keys win over merged dictionaries; later merged dictionaries
win over earlier ones. Resource/setter evaluation retains declaration scope, so a
consumer's resource shadow does not silently change an outer style. Cyclic
resources/styles, missing keys, invalid conversions, incompatible targets and
unsupported behavioral setters produce errors. Opaque solid brushes are supported;
opacity/transforms are not silently discarded. External dictionary I/O, arbitrary
theme dictionaries, triggers and template execution are not added by this static
adapter. The supported macOS semantic-color bridge below retains live paint roles
through the same resource/style resolver.

### Layout and item collections

Grid defaults to one row/column, with children in cell zero rather than native
auto-placement. StackPanel defaults retain main-axis natural sizing, cross-axis
fill and no flex shrink. Explicit fixed dimensions and supported Auto sizing,
margin/container-padding thickness, cross-axis/grid alignment, gaps, tracks and
cell/span metadata lower through the existing opt-in layout engine. Resource-backed
row/column definitions use the consuming GridLength converter, including star,
auto and pixel values. Negative
margins/padding, unsupported content padding and unrepresentable alignment are
diagnostics. These mappings do not implement every WinUI measure/arrange rule.

ListBox/ComboBox accept string items and simple text-only item containers, initial
selection and list selection mode. ComboBox is non-editable by default and its
initial selected item populates Text. Styled/rich item containers, conflicting or
out-of-range initial selection, and multiple initially selected item containers
are rejected. Vertical ScrollBar/Slider orientation and positive slider step
frequency are lowered to the existing controls.

## macOS Tahoe 26 authoring and compatibility

`urn:vb6:macos26` is a versioned, independently implemented XAML vocabulary for
the macOS appearance contract. It is available in the IDE's form schema; the
standalone package exposes `createMacOS26Schema()` and
`registerMacOS26Schema(schema)` for explicit host opt-in. It is not an Apple
XAML dialect, a SwiftUI source compiler, or an AppKit binary/API implementation.
Select the macOS application theme in Options to use the matching designer and
browser appearance. XAML still lowers into real VB6 controls, and conventional VB6
code and event procedures continue to operate on those controls.

Keep the presentation namespace as the default when combining its `Style`,
`Setter`, brush and resource-dictionary vocabulary with `mac:` controls. The macOS
namespace can also be the default for control elements and built-in markup
extensions; in that case use a separate presentation prefix for those helper
types. Namespace prefixes carry no semantic identity of their own.

### Control mappings

| macOS XAML type | Existing VB6 control | Supported authoring details |
| --- | --- | --- |
| `Window` | `Form` | Title, dimensions, resources, content and existing common properties |
| `View`, `Canvas` | `PictureBox` | Borderless content container and attached canvas positions |
| `StackView`, `Grid` | `PictureBox` | Existing opt-in automatic layout, `Axis`/`Orientation`, spacing, grid tracks/cells |
| `Button` | `CommandButton` | `Title`/`Content`, `IsDefault`, `IsCancel`, `Action`/`Click` |
| `Label` | `Label` | Text or `StringValue`, plain inline text and typography |
| `TextField`, `SearchField`, `SecureField`, `TextEditor` | `TextBox` | Text/`StringValue`, placeholders, read-only/multiline/password behavior; search has a dedicated style |
| `CheckBox`, `Switch`, `RadioButton` | `CheckBox`, `CheckBox`, `OptionButton` | Title, checked/`IsOn` state; switches accept on/off, radios preserve native Boolean representation |
| `PopUpButton`, `ComboBox`, `List` | `ComboBox`, `ComboBox`, `ListBox` | Static strings or simple item containers, selection; popup is list-only, macOS combo is editable by default |
| `Slider`, `ScrollBar`, `ProgressIndicator`, `Stepper` | `Slider`, `HScrollBar`/`VScrollBar`, `ProgressBar`, `UpDown` | Validated ranges, steps/orientation, wrapping and indeterminate progress |
| `Table` | `ListView` | Static `TableColumn` and `TableRow` data with real column widths, alignment and subitems |
| `Outline` | `TreeView` | Nested `OutlineNode` values flatten to native node keys/parents and expansion flags |
| `TabView` | `SSTab` | `TabItem` captions, initial selection, enabled/visible pages and exact child `TabPage` ownership |
| `Box` | `Frame` | Independent title and one content control/container |
| `Image`, `Separator`, `DatePicker` | `Image`, `Line`, `DTPicker` | Asset source plus `None`/`Fill` stretch, line geometry, validated ISO calendar date |

`TableColumn`, `TableRow`, `OutlineNode`, `TabItem`, `ListItem` and `MenuItem` are
typed data/container descriptions. They are not converted into blank controls.
Table and outline events map to existing `ItemClick`, `ColumnClick` and
`NodeClick` procedures. A tab page accepts one real control or layout container;
its descendants retain ordinary native container ownership. Collection keys are
unique without case sensitivity, matching the native collection contract.
Collection lowering counts escaped JSON incrementally, including repeated
resource text and repeated parent keys, before retaining additional items.
Oversized table, outline or tab data therefore stops at the same document budget
without first constructing an oversized native collection.

Alias members have canonical assignment identities: specifying both `Title`
and `Content` on a button is a duplicate assignment, while a local `Content`
correctly overrides a styled `Title`. The compiler retains the original member
spelling and namespace for diagnostics and designer synchronization. Inherited
collection types retain their declaring namespace, so alias types still receive
ordinary base-type checks.

### Appearance and accessibility

| Authoring property | Native scalar field | Values |
| --- | --- | --- |
| `ControlSize` or `mac:Appearance.ControlSize` | `MacOSControlSize` | `mini`, `small`, `regular`, `large`, `extraLarge` |
| `ControlStyle` or `mac:Appearance.ControlStyle` | `MacOSControlStyle` | `automatic`; button `push`, `default`, `destructive`, `borderless`, `inline`, `circular`, `help`; checkbox `switch`; text field `search` |
| `Material` or `mac:Appearance.Material` | `MacOSMaterial` | `none`, `content`, `sidebar`, `titlebar`, `toolbar`, `menu`, `popover`, `sheet`, `hud`, on supported containers/navigation controls |
| `BackgroundRole`, `ForegroundRole`, or attached equivalents | `MacOSBackgroundRole`, `MacOSForegroundRole` | A known semantic color name |
| `mac:Accessibility.Label`, `.Help`, `.Identifier` | `MacOSAccessibilityLabel`, `MacOSAccessibilityHelp`, `MacOSAccessibilityIdentifier` | Bounded text; direct `AccessibilityLabel`/`Help`/`Identifier` aliases also work |
| `PlaceholderString` or `PlaceholderText` | `PlaceholderText` | TextBox/ComboBox placeholder text |
| `ProgressIndicator.IsIndeterminate` | `MacOSIndeterminate` | Boolean lowered to native `0`/`-1` |

Attached appearance/accessibility properties also work on existing presentation
and native VB6 control elements. `AutomationProperties.Name`, `.HelpText` and
`.AutomationId` map to the same accessibility fields. Unsupported style/control
combinations, multiline/password search fields and invalid role names are
diagnostics. Control-size paint preferences do not silently rewrite explicit
VB6 geometry; use dimensions and the existing layout engine to set bounds.

### Semantic resources remain live

`Foreground="{ThemeResource macOS.labelColor}"` lowers to a
`MacOSForegroundRole` plus an OLE `ForeColor` fallback. Background behaves the same
way. The browser renderer resolves the role in its current application theme and
appearance, so switching light/dark/accent does not freeze an authored color at
compile time. Opaque `SolidColorBrush` resources, aliases, implicit/explicit
styles and `BasedOn` chains preserve this token through resolution. The semantic
token is an adapter implementation detail; executable construction IR retains
the original `ThemeResource` expression.

Recognized roles are `windowBackgroundColor`, `controlBackgroundColor`,
`textBackgroundColor`, `labelColor`, `secondaryLabelColor`, `tertiaryLabelColor`,
`disabledControlTextColor`, `controlTextColor`, `textColor`, `controlAccentColor`,
`selectedContentBackgroundColor`, `selectedTextBackgroundColor`,
`selectedTextColor`, `unemphasizedSelectedContentBackgroundColor`,
`unemphasizedSelectedTextColor`, `separatorColor`, `gridColor`, `linkColor`,
`accentPressedColor`, `destructiveColor`, `destructivePressedColor` and
`focusIndicatorColor`. The language service suggests the corresponding
`macOS.<role>` keys and the valid appearance-property values.

Authored local/merged resource declarations take precedence over intrinsic roles.
A static local brush named `macOS.labelColor` therefore becomes its explicit
color. A shared style resolves such a shadow in the style's declaration scope,
not a consuming control's scope. A local paint also overrides a role from a
style, and a local role overrides a styled paint. Equal-precedence paint and
role declarations are rejected instead of depending on attribute order.
Unknown theme keys, dynamic binding shadows, opacity/transforms, semantic colors
used as dimensions, or unimplemented live shape paints are diagnostics.
Arbitrary `ThemeDictionaries` and user-defined dynamic resource engines remain
outside the static VB6 target.

An explicit `BackColor`/`ForeColor` edit relinquishes its semantic role, including
when the new numeric color equals the previous fallback. Source synchronization
can preserve the original resource declarations and consuming source with an
explicit native override; the complete resulting model is recompiled and checked
before accepting the edit. Editing a semantic role creates/changes only that
control's consuming value. Native canonical round trips also preserve an explicit
custom OLE fallback paired with a role.

### Example

Enable XAML and automatic layout, select the macOS application theme, then use:

```xml
<mac:Window xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
            xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
            xmlns:mac="urn:vb6:macos26"
            x:Name="Form1" Title="Preferences" Width="640" Height="380">
  <mac:Grid Width="640" Height="380">
    <mac:Grid.ColumnDefinitions>
      <mac:ColumnDefinition Width="160" />
      <mac:ColumnDefinition Width="*" />
    </mac:Grid.ColumnDefinitions>
    <mac:Outline x:Name="Navigation" Material="sidebar">
      <mac:OutlineNode Key="general" Text="General" />
      <mac:OutlineNode Key="advanced" Text="Advanced" />
    </mac:Outline>
    <mac:StackView mac:Grid.Column="1" Spacing="12" Padding="20">
      <mac:Label Text="Preferences" FontSize="20"
                 Foreground="{ThemeResource macOS.labelColor}" />
      <mac:SearchField x:Name="Search" Height="32" ControlSize="large"
                       PlaceholderString="Filter settings"
                       mac:Accessibility.Label="Search settings" />
      <mac:Switch x:Name="Notifications" Title="Enable notifications"
                  IsOn="True" Height="24" />
      <mac:Button x:Name="Save" Title="Save" Height="32"
                  ControlSize="large" ControlStyle="default"
                  IsDefault="True" Action="Save_Click" />
    </mac:StackView>
  </mac:Grid>
</mac:Window>
```

The button uses the existing procedure in the form's VB6 code:

```vb
Private Sub Save_Click()
    MsgBox "Preferences saved. Notifications: " & CStr(Notifications.Value)
End Sub
```

The schema does not introduce a second event-dispatch engine. Remaining AppKit
or SwiftUI controls/APIs, rich/styled collection cells, binding execution,
arbitrary AppKit constraints, template execution and complete native 26 visual
parity are not implied by an alias name. Native exports remain subject to their
backend's implemented controls/appearance mappings and explicit diagnostics.
Apple's [macOS design session](https://developer.apple.com/videos/play/wwdc2025/310/),
[materials guidance](https://developer.apple.com/design/human-interface-guidelines/materials)
and [macOS 26 design-resource listing](https://www.figma.com/community/file/1543337041090580818/apple-design-resources-macos-26)
are design references. No Figma assets or Apple implementation source are bundled
by the XAML schema.

## Validation commands

```sh
node --test tests/xaml-*.test.mjs
node tools/test-xaml-package.mjs
npm test
python tools/browser-xaml-tests.py
```

The browser suite defaults to real local HTTP. It accepts the explicit
`VB6_TEST_TRANSPORT=memory` mode for environments that prohibit browser network
navigation; reports label this transport and it does not establish HTTP/file
origin acceptance. Chromium/Firefox/WebKit selection follows `VB6_BROWSER`.
Package checks pack the real standalone package and import it outside the repo,
then type-check a consumer when `tsc` is installed. The package is not published.

All bundled example projects have form-model and byte-identical generated
`.frm` round-trip regressions. New browser tests exercise actual source editing,
Properties, designer moves, options, conflict/draft handling, undo/redo, shared
style isolation, lists, stale imports/confirmations and a real exported
application's event execution. Those checks do not certify native
Windows/macOS execution, universal WinUI visual parity or every legacy OCX.

## Remaining conformance work

Full Microsoft compiler parity still requires a versioned WinMD/schema importer,
complete XAML directives/markup compatibility, typed x:Bind semantic analysis and
code generation, XBF compatibility if retained as a target, all-target resource
and template semantics, complete control/member lowering and upstream differential
fixtures. IDE follow-ups include incremental/background analysis, projected code
folding, native project source sidecars and broader real-origin multi-browser
acceptance. Keep these separate from tested native model round-tripping.

## Implementation map

`src/xaml/contract.js` is the schema-free authoring/build preflight.
`static-values.js` resolves compile-time dictionaries, typed constants and styles.
`macos26-lowering.js` retains semantic color roles and lowers typed table, outline
and tab-page data into native collections; the package's `macos26.js` owns the
standalone versioned schema and control/member identities.
`forms.js` owns native serialization and IR lowering; `source-edits.js` plans
source-preserving edits without mutating a project. `rename.js` adapts the existing
VB editor resolver; `documents.js` stages atomic form/code/document proposals.
`src/ide/xaml.js` integrates these with the existing options, designer and history.
No npm publication or new XAML engine in application exports is required.

Style/resource behavior is independently implemented with reference to
[Microsoft's XAML styles documentation](https://learn.microsoft.com/windows/apps/design/style/xaml-styles)
and [merged resource dictionary documentation](https://learn.microsoft.com/windows/uwp/design/controls-and-patterns/resourcedictionary-and-xaml-resource-references).
The explicit VB6 target boundaries above take precedence over assumptions based
on the standalone compiler's larger vocabulary.
