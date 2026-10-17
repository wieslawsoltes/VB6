import {MACOS_REFERENCE} from './macos-reference-metrics.js';

/** Independent semantic bridge for macOS Tahoe 26. Measured roles reuse the
 * repository's AppKit captures; additional roles are browser approximations.
 * These are not extracted Apple assets and do not implement NSColor's ABI. */
const freeze = value => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const item of Object.values(value)) freeze(item);
    Object.freeze(value);
  }
  return value;
};
export const MACOS26_REFERENCE = freeze({
  platform: 'macOS', release: 26, name: 'Tahoe', design: 'WWDC25',
  measuredRevision: MACOS_REFERENCE.revision,
  sources: [
    'https://developer.apple.com/videos/play/wwdc2025/310/',
    'https://developer.apple.com/videos/play/wwdc2025/356/',
    'https://developer.apple.com/design/human-interface-guidelines/materials',
    'https://www.figma.com/community/file/1543337041090580818/apple-design-resources-macos-26'
  ],
  figmaAssetsImported: false,
  nativePixelParityCertified: false
});

// OLE_COLOR fallbacks keep an authored semantic role useful in other themes and
// existing native backends. The CSS role itself remains live at its local root.
export const MACOS26_COLOR_ROLES = freeze({
  windowBackgroundColor: {fallback: -2147483633},
  controlBackgroundColor: {fallback: -2147483643},
  textBackgroundColor: {fallback: -2147483643},
  labelColor: {fallback: -2147483630},
  secondaryLabelColor: {fallback: -2147483631},
  tertiaryLabelColor: {fallback: -2147483631},
  disabledControlTextColor: {fallback: -2147483631},
  controlTextColor: {fallback: -2147483630},
  textColor: {fallback: -2147483640},
  controlAccentColor: {fallback: -2147483635},
  selectedContentBackgroundColor: {fallback: -2147483635},
  selectedTextBackgroundColor: {fallback: -2147483635},
  selectedTextColor: {fallback: -2147483634},
  unemphasizedSelectedContentBackgroundColor: {fallback: -2147483633},
  unemphasizedSelectedTextColor: {fallback: -2147483640},
  separatorColor: {fallback: -2147483632},
  gridColor: {fallback: -2147483632},
  linkColor: {fallback: -2147483622},
  accentPressedColor: {fallback: -2147483635},
  destructiveColor: {fallback: 0x003b30ff},
  destructivePressedColor: {fallback: 0x002723d7},
  focusIndicatorColor: {fallback: -2147483635}
});
export const MACOS26_RESOURCE_NAMES = freeze(Object.keys(MACOS26_COLOR_ROLES));

function palette(scheme) {
  const m = MACOS_REFERENCE[scheme], dark = scheme === 'dark';
  return {
    windowBackgroundColor: m.background, controlBackgroundColor: m.background,
    textBackgroundColor: m.background, labelColor: m.label,
    secondaryLabelColor: dark ? '#a3a3a3' : '#6b6b6b',
    tertiaryLabelColor: dark ? '#808080' : '#8e8e8e',
    disabledControlTextColor: m.disabledLabel, controlTextColor: m.label,
    textColor: m.text, controlAccentColor: m.accent,
    selectedContentBackgroundColor: m.selectedContent,
    selectedTextBackgroundColor: m.selectedContent, selectedTextColor: '#ffffff',
    unemphasizedSelectedContentBackgroundColor: m.inactiveSelection,
    unemphasizedSelectedTextColor: m.inactiveSelectionText,
    separatorColor: m.separator, gridColor: m.separator,
    linkColor: dark ? '#91c6ff' : '#0057b8', accentPressedColor: m.accentPressed,
    destructiveColor: dark ? '#ff6961' : '#c42b25',
    destructivePressedColor: dark ? '#ff8a84' : '#a91d18', focusIndicatorColor: m.focus
  };
}
export const MACOS26_RESOURCES = freeze({light: palette('light'), dark: palette('dark')});
export const MACOS26_METRICS = freeze({
  // Preferred paint sizes in CSS pixels, not a request to resize VB6 bounds.
  controlSizes: {
    mini: {height: 16, radius: 4, padding: 6},
    small: {height: 20, radius: 5, padding: 8},
    regular: {height: 24, radius: 6, padding: 12},
    large: {height: 32, radius: 999, padding: 16},
    extraLarge: {height: 40, radius: 999, padding: 20}
  },
  switch: {width: 32, height: 20, inset: 2},
  search: {icon: 14, clear: 16, inset: 8},
  material: {radius: 16, blur: 24},
  focusWidth: 3, transition: 140
});
export function macos26ColorFallback(role) {
  if (typeof role !== 'string' || !Object.hasOwn(MACOS26_COLOR_ROLES, role))
    throw new TypeError('Unknown macOS 26 color role: ' + String(role));
  return MACOS26_COLOR_ROLES[role].fallback;
}
export function macos26Resource(role, scheme = 'light') {
  macos26ColorFallback(role);
  if (scheme !== 'light' && scheme !== 'dark') throw new TypeError('Unknown macOS 26 appearance: ' + String(scheme));
  return MACOS26_RESOURCES[scheme][role];
}

/** Retained graphics store a bounded scalar, never a live control or caller
 * object. The captured role and OLE fallback remain fixed; the palette is
 * resolved at replay time, just like ordinary OLE system colors. This internal
 * token is not CSS and must be resolved before assigning a paint property. */
export function macos26ColorToken(role, fallback) {
  if (typeof role !== 'string') throw new TypeError('A macOS graphics color role must be a string.');
  const defaultColor = macos26ColorFallback(role);
  if (fallback === undefined) fallback = defaultColor;
  if (typeof fallback !== 'number' || !Number.isInteger(fallback) || fallback < -0x80000000 || fallback > 0xffffffff)
    throw new TypeError('A macOS graphics color fallback must be an OLE_COLOR integer.');
  return `macos26-color:${role}:${fallback >>> 0}`;
}

/** Malformed or unknown tokens follow colorValue's ordinary invalid-color
 * fallback. Strict decoding also keeps role names out of arbitrary CSS. */
export function readMacOS26ColorToken(value) {
  if (typeof value !== 'string' || value.length > 96 || !value.startsWith('macos26-color:')) return null;
  const match = /^macos26-color:([A-Za-z][A-Za-z0-9]{0,63}):(0|[1-9][0-9]{0,9})$/.exec(value);
  if (!match || match[0] !== value || !Object.hasOwn(MACOS26_COLOR_ROLES,match[1])) return null;
  const fallback = Number(match[2]);
  return fallback <= 0xffffffff ? Object.freeze({role:match[1],fallback}) : null;
}
