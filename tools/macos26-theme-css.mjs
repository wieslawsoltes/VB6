import {MACOS_REFERENCE} from '../src/theme/macos-reference-metrics.js';
import {MACOS26_RESOURCES, MACOS26_METRICS} from '../src/theme/macos26-resources.js';

/** Semantic colors and independently authored browser paint, never Apple artwork.
 * Invalidate every resource at each non-macOS boundary. State aliases are bound
 * on the control, so nested applications and detached popups stay independent.
 */
const ref = name => `var(--macos26-${name})`;
const px = value => `${value}px`;
function resources(theme) {
  const scheme = theme.scheme === 'dark' ? 'dark' : 'light';
  const dark = scheme === 'dark', m = MACOS_REFERENCE[scheme], metrics = MACOS26_METRICS;
  const values = {
    ...MACOS26_RESOURCES[scheme],
    ButtonBackground: m.neutral, ButtonBackgroundHover: m.neutral,
    ButtonBackgroundPressed: theme.tokens?.pressed || (dark ? '#454545' : '#d3d3d3'),
    ButtonBackgroundDisabled: m.neutralDisabled,
    ButtonForeground: ref('controlTextColor'), ButtonForegroundDisabled: ref('disabledControlTextColor'),
    AccentButtonBackground: ref('controlAccentColor'), AccentButtonBackgroundPressed: ref('accentPressedColor'),
    AccentButtonForeground: ref('selectedTextColor'),
    // Secondary destructive prominence preserves the default command's hierarchy.
    DestructiveButtonBackground: `color-mix(in srgb, ${ref('destructiveColor')} 10%, transparent)`,
    DestructiveButtonBackgroundHover: `color-mix(in srgb, ${ref('destructiveColor')} 14%, transparent)`,
    DestructiveButtonBackgroundPressed: `color-mix(in srgb, ${ref('destructiveColor')} 20%, transparent)`,
    DestructiveButtonForeground: ref('destructiveColor'),
    DestructiveButtonForegroundPressed: ref('destructivePressedColor'),
    Transparent: 'transparent', Zero: '0px', Hidden: 'none', Visible: 'flex', PseudoContent: '""',
    ControlRadius: px(metrics.controlSizes.regular.radius), CircularRadius: '50%', CapsuleRadius: '999px',
    InputBackground: ref('controlBackgroundColor'), InputForeground: ref('textColor'),
    SearchBackground: m.neutral, SearchForeground: ref('controlTextColor'),
    SearchPadding: `4px ${metrics.search.inset + metrics.search.clear + 6}px 4px ${metrics.search.inset + metrics.search.icon + 6}px`,
    SearchIconSize: px(metrics.search.icon), SearchClearSize: px(metrics.search.clear), SearchInset: px(metrics.search.inset),
    FocusShadow: `0 0 0 ${metrics.focusWidth}px ${ref('focusIndicatorColor')}`,
    SwitchWidth: px(metrics.switch.width), SwitchHeight: px(metrics.switch.height),
    SwitchInset: px(metrics.switch.inset), SwitchThumbSize: px(metrics.switch.height - 2 * metrics.switch.inset),
    SwitchTravel: px(metrics.switch.width - metrics.switch.height), SwitchMixedTravel: px((metrics.switch.width - metrics.switch.height) / 2),
    SwitchThumb: '#ffffff', SwitchThumbDisabled: dark ? '#8e8e93' : '#ffffff',
    SwitchThumbShadow: '0 1px 3px #00000030, 0 0 1px #00000024', SwitchTrackShadow: 'none',
    SwitchOffBackground: dark ? '#ffffff33' : '#00000026',
    SwitchOnBackground: ref('controlAccentColor'), SwitchDisabledBackground: m.neutralDisabled,
    Duration: `${metrics.transition}ms`, Easing: 'cubic-bezier(.2,.8,.2,1)',
    IndeterminateWidth: '30%', IndeterminateAnimation: 'macos26-progress 1.35s ease-in-out infinite alternate',
    IndeterminateRestTransform: 'translateX(116.6667%)',
    MaterialRadius: px(metrics.material.radius), GlassBackdrop: `blur(${metrics.material.blur}px) saturate(1.3)`,
    // These CSS compositing choices approximate the documented surface hierarchy;
    // they do not sample wallpaper or implement WindowServer optical refraction.
    WindowMaterial: ref('windowBackgroundColor'), ContentMaterial: ref('controlBackgroundColor'),
    SidebarMaterial: dark ? '#272727d9' : '#f3f3f3d9',
    InspectorMaterial: dark ? '#292929e8' : '#f6f6f6e8',
    TitlebarMaterial: dark ? '#252525d9' : '#fafafad9',
    ToolbarMaterial: dark ? '#373737c9' : '#ffffffc9',
    MenuMaterial: dark ? '#292929ed' : '#f7f7f7ed',
    PopoverMaterial: dark ? '#2d2d2def' : '#fbfbfbef',
    SheetMaterial: dark ? '#2b2b2bf5' : '#f7f7f7f5', HudMaterial: '#262626ee', HudForeground: '#ffffff',
    SidebarOpaque: dark ? '#272727' : '#f3f3f3', InspectorOpaque: dark ? '#292929' : '#f6f6f6',
    TitlebarOpaque: dark ? '#252525' : '#fafafa', ToolbarOpaque: dark ? '#373737' : '#ffffff',
    MenuOpaque: dark ? '#292929' : '#f7f7f7', PopoverOpaque: dark ? '#2d2d2d' : '#fbfbfb',
    SheetOpaque: dark ? '#2b2b2b' : '#f7f7f7', HudOpaque: '#262626',
    GlassStroke: dark ? '#ffffff1f' : '#ffffffd9', GlassShadow: dark ? '0 2px 5px #00000040' : '0 2px 5px #00000012',
    ToolbarHover: dark ? '#ffffff14' : '#0000000a', ToolbarPressed: dark ? '#ffffff24' : '#00000014',
    ToolbarSelected: `color-mix(in srgb, ${ref('controlAccentColor')} 16%, transparent)`,
    SidebarHover: m.neutral, SidebarSelection: ref('selectedContentBackgroundColor'),
    SidebarSelectionInactive: ref('unemphasizedSelectedContentBackgroundColor'),
    InspectorRow: dark ? '#ffffff04' : '#00000003', InspectorSection: dark ? '#ffffff08' : '#00000005',
    ControlEdge: m.fieldBorder, Hairline: ref('separatorColor')
  };
  for (const [name, size] of Object.entries(metrics.controlSizes)) {
    const title = name[0].toUpperCase() + name.slice(1);
    // Existing regular VB controls retain the independently captured painter,
    // including its transparent 2px vertical inset and original label origin.
    values[title + 'ControlRadius'] = name === 'regular' ? '6px / 8px' : px(size.radius);
    values[title + 'ControlPadding'] = name === 'regular' ? '4px 9px' : `4px ${size.padding}px`;
    values[title + 'ControlHeight'] = px(size.height);
  }
  return values;
}

export const MACOS26_TOKEN_NAMES = Object.freeze(Object.keys(resources({scheme: 'light'})));
export function macos26ThemeTokens(theme) {
  const values = theme.family === 'macos26' ? resources(theme) : null;
  return MACOS26_TOKEN_NAMES.map(name => `  --macos26-${name}: ${values ? values[name] : 'initial'};\n`).join('');
}

const reducedTransparency = Object.fromEntries([
  ['GlassBackdrop','none'],
  ...['Sidebar','Inspector','Titlebar','Toolbar','Menu','Popover','Sheet','Hud'].map(name => [name + 'Material',ref(name + 'Opaque')])
]);
const increasedContrast = {
  ...reducedTransparency,
  secondaryLabelColor:'var(--vb-text)', tertiaryLabelColor:'var(--vb-text)',
  ControlEdge:'var(--vb-text)', Hairline:'var(--vb-text)', GlassStroke:'var(--vb-text)',
  FocusShadow:'0 0 0 2px var(--vb-selection)', GlassShadow:'none'
};
const reducedMotion = {Duration:'0s',IndeterminateAnimation:'none'};
const forcedColors = {
  ...reducedTransparency,...reducedMotion,
  windowBackgroundColor:'Canvas',controlBackgroundColor:'Canvas',textBackgroundColor:'Canvas',
  labelColor:'CanvasText',secondaryLabelColor:'CanvasText',tertiaryLabelColor:'CanvasText',
  disabledControlTextColor:'GrayText',controlTextColor:'CanvasText',textColor:'CanvasText',
  controlAccentColor:'Highlight',accentPressedColor:'Highlight',focusIndicatorColor:'Highlight',
  selectedContentBackgroundColor:'Highlight',selectedTextBackgroundColor:'Highlight',selectedTextColor:'HighlightText',
  unemphasizedSelectedContentBackgroundColor:'ButtonFace',unemphasizedSelectedTextColor:'ButtonText',
  separatorColor:'ButtonText',gridColor:'ButtonText',linkColor:'LinkText',
  destructiveColor:'ButtonText',destructivePressedColor:'ButtonText',
  ButtonBackground:'ButtonFace',ButtonBackgroundHover:'ButtonFace',ButtonBackgroundPressed:'ButtonFace',
  ButtonBackgroundDisabled:'ButtonFace',ButtonForeground:'ButtonText',ButtonForegroundDisabled:'GrayText',
  AccentButtonBackground:'Highlight',AccentButtonBackgroundPressed:'Highlight',AccentButtonForeground:'HighlightText',
  DestructiveButtonBackground:'ButtonFace',DestructiveButtonBackgroundHover:'ButtonFace',DestructiveButtonBackgroundPressed:'ButtonFace',
  DestructiveButtonForeground:'ButtonText',DestructiveButtonForegroundPressed:'ButtonText',
  InputBackground:'Canvas',InputForeground:'CanvasText',SearchBackground:'Canvas',SearchForeground:'CanvasText',
  SwitchOffBackground:'ButtonFace',SwitchOnBackground:'Highlight',SwitchDisabledBackground:'ButtonFace',
  SwitchThumb:'ButtonText',SwitchThumbDisabled:'GrayText',SwitchThumbShadow:'none',SwitchTrackShadow:'inset 0 0 0 1px ButtonText',
  GlassShadow:'none',GlassStroke:'ButtonText',ControlEdge:'ButtonText',Hairline:'ButtonText',
  FocusShadow:'0 0 0 2px Highlight'
};

/** Preference rules target ownership boundaries, never an arbitrary ancestor's
 * authored content. Repeat IDE portal boundaries because their palette is local.
 */
export function macos26AccessibilityCss(kind) {
  if (kind !== 'application' && kind !== 'ide') throw new TypeError('Unknown macOS CSS ownership scope');
  const ide = kind === 'ide', prefix = ide ? 'ide' : 'vb';
  const base = ide ? 'html[data-ide-theme-family="macos26"]' : '[data-vb-theme-family="macos26"]';
  const portal = ' :where(.classic-menu:not(.runtime-popup),.classic-tooltip:not(.runtime-tooltip),.property-color-popup)';
  const selectors = suffix => base + suffix + (ide ? ',\n' + base + suffix + portal : '');
  const rule = (selector,values) => `${selector} {\n${Object.entries(values).map(([key,value]) => ` --macos26-${key}: ${value};\n`).join('')}}\n`;
  let css = '\n/* macOS semantic accessibility at local ownership boundaries. */\n';
  css += rule(selectors(`[data-${prefix}-reduce-transparency="true"]`),reducedTransparency);
  css += rule(selectors(`[data-${prefix}-increase-contrast="true"]`),increasedContrast);
  css += rule(selectors(`[data-${prefix}-reduce-motion="true"]`),reducedMotion);
  css += `@media(prefers-reduced-transparency:reduce) {\n${rule(selectors(''),reducedTransparency)}}\n`;
  css += `@media(prefers-contrast:more) {\n${rule(selectors(''),increasedContrast)}}\n`;
  css += `@media(prefers-reduced-motion:reduce) {\n${rule(selectors(''),reducedMotion)}}\n`;
  css += `@supports not ((backdrop-filter:blur(1px)) or (-webkit-backdrop-filter:blur(1px))) {\n${rule(selectors(''),reducedTransparency)}}\n`;
  css += `@media(forced-colors:active) {\n${rule(selectors(''),forcedColors)}}\n`;
  return css;
}
