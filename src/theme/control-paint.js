import {cssColor} from './theme.js';

/** Only the ordinary system command palette participates in native-style fills.
 * Authored RGB (including a matching RGB), other system roles, and mixed
 * foreground/background pairs are deliberate choices and must remain intact.
 * State variables are evaluated on the control, not its theme boundary.
 */
export function commandPaint(background, foreground) {
  const back=Number(background),fore=Number(foreground);
  const ole=value=>Number.isInteger(value)&&value>=-0x80000000&&value<=0xffffffff;
  const system=ole(back)&&ole(fore)&&
    (back>>>0)===0x8000000f&&[0x80000008,0x80000012].includes(fore>>>0);
  const fill=cssColor(background),ink=cssColor(foreground,'#000000');
  return system?{background:`var(--command-fill, ${fill})`,color:`var(--command-ink, ${ink})`}:
    {background:fill,color:ink};
}

/** Match the range input's normalized bounds without NaN, infinity or overshoot. */
export function rangeProgress(minimum, maximum, value) {
  const min=Number(minimum),max=Number(maximum),current=Number(value);
  if(![min,max,current].every(Number.isFinite)||max<=min)return '0%';
  if(current<=min)return '0%';
  if(current>=max)return '100%';
  // Scale an overflowing span before division (e.g. -MAX_VALUE..MAX_VALUE).
  const span=max-min,fraction=Number.isFinite(span)?(current-min)/span:(current/2-min/2)/(max/2-min/2);
  return `${fraction*100}%`;
}
