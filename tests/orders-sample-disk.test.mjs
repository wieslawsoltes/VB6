import test from 'node:test';
import assert from 'node:assert/strict';
import {orderEntryExample} from '../src/project/examples.js';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';

test('Order Entry declares the parent directory required by its unmodified Save handler',()=>{
  const project=orderEntryExample(),before=structuredClone(project.vfs),disk=new VirtualFileSystem(project.vfs);
  assert.ok(disk.directories.has('/Orders'));
  assert.match(project.modules[0].code,/Open "Orders\/Order-"/);
  assert.deepEqual(project.vfs,before);
  assert.equal(disk.files.size,0,'the sample must not fabricate previously saved orders');
});
