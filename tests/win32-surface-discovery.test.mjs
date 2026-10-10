import test from 'node:test';
import assert from 'node:assert/strict';
import {nativeSurfaceMethods} from '../src/native/surfaces.js';
import {compileModule} from '../src/language/compiler.js';
for(const code of [
 'With Lists(Choose())\n .Clear\nEnd With',
 'With Canvas\n .BackColor=123\n With Canvas\n .CurrentX=2.5\n End With\nEnd With',
 'With Pictures(Choose())\n .CurrentX=5\nEnd With'
])test('surface discovery never lowers indexed receivers or allocates runtime frame slots: '+code,()=>{
 const program=compileModule({name:'Form1',kind:'form',code:'Private Sub Test()\n'+code+'\nEnd Sub'}),contexts=[...program.procedures.values()].map(proc=>({proc}));
 const module={name:'Form1',form:{type:'Form'},procedures:new Map(contexts.map(c=>[c.proc.name,c])),controls:new Map(),controlArrays:new Map()};
 const picture={module,model:{name:'Canvas',type:'PictureBox',properties:{}},key:'canvas'};module.controls.set('canvas',picture);
 for(const [name,type]of [['Lists','ListBox'],['Pictures','PictureBox']])module.controlArrays.set(name.toLowerCase(),{name,module,entries:new Map([[0,{module,model:{name,type,properties:{Index:0}}}]])});
 for(const c of contexts)c.module=module;
 const called=[],compiler={context:null,modules:new Map([['form1',module]]),variable:()=>null,resolveProcedure:()=>null,
  object:()=>{throw new Error('ordinary object lowering must not run during discovery');},
  arrayWorkspace:()=>{throw new Error('discovery must not allocate frame slots');},
  prepareNativeSurface:o=>called.push(o)};
 nativeSurfaceMethods.prepareNativeSurfaceDemand.call(compiler);
 assert.equal(compiler.context,null);assert.ok(contexts.every(c=>c.withBindings===undefined));
 if(code.includes('Lists'))assert.equal(called.length,0);else {assert.ok(called.length>0);assert.ok(called.every(c=>c.model.type==='PictureBox'));}
});
