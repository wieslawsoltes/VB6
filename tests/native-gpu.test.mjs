import test from 'node:test';
import assert from 'node:assert/strict';
import { getGPUDevice } from '../src/graphics/surface.js';

function windowGPU() {
  let requests = 0, lose;
  const device = { lost: new Promise(resolve => { lose = resolve; }) };
  const view = { navigator: { gpu: { requestAdapter: async () => {
    requests++; return { requestDevice: async () => device };
  } } } };
  return { view, device, lose: () => lose({reason:'destroyed'}), requests: () => requests };
}
test('native rendering reuses only its own startup-validated GPU device', async () => {
  const device = { label: 'startup-owned-device' }, view = { vb6NativeGPUDevice: device };
  assert.equal(await getGPUDevice(view), device);
  assert.equal(await getGPUDevice(view), device);
});
test('native windows do not share WebGPU devices across window contexts', async () => {
  const a = windowGPU(), b = windowGPU();
  const devices = await Promise.all([getGPUDevice(a.view),getGPUDevice(a.view),getGPUDevice(b.view)]);
  assert.equal(devices[0],a.device);assert.equal(devices[1],a.device);assert.equal(devices[2],b.device);
  assert.notEqual(devices[0],devices[2]);assert.equal(a.requests(),1);assert.equal(b.requests(),1);
});
test('device loss clears only the owning window cache', async () => {
  const a=windowGPU(),b=windowGPU();await getGPUDevice(a.view);await getGPUDevice(b.view);
  a.lose();await Promise.resolve();await getGPUDevice(a.view);await getGPUDevice(b.view);
  assert.equal(a.requests(),2);assert.equal(b.requests(),1);
});
test('missing WebGPU and adapter failures resolve as explicit unavailability', async () => {
  assert.equal(await getGPUDevice({}),null);
  assert.equal(await getGPUDevice({navigator:{gpu:{requestAdapter:async()=>null}}}),null);
  assert.equal(await getGPUDevice({navigator:{gpu:{requestAdapter:async()=>{throw new Error('no GPU');}}}}),null);
});
