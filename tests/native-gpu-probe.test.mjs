import test from 'node:test';
import assert from 'node:assert/strict';
import {probeWebGPU} from '../desktop/gpu-probe.mjs';
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
function fixture({pixel=[0,0,255,255],format='bgra8unorm',map,validation,available=true}={}){
  const calls=[],lost=deferred();
  const buffer={mapAsync:()=>map?.promise??Promise.resolve(),getMappedRange:()=>Uint8Array.from(pixel).buffer,unmap:()=>calls.push('unmap'),destroy:()=>calls.push('buffer-destroy')};
  const device={lost:lost.promise,destroy:()=>{calls.push('device-destroy');lost.resolve({message:'Destroyed'});},pushErrorScope:()=>calls.push('push'),popErrorScope:()=>Promise.resolve(validation),createBuffer:()=>buffer,
    createCommandEncoder:()=>({beginRenderPass:()=>({end(){}}),copyTextureToBuffer:()=>calls.push('copy'),finish:()=>({})}),queue:{submit:()=>calls.push('submit')}};
  const context={configure:()=>calls.push('configure'),getCurrentTexture:()=>({createView:()=>({})}),unconfigure:()=>calls.push('unconfigure')};
  const canvas={style:{},getContext:()=>context,remove:()=>calls.push('remove')};
  const view={navigator:{gpu:{requestAdapter:async()=>available?{requestDevice:async()=>device,info:{vendor:'test'}}:null,getPreferredCanvasFormat:()=>format}},
    document:{createElement:()=>canvas,body:{append:()=>calls.push('append')}},GPUBufferUsage:{MAP_READ:1,COPY_DST:8},GPUTextureUsage:{RENDER_ATTACHMENT:16,COPY_SRC:1},GPUMapMode:{READ:1}};
  return {view,calls,device,lost};
}
test('startup WebGPU capability requires successful submitted pixel readback',async()=>{
  const f=fixture(),r=await probeWebGPU(f.view);assert.equal(r.webgpu,true);assert.equal(r.device,f.device);assert.deepEqual(r.pixel,[0,0,255,255]);
  assert.ok(f.calls.includes('submit'));assert.ok(f.calls.includes('copy'));assert.ok(f.calls.includes('remove'));assert.ok(!f.calls.includes('device-destroy'));
});
test('RGBA canvas formats are verified in their own channel order',async()=>{
  const f=fixture({pixel:[255,0,0,255],format:'rgba8unorm'});assert.equal((await probeWebGPU(f.view)).webgpu,true);
});
test('enumerated adapters with broken canvas output are not advertised as working',async()=>{
  for(const pixel of [[0,0,0,0],[255,0,0,255],[0,255,255,255],[255,0,255,255]]){
    const f=fixture({pixel}),r=await probeWebGPU(f.view);assert.equal(r.webgpu,false);assert.match(r.error,/readback/);assert.ok(f.calls.includes('device-destroy'));
  }
});
test('validation errors and missing adapters provide an explicit fallback reason',async()=>{
  assert.match((await probeWebGPU(fixture({available:false}).view)).error,/adapter/);
  assert.match((await probeWebGPU(fixture({validation:{message:'Invalid copy'}}).view)).error,/Invalid copy/);
});
test('GPU loss cannot leave startup waiting on an unresolved mapping',async()=>{
  const map=deferred(),f=fixture({map});const ready=probeWebGPU(f.view,{timeout:1000});
  await Promise.resolve();await Promise.resolve();f.lost.resolve({message:'Driver reset'});
  assert.match((await ready).error,/Driver reset/);assert.ok(f.calls.includes('remove'));
});
test('startup timeout releases the failed device and canvas',async()=>{
  const f=fixture({map:deferred()}),r=await probeWebGPU(f.view,{timeout:10});assert.match(r.error,/timed out/);assert.ok(f.calls.includes('device-destroy'));assert.ok(f.calls.includes('remove'));
});
