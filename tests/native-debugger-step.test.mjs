import test from 'node:test';
import assert from 'node:assert/strict';
import {qualifyFixtureSourceStep} from '../tools/native-debugger-step.mjs';

function fixture({lineAfter = 17, initialFrame = true, stepError = false, newPause = true, changedThread = false, stopRunning = false} = {}) {
  const calls = [];
  const session = {state: 'paused', pid: 123, processIndex: 0, threadIndex: 2, pauseId: 7, stepped: false, enabled: true,
    async request(op, args) {
      calls.push({op, args});
      if (op === 'stack') return {frames: [{index: initialFrame ? 0 : 1, symbol: `DebugTarget!DebugTick+0x8 [C:\\src\\target.c @ ${this.stepped ? lineAfter : 16}]`}]};
      assert.equal(args.pauseId, this.pauseId, 'Each mutation uses its current pause identity');
      if (op === 'enableBreakpoint') { assert.equal(args.id, 1); this.enabled = args.enabled; }
      if (op === 'stepOver') {
        assert.equal(this.enabled, false, 'The fixture breakpoint must not interrupt the source step');
        if (stepError) throw new Error('step failed');
        this.stepped = true;
        if (newPause) this.pauseId++;
        if (changedThread) this.threadIndex++;
        if (stopRunning) this.state = 'running';
      }
    },
    async waitPaused() { if (stopRunning) throw new Error('no stop'); }
  };
  return {session, calls};
}

test('source qualification disables only the fixture breakpoint and restores it after exactly one step', async () => {
  const {session, calls} = fixture();
  assert.deepEqual(await qualifyFixtureSourceStep(session, 1), {at: 7, lineBefore: '16', lineAfter: '17'});
  assert.equal(session.enabled, true);
  assert.deepEqual(calls.map(x => x.op), ['stack', 'stepMode', 'enableBreakpoint', 'stepOver', 'stack', 'enableBreakpoint']);
  assert.deepEqual(calls.filter(x => x.op === 'enableBreakpoint').map(x => x.args.enabled), [false, true]);
});
for (const [name, options, error] of [
  ['unchanged source line', {lineAfter: 16}, /advance/],
  ['unchanged pause identity', {newPause: false}, /new pause/],
  ['another stopped thread', {changedThread: true}, /selected fixture/],
  ['step command failure', {stepError: true}, /step failed/]
]) test(`source qualification rejects ${name} without retrying or losing the fixture breakpoint`, async () => {
  const {session, calls} = fixture(options);
  await assert.rejects(qualifyFixtureSourceStep(session, 1), error);
  assert.equal(session.enabled, true);
  assert.equal(calls.filter(x => x.op === 'stepOver').length, 1);
  assert.equal(calls.at(-1).op, 'enableBreakpoint');
});
test('a fixture visible only as caller cannot qualify as the stepping location', async () => {
  const {session, calls} = fixture({initialFrame: false});
  await assert.rejects(qualifyFixtureSourceStep(session, 1), /frame zero/);
  assert.equal(calls.length, 1); assert.equal(session.enabled, true);
});
test('failed wait while running does not attempt a paused mutation', async () => {
  const {session, calls} = fixture({stopRunning: true});
  await assert.rejects(qualifyFixtureSourceStep(session, 1), /no stop/);
  assert.equal(calls.filter(x => x.op === 'enableBreakpoint').length, 1);
});
test('source qualification refuses an invalid breakpoint before any command', async () => {
  const {session, calls} = fixture(); await assert.rejects(qualifyFixtureSourceStep(session, 0)); assert.equal(calls.length, 0);
});
