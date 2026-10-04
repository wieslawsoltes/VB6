import {VBError} from '../language/errors.js';
import {MISSING,VBArray,numeric} from './values.js';
import {FINANCIAL_FUNCTIONS} from './financial.js';

/** Runtime adapter: preserve caller arrays; coerce each scalar by VB rules. */
export function financialLibrary() {
  const result = {};
  for (const [name, fn] of Object.entries(FINANCIAL_FUNCTIONS)) {
    const arrayIndex = name === 'NPV' ? 1 : ['IRR', 'MIRR'].includes(name) ? 0 : -1;
    result[name] = (...args) => fn(...args.map((value, index) => {
      if (index !== arrayIndex) {
        if (value === MISSING) return undefined;
        if (typeof value === 'number' && !Number.isFinite(value)) throw new VBError('Overflow', 6);
        return numeric(value);
      }
      if (!(value instanceof VBArray)) throw new VBError('Type mismatch: expected a cash-flow array', 13);
      if (value.bounds.length !== 1) throw new VBError('Expected a one-dimensional cash-flow array', 5);
      return Array.from(value, numeric);
    }));
    result[name].vbPreserveMissing=true;
  }
  return result;
}
