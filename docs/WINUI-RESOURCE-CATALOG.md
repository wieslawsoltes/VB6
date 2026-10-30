# Pinned WinUI resource catalog

`src/theme/winui3-resources.js` supplies typed WinUI resource data to the XAML
compatibility compiler and to theme tooling. It contains 13,724 entries with
3,536 unique resource keys from 84 verified Microsoft source dictionaries.
Each definition retains its source file, source line, XAML type, theme and
density. The catalog represents native values and partial style descriptions;
it does not instantiate native controls or execute control templates.

## Reference and reproducibility

The reference is Microsoft's
[`winui3/release/2.5.1`](https://github.com/microsoft/microsoft-ui-xaml/tree/ba3a8d59e6de4e2b86ca4f61c78bc26ccf129afd)
at commit `ba3a8d59e6de4e2b86ca4f61c78bc26ccf129afd`.
`tools/winui3-upstream.json` records every input path, immutable Git blob hash
and byte length. Microsoft resource adaptations retain the MIT license in
`LICENSES/WinUI.txt`; the generated module carries the copyright and license
reference.

The manifest includes all 81 production `*_themeresources.xaml` and
`*_themeresources_any.xaml` dictionaries under `src/controls/dev`, both
`src/controls/dev/dll/DensityStyles` dictionaries, and the platform
`src/dxaml/xcp/dxaml/themes/generic.xaml` dictionary. The latter supplies real
system brush aliases, font policy names and platform metrics used by the
modern controls. Alternative `_perf2026.xaml` and legacy `_v2.5.xaml`
template variants are outside this selected source set.

Regenerate from a checkout or source directory containing the original paths:

```sh
node tools/import-winui3-resources.mjs --source-dir /path/to/microsoft-ui-xaml
node tools/import-winui3-resources.mjs --source-dir /path/to/microsoft-ui-xaml --check
```

An explicit network mode fetches the same immutable commit:

```sh
node tools/import-winui3-resources.mjs --fetch --check
```

Both modes verify every input's byte length and Git blob SHA before parsing.
This includes BOM and line-ending bytes. `--check` rejects generated output
that differs from the verified inputs. Normal builds and catalog lookups do
not fetch upstream files. The importer parses XML as data, rejects DTDs and
merged source loading, and never loads assemblies, evaluates markup
extensions, or imports fonts. Updating the reference requires reviewing the
manifest, regenerating the catalog and reviewing the resulting data changes.

## Typed lookup

```js
import {
  winui3Resource,
  winui3ResourceDefinition,
  WINUI3_RESOURCE_KEYS,
  WINUI3_RESOURCE_DEFINITIONS,
  WINUI3_SOURCE_FILES,
  WINUI3_REFERENCE
} from './src/theme/winui3-resources.js';

winui3Resource('ButtonBackground', 'light');
// {type:'SolidColorBrush', value:{color:'#B3FFFFFF', opacity:1},
//  key:'ButtonBackground', theme:'Light', source:..., line:...}

winui3Resource('ComboBoxMinHeight', 'light', {density:'compact'}).value;
// 24
```

Resolved records, definitions and provenance are immutable. Colors retain
native XAML `#AARRGGBB` channel order; converting them to CSS `#RRGGBBAA`
belongs to the rendering host. Supported primitives include numbers,
Booleans, strings, font and enum values, four-component Thickness and
CornerRadius values, and typed GridLength values. Native `Transparent`
remains `#00FFFFFF`.

SolidColorBrush preserves its color dependency and opacity. A resolved
LinearGradientBrush has this value shape:

```js
{
  startPoint: [0, 0],
  endPoint: [0, 3],
  mappingMode: 'Absolute',
  spreadMethod: 'Pad',
  opacity: 1,
  relativeTransform: {
    type: 'ScaleTransform', scaleX: 1, scaleY: -1, centerX: 0, centerY: 0.5
  },
  gradientStops: [
    {offset: 0.33, color: '#29000000'},
    {offset: 1, color: '#0F000000'}
  ]
}
```

This is the Light `ControlElevationBorderBrush`, including its native
three-DIP ramp and vertical reversal. Stop order and repeated stop offsets
are preserved. A brush without a relative transform has
`relativeTransform:null`. An optional `colorInterpolationMode` is retained
when declared. The importer represents scalar ScaleTransform only; other
transforms produce an unsupported-resource record. Hosts must validate
their supported gradient geometry and interpolation rather than treating
every imported brush as renderable.

Styles preserve `targetType`, target namespace, optional `basedOn`, scalar
setter expressions and an `unsupported` list. A setter expression is either
`{kind:'Literal', value}` or `{kind:'Resource', key, theme}`. An unsupported
Template setter stays visible in that list. Returning a Style record does
not imply a template implementation: the compiler's stock-style bridge
must explicitly implement each accepted native style.

## Themes, density and host policy

Each source selects one named theme dictionary, using `Default` only when
the requested dictionary is absent. A missing key in a selected `Light`
dictionary does not cause a second lookup in that source's `Default`.
Unconditional entries in a source take priority over that source's theme
entries. Modern controls overlay the legacy platform dictionary, and
`density:'compact'` overlays only resources defined by the compact sources.
Conflicting source definitions fail explicitly. This catalog is a prepared
WinUI inventory; application ResourceDictionary scope and merged-dictionary
ordering remain the compiler's responsibility.

`light`, `dark` and `highcontrast` are supported appearance names. `default`
maps to Dark, corresponding to these pinned WinUI dictionaries. High
contrast can select a named native high-contrast variant through
`highContrastTheme`; `baseTheme` chooses the fallback appearance when a
source has no high-contrast dictionary.

Windows accent and accessibility colors are external inputs. The catalog
does not infer OS settings. Provide explicitly chosen native color strings:

```js
const options = {
  accentColors: {
    SystemAccentColorDark1: '#FF005A9E',
    SystemAccentColorLight2: '#FF60CDFF'
  },
  systemColors: {
    SystemColorButtonFaceColor: '#FF000000',
    SystemColorButtonTextColor: '#FFFFFFFF',
    SystemColorHighlightColor: '#FF1AEBFF',
    SystemColorHighlightTextColor: '#FF000000'
  }
};
winui3Resource('AccentButtonBackgroundPointerOver', 'light', options);
```

These example values illustrate an application policy, not measured Windows
settings. Missing dependencies report `WINUI3_SYSTEM_RESOURCE` and name the
required key. `WINUI3_SYSTEM_RESOURCE_KEYS` and
`WINUI3_EXTERNAL_RESOURCE_KEYS` expose the inventory. Providers accept plain
objects or Maps. `hostResources` supplies other external finite primitives
or typed scalars, such as `{type:'FontFamily', value:'Example Sans'}`; it
does not override native definitions. Supplied arrays are copied before
freezing, so resolving a resource never freezes the caller's data.

## Coverage and diagnostics

The catalog includes all scalar entries from the selected files, native
aliases, named and implicit style descriptors, solid brush definitions,
and the restricted linear gradient representation above. It also records
unsupported keyed objects so tooling can explain the exact boundary.
Templates, visual state machines, storyboards, native materials, arbitrary
object-valued setters, converters and platform composition are not executed
by this catalog. Native pixel parity is not certified.

The selected upstream Slider dictionary repeats
`SliderContainerBackgroundDisabled` with incompatible Default aliases.
Both source definitions are retained; a Dark lookup returns
`WINUI3_AMBIGUOUS_RESOURCE`. The core source also contains one unkeyed
ControlTemplate, reported as `WINUI3_UNKEYED_RESOURCE`. Template-local keys
are never promoted to global resources.

Lookup failures distinguish missing, unsupported, ambiguous, incorrectly
typed, invalid host, cyclic and excessively deep resources through
`WinUI3ResourceError.code`. Dependency walks are bounded to 64 resources.
This keeps unsupported semantics visible to the compiler and designer.

## Verification

`tests/winui3-resources.test.mjs` checks the pinned source inventory, all 83
existing common colors in both appearances, modern-over-core precedence,
Light and Dark disabled text colors, accent opacity, real high-contrast
aliases, compact density, native geometry and typography, partial style
boundaries, exact gradient data, immutability, explicit failures, XML
handling, deterministic regeneration and source/output tampering.

```sh
node --test tests/winui3-resources.test.mjs
```
