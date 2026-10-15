import test from 'node:test';
import assert from 'node:assert/strict';
import {compileProject} from '../src/language/compiler.js';
import {compileWin32} from '../src/native/compiler.js';
import {compileCompute} from '../src/compute/index.js';
import {compileMacOSAOT} from '../packages/macos-native/src/aot-compiler.js';
const project=body=>({schema:1,name:'GraphicsBoundary',startup:'Sub Main',modules:[{name:'M',kind:'module',code:`Sub Main()\n${body}\nEnd Sub`}]});
for(const syntax of ['PSet Step(1, 2), 3','Line -(3, 4), 5','Circle (1, 2), 3, 4, 0, 1, 0.5','Scale (0, 0)-(1, 1)']){
 test('extended browser drawing compiles: '+syntax,()=>{const p=compileProject(project(syntax));assert.deepEqual(p.diagnostics,[]);assert.ok(p.modules.get('m').procedures.get('main').code.some(i=>i.op==='graphicsExtended'));});
 for(const [name,compile] of Object.entries({Win32:compileWin32,Compute:compileCompute,MacOSAOT:compileMacOSAOT}))test(name+' fails closed rather than dropping extended graphics operands: '+syntax,()=>assert.throws(()=>compile(project(syntax)),/graphicsExtended/));
}
