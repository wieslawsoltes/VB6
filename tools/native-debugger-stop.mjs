/** A caller frame does not prove that a process stopped at its breakpoint.
 * Used by real-CDB qualification to distinguish a breakpoint stop from a
 * thread merely suspended in Sleep while Windows reports a child event. */
export function isBreakpointStop(session, stack, {pid, symbol, id}) {
  if (session.state !== 'paused' || session.pid !== pid) return false;
  const frame = stack.frames?.find(frame => frame.index === 0);
  if (!frame || !Number.isSafeInteger(id) || id < 0) return false;
  const name = frame.symbol.split(/[+\s]/, 1)[0].toLowerCase();
  return name === symbol.toLowerCase() &&
    new RegExp('(?:^|\\n)Breakpoint ' + id + ' hit(?:\\r?\\n|$)', 'i').test(session.lastStop || '');
}
