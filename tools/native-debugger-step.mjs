/** Source-step qualification must not be interrupted by its own fixture breakpoint.
 * CDB honors breakpoints during p (https://learn.microsoft.com/en-us/windows-hardware/drivers/debuggercmds/p--step-).
 * This test helper changes no debugger engine or user breakpoint policy. */
import assert from 'node:assert/strict';

function sourceLine(stack) {
  const frame = stack.frames?.find(frame => frame.index === 0);
  assert.ok(frame && /^DebugTarget!DebugTick(?:[+\s]|$)/i.test(frame.symbol),
    'Source-step qualification requires DebugTick in frame zero, not a caller');
  const line = /target\.c @ (\d+)/i.exec(frame.symbol)?.[1];
  assert.ok(line, 'Source-step qualification requires matching fixture line symbols');
  return line;
}

export async function qualifyFixtureSourceStep(session, breakpointId) {
  assert.ok(Number.isSafeInteger(breakpointId) && breakpointId > 0);
  assert.equal(session.state, 'paused');
  const context = {pid: session.pid, processIndex: session.processIndex, threadIndex: session.threadIndex};
  const lineBefore = sourceLine(await session.request('stack'));
  await session.request('stepMode', {mode: 'source', pauseId: session.pauseId});
  // The native failure report records "Breakpoint 1 hit" at the same IP/line,
  // not a completed source step. Disable only this already-tested fixture BP.
  await session.request('enableBreakpoint', {id: breakpointId, enabled: false, pauseId: session.pauseId});
  const at = session.pauseId;
  try {
    await session.request('stepOver', {pauseId: at});
    await session.waitPaused();
    assert.ok(session.pauseId > at, 'Source step must produce a new pause');
    assert.deepEqual({pid: session.pid, processIndex: session.processIndex, threadIndex: session.threadIndex}, context,
      'Source step must remain in the selected fixture process and thread');
    const lineAfter = sourceLine(await session.request('stack'));
    assert.notEqual(lineAfter, lineBefore, 'One source step must advance the fixture line');
    return {at, lineBefore, lineAfter};
  } finally {
    if (session.state === 'paused') {
      await session.request('enableBreakpoint', {id: breakpointId, enabled: true, pauseId: session.pauseId});
    }
  }
}
