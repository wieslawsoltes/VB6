/** Load source runtimes through the embedding host before starting navigation.
 * Both F5 and design-mode Immediate must use this boundary. A native host can
 * supply document-specific CSP without first attempting an inherited srcdoc
 * navigation. Browser runtimes keep their existing opaque-origin srcdoc path.
 *
 * The caller owns the frame and session identity. A delayed host response must
 * neither navigate a disposed frame nor stop/report errors against a new run.
 */
const requests = new WeakMap();

export function loadRuntimeDocument(ide, frame, html, {isCurrent, onError}) {
  // Request identity is separate from session identity: an active session can
  // prepare more than one document for the same iframe (for example on restart).
  if (!frame.isConnected || !isCurrent()) return;
  const request = {};
  requests.set(frame, request);
  const current = () => requests.get(frame) === request && frame.isConnected && isCurrent();
  const failed = error => { if (current()) onError(error); };
  try {
    if (typeof ide.runtimeDocumentLoader !== 'function') {
      frame.srcdoc = html;
      return;
    }
    // Never assign srcdoc in native mode, even transiently. Do not fall back to
    // an unapproved document if the host refuses or cannot prepare the request.
    return Promise.resolve(ide.runtimeDocumentLoader(html)).then(url => {
      if (!current()) return;
      if (typeof url !== 'string' || !url) throw new Error('Runtime host returned an invalid document URL');
      frame.removeAttribute('srcdoc');
      frame.src = url;
    }).catch(failed);
  } catch (error) { failed(error); }
}
