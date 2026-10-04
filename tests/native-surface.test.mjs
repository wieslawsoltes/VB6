import test from 'node:test';
import assert from 'node:assert/strict';
import {GraphicsSurface} from '../src/graphics/surface.js';
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture({shader,validation}={}){
  const lost=deferred(),calls=[];
  const context={configure:()=>calls.push('configure'),unconfigure:()=>calls.push('unconfigure')};
  const device={lost:lost.promise,createShaderModule:()=>({getCompilationInfo:()=>shader?.promise||Promise.resolve({messages:[]})}),
    pushErrorScope:()=>calls.push('push'),popErrorScope:()=>{calls.push('pop');return validation?.promise||Promise.resolve(null);},
    createRenderPipeline:()=>({getBindGroupLayout:()=>({})}),createBuffer:()=>({destroy:()=>calls.push('buffer-destroy')}),createBindGroup:()=>({})};
  const view={vb6NativeGPUDevice:device,navigator:{gpu:{getPreferredCanvasFormat:()=> 'bgra8unorm'}},GPUBufferUsage:{UNIFORM:64,COPY_DST:8},GPUTextureUsage:{RENDER_ATTACHMENT:16,COPY_SRC:1}};
  const document={defaultView:view,createElement:()=>({style:{},getContext:()=>context,remove:()=>calls.push('remove')})};
  const surface=Object.assign(Object.create(GraphicsSurface.prototype),{container:{ownerDocument:document},canvas:{style:{},before:()=>calls.push('insert')},backend:'canvas2d',resize:()=>calls.push('resize'),invalidate:()=>calls.push('invalidate'),onBackend:b=>calls.push(b)});
  return {surface,device,document,calls,lost};
}
test('surface initialization balances GPU scopes and owns only its buffers',async()=>{
  const f=fixture();assert.equal(await f.surface.initializeGPU(),true);assert.equal(f.surface.backend,'webgpu');
  assert.equal(f.calls.filter(x=>x==='push').length,1);assert.equal(f.calls.filter(x=>x==='pop').length,1);
  f.surface.releaseGPU();assert.equal(f.surface.backend,'canvas2d');assert.ok(f.calls.includes('buffer-destroy'));assert.ok(f.calls.includes('unconfigure'));
});
test('disposing during shader compilation never attaches stale resources',async()=>{
  const shader=deferred(),f=fixture({shader});const ready=f.surface.initializeGPU();await Promise.resolve();
  f.surface.disposed=true;f.surface.releaseGPU();shader.resolve({messages:[]});assert.equal(await ready,false);assert.ok(!f.calls.includes('insert'));assert.ok(!f.calls.includes('configure'));
});
test('moving a surface to another document cancels pending device setup',async()=>{
  const validation=deferred(),f=fixture({validation});const ready=f.surface.initializeGPU();await Promise.resolve();await Promise.resolve();
  f.surface.container.ownerDocument={defaultView:{}};f.surface.releaseGPU();validation.resolve(null);
  assert.equal(await ready,false);assert.ok(!f.calls.includes('insert'));assert.ok(f.calls.includes('buffer-destroy'));assert.ok(f.calls.includes('unconfigure'));
});
test('old-window device loss cannot tear down a new-window surface',async()=>{
  const old=fixture(),next=fixture();await old.surface.initializeGPU();old.surface.releaseGPU();
  old.surface.container.ownerDocument=next.document;await old.surface.initializeGPU();
  old.lost.resolve({message:'old window closed'});await Promise.resolve();
  assert.equal(old.surface.backend,'webgpu');assert.equal(old.surface.device,next.device);
  next.lost.resolve({message:'new device lost'});await Promise.resolve();assert.equal(old.surface.backend,'canvas2d');assert.match(old.surface.gpuError,/new device lost/);
});
test('failed validation releases temporary resources and reports fallback',async()=>{
  const validation=deferred(),f=fixture({validation});validation.resolve({message:'Invalid pipeline'});
  assert.equal(await f.surface.initializeGPU(),false);assert.equal(f.surface.backend,'canvas2d');assert.match(f.surface.gpuError,/Invalid pipeline/);assert.ok(f.calls.includes('buffer-destroy'));
});
