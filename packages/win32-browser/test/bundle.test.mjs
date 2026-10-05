import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import * as source from '../src/index.js';

test('shipped global bundle matches public ESM exports and standalone region behavior',()=>{
  const sandbox={TextEncoder,TextDecoder,performance,setTimeout,clearTimeout,setInterval,clearInterval,URL};
  runInNewContext(readFileSync(new URL('../dist/win32-browser.js',import.meta.url),'utf8'),sandbox,{timeout:5000});
  const global=sandbox.Win32Compat;
  assert.deepEqual(Object.keys(global).sort(),Object.keys(source).sort());
  const regions=new global.RegionStore();
  const frame=regions.combine(regions.rectangle(0,0,100,100),regions.rectangle(25,25,75,75),4);
  assert.equal(regions.contains(frame,10,10),true);
  assert.equal(regions.contains(frame,50,50),false);
  const a=source.createWin32(),b=global.createWin32();
  try {
    assert.deepEqual(JSON.parse(JSON.stringify(b.manifest())),a.manifest());
    const r=b.invoke('gdi32','CreateRectRgn',[0,0,100,100]);
    assert.ok(r>0);assert.equal(b.invoke('gdi32','GetRegionData',[r,0,0]),48);
    assert.equal(b.invoke('gdi32','DeleteObject',[r]),1);
  } finally {a.dispose();b.dispose();}
});
