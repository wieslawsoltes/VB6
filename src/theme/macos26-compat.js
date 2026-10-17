import {MACOS26_RESOURCE_NAMES,macos26ColorFallback} from './macos26-resources.js';

/** Portable authored appearance contract. Scalar values survive native .frm,
 * project JSON, XAML, VM construction, dynamic controls and standalone exports. */
export const MACOS26_CONTROL_SIZES = Object.freeze(['mini','small','regular','large','extraLarge']);
export const MACOS26_CONTROL_STYLES = Object.freeze(['automatic','push','default','destructive','borderless','inline','circular','help','switch','search']);
export const MACOS26_MATERIALS = Object.freeze(['none','content','sidebar','titlebar','toolbar','menu','popover','sheet','hud']);
export const MACOS26_PROPERTY_DEFAULTS = Object.freeze({
  MacOSControlSize: 'regular', MacOSControlStyle: 'automatic', MacOSMaterial: 'none',
  MacOSBackgroundRole: '', MacOSForegroundRole: '', MacOSAccessibilityLabel: '',
  MacOSAccessibilityHelp: '', MacOSAccessibilityIdentifier: '',
  PlaceholderText: '', MacOSIndeterminate: 0
});
export const MACOS26_PROPERTIES = Object.freeze(Object.keys(MACOS26_PROPERTY_DEFAULTS));
const own = (value,key) => Object.hasOwn(value,key);
const materialTypes = new Set(['Form','MDIForm','PictureBox','Frame','UserControl','Toolbar','StatusBar','ListBox','TreeView','ListView','TabStrip','SSTab']);
const visual = type => !['Timer','ImageList','CommonDialog','Data','Adodc'].includes(type);

export function macos26PropertyChoices(key, type) {
  if (key === 'MacOSControlSize') return MACOS26_CONTROL_SIZES;
  if (key === 'MacOSControlStyle') return Object.freeze(['automatic',
    ...(type === 'CommandButton' ? ['push','default','destructive','borderless','inline','circular','help'] :
      type === 'CheckBox' ? ['switch'] : type === 'TextBox' ? ['search'] : [])]);
  if (key === 'MacOSMaterial') return materialTypes.has(type) ? MACOS26_MATERIALS : Object.freeze(['none']);
  if (key === 'MacOSBackgroundRole' || key === 'MacOSForegroundRole') return Object.freeze(['',...MACOS26_RESOURCE_NAMES]);
  return null;
}

export function macos26PropertyDefaults(type) {
  if (!visual(type)) return {};
  const value = {...MACOS26_PROPERTY_DEFAULTS};
  if (!['TextBox','ComboBox'].includes(type)) delete value.PlaceholderText;
  if (type !== 'ProgressBar') delete value.MacOSIndeterminate;
  if (!materialTypes.has(type)) delete value.MacOSMaterial;
  if (!['CommandButton','CheckBox','TextBox'].includes(type)) delete value.MacOSControlStyle;
  return value;
}

export function validateMacOS26Property(key, value, type, properties = {}) {
  if (!own(MACOS26_PROPERTY_DEFAULTS,key)) throw new TypeError('Unknown macOS appearance property: ' + key);
  if (value === undefined) return value;
  if (key === 'MacOSIndeterminate') {
    if (type !== 'ProgressBar' || ![0,-1].includes(value))
      throw new TypeError('MacOSIndeterminate requires a ProgressBar and a 0/-1 Boolean value.');
    return value;
  }
  if (typeof value !== 'string') throw new TypeError(key + ' must be a string.');
  const choices = macos26PropertyChoices(key,type);
  if (choices && !choices.includes(value)) throw new TypeError(key + ' is not supported on ' + type + ': ' + value);
  if (key.endsWith('Role') && value) macos26ColorFallback(value);
  if (key === 'MacOSControlStyle' && value === 'search' && (Number(properties.MultiLine) || properties.PasswordChar))
    throw new TypeError('Search fields require a single-line, non-password TextBox.');
  if (key === 'MacOSControlStyle' && value === 'switch' && ![0,1].includes(Number(properties.Value ?? 0)))
    throw new TypeError('Switches require the binary CheckBox Value 0 or 1.');
  if (key === 'PlaceholderText' && !['TextBox','ComboBox'].includes(type))
    throw new TypeError('PlaceholderText requires a TextBox or ComboBox.');
  const limit = key === 'MacOSAccessibilityIdentifier' ? 1024 : 16384;
  if (value.length > limit || value.includes('\0')) throw new TypeError(key + ' contains invalid or excessive text.');
  return value;
}

export function validateMacOS26Properties(properties = {}, type) {
  for (const key of MACOS26_PROPERTIES) if (own(properties,key)) validateMacOS26Property(key,properties[key],type,properties);
  return properties;
}

/** An explicit color edit relinquishes the semantic binding, even when its OLE
 * value is numerically unchanged. Supplying both in one transaction is explicit
 * and retains the new role. No project mutation occurs in the runtime helper. */
export function clearMacOS26ColorRoles(properties, changes) {
  for (const [color,role] of [['BackColor','MacOSBackgroundRole'],['ForeColor','MacOSForegroundRole']])
    if (own(changes,color) && !own(changes,role)) delete properties[role];
}

export function macos26ControlAttributes(properties = {}) {
  const attributes = {};
  for (const [key,name] of [['MacOSControlSize','data-macos-control-size'],['MacOSControlStyle','data-macos-control-style'],['MacOSMaterial','data-macos-material'],['MacOSAccessibilityIdentifier','data-macos-accessibility-identifier']])
    attributes[name] = properties[key] || null;
  attributes['data-macos-indeterminate'] = properties.MacOSIndeterminate === -1 ? 'true' : null;
  return attributes;
}

export const MacOS26 = Object.freeze({
  MACOS26_CONTROL_SIZES,MACOS26_CONTROL_STYLES,MACOS26_MATERIALS,MACOS26_PROPERTY_DEFAULTS,MACOS26_PROPERTIES,
  macos26PropertyChoices,macos26PropertyDefaults,validateMacOS26Property,validateMacOS26Properties,
  clearMacOS26ColorRoles,macos26ControlAttributes
});
