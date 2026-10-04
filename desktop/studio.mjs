/** Keep the IDE's debugger preview sandboxed; only its document is served by the native host. */
const studio = globalThis.vb6Studio;
if (studio) {
  const run = studio.run.bind(studio);
  studio.run = (...args) => {
    const previous = studio.runtimeFrame;
    run(...args);
    const frame = studio.runtimeFrame;
    if (!frame || frame === previous || !frame.srcdoc) return;
    const html = frame.srcdoc;
    // Cancel srcdoc navigation in this same task; the native protocol supplies a document-specific CSP.
    frame.removeAttribute('srcdoc');
    globalThis.vb6Native.runtimeDocument(html).then(url => {
      if (studio.runtimeFrame === frame && frame.isConnected) frame.src = url;
    }).catch(error => { studio.stop(); studio.status('Native preview failed: ' + error.message); });
  };
}
