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
export function controlThemeColor(value,slot,fallback='#c0c0c0') {
  if(!Object.hasOwn(slots,slot))throw new RangeError('Unknown control color slot: '+slot);
  const raw=cssColor(value,fallback),number=Number(value),bits=number>>>0,definition=slots[slot];
  return Number.isFinite(number)&&(bits&0x80000000)&&definition.indices.includes(bits&255)
    ? `var(--winui-${definition.token}, ${raw})` : raw;
}
