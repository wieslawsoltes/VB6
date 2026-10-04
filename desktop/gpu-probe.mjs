/** Verify canvas submission/readback, not merely adapter enumeration. */
export async function probeWebGPU(view=globalThis,{timeout=8000}={}){
  let abandoned=false,device,canvas,context,buffer,timer;
  const run=(async()=>{
    const adapter=await view.navigator?.gpu?.requestAdapter({powerPreference:'high-performance'});
    if(!adapter)throw new Error('No compatible WebGPU adapter was found');
    device=await adapter.requestDevice();
    if(abandoned){device.destroy();throw new Error('WebGPU initialization timed out');}
    const lost=device.lost.then(info=>{throw new Error('WebGPU device lost: '+info.message);});
    // Register the loss handler before any canvas/GPU work and race it with completion.
    const draw=async()=>{
      canvas=view.document.createElement('canvas');canvas.width=canvas.height=1;
      canvas.style.cssText='position:fixed;left:0;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      view.document.body.append(canvas);
      context=canvas.getContext('webgpu');if(!context)throw new Error('WebGPU canvas context is unavailable');
      const format=view.navigator.gpu.getPreferredCanvasFormat();
      device.pushErrorScope('validation');
      let validation;
      try{
        context.configure({device,format,alphaMode:'opaque',usage:view.GPUTextureUsage.RENDER_ATTACHMENT|view.GPUTextureUsage.COPY_SRC});
        buffer=device.createBuffer({size:256,usage:view.GPUBufferUsage.MAP_READ|view.GPUBufferUsage.COPY_DST});
        const encoder=device.createCommandEncoder(),texture=context.getCurrentTexture();
        const pass=encoder.beginRenderPass({colorAttachments:[{view:texture.createView(),loadOp:'clear',storeOp:'store',clearValue:[1,0,0,1]}]});
        pass.end();encoder.copyTextureToBuffer({texture},{buffer,bytesPerRow:256},[1,1]);
        device.queue.submit([encoder.finish()]);
      }finally{validation=device.popErrorScope().catch(error=>error);}
      await buffer.mapAsync(view.GPUMapMode.READ);
      const pixel=Array.from(new Uint8Array(buffer.getMappedRange(),0,4));buffer.unmap();
      const error=await validation;if(error)throw new Error(error.message);
      const red=format==='bgra8unorm'?2:0;
      if(pixel[red]!==255||pixel[1]!==0||pixel[red===2?0:2]!==0||pixel[3]!==255)throw new Error('WebGPU canvas readback did not match the rendered pixel');
      return {device,webgpu:true,pixel,format,adapter:{vendor:adapter.info?.vendor,architecture:adapter.info?.architecture,device:adapter.info?.device}};
    };
    return Promise.race([draw(),lost]);
  })();
  try{return await Promise.race([run,new Promise((_,reject)=>{timer=setTimeout(()=>{abandoned=true;reject(new Error('WebGPU initialization timed out'));},timeout);})]);}
  catch(error){abandoned=true;device?.destroy();return {webgpu:false,error:error.message};}
  finally{clearTimeout(timer);buffer?.destroy();context?.unconfigure();canvas?.remove();}
}

/** Apply the selected executable graphics policy before loading project scripts. */
export async function initializeNativeGraphics(view,graphics,{probe=probeWebGPU}={}){
  if(!['webgpu','auto','canvas2d'].includes(graphics))throw new Error('Invalid native graphics policy');
  const result=graphics==='canvas2d'?{webgpu:false,error:'WebGPU disabled by the executable graphics policy'}:await probe(view);
  const diagnostics={requested:graphics,webgpu:result.webgpu,error:result.error||null,adapter:result.adapter,pixel:result.pixel};
  view.vb6NativeGraphics=diagnostics;
  if(result.webgpu){
    const device=view.vb6NativeGPUDevice=result.device;
    delete view.vb6NativeGPUUnavailable;
    device.lost.then(info=>{
      if(view.vb6NativeGPUDevice!==device)return;
      delete view.vb6NativeGPUDevice;
      diagnostics.webgpu=false;diagnostics.error='Device lost: '+info.message;
      view.vb6NativeGPUUnavailable=diagnostics.error;
    });
  }else{
    view.vb6NativeGPUUnavailable=result.error;
    if(graphics==='webgpu')throw new Error('This executable requires WebGPU. '+result.error+'. Update the graphics driver or build with --graphics auto to permit Canvas2D fallback.');
  }
  return diagnostics;
}
