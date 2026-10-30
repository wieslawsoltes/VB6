import test from 'node:test';
import assert from 'node:assert/strict';
import {VirtualFileSystem} from '../src/runtime/filesystem.js';
import {readZip} from '../src/project/zip.js';
import {applicationDiskEntries, archiveApplicationDisk, canRelaunchApplication} from '../src/runtime/application-desktop.js';

test('the desktop lists immediate folders/files and preserves exact binary and text download bytes', async () => {
  const disk = new VirtualFileSystem({directories:['/Orders','/Empty']});
  disk.write('/Orders/Order-1001.txt', 'TOTAL: $107.00\r\n');
  disk.writeBytes('/Orders/data.bin', [0,255,128,13,10]);
  assert.deepEqual(applicationDiskEntries(disk).map(e => [e.name,e.folder]), [['Empty',true],['Orders',true]]);
  assert.deepEqual(applicationDiskEntries(disk,'/orders').map(e=>e.name), ['data.bin','Order-1001.txt']);
  const before = disk.snapshot();
  const files = await readZip(archiveApplicationDisk(disk));
  assert.deepEqual(files.get('Orders/data.bin'), new Uint8Array([0,255,128,13,10]));
  assert.deepEqual(files.get('Orders/Order-1001.txt'), disk.readBytes('/Orders/Order-1001.txt'));
  assert.match(new TextDecoder().decode(archiveApplicationDisk(disk)), /Empty\//);
  assert.deepEqual(disk.snapshot(), before, 'downloading must never rewrite or remove application files');
});

test('closed forms can relaunch while hidden loaded forms, active work and paused VMs cannot', () => {
  const host = {vm:{state:'idle',stack:[],processing:false,formInstances:new Set([{loaded:false}])}};
  assert.equal(canRelaunchApplication(host),true);
  host.vm.formInstances.add({loaded:true});assert.equal(canRelaunchApplication(host),false);
  host.vm.formInstances.clear();host.vm.processing=true;assert.equal(canRelaunchApplication(host),false);
  host.vm.processing=false;host.vm.stack.push({});assert.equal(canRelaunchApplication(host),false);
  host.vm.stack=[];host.vm.state='paused';assert.equal(canRelaunchApplication(host),false);
  for (const state of ['stopped','error']) {host.vm.state=state;assert.equal(canRelaunchApplication(host),true);}
});

test('malformed authored archive paths cannot escape their downloaded ZIP folder', () => {
  const disk = new VirtualFileSystem({files:{'/../outside.txt':'unsafe'}});
  assert.throws(()=>archiveApplicationDisk(disk), /Unsafe ZIP path|File not found/);
});
