import {WINUI3_GENERATED_REFERENCE, WINUI3_GENERATED_SOURCES, WINUI3_GENERATED_DICTIONARIES} from './winui3-resources.generated.js';

const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};

/** A source-backed scalar/style inventory, not a native WinUI implementation.
 * Values retain XAML types and ARGB channel order. There are no network reads,
 * DOM objects, theme observers, OS accent probes or native font assets here.
 */
export const WINUI3_REFERENCE = freeze({...WINUI3_GENERATED_REFERENCE, nativePixelParityCertified:false});
export const WINUI3_SOURCE_FILES = freeze(WINUI3_GENERATED_SOURCES);
export const WINUI3_DICTIONARY_SOURCES = Object.freeze([
  'ms-appx:///Microsoft.UI.Xaml/Themes/Generic.xaml',
  'ms-appx:///Microsoft.UI.Xaml/Themes/generic.xaml',
  'ms-appx:///Microsoft.UI.Xaml/DensityStyles/Compact.xaml'
]);

const definitions = Object.create(null);
for (let index = 0; index < WINUI3_GENERATED_DICTIONARIES.length; index++) {
  const source = WINUI3_SOURCE_FILES[index];
  for (const [key, theme, type, value, line, unsupported] of WINUI3_GENERATED_DICTIONARIES[index]) {
    (definitions[key] ??= []).push({key, theme, type, value, line, source:source.path, sourceIndex:index, layer:source.layer, density:source.density, ...(unsupported ? {unsupported} : {})});
  }
}
export const WINUI3_RESOURCE_DEFINITIONS = freeze(definitions);
export const WINUI3_RESOURCE_KEYS = Object.freeze(Object.keys(definitions).sort());
const external = new Set();
const visitReferences = value => {
  if (!value || typeof value !== 'object') return;
  if (value.kind === 'Resource' && !Object.hasOwn(definitions, value.key)) external.add(value.key);
  for (const child of Object.values(value)) visitReferences(child);
};
for (const entries of Object.values(definitions)) for (const definition of entries) {
  if (definition.type === 'StaticResource' && !Object.hasOwn(definitions, definition.value)) external.add(definition.value);
  visitReferences(definition.value);
}
export const WINUI3_EXTERNAL_RESOURCE_KEYS = Object.freeze([...external].sort());
export const WINUI3_SYSTEM_RESOURCE_KEYS = Object.freeze(WINUI3_EXTERNAL_RESOURCE_KEYS.filter(key => /^System(?:Accent|Color)/.test(key)));

export class WinUI3ResourceError extends Error {
  constructor(code, key, message, details = {}) {
    super(message); this.name = 'WinUI3ResourceError'; this.code = code; this.key = key;
    Object.assign(this, details);
  }
}

function normalizeTheme(theme) {
  const themes = {light:'Light', dark:'Dark', default:'Dark', highcontrast:'HighContrast'};
  if (typeof theme !== 'string' || !Object.hasOwn(themes, theme.toLowerCase())) throw new TypeError('Unknown WinUI appearance: ' + String(theme));
  return themes[theme.toLowerCase()];
}
function densityOf(options) {
  const density = options.density ?? 'standard';
  if (density !== 'standard' && density !== 'compact') throw new TypeError('Unknown WinUI density: ' + String(density));
  return density;
}
function selectTheme(source, theme, options) {
  const choices = theme === 'HighContrast' ? [options.highContrastTheme, 'HighContrast', normalizeTheme(options.baseTheme ?? 'light'), 'Default'] : [theme, 'Default'];
  return choices.find(choice => source.themes.includes(choice));
}

/** Select one native theme dictionary per source. Missing keys never cause a
 * second search in that same source's Default dictionary. Compact density is an
 * explicit overlay; the standard and compact inventories remain distinct.
 */
export function winui3ResourceDefinition(key, theme = 'light', options = {}) {
  if (typeof key !== 'string' || !key || key.length > 512) throw new TypeError('A nonempty WinUI resource key is required.');
  const appearance = normalizeTheme(theme), density = densityOf(options);
  const bySource = new Map();
  for (const entry of definitions[key] ?? []) {
    if (entry.density === 'compact' && density !== 'compact') continue;
    if (options.source && entry.source !== options.source) continue;
    const source = WINUI3_SOURCE_FILES[entry.sourceIndex];
    if (entry.theme !== 'All' && entry.theme !== selectTheme(source, appearance, options)) continue;
    const previous = bySource.get(entry.sourceIndex) ?? [];
    bySource.set(entry.sourceIndex, [...previous, entry]);
  }
  let candidates = [];
  for (const entries of bySource.values()) {
    const own = entries.filter(entry => entry.theme === 'All');
    candidates.push(...(own.length ? own : entries));
  }
  if (density === 'compact' && candidates.some(entry => entry.density === 'compact')) candidates = candidates.filter(entry => entry.density === 'compact');
  // XamlControlsResources overlays the platform's legacy generic dictionary.
  if (candidates.some(entry => entry.layer === 'controls')) candidates = candidates.filter(entry => entry.layer === 'controls');
  const own = candidates.filter(entry => entry.theme === 'All');
  if (own.length) candidates = own;
  if (!candidates.length) throw new WinUI3ResourceError('WINUI3_RESOURCE_NOT_FOUND', key, `WinUI resource ${key} is not defined for ${appearance}/${density}.`, {theme:appearance, density});
  // Upstream accidentally repeats one Slider key with incompatible aliases.
  // Retain that defect as a diagnostic instead of silently blessing one value.
  const signature = entry => JSON.stringify([entry.type, entry.value, entry.unsupported]);
  const signatures = new Set(candidates.map(signature));
  if (signatures.size > 1) throw new WinUI3ResourceError('WINUI3_AMBIGUOUS_RESOURCE', key, `WinUI resource ${key} has conflicting source definitions.`, {theme:appearance, sources:candidates.map(entry => ({path:entry.source, line:entry.line}))});
  return candidates[0];
}

function readMap(map, key) {
  if (map instanceof Map) return map.has(key) ? {found:true, value:map.get(key)} : {found:false};
  return map && typeof map === 'object' && Object.hasOwn(map, key) ? {found:true, value:map[key]} : {found:false};
}
function normalizeColor(value, key) {
  if (typeof value !== 'string') throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'A host color must be a XAML color string.');
  if (/^#[\da-f]{8}$/i.test(value)) return value.toUpperCase();
  if (/^#[\da-f]{6}$/i.test(value)) return '#FF' + value.slice(1).toUpperCase();
  throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'A host color must use XAML #AARRGGBB or #RRGGBB order.');
}
function hostValue(key, options) {
  for (const map of [options.accentColors, options.systemColors]) {
    const found = readMap(map, key);
    if (found.found) return {type:'Color', value:normalizeColor(found.value, key), source:'host'};
  }
  const found = readMap(options.hostResources, key);
  if (!found.found) return null;
  const item = found.value;
  if (item && typeof item === 'object' && typeof item.type === 'string' && Object.hasOwn(item, 'value')) {
    const {type} = item; let value = item.value;
    if (type === 'Color') value = normalizeColor(value, key);
    else if (['Double','Int32'].includes(type)) {
      if (typeof value !== 'number' || !Number.isFinite(value) || type === 'Int32' && (!Number.isInteger(value) || value < -2147483648 || value > 2147483647)) throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'Invalid host numeric resource.');
    } else if (type === 'Boolean') {
      if (typeof value !== 'boolean') throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'Invalid host Boolean resource.');
    } else if (['Thickness','CornerRadius'].includes(type)) {
      if (!Array.isArray(value) || value.length !== 4 || value.some(component => typeof component !== 'number' || !Number.isFinite(component))) throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'Invalid host four-component resource.');
      value = [...value];
    } else if (['String','FontFamily','FontWeight','Visibility','TextTrimming','BackgroundSizing','HorizontalAlignment','VerticalAlignment','Symbol'].includes(type)) {
      if (typeof value !== 'string') throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'Invalid host string resource.');
    } else throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'Host resource type is not a supported scalar: ' + type);
    return {type, value, source:'host'};
  }
  if (typeof item === 'number' && Number.isFinite(item)) return {type:'Double', value:item, source:'host'};
  if (typeof item === 'boolean') return {type:'Boolean', value:item, source:'host'};
  if (typeof item === 'string') return {type:'String', value:item, source:'host'};
  throw new WinUI3ResourceError('WINUI3_INVALID_HOST_RESOURCE', key, 'An external scalar must be a typed resource or a finite primitive.');
}

/** Returns {type, value, key, theme, source, line?}. Solid brushes use
 * {color:'#AARRGGBB', opacity:number}; linear gradients retain their endpoints,
 * mapping, spread, stop order and supported relative ScaleTransform. Scalar
 * values retain their XAML types. A source filter selects the requested
 * definition; its resource dependencies still use the complete catalog.
 * Style values retain BasedOn and setter expressions without instantiating the
 * unsupported template. Consumers must explicitly implement/whitelist a style.
 * Accent/system colors require an explicit host provider. No Windows colors
 * are fabricated. hostResources supplies explicit external scalar policy.
 */
export function winui3Resource(key, theme = 'light', options = {}) {
  const appearance = normalizeTheme(theme), active = new Set();
  densityOf(options);
  const resolve = name => {
    if (active.has(name)) throw new WinUI3ResourceError('WINUI3_RESOURCE_CYCLE', name, 'Cyclic WinUI resource reference: ' + [...active, name].join(' -> '));
    if (active.size >= 64) throw new WinUI3ResourceError('WINUI3_RESOURCE_DEPTH', name, 'WinUI resource dependency depth exceeds 64.');
    active.add(name);
    try {
      let definition;
      try { definition = winui3ResourceDefinition(name, appearance, name === key ? options : {...options, source:undefined}); }
      catch (error) {
        if (!(error instanceof WinUI3ResourceError) || error.code !== 'WINUI3_RESOURCE_NOT_FOUND') throw error;
        const provided = hostValue(name, options);
        if (provided) return provided;
        if (external.has(name) || /^System(?:Accent|Color)/.test(name)) throw new WinUI3ResourceError('WINUI3_SYSTEM_RESOURCE', name, 'WinUI resource requires an explicit host value: ' + name, {dependency:name});
        throw error;
      }
      if (definition.unsupported) throw new WinUI3ResourceError('WINUI3_UNSUPPORTED_RESOURCE', name, definition.unsupported, {type:definition.type, source:definition.source, line:definition.line});
      if (definition.type === 'StaticResource') return resolve(definition.value);
      const evaluate = expression => {
        if (expression.kind === 'Literal') return {type:null, value:expression.value};
        if (expression.kind === 'Resource') return resolve(expression.key);
        throw new WinUI3ResourceError('WINUI3_UNSUPPORTED_RESOURCE', name, expression.reason ?? 'Unsupported resource expression.');
      };
      let value = definition.value;
      if (definition.type === 'SolidColorBrush') {
        const color = evaluate(value.color), opacity = evaluate(value.opacity);
        if (color.type && color.type !== 'Color') throw new WinUI3ResourceError('WINUI3_RESOURCE_TYPE', name, 'SolidColorBrush.Color requires a Color resource.');
        if (typeof opacity.value !== 'number' || !Number.isFinite(opacity.value) || opacity.value < 0 || opacity.value > 1) throw new WinUI3ResourceError('WINUI3_RESOURCE_TYPE', name, 'SolidColorBrush.Opacity requires a number in [0,1].');
        value = {color:normalizeColor(color.value, name), opacity:opacity.value};
      } else if (definition.type === 'LinearGradientBrush') {
        const opacity = evaluate(value.opacity);
        if (typeof opacity.value !== 'number' || !Number.isFinite(opacity.value) || opacity.value < 0 || opacity.value > 1) throw new WinUI3ResourceError('WINUI3_RESOURCE_TYPE', name, 'LinearGradientBrush.Opacity requires a number in [0,1].');
        value = {...value, opacity:opacity.value, gradientStops:value.gradientStops.map(stop => {
          const color = evaluate(stop.color);
          if (color.type && color.type !== 'Color') throw new WinUI3ResourceError('WINUI3_RESOURCE_TYPE', name, 'GradientStop.Color requires a Color resource.');
          return {offset:stop.offset, color:normalizeColor(color.value, name)};
        })};
      }
      return {type:definition.type, value, source:definition.source, line:definition.line};
    } finally { active.delete(name); }
  };
  return freeze({...resolve(key), key, theme:appearance});
}

/** UI tooling can display unsupported resources without pretending they render. */
export function listWinUI3Resources({includeUnsupported = true} = {}) {
  return WINUI3_RESOURCE_KEYS.filter(key => includeUnsupported || definitions[key].some(entry => !entry.unsupported));
}
