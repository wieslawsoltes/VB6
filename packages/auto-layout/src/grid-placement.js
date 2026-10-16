/** Bounded, renderer-independent grid placement. Explicit overlap is intentional.
 * Definite cells are reserved first; dense packing reuses holes without changing
 * child order. Reference: https://www.w3.org/TR/css-grid-1/#auto-placement-algo
 * Receives resolved nonnegative cells; grid-lines.js resolves named/negative lines. */
const MAX_COLUMNS = 1024, MAX_ROWS = 262144;
const MAX_CELLS = 1048576, MAX_PROBES = 8388608;

export function placeGridItems(items, columns, rows, flow = 0) {
  if (!Number.isInteger(flow) || flow < 0 || flow > 3) throw new RangeError('Invalid grid auto flow');
  const vertical = flow === 1 || flow === 3, dense = flow >= 2;
  let cols = Math.max(1, columns), rowCount = Math.max(vertical ? 1 : 0, rows);
  let cells = 0, probes = 0;
  for (const p of items) {
    if (![p.row, p.col, p.cs, p.rs].every(Number.isInteger) || p.row < -1 || p.col < -1 || p.cs < 1 || p.rs < 1)
      throw new RangeError('Invalid grid placement');
    cols = Math.max(cols, (p.col < 0 ? 0 : p.col) + p.cs);
    rowCount = Math.max(rowCount, p.row < 0 ? (vertical ? p.rs : 0) : p.row + p.rs);
    cells += p.cs * p.rs;
    if (cols > MAX_COLUMNS || rowCount > MAX_ROWS || cells > MAX_CELLS)
      throw new RangeError('Grid cell budget exceeded');
  }
  const occupied = new Set(), placed = new Map(), denseStarts = new Map();
  const minorLimit = vertical ? MAX_ROWS : MAX_COLUMNS, majorLimit = vertical ? MAX_COLUMNS : MAX_ROWS;
  const major = p => vertical ? p.col : p.row, minor = p => vertical ? p.row : p.col;
  const majorSpan = p => vertical ? p.cs : p.rs, minorSpan = p => vertical ? p.rs : p.cs;
  const key = (a,b) => vertical ? b * MAX_COLUMNS + a : a * MAX_COLUMNS + b;
  function fits(p, a, b) {
    if (++probes > MAX_PROBES) throw new RangeError('Grid search budget exceeded');
    if (a + majorSpan(p) > majorLimit || b + minorSpan(p) > minorLimit)
      throw new RangeError('Grid cell budget exceeded');
    for (let x = a; x < a + majorSpan(p); x++) for (let y = b; y < b + minorSpan(p); y++) {
      if (++probes > MAX_PROBES) throw new RangeError('Grid search budget exceeded');
      if (occupied.has(key(x,y))) return false;
    }
    return true;
  }
  function reserve(p, a, b) {
    if (a + majorSpan(p) > majorLimit || b + minorSpan(p) > minorLimit)
      throw new RangeError('Grid cell budget exceeded');
    for (let x = a; x < a + majorSpan(p); x++) for (let y = b; y < b + minorSpan(p); y++) occupied.add(key(x,y));
    const result = {...p, row: vertical ? b : a, col: vertical ? a : b};
    placed.set(p.i,result); cols = Math.max(cols,result.col+p.cs); rowCount = Math.max(rowCount,result.row+p.rs);
  }
  for (const p of items) if (p.row >= 0 && p.col >= 0) reserve(p,major(p),minor(p));
  // Items locked to the packing major axis cannot be moved to another row/column.
  const lockedEnds = new Map();
  for (const p of items) if (major(p) >= 0 && minor(p) < 0) {
    const a = major(p); let b = dense ? 0 : lockedEnds.get(a) || 0;
    while (!fits(p,a,b)) b++;
    reserve(p,a,b); lockedEnds.set(a,b+minorSpan(p));
  }
  const minorCount = vertical ? rowCount : cols;
  let cursorA = 0, cursorB = 0;
  for (const p of items) if (!placed.has(p.i)) {
    const fixed = minor(p), signature = majorSpan(p)+':'+minorSpan(p)+':'+fixed;
    // Occupancy only grows: a previously rejected slot cannot become available.
    // A per-shape lower bound makes repeated dense one-cell placement linear.
    let [a,b] = dense ? denseStarts.get(signature) || [0,0] : [cursorA,cursorB];
    if (fixed >= 0) {
      if (fixed < b) a++;
      b = fixed;
      while (!fits(p,a,b)) a++;
    } else {
      for (;;) {
        if (b + minorSpan(p) > minorCount) { a++; b = 0; }
        if (fits(p,a,b)) break;
        b++;
      }
    }
    reserve(p,a,b);
    cursorA = a; cursorB = b + minorSpan(p);
    if (dense) denseStarts.set(signature,[cursorA,cursorB]);
  }
  return {columns:cols,rows:rowCount,placed:items.map(p=>placed.get(p.i)),probes};
}
