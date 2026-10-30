import {normalizeRendering, renderingCandidates, DEFAULT_RENDERING} from './policy.js';
/** Side-effect-free diagnostics: never allocate probe contexts or request a GPU. */
export function renderingEnvironment(view) {
  return {secureContext: typeof view?.isSecureContext === 'boolean' ? view.isSecureContext : null,
    webgpuAPI: typeof view?.navigator?.gpu?.requestAdapter === 'function',
    nativeHostDisabled: !!view?.vb6NativeGPUUnavailable};
}
/** Chromium emits these fields when its selected GL implementation is disabled.
 * A null adapter or generic BindToCurrentSequence failure alone is NOT proof.
 * https://chromium.googlesource.com/chromium/src/+/refs/heads/main/gpu/config/gpu_info_collector.cc
 */
export function browserGraphicsDisabled(message) {
  return typeof message === 'string' && /\bGL_VENDOR\s*=\s*Disabled\s*(?:,|$)/i.test(message) &&
    /\bGL_RENDERER\s*=\s*Disabled\s*(?:,|$)/i.test(message);
}
export function softwareGraphicsAdapter(info) {
  if (info?.isFallbackAdapter === true) return true;
  return [info?.description, info?.vendor, info?.architecture].some(value => typeof value === 'string' && /(?:\bSwiftShader\b|\b(?:llvm|soft)pipe\b|Microsoft Basic Render Driver|\bSoftware Rasterizer\b)/i.test(value));
}
/** Evidence is labelled by source; a successful live GPU wins over older probes. */
export function graphicsDiagnosis(status, measurement = null) {
  if (status?.active === 'webgpu' || status?.active === 'webgl2') return {code: 'GPU_ACTIVE', source: 'renderer'};
  if (status?.initializing) return {code: 'INITIALIZING', source: 'renderer'};
  const sources = [['renderer', status?.attempts || []], ['measurement', measurement?.results?.filter(r => r.available === false) || []]];
  for (const [source, failures] of sources) {
    const failure = failures.find(r => r.backend === 'webgl2' && (browserGraphicsDisabled(r.reason) ||
      (r.details || r.attempts || []).some(a => browserGraphicsDisabled(a.reason))));
    if (failure) return {code: 'BROWSER_GRAPHICS_DISABLED', source, reason: failure.reason};
  }
  const failedSource = sources.find(([, failures]) => failures.some(r => ['webgpu', 'webgl2'].includes(r.backend)));
  return {code: failedSource ? 'GPU_UNAVAILABLE' : 'NATIVE_RENDERING', source: failedSource?.[0] || 'renderer'};
}
export function renderingAdvice(status, environment = {}, measurement = null) {
  if (!status) return [];
  if (status.forcedColors) return ['Forced-colors accessibility mode intentionally uses HTML / CSS.'];
  const diagnosis = graphicsDiagnosis(status, measurement);
  if (diagnosis.code === 'GPU_ACTIVE') return softwareGraphicsAdapter(status.adapter) ? ['The browser reports a software or fallback graphics adapter. Select Use HTML / CSS and press OK to avoid the additional canvas scene and repaint work. Adapter availability does not certify hardware acceleration.'] : [];
  const advice = [], attempts = status.attempts || [];
  const webgpuFailed = attempts.some(a => a.backend === 'webgpu');
  const webglFailed = attempts.some(a => a.backend === 'webgl2');
  if (diagnosis.code === 'BROWSER_GRAPHICS_DISABLED') {
    advice.push((diagnosis.source === 'measurement' ? 'The last local measurement' : 'The browser') + ' reported GL_VENDOR = Disabled and GL_RENDERER = Disabled. The browser graphics implementation is disabled; this is not a UI shader error.');
    // A web page cannot navigate to chrome:// settings or change this preference.
    // Give copyable addresses, not a nonfunctional Enable GPU button.
    // https://developer.chrome.com/docs/web-platform/webgpu/troubleshooting-tips
    advice.push('In Chrome, open chrome://settings/system (Edge: edge://settings/system), enable "Use graphics acceleration when available", save your work and relaunch the browser. If already enabled or managed, inspect chrome://gpu (Edge: edge://gpu) and browser policy for driver, blocklist or GPU-process failures.');
    advice.push('This page cannot enable browser graphics or override a browser policy. Retry Renderer only rechecks availability; it cannot replace the required browser-side change. HTML / CSS is the default when both GPU APIs are unavailable and avoids additional canvas scene and repaint work. Canvas2D remains available as an explicit choice.');
  } else if (status.requested === 'html') return [];
  else if (webgpuFailed) {
    if (environment.nativeHostDisabled) advice.push('The native host disabled WebGPU. Check its graphics configuration; the page cannot override it.');
    else if (environment.secureContext === false) advice.push('Open the IDE over HTTPS or localhost. WebGPU is not exposed in an insecure context.');
    else if (!environment.webgpuAPI) advice.push('This browser context does not expose WebGPU. Check browser support and updates.');
    else advice.push('Check browser graphics acceleration in chrome://settings/system (Edge: edge://settings/system) and browser/OS/GPU-driver updates. Inspect chrome://gpu (Edge: edge://gpu) for disabled features or GPU-process errors.');
  }
  if (diagnosis.code !== 'BROWSER_GRAPHICS_DISABLED') {
    if (webgpuFailed && webglFailed) advice.push('Both GPU APIs failed. The page cannot enable a disabled, unavailable or browser-blocklisted GPU; the exact browser/driver cause is not exposed here.');
    else if (webglFailed) advice.push('The browser could not create a WebGL2 context. Check graphics acceleration, driver support and the context-creation details.');
    if (attempts.length) advice.push('Retry Renderer rechecks the saved backend order without changing the project or these draft options. A browser graphics-setting change may require restarting the browser.');
  }
  if (status.policy && status.active === 'html' && webgpuFailed) {
    const candidates = renderingCandidates(status.policy);
    const omitted = DEFAULT_RENDERING.fallbacks.filter(name => name !== 'html' && !candidates.includes(name));
    if (omitted.length) advice.push('The saved backend order skips ' + omitted.join(' and ') + '. Restore Default Backends and press OK to enable the default fallback order; a successful local measurement does not change the active renderer.');
  }
  if (status.adapter?.isFallbackAdapter === true) advice.push('The browser reports a fallback adapter. This does not certify hardware acceleration.');
  return advice;
}
/** A snapshot only: never allocate a canvas, probe a GPU or persist preferences. */
export function createRenderingReport(renderer, view, measurement = null) {
  const status = renderer?.getStats() || null, environment = status?.environment || renderingEnvironment(view);
  const policy = renderer?.policy ? normalizeRendering(renderer.policy) : null;
  return JSON.parse(JSON.stringify({schema: 1, environment, policy, candidates: policy ? renderingCandidates(policy) : [],
    renderer: status, measurement, diagnosis: graphicsDiagnosis(status, measurement), advice: renderingAdvice(status, environment, measurement),
    claims: {physicalHardwareCertified: false, wholeIDEPerformanceCompared: false}}));
}
