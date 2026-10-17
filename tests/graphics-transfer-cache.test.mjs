import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphicsSurface} from '../src/graphics/surface.js';
import {normalizeCommand} from '../src/graphics/contract.js';

function surface(commands=[normalizeCommand('pixel',[5,5],255)]){
  return Object.assign(Object.create(GraphicsSurface.prototype),{
    commands,width:100,height:100,grid:0,theme:'classic',replayEpoch:0,dpr:1,
    rgba:()=>[1,0,0,1]
  });
}
for(const empty of [false,true])test(`vertex validity requires its payload, including an empty command list (${empty})`,()=>{
  const s=surface(empty?[]:undefined),first=s.vertices();
  assert.ok(first instanceof Float32Array);assert.strictEqual(s.vertices(),first);
  s.vertexData=null;
  const rebuilt=s.vertices();assert.ok(rebuilt instanceof Float32Array);
  assert.notStrictEqual(rebuilt,first);assert.deepEqual(rebuilt,first);
  assert.strictEqual(s.vertices(),rebuilt);
});
test('document adoption retires all document-bound geometry keys before GPU initialization',()=>{
  const view={cancelAnimationFrame(){},ResizeObserver:class{observe(){} disconnect(){}}};
  const old={defaultView:view},next={defaultView:view};
  const node={ownerDocument:next,closest(){return null;}};
  const s=surface();let dropped=0,initialized=0,resized=0;
  Object.assign(s,{container:node,themeDocument:old,requestedBackend:'webgpu',
    resizeObserver:new view.ResizeObserver(),unbindDocument(){},bindDocument(){},
    dropRasterCaches(){dropped++;},releaseGPU(){},resize(){resized++;},
    initializeGPU(){initialized++;assert.equal(this.vertexData,null);assert.equal(this.vertexCommands,null);
      assert.equal(this.vertexKey,null);assert.equal(this.triangleCommands,null);return Promise.resolve(true);}});
  const before=s.vertices();s.triangleCommands=s.commands;s.triangleKey='cached';
  s.transferDocument();
  assert.equal(s.themeDocument,next);assert.equal(dropped,1);assert.equal(initialized,1);assert.equal(resized,1);
  assert.deepEqual(s.vertices(),before);assert.notStrictEqual(s.vertices(),before);
});
