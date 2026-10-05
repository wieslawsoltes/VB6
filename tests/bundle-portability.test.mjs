import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {bundle} from '../tools/bundle.mjs';

test('bundled source labels produce identical bytes for Windows and POSIX separators',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'vb6-bundle-paths-'));
  const relative=path.relative;
  try {
    fs.mkdirSync(path.join(dir,'lib'));
    fs.mkdirSync(path.join(dir,'app'));
    fs.writeFileSync(path.join(dir,'lib','value.js'),'export const value=42;\n');
    const entry=path.join(dir,'app','index.js');
    fs.writeFileSync(entry,"import {value} from '../lib/value.js';\nexport const result=value;\n");
    path.relative=(from,to)=>relative(from,to).replace(/\\/g,'/');
    const posix=bundle(entry,'PortableBundle');
    path.relative=(from,to)=>relative(from,to).replace(/\//g,'\\');
    const windows=bundle(entry,'PortableBundle');
    assert.equal(windows,posix,'Host separators must not leak into source labels or nested payloads');
    assert.ok(windows.includes('/* ../lib/value.js */'));
  } finally {
    path.relative=relative;
    fs.rmSync(dir,{recursive:true,force:true});
  }
});
