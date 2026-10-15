/** State brushes decorate only the expected OLE system role. Explicit RGB and
 * other system roles remain authored values, even on a hovered/default control.
 * Wrapping the CSS variable (not the resolved color) keeps switching O(1).
 */
import {cssColor} from './theme.js';
const slots=Object.freeze({
  commandBackground:Object.freeze({indices:[15],token:'control-background'}),
  commandForeground:Object.freeze({indices:[8,18],token:'control-foreground'}),
  inputBackground:Object.freeze({indices:[5],token:'control-background'}),
  inputForeground:Object.freeze({indices:[8,18],token:'control-foreground'}),
  inputHostBackground:Object.freeze({indices:[5],token:'TextControlHostBackground'})
});
/** Compose a state brush over an already authored/theme-aware CSS paint.
 * The outer resource is invalid outside WinUI, so the inner platform paint
 * resolves at the owning boundary rather than leaking an ancestor's palette.
 */
export function controlThemePaint(value,slot,paint) {
  if(!Object.hasOwn(slots,slot))throw new RangeError('Unknown control color slot: '+slot);
  const number=Number(value),bits=number>>>0,definition=slots[slot];
  return Number.isInteger(number)&&number>=-0x80000000&&number<=0xffffffff&&
    (bits&0x80000000)&&definition.indices.includes(bits&255)
    ? `var(--winui-${definition.token}, ${paint})` : paint;
}
export function controlThemeColor(value,slot,fallback='#c0c0c0') {
  return controlThemePaint(value,slot,cssColor(value,fallback));
}
