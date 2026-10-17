/** WinUI resources are build-time data, never a per-control theme observer.
 * All resources (including derived state brushes) reset at EVERY boundary.
 * CSS invalid-at-computed-value-time is intentional for non-Fluent families:
 * the component's existing Classic/macOS/X11 fallback remains authoritative.
 */
import fs from 'node:fs';
import {WINUI_RESOURCES, WINUI_METRICS, xamlColorToCss} from '../src/theme/winui-resources.js';
import {winui3Resource} from '../src/theme/winui3-resources.js';
const ref = name => `var(--winui-${name})`;
export const WINUI_ALIASES = Object.freeze({
  ButtonBackground:'ControlFillColorDefault', ButtonBackgroundPointerOver:'ControlFillColorSecondary',
  ButtonBackgroundPressed:'ControlFillColorTertiary', ButtonBackgroundDisabled:'ControlFillColorDisabled',
  ButtonForeground:'TextFillColorPrimary', ButtonForegroundPressed:'TextFillColorSecondary', ButtonForegroundDisabled:'TextFillColorDisabled',
  AccentButtonForeground:'TextOnAccentFillColorPrimary', AccentButtonForegroundPressed:'TextOnAccentFillColorSecondary',
  AccentButtonForegroundDisabled:'TextOnAccentFillColorDisabled', AccentButtonBackgroundDisabled:'AccentFillColorDisabled',
  SubtleButtonBackground:'SubtleFillColorTransparent', SubtleButtonBackgroundPointerOver:'SubtleFillColorSecondary',
  SubtleButtonBackgroundPressed:'SubtleFillColorTertiary', SubtleButtonBackgroundDisabled:'SubtleFillColorDisabled',
  TextControlBackground:'ControlFillColorDefault', TextControlBackgroundPointerOver:'ControlFillColorSecondary',
  TextControlBackgroundFocused:'ControlFillColorInputActive', TextControlBackgroundDisabled:'ControlFillColorDisabled',
  TextControlForeground:'TextFillColorPrimary', TextControlPlaceholderForeground:'TextFillColorSecondary',
  CheckBackground:'ControlAltFillColorSecondary', CheckBackgroundPointerOver:'ControlAltFillColorTertiary',
  CheckBackgroundPressed:'ControlAltFillColorQuarternary', CheckBackgroundDisabled:'ControlAltFillColorDisabled',
  CheckBorder:'ControlStrongStrokeColorDefault', CheckBorderPressed:'ControlStrongStrokeColorDisabled',
  CheckBorderDisabled:'ControlStrongStrokeColorDisabled', CheckGlyph:'TextOnAccentFillColorPrimary',
  CheckGlyphPressed:'TextOnAccentFillColorSecondary', CheckGlyphDisabled:'TextOnAccentFillColorDisabled',
  // RadioButton keeps primary glyph ink in pressed/disabled states, unlike CheckBox.
  RadioGlyph:'TextOnAccentFillColorPrimary',
  SelectionBackground:'SubtleFillColorSecondary', SelectionForeground:'TextFillColorPrimary',
  MenuBackground:'SolidBackgroundFillColorQuarternary', MenuForeground:'TextFillColorPrimary',
  MenuHoverBackground:'SubtleFillColorSecondary', MenuPressedBackground:'SubtleFillColorTertiary',
  MenuBorder:'SurfaceStrokeColorFlyout', ScrollThumb:'ControlStrongFillColorDefault',
  RangeTrack:'ControlStrongFillColorDefault', RangeThumbBorder:'ControlSolidFillColorDefault',
  RangeTrackDisabled:'ControlStrongFillColorDisabled',
  ProgressTrack:'ControlStrongStrokeColorDefault', ProgressPaused:'SystemFillColorCaution', ProgressError:'SystemFillColorCritical',
  SwitchOffBackground:'ControlAltFillColorSecondary', SwitchOffBackgroundPointerOver:'ControlAltFillColorTertiary',
  SwitchOffBackgroundPressed:'ControlAltFillColorQuarternary', SwitchOffBackgroundDisabled:'ControlAltFillColorDisabled',
  SwitchOffBorder:'ControlStrongStrokeColorDefault', SwitchOffBorderDisabled:'ControlStrongStrokeColorDisabled',
  SwitchOffKnob:'TextFillColorSecondary', SwitchOffKnobDisabled:'TextFillColorDisabled',
  SwitchOnKnob:'TextOnAccentFillColorPrimary', SwitchOnKnobDisabled:'TextOnAccentFillColorDisabled',
  ComboBackground:'ControlFillColorDefault', ComboBackgroundPointerOver:'ControlFillColorSecondary',
  ComboBackgroundPressed:'ControlFillColorTertiary', ComboBackgroundDisabled:'ControlFillColorDisabled',
  ComboForeground:'TextFillColorPrimary', ComboForegroundPressed:'TextFillColorSecondary',
  ComboForegroundDisabled:'TextFillColorDisabled', ComboGlyph:'TextFillColorSecondary', ComboGlyphDisabled:'TextFillColorDisabled',
  ItemBackground:'SubtleFillColorTransparent', ItemBackgroundPointerOver:'SubtleFillColorSecondary', ItemBackgroundPressed:'SubtleFillColorTertiary',
  ItemBackgroundSelectedPointerOver:'SubtleFillColorTertiary', ItemBackgroundSelectedPressed:'SubtleFillColorSecondary',
  ItemForegroundDisabled:'TextFillColorDisabled', ItemForegroundPressed:'TextFillColorSecondary',
  TreeBackgroundSelectedDisabled:'SubtleFillColorDisabled',
  TabBackground:'LayerOnMicaBaseAltFillColorTransparent', TabBackgroundSelected:'SolidBackgroundFillColorTertiary',
  TabBackgroundPointerOver:'LayerOnMicaBaseAltFillColorSecondary', TabBackgroundPressed:'LayerOnMicaBaseAltFillColorDefault',
  TabForeground:'TextFillColorSecondary', TabForegroundSelected:'TextFillColorPrimary',
  TabForegroundPressed:'TextFillColorTertiary', TabForegroundDisabled:'TextFillColorDisabled',
  MenuShortcutForeground:'TextFillColorSecondary', MenuSeparator:'DividerStrokeColorDefault',
  DialogFooterBackground:'SolidBackgroundFillColorSecondary'
});

function resources(theme) {
  const dark=theme.scheme==='dark', colors=WINUI_RESOURCES[dark?'dark':'light'];
  const values={...colors, ...Object.fromEntries(Object.entries(WINUI_ALIASES).map(([k,v])=>[k,ref(v)])),
    AccentButtonBackground:'var(--vb-selection)',
    AccentButtonBackgroundPointerOver:'color-mix(in srgb, var(--vb-selection) 90%, transparent)',
    AccentButtonBackgroundPressed:'color-mix(in srgb, var(--vb-selection) 80%, transparent)',
    // TextBox deliberately uses 01 (Light) and FE (Default), rather than the
    // common 00/FF text resource. Read the pinned control dictionary verbatim.
    TextControlForegroundDisabled:xamlColorToCss(winui3Resource('TextControlForegroundDisabled',dark?'dark':'light').value),
    ControlRadius:`${WINUI_METRICS.controlRadius}px`, OverlayRadius:`${WINUI_METRICS.overlayRadius}px`,
    BodySize:`${WINUI_METRICS.bodySize}px`, BodyLineHeight:`${WINUI_METRICS.bodyLineHeight}px`,
    ControlHeight:`${WINUI_METRICS.controlHeight}px`, CheckSize:`${WINUI_METRICS.checkSize}px`,
    ButtonPadding:WINUI_METRICS.buttonPadding, Duration:WINUI_METRICS.buttonTransition,
    ButtonTransitionProperty:'background-color', InputTransition:`background-color ${ref('Duration')} linear`,
    RangeThumbBorderWidth:'5px', RangeThumbBorderColor:ref('RangeThumbBorder'),
    ButtonBorder:`1px solid ${ref('ControlStrokeColorDefault')}`,
    // Absolute 3-DIP border ramp; the light resource reverses its Y axis.
    ButtonElevation:`linear-gradient(to ${dark?'bottom':'top'}, ${ref('ControlStrokeColorSecondary')} 1px, ${ref('ControlStrokeColorDefault')} 3px)`,
    AccentButtonElevation:`linear-gradient(to top, ${ref('ControlStrokeColorOnAccentSecondary')} 1px, ${ref('ControlStrokeColorOnAccentDefault')} 3px)`,
    ButtonFlatElevation:`linear-gradient(${ref('ControlStrokeColorDefault')}, ${ref('ControlStrokeColorDefault')})`,
    TextControlShadow:`inset 0 -1px ${ref('ControlStrongStrokeColorDefault')}, inset 0 0 0 1px ${ref('ControlStrokeColorDefault')}`,
    TextControlFocusShadow:`inset 0 -2px var(--vb-selection), inset 0 0 0 1px ${ref('ControlStrokeColorDefault')}`,
    TextControlDisabledShadow:`inset 0 0 0 1px ${ref('ControlStrokeColorDefault')}`,
    TextControlHostBackground:'transparent', TextControlPadding:'5px 11px 6px',
    BorderPainterContent:'""', ButtonShadow:'none', ButtonClip:'padding-box',
    ButtonFocusContent:'none', DefaultOutline:'none', FocusOutline:`2px solid ${ref('FocusStrokeColorOuter')}`,
    FocusShadow:`0 0 0 1px ${ref('FocusStrokeColorInner')}`, FocusOffset:'1px', CheckGap:'8px', CheckShadow:'none', CheckRadius:'4px',
    CheckGlyphWidth:'12px', CheckGlyphHeight:'12px', CheckGlyphInset:'3px',
    CheckMixedInset:'8px 3px', CheckMixedTop:'8px', CheckMixedHeight:'2px', RadioInset:'3px', RadioHoverInset:'2px', RadioPressedInset:'4px',
    MenuPadding:'4px', MenuItemPadding:'5px 8px', MenuItemHeight:'32px',
    SelectionRadius:'4px', SelectionIndicator:`inset 3px 0 var(--vb-selection)`,
    SelectionContent:'""', SelectionIndicatorWidth:'3px', SelectionIndicatorHeight:'16px', SelectionIndicatorRadius:'1.5px',
    SelectionShadow:'none', ComboItemRadius:'3px', ComboItemPadding:'0 11px',
    ComboPadding:'5px 38px 7px 12px', ComboEditablePadding:'5px 38px 6px 11px',
    ComboArrowPosition:'absolute', ComboArrowInset:'0px', ComboArrowTop:'0px', ComboArrowTransform:'none',
    ComboArrowWidth:'40px', ComboArrowRadius:'0 4px 4px 0', ComboArrowBorder:'0', ComboArrowShadow:'none', ComboArrowBackground:'transparent',
    ComboChevronSize:'7px', ComboChevronEdge:'1.2px solid currentColor', ComboChevronZero:'0 solid transparent', ComboChevronTransform:'rotate(45deg)',
    ComboShadow:'none', ComboFocusShadow:ref('FocusShadow'), ComboClip:'padding-box',
    // Slider's native 18-DIP Thumb includes a Border with Margin=-2 (22 DIP).
    // Its 12-DIP inner ellipse uses the source's state scale factors.
    RangeTrackHeight:'4px', RangeThumbSize:'22px', RangeThumbRadius:'10px', RangeThumbRing:`5px solid ${ref('RangeThumbBorder')}`,
    RangeThumbShadow:`0 1px 2px #00000026, 0 0 0 1px ${ref('ControlStrokeColorDefault')}`, RangeThumbMargin:'-9px',
    RangeThumbRingRest:'5.84px', RangeThumbRingPointerOver:'3.998px', RangeThumbRingPressed:'6.74px', RangeThumbRingDisabled:'3.998px',
    RangeTrackDirection:'to right', RangeValueFill:ref('AccentButtonBackground'), RangeThumbFill:ref('AccentButtonBackground'),
    RangeTransition:`border-width ${ref('Duration')} linear, background-color ${ref('Duration')} linear`,
    ProgressBorder:'0', ProgressPadding:'0', ProgressRadius:'1.5px', ProgressTrackRadius:'0.5px',
    ProgressTrackHeight:'1px', ProgressFillHeight:'3px', ProgressAlign:'center', ProgressHostBackground:'transparent', ProgressFillPosition:'relative',
    ProgressTrackContent:'""', ProgressForeground:ref('AccentButtonBackground'), ProgressTrackShadow:'none',
    ProgressIndeterminateWidth:'30%', ProgressIndeterminateAnimation:'winui-progress 1.8s cubic-bezier(.1,.9,.2,1) infinite',
    ProgressIndeterminateRest:'translateX(116.6667%)',
    SwitchWidth:'40px', SwitchHeight:'20px', SwitchRadius:'10px', SwitchGap:'12px', SwitchKnobSize:'12px',
    SwitchKnobHoverSize:'14px', SwitchKnobPressedWidth:'17px', SwitchKnobPressedHeight:'14px', SwitchKnobRadius:'7px',
    SwitchKnobInset:'2.5px', SwitchKnobHoverInset:'1.5px', SwitchKnobPressedInset:'2px', SwitchTravel:'20px', SwitchMixedTravel:'10px',
    SwitchPseudoContent:'""', SwitchHidden:'none', SwitchOnBorder:'0px', SwitchOffBorderWidth:'1px',
    SwitchTransition:`background-color ${ref('Duration')} linear, border-color ${ref('Duration')} linear`,
    SwitchKnobTransition:`transform ${ref('Duration')} cubic-bezier(.1,.9,.2,1), width ${ref('Duration')} linear, height ${ref('Duration')} linear`,
    TabShadow:'none', TabBorder:ref('SubtleFillColorTransparent'), TabRadius:'4px',
    TreeDisclosureContent:'""', TreeDisclosureFontSize:'0px', TreeDisclosureBorder:'transparent',
    TreeDisclosureBackground:'transparent', TreeDisclosureEdge:`1.5px solid ${ref('TextFillColorSecondary')}`,
    MenuShortcutGap:'24px', MenuShortcutSize:'12px', MenuSeparatorHeight:'1px', MenuSeparatorMargin:'4px 8px',
    ScrollTrackImage:'none', ScrollBorder:'transparent', FrameShadow:'none',
    CheckTransition:'background-color 83ms linear, border-color 83ms linear',
    DialogActionsPadding:'24px', DialogBodyPadding:'24px', DialogGap:'8px',
    CaptionFontSize:'12px', MenuFontSize:'14px'
  };
  return values;
}
export const WINUI_TOKEN_NAMES=Object.freeze(Object.keys(resources({scheme:'light'})));
export function winuiThemeTokens(theme) {
  const values=theme.family==='fluent'?resources(theme):null;
  return WINUI_TOKEN_NAMES.map(name=>`  --winui-${name}: ${values?values[name]:'initial'};\n`).join('');
}
export function winuiLicenseCss(license=fs.readFileSync(new URL('../LICENSES/WinUI.txt',import.meta.url),'utf8')) {
  if(typeof license!=='string')throw new TypeError('Expected WinUI license text');
  // Git pins this input to LF; also support CRLF/lone-CR text from non-Git
  // archives and editors without making bundled CSS/JS host-dependent.
  return '/*! Microsoft WinUI resource adaptation.\n'+license.replace(/\r\n?/g,'\n')+'*/\n';
}
