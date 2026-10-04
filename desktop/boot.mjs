import {initializeNativeGraphics} from './gpu-probe.mjs';
/** Bootstrap bundled scripts only after the graphics requirement has been checked. */
async function start() {
  const info = await globalThis.vb6Native.info();
  await initializeNativeGraphics(globalThis,info.graphics);
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
