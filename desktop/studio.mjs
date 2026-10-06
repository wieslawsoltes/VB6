import {createNativeWindowTransport} from './window-transport.mjs';

/** Register a preview before navigating it. Never start a srcdoc load under the
 * controller CSP and try to cancel it later: Chromium may still commit srcdoc.
 * A stopped/replaced run owns neither the next frame nor its error reporting. */
export function installNativePreview(studio, bridge) {
  studio.loadRuntimeDocument = (frame, html) => {
    const current = () => studio.runtimeFrame === frame && frame.isConnected;
    const ready = Promise.resolve().then(() => bridge.runtimeDocument(html)).then(url => {
      if (!current()) return false;
      if (typeof url !== 'string' || !/^vb6:\/\/app\/preview\/[a-f0-9]{32}$/.test(url))
        throw new Error('Invalid native preview document URL');
      frame.src = url;
      return true;
    }).catch(async error => {
      if (!current()) return false;
      await studio.stop(false);
      if (!studio.runtimeFrame) studio.status('Native preview failed: ' + error.message);
      return false;
    });
    studio.nativePreviewReady = ready;
    return ready;
  };
}

/** Keep the debugger frame sandboxed; the host supplies its document-specific CSP. */
const studio = globalThis.vb6Studio;
if (studio) {
  studio.browserWindows.transport = createNativeWindowTransport(globalThis,globalThis.vb6Native,error=>studio.status('Native tool window: '+error.message));
  installNativePreview(studio, globalThis.vb6Native);
}
