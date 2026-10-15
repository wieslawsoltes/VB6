/** WinUI resources are build-time data, never a per-control theme observer.
 * All resources (including derived state brushes) reset at EVERY boundary.
 * CSS invalid-at-computed-value-time is intentional for non-Fluent families:
 * the component's existing Classic/macOS/X11 fallback remains authoritative.
 */
import fs from 'node:fs';
import {WINUI_RESOURCES, WINUI_METRICS} from '../src/theme/winui-resources.js';
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
  DialogFooterBackground:'SolidBackgroundFillColorSecondary'
});

function resources(theme) {
  const dark=theme.scheme==='dark', colors=WINUI_RESOURCES[dark?'dark':'light'];
  const values={...colors, ...Object.fromEntries(Object.entries(WINUI_ALIASES).map(([k,v])=>[k,ref(v)])),
    AccentButtonBackground:'var(--vb-selection)',
    AccentButtonBackgroundPointerOver:'color-mix(in srgb, var(--vb-selection) 90%, transparent)',
    AccentButtonBackgroundPressed:'color-mix(in srgb, var(--vb-selection) 80%, transparent)',
    // WinUI's dark TextBox deliberately uses FE rather than FF for disabled text.
    TextControlForegroundDisabled:dark?'#fefefe5d':colors.TextFillColorDisabled,
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
    RangeTrackHeight:'4px', RangeThumbSize:'20px', RangeThumbRadius:'50%', RangeThumbRing:`5px solid ${ref('RangeThumbBorder')}`,
    RangeThumbShadow:'0 1px 2px #00000026', RangeThumbMargin:'-8px',
    ProgressBorder:'0', ProgressPadding:'0', ProgressRadius:'2px',
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
