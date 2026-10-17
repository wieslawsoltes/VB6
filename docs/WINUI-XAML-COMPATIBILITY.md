# WinUI 3 XAML compatibility

WinUI XAML can author themed forms using the existing VB6 designer, controls,
event procedures and browser runtime. The compiler retains typed presentation
data beside the native form properties, so resource-driven paint can change
without replacing the controls or restarting the VB program. The IDE theme and
the application's theme remain separate settings.

The resource reference is Microsoft's
[`winui3/release/2.5.1`](https://github.com/microsoft/microsoft-ui-xaml/tree/ba3a8d59e6de4e2b86ca4f61c78bc26ccf129afd),
commit `ba3a8d59e6de4e2b86ca4f61c78bc26ccf129afd`. The
[pinned catalog](WINUI-RESOURCE-CATALOG.md) contains **13,724 entries, 3,536
resource keys and 84 source dictionaries**, with immutable source hashes and
line/type/theme provenance. That is the complete inventory of the selected
production dictionary set; it does not imply that every native control,
template, animation or material in those files is executable in a browser.
[Rendering scope and validation](WINUI-PARITY.md) describe the separate visual
acceptance boundary.

## Enable authoring and try a form

In **Tools > Options > General > Layout Extensions**, enable XAML form authoring.
Enable anchoring and automatic layout for Grid, StackPanel and a Border with
child content. Open **View > XAML Source** for the active form. Select a Fluent
application theme in Appearance to use the corresponding surrounding application
palette. The full source/draft/undo workflow is described in [XAML authoring](XAML.md).

This sample compiles with `settings: {xaml:true, anchoring:true, theme:'fluent'}`.
The Border arranges its Grid inside padding and border insets. `CardSurface` is
looked up with StaticResource, but its nested ThemeResource color remains live.

```xml
<Page xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"
      xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml"
      xmlns:controls="using:Microsoft.UI.Xaml.Controls"
      x:Name="Form1" Width="560" Height="280"
      Background="{ThemeResource PageSurface}">
  <Page.Resources>
    <ResourceDictionary>
      <ResourceDictionary.MergedDictionaries>
        <controls:XamlControlsResources />
      </ResourceDictionary.MergedDictionaries>
      <ResourceDictionary.ThemeDictionaries>
        <ResourceDictionary x:Key="Light">
          <SolidColorBrush x:Key="PageSurface" Color="#FFF3F3F3" />
          <Color x:Key="CardColor">#FFFFFFFF</Color>
        </ResourceDictionary>
        <ResourceDictionary x:Key="Dark">
          <SolidColorBrush x:Key="PageSurface" Color="#FF202020" />
          <Color x:Key="CardColor">#FF303030</Color>
        </ResourceDictionary>
        <ResourceDictionary x:Key="HighContrast">
          <SolidColorBrush x:Key="PageSurface" Color="#FF000000" />
          <Color x:Key="CardColor">#FF000000</Color>
        </ResourceDictionary>
      </ResourceDictionary.ThemeDictionaries>
      <SolidColorBrush x:Key="CardSurface" Color="{ThemeResource CardColor}" />
    </ResourceDictionary>
  </Page.Resources>
  <Canvas Width="560" Height="280" Background="{ThemeResource PageSurface}">
    <TextBlock Canvas.Left="20" Canvas.Top="16" Width="520" Height="32"
               Text="Notification settings" FontSize="24"
               Foreground="{ThemeResource TextFillColorPrimaryBrush}" />
    <Border Canvas.Left="20" Canvas.Top="64" Width="520" Height="172"
            Background="{StaticResource CardSurface}" Padding="16"
            BorderThickness="1" CornerRadius="4"
            BorderBrush="{ThemeResource ControlStrokeColorDefaultBrush}">
      <Grid>
        <Grid.RowDefinitions>
          <RowDefinition Height="64" />
          <RowDefinition Height="*" />
        </Grid.RowDefinitions>
        <controls:ToggleSwitch x:Name="Notifications" Grid.Row="0"
                               Width="300" Height="60" HorizontalAlignment="Left"
                               Header="Notifications" OnContent="Enabled"
                               OffContent="Paused" IsOn="True"
                               Toggled="Notifications_Click" />
        <Button x:Name="Save" Grid.Row="1" Width="140" Height="32"
                HorizontalAlignment="Right" VerticalAlignment="Bottom"
                Style="{StaticResource AccentButtonStyle}"
                Content="Save enabled" Click="Save_Click" />
      </Grid>
    </Border>
  </Canvas>
</Page>
```

The event procedures are ordinary VB6 methods. For example:

```vb
Private Sub Notifications_Click()
    If Notifications.Value = 1 Then
        Save.Caption = "Save enabled"
    Else
        Save.Caption = "Save paused"
    End If
End Sub

Private Sub Save_Click()
    Save.Caption = "Saved"
End Sub
```

XAML names map to existing control names. Dimensions use DIPs at the existing
96-DPI convention: one DIP becomes 15 twips, and a FontSize of 14 DIPs becomes
10.5 font points. Explicit native `vb:` properties retain native units. The
WinUI compatibility font policy maps `XamlAutoFontFamily` to Segoe UI Variable
and uses the existing installed-font fallback stack; no Microsoft fonts are
redistributed.

## Resource dictionaries and theme selection

Within each dictionary, lookup follows the native order documented in Microsoft's
[resource lookup design notes](https://github.com/microsoft/microsoft-ui-xaml/blob/main/docs/design-notes/resources.md):

1. The dictionary's own entries.
2. Its merged dictionaries, last declaration first, recursively.
3. One selected theme dictionary.

Lookup then continues through the enclosing resource scopes and the intrinsic
WinUI provider. This order matters: a key supplied by a merged dictionary wins
over the same key in that dictionary's ThemeDictionaries. Place an overriding
theme dictionary in a later merged dictionary when it must precede an earlier
merged provider. Own application resources take precedence over both.

ThemeDictionaries accepts keyed ResourceDictionary entries named `Default`,
`Light`, `Dark` and `HighContrast`. `Default` is selected when the requested
dictionary is absent. It does **not** supply individual missing keys when a
named dictionary exists. If Light exists but does not define a custom key,
the compiler does not silently use that key from Default. This matches the
[ThemeDictionaries fallback contract](https://learn.microsoft.com/en-us/windows/windows-app-sdk/api/winrt/microsoft.ui.xaml.resourcedictionary.themedictionaries).
Missing required branches, cyclic aliases, incompatible values and excessive
resource nesting produce diagnostics.

`RequestedTheme="Light"` or `"Dark"` applies to a control and its descendants;
the nearest explicit request wins. `RequestedTheme="Default"` inherits the
surrounding effective theme. Browser forced colors and the High Contrast Black
application palette select HighContrast even inside an explicit Light/Dark
scope. The serialized appearance's Default branch is a Dark fallback for host
interchange; runtime theme selection uses the actual Light, Dark or
HighContrast branch rather than treating Default as a fourth appearance.

### Static and live resource values

StaticResource selects a resource at compilation. A plain scalar or opaque brush
therefore remains a snapshot. ThemeResource preserves branches for the browser
adapter to select as the effective theme changes. Supported live values include
paint, padding, borders, font presentation, opacity and the implemented content
properties. A live Width, arbitrary control value or other unsupported target
produces a diagnostic; StaticResource is available when a fixed value is intended.

Static lookup does not recursively erase live expressions. For example, the
sample's static `CardSurface` brush contains a live `CardColor` expression.
The compiler retains that dependency. Resource-dependent authored style setters
keep their declaration scope, so an unrelated inner resource does not rewrite an
outer static style. Intrinsic aliases and brush expressions are resolved through
the requesting lexical scope, allowing application overrides of resources such
as `ControlFillColorDefault` and gradient-stop colors to reach the stock controls.

### Offline sources and compact resources

`XamlControlsResources` activates the pinned built-in dictionary. These exact
Source URIs are also accepted:

```text
ms-appx:///Microsoft.UI.Xaml/Themes/Generic.xaml
ms-appx:///Microsoft.UI.Xaml/Themes/generic.xaml
ms-appx:///Microsoft.UI.Xaml/DensityStyles/Compact.xaml
```

There is no URI fetch during form compilation or application execution. An
unknown Source, custom XamlControlsResources property, or combination of a pinned
Source and inline entries produces a diagnostic. Declare overrides in a separate
dictionary. Compact is an explicit overlay of the resources actually present in
the pinned compact dictionary: for example TextControlThemeMinHeight is 24 rather
than 32, while resources absent from Compact keep the standard definitions.
It does not turn every authored control into a complete native compact template.

## Native theme defaults and authored styles

With XamlControlsResources in scope, the compatibility layer supplies the audited
default Button, ToggleButton and HyperlinkButton styles and BodyTextBlockStyle
presentation for TextBlock. The theme style forms a separate lower-precedence
layer beneath the authored Style. AccentButtonStyle has no native BasedOn, yet
the unset button padding, font, border thickness and focus metrics still come
from its default theme style.

Explicit, implicit and inline authored styles support scalar setters and BasedOn
chains. Local properties override their setters. An explicit style replaces the
authored implicit style; it does not combine their setters. `Style="{x:Null}"`
suppresses the authored implicit style while retaining the native theme defaults.
Styles can target supported base classes, and values are converted to the
consuming property's actual type.

The presentation XML namespace and `using:Microsoft.UI.Xaml.Controls` aliases
share public control identity, including implicit TargetType matching in either
direction. A foreign namespace with an unrelated type also named Button never
inherits the WinUI bridge merely because the local name matches.

| Named style | Implemented bridge |
| --- | --- |
| `DefaultButtonStyle`, `AccentButtonStyle`, `SubtleButtonStyle` | Button scalar setters, default theme inheritance, resting/hover/pressed/disabled paint and focus metrics |
| `DefaultToggleButtonStyle` | Button presentation plus checked and indeterminate visual-state variants |
| `DefaultHyperlinkButtonStyle` | Hyperlink presentation and native Click behavior |
| `BaseTextBlockStyle`, `BodyTextBlockStyle`, `BodyStrongTextBlockStyle`, `CaptionTextBlockStyle` | Supported typography, wrapping and character trimming setters |
| Other catalog styles | Available as source descriptors; accepted only if every requested behavior has an implemented bridge, otherwise diagnosed |

For example, Title and BodyLarge typography styles request optical sidebearing
trimming that is not implemented. DefaultTextBox/PasswordBox styles include
flyout and selection behavior beyond the supported field adapter; the full
explicit Style object is therefore diagnosed. DefaultComboBox includes an
ItemsPanel and private setters, and DefaultToggleSwitch requests manipulation
behavior. Their ordinary controls still receive the supported theme tokens and
interaction presentation described below. A catalog entry is never a blanket
authorization to discard unsupported setters or execute its native Template.

## Controls and presentation values

| XAML control | Existing model | Supported form-authoring behavior |
| --- | --- | --- |
| `Page`, `Window`, root `UserControl` | Form | Root dimensions, caption/content, resources and theme scope |
| `Canvas` | PictureBox | Child hierarchy and explicit attached Left/Top positions; Canvas alignment follows native ignored-alignment behavior |
| `Grid`, `StackPanel` | PictureBox | Opt-in automatic tracks/cells, spacing, margins, supported alignment and sizing; StackPanel keeps natural main-axis size and cross-axis fill |
| `Border` | PictureBox | One child arranged in a single inner cell; padding and border insets are counted once; child layout requires the automatic-layout option |
| `Button`, `HyperlinkButton` | CommandButton | String Content, native Click procedure, supported typography/paint/focus; hyperlink identity does not add NavigateUri launching |
| `ToggleButton` | Graphical CheckBox | Native Value and Click, checked/indeterminate presentation; no unimplemented tri-state cycling policy |
| `ToggleSwitch` | CheckBox | Binary IsOn/Value, independent string Header and OnContent/OffContent, native both-state Toggled procedure |
| `CheckBox`, `RadioButton` | CheckBox, OptionButton | Caption, checked state and existing native control interaction; glyph and label state painting remain independent |
| `TextBlock` | Label | Plain text, supported fonts, alignment, wrapping and character trimming |
| `TextBox`, `PasswordBox` | TextBox | Text/password, placeholder, enabled/read-only/multiline-related scalar properties and existing input behavior |
| `ComboBox`, `ListBox` | ComboBox, ListBox | Static string items and simple text-only item containers, initial selection and supported list modes; ComboBox is non-editable by default |
| `Slider`, `ScrollBar`, `ProgressBar` | Existing range controls | Scalar bounds/value, supported orientation/step properties; ProgressBar supports determinate and indeterminate presentation |

The schema recognizes more types than the form target can lower. Complex lists,
TreeView items, NumberBox, TabView, arbitrary rich flow content, image-source APIs
and other unimplemented members are not manufactured as functioning controls.
Existing native VB controls can still receive the shared Fluent application
palette independently of whether their complete WinUI XAML API is supported.

| Presentation value | Supported form contract |
| --- | --- |
| Background, Foreground, BorderBrush | Canonical XAML ARGB colors; alpha preserved. Background and BorderBrush also accept the gradient subset below |
| Padding, BorderThickness | Four nonnegative DIPs in left/top/right/bottom order |
| CornerRadius | Four nonnegative DIPs in top-left/top-right/bottom-right/bottom-left order |
| FontFamily, FontSize, FontWeight | Bounded family string, positive DIP size, named/numeric weight; exact weight retained beside the native bold fallback |
| Opacity | Finite value from 0 through 1 |
| TextWrapping, TextTrimming | NoWrap/Wrap/WrapWholeWords and None/Clip/CharacterEllipsis; WordEllipsis is diagnosed |
| Content alignment | Left/Center/Right/Stretch and Top/Center/Bottom/Stretch on implemented content hosts |
| BackgroundSizing | InnerBorderEdge or OuterBorderEdge |
| UseSystemFocusVisuals, FocusVisualMargin | Boolean focus presentation and signed four-sided focus offsets without changing authored bounds |

Button and hyperlink states retain normal, pointer-over, pressed and disabled
resource values. ToggleButton adds checked and indeterminate combinations.
TextBox/PasswordBox and ComboBox retain the applicable focused resources as well
as other declared states. Each brush is resolved in the same scope as the
control, so local state-resource overrides work. Composite controls keep their
glyph, content and fill channels separate; retaining a custom resting brush
does not freeze the pointer or disabled state.

### Brush geometry

SolidColorBrush supports Color and scalar Opacity. Alpha is combined in XAML
channel order and retained in the browser paint; the OLE property remains an
opaque native fallback. LinearGradientBrush supports **nonzero horizontal or
vertical** ramps, Absolute or RelativeToBoundingBox coordinates, Pad spread,
two through 256 stops, opacity, and the implemented scalar relative
ScaleTransform. Stop order and repeated offsets are retained. Diagonal/degenerate
ramps, non-Pad spread, unsupported transforms/interpolation and gradient text
foregrounds produce diagnostics.

The native button elevation ramp is three DIPs long with a stop at offset 0.33:
that position is **0.99 DIP**, not a rounded one-pixel stop. The Light brush's
vertical inversion and the Dark brush's direction remain distinct. Rendering
uses the exact gradient data while the native OLE fallback uses the first stop's
RGB value. This fallback does not certify identical native rasterization.

## Host colors and ownership of VB properties

The catalog requires explicit providers for Windows system/accent resources.
The browser compiler's reproducible policy is exported by
[`winui3HostResourceOptions`](../src/xaml/winui3-lowering.js). It uses the
existing Fluent light/dark and High Contrast Black application palettes,
rather than claiming access to Windows UISettings. Eight system-color keys map
to the selected palette's face, text, disabled, selection, selection-text, link,
window and window-text roles.

| Accent key | Explicit browser-host value/policy |
| --- | --- |
| `SystemAccentColor` | Light `#FF0067B8`, Dark `#FF80CAFF`, or the selected contrast palette accent |
| `SystemAccentColorDark1` | Light anchor `#FF0067B8` |
| `SystemAccentColorDark2`, `Dark3` | Light anchor mixed 15%/30% toward black: `#FF00589C`, `#FF004881` |
| `SystemAccentColorLight1` | Midpoint of the light/dark anchors: `#FF4099DC` |
| `SystemAccentColorLight2` | Dark anchor `#FF80CAFF` |
| `SystemAccentColorLight3` | Dark anchor mixed 35% toward white: `#FFACDDFF` |

Interpolation operates on sRGB channel bytes and rounds each channel. These
values are application policy, not a measured Windows accent ramp or native
pixel certification. The standalone catalog API also accepts caller-owned
`accentColors`, `systemColors` and finite typed `hostResources` providers; see
the [catalog API](WINUI-RESOURCE-CATALOG.md#themes-density-and-host-policy).

WinUI3 appearance is validated plain data beside the native properties. Native
BackColor, ForeColor, FontName, FontSize and FontBold remain usable by VB code.
An explicit native assignment relinquishes the corresponding authored WinUI
property/resource and visual-state channel. A **same-value VB assignment** also
expresses this intent:

```vb
Save.BackColor = Save.BackColor
```

After that statement, BackColor controls the background instead of the former
WinUI resource. Writing a native LayoutPadding field similarly relinquishes
the Padding binding. Explicit replacement of the entire validated WinUI3 record
remains a separate authoring operation; reading the runtime record returns
cloned data rather than mutable nested access to validated state.

Theme changes update the existing controls and inherited popup theme scopes.
The adapter shares its document-level theme/environment subscription, retains
input values and control identities, and disposes its paint/subscription state
when controls are removed. Reduced motion and forced colors use the existing
environment contract. Authored bounds are not silently replaced with IDE
minimum sizes.

## Events, persistence and unsupported behavior

The form target accepts conventional native method names such as
`Click="Save_Click"`, `TextChanged="NameBox_Change"`,
`ValueChanged="Gain_Change"` and `Toggled="Notifications_Click"`. It does not
generate a C#/WinRT event signature or forward arbitrary method names. A
ToggleSwitch Toggled handler observes both binary transitions. State-specific
Checked, Unchecked and Indeterminate handlers require filtered routed-event
dispatch and therefore produce an explicit diagnostic; use native Click and
inspect Value when that is the desired VB behavior.

Other unsupported behaviors remain visible: Binding/x:Bind execution, arbitrary
ControlTemplate/DataTemplate lowering, VisualStateManager/storyboards,
deferred loading, native Mica/Acrylic composition, arbitrary resource objects,
unsupported layout rules, and unsupported control APIs. The standalone
`@vb6/xaml-compiler` object writer exposes explicit host hooks for bindings,
events, templates and resources; those hooks do not add those capabilities to
the VB6 form target. Its template factories capture merged and selected-theme
resource snapshots; its host owns the live ThemeResource lifecycle.

Designer edits retain source spans, resources and comments whenever the full
recompiled model can be verified. Shared style values become local overrides,
and native-only changes use explicit `vb:Designer.Properties` data. Complete
WinUI3 metadata round-trips through native XAML serialization. The existing
draft/conflict/recovery rules apply; valid appearance data does not bypass source
preflight. `.vb6web` saves retain XAML documents, while HTML exports retain the
compiled appearance and omit authoring drafts/parser code. Native VB6 `.frm`
properties alone do not reproduce browser alpha, gradients or live resources.

## Verification and source boundaries

The focused suites cover dictionary precedence and missing branches, static/live
semantics, alias identity, source closure, default/explicit style precedence,
exact gradient and state-resource values, control mappings, native ownership,
source-preserving edits, layout and explicit unsupported diagnostics:

```sh
node --test --test-isolation=none tests/xaml*.test.mjs tests/winui*.test.mjs
npm run test:winui:browser
npm run test:winui:compat:browser
```

The browser compatibility fixture in
[`tests/fixtures/winui3-gallery.mjs`](../tests/fixtures/winui3-gallery.mjs)
exercises imported XAML in the IDE and exported runtime, actual VB event
procedures, theme changes, local shadows, alpha, nested RequestedTheme scopes,
control state, source editing and persistence. The appearance browser tests are
registered in the required `integration-appearance` CI suite. Catalog
regeneration and generated artifact fingerprints are separate build checks.

Native WinUI binary/API compatibility and native pixel parity remain independent
acceptance targets. The browser comparison captures are evidence of this
implementation's behavior, not a substitute for reference images from a pinned
Windows/WinUI/font/accent/scale environment. Microsoft resource adaptations
retain the [MIT license](../LICENSES/WinUI.txt).
