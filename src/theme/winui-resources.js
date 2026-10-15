/** WinUI 3 semantic brushes. Source colors use XAML #AARRGGBB, not CSS #RRGGBBAA.
 * Adapted from Microsoft.UI.Xaml Common_themeresources_any.xaml (MIT).
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * The complete license is retained in LICENSES/WinUI.txt and emitted with CSS.
 * Accent colors remain the application's chosen accent, not a fabricated OS API.
 */
export const WINUI_REFERENCE = Object.freeze({
  sdk: '2.5.1', tag: 'winui3/release/2.5.1',
  path: 'src/controls/dev/CommonStyles/Common_themeresources_any.xaml',
  blob: 'ca07acb962a7c018a174bf28dcd0e945b13ddb4d',
  buttonBlob: 'e63c32389e599c2277061d9ce29483516e6927a3'
});

// Resource name, Light value, Default (dark) value. Keep native names for audits.
const colors = `
TextFillColorPrimary E4000000 FFFFFF
TextFillColorSecondary 9E000000 C5FFFFFF
TextFillColorTertiary 72000000 87FFFFFF
TextFillColorDisabled 5C000000 5DFFFFFF
TextFillColorInverse FFFFFF E4000000
AccentTextFillColorDisabled 5C000000 5DFFFFFF
TextOnAccentFillColorSelectedText FFFFFF FFFFFF
TextOnAccentFillColorPrimary FFFFFF 000000
TextOnAccentFillColorSecondary B3FFFFFF 80000000
TextOnAccentFillColorDisabled FFFFFF 87FFFFFF
ControlFillColorDefault B3FFFFFF 0FFFFFFF
ControlFillColorSecondary 80F9F9F9 15FFFFFF
ControlFillColorTertiary 4DF9F9F9 08FFFFFF
ControlFillColorQuarternary C2F3F3F3 0FFFFFFF
ControlFillColorDisabled 4DF9F9F9 0BFFFFFF
ControlFillColorTransparent 00FFFFFF 00FFFFFF
ControlFillColorInputActive FFFFFF B31E1E1E
ControlStrongFillColorDefault 72000000 8BFFFFFF
ControlStrongFillColorDisabled 51000000 3FFFFFFF
ControlSolidFillColorDefault FFFFFF 454545
SubtleFillColorTransparent 00FFFFFF 00FFFFFF
SubtleFillColorSecondary 09000000 0FFFFFFF
SubtleFillColorTertiary 06000000 0AFFFFFF
SubtleFillColorDisabled 00FFFFFF 00FFFFFF
ControlAltFillColorTransparent 00FFFFFF 00FFFFFF
ControlAltFillColorSecondary 06000000 19000000
ControlAltFillColorTertiary 0F000000 0BFFFFFF
ControlAltFillColorQuarternary 18000000 12FFFFFF
ControlAltFillColorDisabled 00FFFFFF 00FFFFFF
ControlOnImageFillColorDefault C9FFFFFF B31C1C1C
ControlOnImageFillColorSecondary F3F3F3 1A1A1A
ControlOnImageFillColorTertiary EBEBEB 131313
ControlOnImageFillColorDisabled 00FFFFFF 1E1E1E
AccentFillColorDisabled 37000000 28FFFFFF
ControlStrokeColorDefault 0F000000 12FFFFFF
ControlStrokeColorSecondary 29000000 18FFFFFF
ControlStrokeColorOnAccentDefault 14FFFFFF 14FFFFFF
ControlStrokeColorOnAccentSecondary 66000000 23000000
ControlStrokeColorOnAccentTertiary 37000000 37000000
ControlStrokeColorOnAccentDisabled 0F000000 33000000
ControlStrokeColorForStrongFillWhenOnImage 59FFFFFF 6B000000
CardStrokeColorDefault 0F000000 19000000
CardStrokeColorDefaultSolid EBEBEB 1C1C1C
ControlStrongStrokeColorDefault 72000000 8BFFFFFF
ControlStrongStrokeColorDisabled 37000000 28FFFFFF
SurfaceStrokeColorDefault 66757575 66757575
SurfaceStrokeColorFlyout 0F000000 33000000
SurfaceStrokeColorInverse 15FFFFFF 0F000000
DividerStrokeColorDefault 0F000000 15FFFFFF
FocusStrokeColorOuter E4000000 FFFFFF
FocusStrokeColorInner B3FFFFFF B3000000
CardBackgroundFillColorDefault B3FFFFFF 0DFFFFFF
CardBackgroundFillColorSecondary 80F6F6F6 08FFFFFF
CardBackgroundFillColorTertiary FFFFFF 12FFFFFF
SmokeFillColorDefault 4D000000 4D000000
LayerFillColorDefault 80FFFFFF 4C3A3A3A
LayerFillColorAlt FFFFFF 0DFFFFFF
LayerOnAcrylicFillColorDefault 40FFFFFF 09FFFFFF
LayerOnAccentAcrylicFillColorDefault 40FFFFFF 09FFFFFF
LayerOnMicaBaseAltFillColorDefault B3FFFFFF 733A3A3A
LayerOnMicaBaseAltFillColorSecondary 0A000000 0FFFFFFF
LayerOnMicaBaseAltFillColorTertiary F9F9F9 2C2C2C
LayerOnMicaBaseAltFillColorTransparent 00000000 00FFFFFF
SolidBackgroundFillColorBase F3F3F3 202020
SolidBackgroundFillColorSecondary EEEEEE 1C1C1C
SolidBackgroundFillColorTertiary F9F9F9 282828
SolidBackgroundFillColorQuarternary FFFFFF 2C2C2C
SolidBackgroundFillColorQuinary FDFDFD 333333
SolidBackgroundFillColorSenary FFFFFF 373737
SolidBackgroundFillColorTransparent 00F3F3F3 00202020
SolidBackgroundFillColorBaseAlt DADADA 0A0A0A
SystemFillColorSuccess 0F7B0F 6CCB5F
SystemFillColorCaution 9D5D00 FCE100
SystemFillColorCritical C42B1C FF99A4
SystemFillColorNeutral 72000000 8BFFFFFF
SystemFillColorSolidNeutral 8A8A8A 9D9D9D
SystemFillColorAttentionBackground 80F6F6F6 08FFFFFF
SystemFillColorSuccessBackground DFF6DD 393D1B
SystemFillColorCautionBackground FFF4CE 433519
SystemFillColorCriticalBackground FDE7E9 442726
SystemFillColorNeutralBackground 06000000 08FFFFFF
SystemFillColorSolidAttentionBackground F7F7F7 2E2E2E
SystemFillColorSolidNeutralBackground F3F3F3 2E2E2E
`;

/** Reject malformed source values instead of silently exchanging red and alpha. */
export function xamlColorToCss(value) {
  if (typeof value !== 'string' || !/^#(?:[\da-f]{6}|[\da-f]{8})$/i.test(value))
    throw new TypeError('Expected a six- or eight-digit XAML color');
  return (value.length === 9 ? '#' + value.slice(3) + value.slice(1, 3) : value).toLowerCase();
}
const light = Object.create(null), dark = Object.create(null);
for (const line of colors.trim().split('\n')) {
  const [name, a, b, extra] = line.split(' ');
  if (extra || Object.hasOwn(light, name)) throw new Error('Duplicate or invalid WinUI resource: ' + name);
  light[name] = xamlColorToCss('#' + a);
  dark[name] = xamlColorToCss('#' + b);
}
export const WINUI_RESOURCES = Object.freeze({light: Object.freeze(light), dark: Object.freeze(dark)});
export const WINUI_METRICS = Object.freeze({
  controlRadius: 4, overlayRadius: 8, tooltipRadius: 4, bodySize: 14, bodyLineHeight: 20,
  captionSize: 12, captionLineHeight: 16, controlHeight: 32, checkSize: 20,
  buttonPadding: '5px 11px 6px', buttonTransition: '83ms', focusMargin: 3
});
export function winuiResources(scheme) {
  if (!Object.hasOwn(WINUI_RESOURCES, scheme)) throw new RangeError('Unknown WinUI scheme: ' + scheme);
  return WINUI_RESOURCES[scheme];
}
