/** Bootstrap bundled scripts only after the graphics requirement has been checked. */
async function start() {
  const info = await globalThis.vb6Native.info();
  const diagnostics = { requested: info.graphics, webgpu: false, error: null };
  if (info.graphics !== 'canvas2d') {
    try {
      const adapter = await navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' });
      if (!adapter) throw new Error('No compatible WebGPU adapter was found');
      const device = await adapter.requestDevice();
      diagnostics.webgpu = true;
      diagnostics.adapter = { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, device: adapter.info?.device };
      device.destroy();
    } catch (error) {
      diagnostics.error = error.message;
      if (info.graphics === 'webgpu') throw new Error('This executable requires WebGPU. ' + error.message + '. Update your graphics driver, or build with --graphics auto to permit Canvas2D fallback.');
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
