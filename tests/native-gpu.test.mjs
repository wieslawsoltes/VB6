import test from 'node:test';
import assert from 'node:assert/strict';
import { getGPUDevice } from '../src/graphics/surface.js';

test('native rendering reuses the startup-validated GPU device', async t => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'vb6NativeGPUDevice');
  t.after(() => previous ? Object.defineProperty(globalThis, 'vb6NativeGPUDevice', previous) : delete globalThis.vb6NativeGPUDevice);
  const device = { label: 'startup-owned-device' };
  globalThis.vb6NativeGPUDevice = device;
  assert.equal(await getGPUDevice(), device);
  assert.equal(await getGPUDevice(), device);
});
