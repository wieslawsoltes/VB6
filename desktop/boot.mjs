import {probeWebGPU} from './gpu-probe.mjs';
/** Bootstrap bundled scripts only after the graphics requirement has been checked. */
async function start() {
  const info = await globalThis.vb6Native.info();
  const diagnostics = { requested: info.graphics, webgpu: false, error: null };
  if (info.graphics !== 'canvas2d') {
    const result=await probeWebGPU();
    diagnostics.webgpu=result.webgpu;
    diagnostics.error=result.error||null;
    diagnostics.adapter=result.adapter;
    diagnostics.pixel=result.pixel;
    if(result.webgpu){
      const device=globalThis.vb6NativeGPUDevice=result.device;
      device.lost.then(info=>{
        if(globalThis.vb6NativeGPUDevice===device)delete globalThis.vb6NativeGPUDevice;
        diagnostics.webgpu=false;diagnostics.error='Device lost: '+info.message;
      });
    }else{
      globalThis.vb6NativeGPUUnavailable=result.error;
      if(info.graphics==='webgpu')throw new Error('This executable requires WebGPU. '+result.error+'. Update the graphics driver or build with --graphics auto to permit Canvas2D fallback.');
    }
  }
  globalThis.vb6NativeGraphics = diagnostics;
  for (const source of info.scripts) {
    await new Promise((resolve, reject) => {
      const script = document.createElement('script'); script.src = source; script.onload = resolve;
      script.onerror = () => reject(new Error('Could not load bundled script: ' + source)); document.head.append(script);
    });
  }
  if (info.kind === 'studio') await import('./studio.mjs');
  globalThis.vb6NativeReady = true;
}
start().catch(async error => {
  globalThis.vb6NativeStartupError = error.message;
  document.body.replaceChildren();
  const title = document.createElement('h1'), detail = document.createElement('p');
  title.textContent = 'VB6 startup failed'; detail.textContent = error.message; document.body.append(title, detail);
  document.body.style.cssText = 'padding:24px;box-sizing:border-box;font:16px system-ui';
  await globalThis.vb6Native.windowCommand('controller', 'show');
});
