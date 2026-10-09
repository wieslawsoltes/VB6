import fs from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
import {traceControlFixture} from '../tools/trace-win32-controls.mjs';
import {compileWin32} from '../src/native/compiler.js';
test('failure-only control tracing preserves authored fixture checks and original sources',()=>{
  for(const {project} of nativeControlFixtures()){
    const before=JSON.stringify(project),traced=traceControlFixture(project);
    assert.equal(JSON.stringify(project),before);
    for(const line of project.modules[0].code.split('\n').filter(s=>s.includes('Then ExitProcess ')))assert.ok(traced.modules[0].code.includes(line),line);
    for(const optimization of [0,1,2])assert.doesNotThrow(()=>compileWin32(traced,{optimization}));
  }
});

test('Windows control driver independently requires every maintained fixture family',()=>{
 const script=fs.readFileSync(new URL('../tools/test-win32-controls.ps1',import.meta.url),'utf8');
 const line=script.split('\n').find(s=>s.startsWith('foreach ($family in @('));assert.ok(line);
 const names=[...line.matchAll(/'([^']+)'/g)].map(m=>m[1]),fixtures=nativeControlFixtures();
 assert.equal(new Set(names).size,names.length);assert.deepEqual(names.slice().sort(),fixtures.map(f=>f.project.name).sort());
 assert.equal(names.length,27);assert.equal(fixtures.reduce((n,f)=>n+f.checks.length,0)*3,1278);
 for(const family of ['Ranges','Content','Editing','Files','Drawing','RichText'])assert.ok(names.includes('AotControl'+family));
 assert.match(script,/foreach \(\$level in 0\.\.2\)/);assert.match(script,/Incomplete or duplicated native fixture/);
});

test('failure-only tracing reports startup VB errors without changing the authoritative fixture',()=>{
 const {project}=nativeControlFixtures().find(f=>f.project.name==='AotControlChart');
 const before=JSON.stringify(project),traced=traceControlFixture(project);
 assert.equal(JSON.stringify(project),before);
 assert.equal(traced.startup,'Sub Main');
 const startup=traced.modules.at(-1);
 assert.match(startup.code,/On Error GoTo Failed/);
 assert.match(startup.code,/Startup error/);
 assert.ok(startup.code.includes(project.startup+'.Show'));
 assert.match(startup.code,/TraceExit code/);
 assert.equal(traced.modules.length,project.modules.length+1);
});

test('failure-only common-item trace includes click result and actual queued coordinates',()=>{
 const {project}=nativeControlFixtures().find(f=>f.project.name==='AotControlItemObjects');
 const before=JSON.stringify(project),traced=traceControlFixture(project);
 assert.equal(JSON.stringify(project),before);
 for(const marker of ['Tree click: result=','PulseTree item=','Client point=','Screen point=','GetMessage result=','Restore cursor: result='])assert.ok(traced.modules[0].code.includes(marker),marker);
 for(const optimization of [0,1,2])assert.ok(compileWin32(traced,{optimization}).bytes.length);
});
