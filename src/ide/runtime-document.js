/** The trusted embedding host may select the document transport before any navigation. */
export function loadRuntimeDocument(studio, frame, html) {
  if (typeof studio.runtimeDocumentLoader === 'function') {
    return studio.runtimeDocumentLoader(frame, html);
  }
  frame.srcdoc = html;
}
