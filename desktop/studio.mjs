import {createNativeWindowTransport} from './window-transport.mjs';
import {createNativeRuntimeDocumentLoader} from './runtime-document.mjs';
/** F5, design Immediate and its event-mode promotion share one sandboxed loader.
 * Do not wrap run() and inspect its side effects: Immediate does not call it.
 */
const studio = globalThis.vb6Studio;
if (studio) {
  studio.browserWindows.transport = createNativeWindowTransport(globalThis,globalThis.vb6Native,error=>studio.status('Native tool window: '+error.message));
  studio.runtimeDocumentLoader = createNativeRuntimeDocumentLoader(globalThis.vb6Native);
}
