import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createWin32} from '../src/index.js';
import {clippingEdges} from './region-edge-probe.mjs';
const observed=JSON.parse(readFileSync(new URL('./fixtures/region-clipping-windows.json',import.meta.url),'utf8'));
test('37 real Windows edge contracts retain off-screen clips and match return values',()=>{assert.deepEqual(clippingEdges(createWin32),observed);});
