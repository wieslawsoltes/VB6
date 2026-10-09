import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeControlFixtures} from '../tools/win32-control-fixtures.mjs';
import {traceControlFixture} from '../tools/trace-win32-controls.mjs';
import {compileWin32} from '../src/native/compiler.js';
test('independent GDI deletion probe exists only in the failure diagnostic',()=>{
 const {project}=nativeControlFixtures().find(f=>f.project.name==='AotControlSurfaces');
 const before=JSON.stringify(project),original=compileWin32(project),traced=traceControlFixture(project);
 assert.equal(JSON.stringify(project),before);
 assert.deepEqual(compileWin32(project).bytes,original.bytes);
 assert.ok(!project.modules[0].code.includes('NativeSurfaceDeleteProbe'));
 for(const line of project.modules[0].code.split('\n').filter(s=>s.includes('Then ExitProcess ')))assert.ok(traced.modules[0].code.includes(line));
 for(const text of ['dc=CreateCompatibleDC(0)','deleted=DeleteDC(dc)','bitmap=GetCurrentObject(dc,7)','secondDelete=DeleteDC(dc)'])assert.ok(traced.modules[0].code.includes(text));
 for(const optimization of [0,1,2])assert.ok(compileWin32(traced,{optimization}).bytes.length);
});
