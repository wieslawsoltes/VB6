import {createNativeWindowTransport} from './window-transport.mjs';

/** Prepare the native document without starting an intermediate srcdoc navigation. */
export function installNativePreview(studio, bridge) {
  let generation = 0;
  studio.runtimeDocumentLoader = (frame, html) => {
    const request = ++generation;
    const current = () => request === generation && studio.runtimeFrame === frame && frame.isConnected;
    return Promise.resolve().then(() => bridge.runtimeDocument(html)).then(url => {
      if (!current()) return false;
      if (typeof url !== 'string' || !/^vb6:\/\/app\/preview\/[a-f0-9]{32}$/.test(url)) {
        throw new Error('Invalid native preview document URL');
      }
      frame.src = url;
      return true;
    }).catch(async error => {
      if (!current()) return false;
      // No snapshot request can succeed before this frame has loaded.
      await studio.stop(false);
      if (request === generation && !studio.runtimeFrame) {
        studio.status('Native preview failed: ' + (error?.message || String(error)));
      }
      return false;
    });
  };
}

const studio = globalThis.vb6Studio;
if (studio) {
  studio.browserWindows.transport = createNativeWindowTransport(globalThis, globalThis.vb6Native, error => studio.status('Native tool window: ' + error.message));
  installNativePreview(studio, globalThis.vb6Native);
}
