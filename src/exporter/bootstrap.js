/** This function is emitted as ordinary JavaScript, not eval/Function or a module
 * fetch. Keep it self-contained so inline, file:// and CSP deployments share it.
 */
export function startExportedApplication() {
  if (globalThis.vb6ApplicationReady) return globalThis.vb6ApplicationReady;
  const status = {phase: 'loading', error: null};
  globalThis.vb6ApplicationStatus = status;
  const banner = document.getElementById('vb6-startup');
  const emit = (name, detail) => globalThis.dispatchEvent(new CustomEvent(name, {detail}));
  let options, project, startupError, host, desktop, launching, departed = false, closed = false, rejectDeparture;
  const abort = new AbortController();
  const departure = new Promise((resolve, reject) => { rejectDeparture = reject; });
  const cancelled = () => Object.assign(new Error('Application startup was cancelled because the page was closed.'), {name: 'AbortError', code: 'EXPORT_STARTUP_CANCELLED'});
  const ensureActive = () => { if (departed) throw cancelled(); };
  const reportLifecycleError = error => emit('vb6:lifecycle-error', {message: String(error?.message || error)});
  function saveHost() {
    if (host && !closed && !host.disposed) {
      try { host.persist?.(); } catch (error) { reportLifecycleError(error); }
    }
  }
  function closeHost() {
    if (!host || closed) return;
    closed = true;
    if (!host.disposed) {
      try { host.dispose?.(); } catch (error) { reportLifecycleError(error); }
    }
  }
  // Own the lifetime before any async adapter or mount starts. Late hosts from
  // an outgoing document are disposed too; failed hosts remain inspectable.
  globalThis.addEventListener('pagehide', event => {
    if (departed) return;
    saveHost();
    if (!event.persisted) {
      departed = true;
      abort.abort();
      closeHost();
      desktop?.dispose();
      if (status.phase === 'loading') rejectDeparture(cancelled());
      else status.phase = 'disposed';
    }
  });
  function fail(error) {
    status.phase = departed ? 'disposed' : 'error';
    status.error = {message: String(error?.message || error || 'Application startup failed'), number: error?.number, source: error?.source, line: error?.line};
    if (banner && !departed) {
      banner.hidden = false;
      banner.setAttribute('role', 'alert');
      banner.textContent = 'Application could not start.\n' + status.error.message;
    }
    // Preserve the existing token/source-checked IDE protocol for failures that
    // happen before ApplicationHost can establish its own message callbacks.
    if (options?.bridgeToken && globalThis.parent !== globalThis) globalThis.parent.postMessage({channel: 'vb6-runtime', token: options.bridgeToken, type: 'error', error: status.error}, '*');
    emit(departed ? 'vb6:cancelled' : 'vb6:error', status.error);
    desktop?.setLoading(false);
  }
  async function mount(sessionState) {
    ensureActive();
    startupError = null;
    status.phase = 'loading'; status.error = null;
    desktop?.setLoading(true);
    if (banner) { banner.hidden = false; banner.setAttribute('role', 'status'); banner.textContent = 'Starting application…'; }
    const next = await VB6Runtime.mountApplication(project, document.getElementById('app'), sessionState ? {...options, sessionState} : options);
    if (!next || typeof next !== 'object') throw new Error('The application runtime did not return a host.');
    host = next;
    closed = false;
    globalThis.vb6Application = host;
    if (departed) { closeHost(); throw cancelled(); }
    desktop?.bind(host);
    // ApplicationHost may resolve with a failed VM. Never signal ready for it.
    if (host.vm?.state === 'error') throw Object.assign(new Error(startupError?.message || 'Visual Basic startup failed'), startupError);
    status.phase = 'ready';
    if (banner) banner.hidden = true;
    emit('vb6:ready', {host});
    return host;
  }
  globalThis.vb6RestartApplication = () => {
    if (departed) return Promise.reject(cancelled());
    if (launching || status.phase === 'loading') return globalThis.vb6ApplicationReady;
    if (host && globalThis.VB6Runtime.canRelaunchApplication && !globalThis.VB6Runtime.canRelaunchApplication(host)) return Promise.resolve(host);
    // Stop/dispose before capturing state: close any file handles, but retain
    // all bytes/settings even when persistence was denied or disabled.
    saveHost(); closeHost();
    const sessionState = host?.fs ? {vfs: host.fs.snapshot(), settings: host.settings} : undefined;
    // Keep the closed host as the last complete in-memory session until a new
    // host is returned. A failed mount must not erase it before another retry.
    launching = Promise.race([Promise.resolve().then(() => mount(sessionState)), departure]);
    globalThis.vb6ApplicationReady = launching;
    launching.then(() => { launching = null; }, error => { launching = null; fail(error); });
    return launching;
  };
  const startup = Promise.resolve().then(async () => {
    ensureActive();
    project = JSON.parse(document.getElementById('vb6-project').textContent);
    options = JSON.parse(document.getElementById('vb6-options').textContent);
    if (typeof globalThis.VB6Runtime?.mountApplication !== 'function') throw new Error('The application runtime could not be loaded. Check that all deployment files are present.');
    // Trusted deployment scripts can install actual callbacks, data/automation
    // providers and control registries here instead of losing them in JSON.
    if (globalThis.vb6ConfigureApplication !== undefined) {
      if (typeof globalThis.vb6ConfigureApplication !== 'function') throw new Error('vb6ConfigureApplication must be a function');
      const overrides = await globalThis.vb6ConfigureApplication({project, options, runtime: globalThis.VB6Runtime, signal: abort.signal});
      ensureActive();
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
      desktop?.message(message);
      emit('vb6:message', message);
      onMessage?.(message);
    };
    ensureActive();
    if (options.desktop !== false && !options.bridgeToken && typeof VB6Runtime.createApplicationDesktop === 'function') {
      desktop = VB6Runtime.createApplicationDesktop({document, container: document.getElementById('app'), project,
        launch: () => globalThis.vb6RestartApplication(), persistent: options.persist !== false});
    }
    return mount();
  });
  const ready = Promise.race([startup, departure]);
  globalThis.vb6ApplicationReady = ready;
  // Attach a handler without replacing the public promise: callers can still
  // await its rejection, and an unattended standalone has no unhandled rejection.
  ready.catch(fail);
  return ready;
}

export const APPLICATION_BOOTSTRAP = '(' + startExportedApplication.toString() + ')();';
