/** This function is emitted as ordinary JavaScript, not eval/Function or a module
 * fetch. Keep it self-contained so inline, file:// and CSP deployments share it.
 */
export function startExportedApplication() {
  if (globalThis.vb6ApplicationReady) return globalThis.vb6ApplicationReady;
  const status = {phase: 'loading', error: null};
  globalThis.vb6ApplicationStatus = status;
  const banner = document.getElementById('vb6-startup');
  const emit = (name, detail) => globalThis.dispatchEvent(new CustomEvent(name, {detail}));
  let options, startupError;
  function fail(error) {
    status.phase = 'error';
    status.error = {message: String(error?.message || error || 'Application startup failed'), number: error?.number, source: error?.source, line: error?.line};
    if (banner) {
      banner.hidden = false;
      banner.setAttribute('role', 'alert');
      banner.textContent = 'Application could not start.\n' + status.error.message;
    }
    // Preserve the existing token/source-checked IDE protocol for failures that
    // happen before ApplicationHost can establish its own message callbacks.
    if (options?.bridgeToken && globalThis.parent !== globalThis) globalThis.parent.postMessage({channel: 'vb6-runtime', token: options.bridgeToken, type: 'error', error: status.error}, '*');
    emit('vb6:error', status.error);
  }
  const ready = Promise.resolve().then(async () => {
    const project = JSON.parse(document.getElementById('vb6-project').textContent);
    options = JSON.parse(document.getElementById('vb6-options').textContent);
    if (typeof globalThis.VB6Runtime?.mountApplication !== 'function') throw new Error('The application runtime could not be loaded. Check that all deployment files are present.');
    // Trusted deployment scripts can install actual callbacks, data/automation
    // providers and control registries here instead of losing them in JSON.
    if (globalThis.vb6ConfigureApplication !== undefined) {
      if (typeof globalThis.vb6ConfigureApplication !== 'function') throw new Error('vb6ConfigureApplication must be a function');
      const overrides = await globalThis.vb6ConfigureApplication({project, options, runtime: globalThis.VB6Runtime});
      if (overrides !== undefined) {
        if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new Error('vb6ConfigureApplication must return runtime options or undefined');
        options = {...options, ...overrides};
      }
    }
    const onMessage = options.onMessage;
    if (onMessage !== undefined && typeof onMessage !== 'function') throw new Error('Runtime onMessage must be a function');
    options.onMessage = message => {
      if (message.type === 'error') startupError = message.error;
      if (banner && ['ready', 'pause', 'interaction'].includes(message.type)) banner.hidden = true;
      emit('vb6:message', message);
      onMessage?.(message);
    };
    const host = await VB6Runtime.mountApplication(project, document.getElementById('app'), options);
    globalThis.vb6Application = host;
    // ApplicationHost reports VB errors through messages and may resolve with a
    // failed VM. Keep the host inspectable, but never signal a successful launch.
    if (host.vm?.state === 'error') throw Object.assign(new Error(startupError?.message || 'Visual Basic startup failed'), startupError);
    globalThis.addEventListener('pagehide', event => {
      if (host.disposed) return;
      host.persist?.();
      // A back/forward-cache entry must remain resumable, not disposed.
      if (!event.persisted) host.dispose?.();
    });
    status.phase = 'ready';
    if (banner) banner.hidden = true;
    emit('vb6:ready', {host});
    return host;
  });
  globalThis.vb6ApplicationReady = ready;
  // Attach a handler without replacing the public promise: callers can still
  // await its rejection, and an unattended standalone has no unhandled rejection.
  ready.catch(fail);
  return ready;
}

export const APPLICATION_BOOTSTRAP = '(' + startExportedApplication.toString() + ')();';
